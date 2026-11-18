import { describe, expect, it } from 'vitest';
import { sampleDocument, solid, type DesignDocument, type FlexLayout } from '../src/model';
import { addShape, applyChanges, createBoolean, flipShapes, groupShapes, resizeShape, rotateShape, updateShape, type Transaction } from '../src/changes';
import { normalizeAfterEdit } from '../src/normalize';
import { measureBetween } from '../src/measure';
import { exportTsx } from '../src/export';

// 점검(2026-11-19)에서 실행으로 확인한 문제의 재발 방지 테스트. 편집은 앱과 같이 normalizeAfterEdit를 거친다.
const PAGE = 'page-1';
const node = (doc: DesignDocument, id: string) => doc.pages[0]!.objects[id]!;
const commit = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, normalizeAfterEdit(doc, tx).redo);
const flex = (patch: Partial<FlexLayout> = {}): FlexLayout => ({ type: 'flex', direction: 'row', wrap: false, gap: 10, crossGap: 10, padding: [5, 5, 5, 5], justify: 'start', align: 'start', ...patch });
const twiceFlipped = (doc: DesignDocument, ids: string[], axis: 'horizontal' | 'vertical'): DesignDocument => {
  const once = commit(doc, flipShapes(doc, PAGE, ids, axis));
  return commit(once, flipShapes(once, PAGE, ids, axis));
};

describe('flip round trips', () => {
  it('keeps coordinates finer than 0.01', () => {
    const base = sampleDocument();
    const doc = applyChanges(base, updateShape(base, PAGE, 'rect-2', { x: 210.333, y: 392.667 }).redo);
    expect(node(twiceFlipped(doc, ['rect-2'], 'horizontal'), 'rect-2')).toEqual(node(doc, 'rect-2'));
  });

  it('restores a selection holding a rotated shape, a rotated group and a boolean group', () => {
    const base = sampleDocument();
    const rotated = applyChanges(base, rotateShape(base, PAGE, 'rect-2', 30).redo);
    expect(twiceFlipped(rotated, ['rect-2', 'text-3', 'text-2'], 'horizontal')).toEqual(rotated);
    const grouped = commit(base, groupShapes(base, PAGE, ['rect-2', 'text-3'], 'g'));
    const turned = commit(grouped, rotateShape(grouped, PAGE, 'g', 17));
    expect(twiceFlipped(turned, ['g'], 'vertical')).toEqual(turned);
    const withEllipse = applyChanges(base, addShape(base, PAGE, { id: 'el', type: 'ellipse', name: 'E', parentId: 'frame-1', x: 300, y: 380, width: 90, height: 70, fills: solid('#000000') }).redo);
    const boolean = commit(withEllipse, createBoolean(withEllipse, PAGE, ['rect-2', 'el'], 'union', 'b'));
    expect(twiceFlipped(boolean, ['b'], 'horizontal')).toEqual(boolean);
  });
});

describe('flip inside auto layout', () => {
  it('keeps a fill child filling', () => {
    const base = sampleDocument();
    const laid = commit(base, updateShape(base, PAGE, 'frame-1', { layout: flex({ direction: 'column' }) }));
    const filled = commit(laid, updateShape(laid, PAGE, 'rect-2', { item: { h: 'fill' } }));
    const flipped = commit(filled, flipShapes(filled, PAGE, ['rect-2'], 'horizontal'));
    const frame = node(flipped, 'frame-1');
    const wider = commit(flipped, resizeShape(flipped, PAGE, 'frame-1', { x: frame.x, y: frame.y, width: frame.width + 100, height: frame.height }));
    expect(node(wider, 'rect-2').width).toBe(node(wider, 'frame-1').width - 10);
  });
});

describe('React export of transformed frames', () => {
  const buttonStyle = (code: string): string => code.split('\n').find((line) => line.includes('"width":164'))!;

  it('places children in the flipped frame so the frame flip is applied once', () => {
    const doc = sampleDocument();
    const flipped = applyChanges(doc, flipShapes(doc, PAGE, ['frame-1'], 'horizontal').redo);
    const code = exportTsx(flipped, PAGE, 'frame-1').code;
    const line = buttonStyle(code);
    const left = Number(/"left":(-?[\d.]+)/.exec(line)![1]);
    // 부모 div의 scaleX(-1)(가운데 기준)를 거친 뒤 보이는 위치가 편집기의 위치와 같아야 한다.
    expect(720 - left - 164).toBe(node(flipped, 'rect-2').x - node(flipped, 'frame-1').x);
    expect(line).not.toContain('scaleX(-1)');
  });

  it('does not rotate children twice inside a rotated frame', () => {
    const doc = sampleDocument();
    const turned = applyChanges(doc, rotateShape(doc, PAGE, 'frame-1', 90).redo);
    const code = exportTsx(turned, PAGE, 'frame-1').code;
    expect(code).toContain('rotate(90deg)');
    expect(buttonStyle(code)).toContain('"left":90,"top":297');
    expect(buttonStyle(code)).not.toContain('rotate(');
  });
});

describe('Alt measure with touching shapes', () => {
  it('draws nothing for a 0 gap, side by side or corner to corner', () => {
    expect(measureBetween({ x: 0, y: 0, width: 100, height: 50 }, { x: 100, y: 0, width: 100, height: 50 })).toEqual([]);
    expect(measureBetween({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 10, width: 10, height: 10 })).toEqual([]);
    expect(measureBetween({ x: 0, y: 0, width: 100, height: 50 }, { x: 100.5, y: 0, width: 100, height: 50 })).toEqual([{ axis: 'x', from: 100, to: 100.5, at: 25, value: 0.5 }]);
  });
});
