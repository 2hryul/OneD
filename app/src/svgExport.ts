import { primaryColor, type DesignNode, type Page, type Paint, type Stroke } from './model';
import { worldMatrix } from './geometry';
import { pathToD } from './path';
import { imageFilterCss, withAlpha } from './styleCss';
import { exportBox, layoutText, placeLines } from './canvasRenderer';
import { maskPaths, maskRuns, maskShapes } from './mask';
import { glyphOutline } from './glyphs';

interface SvgOptions {
  /** 이미지 채우기를 넣을 data URL. 없으면 회색 상자로 대신한다. */
  image: (assetId: string) => string | null;
  /** 글 줄나눔을 재는 2D 컨텍스트(캔버스 렌더러와 같은 줄나눔을 쓰기 위해). */
  measure: CanvasRenderingContext2D;
}

/** 속성 값·글 내용을 XML에 넣을 수 있게 바꾼다. 문서 값(이름·색·글)은 외부 입력일 수 있다. */
export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const num = (value: number): string => String(Math.round(value * 1000) / 1000);

class SvgWriter {
  readonly defs: string[] = [];
  private next = 0;
  readonly page: Page;
  readonly options: SvgOptions;
  constructor(page: Page, options: SvgOptions) { this.page = page; this.options = options; }
  id(prefix: string): string { return `${prefix}${++this.next}`; }
}

/**
 * 고른 도형들을 SVG 문서 하나로. 좌표는 페이지 좌표 그대로 두고 viewBox로 내보낼 영역을 정한다.
 * 채우기(단색·선형·원형·이미지), 선(안·가운데·바깥, 점선), 그림자·흐림, 모서리, 프레임 자르기, 투명도, 경로, 글을 옮긴다.
 */
export function nodesToSvg(page: Page, ids: readonly string[], options: SvgOptions): string | null {
  const box = exportBox(page, ids);
  if (!box) return null;
  const writer = new SvgWriter(page, options);
  const body = ids.map((id) => emitNode(writer, id)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(box.width)}" height="${num(box.height)}" viewBox="${num(box.x)} ${num(box.y)} ${num(box.width)} ${num(box.height)}">`
    + (writer.defs.length ? `<defs>${writer.defs.join('')}</defs>` : '') + body + '</svg>';
}

function matrixOf(node: DesignNode): string {
  return `matrix(${worldMatrix(node).map(num).join(' ')})`;
}

function emitNode(writer: SvgWriter, id: string): string {
  const node = writer.page.objects[id];
  if (!node || node.hidden) return '';
  const opacity = node.opacity !== undefined && node.opacity < 1 ? ` opacity="${num(node.opacity)}"` : '';
  let out = `<g${opacity}>` + emitSelf(writer, node);
  if (!node.boolOp && node.children?.length) {
    const children = maskRuns(writer.page, node).map((run) => emitRun(writer, run)).join('');
    if (node.type === 'frame' && node.clipContent !== false) {
      const clip = writer.id('clip');
      writer.defs.push(`<clipPath id="${clip}">${shapeElement(node, '')}</clipPath>`);
      out += `<g clip-path="url(#${clip})">${children}</g>`;
    } else out += children;
  }
  return out + '</g>';
}

/** 마스크 구간 하나. 마스크가 있으면 그 윤곽(마스크 월드 행렬)의 clipPath로 감싸고, 마스크 도형 자신은 그리지 않는다. */
function emitRun(writer: SvgWriter, run: { mask?: DesignNode; ids: string[] }): string {
  const body = run.ids.map((id) => emitNode(writer, id)).join('');
  if (!run.mask) return body;
  const clip = writer.id('mask');
  writer.defs.push(`<clipPath id="${clip}">${maskPaths(maskShapes(run.mask), '', matrixOf(run.mask))}</clipPath>`);
  return `<g clip-path="url(#${clip})">${body}</g>`;
}

/** 도형 모양 요소 하나(지역 좌표 + 월드 행렬). attrs는 채우기·선 등 덧붙일 속성이다. */
function shapeElement(node: DesignNode, attrs: string): string {
  const transform = ` transform="${matrixOf(node)}"`;
  if (node.path) return `<path d="${escapeXml(pathToD(node.path))}"${node.fillRule ? ' fill-rule="evenodd"' : ''}${transform}${attrs}/>`;
  if (node.type === 'ellipse') return `<ellipse cx="${num(node.width / 2)}" cy="${num(node.height / 2)}" rx="${num(node.width / 2)}" ry="${num(node.height / 2)}"${transform}${attrs}/>`;
  const radius = Math.max(0, Math.min(node.radius ?? 0, node.width / 2, node.height / 2));
  return `<rect width="${num(node.width)}" height="${num(node.height)}"${radius ? ` rx="${num(radius)}"` : ''}${transform}${attrs}/>`;
}

