import { describe, expect, it } from 'vitest';
import { parseDocument, sampleDocument, solid, type DesignDocument, type SubPath } from '../src/model';
import { addShape, applyChanges, createBoolean, fitPathBounds, flattenToPath, moveShapes, resizeShape, updateShape, type Transaction } from '../src/changes';
import { bezierAt, flatten, insertPoint, nearestSegment, parsePathD, pathBounds, pathToD, segmentCurve, splitSegment } from '../src/path';
import { exportTsx } from '../src/export';
import { normalizeAfterEdit } from '../src/normalize';
import { movePathPart, parseTarget, penAddPoint, penNodeInput, penSetHandle, removePathPoint, toggleSmooth } from '../src/pathTools';

const PAGE = 'page-1';
const page = (doc: DesignDocument) => doc.pages[0]!;
const node = (doc: DesignDocument, id: string) => page(doc).objects[id]!;
const apply = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, normalizeAfterEdit(doc, tx).redo);

/** 닫힌 경로들의 넓이 합. 불리언 결과를 모양 대신 넓이로 확인한다. */
function area(subpaths: readonly SubPath[]): number {
  return subpaths.reduce((sum, subpath) => {
    const points = flatten(subpath);
    let twice = 0;
    points.forEach((p, i) => { const q = points[(i + 1) % points.length]!; twice += p.x * q.y - q.x * p.y; });
    return sum + Math.abs(twice) / 2;
  }, 0);
}

const square: SubPath = { closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };

describe('path math', () => {
  it('writes lines and curves as SVG and reads them back', () => {
    const curve: SubPath = { closed: false, points: [{ x: 0, y: 0, out: { x: 0, y: 5 } }, { x: 10, y: 10, in: { x: 5, y: 10 } }] };
    expect(pathToD([square])).toBe('M0 0 L10 0 L10 10 L0 10 L0 0 Z');
    expect(pathToD([curve])).toBe('M0 0 C0 5 5 10 10 10');
    expect(parsePathD(pathToD([square, curve]))).toEqual([square, curve]);
  });

  it('measures bounds through curves, not handles', () => {
    const arc: SubPath = { closed: false, points: [{ x: 0, y: 0, out: { x: 0, y: 40 } }, { x: 10, y: 0, in: { x: 10, y: 40 } }] };
    expect(pathBounds([arc])!.height).toBeCloseTo(30, 0);
  });

  it('splits a curve without changing its shape and inserts a point on the nearest segment', () => {
    const a = { x: 0, y: 0, out: { x: 0, y: 10 } };
    const b = { x: 10, y: 10, in: { x: 10, y: 0 } };
    const [aOut, mid] = splitSegment(a, b, 0.3);
    expect(mid.x).toBeCloseTo(bezierAt(segmentCurve(a, b), 0.3).x, 2);
    const firstHalf = segmentCurve({ ...a, out: aOut }, { x: mid.x, y: mid.y, in: mid.in });
    expect(bezierAt(firstHalf, 0.5).y).toBeCloseTo(bezierAt(segmentCurve(a, b), 0.15).y, 2);
    const near = nearestSegment([square], { x: 5, y: -1 })!;
    expect(near).toMatchObject({ sub: 0, index: 0 });
    expect(insertPoint([square], 0, near.index, near.t)[0]!.points).toHaveLength(5);
  });
});

describe('pen and point editing', () => {
  it('builds a vector from pen points with mirrored handles', () => {
    let draft = penAddPoint({ pageId: PAGE, points: [] }, { x: 100, y: 100 });
    draft = penAddPoint(draft, { x: 200, y: 100 });
    draft = penSetHandle(draft, { x: 220, y: 140 }, 1);
    expect(draft.points[1]).toEqual({ x: 200, y: 100, out: { x: 220, y: 140 }, in: { x: 180, y: 60 } });
    expect(penSetHandle(draft, { x: 200.5, y: 100 }, 1).points[1]).toEqual({ x: 200, y: 100 });
    const input = penNodeInput(draft, false, 'p', null)!;
    expect(input).toMatchObject({ type: 'vector', x: 100, fills: [] });
    expect(input.y).toBeLessThan(100);
    expect(input.path![0]!.points[0]!.x).toBe(0);
    expect(penNodeInput(penAddPoint({ pageId: PAGE, points: [] }, { x: 0, y: 0 }), true, 'q', null)).toBeNull();
  });

  it('moves anchors with their handles and mirrors handles unless broken', () => {
    const path: SubPath[] = [{ closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0, in: { x: 5, y: 0 }, out: { x: 15, y: 0 } }] }];
    expect(movePathPart(path, { sub: 0, index: 1, part: 'anchor' }, { x: 10, y: 10 }, true)[0]!.points[1]).toEqual({ x: 10, y: 10, in: { x: 5, y: 10 }, out: { x: 15, y: 10 } });
    expect(movePathPart(path, { sub: 0, index: 1, part: 'out' }, { x: 10, y: 5 }, true)[0]!.points[1]).toMatchObject({ in: { x: 10, y: -5 }, out: { x: 10, y: 5 } });
    expect(movePathPart(path, { sub: 0, index: 1, part: 'out' }, { x: 10, y: 5 }, false)[0]!.points[1]!.in).toEqual({ x: 5, y: 0 });
  });

  it('toggles corners and removes points', () => {
    const smooth = toggleSmooth([square], 0, 1);
    expect(smooth[0]!.points[1]).toMatchObject({ in: { x: 7.5, y: -2.5 }, out: { x: 12.5, y: 2.5 } });
    expect(toggleSmooth(smooth, 0, 1)[0]!.points[1]).toEqual({ x: 10, y: 0 });
    expect(removePathPoint([square], 0, 0)[0]!.points).toHaveLength(3);
    expect(removePathPoint([{ closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], 0, 0)).toEqual([]);
    expect(parseTarget('0:3:out')).toEqual({ sub: 0, index: 3, part: 'out' });
    expect(parseTarget('0:x:out')).toBeNull();
  });
});

