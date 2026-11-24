import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { assembleCanvasFig, createEmptyFigDoc, createFigZip, encodeCommandsBlob, encodeFigParts, type FigDocument, type FigNode } from 'openfig-core';
import { importFigNode, listFigFrames, readFigFile } from '../src/figmaImport';
import { figGlyphPath, glyphBlobToPath, glyphKey, glyphOutline } from '../src/glyphs';
import { parseDocument, walkPage, type DesignNode } from '../src/model';

/** 가짜 Figma 노드. patch로 필요한 필드만 덮는다. */
const f = (localID: number, type: string, name: string, patch: Record<string, unknown> = {}): FigNode => ({
  guid: { sessionID: 1, localID }, type, name, size: { x: 100, y: 40 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, ...patch
}) as unknown as FigNode;

/** 노드·부모 → 자식 표·blob 목록으로 파서 결과 모양을 만든다. */
function figOf(nodes: FigNode[], children: Record<string, FigNode[]>, blobs: Uint8Array[] = []): FigDocument {
  const id = (node: FigNode): string => `${(node.guid as { sessionID: number }).sessionID}:${(node.guid as { localID: number }).localID}`;
  return { nodes, nodeMap: new Map(nodes.map((node) => [id(node), node])), childrenMap: new Map(Object.entries(children)), images: new Map(), message: { blobs: blobs.map((bytes) => ({ bytes })) } } as unknown as FigDocument;
}

// 0~1 em 정사각형 글리프(윤곽은 y 위쪽). 글자 크기 28, 기준선 (10, 28)에 놓이면 상자 지역 좌표 10~38 × 0~28이 된다.
const square = encodeCommandsBlob([{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 0 }, { type: 'L', x: 1, y: 1 }, { type: 'L', x: 0, y: 1 }, { type: 'Z' }]);

function textFile(patch: Record<string, unknown> = {}): FigDocument {
  const frame = f(1, 'FRAME', 'Card', { size: { x: 200, y: 60 } });
  const text = f(2, 'TEXT', 'Label', {
    size: { x: 60, y: 28 }, textData: { characters: 'A' }, fontName: { family: 'Blocky', style: 'Regular' }, fontSize: 28,
    fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
    derivedTextData: { glyphs: [{ commandsBlob: 0, fontSize: 28, position: { x: 10, y: 28 }, firstCharacter: 0 }] }, ...patch
  });
  return figOf([frame, text], { '1:1': [text] }, [square]);
}

/** 명령 번호와 float32 좌표들로 윤곽 blob을 만든다(파일과 같은 리틀 엔디언). */
function blob(...commands: number[][]): Uint8Array {
  const bytes = new Uint8Array(commands.reduce((size, [, ...floats]) => size + 1 + floats.length * 4, 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [command, ...floats] of commands) {
    bytes[offset++] = command!;
    for (const value of floats) { view.setFloat32(offset, value, true); offset += 4; }
  }
  return bytes;
}

const textOf = (fig: FigDocument, fontAvailable: (family: string) => boolean): DesignNode => walkPage(importFigNode(fig, '1:1', { fontAvailable }).document.pages[0]!).find((node) => node.type === 'text')!;
const numbers = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('glyph outlines for fonts this PC does not have', () => {
  it('turns stored glyphs into one path in the text box (em units, y up, baseline position)', () => {
    const fig = textFile();
    const path = figGlyphPath(fig, fig.nodeMap.get('1:2')!)!;
    const values = numbers(path);
    expect(Math.min(...values.filter((_, i) => i % 2 === 0))).toBe(10);
    expect(Math.max(...values.filter((_, i) => i % 2 === 0))).toBe(38);
    expect(Math.min(...values.filter((_, i) => i % 2 === 1))).toBe(0);
    expect(Math.max(...values.filter((_, i) => i % 2 === 1))).toBe(28);
  });

  it('keeps glyphs only for missing fonts and only while the text matches them', () => {
    expect(textOf(textFile(), () => true).glyphs).toBeUndefined();
    const node = textOf(textFile(), (family) => family !== 'Blocky');
    expect(node.glyphs?.key).toBe(glyphKey(node));
    expect(parseDocument(JSON.stringify(importFigNode(textFile(), '1:1', { fontAvailable: () => false }).document)).pages[0]!.objects['1:1/1:2']?.glyphs).toEqual(node.glyphs);
    const missing = (): boolean => false;
    expect(glyphOutline(node, missing)).toBe(node.glyphs!.d);
    // 글꼴이 생기면 실제 글자로, 글자를 고치면(윤곽과 안 맞음) 대체 글꼴로 그린다.
    expect(glyphOutline(node, () => true)).toBeNull();
    expect(glyphOutline({ ...node, text: 'B' }, missing)).toBeNull();
  });

  it('reads quadratic curves and drops the close command that starts each outline', () => {
    // TrueType 글리프 blob은 윤곽마다 닫기(0)로 시작하고 2차 곡선(3)을 쓴다. 이전에는 첫 곡선에서 읽기를 멈춰 'Z M…'만 남았다.
    const quadGlyph = blob([0], [1, 0, 0], [3, 0.5, 1, 1, 0], [0]);
    const fig = textFile();
    (fig as unknown as { message: { blobs: Array<{ bytes: Uint8Array }> } }).message.blobs = [{ bytes: quadGlyph }];
    expect(figGlyphPath(fig, fig.nodeMap.get('1:2')!)).toBe('M10 28 Q24 0 38 28 Z');
  });

  it('draws with a fallback font instead of a broken outline', () => {
    const fig = textFile();
    (fig as unknown as { message: { blobs: Array<{ bytes: Uint8Array }> } }).message.blobs = [{ bytes: blob([1, 0, 0], [9, 1, 1]) }];
    expect(figGlyphPath(fig, fig.nodeMap.get('1:2')!)).toBeNull();
    // 이전 버전이 저장한 윤곽(Z로 시작해 브라우저가 버림)은 쓰지 않는다.
    const node = textOf(textFile(), () => false);
    expect(glyphOutline({ ...node, glyphs: { ...node.glyphs!, d: 'Z M10 28 L38 28 Z' } }, () => false)).toBeNull();
  });

  it('never emits a path the browser would drop, and falls back instead', () => {
    const origin = { x: 10, y: 28 };
    // 유한하지 않은 좌표가 든 경로는 브라우저가 버려 글자가 사라진다. 대체 글꼴로 그리도록 null이다.
    expect(glyphBlobToPath(blob([1, Number.NaN, 0], [2, 1, 0], [0]), 28, origin)).toBeNull();
    expect(glyphBlobToPath(blob([1, 0, 0], [2, Number.POSITIVE_INFINITY, 0], [0]), 28, origin)).toBeNull();
    expect(glyphBlobToPath(blob([2, 1, 0]), 28, origin)).toBeNull();
    // 닫기 뒤 이동 없이 이어지는 그리기는 SVG가 허용한다(닫은 윤곽의 시작점에서 이어 그림).
    expect(glyphBlobToPath(blob([1, 0, 0], [2, 1, 0], [2, 1, 1], [0], [2, 0, 1], [2, -1, 1], [0]), 28, origin)).toBe('M10 28 L38 28 L38 0 Z L10 0 L-18 0 Z');
  });

  it('falls back when a glyph has an outline but no position', () => {
    const fig = textFile({ derivedTextData: { glyphs: [{ commandsBlob: 0, fontSize: 28, position: { x: 0, y: 28 } }, { commandsBlob: 0, fontSize: 28 }, { fontSize: 28, position: { x: 56, y: 28 } }] } });
    expect(figGlyphPath(fig, fig.nodeMap.get('1:2')!)).toBeNull();
    // 공백처럼 blob이 없는 글리프는 그냥 건너뛴다.
    const spaced = textFile({ derivedTextData: { glyphs: [{ commandsBlob: 0, fontSize: 28, position: { x: 0, y: 28 } }, { fontSize: 28, position: { x: 28, y: 28 } }] } });
    expect(figGlyphPath(spaced, spaced.nodeMap.get('1:2')!)).toBe('M0 28 L28 28 L28 0 L0 0 Z');
  });

  it('skips text with style runs because the outline cannot follow them', () => {
    const fig = textFile({ textData: { characters: 'A', characterStyleIDs: [1], styleOverrideTable: [{ styleID: 1, fontSize: 40 }] } });
    expect(textOf(fig, () => false).glyphs).toBeUndefined();
  });
});

describe('reading .fig files', () => {
  it('opens the older format without a ZIP wrapper as well as the current one', () => {
    // 예전 로컬 복사본은 ZIP 없이 canvas 데이터(fig-kiwi)만 있다. 같은 문서를 두 형식으로 만들어 같은 프레임을 읽는지 본다.
    const doc = createEmptyFigDoc();
    const changes = (doc.message as { nodeChanges: unknown[] }).nodeChanges;
    changes.push({ guid: { sessionID: 1, localID: 2 }, phase: 'CREATED', parentIndex: { guid: { sessionID: 0, localID: 1 }, position: 'a' }, type: 'FRAME', name: 'Login', visible: true, opacity: 1, size: { x: 375, y: 812 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 } });
    const parts = encodeFigParts(doc);
    const canvasFig = assembleCanvasFig({ prelude: parts.prelude, version: parts.version, schemaCompressed: parts.schemaCompressed, messageCompressed: deflateRawSync(parts.messageRaw) });
    const expected = [{ id: '1:2', name: 'Login', page: 'Page 1', width: 375, height: 812, type: 'FRAME' }];
    expect(new TextDecoder().decode(canvasFig.slice(0, 8))).toBe('fig-kiwi');
    expect(listFigFrames(readFigFile(canvasFig))).toEqual(expected);
    expect(listFigFrames(readFigFile(createFigZip({ canvasFig })))).toEqual(expected);
    expect(() => readFigFile(new TextEncoder().encode('<!DOCTYPE html>'))).toThrow('ZIP');
  });
});

describe('frame list for local .fig files', () => {
  it('lists top-level frames and frames inside sections, skipping hidden library pages', () => {
    const page = f(10, 'CANVAS', 'Examples', { size: undefined });
    const hidden = f(11, 'CANVAS', 'Internal Only Canvas', { size: undefined, internalOnly: true });
    const card = f(1, 'FRAME', 'First success', { size: { x: 320, y: 180 } });
    const section = f(2, 'SECTION', 'Flows', { size: { x: 900, y: 900 } });
    const inSection = f(3, 'FRAME', 'Login', { size: { x: 375, y: 812 } });
    const loose = f(4, 'TEXT', 'Note');
    const library = f(5, 'SYMBOL', 'Button');
    const fig = figOf([page, hidden, card, section, inSection, loose, library], { '1:10': [card, section, loose], '1:2': [inSection], '1:11': [library] });
    expect(listFigFrames(fig)).toEqual([
      { id: '1:1', name: 'First success', page: 'Examples', width: 320, height: 180, type: 'FRAME' },
      { id: '1:3', name: 'Login', page: 'Examples', width: 375, height: 812, type: 'FRAME' }
    ]);
  });
});
