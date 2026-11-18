import { primaryColor, type DesignNode, type Matrix, type Page, type Paint } from './model';
import { boundsOf, multiply, worldCorners, worldMatrix, type Rect } from './geometry';
import { pathToD } from './path';
import { DEFAULT_FONT_STACK, fontStack, textRuns, withAlpha } from './styleCss';

/** 화면 상태. pan은 화면 픽셀, zoom은 배율, dpr은 장치 픽셀 비율이다. */
export interface View { panX: number; panY: number; zoom: number; width: number; height: number; dpr: number }

/** 이미지 채우기용. 아직 안 읽힌 이미지는 null을 돌려주고, 읽히면 다시 그린다. */
export type ImageSource = (assetId: string) => CanvasImageSource | null;

/** stale: 확대 중이라 이전 배율의 프레임 그림을 늘려 그린 곳이 있다(잠시 뒤 선명하게 다시 그려야 한다). cached: 그림을 다시 쓴 프레임 수. */
export interface DrawStats { drawn: number; culled: number; ms: number; cached: number; stale: boolean }

interface CacheEntry { zoom: number; dpr: number; nodes: DesignNode[]; canvas: HTMLCanvasElement; box: Rect; used: number }

/** 이 크기(장치 픽셀 수)보다 큰 프레임은 그림으로 보관하지 않고 바로 그린다(메모리 한도). */
const MAX_CACHE_PIXELS = 4_000_000;
const MAX_CACHE_ENTRIES = 400;

/**
 * 최상위 프레임 그림 보관소(타일 렌더러). 프레임 하위 노드 객체가 모두 그대로이고 배율이 같으면 보관한 그림을 복사만 한다.
 * applyChanges는 바뀐 노드만 새 객체로 만들므로 객체 비교만으로 바뀜을 안다.
 */
export class FrameCache {
  readonly entries = new Map<string, CacheEntry>();
  private frame = 0;
  /** 이미지가 새로 읽히는 등 그림이 달라질 수 있을 때 모두 버린다. */
  clear(): void { this.entries.clear(); }
  tick(): number { return ++this.frame; }
  /** 오래 안 쓴 그림부터 버려 개수를 제한한다. */
  trim(): void {
    if (this.entries.size <= MAX_CACHE_ENTRIES) return;
    const oldest = [...this.entries].sort((a, b) => a[1].used - b[1].used).slice(0, this.entries.size - MAX_CACHE_ENTRIES);
    for (const [id] of oldest) this.entries.delete(id);
  }
}

/** 화면에서 이보다 작은 도형은 그리지 않는다(축소 화면에서 수만 개의 점을 그리지 않기 위해). */
const MIN_PIXELS = 0.5;
/** 글자가 화면에서 이보다 작으면 글 대신 줄 모양 막대를 그린다(Figma의 축소 표시와 같음). */
const GREEK_PIXELS = 3;

/**
 * 페이지를 Canvas 2D로 그린다. DOM 렌더러와 같은 모양을 목표로 하며(채우기·그라디언트·이미지·선·그림자·흐림·모서리·자르기·텍스트·경로),
 * 보이는 영역 밖과 화면에서 너무 작은 도형은 건너뛴다. skipId(편집 중인 텍스트)는 그리지 않는다.
 */
export function drawPage(ctx: CanvasRenderingContext2D, page: Page, view: View, images: ImageSource, skipId: string | null, cache?: { store: FrameCache; allowStale: boolean }): DrawStats {
  const start = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, view.width * view.dpr, view.height * view.dpr);
  const base: Matrix = [view.zoom * view.dpr, 0, 0, view.zoom * view.dpr, view.panX * view.dpr, view.panY * view.dpr];
  const visible: Rect = { x: -view.panX / view.zoom, y: -view.panY / view.zoom, width: view.width / view.zoom, height: view.height / view.zoom };
  const state: DrawState = { ctx, page, base, visible, zoom: view.zoom, scale: view.zoom * view.dpr, images, skipId, stats: { drawn: 0, culled: 0, ms: 0, cached: 0, stale: false } };
  const frame = cache?.store.tick() ?? 0;
  for (const id of page.children) {
    if (cache && drawCachedFrame(state, view, id, cache.store, cache.allowStale, frame)) continue;
    drawNode(state, id, 1);
  }
  cache?.store.trim();
  drawFrameTitles(state, view);
  state.stats.ms = performance.now() - start;
  return state.stats;
}

