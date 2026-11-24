// .fig 파일의 선택 노드 하위에서 쓰이는 스타일 종류를 집계한다. 3단계 우선순위를 정하는 근거 자료용.
// 사용법: node scripts/probe-fig-styles.mjs <file.fig> <node-id>
import { readFileSync } from 'node:fs';
import { readFigFile } from '../src/figmaImport.ts';

const [filePath, rootId] = process.argv.slice(2);
if (!filePath || !rootId) throw new Error('Usage: node scripts/probe-fig-styles.mjs <file.fig> <node-id>');
const fig = readFigFile(new Uint8Array(readFileSync(filePath)));
const id = (guid) => `${guid.sessionID}:${guid.localID}`;
const counts = new Map();
const bump = (key) => counts.set(key, (counts.get(key) ?? 0) + 1);
const textKeys = new Map();
const seen = new Set();

function visit(node, depth) {
  if (!node || depth > 12) return;
  const key = id(node.guid);
  if (seen.has(key)) return;
  seen.add(key);
  bump(`node:${node.type}`);
  for (const paint of node.fillPaints ?? []) if (paint.visible !== false) bump(`fill:${paint.type}`);
  for (const paint of node.strokePaints ?? []) if (paint.visible !== false) bump(`stroke:${paint.type}:${node.strokeAlign ?? 'CENTER'}`);
  for (const effect of node.effects ?? []) if (effect.visible !== false) bump(`effect:${effect.type}`);
  const m = node.transform;
  if (m && (Math.abs(m.m01) > 1e-6 || Math.abs(m.m10) > 1e-6 || m.m00 < 0 || m.m11 < 0)) bump('transform:rotated-or-flipped');
  if (node.type === 'TEXT') {
    for (const k of Object.keys(node)) if (/text|line|letter|paragraph|font|style|decoration|case|autoResize/i.test(k)) textKeys.set(k, (textKeys.get(k) ?? 0) + 1);
    if (node.textData?.characterStyleIDs?.some((v) => v !== 0)) bump('text:mixed-styles');
  }
  if (node.cornerRadius) bump('cornerRadius');
  if (node.opacity !== undefined && node.opacity < 1) bump('opacity<1');
  for (const child of fig.childrenMap.get(key) ?? []) visit(child, depth + 1);
  const symbolId = node.symbolData?.symbolID;
  if (node.type === 'INSTANCE' && symbolId) visit(fig.nodeMap.get(id(symbolId)), depth + 1);
}

visit(fig.nodeMap.get(rootId), 0);
console.log(JSON.stringify({ visited: seen.size, images: fig.images.size, counts: Object.fromEntries([...counts].sort()), textKeys: Object.fromEntries([...textKeys].sort()) }, null, 2));
