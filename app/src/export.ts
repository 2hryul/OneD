import { variantName, walkPage, type Component, type DesignDocument, type DesignNode, type GridLayout, type Page } from './model';
import { formatTracks } from './gridLayout';
import { hasMask, maskImageUrl, maskRuns } from './mask';
import { applyPoint, center, invert, isFlipped, linearPart, multiply, rotationDegrees, worldMatrix } from './geometry';
import { fontStack, pathPaint, paintsToBackground, strokeAndEffectCss, textCss, textRuns, withAlpha } from './styleCss';
import { pathToD } from './path';
import { cssText, declarations, kebab, tokenVars, typographyVar, uniqueIn, withTokens, type CssRule, type Style, type TokenVars } from './exportCss';
import { boxElement, controlState, fieldControl, fieldKind, firstText, hasRole, inputElement, isIcon, selectBox, textElement, VISUALLY_HIDDEN, type ControlState, type Element, type FieldKind } from './exportMarkup';

const JUSTIFY_CSS = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' } as const;
const ALIGN_CSS = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;

/**
 * 내보낸 결과. code는 TSX이고 첫 줄들에서 cssFile(같은 폴더의 CSS 파일, 내용은 css)과 그림을 import한다.
 * assets는 코드와 CSS가 쓰는 그림 id 목록이다(묶어 받기용).
 */
export interface ExportResult { name: string; code: string; css: string; cssFile: string; assets: string[] }

/** assetFile: 그림 id → assets 폴더 안의 파일 이름(확장자 포함). 없으면 id를 그대로 쓴다. */
export interface ExportOptions { assetFile?: (assetId: string) => string }

function identifier(name: string): string {
  const parts = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const result = parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
  return /^[A-Za-z]/.test(result) ? result : `Design${result}`;
}

function propertyName(node: DesignNode, index: number): string {
  const name = identifier(node.name);
  return `${name[0]!.toLowerCase()}${name.slice(1)}${index}`;
}

/** 스타일을 만들 때 도형 밖에서 알아야 하는 것. fluid는 화면 루트, control은 입력 요소(input·textarea), asset은 그림 파일 이름이다. */
interface StyleHints { fluid?: boolean; control?: boolean; asset: (assetId: string) => string }

/**
 * 부모 안에서의 위치와 크기. 오토 레이아웃 부모의 흐름 안에 있으면 좌표 없이 크기 규칙만 쓰고(S4-05),
 * 그렇지 않으면 부모 기준 좌표를 제약(constraints)에 맞춰 쓴다.
 * 화면 루트는 원래 폭을 최대 폭으로 두고 좁은 화면에서는 줄어든다.
 */
function placement(node: DesignNode, parent: DesignNode | null, hints: Partial<StyleHints> = {}): Style {
  if (!parent) {
    return hints.fluid
      ? { position: 'relative', width: '100%', maxWidth: node.width, minHeight: node.height, boxSizing: 'border-box' }
      : { position: 'relative', width: node.width, height: node.height, boxSizing: 'border-box' };
  }
  const inFlow = Boolean(parent.layout) && !node.item?.absolute;
  return inFlow ? flowPlacement(node, parent, Boolean(hints.control)) : absolutePlacement(node, parent);
}

/**
 * 부모 기준 절대 위치. 부모가 프레임이고 서로 회전이 없으면 제약을 CSS로 옮긴다:
 * right·bottom은 반대쪽 거리, center는 50% 기준 거리, left-right·top-bottom은 양쪽 거리(크기는 따라 늘어남), scale은 비율.
 */
function absolutePlacement(node: DesignNode, parent: DesignNode): Style {
  // 부모의 지역 좌표로 옮긴다. 부모 요소가 자기 회전·반전을 CSS로 다시 적용하므로, 페이지 좌표 차이를 그대로 쓰면 두 번 적용된다.
  const local = applyPoint(invert(worldMatrix(parent)), center(node));
  const left = round(local.x - node.width / 2);
  const top = round(local.y - node.height / 2);
  const relative = multiply(invert(linearPart(parent.transform)), linearPart(node.transform));
  const straight = Math.abs(relative[1]) < 1e-6 && Math.abs(relative[2]) < 1e-6;
  const constraints = parent.type === 'frame' && straight ? node.constraints : undefined;
  const sides: Style = {
    ...axisPlacement(constraints?.h ?? 'left', left, node.width, parent.width, ['left', 'right', 'width']),
    ...axisPlacement(constraints?.v ?? 'top', top, node.height, parent.height, ['top', 'bottom', 'height'])
  };
  // 사람이 읽기 쉬운 순서(left, top, right, bottom, width, height)로 적는다.
  const style: Style = { position: 'absolute' };
  for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) if (sides[key] !== undefined) style[key] = sides[key]!;
  style.boxSizing = 'border-box';
  return style;
}

/** 한 축의 제약을 CSS 속성으로. keys는 [시작 쪽, 끝 쪽, 크기] 속성 이름이다. */
function axisPlacement(constraint: string, start: number, size: number, parentSize: number, keys: [string, string, string]): Style {
  const [from, to, length] = keys;
  const end = round(parentSize - start - size);
  switch (constraint) {
    case 'right': case 'bottom': return { [to]: end, [length]: size };
    case 'center': {
      const offset = round(start - parentSize / 2);
      return { [from]: offset === 0 ? '50%' : `calc(50% ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}px)`, [length]: size };
    }
    case 'left-right': case 'top-bottom': return { [from]: start, [to]: end };
    case 'scale': return { [from]: percent(start, parentSize), [length]: percent(size, parentSize) };
    default: return { [from]: start, [length]: size };
  }
}

/**
 * 오토 레이아웃 흐름 안의 크기 규칙. 입력 요소는 글자에 맞춘(hug) 크기 대신 상자의 남는 폭을 채운다.
 * 입력창이 placeholder 글자 폭(예: 24px)으로 나오면 실제로 쓸 수 없기 때문이다.
 */
