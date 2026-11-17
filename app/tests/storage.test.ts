import { describe, expect, it } from 'vitest';
import { parseNumberInput } from '../src/numberInput';
import { RECOVERY_KEY, STORAGE_KEY, loadStoredDocument, readRecovery, saveStoredDocument } from '../src/storage';
import { sampleDocument } from '../src/model';

function memoryStore(initial: Record<string, string> = {}, failWrites = false) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failWrites) throw new Error('QuotaExceededError'); data.set(key, value); }
  };
}

describe('auto-save recovery', () => {
  it('opens a valid saved document as is', () => {
    const doc = { ...sampleDocument(), name: 'My work' };
    const result = loadStoredDocument(memoryStore({ [STORAGE_KEY]: JSON.stringify(doc) }));
    expect(result.document.name).toBe('My work');
    expect(result.notice).toBeUndefined();
  });

  it('keeps an unreadable saved document as a recovery copy and tells the user', () => {
    const broken = { ...sampleDocument(), name: 'My work' };
    broken.pages[0]!.objects['frame-1']!.width = 0;
    const raw = JSON.stringify(broken);
    const store = memoryStore({ [STORAGE_KEY]: raw });
    const result = loadStoredDocument(store);
    expect(result.document.name).toBe('Untitled design');
    expect(result.notice).toContain('복구본으로 보관');
    expect(readRecovery(store)).toBe(raw);
  });

  it('does not overwrite an earlier recovery copy', () => {
    const store = memoryStore({ [STORAGE_KEY]: '{not json', [RECOVERY_KEY]: 'older work' });
    loadStoredDocument(store);
    expect(readRecovery(store)).toBe('older work');
  });

  it('reports a failed save instead of throwing', () => {
    expect(saveStoredDocument(memoryStore({}, true), sampleDocument())).toBe(false);
    expect(saveStoredDocument(memoryStore(), sampleDocument())).toBe(true);
  });
});

describe('number input', () => {
  it('keeps the current value while the field is empty or not a number', () => {
    expect(parseNumberInput('', 720, 1)).toBe(720);
    expect(parseNumberInput('  ', 720, 1)).toBe(720);
    expect(parseNumberInput('-', 720, 1)).toBe(720);
  });

  it('clamps to the minimum', () => {
    expect(parseNumberInput('0', 720, 1)).toBe(1);
    expect(parseNumberInput('-5', 8, 0)).toBe(0);
    expect(parseNumberInput('-40', 10)).toBe(-40);
    expect(parseNumberInput('250', 720, 1)).toBe(250);
  });
});
