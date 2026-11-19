import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { parseFig, type FigDocument, type FigNode } from 'openfig-core';
import { parseDocument, sampleDocument, solid, walkPage, type DesignDocument, type FlexLayout } from '../src/model';
import { applyChanges, addShape, resizeShape, updateShape } from '../src/changes';
import { applyConstraints, computeFlex, distribute } from '../src/layout';
import { dropIndex, layoutContainer, layoutContainers } from '../src/layoutEdits';
import { normalizeAfterEdit } from '../src/normalize';
import { importFigNode } from '../src/figmaImport';
import { exportTsx } from '../src/export';

const flex = (patch: Partial<FlexLayout> = {}): FlexLayout => ({ type: 'flex', direction: 'row', wrap: false, gap: 10, crossGap: 10, padding: [5, 5, 5, 5], justify: 'start', align: 'start', ...patch });
const PAGE = 'page-1';
const page = (doc: DesignDocument) => doc.pages[0]!;
const node = (doc: DesignDocument, id: string) => page(doc).objects[id]!;

function commit(doc: DesignDocument, tx: ReturnType<typeof updateShape>): { after: DesignDocument; restored: DesignDocument } {
  const full = normalizeAfterEdit(doc, tx);
  const after = applyChanges(doc, full.redo);
  return { after, restored: applyChanges(after, full.undo) };
}

describe('flex engine', () => {
  const kids = [{ id: 'a', width: 20, height: 10 }, { id: 'b', width: 30, height: 20 }];

  it('places fixed children with gap and padding', () => {
    const result = computeFlex({ width: 200, height: 50, layout: flex() }, kids);
    expect(result.boxes.get('a')).toEqual({ x: 5, y: 5, width: 20, height: 10 });
    expect(result.boxes.get('b')).toEqual({ x: 35, y: 5, width: 30, height: 20 });
    expect([result.width, result.height]).toEqual([200, 50]);
  });

  it('hugs content on the axes marked auto', () => {
    const result = computeFlex({ width: 200, height: 50, layout: flex(), item: { h: 'auto', v: 'auto' } }, kids);
    expect([result.width, result.height]).toEqual([70, 30]);
  });

  it('shares free space among fill children within max sizes', () => {
    const result = computeFlex({ width: 200, height: 50, layout: flex() }, [{ id: 'a', width: 20, height: 10, item: { h: 'fill', maxWidth: 40 } }, { id: 'b', width: 30, height: 20, item: { h: 'fill' } }]);
    expect(result.boxes.get('a')!.width).toBe(40);
    expect(result.boxes.get('b')!.width).toBe(140);
    expect(distribute(100, [0, 0, 0], [10, Infinity, Infinity])).toEqual([10, 45, 45]);
  });

  it('ignores the stored gap for auto spacing and centers on the cross axis', () => {
    const result = computeFlex({ width: 100, height: 40, layout: flex({ gap: 500, justify: 'space-between', align: 'center', padding: [0, 0, 0, 0] }) }, kids);
    expect(result.boxes.get('a')).toEqual({ x: 0, y: 15, width: 20, height: 10 });
    expect(result.boxes.get('b')).toEqual({ x: 70, y: 10, width: 30, height: 20 });
  });

  it('wraps into lines and stretches across the line', () => {
    const result = computeFlex({ width: 60, height: 100, layout: flex({ wrap: true, padding: [0, 0, 0, 0], gap: 5, crossGap: 4 }) },
      [{ id: 'a', width: 30, height: 10 }, { id: 'b', width: 30, height: 20 }, { id: 'c', width: 10, height: 5, item: { v: 'fill' } }]);
    expect(result.boxes.get('b')).toEqual({ x: 0, y: 14, width: 30, height: 20 });
    expect(result.boxes.get('c')).toEqual({ x: 35, y: 14, width: 10, height: 20 });
  });

  it('applies constraints when the parent size changes', () => {
    const child = { x: 10, y: 10, width: 20, height: 20 };
    const old = { width: 100, height: 100 };
    const next = { width: 200, height: 150 };
    expect(applyConstraints(child, old, next, { h: 'right', v: 'bottom' })).toEqual({ x: 110, y: 60, width: 20, height: 20 });
    expect(applyConstraints(child, old, next, { h: 'left-right', v: 'center' })).toEqual({ x: 10, y: 35, width: 120, height: 20 });
    expect(applyConstraints(child, old, next, { h: 'scale', v: 'top' })).toEqual({ x: 20, y: 10, width: 40, height: 20 });
  });
});