/** 내보낼 영역(페이지 좌표). 고른 도형 상자를 합치고 그림자·흐림이 번지는 만큼 넓힌다. */
export function exportBox(page: Page, ids: readonly string[]): Rect | null {
  const nodes = ids.map((id) => page.objects[id]).filter((node): node is DesignNode => Boolean(node && !node.hidden));
  if (nodes.length === 0) return null;
  const boxes = nodes.map((node) => { const box = boundsOf(worldCorners(node)); const margin = shadowMargin(node); return { x: box.x - margin, y: box.y - margin, width: box.width + margin * 2, height: box.height + margin * 2 }; });
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
}

/**
 * 고른 도형들을 그림 하나에 그린다(PNG 내보내기). 캔버스 렌더러와 같은 그리기를 쓰므로 화면과 같은 모양이 나온다.
 * 부모의 자르기·투명도는 적용하지 않는다(Figma 내보내기와 같음).
 */
export function renderNodes(ctx: CanvasRenderingContext2D, page: Page, ids: readonly string[], box: Rect, scale: number, images: ImageSource): void {
  const state: DrawState = { ctx, page, base: [scale, 0, 0, scale, -box.x * scale, -box.y * scale], visible: box, zoom: scale, scale, images, skipId: null, stats: { drawn: 0, culled: 0, ms: 0, cached: 0, stale: false } };
  for (const id of ids) drawNode(state, id, 1);
}

interface DrawState { ctx: CanvasRenderingContext2D; page: Page; base: Matrix; visible: Rect; zoom: number; scale: number; images: ImageSource; skipId: string | null; stats: DrawStats }

function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** 프레임이 내용을 자르는지. 자르는 프레임은 화면 밖이면 자식까지 통째로 건너뛸 수 있다. */
function clips(node: DesignNode): boolean {
  return node.type === 'frame' && node.clipContent !== false;
}

function drawNode(state: DrawState, id: string, alpha: number): void {
  const node = state.page.objects[id];
  if (!node || node.hidden) return;
  const bounds = boundsOf(worldCorners(node));
  const offscreen = !intersects(bounds, state.visible);
  const tiny = Math.max(bounds.width, bounds.height) * state.zoom < MIN_PIXELS;
  // 자르지 않는 컨테이너는 자식이 상자 밖에 있을 수 있어 자식은 따로 판단한다.
  if ((offscreen || tiny) && (clips(node) || !node.children?.length || node.boolOp)) { state.stats.culled++; return; }
  const { ctx } = state;
  ctx.save();
  const opacity = alpha * (node.opacity ?? 1);
  ctx.globalAlpha = opacity;
  ctx.setTransform(...multiply(state.base, worldMatrix(node)));
  if (!offscreen && !tiny && node.id !== state.skipId) { drawSelf(state, node); state.stats.drawn++; }
  if (!node.boolOp && node.children?.length) {
    if (clips(node)) { ctx.setTransform(...multiply(state.base, worldMatrix(node))); ctx.beginPath(); roundRect(ctx, node); ctx.clip(); }
    for (const child of node.children) drawNode(state, child, opacity);
  }
  ctx.restore();
}

/** 하위 노드 객체 목록(그리는 순서). 보관한 그림이 아직 맞는지 객체 비교로 확인하는 데 쓴다. */
function subtreeNodes(page: Page, id: string, out: DesignNode[] = []): DesignNode[] {
  const node = page.objects[id];
  if (!node) return out;
  out.push(node);
  for (const child of node.children ?? []) subtreeNodes(page, child, out);
  return out;
}

function sameNodes(a: readonly DesignNode[], b: readonly DesignNode[]): boolean {
  return a.length === b.length && a.every((node, index) => node === b[index]);
}

/** 프레임 자신의 그림자가 상자 밖으로 번지는 거리. 자식은 프레임이 자르므로 프레임 효과만 본다. */
export function shadowMargin(node: DesignNode): number {
  return (node.effects ?? []).reduce((margin, effect) => effect.type === 'drop-shadow' ? Math.max(margin, Math.abs(effect.x) + Math.abs(effect.y) + effect.blur * 2 + effect.spread) : effect.type === 'layer-blur' ? Math.max(margin, effect.radius * 2) : margin, 0);
}