function flowPlacement(node: DesignNode, parent: DesignNode, control: boolean): Style {
  const layout = parent.layout!;
  if (layout.type === 'grid') return gridPlacement(node, control);
  const row = layout.direction === 'row';
  const style: Style = { position: 'relative', boxSizing: 'border-box', flexShrink: 0 };
  const sizes = { h: node.item?.h ?? 'fix', v: node.item?.v ?? 'fix' };
  const main = row ? sizes.h : sizes.v;
  const cross = row ? sizes.v : sizes.h;
  if (main === 'fill' || (control && main === 'auto' && row)) style.flex = '1 1 0';
  else if (main === 'fix' || control) style[row ? 'width' : 'height'] = row ? node.width : node.height;
  if (cross === 'fill') style.alignSelf = 'stretch';
  else if (cross === 'fix' || control) style[row ? 'height' : 'width'] = row ? node.height : node.width;
  if (node.item?.alignSelf && cross !== 'fill') style.alignSelf = ALIGN_CSS[node.item.alignSelf];
  // flex 항목의 기본 min-width(auto)는 내용보다 작게 줄지 않는다. 채우기 항목이 실제로 줄어들 수 있게 0으로 둔다.
  if (control || (row && main === 'fill')) style.minWidth = 0;
  // 고정 폭도 부모보다 넓어지지는 않게 한다. 디자인 폭에서는 그대로이고, 화면이 좁아져 부모가 줄면 함께 줄어든다.
  if (typeof style.width === 'number') style.maxWidth = '100%';
  for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) if (node.item?.[key] !== undefined) style[key] = node.item[key]!;
  return style;
}

/**
 * Grid 칸 안의 크기와 자리. 채우기는 칸 크기로 늘이고(justify-self·align-self: stretch), 고정은 크기를 적는다.
 * 칸이 지정된 자식은 grid-row·grid-column(1부터)을 적고, 나머지는 CSS 자동 배치(편집기 엔진과 같은 행 순서)에 맡긴다.
 */
function gridPlacement(node: DesignNode, control: boolean): Style {
  const style: Style = { position: 'relative', boxSizing: 'border-box', minWidth: 0 };
  const cell = node.item?.gridCell;
  if (cell) { style.gridRow = String(cell.row + 1); style.gridColumn = String(cell.column + 1); }
  const h = node.item?.h ?? 'fix';
  const v = node.item?.v ?? 'fix';
  if (h === 'fill' || control) style.justifySelf = 'stretch';
  else if (h === 'fix') { style.width = node.width; style.maxWidth = '100%'; }
  if (v === 'fill') style.alignSelf = 'stretch';
  else if (v === 'fix' || control) style.height = node.height;
  for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) if (node.item?.[key] !== undefined) style[key] = node.item[key]!;
  return style;
}

/** Grid 컨테이너 CSS. 트랙은 편집기와 같은 글자(1fr 120px auto)로, 모자란 행은 내용에 맞춤(grid-auto-rows: auto)이다. */
function gridStyle(layout: GridLayout): Style {
  return {
    display: 'grid', gridTemplateColumns: formatTracks(layout.columns), ...(layout.rows.length ? { gridTemplateRows: formatTracks(layout.rows) } : {}), gridAutoRows: 'auto',
    columnGap: layout.columnGap, rowGap: layout.rowGap, justifyItems: layout.justifyItems, alignItems: layout.alignItems,
    padding: layout.padding.map((value) => `${value}px`).join(' ')
  };
}

function layoutStyle(node: DesignNode): Style {
  if (!node.layout) return {};
  if (node.layout.type === 'grid') return gridStyle(node.layout);
  const { direction, gap, crossGap, padding, justify, align, wrap } = node.layout;
  return {
    display: 'flex', flexDirection: direction, justifyContent: JUSTIFY_CSS[justify], alignItems: ALIGN_CSS[align],
    // 자동 간격(space-between)은 gap을 쓰지 않는다. 편집기 레이아웃 엔진과 같은 규칙이다.
    ...(justify === 'space-between' && !wrap ? {} : { [direction === 'row' ? 'columnGap' : 'rowGap']: gap }),
    ...(wrap ? { flexWrap: 'wrap', [direction === 'row' ? 'rowGap' : 'columnGap']: crossGap } : {}),
    padding: padding.map((value) => `${value}px`).join(' ')
  };
}

/** 채우기. 단색 하나뿐이면 background-color로 쓰고(퍼블리셔가 고치기 쉬운 형태), 여러 겹·그라디언트·그림은 background 겹으로 쓴다. */
function fillStyle(node: DesignNode, asset: StyleHints['asset']): Style {
  if (node.type !== 'frame' && node.type !== 'rectangle' && node.type !== 'ellipse') return {};
  const [bottom, ...rest] = node.fills;
  if (bottom?.type === 'solid') {
    const color = withAlpha(bottom.color, bottom.opacity ?? 1);
    // 위 겹이 그라디언트뿐이면 background-image로 따로 쓴다. 그림 겹은 위치·크기까지 담은 background 줄임 속성이 필요하다.
    if (rest.length === 0) return { backgroundColor: color };
    if (rest.every((paint) => paint.type !== 'image')) return { backgroundColor: color, backgroundImage: paintsToBackground(rest, node.width, node.height, () => null)! };
  }
  const background = paintsToBackground(node.fills, node.width, node.height, (assetId) => `./assets/${asset(assetId)}`);
  return background ? { background } : {};
}

