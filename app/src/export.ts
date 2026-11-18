import { variantName, walkPage, type Component, type DesignDocument, type DesignNode, type Page } from './model';
import { applyPoint, center, invert, isFlipped, linearPart, multiply, rotationDegrees, worldMatrix } from './geometry';
import { fontStack, pathPaint, paintsToBackground, strokeAndEffectCss, textCss } from './styleCss';
import { pathToD } from './path';

type Style = Record<string, string | number>;

const JUSTIFY_CSS = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' } as const;
const ALIGN_CSS = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;

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
    // 부모의 지역 좌표로 옮긴다. 부모 div가 자기 회전·반전을 CSS로 다시 적용하므로, 페이지 좌표 차이를 그대로 쓰면 두 번 적용된다.
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

function styleFor(node: DesignNode, parent: DesignNode | null): Style {
  const style: Style = { ...placement(node, parent), ...layoutStyle(node) };
  const paintable = node.type === 'frame' || node.type === 'rectangle' || node.type === 'ellipse';
  const background = paintable ? paintsToBackground(node.fills, node.width, node.height, (assetId) => `./assets/${assetId}`) : undefined;
  if (background) style.background = background;
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
    if (node.fontWeight) style.fontWeight = node.fontWeight;
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

interface ExportState { doc: DesignDocument; plans: Map<string, ComponentPlan>; names: Set<string> }

interface RenderContext {
  state: ExportState;
  page: Page;
  hidden: ReadonlySet<string>;
  /** 이 렌더 범위의 텍스트 prop 이름. 키는 도형 id. */
  textProp: (node: DesignNode) => string | undefined;
  /** 렌더를 시작한 루트 도형. 루트 안의 인스턴스만 컴포넌트 사용으로 바꾼다. */
  rootId: string;
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

/** 도형 하나를 JSX 줄로. 다른 컴포넌트의 인스턴스는 그 컴포넌트를 쓰는 한 줄이 된다. */
function renderNode(node: DesignNode, parent: DesignNode | null, depth: number, context: RenderContext): string[] {
  const indent = '  '.repeat(depth);
  if (node.componentId && !node.mainInstance && node.id !== context.rootId) return [`${indent}${usage(context.state, context.page, node, parent)}`];
  const style = JSON.stringify(styleFor(node, parent));
  const styleAttr = parent ? `style={${style}}` : `className={props.className} style={{ ...${style}, ...props.style }}`;
  if (node.type === 'text') {
    const prop = context.textProp(node);
    return [`${indent}<div ${styleAttr}>{${prop ? `props.${prop} ?? ` : ''}${JSON.stringify(node.text ?? '')}}</div>`];
  }
  // 편집 경로가 있는 벡터와 불리언 그룹은 결과 경로 하나로 내보낸다(불리언 피연산자는 내보내지 않는다).
  if (node.path) {
    const paint = pathPaint(node);
    const attrs = `fill=${JSON.stringify(paint.fill)}${paint.fillRule ? ` fillRule="${paint.fillRule}"` : ''}${paint.stroke ? ` stroke=${JSON.stringify(paint.stroke)} strokeWidth={${paint.strokeWidth}}` : ''}`;
    return [`${indent}<svg ${styleAttr} viewBox="0 0 ${round(node.width)} ${round(node.height)}" overflow="visible" aria-hidden="true"><path d=${JSON.stringify(pathToD(node.path))} ${attrs} /></svg>`];
  }
  if (node.type === 'vector') {
    const paths = (node.vectorPaths ?? []).map((path) => `<path d=${JSON.stringify(path.d)} fill=${JSON.stringify(path.fill)}${path.fillRule ? ` fillRule="${path.fillRule}"` : ''}${path.stroke ? ` stroke=${JSON.stringify(path.stroke)} strokeWidth={${path.strokeWidth ?? 1}}` : ''} />`).join('');
    const view = node.viewBox ?? { width: node.width, height: node.height };
    return [`${indent}<svg ${styleAttr} viewBox="0 0 ${view.width} ${view.height}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`];
  }
  const children = (node.children ?? []).map((id) => context.page.objects[id]).filter((child): child is DesignNode => Boolean(child && !context.hidden.has(child.id)));
  if (children.length === 0) return [`${indent}<div ${styleAttr} />`];
  return [`${indent}<div ${styleAttr}>`, ...children.flatMap((child) => renderNode(child, node, depth + 1, context)), `${indent}</div>`];
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
    const context: RenderContext = { state, page: main.page, hidden: hiddenIn(main.page, main.node.id), rootId: main.node.id, textProp: (node) => (insideNestedInstance(main.page, node, main.node.id) ? undefined : plan.textProps.get(node.name)) };
    const body = renderNode(main.node, null, 2, context);
    lines.push(`${plan.members.length > 1 ? '' : 'export '}function ${fn}(props: ${plan.name}Props) {`, '  return (', ...body, '  );', '}', '');
  }
  return lines;
}

/** 인스턴스를 컴포넌트 사용 한 줄로. variant 값과, 메인과 다른 텍스트만 props로 넘긴다. 위치는 style prop으로 준다. */
function usage(state: ExportState, page: Page, node: DesignNode, parent: DesignNode | null): string {
  const component = node.componentId ? state.doc.components[node.componentId] : undefined;
  const plan = node.componentId ? ensurePlan(state, node.componentId) : null;
  if (!component || !plan) return `{/* 컴포넌트 ${node.componentId ?? ''} 없음 */}`;
  const attrs = [`style={${JSON.stringify(placement(node, parent))}}`];
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
 * 선택한 도형과 하위 트리를 React/TypeScript 코드로 만든다.
 * 오토 레이아웃 프레임은 CSS flex로, 나머지는 부모 기준 절대 좌표로 나온다. 숨긴 도형은 빠진다.
 * 안에 든 인스턴스는 그 컴포넌트를 쓰는 JSX가 되고, 쓰인 컴포넌트는 같은 파일에 함수로 함께 나온다(S5-06).
 * 선택한 것이 메인 컴포넌트나 그 인스턴스면 그 컴포넌트 자체를 내보낸다.
 */
export function exportTsx(doc: DesignDocument, pageId: string, selectedId: string): { name: string; code: string } {
  const page = doc.pages.find((item) => item.id === pageId);
  const root = page?.objects[selectedId];
  if (!page || !root) throw new Error('Select a node to export');
  const state: ExportState = { doc, plans: new Map(), names: new Set() };
  const componentId = root.componentId ?? (root.componentSet ? Object.values(doc.components).find((item) => item.setId === root.id)?.id : undefined);
  if (componentId && (root.mainInstance || root.componentSet)) {
    const plan = ensurePlan(state, componentId);
    if (plan) return { name: plan.name, code: fileCode(state) };
  }
  const name = uniqueName(state, identifier(root.name));
  const hidden = hiddenIn(page, selectedId);
  const texts = walkPage(page, [selectedId]).filter((node) => node.type === 'text' && !hidden.has(node.id) && !(node.id !== selectedId && insideInstanceBelow(page, node, selectedId)));
  const props = new Map(texts.map((node, index) => [node.id, propertyName(node, index)]));
  const body = renderNode(root, null, 2, { state, page, hidden, rootId: selectedId, textProp: (node) => props.get(node.id) });
  const own = [`export interface ${name}Props {`, '  className?: string;', '  style?: CSSProperties;', ...texts.map((node) => `  ${props.get(node.id)}?: string;`), '}', '', `export function ${name}(props: ${name}Props) {`, '  return (', ...body, '  );', '}', ''];
  return { name, code: fileCode(state, own) };
}

function insideInstanceBelow(page: Page, node: DesignNode, rootId: string): boolean {
  for (let current: string | null = node.id; current && current !== rootId; current = page.objects[current]?.parentId ?? null) if (page.objects[current]?.componentId && !page.objects[current]?.mainInstance) return true;
  return false;
}

function fileCode(state: ExportState, own: string[] = []): string {
  return ["import type { CSSProperties } from 'react';", '', ...own, ...[...state.plans.values()].flatMap((plan) => plan.code)].join('\n');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
