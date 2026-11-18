import { primaryColor, type DesignNode, type GradientStop, type ImageFit, type Paint, type UnitPoint } from './model';

/** 캔버스와 React 출력이 같은 규칙으로 쓰는 CSS 속성 묶음. React style 객체 키 이름을 쓴다. */
export type CssStyle = Partial<Record<'background' | 'boxShadow' | 'outline' | 'outlineOffset' | 'filter' | 'backdropFilter' | 'color' | 'textAlign' | 'lineHeight' | 'letterSpacing' | 'justifyContent', string>>;

/** assetId를 이미지 주소로 바꾼다. 캔버스는 IndexedDB의 object URL을, React 출력은 상대 경로를 준다. 없으면 null. */
export type AssetResolver = (assetId: string) => string | null;

const FIT_CSS: Record<ImageFit, string> = { fill: 'center / cover no-repeat', fit: 'center / contain no-repeat', tile: 'left top / auto repeat', stretch: 'center / 100% 100% no-repeat' };

/**
 * 채우기 목록을 CSS background 한 값으로 만든다.
 * Figma·Penpot은 목록 뒤쪽이 위에 그려지고 CSS는 앞쪽이 위이므로 순서를 뒤집는다. 단색도 층으로 쌓기 위해 같은 색 그라디언트로 쓴다.
 */
export function paintsToBackground(paints: readonly Paint[], width: number, height: number, resolve: AssetResolver): string | undefined {
  const layers = [...paints].reverse().map((paint) => paintLayer(paint, width, height, resolve)).filter((layer): layer is string => Boolean(layer));
  return layers.length ? layers.join(', ') : undefined;
}

function paintLayer(paint: Paint, width: number, height: number, resolve: AssetResolver): string | null {
  const alpha = paint.opacity ?? 1;
  switch (paint.type) {
    case 'solid': { const color = withAlpha(paint.color, alpha); return `linear-gradient(${color}, ${color})`; }
    case 'linear': return linearGradient(paint.from, paint.to, paint.stops, alpha, width, height);
    case 'radial': return `radial-gradient(${round(paint.radius.x * width)}px ${round(paint.radius.y * height)}px at ${round(paint.center.x * 100)}% ${round(paint.center.y * 100)}%, ${stopList(paint.stops, alpha, (offset) => offset)})`;
    case 'image': { const url = resolve(paint.assetId); return url ? `url("${url}") ${FIT_CSS[paint.fit]}` : 'repeating-conic-gradient(#d9dce3 0% 25%, #f4f5f8 0% 50%) 0 0 / 16px 16px'; }
  }
}

/**
 * 상자 비율 좌표의 두 점(from→to)을 CSS linear-gradient 각도와 정지점 위치로 바꾼다.
 * CSS 그라디언트 선은 상자 중심을 지나고 길이가 |w·sinθ| + |h·cosθ|이므로, from·to를 그 선에 투영해 정지점을 옮긴다.
 */
export function linearGradient(from: UnitPoint, to: UnitPoint, stops: readonly GradientStop[], alpha: number, width: number, height: number): string {
  const dx = (to.x - from.x) * width;
  const dy = (to.y - from.y) * height;
  const angle = Math.atan2(dx, -dy);
  const length = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle)) || 1;
  const project = (p: UnitPoint): number => ((p.x - 0.5) * width * Math.sin(angle) - (p.y - 0.5) * height * Math.cos(angle)) / length + 0.5;
  const start = project(from);
  const end = project(to);
  return `linear-gradient(${round((angle * 180) / Math.PI)}deg, ${stopList(stops, alpha, (offset) => start + offset * (end - start))})`;
}

function stopList(stops: readonly GradientStop[], alpha: number, place: (offset: number) => number): string {
  return stops.map((stop) => `${withAlpha(stop.color, alpha)} ${round(place(stop.offset) * 100)}%`).join(', ');
}

/**
 * 선과 효과를 CSS로 바꾼다.
 * 위쪽 선은 outline(점선 지원, border-radius를 따름)으로, 나머지 선과 그림자는 box-shadow로 그린다. border를 쓰지 않는 이유는 자식 배치 기준이 밀리기 때문이다.
 * 채우기가 없는 도형(그룹, 텍스트, 벡터)의 그림자는 내용 모양을 따라야 하므로 filter: drop-shadow를 쓴다.
 */
