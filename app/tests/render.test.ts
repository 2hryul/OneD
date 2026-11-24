import { beforeAll, describe, expect, it } from 'vitest';
import { parseDocument, sampleDocument, solid, type DesignDocument } from '../src/model';
import { addShape, applyChanges, groupShapes, updateShape } from '../src/changes';
import { frameTitleAt, hitTest } from '../src/hitTest';
import { layerRows } from '../src/selection';
import { makeLargeDocument, NODES_PER_CARD } from '../src/largeDoc';
import { FrameCache, drawPage, renderNodes, type View } from '../src/canvasRenderer';
import type { DesignNode, Page } from '../src/model';

const PAGE = 'page-1';
const page = (doc: DesignDocument) => doc.pages[0]!;

/** 노드 환경에는 Canvas가 없어, 호출만 받아 주는 가짜 2D 컨텍스트로 그리기 흐름(건너뛰기·그림 재사용)을 확인한다. */
function fakeContext(calls: string[] = []): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get: (object, key) => {
      if (key in object) return object[key as string];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => ({ addColorStop: () => undefined });
      return (...args: unknown[]) => { calls.push(String(key)); void args; };
    },
    set: (object, key, value) => { object[key as string] = value; return true; }
  }) as unknown as CanvasRenderingContext2D;
}

beforeAll(() => {
  class FakePath { rect(): void {} roundRect(): void {} ellipse(): void {} addPath(): void {} }
  Object.assign(globalThis, { Path2D: FakePath, DOMMatrix: class {}, document: { createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }) } });
});

const view = (patch: Partial<View> = {}): View => ({ panX: 0, panY: 0, zoom: 1, width: 800, height: 600, dpr: 1, ...patch });

describe('image color adjustment on Canvas', () => {
  it('keeps the layer blur when it adds the image color filter', () => {
    // 그림을 그리는 순간의 ctx.filter를 기록한다. Canvas 렌더러와 PNG 내보내기가 같은 그리기 경로를 쓴다.
    const filters: string[] = [];
    const ctx = fakeContext();
    const recorder = new Proxy(ctx, {
      get: (object, key) => (key === 'drawImage' ? () => { filters.push(String(Reflect.get(object, 'filter'))); } : Reflect.get(object, key)),
      set: (object, key, value) => Reflect.set(object, key, value)
    });
    const photo = (id: string, adjust?: { brightness: number }): DesignNode => ({
      id, type: 'rectangle', name: id, parentId: null, x: 0, y: 0, width: 40, height: 40, transform: [1, 0, 0, 1, 0, 0],
      fills: [{ type: 'image', assetId: 'a', fit: 'stretch', ...(adjust ? { adjust } : {}) }], effects: [{ type: 'layer-blur', radius: 8 }]
    });
    const scene: Page = { id: 'p', name: 'P', children: ['plain', 'adjusted'], objects: { plain: photo('plain'), adjusted: photo('adjusted', { brightness: 1.17 }) } };
    renderNodes(recorder, scene, ['plain', 'adjusted'], { x: 0, y: 0, width: 40, height: 40 }, 1, () => ({ naturalWidth: 10, naturalHeight: 10 }) as never);
    expect(filters).toEqual(['blur(4px)', 'blur(4px) brightness(1.17)']);
  });
});

describe('large document generator', () => {
  it('makes a valid document with the stated node count', () => {
    const doc = makeLargeDocument(20);
    expect(Object.keys(page(doc).objects)).toHaveLength(20 * NODES_PER_CARD);
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });
});

