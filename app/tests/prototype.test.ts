import { describe, expect, it } from 'vitest';
import { parseDocument, sampleDocument, solid, type DesignDocument, type Interaction } from '../src/model';
import { addShape, applyChanges, groupShapes, updateShape, type Transaction } from '../src/changes';
import { createComponent, createInstance } from '../src/components';
import { normalizeAfterEdit } from '../src/normalize';
import { ancestorIds, clickInteraction, fixedChildren, overlayPlacement, runAction, safeUrl, screensOf, startScreen, type ViewerState } from '../src/prototype';
import { actionOfType } from '../src/prototypePanels';

const PAGE = 'page-1';
const page = (doc: DesignDocument) => doc.pages[0]!;
const apply = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, normalizeAfterEdit(doc, tx).redo);

/** 샘플 화면(frame-1) 오른쪽에 화면 둘(detail, menu)을 더한 문서. */
function screens(): DesignDocument {
  let doc = sampleDocument();
  doc = apply(doc, addShape(doc, PAGE, { id: 'detail', type: 'frame', name: 'Detail', parentId: null, x: 900, y: 95, width: 375, height: 1200, fills: solid('#ffffff') }));
  doc = apply(doc, addShape(doc, PAGE, { id: 'header', type: 'rectangle', name: 'Header', parentId: 'detail', x: 900, y: 95, width: 375, height: 60, fills: solid('#000000'), fixedScroll: true }));
  return apply(doc, addShape(doc, PAGE, { id: 'menu', type: 'frame', name: 'Menu', parentId: null, x: 120, y: 900, width: 200, height: 300, fills: solid('#eeeeee') }));
}

const click = (action: Interaction['action']): Interaction[] => [{ trigger: 'click', action }];
const at = (screen: string): ViewerState => ({ screen, overlays: [], history: [] });

describe('prototype model', () => {
  it('saves interactions and fixed scroll, and rejects malformed ones', () => {
    const base = screens();
    const doc = applyChanges(base, updateShape(base, PAGE, 'rect-2', { interactions: [...click({ type: 'navigate', destination: 'detail' }), { trigger: 'after-delay', delay: 500, action: { type: 'back' } }] }).redo);
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    const bad = (interaction: unknown): string => JSON.stringify({ ...doc, pages: [{ ...page(doc), objects: { ...page(doc).objects, 'rect-2': { ...page(doc).objects['rect-2'], interactions: [interaction] } } }] });
    expect(() => parseDocument(bad({ trigger: 'tap', action: { type: 'back' } }))).toThrow('Invalid interaction');
    expect(() => parseDocument(bad({ trigger: 'click', action: { type: 'open-overlay', destination: 'menu', position: 'middle', closeOnOutside: true, background: false } }))).toThrow('Invalid interaction');
    expect(() => parseDocument(bad({ trigger: 'after-delay', delay: -1, action: { type: 'back' } }))).toThrow('Invalid interaction');
  });

  it('syncs main interactions to instances unless the instance changed them', () => {
    const base = sampleDocument();
    let doc = apply(base, createComponent(base, PAGE, 'frame-1', 'card'));
    doc = apply(doc, createInstance(doc, PAGE, 'card', { parentId: null, x: 1000, y: 95 }, () => 'inst').tx);
    doc = apply(doc, updateShape(doc, PAGE, 'rect-2', { interactions: click({ type: 'back' }) }));
    expect(page(doc).objects['inst/rect-2']!.interactions).toEqual(click({ type: 'back' }));
    doc = apply(doc, updateShape(doc, PAGE, 'inst/rect-2', { interactions: click({ type: 'open-url', url: 'https://example.com' }) }));
    expect(page(doc).objects['inst/rect-2']!.touched).toContain('prototype');
    doc = apply(doc, updateShape(doc, PAGE, 'rect-2', { interactions: [] }));
    expect(page(doc).objects['inst/rect-2']!.interactions![0]!.action.type).toBe('open-url');
  });
});