/**
 * 내용을 자르는 최상위 프레임을 보관한 그림으로 그린다. 그림이 없거나 하위가 바뀌었으면 새로 그려 보관한다.
 * 확대 중(allowStale)에는 배율이 다른 그림을 늘려 쓰고 stale로 알린다. 처리하지 않았으면 false(그냥 그린다).
 */
function drawCachedFrame(state: DrawState, view: View, id: string, store: FrameCache, allowStale: boolean, frame: number): boolean {
  const node = state.page.objects[id];
  if (!node || node.hidden || !clips(node)) return false;
  const bounds = boundsOf(worldCorners(node));
  const margin = shadowMargin(node);
  const box = { x: bounds.x - margin, y: bounds.y - margin, width: bounds.width + margin * 2, height: bounds.height + margin * 2 };
  if (!intersects(box, state.visible)) { state.stats.culled++; return true; }
  if (box.width * box.height * state.scale * state.scale > MAX_CACHE_PIXELS) return false;
  const nodes = subtreeNodes(state.page, id);
  if (state.skipId && nodes.some((item) => item.id === state.skipId)) return false;
  let entry = store.entries.get(id);
  const valid = entry && entry.dpr === view.dpr && sameNodes(entry.nodes, nodes);
  if (!valid || (entry!.zoom !== state.zoom && !allowStale)) entry = renderFrame(state, view, id, nodes, box, store);
  else if (entry!.zoom !== state.zoom) state.stats.stale = true;
  else state.stats.cached++;
  entry!.used = frame;
  const { ctx } = state;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // 정수 장치 픽셀에 놓아 화면 이동 때 그림이 흐려지지 않게 한다.
  ctx.drawImage(entry!.canvas, Math.round((entry!.box.x * state.zoom + view.panX) * view.dpr), Math.round((entry!.box.y * state.zoom + view.panY) * view.dpr), entry!.box.width * state.scale, entry!.box.height * state.scale);
  ctx.restore();
  return true;
}

function renderFrame(state: DrawState, view: View, id: string, nodes: DesignNode[], box: Rect, store: FrameCache): CacheEntry {
  const canvas = store.entries.get(id)?.canvas ?? document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(box.width * state.scale));
  canvas.height = Math.max(1, Math.ceil(box.height * state.scale));
  const ctx = canvas.getContext('2d')!;
  const sub: DrawState = { ...state, ctx, base: [state.scale, 0, 0, state.scale, -box.x * state.scale, -box.y * state.scale], visible: box };
  drawNode(sub, id, 1);
  const entry: CacheEntry = { zoom: state.zoom, dpr: view.dpr, nodes, canvas, box, used: 0 };
  store.entries.set(id, entry);
  return entry;
}

function drawSelf(state: DrawState, node: DesignNode): void {
  if (node.type === 'text') { drawText(state, node); return; }
  if (node.type === 'group' && !node.boolOp) return;
  const shape = shapePath(node);
  if (!shape) { if (node.type === 'vector') drawImportedVector(state, node); return; }
  withEffects(state, node, shape, () => {
    for (const paint of node.fills) fillPaint(state, node, shape, paint);
  });
  drawStrokes(state, node, shape);
}

const pathCache = new WeakMap<DesignNode, Path2D>();

/** 도형 지역 좌표의 윤곽. 가져온 벡터(vectorPaths)는 여러 경로라 따로 그린다(null). */
function shapePath(node: DesignNode): Path2D | null {
  const cached = pathCache.get(node);
  if (cached) return cached;
  let path: Path2D | null = null;
  if (node.path) path = new Path2D(pathToD(node.path));
  else if (node.type === 'ellipse') { path = new Path2D(); path.ellipse(node.width / 2, node.height / 2, node.width / 2, node.height / 2, 0, 0, Math.PI * 2); }
  else if (node.type !== 'vector') { path = new Path2D(); roundRect(path, node); }
  if (path) pathCache.set(node, path);
  return path;
}

function roundRect(target: CanvasRenderingContext2D | Path2D, node: DesignNode): void {
  const radius = Math.max(0, Math.min(node.radius ?? 0, node.width / 2, node.height / 2));
  if (radius > 0) target.roundRect(0, 0, node.width, node.height, radius);
  else target.rect(0, 0, node.width, node.height);
}

