import { variantName, walkPage, type Component, type DesignDocument, type DesignNode, type Page } from './model';
import { applyPoint, center, invert, isFlipped, linearPart, multiply, rotationDegrees, worldMatrix } from './geometry';
import { fontStack, pathPaint, paintsToBackground, strokeAndEffectCss, textCss, withAlpha } from './styleCss';
import { pathToD } from './path';
import { cssText, kebab, tokenVars, uniqueIn, withTokens, type CssRule, type Style, type TokenVars } from './exportCss';
import { boxElement, firstText, hasRole, inputElement, textElement, type Element } from './exportMarkup';

const JUSTIFY_CSS = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' } as const;
const ALIGN_CSS = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;

/** 내보낸 결과. code는 TSX이고 첫 줄에서 cssFile(같은 폴더의 CSS 파일, 내용은 css)을 import한다. */
export interface ExportResult { name: string; code: string; css: string; cssFile: string }

function identifier(name: string): string {
  const parts = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const result = parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
  return /^[A-Za-z]/.test(result) ? result : `Design${result}`;
}

function propertyName(node: DesignNode, index: number): string {
  const name = identifier(node.name);
  return `${name[0]!.toLowerCase()}${name.slice(1)}${index}`;
}

/**
 * 부모 안에서의 위치와 크기. 오토 레이아웃 부모의 흐름 안에 있으면 좌표 없이 크기 규칙만 쓰고(S4-05),
 * 그렇지 않으면 부모 기준 절대 좌표를 쓴다.
 */
function placement(node: DesignNode, parent: DesignNode | null): Style {
  if (!parent) return { position: 'relative', width: node.width, height: node.height, boxSizing: 'border-box' };
  const inFlow = Boolean(parent.layout) && !node.item?.absolute;
  if (!inFlow) {
    // 부모의 지역 좌표로 옮긴다. 부모 요소가 자기 회전·반전을 CSS로 다시 적용하므로, 페이지 좌표 차이를 그대로 쓰면 두 번 적용된다.
    const local = applyPoint(invert(worldMatrix(parent)), center(node));
    return { position: 'absolute', left: round(local.x - node.width / 2), top: round(local.y - node.height / 2), width: node.width, height: node.height, boxSizing: 'border-box' };
  }
  const row = parent.layout!.direction === 'row';
  const style: Style = { position: 'relative', boxSizing: 'border-box', flexShrink: 0 };
  const sizes = { h: node.item?.h ?? 'fix', v: node.item?.v ?? 'fix' };
  const main = row ? sizes.h : sizes.v;
  const cross = row ? sizes.v : sizes.h;
  if (main === 'fill') style.flex = '1 1 0';
  else if (main === 'fix') style[row ? 'width' : 'height'] = row ? node.width : node.height;
  if (cross === 'fill') style.alignSelf = 'stretch';
  else if (cross === 'fix') style[row ? 'height' : 'width'] = row ? node.height : node.width;
  if (node.item?.alignSelf && cross !== 'fill') style.alignSelf = ALIGN_CSS[node.item.alignSelf];
  return style;
}

