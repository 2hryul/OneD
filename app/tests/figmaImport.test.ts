import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFig, type FigDocument, type FigNode } from 'openfig-core';
import { figmaNodeId, importFigNode, listFigFrames, listFigTopNodes } from '../src/figmaImport';
import { parseDocument, walkPage, type DesignDocument, type DesignNode, type Paint } from '../src/model';
import { imageFilterCss, strokeAndEffectCss } from '../src/styleCss';
import { nodesToSvg } from '../src/svgExport';

const figNode = (localID: number, type: string, name: string, x: number, y: number, width: number, height: number): FigNode => ({
  guid: { sessionID: 1, localID }, type, name, size: { x: width, y: height },
  transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y }
});

describe('Figma import', () => {
  it('reads the node ID from a link', () => {
    expect(figmaNodeId('https://www.figma.com/design/key/name?node-id=779-23219&t=x')).toBe('779:23219');
    expect(figmaNodeId('779:23219')).toBe('779:23219');
    expect(figmaNodeId('invalid')).toBeNull();
  });

  it('maps nested coordinates and expands a component definition', () => {
    const root = figNode(1, 'FRAME', 'Screen', 500, 600, 320, 240);
    const text = { ...figNode(2, 'TEXT', 'Title', 40, 50, 100, 24), textData: { characters: 'Hello' }, fontSize: 20 };
    const instance = { ...figNode(3, 'INSTANCE', 'Button', 100, 60, 120, 40), symbolData: { symbolID: { sessionID: 1, localID: 4 }, symbolOverrides: [
      { guidPath: { guids: [{ sessionID: 9, localID: 9 }] }, textData: { characters: 'Changed' } }
    ] } };
    const symbol = figNode(4, 'SYMBOL', 'Button source', 0, 0, 120, 40);
    const label = { ...figNode(5, 'TEXT', 'Label', 5, 6, 80, 20), textData: { characters: 'Click' }, overrideKey: { sessionID: 9, localID: 9 } };
    const nodes = [root, text, instance, symbol, label];
    const fig = {
      nodes, nodeMap: new Map(nodes.map((node) => [`1:${node.guid.localID}`, node])),
      childrenMap: new Map([['1:1', [text, instance]], ['1:4', [label]]])
    } as unknown as FigDocument;
    const imported = importFigNode(fig, '1:1');
    const shapes = walkPage(imported.document.pages[0]!);
    expect(shapes).toHaveLength(4);
    expect(shapes[0]).toMatchObject({ x: 0, y: 0, width: 320, height: 240 });
    expect(shapes[1]).toMatchObject({ x: 40, y: 50, text: 'Hello' });
    expect(shapes[3]).toMatchObject({ x: 105, y: 66, text: 'Changed' });
    expect(imported.report.expandedInstances).toBe(1);
    expect(imported.report.appliedOverrides).toBe(1);
    expect(imported.report.unappliedOverrides).toBe(0);
  });

  /** 페이지(CANVAS) 아래에 노드를 둔 최소 파일. internal은 라이브러리용 숨은 페이지에 둘 노드다. */
  const pageFile = (top: FigNode[], internal: FigNode[] = [], images: Record<string, Uint8Array> = {}): FigDocument => {
    const page = { guid: { sessionID: 0, localID: 1 }, type: 'CANVAS', name: 'Page 1' } as FigNode;
    const hidden = { guid: { sessionID: 0, localID: 2 }, type: 'CANVAS', name: 'Internal Only Canvas', internalOnly: true } as unknown as FigNode;
    const nodes = [page, hidden, ...top, ...internal];
    return {
      nodes, nodeMap: new Map(nodes.map((node) => [`${node.guid.sessionID}:${node.guid.localID}`, node])),
      childrenMap: new Map([['0:1', top], ['0:2', internal]]), images: new Map(Object.entries(images))
    } as unknown as FigDocument;
  };

  it('offers top-level shapes when a page has no frames at the top', () => {
    // coloradjusted.fig처럼 페이지 맨 위가 그림을 채운 둥근 사각형 하나뿐인 파일.
    const photo = figNode(2, 'ROUNDED_RECTANGLE', 'IMG_4950-scaled 1', 0, 0, 2560, 1920);
    const brush = figNode(3, 'BRUSH', 'Heist', 0, 0, 256, 16);
    const fig = pageFile([photo], [brush]);
    expect(listFigFrames(fig)).toEqual([]);
    expect(listFigTopNodes(fig)).toEqual([{ id: '1:2', name: 'IMG_4950-scaled 1', page: 'Page 1', width: 2560, height: 1920, type: 'ROUNDED_RECTANGLE' }]);
  });

  it('keeps frames and shapes apart in the import lists', () => {
    const frame = figNode(1, 'FRAME', 'Screen', 0, 0, 320, 240);
    const vector = figNode(4, 'VECTOR', '', 400, 0, 24, 24);
    const section = figNode(5, 'SECTION', 'Section', 0, 400, 800, 600);
    const inSection = figNode(6, 'ELLIPSE', 'Dot', 10, 10, 8, 8);
    const fig = pageFile([frame, vector, section]);
    (fig.childrenMap as Map<string, FigNode[]>).set('1:5', [inSection]);
    (fig.nodeMap as Map<string, FigNode>).set('1:6', inSection);
    expect(listFigFrames(fig).map((entry) => entry.id)).toEqual(['1:1']);
    // 섹션 자체는 후보가 아니고, 섹션 바로 아래 도형은 후보다. 이름 없는 노드는 id로 보인다.
    expect(listFigTopNodes(fig).map((entry) => [entry.id, entry.name, entry.type])).toEqual([['1:4', '1:4', 'VECTOR'], ['1:6', 'Dot', 'ELLIPSE']]);
  });

  describe('image color adjustment (paintFilter)', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const hash = new Uint8Array(20).fill(0xcd);
    const photo = (paintFilter: Record<string, number>): FigNode => ({
      ...figNode(2, 'ROUNDED_RECTANGLE', 'IMG_4950-scaled 1', 0, 0, 2560, 1920),
      fillPaints: [{ type: 'IMAGE', image: { hash }, imageScaleMode: 'FILL', transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, paintFilter } as never]
    });
    const importPhoto = (paintFilter: Record<string, number>) => {
      const imported = importFigNode(pageFile([photo(paintFilter)], [], { ['cd'.repeat(20)]: png }), '1:2');
      return { imported, paint: imported.document.pages[0]!.objects['1:2']!.fills[0] as Extract<Paint, { type: 'image' }> };
    };

    it('approximates exposure, contrast and vibrance as CSS filters and reports what it cannot show', () => {
      // coloradjusted.fig의 실제 값.
      const { imported, paint } = importPhoto({ tint: 0.20000000298023224, shadows: -0.38999998569488525, highlights: 0.3199999928474426, exposure: 0.23000000417232513, temperature: 0, vibrance: 0.4300000071525574, contrast: -0.15000000596046448 });
      expect(paint).toMatchObject({ type: 'image', assetId: 'cd'.repeat(20), fit: 'fill', adjust: { brightness: 1.17, contrast: 0.85, saturate: 1.43 } });
      expect(imported.report.issues).toEqual([{
        nodeId: '1:2', name: 'IMG_4950-scaled 1', kind: 'image-adjust-approximated',
        detail: '그림 색 보정을 CSS 필터 brightness(1.17) contrast(0.85) saturate(1.43)로 근사 · 표현 못 함: 틴트 0.2, 하이라이트 0.32, 그림자 -0.39'
      }]);
    });

    it('reports adjustments it cannot approximate and stays quiet when nothing is adjusted', () => {
      const warm = importPhoto({ temperature: 0.5, exposure: 0, contrast: 0 });
      expect(warm.paint.adjust).toBeUndefined();
      expect(warm.imported.report.issues).toEqual([{ nodeId: '1:2', name: 'IMG_4950-scaled 1', kind: 'image-adjust-unsupported', detail: '그림 색 보정 무시: 색온도 0.5' }]);
      const neutral = importPhoto({ exposure: 0, contrast: 0, vibrance: 0, temperature: 0 });
      expect(neutral.paint.adjust).toBeUndefined();
      expect(neutral.imported.report.issues).toEqual([]);
      // 채도와 생동감은 곱해서 하나의 saturate가 된다. 채도 -1이면 흑백이다.
      expect(importPhoto({ saturation: -1, vibrance: 0.5 }).paint.adjust).toEqual({ saturate: 0 });
    });

    it('draws the adjustment as a CSS filter, keeps it when saving and puts it in SVG export', () => {
      const adjust = { brightness: 1.17, contrast: 0.85, saturate: 1.43 };
      expect(imageFilterCss(adjust)).toBe('brightness(1.17) contrast(0.85) saturate(1.43)');
      expect(imageFilterCss({})).toBeUndefined();
      const base: DesignNode = { id: 'n', type: 'rectangle', name: 'Photo', parentId: null, x: 0, y: 0, width: 100, height: 50, transform: [1, 0, 0, 1, 0, 0], fills: [{ type: 'image', assetId: 'a', fit: 'fill', adjust }] };
      expect(strokeAndEffectCss(base).filter).toBe('brightness(1.17) contrast(0.85) saturate(1.43)');
      // 프레임에 걸면 자식까지 보정되고, 여러 겹이면 다른 겹까지 보정되므로 DOM에서는 걸지 않는다.
      expect(strokeAndEffectCss({ ...base, type: 'frame', children: [] }).filter).toBeUndefined();
      expect(strokeAndEffectCss({ ...base, fills: [{ type: 'solid', color: '#ffffff' }, ...base.fills] }).filter).toBeUndefined();
      const page = { id: 'p', name: 'Page 1', children: ['n'], objects: { n: base } };
      const doc = { version: 5, name: 'Adjusted', components: {}, tokens: {}, pages: [page] } as unknown as DesignDocument;
      expect(parseDocument(JSON.stringify(doc)).pages[0]!.objects.n!.fills[0]).toEqual(base.fills[0]);
      const broken = { ...doc, pages: [{ ...page, objects: { n: { ...base, fills: [{ type: 'image', assetId: 'a', fit: 'fill', adjust: { brightness: 'x' } }] } } }] };
      expect(() => parseDocument(JSON.stringify(broken))).toThrow();
      const svg = nodesToSvg(doc.pages[0]!, ['n'], { image: () => 'data:image/png;base64,AAAA', measure: () => 0 } as never);
      expect(svg).toContain('style="filter: brightness(1.17) contrast(0.85) saturate(1.43)"');
    });
  });

  const file = process.env.FIGMA_TEST_FILE;
  (file ? it : it.skip)('imports the supplied Figma file node', () => {
    const parsed = parseFig(new Uint8Array(readFileSync(file!)));
    const imported = importFigNode(parsed, '779:23219');
    const nodes = walkPage(imported.document.pages[0]!);
    expect(nodes[0]).toMatchObject({ name: 'Contents', width: 1200, height: 2143 });
    expect(nodes.length).toBeGreaterThan(100);
    expect(nodes.length).toBe(Object.keys(imported.document.pages[0]!.objects).length);
    expect(imported.report.expandedInstances).toBeGreaterThan(0);
  });
});