/** 도형 하나의 스타일(위치·크기·채우기·선·효과·변환·글자). 토큰·글자 변수로 바꾸기 전 값이다. */
function styleFor(node: DesignNode, parent: DesignNode | null, hints: StyleHints): Style {
  const style: Style = { ...placement(node, parent, hints), ...layoutStyle(node), ...fillStyle(node, hints.asset) };
  Object.assign(style, strokeAndEffectCss(node));
  if (node.opacity !== undefined) style.opacity = node.opacity;
  if (node.type === 'ellipse') style.borderRadius = '50%';
  if (node.radius) style.borderRadius = node.radius;
  if (node.type === 'frame' && node.clipContent !== false) style.overflow = 'hidden';
  // CSS 변환은 부모 변환 위에 쌓이므로 부모에 대한 상대 행렬만 쓴다. 뒤집힌 도형은 회전 뒤 좌우 반전으로 쓴다(rotationDegrees가 반전을 뺀 각도를 준다).
  const relative = parent ? multiply(invert(linearPart(parent.transform)), linearPart(node.transform)) : node.transform;
  const degrees = rotationDegrees(relative);
  const turns = [degrees ? `rotate(${degrees}deg)` : '', isFlipped(relative) ? 'scaleX(-1)' : ''].filter(Boolean);
  if (turns.length) style.transform = turns.join(' ');
  if (node.type === 'text') {
    Object.assign(style, textCss(node), { display: 'flex', flexDirection: 'column', whiteSpace: 'pre-wrap' });
    style.fontSize = node.fontSize ?? 18;
    if (node.fontFamily) style.fontFamily = fontStack(node.fontFamily);
    // 제목 요소의 기본 굵기(bold)를 이기도록 보통 굵기도 적는다.
    style.fontWeight = node.fontWeight ?? 400;
  }
  // 글자 상자는 높이를 최소값으로 둔다. 좁은 화면에서 줄이 늘면 상자도 늘어나 아래 내용과 겹치지 않는다(입력 요소는 높이 고정).
  // 오토 레이아웃 상자는 디자인 폭에서 글꼴 차이로 커지지 않도록 기본은 고정하고, 좁은 화면 미디어 쿼리에서만 풀어 준다(stackOnNarrow).
  if (typeof style.height === 'number' && !hints.control && node.type === 'text') {
    style.minHeight = style.height;
    delete style.height;
  }
  return style;
}

/**
 * 글자 크기·굵기·글꼴·줄 높이를 글자 스타일 변수 하나(font: var(--font-…))로 묶는다.
 * 글꼴 이름이 없거나 글자 크기가 토큰에 연결된 텍스트는 그대로 둔다(연결된 토큰 변수를 살리기 위해).
 */
function withTypography(style: Style, node: DesignNode, vars: TokenVars): Style {
  if (node.type !== 'text' || !node.fontFamily || node.tokens?.fontSize) return style;
  const { fontSize: _size, fontWeight: _weight, fontFamily: _family, lineHeight: _line, ...rest } = style;
  return { ...rest, font: typographyVar(vars, { family: node.fontFamily, stack: fontStack(node.fontFamily), size: node.fontSize ?? 18, weight: node.fontWeight ?? 400, lineHeight: node.lineHeight }) };
}

/** 출력할 컴포넌트 하나(variant 세트면 세트 전체)의 이름과 props 구성. */
interface ComponentPlan {
  name: string;
  members: Component[];
  /** 텍스트 레이어 이름 → prop 이름. variant끼리 같은 이름의 텍스트는 같은 prop을 쓴다. */
  textProps: Map<string, string>;
  variantProps: Array<{ key: string; prop: string; values: string[]; boolean: boolean }>;
  code: string[];
}

/**
 * 파일 하나를 만드는 동안의 상태. rules는 CSS 규칙을 쓸 순서대로 모은다(컴포넌트 규칙이 그것을 쓰는 쪽보다 앞).
 * images는 img로 낸 그림 id → import 변수 이름, assets는 코드·CSS가 쓴 모든 그림 id다.
 */
interface ExportState {
  doc: DesignDocument; plans: Map<string, ComponentPlan>; names: Set<string>; classes: Set<string>; rules: CssRule[]; vars: TokenVars;
  images: Map<string, string>; assets: Set<string>; assetFile: (assetId: string) => string; usesId: boolean;
}

/**
 * 폼 필드 렌더 계획. 제목(label), 입력 상자, 입력으로 바꿀 글자의 도형 id.
 * described는 입력을 설명하는 도움말·오류 도형 id → id 꼬리(hint, error)다. 입력의 aria-describedby가 이 id들을 가리킨다.
 */
interface FieldPlan { kind: FieldKind; state: ControlState; labelId?: string; boxId?: string; controlId?: string; described: Map<string, 'hint' | 'error'> }

const ERROR_NAME = /error|invalid|오류|에러/i;
const HINT_NAME = /hint|help|helper|desc|caption|message|도움|안내|설명/i;

interface RenderContext {
  state: ExportState;
  page: Page;
  hidden: ReadonlySet<string>;
  /** 이 렌더 범위의 텍스트 prop 이름. 키는 도형 id. */
  textProp: (node: DesignNode) => string | undefined;
  /** 렌더를 시작한 루트 도형. 루트 안의 인스턴스만 컴포넌트 사용으로 바꾼다. */
  rootId: string;
  /** BEM 블록 이름(루트 클래스). 하위 요소는 `블록__요소`가 된다. */
  block: string;
  /** 이 렌더에서 만든 CSS 규칙. 렌더가 끝나면 state.rules 뒤에 붙인다. */
  rules: CssRule[];
  /** 입력창으로 바꿀 텍스트 id → 비밀번호 여부. input 이름 컨테이너를 만날 때 채운다. */
  inputs: Map<string, boolean>;
  /** 루트의 역할을 고를 때 함께 볼 이름. variant 메인의 레이어 이름은 'Size=L, Status=Default'처럼 속성뿐이라 세트 이름(예: Button)을 쓴다. */
  rootRoleName?: string;
  /** 컴포넌트를 렌더하는 중이면 true. 루트 규칙은 인스턴스 위치 클래스와 한 요소에 걸리므로 순서를 지킨다. */
  component: boolean;
  /** 화면(컴포넌트가 아닌 선택 도형) 루트면 true. 폭이 화면에 맞춰 줄어든다. */
  fluid: boolean;
  field?: FieldPlan;
  /** radio·checkbox 컴포넌트. 루트 label 안에 실제 input을 넣는다. */
  choice?: { type: 'radio' | 'checkbox'; state: ControlState };
  /** 이 렌더가 useId로 만든 fieldId를 쓰는지. */
  usesId: boolean;
}

function hiddenIn(page: Page, rootId: string): Set<string> {
  return new Set(walkPage(page, [rootId]).filter((node) => node.hidden && node.id !== rootId).flatMap((node) => walkPage(page, [node.id]).map((item) => item.id)));
}

function uniqueName(state: ExportState, base: string): string {
  let name = base;
  for (let index = 2; state.names.has(name); index++) name = `${base}${index}`;
  state.names.add(name);
  return name;
}

function visibleChildren(context: Pick<RenderContext, 'page' | 'hidden'>, node: DesignNode): DesignNode[] {
  return (node.children ?? []).map((id) => context.page.objects[id]).filter((child): child is DesignNode => Boolean(child && !context.hidden.has(child.id)));
}

