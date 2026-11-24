import { resolveGradientGeometry, type FigColor, type FigDocument, type FigNode, type FigPaint } from 'openfig-core';
import { figGlyphPath, glyphKey } from './glyphs.ts';
import { sniffImageMime, type AssetRecord } from './assets.ts';
import type { Effect, GradientStop, ImageAdjust, ImageFit, Paint, Stroke, TextAlign, TextSpan, VerticalAlign } from './model.ts';

/** 가져오기에서 변환하지 못했거나 근사한 항목. 노드·속성·원인을 남겨 다음 작업의 근거로 쓴다(SPEC S3-04). */
export interface ImportIssue { nodeId: string; name: string; kind: string; detail: string }

/** 스타일 변환 중 쌓이는 결과. 같은 이미지는 해시가 같아 한 번만 담는다. */
export interface StyleSink {
  fig: FigDocument;
  assets: Map<string, AssetRecord>;
  issues: ImportIssue[];
  /** 글꼴을 쓸 수 있는지. 없으면 텍스트에 글리프 윤곽을 저장한다. 없으면 모두 있다고 본다. */
  fontAvailable?: (family: string) => boolean;
}

type FigEffect = NonNullable<FigNode['effects']>[number];

const IMAGE_FIT: Record<string, ImageFit> = { FILL: 'fill', FIT: 'fit', TILE: 'tile', STRETCH: 'stretch', CROP: 'stretch' };

