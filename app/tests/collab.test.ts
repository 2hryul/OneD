import { describe, expect, it } from 'vitest';
import { sampleDocument, solid } from '../src/model';
import { addShape, applyChanges, deleteShape, updateShape } from '../src/changes';
import { cleanServerUrl, rebase } from '../src/collab';

const PAGE = 'page-1';

describe('collaboration client', () => {
  it('keeps my pending edits on top of changes others made first', () => {
    const base = sampleDocument();
    const mine = updateShape(base, PAGE, 'rect-2', { name: 'My button' }).redo;
    const theirs = addShape(base, PAGE, { id: 'theirs', type: 'rectangle', name: 'Theirs', parentId: null, x: 0, y: 0, width: 5, height: 5, fills: solid('#000000') }).redo;
    const confirmed = applyChanges(base, theirs);
    const result = rebase(confirmed, [{ seq: 1, redo: mine }]);
    expect(result.dropped).toBe(0);
    expect(result.doc.pages[0]!.objects['rect-2']!.name).toBe('My button');
    expect(result.doc.pages[0]!.objects.theirs).toBeDefined();
  });

  it('drops a pending edit to a shape someone else deleted, and keeps the later ones', () => {
    const base = sampleDocument();
    const confirmed = applyChanges(base, deleteShape(base, PAGE, 'rect-2').redo);
    const pending = [
      { seq: 1, redo: updateShape(base, PAGE, 'rect-2', { name: 'Gone' }).redo },
      { seq: 2, redo: updateShape(base, PAGE, 'text-1', { text: 'Still here' }).redo }
    ];
    const result = rebase(confirmed, pending);
    expect(result.dropped).toBe(1);
    expect(result.kept.map((change) => change.seq)).toEqual([2]);
    expect(result.doc.pages[0]!.objects['text-1']!.text).toBe('Still here');
  });

  it('accepts only web server addresses', () => {
    expect(cleanServerUrl(' http://127.0.0.1:8787/ ')).toBe('http://127.0.0.1:8787');
    expect(cleanServerUrl('https://studio.example.com/path')).toBe('https://studio.example.com');
    expect(cleanServerUrl('javascript:alert(1)')).toBeNull();
    expect(cleanServerUrl('127.0.0.1:8787')).toBeNull();
  });
});