/**
 * variant Type 값으로 폼 필드인 컴포넌트에서 제목·입력 상자·입력 글자를 찾는다.
 * 상자는 이름이 Type 값(txt, select 등)이나 input인 자식, 없으면 선·채우기가 있고 글자가 든 프레임이다. 제목은 상자 앞의 글자 든 자식이다.
 */
function planField(page: Page, hidden: ReadonlySet<string>, root: DesignNode, variant: Record<string, string> | undefined): FieldPlan | undefined {
  const kind = fieldKind(variant);
  if (!kind) return undefined;
  const children = visibleChildren({ page, hidden }, root);
  const named = (child: DesignNode): boolean => child.type !== 'text' && (child.name.trim().toLowerCase() === kind.value || hasRole(child, 'input'));
  const boxed = (child: DesignNode): boolean => child.type === 'frame' && Boolean(child.strokes?.length || child.fills.length) && Boolean(firstText(page, child, hidden));
  const box = children.find(named) ?? children.find(boxed);
  const before = box ? children.slice(0, children.indexOf(box)) : children;
  const label = before.find((child) => child.type === 'text' || Boolean(firstText(page, child, hidden)));
  const control = box && kind.control !== 'select' ? firstText(page, box, hidden) : undefined;
  // 상자 뒤의 글자 든 자식 중 이름이 오류·도움말인 것이 입력의 설명이다(같은 종류는 처음 것만).
  const described = new Map<string, 'hint' | 'error'>();
  for (const child of box ? children.slice(children.indexOf(box) + 1) : []) {
    if (child.type !== 'text' && !firstText(page, child, hidden)) continue;
    const role = ERROR_NAME.test(child.name) ? 'error' : HINT_NAME.test(child.name) ? 'hint' : null;
    if (role && ![...described.values()].includes(role)) described.set(child.id, role);
  }
  return { kind, state: controlState(variant), labelId: label?.id, boxId: box?.id, controlId: control?.id, described };
}

/** radio·checkbox 이름의 컴포넌트이고 글자가 있으면 label로 감쌀 선택 컨트롤이다. 글자 없는 동그라미만이면 아이콘으로 둔다. */
function planChoice(page: Page, root: DesignNode, roleName: string | undefined, variant: Record<string, string> | undefined): RenderContext['choice'] {
  const name = { name: roleName ?? root.name };
  const type = hasRole(name, 'radio') ? 'radio' : hasRole(name, 'checkbox') ? 'checkbox' : null;
  if (!type || !walkPage(page, [root.id]).some((node) => node.type === 'text')) return undefined;
  return { type, state: controlState(variant) };
}

/** 입력 컨트롤에 도움말·오류 글자를 잇는 aria-describedby를 붙인다. */
function withDescription(element: Element, field: FieldPlan): Element {
  if (field.described.size === 0) return element;
  const ids = [...field.described.values()].map((role) => `\${fieldId}-${role}`).join(' ');
  return { ...element, attrs: [...element.attrs, `aria-describedby={\`${ids}\`}`] };
}

/** 텍스트 도형의 요소. 필드 제목·입력 글자, input 이름 컨테이너의 입력 글자, 그 밖에는 이름으로 고른 글 요소다. */
function textOf(node: DesignNode, phrasing: boolean, context: RenderContext): Element {
  const field = context.field;
  if (field && node.id === field.controlId) { context.usesId = true; return withDescription(fieldControl(field.kind, field.state), field); }
  if (field && node.id === field.labelId) { context.usesId = true; return { tag: 'label', attrs: ['htmlFor={fieldId}'], reset: { margin: 0 }, phrasing: true }; }
  if (context.inputs.has(node.id)) return inputElement(context.inputs.get(node.id)!);
  return textElement(node, phrasing);
}

/** 도형에 맞는 HTML 요소. input 이름 컨테이너를 만나면 그 안의 첫 텍스트를 입력창으로 예약한다. */
function elementOf(node: DesignNode, phrasing: boolean, context: RenderContext): Element {
  if (node.type === 'text') return textOf(node, phrasing, context);
  if (node.path || node.type === 'vector') return { tag: 'svg', attrs: [], reset: {}, phrasing: true };
  const field = context.field;
  if (field && node.id === field.labelId) { context.usesId = true; return { tag: 'label', attrs: ['htmlFor={fieldId}'], reset: { display: 'block' }, phrasing: true }; }
  if (field && node.id === field.boxId && field.kind.control === 'select') { context.usesId = true; return withDescription(selectBox(field.state), field); }
  if (node.id === context.rootId && context.choice) return { tag: 'label', attrs: [], reset: { display: 'block', cursor: 'pointer' }, phrasing: true };
  if (node.id === context.rootId && context.rootRoleName) node = { ...node, name: `${context.rootRoleName} ${node.name}` };
  // 아이콘만 든 버튼·링크는 버튼·링크가 먼저다(장식으로 숨기면 누를 수 있는 요소가 사라진다).
  const interactive = hasRole(node, 'button') || hasRole(node, 'link') || hasRole(node, 'input');
  if (!interactive && isIcon(context.page, node)) return { tag: 'span', attrs: ['aria-hidden="true"'], reset: { display: 'block' }, phrasing: true };
  const input = !phrasing && hasRole(node, 'input') ? firstText(context.page, node, context.hidden) : undefined;
  const any = hasRole(node, 'button') && walkPage(context.page, [node.id]).some((item) => item.type === 'text' && !context.hidden.has(item.id));
  const element = boxElement(node, phrasing, { any, input: Boolean(input) });
  if (element.tag === 'label' && input) context.inputs.set(input.id, hasRole(node, 'password'));
  return element;
}

/** 좁은 화면 기준. 태블릿 세로 폭(768px)보다 좁으면 가로 배치를 세로로 쌓는다. */
const NARROW_MEDIA = '(max-width: 767px)';

/**
 * 좁은 화면 규칙. 디자인 폭에서는 적용되지 않는다.
 * - 화면 출력에서 넓은(600px 이상) 가로 오토 레이아웃은 세로로 쌓는다(사이드바 + 본문 같은 단 구성). 줄바꿈 레이아웃과 컴포넌트 안쪽은 그대로 둔다.
 * - 고정 높이 오토 레이아웃 상자는 높이를 풀어(최소값으로) 줄이 늘어난 글자를 담는다.
 */
