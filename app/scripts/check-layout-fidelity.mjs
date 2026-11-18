// Figma가 계산해 파일에 저장한 Auto Layout 결과와 이 편집기의 레이아웃 엔진 결과를 비교한다.
// 사용법: node --experimental-strip-types scripts/check-layout-fidelity.mjs <file.fig> <node-id> [허용오차px=0.5]
import { readFileSync } from 'node:fs';
import { parseFig } from 'openfig-core';
import { importFigNode } from '../src/figmaImport.ts';
import { layoutContainer, layoutContainers } from '../src/layoutEdits.ts';

const [filePath, rootId, toleranceArg] = process.argv.slice(2);
if (!filePath || !rootId) throw new Error('Usage: node --experimental-strip-types scripts/check-layout-fidelity.mjs <file.fig> <node-id> [tolerance]');
const tolerance = Number(toleranceArg ?? 0.5);
const { document } = importFigNode(parseFig(new Uint8Array(readFileSync(filePath))), rootId);
const page = document.pages[0];
// 인스턴스 안쪽 노드는 파일에 저장돼 있지 않고 마스터 컴포넌트 크기 그대로 펼쳐진다. Figma가 계산한 값이 아니므로 따로 센다.
const insideInstance = (id) => { for (let p = page.objects[id]?.parentId; p; p = page.objects[p]?.parentId) if (page.objects[p]?.sourceType === 'INSTANCE') return true; return false; };
let compared = 0;
const comparedBy = { file: 0, instance: 0 };
const mismatches = [];
for (const container of layoutContainers(page)) {
  const scope = insideInstance(container.id) || container.sourceType === 'INSTANCE' ? 'instance' : 'file';
  comparedBy[scope] += (container.children ?? []).length;
  const tx = layoutContainer(document, page.id, container.id);
  for (const change of tx.redo) {
    if (change.type !== 'modObj') continue;
    const before = page.objects[change.id];
    const deltas = ['x', 'y', 'width', 'height'].filter((key) => key in change.set).map((key) => [key, Math.round((change.set[key] - before[key]) * 100) / 100]);
    const worst = Math.max(0, ...deltas.map(([, delta]) => Math.abs(delta)));
    if (worst > tolerance) mismatches.push({ scope, container: container.name, node: before.name, id: change.id, worst, deltas: Object.fromEntries(deltas) });
  }
  compared += (container.children ?? []).length + 1;
}
const byContainer = new Map();
for (const item of mismatches) byContainer.set(item.container, (byContainer.get(item.container) ?? 0) + 1);
console.log(JSON.stringify({
  containers: layoutContainers(page).length,
  nodesCompared: compared,
  mismatchedChanges: mismatches.length,
  childrenComparedByScope: comparedBy,
  mismatchesByScope: { file: mismatches.filter((m) => m.scope === 'file').length, instance: mismatches.filter((m) => m.scope === 'instance').length },
  fileScopeWorst: mismatches.filter((m) => m.scope === 'file').sort((a, b) => b.worst - a.worst).slice(0, 10),
  tolerancePx: tolerance,
  topContainers: [...byContainer].sort((a, b) => b[1] - a[1]).slice(0, 8),
  instanceScopeWorst: mismatches.filter((m) => m.scope === 'instance').sort((a, b) => b.worst - a.worst).slice(0, 3)
}, null, 2));
