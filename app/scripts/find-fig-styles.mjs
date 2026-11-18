// .fig 파일 전체에서 스타일 종류별 사용 수와, 그 스타일을 쓰는 최상위 프레임 예시를 찾는다. 가져오기 검증용 노드를 고를 때 쓴다.
// 사용법: node scripts/find-fig-styles.mjs <file.fig>
import { readFileSync } from 'node:fs';
import { parseFig } from 'openfig-core';

const [filePath] = process.argv.slice(2);
if (!filePath) throw new Error('Usage: node scripts/find-fig-styles.mjs <file.fig>');
const fig = parseFig(new Uint8Array(readFileSync(filePath)));
const id = (guid) => `${guid.sessionID}:${guid.localID}`;
const parentOf = (node) => (node.parentIndex?.guid ? fig.nodeMap.get(id(node.parentIndex.guid)) : undefined);

function topFrame(node) {
  let current = node;
  let frame = null;
  for (let guard = 0; current && guard < 50; guard++, current = parentOf(current)) {
    if (current.type === 'FRAME' && parentOf(current)?.type === 'CANVAS') frame = current;
  }
  return frame;
}

const found = new Map();
const note = (key, node) => {
  const entry = found.get(key) ?? { count: 0, examples: new Map() };
  entry.count++;
  const frame = topFrame(node);
  if (frame && entry.examples.size < 3) entry.examples.set(id(frame.guid), `${frame.name} (${Math.round(frame.size?.x ?? 0)}x${Math.round(frame.size?.y ?? 0)})`);
  found.set(key, entry);
};

for (const node of fig.nodes) {
  if (node.phase === 'REMOVED') continue;
  for (const paint of node.fillPaints ?? []) if (paint.visible !== false && paint.type !== 'SOLID') note(`fill:${paint.type}`, node);
  for (const effect of node.effects ?? []) if (effect.visible !== false) note(`effect:${effect.type}`, node);
}
console.log(JSON.stringify(Object.fromEntries([...found].map(([key, value]) => [key, { count: value.count, examples: Object.fromEntries(value.examples) }])), null, 2));