describe('layout in the document', () => {
  it('reflows children when auto layout is added and restores them on undo', () => {
    const doc = sampleDocument();
    const { after, restored } = commit(doc, updateShape(doc, PAGE, 'frame-1', { layout: flex({ direction: 'column', padding: [20, 20, 20, 20] }) }));
    expect(node(after, 'rect-1')).toMatchObject({ x: 140, y: 115 });
    expect(node(after, 'text-1')).toMatchObject({ x: 140, y: 115 + 336 + 10 });
    expect(restored).toEqual(doc);
  });

  it('grows a hugging parent when a child is added, and the parent of that parent too', () => {
    const base = sampleDocument();
    const outer = applyChanges(base, normalizeAfterEdit(base, updateShape(base, PAGE, 'frame-1', { layout: flex({ direction: 'column' }), item: { v: 'auto' } })).redo);
    const before = node(outer, 'frame-1').height;
    const tx = addShape(outer, PAGE, { id: 'extra', type: 'rectangle', name: 'Extra', parentId: 'frame-1', x: 0, y: 0, width: 50, height: 40, fills: solid('#000000') });
    const { after } = commit(outer, tx);
    expect(node(after, 'frame-1').height).toBe(before + 40 + 10);
    expect(node(after, 'extra').y).toBe(node(after, 'text-3').y + node(after, 'text-3').height + 10);
  });

  it('switches a fill child to fixed width only when told to and keeps fill otherwise', () => {
    const base = sampleDocument();
    const laid = applyChanges(base, normalizeAfterEdit(base, updateShape(base, PAGE, 'frame-1', { layout: flex({ direction: 'column' }) })).redo);
    const filled = applyChanges(laid, normalizeAfterEdit(laid, updateShape(laid, PAGE, 'rect-2', { item: { h: 'fill' } })).redo);
    expect(node(filled, 'rect-2').width).toBe(720 - 10);
  });

  it('moves children of a resized plain frame by their constraints', () => {
    const base = sampleDocument();
    const pinned = applyChanges(base, updateShape(base, PAGE, 'rect-2', { constraints: { h: 'right', v: 'top' } }).redo);
    const resized = applyChanges(pinned, resizeShape(pinned, PAGE, 'frame-1', { x: 120, y: 95, width: 820, height: 520 }).redo);
    expect(node(resized, 'rect-2').x).toBe(310);
    expect(node(resized, 'rect-1').x).toBe(164);
    const moved = applyChanges(base, resizeShape(base, PAGE, 'frame-1', { x: 220, y: 95, width: 720, height: 520 }).redo);
    expect(node(moved, 'rect-1').x).toBe(264);
  });

  it('finds the drop index along the main axis', () => {
    const base = sampleDocument();
    const laid = applyChanges(base, normalizeAfterEdit(base, updateShape(base, PAGE, 'frame-1', { layout: flex({ direction: 'column' }) })).redo);
    const second = node(laid, 'text-1');
    expect(dropIndex(page(laid), 'frame-1', { x: 300, y: second.y + 1 }, new Set(['rect-2']))).toBe(1);
    expect(dropIndex(page(laid), 'frame-1', { x: 300, y: 10000 }, new Set(['rect-2']))).toBe(4);
  });

  it('drops the display-only layout fields of older documents', () => {
    const v3 = JSON.parse(JSON.stringify(sampleDocument())) as { version: number; pages: Array<{ objects: Record<string, Record<string, unknown>> }> };
    v3.version = 3;
    v3.pages[0]!.objects['frame-1']!.layout = 'VERTICAL';
    v3.pages[0]!.objects['frame-1']!.gap = 80;
    const doc = parseDocument(JSON.stringify(v3));
    expect(node(doc, 'frame-1').layout).toBeUndefined();
    expect('gap' in node(doc, 'frame-1')).toBe(false);
  });

  it('exports auto layout as CSS flex with nested children', () => {
    const base = sampleDocument();
    const laid = applyChanges(base, normalizeAfterEdit(base, updateShape(base, PAGE, 'frame-1', { layout: flex({ direction: 'column', justify: 'center' }) })).redo);
    const { code, css } = exportTsx(laid, PAGE, 'frame-1');
    expect(css).toContain('display: flex;');
    expect(css).toContain('flex-direction: column;');
    expect(css).toContain('justify-content: center;');
    expect(css).not.toContain('left: 44px');
    expect(() => transformSync(code, { loader: 'tsx', jsx: 'automatic' })).not.toThrow();
  });
});