export function strokeAndEffectCss(node: DesignNode): CssStyle {
  const style: CssStyle = {};
  const shadows: string[] = [];
  const filters: string[] = [];
  // 벡터·불리언의 선은 상자가 아니라 경로에 그린다(pathPaint).
  const strokes = node.type === 'vector' || node.type === 'text' || node.boolOp ? [] : node.strokes ?? [];
  const top = strokes[strokes.length - 1];
  if (top) {
    style.outline = `${top.width}px ${top.dash?.length ? 'dashed' : 'solid'} ${top.color}`;
    style.outlineOffset = `${top.align === 'inside' ? -top.width : top.align === 'center' ? -top.width / 2 : 0}px`;
  }
  for (const stroke of strokes.slice(0, -1)) {
    if (stroke.align !== 'outside') shadows.push(`inset 0 0 0 ${stroke.align === 'inside' ? stroke.width : stroke.width / 2}px ${stroke.color}`);
    if (stroke.align !== 'inside') shadows.push(`0 0 0 ${stroke.align === 'outside' ? stroke.width : stroke.width / 2}px ${stroke.color}`);
  }
  const boxed = node.fills.length > 0 && (node.type === 'frame' || node.type === 'rectangle' || node.type === 'ellipse');
  for (const effect of node.effects ?? []) {
    switch (effect.type) {
      case 'drop-shadow':
        if (boxed) shadows.push(`${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${effect.color}`);
        else filters.push(`drop-shadow(${effect.x}px ${effect.y}px ${effect.blur / 2}px ${effect.color})`);
        break;
      case 'inner-shadow': shadows.push(`inset ${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${effect.color}`); break;
      // Figma 블러 반경은 CSS blur()의 표준편차보다 두 배 넓게 보인다. 절반으로 맞춘다.
      case 'layer-blur': filters.push(`blur(${effect.radius / 2}px)`); break;
      case 'background-blur': style.backdropFilter = `blur(${effect.radius / 2}px)`; break;
    }
  }
  if (shadows.length) style.boxShadow = shadows.join(', ');
  if (filters.length) style.filter = filters.join(' ');
  return style;
}

/** 편집기 기본 글꼴 목록. */
export const DEFAULT_FONT_STACK = "'DM Sans', Inter, 'Segoe UI', sans-serif";

/**
 * 글꼴 목록. 문서의 글꼴이 이 PC에 없을 때 DOM·Canvas·내보낸 코드가 모두 같은 대체 글꼴을 쓰도록 기본 목록을 뒤에 붙인다.
 * (없으면 브라우저 기본 글꼴로 떨어져 렌더러마다 글자 폭이 달라진다.)
 */
export function fontStack(family?: string): string {
  return family ? `'${family.replace(/['\\]/g, '')}', ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK;
}

/** 텍스트 도형의 글자 스타일. 세로 정렬은 텍스트 요소를 세로 flex로 두고 justify-content로 맞춘다. */
export function textCss(node: DesignNode): CssStyle {
  const style: CssStyle = { color: primaryColor(node, '#17223a') };
  if (node.textAlign) style.textAlign = node.textAlign;
  if (node.lineHeight !== undefined) style.lineHeight = `${node.lineHeight}px`;
  if (node.letterSpacing !== undefined) style.letterSpacing = `${node.letterSpacing}px`;
  style.justifyContent = node.verticalAlign === 'middle' ? 'center' : node.verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
  return style;
}

/** 텍스트를 스타일 구간별 조각으로 나눈다. 구간이 없거나 덮지 않는 글자는 스타일 없는 조각이 된다. */
export function textRuns(node: Pick<DesignNode, 'text' | 'spans'>): Array<{ text: string; span?: NonNullable<DesignNode['spans']>[number] }> {
  const text = node.text ?? '';
  const spans = [...(node.spans ?? [])].filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  const runs: Array<{ text: string; span?: NonNullable<DesignNode['spans']>[number] }> = [];
  let cursor = 0;
  for (const span of spans) {
    const start = Math.max(cursor, Math.min(span.start, text.length));
    const end = Math.min(span.end, text.length);
    if (start > cursor) runs.push({ text: text.slice(cursor, start) });
    if (end > start) runs.push({ text: text.slice(start, end), span });
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs;
}

/**
 * 편집 경로(벡터·불리언)를 그릴 SVG 채우기·선 속성. 그라디언트·이미지는 대표 색으로 근사한다.
 * 캔버스와 코드 내보내기가 같은 값을 쓰도록 한곳에 둔다.
 */
export function pathPaint(node: DesignNode): { fill: string; stroke?: string; strokeWidth?: number; fillRule?: 'evenodd' } {
  const top = node.fills[node.fills.length - 1];
  const fill = top ? withAlpha(primaryColor(node), top.opacity ?? 1) : 'none';
  const stroke = node.strokes?.[node.strokes.length - 1];
  return { fill, ...(stroke ? { stroke: stroke.color, strokeWidth: stroke.width } : {}), ...(node.fillRule ? { fillRule: node.fillRule } : {}) };
}

/** #rrggbb(aa) 색에 투명도를 곱한다. 다른 형식은 그대로 둔다. */
export function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  const base = match[2] ? parseInt(match[2], 16) / 255 : 1;
  return `#${match[1]}${Math.round(Math.max(0, Math.min(1, base * alpha)) * 255).toString(16).padStart(2, '0')}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