function emitSelf(writer: SvgWriter, node: DesignNode): string {
  if (node.type === 'group' && !node.boolOp) return '';
  if (node.type === 'text') return withEffects(writer, node, emitText(writer, node));
  if (node.type === 'vector' && !node.path) return withEffects(writer, node, emitImportedVector(node));
  const fills = node.fills.map((paint) => emitFill(writer, node, paint)).join('');
  return withEffects(writer, node, fills) + (node.strokes ?? []).map((stroke) => emitStroke(writer, node, stroke)).join('');
}

function stops(stopsList: Extract<Paint, { type: 'linear' }>['stops'], alpha: number): string {
  return stopsList.map((stop) => `<stop offset="${num(Math.min(1, Math.max(0, stop.offset)))}" stop-color="${escapeXml(withAlpha(stop.color, alpha))}"/>`).join('');
}

/** 채우기 하나. 그라디언트는 도형 지역 좌표(userSpaceOnUse)로 두어 도형 변환을 그대로 따른다. */
function emitFill(writer: SvgWriter, node: DesignNode, paint: Paint): string {
  const alpha = paint.opacity ?? 1;
  if (paint.type === 'solid') return shapeElement(node, ` fill="${escapeXml(withAlpha(paint.color, alpha))}"`);
  if (paint.type === 'linear') {
    const id = writer.id('grad');
    writer.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(paint.from.x * node.width)}" y1="${num(paint.from.y * node.height)}" x2="${num(paint.to.x * node.width)}" y2="${num(paint.to.y * node.height)}">${stops(paint.stops, alpha)}</linearGradient>`);
    return shapeElement(node, ` fill="url(#${id})"`);
  }
  if (paint.type === 'radial') {
    const id = writer.id('grad');
    writer.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${num(paint.center.x * node.width)} ${num(paint.center.y * node.height)}) scale(${num(Math.max(0.001, paint.radius.x * node.width))} ${num(Math.max(0.001, paint.radius.y * node.height))})">${stops(paint.stops, alpha)}</radialGradient>`);
    return shapeElement(node, ` fill="url(#${id})"`);
  }
  const href = writer.options.image(paint.assetId);
  if (!href) return shapeElement(node, ' fill="#e6e8ee"');
  const clip = writer.id('clip');
  writer.defs.push(`<clipPath id="${clip}">${shapeElement(node, '')}</clipPath>`);
  const aspect = paint.fit === 'fill' ? 'xMidYMid slice' : paint.fit === 'fit' ? 'xMidYMid meet' : 'none';
  // 색 보정은 CSS filter로 건다(숫자만 든 값이라 그대로 넣어도 안전하다).
  const filter = imageFilterCss(paint.adjust);
  return `<g clip-path="url(#${clip})"><image href="${escapeXml(href)}" width="${num(node.width)}" height="${num(node.height)}" preserveAspectRatio="${aspect}" transform="${matrixOf(node)}"${alpha < 1 ? ` opacity="${num(alpha)}"` : ''}${filter ? ` style="filter: ${filter}"` : ''}/></g>`;
}

/** 선. 안쪽 선은 모양으로 자르고, 바깥 선은 모양을 가린 마스크로 두 배 굵기를 그려 정렬을 맞춘다. 경로는 늘 가운데 선이다. */
function emitStroke(writer: SvgWriter, node: DesignNode, stroke: Stroke): string {
  if (stroke.width <= 0) return '';
  const align = node.path ? 'center' : stroke.align;
  const dash = stroke.dash?.length ? ` stroke-dasharray="${stroke.dash.map(num).join(' ')}"` : '';
  const attrs = ` fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${num(align === 'center' ? stroke.width : stroke.width * 2)}"${dash}`;
  if (align === 'center') return shapeElement(node, attrs);
  if (align === 'inside') {
    const clip = writer.id('clip');
    writer.defs.push(`<clipPath id="${clip}">${shapeElement(node, '')}</clipPath>`);
    return `<g clip-path="url(#${clip})">${shapeElement(node, attrs)}</g>`;
  }
  const mask = writer.id('mask');
  writer.defs.push(`<mask id="${mask}" maskUnits="userSpaceOnUse" x="-1e6" y="-1e6" width="2e6" height="2e6"><rect x="-1e6" y="-1e6" width="2e6" height="2e6" fill="#fff"/>${shapeElement(node, ' fill="#000"')}</mask>`);
  return `<g mask="url(#${mask})">${shapeElement(node, attrs)}</g>`;
}

