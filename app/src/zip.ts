/**
 * 압축하지 않는(저장 방식) zip 파일 만들기. 코드·CSS·그림을 한 파일로 받게 하려는 용도라
 * 새 의존성 없이 형식만 맞춘다. 그림(png·jpg 등)은 이미 압축돼 있어 압축 이득도 거의 없다.
 */
export interface ZipEntry { path: string; data: Uint8Array | string }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** zip이 파일마다 요구하는 CRC-32 체크섬. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 경로 검증. 압축을 풀 때 폴더 밖으로 나가는 경로(.., 절대 경로)는 만들지 않는다. */
function safePath(path: string): string {
  const clean = path.replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..')) throw new Error(`[createZip] 파일 경로 거부 - 폴더 밖을 가리킴: ${path}`);
  return clean;
}

/**
 * 파일 목록을 zip 바이트로. 파일 이름은 UTF-8(일반 목적 비트 11)로 적어 한글 이름도 깨지지 않게 한다.
 * 구조: [로컬 헤더 + 데이터]… → 중앙 디렉터리 → 끝 레코드.
 */
export function createZip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(safePath(entry.path));
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(data);
    const local = header(30, name, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2]]);
    locals.push(local, data);
    centrals.push(header(46, name, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [42, offset, 4]]));
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = header(22, new Uint8Array(), [[0, 0x06054b50, 4], [8, entries.length, 2], [10, entries.length, 2], [12, centralSize, 4], [16, offset, 4]]);
  return concat([...locals, ...centrals, end]);
}

/** 고정 길이 헤더 뒤에 파일 이름을 붙인다. fields는 [위치, 값, 바이트 수] 목록(리틀 엔디언)이다. */
function header(size: number, name: Uint8Array, fields: Array<[number, number, 2 | 4]>): Uint8Array {
  const bytes = new Uint8Array(size + name.length);
  const view = new DataView(bytes.buffer);
  for (const [at, value, length] of fields) {
    if (length === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
  }
  bytes.set(name, size);
  return bytes;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
