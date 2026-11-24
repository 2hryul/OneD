import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { parseDocument, sampleDocument, solid, walkPage, type DesignDocument } from '../src/model';
import { addShape, applyChanges, deleteShape, moveShapes, recordTransaction, reparentShape, replaceDocument, updateShape, MERGE_WINDOW_MS, type HistoryEntry, type Transaction } from '../src/changes';
import { exportTsx } from '../src/export';

const PAGE = 'page-1';
const page = (doc: DesignDocument) => doc.pages[0]!;
const node = (doc: DesignDocument, id: string) => page(doc).objects[id]!;

function roundTrip(doc: DesignDocument, tx: Transaction): { after: DesignDocument; restored: DesignDocument } {
  const after = applyChanges(doc, tx.redo);
  return { after, restored: applyChanges(after, tx.undo) };
}

describe('document model v2', () => {
  it('keeps children order as the layer and drawing order', () => {
    const doc = sampleDocument();
    expect(page(doc).children).toEqual(['frame-1']);
    expect(node(doc, 'frame-1').children).toEqual(['rect-1', 'text-1', 'text-2', 'rect-2', 'text-3']);
    expect(walkPage(page(doc)).map((item) => item.id)).toEqual(['frame-1', 'rect-1', 'text-1', 'text-2', 'rect-2', 'text-3']);
    expect(node(doc, 'rect-1').transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('migrates a version 1 document without losing nodes, hierarchy or values', () => {
    const v1 = { version: 1, name: 'Old file', nodes: [
      { id: 'f', type: 'frame', name: 'F', parentId: null, x: 0, y: 0, width: 100, height: 80, fill: '#ffffff' },
      { id: 'a', type: 'text', name: 'A', parentId: 'f', x: 5, y: 6, width: 50, height: 20, fill: '#000000', text: 'Hi', fontSize: 14 },
      { id: 'b', type: 'rectangle', name: 'B', parentId: 'f', x: 10, y: 10, width: 20, height: 20, fill: '#ff0000', radius: 4 },
      { id: 'c', type: 'ellipse', name: 'C', parentId: null, x: 200, y: 0, width: 30, height: 30, fill: '#00ff00' }
    ] };
    const doc = parseDocument(JSON.stringify(v1));
    expect(doc.version).toBe(5);
    expect(doc.name).toBe('Old file');
    expect(node(doc, 'b').fills).toEqual([{ type: 'solid', color: '#ff0000' }]);
    expect(page(doc).children).toEqual(['f', 'c']);
    expect(node(doc, 'f').children).toEqual(['a', 'b']);
    expect(node(doc, 'a')).toMatchObject({ parentId: 'f', x: 5, y: 6, text: 'Hi', fontSize: 14 });
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });

  it('rejects broken trees', () => {
    const doc = sampleDocument();
    const selfParent = structuredClone(doc);
    page(selfParent).objects['frame-1']!.parentId = 'frame-1';
    expect(() => parseDocument(JSON.stringify(selfParent))).toThrow();
    const orphan = structuredClone(doc);
    node(orphan, 'frame-1').children = ['rect-1'];
    expect(() => parseDocument(JSON.stringify(orphan))).toThrow();
    const twice = structuredClone(doc);
    page(twice).children = ['frame-1', 'frame-1'];
    expect(() => parseDocument(JSON.stringify(twice))).toThrow();
    expect(() => parseDocument('{"version":2,"name":"x","pages":[]}')).toThrow();
    expect(() => parseDocument('{"version":1,"name":"x","nodes":[{"id":"a"}]}')).toThrow();
  });

  it('keeps a layer role through save and reopen and rejects unknown roles', () => {
    const doc = sampleDocument();
    node(doc, 'rect-1').role = 'button';
    expect(node(parseDocument(JSON.stringify(doc)), 'rect-1').role).toBe('button');
    const unknown = structuredClone(doc);
    (node(unknown, 'rect-1') as { role?: string }).role = 'carousel';
    expect(() => parseDocument(JSON.stringify(unknown))).toThrow('Invalid role');
  });
});

describe('changes', () => {
  it('moves a frame with its descendants and undoes it', () => {
    const doc = sampleDocument();
    const { after, restored } = roundTrip(doc, moveShapes(doc, PAGE, 'frame-1', 20, 30));
    expect(node(after, 'frame-1').x).toBe(140);
    expect(node(after, 'text-1').x).toBe(230);
    expect(node(doc, 'text-1').x).toBe(210);
    expect(restored).toEqual(doc);
  });

  it('deletes a frame with its children and restores them in place', () => {
    const doc = sampleDocument();
    const { after, restored } = roundTrip(doc, deleteShape(doc, PAGE, 'frame-1'));
    expect(walkPage(page(after))).toHaveLength(0);
    expect(restored).toEqual(doc);
  });

  it('restores a deleted middle child at its original index', () => {
    const doc = sampleDocument();
    const { after, restored } = roundTrip(doc, deleteShape(doc, PAGE, 'text-2'));
    expect(node(after, 'frame-1').children).toEqual(['rect-1', 'text-1', 'rect-2', 'text-3']);
    expect(node(restored, 'frame-1').children).toEqual(['rect-1', 'text-1', 'text-2', 'rect-2', 'text-3']);
  });

  it('adds a shape on top of its parent and undoes it', () => {
    const doc = sampleDocument();
    const tx = addShape(doc, PAGE, { id: 'new', type: 'rectangle', name: 'N', parentId: 'frame-1', x: 1, y: 1, width: 5, height: 5, fills: solid('#000000') });
    const { after, restored } = roundTrip(doc, tx);
    expect(node(after, 'frame-1').children!.at(-1)).toBe('new');
    expect(restored).toEqual(doc);
    expect(() => addShape(doc, PAGE, { id: 'x', type: 'text', name: 'X', parentId: 'rect-1', x: 0, y: 0, width: 1, height: 1, fills: solid('#000000') })).toThrow();
    expect(() => addShape(doc, PAGE, { id: 'rect-1', type: 'text', name: 'X', parentId: null, x: 0, y: 0, width: 1, height: 1, fills: solid('#000000') })).toThrow();
  });

  it('updates only changed attributes and removes added ones on undo', () => {
    const doc = sampleDocument();
    expect(updateShape(doc, PAGE, 'rect-1', { width: 632 }).redo).toHaveLength(0);
    expect(updateShape(doc, PAGE, 'rect-1', { parentId: 'x', id: 'y' } as never).redo).toHaveLength(0);
    const { after, restored } = roundTrip(doc, updateShape(doc, PAGE, 'rect-1', { width: 10, opacity: 0.5 }));
    expect(node(after, 'rect-1')).toMatchObject({ width: 10, opacity: 0.5 });
    expect(restored).toEqual(doc);
    expect('opacity' in node(restored, 'rect-1')).toBe(false);
  });

  it('reparents a shape and restores its old parent and index', () => {
    const doc = sampleDocument();
    const { after, restored } = roundTrip(doc, reparentShape(doc, PAGE, 'text-2', null, 0));
    expect(page(after).children).toEqual(['text-2', 'frame-1']);
    expect(node(after, 'text-2').parentId).toBeNull();
    expect(restored).toEqual(doc);
    expect(() => applyChanges(doc, reparentShape(doc, PAGE, 'frame-1', 'frame-1', 0).redo)).toThrow();
  });

  it('replaces the whole document and undoes it', () => {
    const doc = sampleDocument();
    const other = { ...sampleDocument(), name: 'Other' };
    const { after, restored } = roundTrip(doc, replaceDocument(doc, other));
    expect(after.name).toBe('Other');
    expect(restored).toBe(doc);
  });
});

describe('history', () => {
  const edit = (doc: DesignDocument, width: number) => updateShape(doc, PAGE, 'rect-1', { width });

  it('merges consecutive edits of the same field into one undo step', () => {
    const doc = sampleDocument();
    let current = doc;
    let past: HistoryEntry[] = [];
    for (const [index, width] of [6, 60, 600].entries()) {
      const tx = edit(current, width);
      current = applyChanges(current, tx.redo);
      past = recordTransaction(past, tx, index * 200, 'rect-1:width');
    }
    expect(past).toHaveLength(1);
    expect(node(current, 'rect-1').width).toBe(600);
    expect(applyChanges(current, past[0]!.undo)).toEqual(doc);
  });

  it('keeps separate steps for other fields or after a pause', () => {
    const doc = sampleDocument();
    const first = edit(doc, 6);
    const second = edit(applyChanges(doc, first.redo), 60);
    expect(recordTransaction(recordTransaction([], first, 0, 'a'), second, 100, 'b')).toHaveLength(2);
    expect(recordTransaction(recordTransaction([], first, 0, 'a'), second, MERGE_WINDOW_MS + 1, 'a')).toHaveLength(2);
    expect(recordTransaction(recordTransaction([], first, 0), second, 10)).toHaveLength(2);
  });
});

describe('React export', () => {
  it('exposes text as props and uses relative coordinates', () => {
    const result = exportTsx(sampleDocument(), PAGE, 'frame-1');
    expect(result.code).toContain('export function LandingPage');
    expect(result.code).toContain('heading0?: string');
    expect(result.code).toContain('heading0 ??');
    expect(result.code).toContain("import './LandingPage.css';");
    expect(result.css).toMatch(/\.landing-page__hero-panel \{[^}]*left: 44px;/);
    expect(() => transformSync(result.code, { loader: 'tsx', jsx: 'automatic' })).not.toThrow();
  });

  it('emits SVG paths for an imported vector', () => {
    const base = sampleDocument();
    const doc = applyChanges(base, addShape(base, PAGE, { id: 'vector-1', parentId: null, type: 'vector', name: 'Icon', x: 0, y: 0,
      width: 10, height: 10, fills: [], vectorPaths: [{ d: 'M0 0 L10 10', fill: 'none', stroke: '#123456', strokeWidth: 2 }] }).redo);
    const code = exportTsx(doc, PAGE, 'vector-1').code;
    expect(code).toContain('<svg');
    expect(code).toContain('M0 0 L10 10');
    expect(() => transformSync(code, { loader: 'tsx', jsx: 'automatic' })).not.toThrow();
  });
});