function fillRuleOf(node: DesignNode): CanvasFillRule {
  return node.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
}

/** 그림자·레이어 흐림을 켠 채 draw를 부르고, 안쪽 그림자는 모양 안에 따로 그린다. 그림자 거리는 장치 픽셀이라 배율을 곱한다. */
function withEffects(state: DrawState, node: DesignNode, shape: Path2D, draw: () => void): void {
  const { ctx, scale } = state;
  const effects = node.effects ?? [];
  const blur = effects.find((effect) => effect.type === 'layer-blur');
  const shadow = effects.find((effect) => effect.type === 'drop-shadow');
  ctx.save();
  if (blur && blur.type === 'layer-blur') ctx.filter = `blur(${(blur.radius / 2) * scale}px)`;
  if (shadow && shadow.type === 'drop-shadow') {
    ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur * scale; ctx.shadowOffsetX = shadow.x * scale; ctx.shadowOffsetY = shadow.y * scale;
  }
  draw();
  ctx.restore();
  for (const effect of effects) {
    if (effect.type !== 'inner-shadow') continue;
    // 모양 안쪽만 남기고, 바깥(큰 사각형 - 모양)을 그림자를 켠 채 칠해 그림자만 안으로 들어오게 한다.
    ctx.save();
    ctx.clip(shape, fillRuleOf(node));
    ctx.shadowColor = effect.color; ctx.shadowBlur = effect.blur * scale; ctx.shadowOffsetX = effect.x * scale; ctx.shadowOffsetY = effect.y * scale;
    const outside = new Path2D();
    outside.rect(-node.width * 2 - 100, -node.height * 2 - 100, node.width * 5 + 200, node.height * 5 + 200);
    outside.addPath(shape);
    ctx.fillStyle = '#000';
    ctx.fill(outside, 'evenodd');
    ctx.restore();
  }
}

/** 채우기 하나. 그라디언트 점은 상자 비율 좌표(Figma 핸들)를 그대로 쓴다. */
function fillPaint(state: DrawState, node: DesignNode, shape: Path2D, paint: Paint): void {
  const { ctx } = state;
  const alpha = paint.opacity ?? 1;
  if (paint.type === 'image') { drawImage(state, node, shape, paint); return; }
  if (paint.type === 'solid') ctx.fillStyle = withAlpha(paint.color, alpha);
  else if (paint.type === 'linear') {
    const gradient = ctx.createLinearGradient(paint.from.x * node.width, paint.from.y * node.height, paint.to.x * node.width, paint.to.y * node.height);
    paint.stops.forEach((stop) => gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), withAlpha(stop.color, alpha)));
    ctx.fillStyle = gradient;
  } else {
    // 원형 그라디언트는 가로·세로 반지름이 달라 단위 원을 늘려서 그린다.
    ctx.save();
    ctx.clip(shape, fillRuleOf(node));
    ctx.translate(paint.center.x * node.width, paint.center.y * node.height);
    ctx.scale(Math.max(0.001, paint.radius.x * node.width), Math.max(0.001, paint.radius.y * node.height));
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    paint.stops.forEach((stop) => gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), withAlpha(stop.color, alpha)));
    ctx.fillStyle = gradient;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
    return;
  }
  ctx.fill(shape, fillRuleOf(node));
}

function drawImage(state: DrawState, node: DesignNode, shape: Path2D, paint: Extract<Paint, { type: 'image' }>): void {
  const { ctx } = state;
  const image = state.images(paint.assetId);
  ctx.save();
  ctx.clip(shape, fillRuleOf(node));
  if (!image) { ctx.fillStyle = '#e6e8ee'; ctx.fillRect(0, 0, node.width, node.height); ctx.restore(); return; }
  ctx.globalAlpha *= paint.opacity ?? 1;
  const iw = (image as HTMLImageElement).naturalWidth || node.width;
  const ih = (image as HTMLImageElement).naturalHeight || node.height;
  if (paint.fit === 'tile') {
    const pattern = ctx.createPattern(image, 'repeat');
    if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(0, 0, node.width, node.height); }
  } else if (paint.fit === 'stretch') ctx.drawImage(image, 0, 0, node.width, node.height);
  else {
    // fill은 cover(잘라서 채움), fit은 contain(다 보이게)이다.
    const scale = paint.fit === 'fill' ? Math.max(node.width / iw, node.height / ih) : Math.min(node.width / iw, node.height / ih);
    ctx.drawImage(image, (node.width - iw * scale) / 2, (node.height - ih * scale) / 2, iw * scale, ih * scale);
  }
  ctx.restore();
}

