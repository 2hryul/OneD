// 편집 한 번에 붙는 레이아웃 재계산(normalizeAfterEdit) 시간을 잰다. 깊은 레이아웃 안의 텍스트 높이를 바꾸는 편집을 여러 번 반복한다.
// 사용법: node --experimental-strip-types scripts/time-relayout.mjs <file.fig> <node-id> [반복=30]
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseFig } from 'openfig-core';
import { importFigNode } from '../src/figmaImport.ts';
import { updateShape } from '../src/changes.ts';
import { normalizeAfterEdit } from '../src/layoutEdits.ts';

const [filePath, rootId, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 30);
const { document } = importFigNode(parseFig(new Uint8Array(readFileSync(filePath))), rootId);
const page = document.pages[0];
const depth = (node) => { let count = 0; for (let p = node.parentId; p; p = page.objects[p]?.parentId) count++; return count; };
const target = Object.values(page.objects).filter((node) => node.type === 'text' && page.objects[node.parentId]?.layout).sort((a, b) => depth(b) - depth(a))[0];
const times = [];
let changes = 0;
for (let run = 0; run < runs + 5; run++) {
  const tx = updateShape(document, page.id, target.id, { height: target.height + 10 + run });
  const start = performance.now();
  const full = normalizeAfterEdit(document, tx);
  const elapsed = performance.now() - start;
  if (run >= 5) { times.push(elapsed); changes = full.redo.length; }
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ nodes: Object.keys(page.objects).length, targetDepth: depth(target), changesPerEdit: changes, runs, medianMs: Math.round(times[Math.floor(times.length / 2)] * 100) / 100, p90Ms: Math.round(times[Math.floor(times.length * 0.9)] * 100) / 100, maxMs: Math.round(times[times.length - 1] * 100) / 100 }));
