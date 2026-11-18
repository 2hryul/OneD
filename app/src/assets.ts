/**
 * 이미지 바이트 저장소. 문서에는 assetId(내용 해시)만 두고 바이트는 IndexedDB에 둔다.
 * localStorage는 약 5MB라 이미지가 들어간 문서를 담지 못하기 때문이다.
 * JSON 저장 파일에는 바이트를 base64로 함께 넣어 다른 브라우저에서도 열 수 있게 한다.
 */
const DB_NAME = 'canvas-studio-assets';
const STORE = 'assets';

export interface AssetRecord { id: string; mime: string; bytes: Uint8Array }

/** 파일 앞부분 서명으로 이미지 형식을 판별한다. 모르는 형식이면 null. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]): boolean => signature.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  if (bytes.length > 4 && new TextDecoder().decode(bytes.slice(0, 256)).includes('<svg')) return 'image/svg+xml';
  return null;
}

const DEFAULT_SVG_SIZE = { width: 100, height: 100 };

/** SVG 길이 속성을 px 숫자로 읽는다. 단위 없음과 px만 받고, %·em처럼 주변에 따라 바뀌는 길이는 null. */
function svgLength(value: string | undefined): number | null {
  const match = value?.trim().match(/^([0-9]*\.?[0-9]+)(px)?$/);
  const number = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * SVG 문서가 스스로 정한 크기. 루트 <svg>의 width·height를 먼저 보고, 없으면 viewBox 크기를 쓴다.
 * 둘 다 없으면 null. 브라우저마다 크기 없는 SVG의 기본값(150×150 등)이 달라서 직접 읽는다.
 */
export function svgIntrinsicSize(text: string): { width: number; height: number } | null {
  const tag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const attr = (name: string): string | undefined => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const boxSize = box && box.length === 4 && box[2]! > 0 && box[3]! > 0 ? { width: box[2]!, height: box[3]! } : null;
  const width = svgLength(attr('width'));
  const height = svgLength(attr('height'));
  if (width && height) return { width, height };
  // 한쪽만 있으면 viewBox 비율로 나머지를 정한다(브라우저와 같은 규칙).
  if (boxSize && width) return { width, height: (width * boxSize.height) / boxSize.width };
  if (boxSize && height) return { width: (height * boxSize.width) / boxSize.height, height };
  return boxSize;
}

/**
 * 그림의 원래 크기(px). Chromium의 createImageBitmap은 SVG를 해석하지 못해("The source image could not be decoded")
 * SVG는 문서의 width·height·viewBox에서 읽고, 크기를 정하지 않은 SVG는 100×100으로 둔다.
 */
export async function readImageSize(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number }> {
  if (mime === 'image/svg+xml') return svgIntrinsicSize(new TextDecoder().decode(bytes)) ?? DEFAULT_SVG_SIZE;
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as ArrayBuffer], { type: mime }));
  try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** 브라우저 파일에서 고른 이미지의 assetId. 같은 이미지는 같은 id가 되도록 SHA-1 해시를 쓴다. */
export async function contentId(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`[openDb] 이미지 저장소 열기 실패 - ${request.error?.message ?? 'unknown'}`));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
    tx.onerror = () => { db.close(); reject(new Error(`[assets] 이미지 저장소 작업 실패 - ${tx.error?.message ?? 'unknown'}`)); };
  }));
}

export async function putAssets(records: readonly AssetRecord[]): Promise<void> {
  if (records.length === 0) return;
  await run('readwrite', (store) => { for (const record of records) store.put(record); });
}

export async function getAssets(ids: readonly string[]): Promise<AssetRecord[]> {
  const found = await Promise.all(ids.map((id) => run<AssetRecord>('readonly', (store) => store.get(id))));
  return found.filter((record): record is AssetRecord => Boolean(record));
}

/** 문서가 참조하는 assetId 목록. */
export function referencedAssets(doc: { pages: Array<{ objects: Record<string, { fills: Array<{ type: string; assetId?: string }> }> }> }): string[] {
  const ids = new Set<string>();
  for (const page of doc.pages) for (const node of Object.values(page.objects)) for (const paint of node.fills) if (paint.type === 'image' && paint.assetId) ids.add(paint.assetId);
  return [...ids];
}
