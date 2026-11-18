import { walkPage, type DesignNode, type Page } from './model';
import { rotationDegrees } from './geometry';
import { paintsToBackground, strokeAndEffectCss, textCss } from './styleCss';

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
  if (!inFlow) return { position: 'absolute', left: round(node.x - parent.x), top: round(node.y - parent.y), width: node.width, height: node.height, boxSizing: 'border-box' };
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
  const degrees = rotationDegrees(node.transform);
  if (degrees) style.transform = `rotate(${degrees}deg)`;
  if (node.type === 'text') {
    Object.assign(style, textCss(node), { display: 'flex', flexDirection: 'column', whiteSpace: 'pre-wrap' });
    style.fontSize = node.fontSize ?? 18;
    if (node.fontFamily) style.fontFamily = node.fontFamily;
    if (node.fontWeight) style.fontWeight = node.fontWeight;
  }
  return style;
}

interface RenderContext { page: Page; props: Map<string, string>; hidden: ReadonlySet<string> }

/** 도형 하나를 JSX 줄로. 자식은 트리 그대로 안에 넣는다. */
function renderNode(node: DesignNode, parent: DesignNode | null, depth: number, context: RenderContext): string[] {
  const indent = '  '.repeat(depth);
  const style = JSON.stringify(styleFor(node, parent));
  const rootProps = parent ? '' : ' className={props.className}';
  if (node.type === 'text') return [`${indent}<div${rootProps} style={${style}}>{props.${context.props.get(node.id)} ?? ${JSON.stringify(node.text ?? '')}}</div>`];
  if (node.type === 'vector') {
    const paths = (node.vectorPaths ?? []).map((path) => `<path d=${JSON.stringify(path.d)} fill=${JSON.stringify(path.fill)}${path.fillRule ? ` fillRule="${path.fillRule}"` : ''}${path.stroke ? ` stroke=${JSON.stringify(path.stroke)} strokeWidth={${path.strokeWidth ?? 1}}` : ''} />`).join('');
    return [`${indent}<svg${rootProps} style={${style}} viewBox="0 0 ${node.width} ${node.height}" aria-hidden="true">${paths}</svg>`];
  }
  const children = (node.children ?? []).map((id) => context.page.objects[id]).filter((child): child is DesignNode => Boolean(child && !context.hidden.has(child.id)));
  if (children.length === 0) return [`${indent}<div${rootProps} style={${style}} />`];
  return [`${indent}<div${rootProps} style={${style}}>`, ...children.flatMap((child) => renderNode(child, node, depth + 1, context)), `${indent}</div>`];
}

/**
 * 선택한 도형과 하위 트리를 React/TypeScript 컴포넌트 코드로 만든다.
 * 텍스트는 선택적 문자열 prop이 되고, 오토 레이아웃 프레임은 CSS flex로, 나머지는 부모 기준 절대 좌표로 나온다. 숨긴 도형은 빠진다.
 */
export function exportTsx(page: Page, selectedId: string): { name: string; code: string } {
  const root = page.objects[selectedId];
  if (!root) throw new Error('Select a node to export');
  const hidden = new Set(walkPage(page, [selectedId]).filter((node) => node.hidden && node.id !== selectedId).flatMap((node) => walkPage(page, [node.id]).map((item) => item.id)));
  const textNodes = walkPage(page, [selectedId]).filter((node) => node.type === 'text' && !hidden.has(node.id));
  const props = new Map(textNodes.map((node, index) => [node.id, propertyName(node, index)]));
  const name = identifier(root.name);
  const propLines = textNodes.map((node) => `  ${props.get(node.id)}?: string;`).join('\n');
  const body = renderNode(root, null, 2, { page, props, hidden }).join('\n');
  const code = `export interface ${name}Props {\n  className?: string;\n${propLines ? `${propLines}\n` : ''}}\n\n` +
    `export function ${name}(props: ${name}Props) {\n  return (\n${body}\n  );\n}\n`;
  return { name, code };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