const fnode = (localID: number, type: string, name: string, patch: Partial<FigNode> = {}): FigNode => ({
  guid: { sessionID: 1, localID }, type, name, size: { x: 100, y: 40 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, ...patch
});

describe('Figma auto layout import', () => {
  it('maps stack fields, strokes in layout, child grow, stretch, absolute and constraints', () => {
    const root = fnode(1, 'FRAME', 'Root', { size: { x: 400, y: 300 } });
    const row = fnode(2, 'FRAME', 'Row', {
      stackMode: 'HORIZONTAL', stackSpacing: 8, stackVerticalPadding: 4, stackHorizontalPadding: 6, stackPaddingRight: 7, stackPaddingBottom: 5,
      stackPrimaryAlignItems: 'SPACE_EVENLY', stackCounterAlignItems: 'CENTER', stackPrimarySizing: 'FIXED', stackCounterSizing: 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
      bordersTakeSpace: true, strokeAlign: 'INSIDE', strokeWeight: 1, strokePaints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]
    });
    const grow = fnode(3, 'RECTANGLE', 'Grow', { stackChildPrimaryGrow: 1, stackChildAlignSelf: 'STRETCH' });
    const floating = fnode(4, 'RECTANGLE', 'Floating', { stackPositioning: 'ABSOLUTE' });
    const pinned = fnode(5, 'RECTANGLE', 'Pinned', { horizontalConstraint: 'MAX', verticalConstraint: 'STRETCH' });
    const fig = { nodes: [root, row, grow, floating, pinned], nodeMap: new Map([root, row, grow, floating, pinned].map((n) => [`1:${n.guid.localID}`, n])),
      childrenMap: new Map([['1:1', [row, pinned]], ['1:2', [grow, floating]]]), images: new Map() } as unknown as FigDocument;
    const [, rowNode, growNode, floatingNode, pinnedNode] = walkPage(importFigNode(fig, '1:1').document.pages[0]!);
    expect(rowNode).toMatchObject({ layout: { direction: 'row', gap: 8, padding: [5, 8, 6, 7], justify: 'space-between', align: 'center' }, item: { v: 'auto' } });
    expect(growNode!.item).toEqual({ h: 'fill', v: 'fill' });
    expect(floatingNode!.item).toEqual({ absolute: true });
    expect(pinnedNode!.constraints).toEqual({ h: 'right', v: 'top-bottom' });
  });

  const file = process.env.FIGMA_TEST_FILE;
  (file ? it : it.skip)('reproduces the layout Figma stored in the file for every auto layout container', () => {
    const fig = parseFig(new Uint8Array(readFileSync(file!)));
    for (const rootId of ['779:23219', '286:56425', '779:15664', '3:3366']) {
      const { document } = importFigNode(fig, rootId);
      const imported = page(document);
      const containers = layoutContainers(imported);
      expect(containers.length).toBeGreaterThan(0);
      for (const container of containers) {
        const changes = layoutContainer(document, imported.id, container.id).redo.filter((change) => change.type === 'modObj');
        const worst = Math.max(0, ...changes.flatMap((change) => Object.entries(change.type === 'modObj' ? change.set : {})
          .filter(([key]) => ['x', 'y', 'width', 'height'].includes(key))
          .map(([key, value]) => Math.abs((value as number) - (imported.objects[change.type === 'modObj' ? change.id : '']![key as 'x'] as number)))));
        expect(worst, `${rootId} ${container.name}`).toBeLessThanOrEqual(0.5);
      }
    }
  });
});
