import { getBlobBytes, type FigDocument, type FigNode } from 'openfig-core';
import type { DesignNode } from './model';

/** Figma가 텍스트마다 저장하는 글리프 하나(derivedTextData.glyphs). 윤곽은 em 단위·y 위쪽이고 position은 글자 상자 기준 기준선 위치다. */
interface FigGlyph { commandsBlob?: number; fontSize?: number; position?: { x: number; y: number } }

/** 글리프 윤곽이 맞는 텍스트인지 가리는 값. 글자·글꼴·크기·굵기가 하나라도 바뀌면 윤곽은 더 쓰지 않는다. */
export function glyphKey(node: Pick<DesignNode, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight'>): string {
  return [node.text ?? '', node.fontFamily ?? '', node.fontSize ?? 18, node.fontWeight ?? 400].join('|');
}

/** 윤곽 blob의 명령 번호와 뒤따르는 float32 좌표 개수. 글리프는 TrueType 윤곽이라 2차 곡선(3)을 쓴다. */
const BLOB_COMMANDS: Record<number, { letter: string; floats: number }> = {
  0: { letter: 'Z', floats: 0 }, 1: { letter: 'M', floats: 2 }, 2: { letter: 'L', floats: 2 }, 3: { letter: 'Q', floats: 4 }, 4: { letter: 'C', floats: 6 }
};

/**
 * 글리프 윤곽 blob(em 단위, y 위쪽)을 글자 상자 좌표의 SVG 경로로 바꾼다. 읽지 못하는 명령이 있으면 null이다.
 * openfig-core의 geometryBlobToSVGPath는 2차 곡선을 몰라 첫 곡선에서 멈추고, 좌표를 em 단위 소수 둘째 자리로 반올림해
 * 큰 글자가 뭉개지므로 직접 읽는다. 윤곽마다 앞에 붙는 닫기 명령은 열린 윤곽이 없을 때 버린다(경로가 Z로 시작하면 브라우저가 경로 전체를 버린다).
 */
export function glyphBlobToPath(bytes: Uint8Array, size: number, origin: { x: number; y: number }): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  const parts: string[] = [];
  let open = false;
  let offset = 0;
  while (offset < bytes.length) {
    const command = BLOB_COMMANDS[bytes[offset++]!];
    if (!command || offset + command.floats * 4 > bytes.length) return null;
    const numbers: number[] = [];
    for (let index = 0; index < command.floats; index++) {
      const value = view.getFloat32(offset + index * 4, true);
      numbers.push(round(index % 2 === 0 ? origin.x + value * size : origin.y - value * size));
    }
    offset += command.floats * 4;
    if (command.letter === 'Z') { if (open) parts.push('Z'); open = false; continue; }
    if (command.letter !== 'M' && !open) return null;
    open = true;
    parts.push(`${command.letter}${numbers.join(' ')}`);
  }
  return parts.join(' ');
}

/**
 * 파일에 저장된 글리프 윤곽을 글자 상자 지역 좌표의 SVG 경로 하나로 만든다.
 * 글꼴이 이 PC에 없을 때 Figma와 같은 모양으로 그리기 위해 쓴다. 윤곽이 없거나 하나라도 읽지 못하면 null이다
 * (글자가 빠진 윤곽보다 대체 글꼴로 그린 글자가 낫다).
 */
export function figGlyphPath(fig: FigDocument, node: FigNode): string | null {
  const glyphs = ((node as { derivedTextData?: { glyphs?: FigGlyph[] } }).derivedTextData?.glyphs ?? []);
  const parts: string[] = [];
  for (const glyph of glyphs) {
    // 공백 글리프는 blob이 없다.
    if (glyph.commandsBlob === undefined || !glyph.position) continue;
    let bytes: Uint8Array | null | undefined;
    try { bytes = getBlobBytes(fig, glyph.commandsBlob); } catch { return null; }
    if (!bytes) return null;
    const path = glyphBlobToPath(bytes, glyph.fontSize ?? node.fontSize ?? 16, glyph.position);
    if (path === null) return null;
    if (path) parts.push(path);
  }
  return parts.length ? parts.join(' ') : null;
}

const availability = new Map<string, boolean>();

/**
 * 글꼴이 이 브라우저에서 쓸 수 있는지. 기본 글꼴 두 가지(monospace, serif)를 대체로 둔 글자 폭이 둘 다 대체 글꼴과 같으면 없는 글꼴이다.
 * document.fonts.check()는 등록되지 않은 시스템 글꼴을 구분하지 못해 폭 비교를 쓴다. 브라우저 밖(테스트)에서는 있다고 본다.
 */
export function fontAvailable(family: string): boolean {
  const cached = availability.get(family);
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') return true;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return true;
  const sample = 'mmmmmmmmmmlliWW0123';
  const width = (font: string): number => { ctx.font = `72px ${font}`; return ctx.measureText(sample).width; };
  const quoted = `"${family.replace(/"/g, '')}"`;
  const available = width(`${quoted}, monospace`) !== width('monospace') || width(`${quoted}, serif`) !== width('serif');
  availability.set(family, available);
  return available;
}

/**
 * 이 텍스트를 글리프 윤곽으로 그려야 하면 그 경로를 준다. 윤곽이 지금 글자와 맞고(key), 글자 구간 스타일이 없고, 글꼴이 없을 때만이다.
 * 글꼴이 있으면 실제 글자로 그린다(선택·검색·선명도가 낫다).
 */
export function glyphOutline(node: DesignNode, available: (family: string) => boolean = fontAvailable): string | null {
  if (node.type !== 'text' || !node.glyphs || node.spans?.length) return null;
  if (node.glyphs.key !== glyphKey(node) || available(node.fontFamily ?? '')) return null;
  // 이전 버전이 저장한 윤곽은 곡선이 빠지고 Z로 시작해 브라우저가 버린다. 그런 윤곽은 쓰지 않고 대체 글꼴로 그린다.
  if (!node.glyphs.d.startsWith('M')) return null;
  return node.glyphs.d;
}