describe('viewer logic', () => {
  it('orders screens for reading and starts at the selected screen', () => {
    const doc = screens();
    expect(screensOf(page(doc)).map((node) => node.id)).toEqual(['frame-1', 'detail', 'menu']);
    expect(startScreen(page(doc), ['header'])).toBe('detail');
    expect(startScreen(page(doc), [])).toBe('frame-1');
    expect(fixedChildren(page(doc), 'detail')).toEqual(new Set(['header']));
  });

  it('finds the click under a label laid over a button, and the screen click elsewhere', () => {
    const base = screens();
    let doc = applyChanges(base, updateShape(base, PAGE, 'frame-1', { interactions: click({ type: 'back' }) }).redo);
    doc = applyChanges(doc, updateShape(doc, PAGE, 'rect-2', { interactions: click({ type: 'navigate', destination: 'detail' }) }).redo);
    // 버튼 글자(text-3)는 버튼 사각형(rect-2)의 형제로 그 위에 그려진다.
    expect(clickInteraction(page(doc), ['text-3', 'rect-2', 'frame-1'], 'frame-1')!.action.type).toBe('navigate');
    expect(clickInteraction(page(doc), ['text-1', 'rect-1', 'frame-1'], 'frame-1')!.action.type).toBe('back');
    expect(clickInteraction(page(doc), ['text-1'], 'frame-1')).toBeNull();
    expect(ancestorIds(page(doc), 'text-3', 'frame-1')).toEqual(['text-3', 'frame-1']);
  });

  it('reaches a group interaction from its child, since groups do not take pointer events', () => {
    const base = screens();
    let doc = apply(base, groupShapes(base, PAGE, ['rect-2', 'text-3'], 'g'));
    doc = applyChanges(doc, updateShape(doc, PAGE, 'g', { interactions: click({ type: 'navigate', destination: 'menu' }) }).redo);
    expect(clickInteraction(page(doc), ['text-3', 'rect-2', 'frame-1'], 'frame-1')!.action).toEqual({ type: 'navigate', destination: 'menu' });
  });

  it('navigates, opens and closes overlays, and goes back', () => {
    const p = page(screens());
    let state = runAction(at('frame-1'), { type: 'navigate', destination: 'detail' }, p);
    expect(state).toEqual({ screen: 'detail', overlays: [], history: ['frame-1'] });
    const open = { type: 'open-overlay', destination: 'menu', position: 'bottom-center', closeOnOutside: true, background: true } as const;
    state = runAction(state, open, p);
    expect(state.overlays).toEqual([{ id: 'menu', position: 'bottom-center', closeOnOutside: true, background: true }]);
    expect(runAction(state, open, p)).toBe(state);
    expect(runAction(state, { ...open, type: 'toggle-overlay' }, p).overlays).toEqual([]);
    expect(runAction(state, { type: 'close-overlay' }, p, 'menu').overlays).toEqual([]);
    expect(runAction(state, { type: 'back' }, p)).toEqual(at('frame-1'));
    expect(runAction(at('frame-1'), { type: 'navigate', destination: 'gone' }, p)).toEqual(at('frame-1'));
    expect(runAction(at('frame-1'), { type: 'navigate', destination: 'header' }, p)).toEqual(at('frame-1'));
    expect(runAction(at('frame-1'), { type: 'back' }, p)).toEqual(at('frame-1'));
  });

  it('places overlays and only opens web URLs', () => {
    expect(overlayPlacement('center', { width: 200, height: 100 }, { width: 400, height: 800 })).toEqual({ x: 100, y: 350 });
    expect(overlayPlacement('bottom-right', { width: 200, height: 100 }, { width: 400, height: 800 })).toEqual({ x: 200, y: 700 });
    expect(overlayPlacement('top-center', { width: 200, height: 100 }, { width: 400, height: 800 })).toEqual({ x: 100, y: 0 });
    expect(safeUrl(' https://example.com/a ')).toBe('https://example.com/a');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('example.com')).toBeNull();
  });

  it('keeps the destination when switching action types in the panel', () => {
    const overlay = actionOfType('open-overlay', { type: 'navigate', destination: 'menu' }, 'detail');
    expect(overlay).toEqual({ type: 'open-overlay', destination: 'menu', position: 'center', closeOnOutside: true, background: false });
    expect(actionOfType('navigate', { type: 'back' }, 'detail')).toEqual({ type: 'navigate', destination: 'detail' });
  });
});
