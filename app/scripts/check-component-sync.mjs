// 가져온 문서에서 메인 컴포넌트를 위치와 상관없는 방식(이름 변경)으로 고쳤을 때, 인스턴스가 있는 페이지의 도형이 움직이는지 잰다.
// 동기화가 Figma 결과를 망가뜨리지 않는지 확인하는 용도다.
// 사용법: node --experimental-strip-types scripts/check-component-sync.mjs <file.fig> <node-id> [허용오차px=0.5]
import { readFileSync } from 'node:fs';
import { parseFig } from 'openfig-core';
import { importFigNode } from '../src/figmaImport.ts';
import { parseDocument } from '../src/model.ts';
import { applyChanges, updateShape } from '../src/changes.ts';
import { normalizeAfterEdit } from '../src/normalize.ts';

const [filePath, rootId, toleranceArg] = process.argv.slice(2);
const tolerance = Number(toleranceArg ?? 0.5);
const { document } = importFigNode(parseFig(new Uint8Array(readFileSync(filePath))), rootId);
parseDocument(JSON.stringify(document));
const frame = document.pages[0];
const used = new Set(Object.values(frame.objects).filter((node) => node.componentId && !node.mainInstance).map((node) => node.componentId));
const results = [];
for (const componentId of used) {
  const component = document.components[componentId];
  const main = document.pages.find((page) => page.id === component.pageId).objects[component.mainId];
  const tx = updateShape(document, component.pageId, main.id, { name: `${main.name} (edited)` });
  const after = applyChanges(document, normalizeAfterEdit(document, tx).redo);
  const moved = Object.values(frame.objects).map((node) => {
    const next = after.pages[0].objects[node.id];
    if (!next) return { name: node.name, delta: Infinity };
    return { name: node.name, delta: Math.max(Math.abs(next.x - node.x), Math.abs(next.y - node.y), Math.abs(next.width - node.width), Math.abs(next.height - node.height)) };
  }).filter((item) => item.delta > tolerance);
  results.push({ component: component.name + (component.variant ? ` (${Object.values(component.variant).join(', ')})` : ''), moved: moved.length, worst: moved.sort((a, b) => b.delta - a.delta).slice(0, 2) });
}
console.log(JSON.stringify({ componentsEdited: used.size, componentsCausingMoves: results.filter((item) => item.moved).length, totalMovedNodes: results.reduce((sum, item) => sum + item.moved, 0), worst: results.filter((item) => item.moved).sort((a, b) => b.moved - a.moved).slice(0, 6) }, null, 1));
