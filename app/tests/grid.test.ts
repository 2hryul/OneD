import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import type { FigDocument, FigNode } from 'openfig-core';
import { parseDocument, sampleDocument, solid, walkPage, type DesignDocument, type GridLayout, type NodeInput } from '../src/model';
import { addShape, applyChanges, updateShape, type Transaction } from '../src/changes';
import { computeGrid, formatTracks, parseTracks, placeCells, trackSizes } from '../src/gridLayout';
import { dropIndex } from '../src/layoutEdits';
import { normalizeAfterEdit } from '../src/normalize';
import { importFigNode } from '../src/figmaImport';
import { exportTsx } from '../src/export';

const PAGE = 'page-1';
const grid = (patch: Partial<GridLayout> = {}): GridLayout => ({ type: 'grid', columns: [{ type: 'flex', value: 1 }, { type: 'flex', value: 1 }], rows: [], columnGap: 10, rowGap: 20, padding: [5, 5, 5, 5], justifyItems: 'start', alignItems: 'start', ...patch });
const node = (doc: DesignDocument, id: string) => doc.pages[0]!.objects[id]!;
const commit = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, normalizeAfterEdit(doc, tx).redo);

/** 300×200 그리드 프레임과 40×30 사각형 n개. */
function gridDoc(count: number, layout: GridLayout = grid()): DesignDocument {
  let doc: DesignDocument = { version: 5, name: 'Grid', components: {}, tokens: {}, pages: [{ id: PAGE, name: 'Page 1', children: [], objects: {} }] };
  const add = (shape: NodeInput): void => { doc = applyChanges(doc, addShape(doc, PAGE, shape).redo); };
  add({ id: 'g', type: 'frame', name: 'Grid', parentId: null, x: 0, y: 0, width: 300, height: 200, fills: solid('#ffffff') });
  for (let index = 0; index < count; index++) add({ id: `c${index}`, type: 'rectangle', name: `Cell ${index}`, parentId: 'g', x: 500, y: 500, width: 40, height: 30, fills: solid('#000000') });
  return commit(doc, updateShape(doc, PAGE, 'g', { layout }));
}

describe('grid engine', () => {
  it('reads and writes CSS-like track lists and rejects unknown units', () => {
    expect(parseTracks('1fr 2fr 120px auto 80')).toEqual([{ type: 'flex', value: 1 }, { type: 'flex', value: 2 }, { type: 'fixed', value: 120 }, { type: 'auto', value: 1 }, { type: 'fixed', value: 80 }]);
    expect(formatTracks(parseTracks('1fr 120px auto')!)).toBe('1fr 120px auto');
    expect(parseTracks('1fr 10em')).toBeNull();
    expect(parseTracks('-1fr')).toBeNull();
    expect(parseTracks('')).toEqual([]);
  });

  it('splits free space by fr after fixed and auto tracks', () => {
    expect(trackSizes([{ type: 'fixed', value: 100 }, { type: 'flex', value: 1 }, { type: 'flex', value: 3 }, { type: 'auto', value: 1 }], 400, 10, [0, 0, 0, 50], false)).toEqual([100, 55, 165, 50]);
    // 내용에 맞춤 컨테이너는 비율 트랙도 내용 크기다.
    expect(trackSizes([{ type: 'flex', value: 1 }, { type: 'flex', value: 1 }], 400, 10, [30, 60], true)).toEqual([30, 60]);
  });

  it('places fixed cells first and fills the rest row by row', () => {
    const children = [{ id: 'a', width: 1, height: 1 }, { id: 'b', width: 1, height: 1, item: { gridCell: { row: 0, column: 0 } } }, { id: 'c', width: 1, height: 1 }];
    const { cells, rows } = placeCells(2, children);
    expect([cells.get('a'), cells.get('b'), cells.get('c')]).toEqual([[0, 1], [0, 0], [1, 0]]);
    expect(rows).toBe(2);
  });

  it('lays children into fr columns, adds auto rows, and stretches fill children', () => {
    const result = computeGrid({ width: 300, height: 200, layout: grid({ justifyItems: 'center' }) }, [
      { id: 'a', width: 40, height: 30 }, { id: 'b', width: 40, height: 30, item: { h: 'fill' } }, { id: 'c', width: 40, height: 50 }
    ]);
    // 안쪽 폭 290, 간격 10 → 열 140씩. 행은 내용에 맞춤(30, 50).
    expect(result.boxes.get('a')).toEqual({ x: 55, y: 5, width: 40, height: 30 });
    expect(result.boxes.get('b')).toEqual({ x: 155, y: 5, width: 140, height: 30 });
    expect(result.boxes.get('c')).toEqual({ x: 55, y: 55, width: 40, height: 50 });
    expect([result.width, result.height]).toEqual([300, 200]);
  });

  it('hugs content on both axes when the container is set to auto', () => {
    const result = computeGrid({ width: 300, height: 200, layout: grid(), item: { h: 'auto', v: 'auto' } }, [{ id: 'a', width: 40, height: 30 }, { id: 'b', width: 60, height: 10 }]);
    expect([result.width, result.height]).toEqual([5 + 40 + 10 + 60 + 5, 5 + 30 + 5]);
  });
});

