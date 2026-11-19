import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import type { FigDocument, FigNode } from 'openfig-core';
import { parseDocument, solid, walkPage, type DesignDocument, type NodeInput } from '../src/model';
import { addShape, applyChanges, createMask, updateShape, type Transaction } from '../src/changes';
import { maskRuns, maskShapes, maskSvg } from '../src/mask';
import { nodesToSvg } from '../src/svgExport';
import { exportTsx } from '../src/export';
import { importFigNode } from '../src/figmaImport';
import { normalizeAfterEdit } from '../src/normalize';

const PAGE = 'page-1';
const node = (doc: DesignDocument, id: string) => doc.pages[0]!.objects[id]!;
const commit = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, normalizeAfterEdit(doc, tx).redo);

/** 200×100 프레임 안에 원(마스크가 될 것)과 그 위의 빨간 사각형·파란 사각형. */
function scene(): DesignDocument {
  let doc: DesignDocument = { version: 5, name: 'Mask', components: {}, tokens: {}, pages: [{ id: PAGE, name: 'Page 1', children: [], objects: {} }] };
  const add = (shape: NodeInput): void => { doc = applyChanges(doc, addShape(doc, PAGE, shape).redo); };
  add({ id: 'frame', type: 'frame', name: 'Frame', parentId: null, x: 0, y: 0, width: 200, height: 100, fills: [] });
  add({ id: 'circle', type: 'ellipse', name: 'Circle', parentId: 'frame', x: 10, y: 10, width: 80, height: 80, fills: solid('#00ff00') });
  add({ id: 'red', type: 'rectangle', name: 'Red', parentId: 'frame', x: 0, y: 0, width: 100, height: 100, fills: solid('#ff0000') });
  add({ id: 'blue', type: 'rectangle', name: 'Blue', parentId: 'frame', x: 50, y: 50, width: 100, height: 40, fills: solid('#0000ff') });
  return doc;
}

describe('mask outline', () => {
  it('turns each shape kind into a local outline', () => {
    const doc = scene();
    expect(maskShapes(node(doc, 'circle'))).toEqual([{ d: 'M0 40A40 40 0 1 0 80 40A40 40 0 1 0 0 40Z', evenodd: false }]);
    expect(maskShapes({ ...node(doc, 'red'), radius: 10, width: 100, height: 40 })[0]!.d).toBe('M10 0H90A10 10 0 0 1 100 10V30A10 10 0 0 1 90 40H10A10 10 0 0 1 0 30V10A10 10 0 0 1 10 0Z');
    expect(maskShapes({ ...node(doc, 'red'), type: 'vector', width: 20, height: 10, viewBox: { width: 10, height: 10 }, vectorPaths: [{ d: 'M0 0L10 10', fill: '#000', fillRule: 'evenodd' }] }))
      .toEqual([{ d: 'M0 0L10 10', evenodd: true, scale: [2, 1] }]);
  });

  it('splits children into runs at each visible mask and ignores hidden masks', () => {
    let doc = scene();
    doc = applyChanges(doc, updateShape(doc, PAGE, 'red', { mask: true }).redo);
    expect(maskRuns(doc.pages[0]!, node(doc, 'frame')).map((run) => [run.mask?.id ?? null, run.ids])).toEqual([[null, ['circle']], ['red', ['blue']]]);
    doc = applyChanges(doc, updateShape(doc, PAGE, 'red', { hidden: true }).redo);
    expect(maskRuns(doc.pages[0]!, node(doc, 'frame')).map((run) => [run.mask?.id ?? null, run.ids])).toEqual([[null, ['circle', 'red', 'blue']]]);
  });

  it('places the mask in parent coordinates for the DOM mask image', () => {
    const doc = scene();
    expect(maskSvg(node(doc, 'frame'), node(doc, 'circle'))).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><g transform="matrix(1 0 0 1 10 10)"><path d="M0 40A40 40 0 1 0 80 40A40 40 0 1 0 0 40Z" fill="#000"/></g></svg>');
  });
});