function twoRects(): DesignDocument {
  let doc = sampleDocument();
  doc = apply(doc, addShape(doc, PAGE, { id: 'a', type: 'rectangle', name: 'A', parentId: null, x: 1000, y: 0, width: 100, height: 100, fills: solid('#ff0000') }));
  return apply(doc, addShape(doc, PAGE, { id: 'b', type: 'rectangle', name: 'B', parentId: null, x: 1050, y: 50, width: 100, height: 100, fills: solid('#0000ff') }));
}

const boolDoc = (op: 'union' | 'subtract' | 'intersect' | 'exclude'): DesignDocument => {
  const base = twoRects();
  return apply(base, createBoolean(base, PAGE, ['a', 'b'], op, 'bool'));
};

describe('boolean groups', () => {
  it.each([['union', 17500], ['subtract', 7500], ['intersect', 2500], ['exclude', 15000]] as const)('%s gives the expected area', (op, expected) => {
    const bool = node(boolDoc(op), 'bool');
    expect(bool).toMatchObject({ type: 'group', boolOp: op, fills: solid('#ff0000'), children: ['a', 'b'] });
    expect(area(bool.path!)).toBeCloseTo(expected, 0);
  });

  it('follows its operands and undoes with them', () => {
    const base = boolDoc('union');
    const full = normalizeAfterEdit(base, moveShapes(base, PAGE, 'b', 100, 0));
    const moved = applyChanges(base, full.redo);
    expect(area(node(moved, 'bool').path!)).toBeCloseTo(20000, 0);
    expect(node(moved, 'bool').width).toBe(250);
    expect(applyChanges(moved, full.undo)).toEqual(base);
    expect(parseDocument(JSON.stringify(moved))).toEqual(moved);
  });

  it('flattens to a vector with the same id, place and shape', () => {
    const base = boolDoc('subtract');
    const flat = apply(base, flattenToPath(base, PAGE, 'bool'));
    expect(node(flat, 'bool')).toMatchObject({ type: 'vector', x: 1000, y: 0, fillRule: 'evenodd' });
    expect(page(flat).objects.a).toBeUndefined();
    expect(area(node(flat, 'bool').path!)).toBeCloseTo(7500, 0);
  });

  it('refuses operands inside an instance', () => {
    const doc = twoRects();
    const tagged = applyChanges(doc, updateShape(doc, PAGE, 'a', { shapeRef: 'x' }).redo);
    expect(() => createBoolean(tagged, PAGE, ['a', 'b'], 'union', 'bool')).toThrow();
  });
});

describe('vectors with paths', () => {
  function vectorDoc(): DesignDocument {
    const base = sampleDocument();
    return apply(base, addShape(base, PAGE, { id: 'v', type: 'vector', name: 'V', parentId: null, x: 0, y: 0, width: 10, height: 10, fills: solid('#000000'), path: [square] }));
  }

  it('scales the path when the vector is resized', () => {
    const doc = vectorDoc();
    const resized = apply(doc, resizeShape(doc, PAGE, 'v', { x: 0, y: 0, width: 20, height: 5 }));
    expect(node(resized, 'v').path![0]!.points[2]).toEqual({ x: 20, y: 5 });
  });

  it('fits the box to the path after editing points, keeping the screen position', () => {
    const doc = vectorDoc();
    const edited = applyChanges(doc, updateShape(doc, PAGE, 'v', { path: [{ closed: true, points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 25 }] }] }).redo);
    const fitted = apply(edited, fitPathBounds(edited, PAGE, 'v'));
    expect(node(fitted, 'v')).toMatchObject({ x: 5, y: 5, width: 10, height: 20 });
    expect(node(fitted, 'v').path![0]!.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('turns an ellipse into an editable path of the same size', () => {
    const base = sampleDocument();
    const doc = apply(base, addShape(base, PAGE, { id: 'e', type: 'ellipse', name: 'E', parentId: null, x: 0, y: 0, width: 100, height: 50, fills: solid('#000000') }));
    const flat = apply(doc, flattenToPath(doc, PAGE, 'e'));
    expect(node(flat, 'e').type).toBe('vector');
    expect(area(node(flat, 'e').path!) / (Math.PI * 50 * 25)).toBeCloseTo(1, 2);
  });

  it('exports a boolean group as a compilable SVG path', async () => {
    const { transformSync } = await import('esbuild');
    const code = exportTsx(boolDoc('exclude'), PAGE, 'bool').code;
    expect(code).toContain('fillRule="evenodd"');
    expect(() => transformSync(code, { loader: 'tsx', jsx: 'automatic' })).not.toThrow();
  });
});