/** 선. 안쪽 선은 모양으로 자르고 두 배 굵기로, 바깥 선은 모양 밖으로 자르고 두 배 굵기로 그린다. */
function drawStrokes(state: DrawState, node: DesignNode, shape: Path2D): void {
  const { ctx } = state;
  for (const stroke of node.strokes ?? []) {
    if (stroke.width <= 0) continue;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.setLineDash(stroke.dash ?? []);
    // 경로(벡터·불리언)는 SVG처럼 늘 가운데 선이다(DOM 렌더러와 같게).
    const align = node.path ? 'center' : stroke.align;
    if (align === 'inside') ctx.clip(shape, fillRuleOf(node));
    if (align === 'outside') {
      const outside = new Path2D();
      outside.rect(-stroke.width * 4, -stroke.width * 4, node.width + stroke.width * 8, node.height + stroke.width * 8);
      outside.addPath(shape);
      ctx.clip(outside, 'evenodd');
    }
    ctx.lineWidth = align === 'center' ? stroke.width : stroke.width * 2;
    ctx.stroke(shape);
    ctx.restore();
  }
}

/** 가져온 벡터(여러 SVG 경로)를 원래 좌표계(viewBox)에서 도형 크기로 늘려 그린다. 선 굵기는 늘리지 않는다. */
function drawImportedVector(state: DrawState, node: DesignNode): void {
  const { ctx } = state;
  const view = node.viewBox ?? { width: node.width, height: node.height };
  const sx = node.width / (view.width || 1);
  const sy = node.height / (view.height || 1);
  for (const item of node.vectorPaths ?? []) {
    const path = new Path2D();
    path.addPath(new Path2D(item.d), new DOMMatrix([sx, 0, 0, sy, 0, 0]));
    if (item.fill && item.fill !== 'none') { ctx.fillStyle = item.fill; ctx.fill(path, item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); }
    if (item.stroke) { ctx.strokeStyle = item.stroke; ctx.lineWidth = item.strokeWidth ?? 1; ctx.stroke(path); }
  }
}

/** 최상위 프레임 이름표 높이(화면 픽셀). DOM 렌더러의 .frame-title과 같은 크기다. */
export const TITLE_HEIGHT = 16;

/** 최상위 프레임 이름표를 화면 좌표로 그린다(확대율과 상관없이 같은 크기). 프레임 너비보다 긴 이름은 자른다. */
function drawFrameTitles(state: DrawState, view: View): void {
  const { ctx, page } = state;
  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.font = `600 11px ${DEFAULT_FONT_STACK}`;
  ctx.fillStyle = '#ced5ff';
  ctx.textBaseline = 'bottom';
  for (const id of page.children) {
    const frame = page.objects[id];
    if (frame?.type !== 'frame' || frame.hidden) continue;
    const bounds = boundsOf(worldCorners(frame));
    const x = bounds.x * view.zoom + view.panX;
    const y = bounds.y * view.zoom + view.panY;
    const width = bounds.width * view.zoom;
    if (x > view.width || y < 0 || y - TITLE_HEIGHT > view.height || x + width < 0 || width < 12) continue;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y - TITLE_HEIGHT, width, TITLE_HEIGHT); ctx.clip();
    ctx.fillText(frame.name, x, y - 4);
    ctx.restore();
  }
  ctx.restore();
}

export interface TextPiece { text: string; font: string; color: string; x: number; width: number }
export interface TextLine { pieces: TextPiece[]; width: number; height: number; ascent: number; descent: number }

const textCache = new WeakMap<DesignNode, TextLine[]>();

function fontOf(node: DesignNode, span?: NonNullable<DesignNode['spans']>[number]): { font: string; size: number; color: string } {
  const size = span?.fontSize ?? node.fontSize ?? 18;
  return { font: `${span?.fontWeight ?? node.fontWeight ?? 400} ${size}px ${fontStack(span?.fontFamily ?? node.fontFamily)}`, size, color: span?.color ?? primaryColor(node, '#17223a') };
}

