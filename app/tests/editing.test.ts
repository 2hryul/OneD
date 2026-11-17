import { describe, expect, it } from 'vitest';
import { emptyPage, parseDocument, sampleDocument, walkPage, type DesignDocument } from '../src/model';
import {
  addPage, applyChanges, composeTransactions, deleteShapes, groupShapes, moveShapes, normalizeGroups, reparentShape,
  resizeShape, rotateShape, topLevelIds, ungroupShape, type Transaction
} from '../src/changes';
import { containsPoint, resizeBox, rotationDegrees, worldCorners } from '../src/geometry';
import { snapMove } from '../src/snapping';

const PAGE = 'page-1';
const page = (doc: DesignDocument) => doc.pages[0]!;
const node = (doc: DesignDocument, id: string) => page(doc).objects[id]!;

function commit(doc: DesignDocument, tx: Transaction): { after: DesignDocument; restored: DesignDocument } {
  const full = normalizeGroups(doc, tx);
  const after = applyChanges(doc, full.redo);
  return { after, restored: applyChanges(after, full.undo) };
}

describe('groups', () => {
  it('groups siblings in place, fits the box to the children and survives save and undo', () => {
    const doc = sampleDocument();
    const { after, restored } = commit(doc, groupShapes(doc, PAGE, ['rect-2', 'text-3'], 'g'));
    expect(node(after, 'frame-1').children).toEqual(['rect-1', 'text-1', 'text-2', 'g']);
    expect(node(after, 'g')).toMatchObject({ type: 'group', parentId: 'frame-1', children: ['rect-2', 'text-3'], x: 210, y: 392, width: 164, height: 52 });
    expect(parseDocument(JSON.stringify(after))).toEqual(after);
    expect(restored).toEqual(doc);
  });

  it('refuses to group shapes from different parents', () => {
    const doc = sampleDocument();
    expect(() => groupShapes(doc, PAGE, ['frame-1', 'rect-1'], 'g')).toThrow('같은 부모');
  });

  it('refits the group when a child moves and removes a group left empty', () => {
    const base = sampleDocument();
    const grouped = commit(base, groupShapes(base, PAGE, ['rect-2', 'text-3'], 'g')).after;
    const moved = commit(grouped, moveShapes(grouped, PAGE, 'rect-2', -10, 0)).after;
    expect(node(moved, 'g')).toMatchObject({ x: 200, width: 164 });
    const pulled = commit(grouped, moveShapes(grouped, PAGE, 'text-3', 200, 0)).after;
    expect(node(pulled, 'g')).toMatchObject({ x: 210, width: 338 });
    const emptied = composeTransactions(grouped, [
      (d) => reparentShape(d, PAGE, 'rect-2', 'frame-1', 0),
      (d) => reparentShape(d, PAGE, 'text-3', 'frame-1', 0)
    ]);
    const { after, restored } = commit(grouped, emptied);
    expect(page(after).objects.g).toBeUndefined();
    expect(restored).toEqual(grouped);
  });

  it('ungroups back to the original order and keeps positions', () => {
    const base = sampleDocument();
    const grouped = commit(base, groupShapes(base, PAGE, ['text-1', 'text-2'], 'g')).after;
    const { after } = commit(grouped, ungroupShape(grouped, PAGE, 'g'));
    expect(node(after, 'frame-1').children).toEqual(['rect-1', 'text-1', 'text-2', 'rect-2', 'text-3']);
    expect(node(after, 'text-1')).toMatchObject({ x: 210, y: 218, parentId: 'frame-1' });
  });

  it('scales group children when the group is resized', () => {
    const base = sampleDocument();
    const grouped = commit(base, groupShapes(base, PAGE, ['rect-2', 'text-3'], 'g')).after;
    const { after } = commit(grouped, resizeShape(grouped, PAGE, 'g', { x: 210, y: 392, width: 328, height: 104 }));
    expect(node(after, 'rect-2')).toMatchObject({ x: 210, y: 392, width: 328, height: 104 });
    expect(node(after, 'text-3')).toMatchObject({ x: 266, y: 418, width: 220, height: 52 });
  });
});