function stackOnNarrow(node: DesignNode, style: Style, context: RenderContext): Style | null {
  const layout = node.layout;
  if (!layout) return null;
  const narrow: Style = typeof style.height === 'number' ? { height: 'auto', minHeight: style.height } : {};
  if (!context.component && layout.type === 'flex' && layout.direction === 'row' && !layout.wrap && node.width >= 600) {
    Object.assign(narrow, { flexDirection: 'column', alignItems: 'stretch', columnGap: 0, rowGap: layout.justify === 'space-between' ? 0 : layout.gap });
  }
  return Object.keys(narrow).length ? narrow : null;
}

/** 도형의 CSS 규칙을 만든다. 요소 초기화 스타일 위에 도형 스타일을 덮고, 글자 스타일과 토큰 값은 변수로 바꾼다. */
function addRule(context: RenderContext, className: string, node: DesignNode, parent: DesignNode | null, element: Element, extra: Style = {}): void {
  const { state } = context;
  const root = node.id === context.rootId;
  const hints: StyleHints = { fluid: root && context.fluid, control: element.tag === 'input' || element.tag === 'textarea', asset: (id) => { state.assets.add(id); return state.assetFile(id); } };
  const style: Style = { ...element.reset, ...styleFor(node, parent, hints), ...extra };
  if (element.tag === 'img') delete style.background;
  const final = withTokens(withTypography(style, node, state.vars), node, state.vars);
  context.rules.push({ selector: `.${className}`, style: final, keepOrder: root && context.component });
  const stacked = stackOnNarrow(node, final, context);
  if (stacked) context.rules.push({ selector: `.${className}`, style: stacked, media: NARROW_MEDIA });
  if ((element.tag === 'input' || element.tag === 'textarea') && final.color !== undefined) context.rules.push({ selector: `.${className}::placeholder`, style: { color: final.color, opacity: 1 } });
}

function classAttr(className: string, root: boolean): string {
  return root ? `className={[${JSON.stringify(className)}, props.className].filter(Boolean).join(' ')} style={props.style}` : `className="${className}"`;
}

/** img 요소의 src. 그림은 파일 맨 위에서 import한다(번들러가 경로와 캐시 이름을 처리한다). */
function imageSource(state: ExportState, assetId: string): string {
  state.assets.add(assetId);
  const existing = state.images.get(assetId);
  if (existing) return `src={${existing}}`;
  const name = `image${state.images.size + 1}`;
  state.images.set(assetId, name);
  return `src={${name}}`;
}

/** 도형 하나를 JSX 줄로. 다른 컴포넌트의 인스턴스는 그 컴포넌트를 쓰는 한 줄이 된다. */
function renderNode(node: DesignNode, parent: DesignNode | null, depth: number, context: RenderContext, phrasing = false): string[] {
  const indent = '  '.repeat(depth);
  const root = node.id === context.rootId;
  if (node.componentId && !node.mainInstance && !root) return [`${indent}${usage(context, node, parent)}`];
  const element = elementOf(node, phrasing, context);
  const className = root ? context.block : uniqueIn(context.state.classes, `${context.block}__${kebab(node.name)}`);
  const masking = element.tag === 'img' || node.boolOp ? null : maskPlan(context, node);
  addRule(context, className, node, parent, element, masking?.self ? maskStyle(node, masking.self) : {});
  const attrs = element.assetId ? [imageSource(context.state, element.assetId), ...element.attrs] : [...element.attrs];
  const described = context.field?.described.get(node.id);
  if (described) attrs.unshift(`id={\`\${fieldId}-${described}\`}`);
  const open = [element.tag, classAttr(className, root), ...attrs].join(' ');
  if (node.type === 'text') return [`${indent}${textJsx(node, element, open, className, context)}`];
  if (node.path || node.type === 'vector') return [`${indent}<${open} ${vectorBody(node)}</svg>`];
  const childPhrasing = phrasing || element.phrasing;
  const body = masking
    ? masking.runs.flatMap((run) => renderRun(run, node, depth + 1, context, childPhrasing))
    : (element.tag === 'img' ? [] : visibleChildren(context, node)).flatMap((child) => renderNode(child, node, depth + 1, context, childPhrasing));
  const extra = root && context.choice ? [`${indent}  ${choiceInput(context)}`] : [];
  if (body.length === 0 && extra.length === 0) return [`${indent}<${open} />`];
  return [`${indent}<${open}>`, ...extra, ...body, `${indent}</${element.tag}>`];
}

/**
 * 마스크 자식이 있는 도형의 출력 방식. 마스크 도형 자신은 어느 경우에도 내보내지 않는다.
 * - 첫 자식이 마스크이고 뒤가 모두 그 구간이며 도형 자신에 채우기·선·효과가 없으면, 도형 요소에 mask-image를 건다(아이콘의 Bounding box 마스크가 이 경우).
 * - 레이아웃이 없는 도형이면 마스크 구간마다 부모를 덮는 감싸개 요소에 mask-image를 건다.
 * - 오토 레이아웃 도형은 감싸개가 흐름을 바꾸므로 마스크 없이 내보낸다(한계).
 */
function maskPlan(context: RenderContext, node: DesignNode): { self?: DesignNode; runs: Array<{ mask?: DesignNode; ids: string[] }> } | null {
  if (!node.children?.length || !hasMask(context.page, node)) return null;
  const runs = maskRuns(context.page, node).map((run) => ({ ...run, ids: run.ids.filter((id) => !context.hidden.has(id)) }));
  const bare = node.fills.length === 0 && !node.strokes?.length && !node.effects?.length;
  if (runs.length === 1 && runs[0]!.mask && bare) return { self: runs[0]!.mask, runs: [{ ids: runs[0]!.ids }] };
  if (node.layout) return { runs: runs.map((run) => ({ ids: run.ids })) };
  return { runs };
}