describe('grid in the document', () => {
  it('reflows children into cells when grid is set, keeps undo exact, and survives save and load', () => {
    const doc = gridDoc(3);
    expect([node(doc, 'c0').x, node(doc, 'c0').y]).toEqual([5, 5]);
    expect([node(doc, 'c1').x, node(doc, 'c1').y]).toEqual([155, 5]);
    expect([node(doc, 'c2').x, node(doc, 'c2').y]).toEqual([5, 55]);
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    const moved = commit(doc, updateShape(doc, PAGE, 'c2', { item: { gridCell: { row: 1, column: 1 } } }));
    expect([node(moved, 'c2').x, node(moved, 'c2').y]).toEqual([155, 55]);
  });

  it('rejects broken grid data on load', () => {
    const doc = gridDoc(1);
    const broken = structuredClone(doc);
    (node(broken, 'g').layout as GridLayout).columns = [];
    expect(() => parseDocument(JSON.stringify(broken))).toThrow();
    const badCell = structuredClone(doc);
    node(badCell, 'c0').item = { gridCell: { row: -1, column: 0 } };
    expect(() => parseDocument(JSON.stringify(badCell))).toThrow();
  });

  it('orders a dropped child by row, then column', () => {
    const doc = gridDoc(4);
    const page = doc.pages[0]!;
    expect(dropIndex(page, 'g', { x: 200, y: 60 }, new Set(['c3']))).toBe(3);
    // 첫 행에서 c1 중심(175)보다 왼쪽이면 c1 앞, 오른쪽이면 뒤.
    expect(dropIndex(page, 'g', { x: 160, y: 15 }, new Set(['c3']))).toBe(1);
    expect(dropIndex(page, 'g', { x: 200, y: 15 }, new Set(['c3']))).toBe(2);
  });

  it('exports display:grid with tracks and explicit cells', () => {
    let doc = gridDoc(2, grid({ columns: parseTracks('120px 1fr')!, rows: parseTracks('auto')!, justifyItems: 'stretch' }));
    doc = commit(doc, updateShape(doc, PAGE, 'c1', { item: { gridCell: { row: 1, column: 0 }, h: 'fill' } }));
    const { code, css } = exportTsx(doc, PAGE, 'g');
    expect(css).toMatch(/display: grid;\n {2}grid-template-columns: 120px 1fr;\n {2}grid-template-rows: auto;\n {2}grid-auto-rows: auto;\n {2}column-gap: 10px;\n {2}row-gap: 20px;\n {2}justify-items: stretch;\n {2}align-items: start;/);
    expect(css).toMatch(/\.grid__cell-1 \{[^}]*grid-row: 2;\n {2}grid-column: 1;\n {2}justify-self: stretch;/);
    expect(css).toMatch(/\.grid__cell-0 \{[^}]*width: 40px;/);
    transformSync(code, { loader: 'tsx', jsx: 'automatic' });
  });

  it('applies a gap token to both grid gaps', async () => {
    const { applyToken } = await import('../src/components');
    const { setToken } = await import('../src/changes');
    let doc = gridDoc(2);
    doc = applyChanges(doc, setToken(doc, { id: 't-gap', type: 'number', name: 'Space M', value: 24 }).redo);
    doc = commit(doc, applyToken(doc, PAGE, 'g', 'gap', 't-gap'));
    expect(node(doc, 'g').layout).toMatchObject({ columnGap: 24, rowGap: 24 });
  });
});

