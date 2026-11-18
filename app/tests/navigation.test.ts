import { describe, expect, it } from 'vitest';
import { parseDocument, sampleDocument, type DesignDocument } from '../src/model';
import { applyChanges, updateShape } from '../src/changes';
import { normalizeAfterEdit } from '../src/normalize';
import { reorderNodes, reorderedSiblings } from '../src/arrange';
import { rulerStep, rulerTicks } from '../src/rulers';

const PAGE = 'page-1';
const children = (doc: DesignDocument) => doc.pages[0]!.objects['frame-1']!.children;

describe('layer order', () => {
  const siblings = ['a', 'b', 'c', 'd', 'e'];

  it('moves one step and keeps the order among selected layers', () => {
    expect(reorderedSiblings(siblings, new Set(['b']), 'forward')).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(reorderedSiblings(siblings, new Set(['b', 'c']), 'forward')).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(reorderedSiblings(siblings, new Set(['e']), 'forward')).toEqual(siblings);
    expect(reorderedSiblings(siblings, new Set(['d']), 'backward')).toEqual(['a', 'b', 'd', 'c', 'e']);
  });

  it('moves to the front and back', () => {
    expect(reorderedSiblings(siblings, new Set(['a', 'c']), 'front')).toEqual(['b', 'd', 'e', 'a', 'c']);
    expect(reorderedSiblings(siblings, new Set(['b', 'e']), 'back')).toEqual(['b', 'e', 'a', 'c', 'd']);
  });

  it('applies to the document as one undoable change', () => {
    const doc = sampleDocument();
    const full = normalizeAfterEdit(doc, reorderNodes(doc, PAGE, ['rect-1', 'text-1'], 'front'));
    const next = applyChanges(doc, full.redo);
    expect(children(next)).toEqual(['text-2', 'rect-2', 'text-3', 'rect-1', 'text-1']);
    expect(applyChanges(next, full.undo)).toEqual(doc);
    expect(parseDocument(JSON.stringify(next))).toEqual(next);
    expect(reorderNodes(doc, PAGE, ['text-3'], 'front').redo).toEqual([]);
  });

  it('changes the flow order inside auto layout', () => {
    const base = sampleDocument();
    const laidOut = applyChanges(base, updateShape(base, PAGE, 'frame-1', { layout: { type: 'flex', direction: 'column', wrap: false, gap: 0, crossGap: 0, padding: [0, 0, 0, 0], justify: 'start', align: 'start' } }).redo);
    const settled = applyChanges(laidOut, normalizeAfterEdit(laidOut, { redo: [], undo: [] }).redo);
    const moved = applyChanges(settled, normalizeAfterEdit(settled, reorderNodes(settled, PAGE, ['text-1'], 'backward')).redo);
    expect(children(moved)!.slice(0, 2)).toEqual(['text-1', 'rect-1']);
    expect(moved.pages[0]!.objects['text-1']!.y).toBeLessThan(moved.pages[0]!.objects['rect-1']!.y);
  });
});

describe('rulers', () => {
  it('picks 1·2·5 steps that stay at least 60px apart', () => {
    expect(rulerStep(1)).toBe(100);
    expect(rulerStep(0.5)).toBe(200);
    expect(rulerStep(4)).toBe(20);
    expect(rulerStep(0.02)).toBe(5000);
    for (const zoom of [0.02, 0.37, 1, 2.5, 8]) expect(rulerStep(zoom) * zoom).toBeGreaterThanOrEqual(60);
  });

  it('places ticks where the page coordinates appear on screen', () => {
    const ticks = rulerTicks(-50, 300, 1);
    expect(ticks.filter((tick) => tick.major).map((tick) => [tick.value, tick.at])).toEqual([[100, 50], [200, 150], [300, 250]]);
    expect(ticks.every((tick) => tick.at >= -20 && tick.at <= 300)).toBe(true);
    expect(rulerTicks(0, 100, 1).find((tick) => tick.value === 0)).toMatchObject({ at: 0, major: true });
  });
});