/**
 * 글을 상자 너비에 맞춰 줄로 나눈다(CSS pre-wrap과 같게 공백을 지키고 단어 단위로 줄바꿈, \n은 강제 줄바꿈).
 * 노드 객체마다 결과를 보관해, 글을 고치지 않으면 다시 재지 않는다.
 */
export function layoutText(ctx: CanvasRenderingContext2D, node: DesignNode): TextLine[] {
  const cached = textCache.get(node);
  if (cached) return cached;
  ctx.save();
  ctx.letterSpacing = `${node.letterSpacing ?? 0}px`;
  const lines: TextLine[] = [];
  let line: TextLine = { pieces: [], width: 0, height: 0, ascent: 0, descent: 0 };
  const push = (): void => { lines.push(line); line = { pieces: [], width: 0, height: 0, ascent: 0, descent: 0 }; };
  for (const run of textRuns(node)) {
    const style = fontOf(node, run.span);
    ctx.font = style.font;
    const metrics = ctx.measureText('Hg');
    const height = node.lineHeight ?? style.size * 1.15;
    for (const token of run.text.split(/(\n|\s+)/).filter((part) => part.length > 0)) {
      if (token === '\n') { line.height ||= height; push(); continue; }
      const width = ctx.measureText(token).width;
      if (line.pieces.length && !/^\s+$/.test(token) && line.width + width > node.width + 0.5) push();
      if (/^\s+$/.test(token) && line.pieces.length === 0 && lines.length > 0) continue;
      line.pieces.push({ text: token, font: style.font, color: style.color, x: line.width, width });
      line.width += width;
      line.height = Math.max(line.height, height);
      line.ascent = Math.max(line.ascent, metrics.fontBoundingBoxAscent);
      line.descent = Math.max(line.descent, metrics.fontBoundingBoxDescent);
    }
  }
  if (line.pieces.length || lines.length === 0) { line.height ||= node.lineHeight ?? (node.fontSize ?? 18) * 1.15; push(); }
  ctx.restore();
  textCache.set(node, lines);
  return lines;
}

/** 줄마다 위치(도형 지역 좌표): 가로 정렬로 정한 시작 x, 줄 위쪽 y, 글자 기준선 y. 캔버스 그리기와 SVG 내보내기가 같이 쓴다. */
export function placeLines(node: DesignNode, lines: readonly TextLine[]): Array<{ line: TextLine; x: number; top: number; baseline: number }> {
  const total = lines.reduce((sum, line) => sum + line.height, 0);
  let top = node.verticalAlign === 'middle' ? (node.height - total) / 2 : node.verticalAlign === 'bottom' ? node.height - total : 0;
  return lines.map((line) => {
    const x = node.textAlign === 'center' ? (node.width - line.width) / 2 : node.textAlign === 'right' ? node.width - line.width : 0;
    const placed = { line, x, top, baseline: top + (line.height - (line.ascent + line.descent)) / 2 + line.ascent };
    top += line.height;
    return placed;
  });
}

/** 텍스트. 상자로 자르고, 세로 정렬과 가로 정렬을 DOM과 같게 한다. 화면에서 너무 작으면 막대로 대신한다. */
function drawText(state: DrawState, node: DesignNode): void {
  const { ctx } = state;
  const greek = (node.fontSize ?? 18) * state.zoom < GREEK_PIXELS;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, node.width, node.height); ctx.clip();
  ctx.letterSpacing = `${node.letterSpacing ?? 0}px`;
  ctx.textBaseline = 'alphabetic';
  for (const { line, x, top, baseline } of placeLines(node, layoutText(ctx, node))) {
    for (const piece of line.pieces) {
      ctx.fillStyle = piece.color;
      if (greek) { if (piece.text.trim()) { ctx.globalAlpha *= 0.35; ctx.fillRect(x + piece.x, top + line.height * 0.3, piece.width, line.height * 0.4); ctx.globalAlpha /= 0.35; } continue; }
      ctx.font = piece.font;
      ctx.fillText(piece.text, x + piece.x, baseline);
    }
  }
  ctx.restore();
}
