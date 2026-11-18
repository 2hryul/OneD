import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFig, type FigDocument, type FigNode } from 'openfig-core';
import { parseDocument, sampleDocument, solid, walkPage, type DesignNode } from '../src/model';
import { linearGradient, paintsToBackground, strokeAndEffectCss, textCss, textRuns, withAlpha } from '../src/styleCss';
import { importFigNode } from '../src/figmaImport';
import { lineHeightPx, letterSpacingPx } from '../src/figStyles';
import { rotationDegrees } from '../src/geometry';

const none = () => null;
const box = (patch: Partial<DesignNode>): DesignNode => ({ id: 'n', type: 'rectangle', name: 'N', parentId: null, x: 0, y: 0, width: 100, height: 50, transform: [1, 0, 0, 1, 0, 0], fills: [], ...patch });

describe('document version 3', () => {
  it('turns the single fill of a version 2 document into a fill list', () => {
    const v2 = JSON.parse(JSON.stringify(sampleDocument())) as { version: number; pages: Array<{ objects: Record<string, Record<string, unknown>> }> };
    v2.version = 2;
    for (const node of Object.values(v2.pages[0]!.objects)) { node.fill = node.id === 'rect-1' ? 'transparent' : '#123456'; delete node.fills; }
    const doc = parseDocument(JSON.stringify(v2));
    expect(doc.version).toBe(4);
    expect(doc.pages[0]!.objects['rect-1']!.fills).toEqual([]);
    expect(doc.pages[0]!.objects['frame-1']!.fills).toEqual(solid('#123456'));
  });

  it('rejects malformed styles', () => {
    const bad = sampleDocument();
    (bad.pages[0]!.objects['rect-1'] as unknown as Record<string, unknown>).fills = [{ type: 'linear', stops: 'x' }];
    expect(() => parseDocument(JSON.stringify(bad))).toThrow();
    const badStroke = sampleDocument();
    (badStroke.pages[0]!.objects['rect-1'] as unknown as Record<string, unknown>).strokes = [{ color: '#000', width: -1, align: 'inside' }];
    expect(() => parseDocument(JSON.stringify(badStroke))).toThrow();
  });
});

describe('style CSS', () => {
  it('stacks fills with the last fill on top', () => {
    expect(paintsToBackground([{ type: 'solid', color: '#ff0000' }, { type: 'solid', color: '#00ff00', opacity: 0.5 }], 10, 10, none))
      .toBe('linear-gradient(#00ff0080, #00ff0080), linear-gradient(#ff0000, #ff0000)');
    expect(paintsToBackground([], 10, 10, none)).toBeUndefined();
  });

  it('maps gradient points onto the CSS gradient line', () => {
    expect(linearGradient({ x: 0.5, y: 0 }, { x: 0.5, y: 1 }, [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }], 1, 100, 50))
      .toBe('linear-gradient(180deg, #000000 0%, #ffffff 100%)');
    expect(linearGradient({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }], 1, 100, 50))
      .toBe('linear-gradient(90deg, #000000 25%, #ffffff 75%)');
  });

  it('shows a placeholder for an image that is not loaded and uses the fit for a loaded one', () => {
    expect(paintsToBackground([{ type: 'image', assetId: 'a', fit: 'fit' }], 10, 10, () => 'blob:x')).toBe('url("blob:x") center / contain no-repeat');
    expect(paintsToBackground([{ type: 'image', assetId: 'a', fit: 'fit' }], 10, 10, none)).toContain('repeating-conic-gradient');
  });

  it('draws strokes without borders and shadows by fill presence', () => {
    const css = strokeAndEffectCss(box({ fills: solid('#fff'), strokes: [{ color: '#111111', width: 2, align: 'outside' }, { color: '#222222', width: 4, align: 'inside', dash: [4, 4] }],
      effects: [{ type: 'drop-shadow', x: 0, y: 4, blur: 10, spread: 1, color: '#00000040' }, { type: 'layer-blur', radius: 8 }] }));
    expect(css.outline).toBe('4px dashed #222222');
    expect(css.outlineOffset).toBe('-4px');
    expect(css.boxShadow).toBe('0 0 0 2px #111111, 0px 4px 10px 1px #00000040');
    expect(css.filter).toBe('blur(4px)');
    expect(strokeAndEffectCss(box({ type: 'group', effects: [{ type: 'drop-shadow', x: 1, y: 2, blur: 6, spread: 0, color: '#000000' }] })).filter).toBe('drop-shadow(1px 2px 3px #000000)');
  });

  it('applies text alignment, spacing and span runs', () => {
    const text = box({ type: 'text', fills: solid('#333333'), text: 'Hello world', textAlign: 'center', verticalAlign: 'bottom', lineHeight: 24, letterSpacing: 0.5,
      spans: [{ start: 6, end: 11, fontWeight: 700 }] });
    expect(textCss(text)).toMatchObject({ color: '#333333', textAlign: 'center', lineHeight: '24px', letterSpacing: '0.5px', justifyContent: 'flex-end' });
    expect(textRuns(text).map((run) => [run.text, run.span?.fontWeight])).toEqual([['Hello ', undefined], ['world', 700]]);
    expect(withAlpha('#ff000080', 0.5)).toBe('#ff000040');
  });
});