/** 그림자·레이어 흐림을 필터로 묶는다. 효과가 없으면 그대로 둔다. 안쪽 그림자·배경 흐림은 옮기지 않는다. */
function withEffects(writer: SvgWriter, node: DesignNode, content: string): string {
  const parts = (node.effects ?? []).map((effect) => {
    if (effect.type === 'drop-shadow') return `<feDropShadow dx="${num(effect.x)}" dy="${num(effect.y)}" stdDeviation="${num(effect.blur / 2)}" flood-color="${escapeXml(effect.color)}"/>`;
    if (effect.type === 'layer-blur') return `<feGaussianBlur stdDeviation="${num(effect.radius / 2)}"/>`;
    return '';
  }).filter(Boolean);
  if (!content || parts.length === 0) return content;
  const id = writer.id('fx');
  writer.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts.join('')}</filter>`);
  return `<g filter="url(#${id})">${content}</g>`;
}

/** 가져온 벡터: 경로마다 원래 좌표계(viewBox)에서 도형 크기로 늘린다. */
function emitImportedVector(node: DesignNode): string {
  const view = node.viewBox ?? { width: node.width, height: node.height };
  const scale = `scale(${num(node.width / (view.width || 1))} ${num(node.height / (view.height || 1))})`;
  return (node.vectorPaths ?? []).map((item) => `<path d="${escapeXml(item.d)}" transform="${matrixOf(node)} ${scale}" fill="${escapeXml(item.fill || 'none')}"${item.fillRule ? ' fill-rule="evenodd"' : ''}${item.stroke ? ` stroke="${escapeXml(item.stroke)}" stroke-width="${num(item.strokeWidth ?? 1)}" vector-effect="non-scaling-stroke"` : ''}/>`).join('');
}

function runsOf(pieces: ReadonlyArray<{ text: string; font: string; color: string; x: number }>): Array<{ text: string; font: string; color: string; x: number }> {
  const runs: Array<{ text: string; font: string; color: string; x: number }> = [];
  for (const piece of pieces) {
    const last = runs[runs.length - 1];
    if (last && last.font === piece.font && last.color === piece.color) last.text += piece.text;
    else runs.push({ ...piece });
  }
  return runs;
}

/** 글. 캔버스 렌더러와 같은 줄나눔·정렬로 조각마다 text 요소를 둔다(글꼴이 없는 곳에서도 위치가 같도록 x를 직접 준다). */
function emitText(writer: SvgWriter, node: DesignNode): string {
  // 글꼴이 없으면 글리프 윤곽 경로로 낸다. SVG를 여는 쪽에도 글꼴이 없을 가능성이 크고, 윤곽이면 어디서나 같은 모양이다.
  const outline = glyphOutline(node);
  if (outline) return `<g transform="${matrixOf(node)}"><path d="${escapeXml(outline)}" fill="${escapeXml(primaryColor(node, '#17223a'))}"/></g>`;
  const placed = placeLines(node, layoutText(writer.options.measure, node));
  const spacing = node.letterSpacing ? ` letter-spacing="${num(node.letterSpacing)}"` : '';
  // 한 줄에서 글꼴·색이 같은 조각(공백 포함)은 text 하나로 합친다. 줄 끝 공백은 뺀다.
  const pieces = placed.flatMap(({ line, x, baseline }) => runsOf(line.pieces).filter((run) => run.text.trim()).map((run) =>
    `<text x="${num(x + run.x)}" y="${num(baseline)}" style="font:${escapeXml(run.font)}" fill="${escapeXml(run.color)}"${spacing} xml:space="preserve">${escapeXml(run.text.trimEnd())}</text>`));
  return pieces.length ? `<g transform="${matrixOf(node)}">${pieces.join('')}</g>` : '';
}
