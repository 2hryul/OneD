import { geometryBlobToSVGPath, getBlobBytes, transformSvgPathData, type FigDocument, type FigNode } from 'openfig-core';
import type { DesignNode } from './model';

/** Figma가 텍스트마다 저장하는 글리프 하나(derivedTextData.glyphs). 윤곽은 em 단위·y 위쪽이고 position은 글자 상자 기준 기준선 위치다. */
interface FigGlyph { commandsBlob?: number; fontSize?: number; position?: { x: number; y: number } }

/** 글리프 윤곽이 맞는 텍스트인지 가리는 값. 글자·글꼴·크기·굵기가 하나라도 바뀌면 윤곽은 더 쓰지 않는다. */
export function glyphKey(node: Pick<DesignNode, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight'>): string {
  return [node.text ?? '', node.fontFamily ?? '', node.fontSize ?? 18, node.fontWeight ?? 400].join('|');
}

/**
 * 파일에 저장된 글리프 윤곽을 글자 상자 지역 좌표의 SVG 경로 하나로 만든다.
 * 글꼴이 이 PC에 없을 때 Figma와 같은 모양으로 그리기 위해 쓴다. 윤곽이 없거나 읽지 못하면 null이다.
 */
export function figGlyphPath(fig: FigDocument, node: FigNode): string | null {
  const glyphs = ((node as { derivedTextData?: { glyphs?: FigGlyph[] } }).derivedTextData?.glyphs ?? []);
  const parts: string[] = [];
  for (const glyph of glyphs) {
    if (glyph.commandsBlob === undefined || !glyph.position) continue;
    // 깨진 blob 하나 때문에 텍스트 가져오기 전체가 실패하지 않게 그 글리프만 건너뛴다(공백 글리프도 blob이 없다).
    try {
      const bytes = getBlobBytes(fig, glyph.commandsBlob);
      if (!bytes) continue;
      const size = glyph.fontSize ?? node.fontSize ?? 16;
      const path = transformSvgPathData(geometryBlobToSVGPath(bytes), { scaleX: size, scaleY: -size, translateX: glyph.position.x, translateY: glyph.position.y });
      if (path.trim()) parts.push(path.trim());
    } catch { continue; }
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
  return node.glyphs.d;
}
