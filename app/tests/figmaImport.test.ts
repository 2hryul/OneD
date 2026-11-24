import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFig, type FigDocument, type FigNode } from 'openfig-core';
import { figmaNodeId, importFigNode, listFigFrames, listFigTopNodes } from '../src/figmaImport';
import { parseDocument, walkPage, type DesignDocument, type DesignNode, type Paint } from '../src/model';
import { adjustedImageFill, imageFilterCss, strokeAndEffectCss } from '../src/styleCss';
import { exportTsx } from '../src/export';
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
      // 채도는 vibrance로 읽는다(스키마에 saturation 필드가 없다). -1이면 흑백이다.
      expect(importPhoto({ vibrance: -1 }).paint.adjust).toEqual({ saturate: 0 });
    });

    it('reads every paintFilter field in the file schema', () => {
      // brightness는 노출과 곱해 brightness로 근사한다.
      const bright = importPhoto({ brightness: 0.5 });
      expect(bright.paint.adjust).toEqual({ brightness: 1.5 });
      // 노출 +1(2배)과 밝기 -0.5(절반)는 상쇄되어 보정이 없다.
      expect(importPhoto({ exposure: 1, brightness: -0.5 }).paint.adjust).toBeUndefined();
      // 디테일·비네트는 표현하지 못하므로 보고서에 남긴다(조용히 버리지 않는다).
      expect(importPhoto({ detail: 0.4, vignette: 0.6 }).imported.report.issues).toEqual([{ nodeId: '1:2', name: 'IMG_4950-scaled 1', kind: 'image-adjust-unsupported', detail: '그림 색 보정 무시: 디테일 0.4, 비네트 0.6' }]);
    });

    it('clamps out-of-range values so the imported document can still be saved', () => {
      // 손상된 파일의 큰 노출(2^1100 = Infinity)이 저장본을 깨뜨리지 않도록 Figma 범위(-1..1)로 자른다.
      const { imported, paint } = importPhoto({ exposure: 1100, contrast: -5, vibrance: 9 });
      expect(paint.adjust).toEqual({ brightness: 2, contrast: 0, saturate: 2 });
      expect(() => parseDocument(JSON.stringify(imported.document))).not.toThrow();
    });

    it('notes in the report when the adjusted image is one of several fills', () => {
      const node = photo({ exposure: 0.5 });
      node.fillPaints = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } } as never, ...node.fillPaints!];
      const imported = importFigNode(pageFile([node], [], { ['cd'.repeat(20)]: png }), '1:2');
      expect(imported.report.issues.map((issue) => issue.detail)).toEqual(['그림 색 보정을 CSS 필터 brightness(1.41)로 근사 · 여러 겹 채우기 속 그림이라 DOM 렌더러·React 출력에는 보정이 빠짐(Canvas·SVG만 적용)']);
    });

    it('filters only the image layer, keeps it when saving and puts it in SVG export', () => {
      const adjust = { brightness: 1.17, contrast: 0.85, saturate: 1.43 };
      expect(imageFilterCss(adjust)).toBe('brightness(1.17) contrast(0.85) saturate(1.43)');
      expect(imageFilterCss({})).toBeUndefined();
      const base: DesignNode = {
        id: 'n', type: 'rectangle', name: 'Photo', parentId: null, x: 0, y: 0, width: 100, height: 50, transform: [1, 0, 0, 1, 0, 0],
        fills: [{ type: 'image', assetId: 'a', fit: 'fill', adjust }],
        strokes: [{ color: '#ff0000', width: 4, align: 'inside' }], effects: [{ type: 'drop-shadow', x: 0, y: 4, blur: 8, spread: 0, color: '#ff000080' }]
      };
      // 요소에는 filter를 걸지 않는다(선·그림자가 보정되면 Canvas·SVG와 색이 달라진다). 그림 겹만 따로 보정한다.
      expect(strokeAndEffectCss(base).filter).toBeUndefined();
      expect(adjustedImageFill(base)?.filter).toBe('brightness(1.17) contrast(0.85) saturate(1.43)');
      expect(adjustedImageFill({ ...base, type: 'frame', children: [] })?.filter).toBe('brightness(1.17) contrast(0.85) saturate(1.43)');
      // 여러 겹 채우기 속 그림은 그 겹만 보정할 방법이 없어 DOM·React에서는 보정하지 않는다(보고서에 적음).
      expect(adjustedImageFill({ ...base, fills: [{ type: 'solid', color: '#ffffff' }, ...base.fills] })).toBeNull();
      expect(adjustedImageFill({ ...base, fills: [{ type: 'image', assetId: 'a', fit: 'fill' }] })).toBeNull();
      const page = { id: 'p', name: 'Page 1', children: ['n'], objects: { n: base } };
      const doc = { version: 5, name: 'Adjusted', components: {}, tokens: {}, pages: [page] } as unknown as DesignDocument;
      expect(parseDocument(JSON.stringify(doc)).pages[0]!.objects.n!.fills[0]).toEqual(base.fills[0]);
      const broken = { ...doc, pages: [{ ...page, objects: { n: { ...base, fills: [{ type: 'image', assetId: 'a', fit: 'fill', adjust: { brightness: 'x' } }] } } }] };
      expect(() => parseDocument(JSON.stringify(broken))).toThrow();
      const svg = nodesToSvg(doc.pages[0]!, ['n'], { image: () => 'data:image/png;base64,AAAA', measure: () => 0 } as never);
      expect(svg).toContain('style="filter: brightness(1.17) contrast(0.85) saturate(1.43)"');
      // React 출력: img가 아니라 ::before 겹에 그림과 filter를 두고, 선·그림자가 있는 요소 규칙에는 filter가 없다.
      const exported = exportTsx(doc, 'p', 'n');
      expect(exported.code).not.toContain('<img');
      const before = exported.css.match(/::before \{[^}]*\}/)?.[0] ?? '';
      expect(before).toContain('filter: brightness(1.17) contrast(0.85) saturate(1.43);');
      expect(before).toContain('z-index: -1;');
      const own = exported.css.split('}').find((rule) => rule.includes('outline:')) ?? '';
      expect(own).toContain('isolation: isolate;');
      expect(own).not.toContain('filter:');
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