const guid = (localID: number) => ({ sessionID: 1, localID });
const fnode = (localID: number, type: string, name: string, patch: Partial<FigNode> = {}): FigNode => ({
  guid: guid(localID), type, name, size: { x: 100, y: 40 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, ...patch
});

function figOf(nodes: FigNode[], children: Record<string, FigNode[]>, images: Record<string, Uint8Array> = {}): FigDocument {
  return { nodes, nodeMap: new Map(nodes.map((node) => [`1:${node.guid.localID}`, node])), childrenMap: new Map(Object.entries(children)), images: new Map(Object.entries(images)) } as unknown as FigDocument;
}

describe('Figma style import', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const hash = new Uint8Array(20).fill(0xab);
  const hashHex = 'ab'.repeat(20);

  it('converts fills, strokes, effects, text style and images, and reports what it cannot convert', () => {
    const root = fnode(1, 'FRAME', 'Screen', { size: { x: 400, y: 300 }, fillPaints: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }] });
    const card = fnode(2, 'RECTANGLE', 'Card', {
      transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 20 },
      fillPaints: [{ type: 'IMAGE', image: { hash }, imageScaleMode: 'FIT' } as never, { type: 'GRADIENT_ANGULAR' }],
      strokePaints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }], strokeWeight: 2, strokeAlign: 'INSIDE', dashPattern: [10, 5],
      effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 5 }, radius: 10, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.1 } }, { type: 'NOISE' }]
    });
    const title = fnode(3, 'TEXT', 'Title', {
      transform: { m00: 1, m01: 0, m02: 10, m10: 0, m11: 1, m12: 80 }, fontSize: 20, fontName: { family: 'Inter', style: 'Regular' },
      lineHeight: { value: 1.5, units: 'RAW' }, letterSpacing: { value: 5, units: 'PERCENT' }, textAlignHorizontal: 'CENTER', textAlignVertical: 'CENTER',
      textData: { characters: 'Hi there', characterStyleIDs: [0, 0, 0, 7, 7, 7, 7, 7], styleOverrideTable: [{ styleID: 7, fontName: { family: 'Inter', style: 'Bold' } }] } as never,
      fillPaints: [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }]
    });
    const result = importFigNode(figOf([root, card, title], { '1:1': [card, title] }, { [hashHex]: png }), '1:1');
    const [, cardNode, titleNode] = walkPage(result.document.pages[0]!);
    expect(cardNode).toMatchObject({ x: 10, y: 20, fills: [{ type: 'image', assetId: hashHex, fit: 'fit' }], strokes: [{ color: '#000000', width: 2, align: 'inside', dash: [10, 5] }],
      effects: [{ type: 'drop-shadow', x: 0, y: 5, blur: 10, spread: 0, color: '#0000001a' }] });
    expect(titleNode).toMatchObject({ text: 'Hi there', textAlign: 'center', verticalAlign: 'middle', lineHeight: 30, letterSpacing: 1, spans: [{ start: 3, end: 8, fontWeight: 700, fontFamily: 'Inter' }],
      fills: [{ type: 'solid', color: '#333333' }] });
    expect(result.assets).toEqual([{ id: hashHex, mime: 'image/png', bytes: png }]);
    expect(result.report.issues.map((item) => item.kind).sort()).toEqual(['effect-unsupported', 'paint-unsupported']);
  });

  it('places children of a rotated parent and keeps the rotation', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const root = fnode(1, 'FRAME', 'Screen', { size: { x: 400, y: 300 } });
    const turned = fnode(2, 'FRAME', 'Turned', { size: { x: 100, y: 40 }, transform: { m00: c, m01: -s, m02: 50, m10: s, m11: c, m12: 60 } });
    const dot = fnode(3, 'RECTANGLE', 'Dot', { size: { x: 10, y: 10 }, transform: { m00: 1, m01: 0, m02: 20, m10: 0, m11: 1, m12: 0 } });
    const result = importFigNode(figOf([root, turned, dot], { '1:1': [turned], '1:2': [dot] }), '1:1');
    const [, frame, inner] = walkPage(result.document.pages[0]!);
    expect(rotationDegrees(frame!.transform)).toBe(30);
    expect(rotationDegrees(inner!.transform)).toBe(30);
    // Dot center in Turned local space is (25, 5). Rotated by 30deg and moved by (50, 60).
    expect(inner!.x + 5).toBeCloseTo(50 + 25 * c - 5 * s, 1);
    expect(inner!.y + 5).toBeCloseTo(60 + 25 * s + 5 * c, 1);
  });

  it('converts Figma units for line height and letter spacing', () => {
    expect(lineHeightPx({ value: 24, units: 'PIXELS' }, 16)).toBe(24);
    expect(lineHeightPx({ value: 150, units: 'PERCENT' }, 16)).toBe(24);
    expect(lineHeightPx({ value: 1.3, units: 'RAW' }, 20)).toBe(26);
    expect(letterSpacingPx({ value: -2, units: 'PERCENT' }, 50)).toBe(-1);
    expect(letterSpacingPx({ value: 0, units: 'PERCENT' }, 50)).toBeUndefined();
  });

  const file = process.env.FIGMA_TEST_FILE;
  (file ? it : it.skip)('imports styles and a detailed report from the supplied Figma file', () => {
    const fig = parseFig(new Uint8Array(readFileSync(file!)));
    const contents = importFigNode(fig, '779:23219');
    const nodes = walkPage(contents.document.pages[0]!);
    expect(nodes.some((node) => node.strokes?.length)).toBe(true);
    expect(nodes.some((node) => node.type === 'text' && node.lineHeight !== undefined)).toBe(true);
    expect(contents.report.issues.filter((item) => item.kind.startsWith('override-')).length).toBe(contents.report.unappliedOverrides);
    expect(parseDocument(JSON.stringify(contents.document))).toEqual(contents.document);
    const partners = importFigNode(fig, '286:56425');
    const partnerNodes = walkPage(partners.document.pages[0]!);
    expect(partnerNodes.some((node) => node.fills.some((paint) => paint.type === 'linear'))).toBe(true);
    expect(partnerNodes.some((node) => node.fills.some((paint) => paint.type === 'image'))).toBe(true);
    expect(partners.assets.length).toBeGreaterThan(0);
  });
});