describe('canvas renderer', () => {
  it('draws only what is on screen and skips shapes smaller than half a pixel', () => {
    const doc = makeLargeDocument(100);
    const near = drawPage(fakeContext(), page(doc), view(), () => null, null);
    expect(near.drawn).toBeGreaterThan(0);
    expect(near.drawn).toBeLessThan(100 * NODES_PER_CARD / 4);
    const far = drawPage(fakeContext(), page(doc), view({ zoom: 0.0005 }), () => null, null);
    expect(far.drawn).toBe(0);
  });

  it('reuses frame pictures until a node inside the frame changes', () => {
    const doc = makeLargeDocument(4);
    const cache = new FrameCache();
    const first = drawPage(fakeContext(), page(doc), view(), () => null, null, { store: cache, allowStale: false });
    expect(first.cached).toBe(0);
    expect(drawPage(fakeContext(), page(doc), view({ panX: 5 }), () => null, null, { store: cache, allowStale: false }).cached).toBe(4);
    const edited = applyChanges(doc, updateShape(doc, PAGE, 'c1-title', { text: 'Changed' }).redo);
    expect(drawPage(fakeContext(), page(edited), view(), () => null, null, { store: cache, allowStale: false }).cached).toBe(3);
    const zoomed = drawPage(fakeContext(), page(edited), view({ zoom: 1.1 }), () => null, null, { store: cache, allowStale: true });
    expect(zoomed.stale).toBe(true);
  });

  it('does not cache a frame that contains the text being edited', () => {
    const doc = makeLargeDocument(2);
    const cache = new FrameCache();
    drawPage(fakeContext(), page(doc), view(), () => null, null, { store: cache, allowStale: false });
    expect(drawPage(fakeContext(), page(doc), view(), () => null, 'c0-title', { store: cache, allowStale: false }).cached).toBe(1);
  });
});

describe('hit testing for the canvas renderer', () => {
  function doc(): DesignDocument {
    let next = sampleDocument();
    next = applyChanges(next, addShape(next, PAGE, { id: 'circle', type: 'ellipse', name: 'Circle', parentId: null, x: 1000, y: 0, width: 100, height: 100, fills: solid('#000000') }).redo);
    return next;
  }

  it('finds the topmost shape and passes through locked and hidden ones', () => {
    const base = doc();
    // 버튼 글자(text-3)는 버튼(rect-2) 가운데에 얹혀 있다. 글자 밖의 버튼 가장자리를 누른다.
    expect(hitTest(page(base), { x: 365, y: 400 })).toBe('rect-2');
    expect(hitTest(page(base), { x: 250, y: 415 })).toBe('text-3');
    const locked = applyChanges(base, updateShape(base, PAGE, 'text-3', { locked: true }).redo);
    expect(hitTest(page(locked), { x: 250, y: 415 })).toBe('rect-2');
    expect(hitTest(page(base), { x: 1050, y: 50 })).toBe('circle');
    expect(hitTest(page(base), { x: 1003, y: 3 })).toBeNull();
    expect(hitTest(page(base), { x: 5000, y: 5000 })).toBeNull();
  });

  it('never returns a plain group, and clips children to their frame', () => {
    const base = doc();
    const grouped = applyChanges(base, groupShapes(base, PAGE, ['rect-2', 'text-3'], 'g').redo);
    expect(hitTest(page(grouped), { x: 365, y: 400 })).toBe('rect-2');
    const moved = applyChanges(base, updateShape(base, PAGE, 'rect-2', { x: 820, y: 500, width: 100 }).redo);
    expect(hitTest(page(moved), { x: 900, y: 520 })).toBeNull();
    expect(hitTest(page(moved), { x: 830, y: 520 })).toBe('rect-2');
  });

  it('selects a frame by its title above the frame', () => {
    expect(frameTitleAt(page(doc()), { x: 130, y: 90 }, 1, 16)).toBe('frame-1');
    expect(frameTitleAt(page(doc()), { x: 130, y: 70 }, 1, 16)).toBeNull();
    expect(frameTitleAt(page(doc()), { x: 130, y: 70 }, 2, 16)).toBe('frame-1');
  });
});

describe('layer rows', () => {
  it('lists only expanded containers when a set is given', () => {
    const doc = makeLargeDocument(3);
    expect(layerRows(page(doc))).toHaveLength(3 * NODES_PER_CARD);
    expect(layerRows(page(doc), new Set())).toHaveLength(3);
    // 카드 프레임의 바로 아래 자식은 8개(그룹·버튼 안쪽은 접힘).
    expect(layerRows(page(doc), new Set(['c0-frame'])).length).toBe(3 + 8);
  });
});