describe('use as mask', () => {
  it('groups the selection, makes the bottom shape the mask, undoes exactly and survives save and load', () => {
    const doc = scene();
    const tx = normalizeAfterEdit(doc, createMask(doc, PAGE, ['blue', 'circle', 'red'], 'mg'));
    const after = applyChanges(doc, tx.redo);
    expect(node(after, 'mg')).toMatchObject({ type: 'group', name: 'Mask group', children: ['circle', 'red', 'blue'] });
    expect(node(after, 'circle').mask).toBe(true);
    expect(parseDocument(JSON.stringify(after))).toEqual(after);
    expect(applyChanges(after, tx.undo)).toEqual(doc);
    expect(() => createMask(doc, PAGE, ['red'], 'x')).toThrow(/두 개 이상/);
  });

  it('clips the shapes above the mask in SVG export and does not paint the mask itself', () => {
    const doc = commit(scene(), createMask(scene(), PAGE, ['circle', 'red', 'blue'], 'mg'));
    const svg = nodesToSvg(doc.pages[0]!, ['frame'], { resolveAsset: () => null } as never)!;
    expect(svg).toMatch(/<clipPath id="[^"]+"><path d="M0 40A40 40 0 1 0 80 40A40 40 0 1 0 0 40Z" transform="matrix\(1 0 0 1 10 10\)"\/><\/clipPath>/);
    expect(svg).toMatch(/<g clip-path="url\(#[^"]+\)">.*#ff0000.*#0000ff.*<\/g>/);
    expect(svg).not.toContain('#00ff00');
  });
});

describe('mask in React export', () => {
  it('puts the mask on a bare parent when the mask is its first child', () => {
    let doc = scene();
    doc = applyChanges(doc, updateShape(doc, PAGE, 'circle', { mask: true }).redo);
    const { code, css } = exportTsx(doc, PAGE, 'frame');
    expect(code).not.toContain('frame__circle');
    expect(css).toMatch(/\.frame \{[^}]*mask-image: url\("data:image\/svg\+xml,%3Csvg[^"]*"\);\n {2}-webkit-mask-image: url\(/);
    expect(css).toMatch(/\.frame \{[^}]*mask-size: 100% 100%;/);
    transformSync(code, { loader: 'tsx', jsx: 'automatic' });
  });

  it('wraps a masked run when shapes come before the mask', () => {
    let doc = scene();
    doc = applyChanges(doc, updateShape(doc, PAGE, 'red', { mask: true }).redo);
    const { code, css } = exportTsx(doc, PAGE, 'frame');
    expect(code).toMatch(/<div className="frame__circle" \/>\s*<div className="frame__red-mask">\s*<div className="frame__blue" \/>\s*<\/div>/);
    expect(css).toMatch(/\.frame__red-mask \{\n {2}display: block;\n {2}position: absolute;\n {2}left: 0;\n {2}top: 0;\n {2}width: 100%;\n {2}height: 100%;\n {2}mask-image:/);
    transformSync(code, { loader: 'tsx', jsx: 'automatic' });
  });
});

describe('Figma mask import', () => {
  it('keeps the mask flag of imported shapes', () => {
    const f = (localID: number, type: string, name: string, patch: Record<string, unknown> = {}): FigNode => ({ guid: { sessionID: 1, localID }, type, name, size: { x: 16, y: 16 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, ...patch }) as unknown as FigNode;
    const root = f(1, 'FRAME', 'Icon');
    const box = f(2, 'ROUNDED_RECTANGLE', 'Bounding box', { mask: true, fillPaints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }] });
    const glyph = f(3, 'RECTANGLE', 'Glyph', { size: { x: 30, y: 4 } });
    const fig = { nodes: [root, box, glyph], nodeMap: new Map([[`1:1`, root], [`1:2`, box], [`1:3`, glyph]]), childrenMap: new Map([['1:1', [box, glyph]]]), images: new Map() } as unknown as FigDocument;
    const [, boxNode, glyphNode] = walkPage(importFigNode(fig, '1:1').document.pages[0]!);
    expect(boxNode!.mask).toBe(true);
    expect(glyphNode!.mask).toBeUndefined();
  });
});