const fnode = (localID: number, type: string, name: string, patch: Record<string, unknown> = {}): FigNode => ({
  guid: { sessionID: 1, localID }, type, name, size: { x: 100, y: 40 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, ...patch
}) as unknown as FigNode;

describe('Figma grid import', () => {
  it('maps GRID stack mode, track sizing in position order and child cell anchors', () => {
    const track = (localID: number, position: string) => ({ id: { sessionID: 9, localID }, position });
    const size = (localID: number, type: string, value = 1) => ({ id: { sessionID: 9, localID }, trackSize: { minSizing: { type, value }, maxSizing: { type, value } } });
    const root = fnode(1, 'FRAME', 'Root', {
      size: { x: 300, y: 200 }, stackMode: 'GRID', stackVerticalPadding: 4, stackHorizontalPadding: 6, gridColumnGap: 12, gridRowGap: 8,
      gridColumns: { entries: [track(21, '"'), track(20, '!')] }, gridColumnsSizing: { entries: [size(20, 'FLEX', 2), size(21, 'HUG')] },
      gridRows: { entries: [track(30, '!')] }, gridRowsSizing: { entries: [size(30, 'FIXED', 50)] }
    });
    const child = fnode(2, 'RECTANGLE', 'Cell', { gridRowAnchor: { sessionID: 9, localID: 30 }, gridColumnAnchor: { sessionID: 9, localID: 21 } });
    const fig = { nodes: [root, child], nodeMap: new Map([[`1:1`, root], [`1:2`, child]]), childrenMap: new Map([['1:1', [child]]]), images: new Map() } as unknown as FigDocument;
    const { document, report } = importFigNode(fig, '1:1');
    const [rootNode, childNode] = walkPage(document.pages[0]!);
    expect(rootNode!.layout).toEqual({ type: 'grid', columns: [{ type: 'flex', value: 2 }, { type: 'auto', value: 1 }], rows: [{ type: 'fixed', value: 50 }], columnGap: 12, rowGap: 8, padding: [4, 6, 4, 6], justifyItems: 'start', alignItems: 'start' });
    expect(childNode!.item).toEqual({ gridCell: { row: 0, column: 1 } });
    expect(report.issues.filter((issue) => issue.kind === 'layout-unsupported')).toHaveLength(0);
  });
});

describe('Figma grid reflow', () => {
  it('ignores stale cell anchors when the grid reflows children in order', () => {
    const track = (localID: number, position: string) => ({ id: { sessionID: 9, localID }, position });
    const size = (localID: number) => ({ id: { sessionID: 9, localID }, trackSize: { maxSizing: { type: 'FLEX', value: 1 } } });
    const root = fnode(1, 'FRAME', 'Root', { size: { x: 300, y: 200 }, stackMode: 'GRID', gridReflowEnabled: true, gridColumns: { entries: [track(20, '!'), track(21, '"')] }, gridColumnsSizing: { entries: [size(20), size(21)] } });
    const child = fnode(2, 'RECTANGLE', 'Cell', { gridRowAnchor: { sessionID: 9, localID: 99 }, gridColumnAnchor: { sessionID: 9, localID: 21 } });
    const fig = { nodes: [root, child], nodeMap: new Map([[`1:1`, root], [`1:2`, child]]), childrenMap: new Map([['1:1', [child]]]), images: new Map() } as unknown as FigDocument;
    const [, childNode] = walkPage(importFigNode(fig, '1:1').document.pages[0]!);
    expect(childNode!.item?.gridCell).toBeUndefined();
  });

  const file = process.env.FIGMA_TEST_FILE;
  (file ? it : it.skip)('reproduces every Grid frame of the real file exactly as Figma stored it', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseFig } = await import('openfig-core');
    const { layoutContainer } = await import('../src/layoutEdits');
    const fig = parseFig(new Uint8Array(readFileSync(file!)));
    const grids = (fig.nodes as unknown as Array<{ stackMode?: string; guid: { sessionID: number; localID: number } }>).filter((item) => item.stackMode === 'GRID');
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) {
      const { document } = importFigNode(fig, `${grid.guid.sessionID}:${grid.guid.localID}`);
      const page = document.pages[0]!;
      for (const container of walkPage(page).filter((item) => item.layout?.type === 'grid')) {
        for (const change of layoutContainer(document, page.id, container.id).redo) {
          if (change.type !== 'modObj') continue;
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            const value = (change.set as Partial<Record<typeof key, number>>)[key];
            if (value !== undefined) expect(Math.abs(value - page.objects[change.id]![key])).toBeLessThan(0.5);
          }
        }
      }
    }
  });
});

describe('sample document', () => {
  it('still parses after grid support', () => {
    expect(parseDocument(JSON.stringify(sampleDocument()))).toEqual(sampleDocument());
  });
});