/** mask-image 스타일. 마스크 그림은 부모 상자 크기의 SVG라 상자 전체에 늘려 붙인다. */
function maskStyle(parent: DesignNode, mask: DesignNode): Style {
  const image = maskImageUrl(parent, mask);
  return { maskImage: image, WebkitMaskImage: image, maskSize: '100% 100%', WebkitMaskSize: '100% 100%', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat' };
}

/** 마스크 구간 하나. 마스크가 있으면 부모를 그대로 덮는 감싸개(같은 좌표계)에 마스크를 걸고 그 안에 구간 자식을 낸다. */
function renderRun(run: { mask?: DesignNode; ids: string[] }, parent: DesignNode, depth: number, context: RenderContext, phrasing: boolean): string[] {
  const nodes = run.ids.map((id) => context.page.objects[id]).filter((child): child is DesignNode => Boolean(child));
  if (!run.mask) return nodes.flatMap((child) => renderNode(child, parent, depth, context, phrasing));
  const indent = '  '.repeat(depth);
  const tag = phrasing ? 'span' : 'div';
  const className = uniqueIn(context.state.classes, `${context.block}__${kebab(run.mask.name)}-mask`);
  context.rules.push({ selector: `.${className}`, style: { display: 'block', position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', ...maskStyle(parent, run.mask) } });
  return [`${indent}<${tag} className="${className}">`, ...nodes.flatMap((child) => renderNode(child, parent, depth + 1, context, phrasing)), `${indent}</${tag}>`];
}

/** radio·checkbox의 실제 input. 화면에서는 숨기고(디자인의 동그라미가 보임) 보조 기술과 키보드가 쓴다. */
function choiceInput(context: RenderContext): string {
  const choice = context.choice!;
  const className = uniqueIn(context.state.classes, `${context.block}__control`);
  context.rules.push({ selector: `.${className}`, style: VISUALLY_HIDDEN });
  const attrs = [`type="${choice.type}"`, ...(choice.state.checked ? ['defaultChecked'] : []), ...(choice.state.disabled ? ['disabled'] : [])];
  return `<input className="${className}" ${attrs.join(' ')} />`;
}

/**
 * 텍스트 요소의 JSX. 입력 요소는 글자를 placeholder(채워진 상태면 defaultValue)로 넣는다.
 * 글자 구간 스타일(spans)이 있으면 구간마다 span으로 나눈다. prop으로 글자를 바꾸면 통째로 바뀐다.
 */
function textJsx(node: DesignNode, element: Element, open: string, className: string, context: RenderContext): string {
  const prop = context.textProp(node);
  const fallback = prop ? `props.${prop} ?? ` : '';
  if (element.tag === 'input' || element.tag === 'textarea') {
    const valueAttr = context.field?.controlId === node.id && context.field.state.filled ? 'defaultValue' : 'placeholder';
    return `<${open} ${valueAttr}={${fallback}${JSON.stringify(node.text ?? '')}} />`;
  }
  const runs = node.spans?.length ? spanRuns(node, className, context) : null;
  return `<${open}>{${fallback}${runs ?? JSON.stringify(node.text ?? '')}}</${element.tag}>`;
}

/** 글자 구간을 span으로. 구간 스타일(크기·굵기·글꼴·색)은 구간 클래스 규칙이 된다. */
function spanRuns(node: DesignNode, className: string, context: RenderContext): string {
  const parts = textRuns(node).map((run) => {
    if (!run.span) return `{${JSON.stringify(run.text)}}`;
    const runClass = uniqueIn(context.state.classes, `${className}-run`);
    const style: Style = {};
    if (run.span.fontSize !== undefined) style.fontSize = run.span.fontSize;
    if (run.span.fontWeight !== undefined) style.fontWeight = run.span.fontWeight;
    if (run.span.fontFamily) style.fontFamily = fontStack(run.span.fontFamily);
    if (run.span.color) style.color = run.span.color;
    context.rules.push({ selector: `.${runClass}`, style: withTokens(style, { ...node, tokens: undefined }, context.state.vars) });
    return `<span className="${runClass}">{${JSON.stringify(run.text)}}</span>`;
  });
  return `<>${parts.join('')}</>`;
}

/** svg 여는 태그의 나머지 속성과 경로들. 편집 경로·불리언은 결과 경로 하나로, 가져온 벡터는 경로 목록으로 낸다. */
function vectorBody(node: DesignNode): string {
  if (node.path) {
    const paint = pathPaint(node);
    const attrs = `fill=${JSON.stringify(paint.fill)}${paint.fillRule ? ` fillRule="${paint.fillRule}"` : ''}${paint.stroke ? ` stroke=${JSON.stringify(paint.stroke)} strokeWidth={${paint.strokeWidth}}` : ''}`;
    return `viewBox="0 0 ${round(node.width)} ${round(node.height)}" overflow="visible" aria-hidden="true"><path d=${JSON.stringify(pathToD(node.path))} ${attrs} />`;
  }
  const paths = (node.vectorPaths ?? []).map((path) => `<path d=${JSON.stringify(path.d)} fill=${JSON.stringify(path.fill)}${path.fillRule ? ` fillRule="${path.fillRule}"` : ''}${path.stroke ? ` stroke=${JSON.stringify(path.stroke)} strokeWidth={${path.strokeWidth ?? 1}}` : ''} />`).join('');
  const view = node.viewBox ?? { width: node.width, height: node.height };
  return `viewBox="0 0 ${view.width} ${view.height}" preserveAspectRatio="none" aria-hidden="true">${paths}`;
}

const BOOLEAN_VALUES = new Set(['true', 'false']);

/**
 * 컴포넌트(또는 그 variant 세트)를 함수 컴포넌트 코드로 만든다. 한 번 만든 것은 다시 쓴다.
 * variant 속성은 값의 유니온 타입 prop이 되고, 값이 true·false뿐이면 boolean prop이 된다. 텍스트 레이어는 이름별 문자열 prop이 된다.
 */
function ensurePlan(state: ExportState, componentId: string): ComponentPlan | null {
  const component = state.doc.components[componentId];
  if (!component) return null;
  const key = component.setId ?? component.id;
  const existing = state.plans.get(key);
  if (existing) return existing;
  const members = component.setId ? Object.values(state.doc.components).filter((item) => item.setId === component.setId) : [component];
  const plan: ComponentPlan = { name: uniqueName(state, identifier(component.name)), members, textProps: new Map(), variantProps: [], code: [] };
  state.plans.set(key, plan);
  const taken = new Set(['style', 'className']);
  const propName = (label: string): string => {
    const base = identifier(label);
    let name = `${base[0]!.toLowerCase()}${base.slice(1)}`;
    for (let index = 2; taken.has(name); index++) name = `${base[0]!.toLowerCase()}${base.slice(1)}${index}`;
    taken.add(name);
    return name;
  };
  const keys = [...new Set(members.flatMap((member) => Object.keys(member.variant ?? {})))];
  plan.variantProps = keys.map((variantKey) => {
    const values = [...new Set(members.map((member) => member.variant?.[variantKey] ?? ''))];
    return { key: variantKey, prop: propName(variantKey), values, boolean: values.every((value) => BOOLEAN_VALUES.has(value.toLowerCase())) };
  });
  for (const member of members) {
    const main = mainOf(state.doc, member);
    if (!main) continue;
    for (const node of walkPage(main.page, [main.node.id])) {
      if (node.type === 'text' && !insideNestedInstance(main.page, node, main.node.id) && !plan.textProps.has(node.name)) plan.textProps.set(node.name, propName(node.name));
    }
  }
  plan.code = componentCode(state, plan);
  return plan;
}

function mainOf(doc: DesignDocument, component: Component): { page: Page; node: DesignNode } | null {
  const page = doc.pages.find((item) => item.id === component.pageId);
  const node = page?.objects[component.mainId];
  return page && node ? { page, node } : null;
}

function insideNestedInstance(page: Page, node: DesignNode, rootId: string): boolean {
  for (let current = node.parentId; current && current !== rootId; current = page.objects[current]?.parentId ?? null) if (page.objects[current]?.componentId) return true;
  return false;
}

/** 루트를 렌더할 때의 선택 사항. member가 있으면 컴포넌트(variant 하나)를 렌더하는 중이다. fluid는 화면 루트다. */
interface RootOptions { textProp: RenderContext['textProp']; member?: Component; fluid?: boolean }

/** 루트 하나를 렌더하고, 만든 CSS 규칙을 파일 규칙 뒤에 붙인다. 안에서 처음 쓰인 컴포넌트의 규칙은 이미 앞에 붙어 있다. */
function renderRoot(state: ExportState, page: Page, root: DesignNode, blockName: string, options: RootOptions): { body: string[]; usesId: boolean } {
  const hidden = hiddenIn(page, root.id);
  const variant = options.member?.variant;
  const context: RenderContext = {
    state, page, hidden, rootId: root.id, textProp: options.textProp, block: uniqueIn(state.classes, kebab(blockName)), rules: [], inputs: new Map(),
    rootRoleName: options.member?.name, component: Boolean(options.member), fluid: Boolean(options.fluid), usesId: false,
    field: options.member ? planField(page, hidden, root, variant) : undefined,
    choice: options.member ? planChoice(page, root, options.member.name, variant) : undefined
  };
  const body = renderNode(root, null, 2, context);
  state.rules.push(...context.rules);
  if (context.usesId) state.usesId = true;
  return { body, usesId: context.usesId };
}

/** 함수 컴포넌트 본문. 폼 필드면 제목과 입력을 잇는 id를 useId로 만든다. */
function functionLines(signature: string, rendered: { body: string[]; usesId: boolean }): string[] {
  return [`${signature} {`, ...(rendered.usesId ? ['  const fieldId = useId();'] : []), '  return (', ...rendered.body, '  );', '}', ''];
}

function componentCode(state: ExportState, plan: ComponentPlan): string[] {
  const props = [
    '  className?: string;',
    '  style?: CSSProperties;',
    ...plan.variantProps.map((item) => `  ${item.prop}?: ${item.boolean ? 'boolean' : item.values.map((value) => JSON.stringify(value)).join(' | ')};`),
    ...[...plan.textProps.values()].map((prop) => `  ${prop}?: string;`)
  ];
  const lines = [`export interface ${plan.name}Props {`, ...props, '}', ''];
  // 이름에서 기호를 빼면 variant끼리 같아질 수 있다(예: 'Date range'와 'date-range'). 함수 이름은 파일 안에서 겹치지 않게 만든다.
  const renderers = plan.members.map((member) => ({ member, fn: plan.members.length > 1 ? uniqueName(state, `${plan.name}__${identifier(variantName(member.variant ?? {}) || member.id)}`) : plan.name }));
  if (plan.members.length > 1) {
    const first = plan.members[0]!;
    const condition = (member: Component): string => plan.variantProps.map((item) => {
      const value = member.variant?.[item.key] ?? '';
      const fallback = first.variant?.[item.key] ?? '';
      return item.boolean ? `(props.${item.prop} ?? ${fallback.toLowerCase() === 'true'}) === ${value.toLowerCase() === 'true'}` : `(props.${item.prop} ?? ${JSON.stringify(fallback)}) === ${JSON.stringify(value)}`;
    }).join(' && ') || 'true';
    lines.push(`export function ${plan.name}(props: ${plan.name}Props) {`, ...renderers.slice(1).map(({ member, fn }) => `  if (${condition(member)}) return <${fn} {...props} />;`), `  return <${renderers[0]!.fn} {...props} />;`, '}', '');
  }
  for (const { member, fn } of renderers) {
    const main = mainOf(state.doc, member);
    if (!main) continue;
    const rendered = renderRoot(state, main.page, main.node, fn, { member, textProp: (node) => (insideNestedInstance(main.page, node, main.node.id) ? undefined : plan.textProps.get(node.name)) });
    lines.push(...functionLines(`${plan.members.length > 1 ? '' : 'export '}function ${fn}(props: ${plan.name}Props)`, rendered));
  }
  return lines;
}

/** 인스턴스를 컴포넌트 사용 한 줄로. variant 값과, 메인과 다른 텍스트만 props로 넘긴다. 위치는 부모 쪽 클래스로 준다. */
function usage(context: RenderContext, node: DesignNode, parent: DesignNode | null): string {
  const { state, page } = context;
  const component = node.componentId ? state.doc.components[node.componentId] : undefined;
  const plan = node.componentId ? ensurePlan(state, node.componentId) : null;
  if (!component || !plan) return `{/* 컴포넌트 ${node.componentId ?? ''} 없음 */}`;
  const className = uniqueIn(state.classes, `${context.block}__${kebab(node.name)}`);
  context.rules.push({ selector: `.${className}`, style: placement(node, parent), keepOrder: true });
  const attrs = [`className="${className}"`];
  for (const item of plan.variantProps) {
    const value = component.variant?.[item.key];
    if (value !== undefined) attrs.push(item.boolean ? `${item.prop}={${value.toLowerCase() === 'true'}}` : `${item.prop}=${JSON.stringify(value)}`);
  }
  for (const text of walkPage(page, [node.id])) {
    if (text.type !== 'text' || insideNestedInstance(page, text, node.id)) continue;
    const main = text.shapeRef ? findMainShape(state.doc, text.shapeRef) : undefined;
    const prop = plan.textProps.get(main?.name ?? text.name);
    if (prop && main && text.text !== main.text) attrs.push(`${prop}=${JSON.stringify(text.text ?? '')}`);
  }
  return `<${plan.name} ${attrs.join(' ')} />`;
}

function findMainShape(doc: DesignDocument, id: string): DesignNode | undefined {
  for (const page of doc.pages) if (page.objects[id]) return page.objects[id];
  return undefined;
}

/**
 * 선택한 도형과 하위 트리를 React/TypeScript 코드와 CSS 파일로 만든다.
 * 오토 레이아웃 프레임은 CSS flex로, 나머지는 부모 기준 좌표(제약 반영)로 나온다. 숨긴 도형은 빠진다.
 * 스타일은 BEM 클래스로 CSS 파일에 모이고, 태그는 레이어 이름·variant로 고르며(button, h1, input, label 등), 토큰과 글자 스타일은 CSS 변수가 된다.
 * 안에 든 인스턴스는 그 컴포넌트를 쓰는 JSX가 되고, 쓰인 컴포넌트는 같은 파일에 함수로 함께 나온다(S5-06).
 * 선택한 것이 메인 컴포넌트나 그 인스턴스면 그 컴포넌트 자체를 내보낸다.
 */
export function exportTsx(doc: DesignDocument, pageId: string, selectedId: string, options: ExportOptions = {}): ExportResult {
  const page = doc.pages.find((item) => item.id === pageId);
  const root = page?.objects[selectedId];
  if (!page || !root) throw new Error('Select a node to export');
  const state: ExportState = { doc, plans: new Map(), names: new Set(), classes: new Set(), rules: [], vars: tokenVars(doc), images: new Map(), assets: new Set(), assetFile: options.assetFile ?? ((id) => id), usesId: false };
  const componentId = root.componentId ?? (root.componentSet ? Object.values(doc.components).find((item) => item.setId === root.id)?.id : undefined);
  if (componentId && (root.mainInstance || root.componentSet)) {
    const plan = ensurePlan(state, componentId);
    if (plan) return result(state, plan.name);
  }
  const name = uniqueName(state, identifier(root.name));
  const hidden = hiddenIn(page, selectedId);
  const texts = walkPage(page, [selectedId]).filter((node) => node.type === 'text' && !hidden.has(node.id) && !(node.id !== selectedId && insideInstanceBelow(page, node, selectedId)));
  const props = new Map(texts.map((node, index) => [node.id, propertyName(node, index)]));
  const rendered = renderRoot(state, page, root, name, { textProp: (node) => props.get(node.id), fluid: true });
  const own = [`export interface ${name}Props {`, '  className?: string;', '  style?: CSSProperties;', ...texts.map((node) => `  ${props.get(node.id)}?: string;`), '}', '', ...functionLines(`export function ${name}(props: ${name}Props)`, rendered)];
  return result(state, name, own);
}

function insideInstanceBelow(page: Page, node: DesignNode, rootId: string): boolean {
  for (let current: string | null = node.id; current && current !== rootId; current = page.objects[current]?.parentId ?? null) if (page.objects[current]?.componentId && !page.objects[current]?.mainInstance) return true;
  return false;
}

function result(state: ExportState, name: string, own: string[] = []): ExportResult {
  const cssFile = `${name}.css`;
  const react = state.usesId ? "import { useId, type CSSProperties } from 'react';" : "import type { CSSProperties } from 'react';";
  const images = [...state.images].map(([assetId, variable]) => `import ${variable} from './assets/${state.assetFile(assetId)}';`);
  const code = [react, `import './${cssFile}';`, ...images, '', ...own, ...[...state.plans.values()].flatMap((plan) => plan.code)].join('\n');
  return { name, code, css: cssText(state.rules, state.vars), cssFile, assets: [...state.assets] };
}

/**
 * 도형 하나의 CSS 선언(검사 창용). 코드 내보내기와 같은 규칙으로 만들되, 글자 스타일은 변수로 묶지 않고 풀어서 보여 준다.
 * 토큰에 연결되거나 토큰과 같은 색은 var(--토큰)으로 나온다.
 */
export function inspectCss(doc: DesignDocument, pageId: string, nodeId: string): string {
  const page = doc.pages.find((item) => item.id === pageId);
  const node = page?.objects[nodeId];
  if (!page || !node) return '';
  const parent = node.parentId ? page.objects[node.parentId] ?? null : null;
  const style = withTokens(styleFor(node, parent, { asset: (id) => id }), node, tokenVars(doc));
  return `.${kebab(node.name)} {\n${declarations(style).join('\n')}\n}\n`;
}

/** 부모 가장자리까지의 거리(부모 지역 좌표, px). 최상위 도형은 부모가 없어 null이다. */
export interface EdgeDistance { top: number; right: number; bottom: number; left: number }

/** 검사 창의 간격 표시. 회전된 도형도 부모 기준 상자(중심과 크기)로 잰다. */
export function inspectSpacing(doc: DesignDocument, pageId: string, nodeId: string): EdgeDistance | null {
  const page = doc.pages.find((item) => item.id === pageId);
  const node = page?.objects[nodeId];
  const parent = node?.parentId ? page?.objects[node.parentId] : undefined;
  if (!node || !parent) return null;
  const local = applyPoint(invert(worldMatrix(parent)), center(node));
  const left = round(local.x - node.width / 2);
  const top = round(local.y - node.height / 2);
  return { top, left, right: round(parent.width - left - node.width), bottom: round(parent.height - top - node.height) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percent(value: number, total: number): string {
  return `${total ? round((value / total) * 100) : 0}%`;
}
