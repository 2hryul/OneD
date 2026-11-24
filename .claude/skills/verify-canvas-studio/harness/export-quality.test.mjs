// node --test .claude/skills/verify-canvas-studio/harness/export-quality.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countDiff, extractZip, judgeTargets, TARGETS, UI_FRAMES } from './quality-metrics.mjs';

/** 무압축 zip을 만든다(앱 zip.ts와 같은 저장 방식). CRC는 읽지 않으므로 0으로 둔다. */
function storedZip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name); const data = Buffer.from(text);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data); centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('extractZip returns names and exact bytes, including binary data', () => {
  const entries = extractZip(storedZip([['Login.tsx', 'export function Login() {}'], ['assets/a.png', '\u0089PNG']]));
  assert.deepEqual(entries.map((e) => e.name), ['Login.tsx', 'assets/a.png']);
  assert.equal(entries[0].bytes.toString('utf8'), 'export function Login() {}');
  assert.deepEqual([...entries[1].bytes], [...Buffer.from('\u0089PNG')]);
  assert.throws(() => extractZip(Buffer.from('not a zip at all, definitely not')), /끝 레코드/);
});

test('countDiff counts pixels whose channel difference passes the threshold and marks them', () => {
  const a = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 255, 255, 255, 255, 10, 10, 10, 255]);
  const b = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 140, 255, 255, 255, 255, 255, 10, 40, 10, 255]);
  const mark = new Uint8ClampedArray(a.length);
  assert.equal(countDiff(a, b, 32, mark), 25);
  assert.deepEqual([...mark.slice(4, 8)], [230, 30, 30, 255]);
  assert.equal(countDiff(a, a, 32), 0);
});

test('judgeTargets passes, fails, and refuses to judge partial runs', () => {
  const frame = (outsidePct, h1 = 1) => ({ tsc: 'ok', build: 'ok', widths: { 375: { outsidePct }, 1440: { textOverflow: 0 } }, tags: { h1 }, pixelDiffPct: 1, tsxLines: 100 });
  const all = Object.fromEntries(UI_FRAMES.map((key) => [key, frame(2)]));
  const mobile = (result) => result.find((t) => t.id === 'mobile-outside');
  assert.equal(mobile(judgeTargets(all)).pass, true);
  const failing = judgeTargets({ ...all, [UI_FRAMES[1]]: frame(89) });
  assert.deepEqual(mobile(failing).failing, [UI_FRAMES[1]]);
  assert.equal(mobile(failing).pass, false);
  const partial = mobile(judgeTargets({ [UI_FRAMES[0]]: frame(2) }));
  assert.equal(partial.measured, false);
  assert.equal(partial.pass, false);
  assert.equal(partial.missing.length, 3);
  const h1 = judgeTargets({ x: frame(2, 9) }).find((t) => t.id === 'h1');
  assert.deepEqual(h1.failing, ['x']);
  assert.ok(TARGETS.every((t) => typeof t.pass === 'function'));
});
