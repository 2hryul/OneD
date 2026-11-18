import { beforeAll, describe, expect, it } from 'vitest';
import { parseDocument, sampleDocument, solid, walkPage, type DesignDocument } from '../src/model';
import { addShape, applyChanges, updateShape, type Transaction } from '../src/changes';
import { normalizeAfterEdit } from '../src/normalize';
import { createComponent } from '../src/components';
import { copyNodes, parseClipboard, pasteNodes, selectAllIds } from '../src/clipboard';
import { alignNodes, distributeNodes } from '../src/align';
import { escapeXml, nodesToSvg } from '../src/svgExport';
import { safeFileName } from '../src/imageExport';

const PAGE = 'page-1';
const page = (doc: DesignDocument) => doc.pages[0]!;
const node = (doc: DesignDocument, id: string) => page(doc).objects[id]!;
const apply = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, normalizeAfterEdit(doc, tx).redo);
const counter = () => { let next = 0; return () => `n${++next}`; };

describe('clipboard', () => {
  it('copies a subtree and pastes it with new ids, keeping order and shifting by the offset', () => {
    const doc = sampleDocument();
    const data = copyNodes(page(doc), ['frame-1', 'rect-2'])!;
    expect(data.roots).toEqual(['frame-1']);
    const json = JSON.stringify(data);
    const { tx, rootIds } = pasteNodes(doc, PAGE, parseClipboard(json)!, { parentId: null, dx: 1000, dy: 0, newId: counter() });
    const pasted = apply(doc, tx);
    expect(rootIds).toEqual(['n1']);
    expect(node(pasted, 'n1')).toMatchObject({ name: 'Landing page', x: 1120, parentId: null });
    expect(node(pasted, 'n1').children).toHaveLength(5);
    expect(walkPage(page(pasted), ['n1']).map((item) => item.name)).toEqual(walkPage(page(doc), ['frame-1']).map((item) => item.name));
    expect(parseDocument(JSON.stringify(pasted))).toEqual(pasted);
  });

  it('inserts at a given index and keeps root order', () => {
    const doc = sampleDocument();
    const data = copyNodes(page(doc), ['text-2', 'text-1'])!;
    expect(data.roots).toEqual(['text-1', 'text-2']);
    const pasted = apply(doc, pasteNodes(doc, PAGE, data, { parentId: 'frame-1', index: 1, dx: 0, dy: 0, newId: counter() }).tx);
    expect(node(pasted, 'frame-1').children!.slice(0, 4)).toEqual(['rect-1', 'n1', 'n2', 'text-1']);
  });

  it('turns a copied main component into an instance that follows the main', () => {
    let doc = apply(sampleDocument(), createComponent(sampleDocument(), PAGE, 'frame-1', 'card'));
    const pasted = pasteNodes(doc, PAGE, copyNodes(page(doc), ['frame-1'])!, { parentId: null, dx: 1000, dy: 0, newId: counter() });
    doc = apply(doc, pasted.tx);
    expect(node(doc, 'n1')).toMatchObject({ componentId: 'card', shapeRef: 'frame-1' });
    expect(node(doc, 'n1').mainInstance).toBeUndefined();
    doc = apply(doc, updateShape(doc, PAGE, 'text-1', { text: 'Changed in main' }));
    const copyOfText = walkPage(page(doc), ['n1']).find((item) => item.shapeRef === 'text-1')!;
    expect(copyOfText.text).toBe('Changed in main');
  });

  it('drops component and token links that the target document does not have', () => {
    const source = apply(sampleDocument(), createComponent(sampleDocument(), PAGE, 'frame-1', 'card'));
    const data = copyNodes(page(source), ['frame-1'])!;
    data.nodes[1] = { ...data.nodes[1]!, tokens: { fill: 'missing-token' } };
    const target = sampleDocument();
    const pasted = apply(target, pasteNodes(target, PAGE, data, { parentId: null, dx: 0, dy: 900, newId: counter() }).tx);
    expect(walkPage(page(pasted), ['n1']).some((item) => item.componentId || item.shapeRef || item.tokens)).toBe(false);
  });

  it('rejects clipboard text that is malformed or points outside itself', () => {
    const data = copyNodes(page(sampleDocument()), ['rect-2'])!;
    expect(parseClipboard('plain text')).toBeNull();
    expect(() => parseClipboard(JSON.stringify({ ...data, roots: ['nope'] }))).toThrow('참조');
    expect(() => parseClipboard(JSON.stringify({ ...data, nodes: [{ ...data.nodes[0], width: -1 }] }))).toThrow();
  });

  it('selects all siblings of the selection, or everything at the top', () => {
    expect(selectAllIds(page(sampleDocument()), ['text-1'])).toEqual(['rect-1', 'text-1', 'text-2', 'rect-2', 'text-3']);
    expect(selectAllIds(page(sampleDocument()), [])).toEqual(['frame-1']);
  });
});

