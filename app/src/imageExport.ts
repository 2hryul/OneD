import type { Page } from './model';
import { exportBox, renderNodes } from './canvasRenderer';
import { nodesToSvg } from './svgExport';
import { bytesToBase64, getAssets } from './assets';

export type ImageFormat = 'png' | 'svg';

/** 브라우저 캔버스 한도 안쪽. 이보다 크면 배율을 낮추라고 알린다. */
const MAX_SIDE = 16_384;
const MAX_PIXELS = 120_000_000;

/** 고른 도형(하위 포함)이 쓰는 이미지 id. */
function assetIdsOf(page: Page, ids: readonly string[]): string[] {
  const found = new Set<string>();
  const visit = (id: string): void => {
    const node = page.objects[id];
    if (!node) return;
    for (const paint of node.fills) if (paint.type === 'image') found.add(paint.assetId);
    node.children?.forEach(visit);
  };
  ids.forEach(visit);
  return [...found];
}

/** 이미지를 IndexedDB에서 읽어 data URL로. SVG에 그대로 넣고 PNG 그리기에도 쓴다. 없는 이미지는 빠진다. */
async function loadDataUrls(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const records = await getAssets(ids);
  return new Map(records.map((record) => [record.id, `data:${record.mime};base64,${bytesToBase64(record.bytes)}`] as const));
}

async function loadImages(urls: Map<string, string>): Promise<Map<string, HTMLImageElement>> {
  const entries = await Promise.all([...urls].map(async ([id, url]) => {
    const image = new Image();
    image.src = url;
    try { await image.decode(); return [id, image] as const; } catch { return null; }
  }));
  return new Map(entries.filter((entry): entry is readonly [string, HTMLImageElement] => entry !== null));
}

/**
 * 고른 도형들을 PNG(배율 1·2·3배) 또는 SVG 파일 내용으로 만든다. 그림 영역은 도형 상자와 그림자를 합친 곳이다.
 * @param scale PNG 배율(SVG는 쓰지 않음)
 */
export async function exportImage(page: Page, ids: readonly string[], format: ImageFormat, scale: number): Promise<Blob> {
  const box = exportBox(page, ids);
  if (!box) throw new Error('[exportImage] 내보낼 요소가 없습니다(숨긴 요소는 내보내지 않습니다).');
  const urls = await loadDataUrls(assetIdsOf(page, ids));
  if (format === 'svg') {
    const measure = document.createElement('canvas').getContext('2d')!;
    const svg = nodesToSvg(page, ids, { image: (id) => urls.get(id) ?? null, measure })!;
    return new Blob([svg], { type: 'image/svg+xml' });
  }
  const width = Math.ceil(box.width * scale);
  const height = Math.ceil(box.height * scale);
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) throw new Error(`[exportImage] 그림이 너무 큽니다(${width}×${height}px). 배율을 낮추거나 더 작게 고르세요.`);
  const images = await loadImages(urls);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  renderNodes(canvas.getContext('2d')!, page, ids, box, scale, (id) => images.get(id) ?? null);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('[exportImage] PNG를 만들지 못했습니다.'))), 'image/png'));
}

/** Windows 파일 이름에 쓸 수 없는 글자(\\ / : * ? " < > |)와 제어 문자를 바꾸고 길이를 줄인다. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 80);
  return cleaned || 'export';
}