describe('rotation', () => {
  it('rotates a frame with its children around the frame center and undoes it', () => {
    const doc = sampleDocument();
    const { after, restored } = commit(doc, rotateShape(doc, PAGE, 'frame-1', 90));
    expect(rotationDegrees(node(after, 'frame-1').transform)).toBe(90);
    expect(rotationDegrees(node(after, 'rect-1').transform)).toBe(90);
    expect(node(after, 'frame-1')).toMatchObject({ x: 120, y: 95 });
    // rect-1 center (480, 318) relative to frame center (480, 355) is (0, -37). After 90deg it becomes (37, 0).
    expect(node(after, 'rect-1')).toMatchObject({ x: 517 - 316, y: 355 - 168 });
    expect(restored).toEqual(doc);
  });

  it('keeps a rotated group box rotated with its children', () => {
    const base = sampleDocument();
    const grouped = commit(base, groupShapes(base, PAGE, ['rect-2', 'text-3'], 'g')).after;
    const rotated = commit(grouped, rotateShape(grouped, PAGE, 'g', 30)).after;
    expect(rotationDegrees(node(rotated, 'g').transform)).toBe(30);
    expect(node(rotated, 'g')).toMatchObject({ width: 164, height: 52 });
  });
});

describe('pages and selection helpers', () => {
  it('adds a page and removes it on undo', () => {
    const doc = sampleDocument();
    const { after, restored } = commit(doc, addPage(doc, emptyPage('p2', 'Page 2')));
    expect(after.pages.map((item) => item.id)).toEqual(['page-1', 'p2']);
    expect(parseDocument(JSON.stringify(after))).toEqual(after);
    expect(restored).toEqual(doc);
  });

  it('drops selected descendants of other selected shapes', () => {
    expect(topLevelIds(page(sampleDocument()), ['rect-1', 'frame-1', 'missing'])).toEqual(['frame-1']);
  });

  it('deletes several shapes in one step', () => {
    const doc = sampleDocument();
    const { after, restored } = commit(doc, deleteShapes(doc, PAGE, ['rect-1', 'text-1']));
    expect(walkPage(page(after)).map((item) => item.id)).toEqual(['frame-1', 'text-2', 'rect-2', 'text-3']);
    expect(restored).toEqual(doc);
  });
});

describe('geometry', () => {
  const box = { x: 0, y: 0, width: 100, height: 50, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] };

  it('resizes from a corner and keeps the opposite corner fixed', () => {
    expect(resizeBox(box, 'se', { x: 20, y: 10 }, false)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
    expect(resizeBox(box, 'nw', { x: 20, y: 10 }, false)).toEqual({ x: 20, y: 10, width: 80, height: 40 });
    expect(resizeBox(box, 'e', { x: 50, y: 10 }, true)).toEqual({ x: 0, y: -12.5, width: 150, height: 75 });
  });

  it('keeps the anchor fixed for a rotated box', () => {
    const turned = { ...box, transform: [0, 1, -1, 0, 0, 0] as [number, number, number, number, number, number] };
    const before = worldCorners(turned)[0]!;
    const resized = resizeBox(turned, 'se', { x: 0, y: 30 }, false);
    expect(resized.width).toBeCloseTo(130);
    const after = worldCorners({ ...resized, transform: turned.transform })[0]!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(containsPoint(turned, { x: 50, y: 25 })).toBe(true);
  });

  it('snaps edges and centers within the threshold and reports a guide', () => {
    const result = snapMove({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 103, y: 50, width: 20, height: 20 }], 95, 0, 4);
    expect(result.dx).toBe(93);
    expect(result.guides).toEqual([{ axis: 'x', at: 103, from: 0, to: 70 }]);
    expect(snapMove({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 200, y: 200, width: 5, height: 5 }], 95, 0, 4).dx).toBe(95);
  });
});
