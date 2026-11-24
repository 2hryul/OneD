import { describe, expect, it } from 'vitest';
import { encodeCommandsBlob, type FigDocument, type FigNode } from 'openfig-core';
import { importFigNode, listFigFrames } from '../src/figmaImport';
import { figGlyphPath, glyphKey, glyphOutline } from '../src/glyphs';
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

  it('skips text with style runs because the outline cannot follow them', () => {
    const fig = textFile({ textData: { characters: 'A', characterStyleIDs: [1], styleOverrideTable: [{ styleID: 1, fontSize: 40 }] } });
    expect(textOf(fig, () => false).glyphs).toBeUndefined();
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
