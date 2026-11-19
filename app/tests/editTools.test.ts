import { describe, expect, it } from 'vitest';
import { emptyPage, parseDocument, sampleDocument, type DesignDocument } from '../src/model';
import { addPage, applyChanges, deletePage, flipShapes, renamePage, rotateShape } from '../src/changes';
import { createComponent } from '../src/components';
import { isFlipped, rotationDegrees } from '../src/geometry';
import { exportTsx } from '../src/export';
import { measureBetween } from '../src/measure';
import { Room } from '../server/room';

const PAGE = 'page-1';
const node = (doc: DesignDocument, id: string) => doc.pages[0]!.objects[id]!;
const apply = (doc: DesignDocument, tx: { redo: Parameters<typeof applyChanges>[1] }) => applyChanges(doc, tx.redo);

describe('flip', () => {
  it('mirrors one shape in place and flips back to the original', () => {
    const doc = sampleDocument();
    const once = apply(doc, flipShapes(doc, PAGE, ['rect-2'], 'horizontal'));
    expect(node(once, 'rect-2')).toMatchObject({ x: 210, y: 392, transform: [-1, 0, 0, 1, 0, 0] });
    expect(isFlipped(node(once, 'rect-2').transform)).toBe(true);
    expect(rotationDegrees(node(once, 'rect-2').transform)).toBe(0);
    expect(apply(once, flipShapes(once, PAGE, ['rect-2'], 'horizontal'))).toEqual(doc);
  });

  it('mirrors several shapes around the middle of the selection', () => {
    const doc = sampleDocument();
    // rect-2(210..374)와 text-1(210..680)의 가운데는 x=445. rect-2는 516..680으로 간다.
    const tx = flipShapes(doc, PAGE, ['rect-2', 'text-1'], 'horizontal');
    const next = apply(doc, tx);
    expect(node(next, 'rect-2').x).toBe(516);
    expect(node(next, 'text-1').x).toBe(210);
    expect(applyChanges(next, tx.undo)).toEqual(doc);
  });

  it('moves children with a flipped frame and keeps the document valid', () => {
    const doc = sampleDocument();
    const next = apply(doc, flipShapes(doc, PAGE, ['frame-1'], 'vertical'));
    // 프레임(95..615) 가운데 y=355 기준으로 Button(392..444)은 266..318로 간다.
    expect(node(next, 'rect-2')).toMatchObject({ y: 266, transform: [1, 0, 0, -1, 0, 0] });
    expect(parseDocument(JSON.stringify(next))).toEqual(next);
  });

  it('keeps the flip when rotating, and exports it as rotate + scaleX(-1)', () => {
    const doc = sampleDocument();
    const flipped = apply(doc, flipShapes(doc, PAGE, ['rect-2'], 'horizontal'));
    const turned = apply(flipped, rotateShape(flipped, PAGE, 'rect-2', 30));
    expect(rotationDegrees(node(turned, 'rect-2').transform)).toBe(30);
    expect(isFlipped(node(turned, 'rect-2').transform)).toBe(true);
    expect(exportTsx(turned, PAGE, 'frame-1').css).toContain('transform: rotate(30deg) scaleX(-1);');
    expect(exportTsx(flipped, PAGE, 'frame-1').css).toContain('transform: scaleX(-1);');
  });
});

describe('measure', () => {
  const a = { x: 0, y: 0, width: 100, height: 50 };

  it('shows the gap to a shape on the side', () => {
    expect(measureBetween(a, { x: 130, y: 20, width: 40, height: 100 })).toEqual([{ axis: 'x', from: 100, to: 130, at: 35, value: 30 }]);
  });

  it('shows both gaps to a shape placed diagonally', () => {
    const lines = measureBetween(a, { x: 150, y: 80, width: 10, height: 10 });
    expect(lines.map((line) => [line.axis, line.value])).toEqual([['x', 50], ['y', 30]]);
  });

  it('shows the distance to each edge of a containing frame', () => {
    const lines = measureBetween({ x: 20, y: 30, width: 60, height: 40 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(lines.map((line) => [line.axis, line.from, line.to, line.value])).toEqual([['x', 0, 20, 20], ['x', 80, 100, 20], ['y', 0, 30, 30], ['y', 70, 100, 30]]);
  });

  it('drops zero-length lines', () => {
    expect(measureBetween(a, { x: 0, y: 0, width: 100, height: 80 })).toEqual([{ axis: 'y', from: 50, to: 80, at: 50, value: 30 }]);
  });
});

describe('pages', () => {
  const twoPages = (): DesignDocument => apply(sampleDocument(), addPage(sampleDocument(), emptyPage('page-2', 'Page 2')));

  it('renames a page and undoes it', () => {
    const doc = twoPages();
    const tx = renamePage(doc, 'page-2', '  Checkout  ');
    const next = apply(doc, tx);
    expect(next.pages[1]!.name).toBe('Checkout');
    expect(applyChanges(next, tx.undo)).toEqual(doc);
    expect(renamePage(doc, 'page-2', '   ').redo).toEqual([]);
  });

  it('keeps a rename made in the same batch as shape edits', () => {
    const doc = twoPages();
    const next = applyChanges(doc, [{ type: 'modObj', pageId: PAGE, id: 'rect-2', set: { name: 'CTA' } }, { type: 'modPage', pageId: PAGE, name: 'Home' }]);
    expect(next.pages[0]!.name).toBe('Home');
    expect(node(next, 'rect-2').name).toBe('CTA');
  });

  it('deletes a page and brings it back in the same place', () => {
    const doc = twoPages();
    const tx = deletePage(doc, PAGE);
    const next = apply(doc, tx);
    expect(next.pages.map((page) => page.id)).toEqual(['page-2']);
    expect(applyChanges(next, tx.undo)).toEqual(doc);
  });

  it('refuses to delete the last page or a page holding component mains', () => {
    expect(() => deletePage(sampleDocument(), PAGE)).toThrow('마지막 한 페이지');
    const withMain = apply(twoPages(), createComponent(twoPages(), PAGE, 'rect-2', 'button'));
    expect(() => deletePage(withMain, PAGE)).toThrow('컴포넌트 원본');
  });

  it('is accepted by the collaboration server', () => {
    const doc = twoPages();
    const room = new Room({ id: 'f', name: 'f', revision: 0, updatedAt: 0, createdBy: 'u', doc, comments: [], versions: [] }, () => {});
    expect(room.applyChange(renamePage(doc, 'page-2', 'Checkout').redo)).toMatchObject({ ok: true });
    expect(room.applyChange([{ type: 'modPage', pageId: 'missing', name: 'x' }])).toMatchObject({ ok: false });
  });
});