describe('align and distribute', () => {
  function shapes(): DesignDocument {
    let doc = sampleDocument();
    for (const [id, x, y, w] of [['a', 1000, 0, 50], ['b', 1100, 40, 100], ['c', 1400, 10, 20]] as const) {
      doc = apply(doc, addShape(doc, PAGE, { id, type: 'rectangle', name: id, parentId: null, x, y, width: w, height: 30, fills: solid('#000000') }));
    }
    return doc;
  }

  it('aligns several shapes to their combined box', () => {
    const doc = apply(shapes(), alignNodes(shapes(), PAGE, ['a', 'b', 'c'], 'left'));
    expect(['a', 'b', 'c'].map((id) => node(doc, id).x)).toEqual([1000, 1000, 1000]);
    const centered = apply(shapes(), alignNodes(shapes(), PAGE, ['a', 'b', 'c'], 'v-center'));
    expect(['a', 'b', 'c'].map((id) => node(centered, id).y + 15)).toEqual([35, 35, 35]);
  });

  it('aligns a single shape to its parent frame', () => {
    const doc = apply(sampleDocument(), alignNodes(sampleDocument(), PAGE, ['rect-2'], 'right'));
    expect(node(doc, 'rect-2').x + node(doc, 'rect-2').width).toBe(840);
    expect(node(doc, 'text-3').x).toBe(238);
  });

  it('spaces three or more shapes evenly and keeps the ends', () => {
    const doc = apply(shapes(), distributeNodes(shapes(), PAGE, ['c', 'a', 'b'], 'horizontal'));
    expect(['a', 'b', 'c'].map((id) => node(doc, id).x)).toEqual([1000, 1175, 1400]);
    expect(() => distributeNodes(shapes(), PAGE, ['a', 'b'], 'horizontal')).toThrow('세 개');
  });

  it('refuses to move shapes that auto layout positions', () => {
    const base = sampleDocument();
    const laidOut = applyChanges(base, updateShape(base, PAGE, 'frame-1', { layout: { type: 'flex', direction: 'column', wrap: false, gap: 0, crossGap: 0, padding: [0, 0, 0, 0], justify: 'start', align: 'start' } }).redo);
    expect(() => alignNodes(laidOut, PAGE, ['rect-1', 'text-1'], 'left')).toThrow('오토 레이아웃');
  });
});

describe('SVG export', () => {
  beforeAll(() => {
    // 노드 환경에는 캔버스가 없어 글 폭을 글자 수로 재는 가짜 컨텍스트를 쓴다.
    Object.assign(globalThis, { Path2D: class { rect(): void {} roundRect(): void {} ellipse(): void {} addPath(): void {} } });
  });
  const measure = new Proxy({}, { get: (_target, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 8, fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 4 }) : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;

  it('writes a self-contained SVG with the export box, gradients, clipping and escaped text', () => {
    let doc = sampleDocument();
    doc = applyChanges(doc, updateShape(doc, PAGE, 'rect-1', { fills: [{ type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] }], strokes: [{ color: '#000000', width: 2, align: 'inside' }] }).redo);
    doc = applyChanges(doc, updateShape(doc, PAGE, 'text-1', { text: 'A < B & "C"' }).redo);
    doc = applyChanges(doc, addShape(doc, PAGE, { id: 'img', type: 'rectangle', name: 'Img', parentId: 'frame-1', x: 130, y: 100, width: 20, height: 20, fills: [{ type: 'image', assetId: 'asset-1', fit: 'fill' }] }).redo);
    const svg = nodesToSvg(page(doc), ['frame-1'], { image: (id) => (id === 'asset-1' ? 'data:image/png;base64,AAAA' : null), measure })!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="720" height="520" viewBox="120 95 720 520">/);
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('clip-path="url(#clip');
    expect(svg).toContain('A &lt; B &amp; &quot;C&quot;');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).not.toContain('<script');
    expect(balanced(svg)).toBe(true);
  });

  it('escapes every XML special character and makes Windows-safe file names', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
    expect(safeFileName('Card: "A/B"?*.')).toBe('Card_ _A_B___');
    expect(safeFileName('   ')).toBe('export');
  });
});

/** 노드 환경에 XML 파서가 없어, 열고 닫는 태그 수가 맞는지만 센다. */
function balanced(text: string): boolean {
  const open = (text.match(/<[a-zA-Z][^>]*>/g) ?? []).filter((tag) => !tag.endsWith('/>')).length;
  const close = (text.match(/<\/[a-zA-Z]+>/g) ?? []).length;
  return open === close;
}