export function figColor(color: FigColor | undefined, alpha = 1): string {
  if (!color) return '#000000';
  const channel = (value: number): string => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  const a = (color.a ?? 1) * alpha;
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}${a < 1 ? channel(a) : ''}`;
}

function hashHex(hash: Uint8Array | string | undefined): string | null {
  if (!hash) return null;
  return typeof hash === 'string' ? hash : [...hash].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function issue(sink: StyleSink, node: FigNode, nodeId: string, kind: string, detail: string): void {
  sink.issues.push({ nodeId, name: node.name || node.type, kind, detail });
}

/**
 * Figma 채우기 목록을 Paint 목록으로 바꾼다. 순서(뒤쪽이 위)는 그대로 둔다.
 * 각도형·다이아몬드 그라디언트와 영상 채우기는 아직 표현하지 못해 보고만 남긴다.
 */
export function figPaints(sink: StyleSink, node: FigNode, nodeId: string, paints: FigPaint[] | undefined): Paint[] {
  const result: Paint[] = [];
  for (const paint of paints ?? []) {
    if (paint.visible === false) continue;
    const converted = figPaint(sink, node, nodeId, paint);
    if (converted) result.push(converted);
  }
  return result;
}

function figPaint(sink: StyleSink, node: FigNode, nodeId: string, paint: FigPaint): Paint | null {
  const opacity = paint.opacity !== undefined && paint.opacity < 1 ? { opacity: paint.opacity } : {};
  if (paint.type === 'SOLID') return { type: 'solid', color: figColor(paint.color), ...opacity };
  if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL') return figGradient(sink, node, nodeId, paint, opacity);
  if (paint.type === 'IMAGE') return figImage(sink, node, nodeId, paint, opacity);
  issue(sink, node, nodeId, 'paint-unsupported', `채우기 ${paint.type}`);
  return null;
}

function figGradient(sink: StyleSink, node: FigNode, nodeId: string, paint: FigPaint, opacity: { opacity?: number }): Paint | null {
  const width = node.size?.x ?? 1;
  const height = node.size?.y ?? 1;
  const kind = paint.type === 'GRADIENT_LINEAR' ? 'linear' : 'radial';
  const geometry = paint.transform ? resolveGradientGeometry({ type: kind, transform: paint.transform }, width, height) : null;
  const stops: GradientStop[] = (paint.stops ?? []).map((stop) => ({ offset: stop.position, color: figColor(stop.color) }));
  if (!geometry) { issue(sink, node, nodeId, 'paint-unsupported', `${paint.type} 기하 해석 실패`); return null; }
  if (geometry.type === 'linear') {
    return { type: 'linear', from: { x: geometry.start.x / width, y: geometry.start.y / height }, to: { x: geometry.end.x / width, y: geometry.end.y / height }, stops, ...opacity };
  }
  if (Math.abs(geometry.angle) > 0.01) issue(sink, node, nodeId, 'paint-approximated', `원형 그라디언트 회전 ${Math.round(geometry.angle)}도 무시`);
  return { type: 'radial', center: { x: geometry.center.x / width, y: geometry.center.y / height }, radius: { x: geometry.radiusX / width, y: geometry.radiusY / height }, stops, ...opacity };
}

function figImage(sink: StyleSink, node: FigNode, nodeId: string, paint: FigPaint, opacity: { opacity?: number }): Paint {
  const id = hashHex(paint.image?.hash) ?? '';
  const bytes = id ? sink.fig.images.get(id) : undefined;
  const mime = bytes ? sniffImageMime(bytes) : null;
  if (!bytes || !mime) issue(sink, node, nodeId, 'image-missing', `이미지 ${id || '(해시 없음)'} ${bytes ? '형식 판별 실패' : '파일에 없음'}`);
  else if (!sink.assets.has(id)) sink.assets.set(id, { id, mime, bytes });
  const mode = String((paint as FigPaint & { imageScaleMode?: string }).imageScaleMode ?? 'FILL');
  const t = paint.transform;
  if (t && (Math.abs(t.m00 - 1) > 1e-3 || Math.abs(t.m11 - 1) > 1e-3 || Math.abs(t.m02) > 1e-3 || Math.abs(t.m12) > 1e-3)) {
    issue(sink, node, nodeId, 'image-crop', `이미지 자르기·위치 변환(${mode}) 무시`);
  }
  const adjust = imageAdjust(sink, node, nodeId, paint);
  return { type: 'image', assetId: id, fit: IMAGE_FIT[mode] ?? 'fill', ...opacity, ...(adjust ? { adjust } : {}) };
}

/** Figma 그림 채우기의 색 보정(paintFilter). 값은 -1..1이고 0이 보정 없음이다. */
type FigPaintFilter = Partial<Record<'exposure' | 'contrast' | 'saturation' | 'vibrance' | 'temperature' | 'tint' | 'highlights' | 'shadows', number>>;

/** CSS filter로 흉내 낼 수 없는 보정 항목과 보고서에 쓸 이름. */
const UNSUPPORTED_FILTERS = [['temperature', '색온도'], ['tint', '틴트'], ['highlights', '하이라이트'], ['shadows', '그림자']] as const;

/**
 * 그림 색 보정을 CSS filter 배율로 근사하고 보고서에 남긴다.
 * 노출은 사진의 노출 단계(stop)처럼 2^값 밝기로, 대비는 1+값으로, 채도·생동감(vibrance)은 둘을 곱한 saturate로 바꾼다.
 * 생동감은 원래 채도가 낮은 색만 더 올리지만 CSS에는 그런 함수가 없어 채도로 근사한다. 색온도·틴트·하이라이트·그림자는 표현하지 못한다.
 */
function imageAdjust(sink: StyleSink, node: FigNode, nodeId: string, paint: FigPaint): ImageAdjust | undefined {
  const filter = (paint as FigPaint & { paintFilter?: FigPaintFilter }).paintFilter;
  if (!filter) return undefined;
  const value = (key: keyof FigPaintFilter): number => { const raw = filter[key]; return typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) >= 0.005 ? raw : 0; };
  const round = (number: number): number => Math.round(number * 100) / 100;
  const adjust: ImageAdjust = {};
  if (value('exposure')) adjust.brightness = round(2 ** value('exposure'));
  if (value('contrast')) adjust.contrast = round(Math.max(0, 1 + value('contrast')));
  const saturate = Math.max(0, (1 + value('saturation')) * (1 + value('vibrance')));
  if (Math.abs(saturate - 1) >= 0.005) adjust.saturate = round(saturate);
  const ignored = UNSUPPORTED_FILTERS.filter(([key]) => value(key)).map(([key, label]) => `${label} ${round(value(key))}`);
  const approximated = Object.entries(adjust).map(([key, number]) => `${key}(${number})`);
  if (approximated.length) issue(sink, node, nodeId, 'image-adjust-approximated', `그림 색 보정을 CSS 필터 ${approximated.join(' ')}로 근사${ignored.length ? ` · 표현 못 함: ${ignored.join(', ')}` : ''}`);
  else if (ignored.length) issue(sink, node, nodeId, 'image-adjust-unsupported', `그림 색 보정 무시: ${ignored.join(', ')}`);
  return approximated.length ? adjust : undefined;
}

/** 단색 선만 변환한다. 선 위치(inside/center/outside)와 점선 간격을 보존한다. */
export function figStrokes(sink: StyleSink, node: FigNode, nodeId: string): Stroke[] {
  const width = node.strokeWeight ?? 1;
  if (!width) return [];
  const align = (node.strokeAlign ?? 'CENTER').toLowerCase() as Stroke['align'];
  const dash = Array.isArray(node.dashPattern) && node.dashPattern.length ? { dash: node.dashPattern as number[] } : {};
  const strokes: Stroke[] = [];
  for (const paint of node.strokePaints ?? []) {
    if (paint.visible === false) continue;
    if (paint.type !== 'SOLID') { issue(sink, node, nodeId, 'stroke-unsupported', `선 ${paint.type}`); continue; }
    strokes.push({ color: figColor(paint.color, paint.opacity ?? 1), width, align, ...dash });
  }
  return strokes;
}

export function figEffects(sink: StyleSink, node: FigNode, nodeId: string): Effect[] {
  const effects: Effect[] = [];
  for (const effect of node.effects ?? []) {
    if (effect.visible === false) continue;
    const converted = figEffect(effect);
    if (converted) effects.push(converted);
    else issue(sink, node, nodeId, 'effect-unsupported', `효과 ${effect.type}`);
  }
  return effects;
}

function figEffect(effect: FigEffect): Effect | null {
  if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
    return { type: effect.type === 'DROP_SHADOW' ? 'drop-shadow' : 'inner-shadow', x: effect.offset?.x ?? 0, y: effect.offset?.y ?? 0,
      blur: effect.radius ?? 0, spread: effect.spread ?? 0, color: figColor(effect.color, effect.opacity ?? 1) };
  }
  if (effect.type === 'FOREGROUND_BLUR') return { type: 'layer-blur', radius: effect.radius ?? 0 };
  if (effect.type === 'BACKGROUND_BLUR') return { type: 'background-blur', radius: effect.radius ?? 0 };
  return null;
}

export function fontWeight(style: string | undefined): number {
  if (!style) return 400;
  if (/black|heavy/i.test(style)) return 900;
  if (/extra.?bold/i.test(style)) return 800;
  if (/semi.?bold/i.test(style)) return 600;
  if (/bold/i.test(style)) return 700;
  if (/medium/i.test(style)) return 500;
  if (/extra.?light|thin/i.test(style)) return 200;
  if (/light/i.test(style)) return 300;
  return 400;
}

interface FigUnitValue { value?: number; units?: string }

/** Figma 줄 높이를 px로. RAW는 글자 크기의 배수, PERCENT는 글자 크기의 백분율이다. */
export function lineHeightPx(value: FigUnitValue | undefined, fontSize: number): number | undefined {
  if (!value || value.value === undefined) return undefined;
  if (value.units === 'PIXELS') return round(value.value);
  if (value.units === 'PERCENT') return round((value.value / 100) * fontSize);
  if (value.units === 'RAW') return round(value.value * fontSize);
  return undefined;
}

export function letterSpacingPx(value: FigUnitValue | undefined, fontSize: number): number | undefined {
  if (!value || !value.value) return undefined;
  return round(value.units === 'PERCENT' ? (value.value / 100) * fontSize : value.value);
}

const TEXT_ALIGN: Record<string, TextAlign> = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
const VERTICAL_ALIGN: Record<string, VerticalAlign> = { TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' };

/** 텍스트 도형의 글자 스타일과 구간 스타일. 구간은 characterStyleIDs가 같은 연속 글자를 묶어 styleOverrideTable 값을 적용한다. */
export function figTextStyle(sink: StyleSink, node: FigNode, nodeId: string): Record<string, unknown> {
  const fontSize = node.fontSize ?? 16;
  const lineHeight = lineHeightPx(node.lineHeight as FigUnitValue | undefined, fontSize);
  const letterSpacing = letterSpacingPx(node.letterSpacing as FigUnitValue | undefined, fontSize);
  const spans = figSpans(sink, node, nodeId);
  const base = { text: node.textData?.characters ?? '', fontSize, fontFamily: node.fontName?.family ?? 'Arial', fontWeight: fontWeight(node.fontName?.style) };
  // 이 PC에 없는 글꼴은 Figma가 저장한 글리프 윤곽으로 그린다. 구간 스타일이 있는 텍스트는 윤곽과 구간을 맞출 수 없어 제외한다.
  const missing = !spans.length && sink.fontAvailable && !sink.fontAvailable(base.fontFamily);
  const glyphPath = missing ? figGlyphPath(sink.fig, node) : null;
  return {
    ...base,
    ...(glyphPath ? { glyphs: { key: glyphKey(base), d: glyphPath } } : {}),
    ...(node.textAlignHorizontal && TEXT_ALIGN[node.textAlignHorizontal] !== 'left' ? { textAlign: TEXT_ALIGN[node.textAlignHorizontal] } : {}),
    ...(node.textAlignVertical && VERTICAL_ALIGN[node.textAlignVertical as string] !== 'top' ? { verticalAlign: VERTICAL_ALIGN[node.textAlignVertical as string] } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...(letterSpacing !== undefined ? { letterSpacing } : {}),
    ...(spans.length ? { spans } : {})
  };
}

function figSpans(sink: StyleSink, node: FigNode, nodeId: string): TextSpan[] {
  const textData = (node.textData ?? {}) as { characterStyleIDs?: number[]; styleOverrideTable?: Array<Record<string, any>> };
  const ids: number[] = textData.characterStyleIDs ?? [];
  const table = new Map<number, Record<string, any>>((textData.styleOverrideTable ?? []).map((entry: Record<string, any>) => [entry.styleID as number, entry]));
  const spans: TextSpan[] = [];
  for (let start = 0; start < ids.length;) {
    let end = start;
    while (end < ids.length && ids[end] === ids[start]) end++;
    const style = table.get(ids[start]!);
    if (ids[start] && style) {
      const span = spanStyle(style, sink, node, nodeId);
      if (Object.keys(span).length) spans.push({ start, end, ...span });
    }
    start = end;
  }
  return spans;
}

function spanStyle(style: Record<string, any>, sink: StyleSink, node: FigNode, nodeId: string): Omit<TextSpan, 'start' | 'end'> {
  const color = style.fillPaints ? figPaints(sink, node, nodeId, style.fillPaints).find((paint) => paint.type === 'solid') : undefined;
  if (style.textDecoration) issue(sink, node, nodeId, 'text-approximated', `구간 꾸밈 ${style.textDecoration} 무시`);
  return {
    ...(style.fontSize ? { fontSize: style.fontSize } : {}),
    ...(style.fontName?.style ? { fontWeight: fontWeight(style.fontName.style) } : {}),
    ...(style.fontName?.family ? { fontFamily: style.fontName.family } : {}),
    ...(color && color.type === 'solid' ? { color: color.color } : {})
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