describe('vector network paths', () => {
  it('joins loop segments in either direction into one closed path and scales to the node size', async () => {
    const { encodeVectorNetwork } = await import('openfig-core');
    const { vectorNetworkPaths } = await import('../src/vectorNetwork');
    const blob = encodeVectorNetwork({
      vertices: [{ x: 0, y: 0, styleID: 0 }, { x: 10, y: 0, styleID: 0 }, { x: 10, y: 10, styleID: 0 }],
      segments: [
        { start: { vertex: 0, dx: 0, dy: 0 }, end: { vertex: 1, dx: 0, dy: 0 }, isStraight: true },
        { start: { vertex: 2, dx: 0, dy: 0 }, end: { vertex: 1, dx: 0, dy: 0 }, isStraight: true },
        { start: { vertex: 2, dx: 0, dy: 0 }, end: { vertex: 0, dx: 0, dy: 0 }, isStraight: true }
      ],
      regions: [{ windingRule: 'ODD', styleID: 0, loops: [[0, 1, 2]] }]
    });
    const fig = { message: { blobs: [{ bytes: blob }] } } as unknown as FigDocument;
    const node = fnode(9, 'VECTOR', 'Tri', { size: { x: 20, y: 20 }, vectorData: { vectorNetworkBlob: 0, normalizedSize: { x: 10, y: 10 } } });
    expect(vectorNetworkPaths(fig, node)).toEqual({
      fills: [{ d: 'M0 0 L20 0 L20 20 L0 0 Z', evenOdd: true }],
      strokes: ['M0 0 L20 0', 'M20 20 L20 0', 'M20 20 L0 0']
    });
  });
});