function layoutStyle(node: DesignNode): Style {
  if (!node.layout) return {};
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
function fillStyle(node: DesignNode): Style {
  if (node.type !== 'frame' && node.type !== 'rectangle' && node.type !== 'ellipse') return {};
  const [bottom, ...rest] = node.fills;
  if (bottom?.type === 'solid') {
    const color = withAlpha(bottom.color, bottom.opacity ?? 1);
    // 위 겹이 그라디언트뿐이면 background-image로 따로 쓴다. 그림 겹은 위치·크기까지 담은 background 줄임 속성이 필요하다.
    if (rest.length === 0) return { backgroundColor: color };
    if (rest.every((paint) => paint.type !== 'image')) return { backgroundColor: color, backgroundImage: paintsToBackground(rest, node.width, node.height, () => null)! };
  }
  const background = paintsToBackground(node.fills, node.width, node.height, (assetId) => `./assets/${assetId}`);
  return background ? { background } : {};
}

function styleFor(node: DesignNode, parent: DesignNode | null): Style {
  const style: Style = { ...placement(node, parent), ...layoutStyle(node), ...fillStyle(node) };
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
  return style;
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

/** 파일 하나를 만드는 동안의 상태. rules는 CSS 규칙을 쓸 순서대로 모은다(컴포넌트 규칙이 그것을 쓰는 쪽보다 앞). */
interface ExportState { doc: DesignDocument; plans: Map<string, ComponentPlan>; names: Set<string>; classes: Set<string>; rules: CssRule[]; vars: TokenVars }

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

/** 도형에 맞는 HTML 요소. input 이름 컨테이너를 만나면 그 안의 첫 텍스트를 입력창으로 예약한다. */
function elementOf(node: DesignNode, phrasing: boolean, context: RenderContext): Element {
  if (node.type === 'text') return context.inputs.has(node.id) ? inputElement(context.inputs.get(node.id)!) : textElement(node, phrasing);
  if (node.path || node.type === 'vector') return { tag: 'svg', attrs: [], reset: {}, phrasing: true };
  if (node.id === context.rootId && context.rootRoleName) node = { ...node, name: `${context.rootRoleName} ${node.name}` };
  const text = !phrasing && hasRole(node, 'input') ? firstText(context.page, node, context.hidden) : undefined;
  const element = boxElement(node, phrasing, Boolean(text));
  if (element.tag === 'label' && text) context.inputs.set(text.id, hasRole(node, 'password'));
  return element;
}

/** 도형의 CSS 규칙을 만든다. 요소 초기화 스타일 위에 도형 스타일을 덮고, 토큰 값은 변수로 바꾼다. */
function addRule(context: RenderContext, className: string, node: DesignNode, parent: DesignNode | null, element: Element): void {
  const style: Style = { ...element.reset, ...styleFor(node, parent) };
  if (element.tag === 'img') delete style.background;
  const final = withTokens(style, node, context.state.vars);
  context.rules.push({ selector: `.${className}`, style: final });
  if (element.tag === 'input' && final.color !== undefined) context.rules.push({ selector: `.${className}::placeholder`, style: { color: final.color, opacity: 1 } });
}

function classAttr(className: string, root: boolean): string {
  return root ? `className={[${JSON.stringify(className)}, props.className].filter(Boolean).join(' ')} style={props.style}` : `className="${className}"`;
}

/** 도형 하나를 JSX 줄로. 다른 컴포넌트의 인스턴스는 그 컴포넌트를 쓰는 한 줄이 된다. */
function renderNode(node: DesignNode, parent: DesignNode | null, depth: number, context: RenderContext, phrasing = false): string[] {
  const indent = '  '.repeat(depth);
  const root = node.id === context.rootId;
  if (node.componentId && !node.mainInstance && !root) return [`${indent}${usage(context, node, parent)}`];
  const element = elementOf(node, phrasing, context);
  const className = root ? context.block : uniqueIn(context.state.classes, `${context.block}__${kebab(node.name)}`);
  addRule(context, className, node, parent, element);
  const open = [element.tag, classAttr(className, root), ...element.attrs].join(' ');
  if (node.type === 'text') {
    const prop = context.textProp(node);
    const content = `${prop ? `props.${prop} ?? ` : ''}${JSON.stringify(node.text ?? '')}`;
    return [element.tag === 'input' ? `${indent}<${open} placeholder={${content}} />` : `${indent}<${open}>{${content}}</${element.tag}>`];
  }
  if (node.path || node.type === 'vector') return [`${indent}<${open} ${vectorBody(node)}</svg>`];
  const children = element.tag === 'img' ? [] : (node.children ?? []).map((id) => context.page.objects[id]).filter((child): child is DesignNode => Boolean(child && !context.hidden.has(child.id)));
  if (children.length === 0) return [`${indent}<${open} />`];
  return [`${indent}<${open}>`, ...children.flatMap((child) => renderNode(child, node, depth + 1, context, phrasing || element.phrasing)), `${indent}</${element.tag}>`];
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

/** 루트 하나를 렌더하고, 만든 CSS 규칙을 파일 규칙 뒤에 붙인다. 안에서 처음 쓰인 컴포넌트의 규칙은 이미 앞에 붙어 있다. */
function renderRoot(state: ExportState, page: Page, root: DesignNode, blockName: string, textProp: RenderContext['textProp'], rootRoleName?: string): string[] {
  const context: RenderContext = { state, page, hidden: hiddenIn(page, root.id), rootId: root.id, textProp, block: uniqueIn(state.classes, kebab(blockName)), rules: [], inputs: new Map(), rootRoleName };
  const body = renderNode(root, null, 2, context);
  state.rules.push(...context.rules);
  return body;
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
    const body = renderRoot(state, main.page, main.node, fn, (node) => (insideNestedInstance(main.page, node, main.node.id) ? undefined : plan.textProps.get(node.name)), member.name);
    lines.push(`${plan.members.length > 1 ? '' : 'export '}function ${fn}(props: ${plan.name}Props) {`, '  return (', ...body, '  );', '}', '');
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
  context.rules.push({ selector: `.${className}`, style: placement(node, parent) });
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
 * 오토 레이아웃 프레임은 CSS flex로, 나머지는 부모 기준 절대 좌표로 나온다. 숨긴 도형은 빠진다.
 * 스타일은 BEM 클래스로 CSS 파일에 모이고, 태그는 레이어 이름으로 고르며(button, h1, input 등), 토큰은 CSS 변수가 된다.
 * 안에 든 인스턴스는 그 컴포넌트를 쓰는 JSX가 되고, 쓰인 컴포넌트는 같은 파일에 함수로 함께 나온다(S5-06).
 * 선택한 것이 메인 컴포넌트나 그 인스턴스면 그 컴포넌트 자체를 내보낸다.
 */
export function exportTsx(doc: DesignDocument, pageId: string, selectedId: string): ExportResult {
  const page = doc.pages.find((item) => item.id === pageId);
  const root = page?.objects[selectedId];
  if (!page || !root) throw new Error('Select a node to export');
  const state: ExportState = { doc, plans: new Map(), names: new Set(), classes: new Set(), rules: [], vars: tokenVars(doc) };
  const componentId = root.componentId ?? (root.componentSet ? Object.values(doc.components).find((item) => item.setId === root.id)?.id : undefined);
  if (componentId && (root.mainInstance || root.componentSet)) {
    const plan = ensurePlan(state, componentId);
    if (plan) return result(state, plan.name);
  }
  const name = uniqueName(state, identifier(root.name));
  const hidden = hiddenIn(page, selectedId);
  const texts = walkPage(page, [selectedId]).filter((node) => node.type === 'text' && !hidden.has(node.id) && !(node.id !== selectedId && insideInstanceBelow(page, node, selectedId)));
  const props = new Map(texts.map((node, index) => [node.id, propertyName(node, index)]));
  const body = renderRoot(state, page, root, name, (node) => props.get(node.id));
  const own = [`export interface ${name}Props {`, '  className?: string;', '  style?: CSSProperties;', ...texts.map((node) => `  ${props.get(node.id)}?: string;`), '}', '', `export function ${name}(props: ${name}Props) {`, '  return (', ...body, '  );', '}', ''];
  return result(state, name, own);
}

function insideInstanceBelow(page: Page, node: DesignNode, rootId: string): boolean {
  for (let current: string | null = node.id; current && current !== rootId; current = page.objects[current]?.parentId ?? null) if (page.objects[current]?.componentId && !page.objects[current]?.mainInstance) return true;
  return false;
}

function result(state: ExportState, name: string, own: string[] = []): ExportResult {
  const cssFile = `${name}.css`;
  const code = ["import type { CSSProperties } from 'react';", `import './${cssFile}';`, '', ...own, ...[...state.plans.values()].flatMap((plan) => plan.code)].join('\n');
  return { name, code, css: cssText(state.rules, state.vars), cssFile };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
