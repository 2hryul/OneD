import { SYNC_GROUPS, TOKEN_SLOT_TYPE, parseVariantName, variantName, walkPage, type DesignDocument, type DesignNode, type Matrix, type NodeInput, type Page, type SyncGroup, type Token, type TokenSlot } from './model.ts';
import { applyPoint, boundsOf, center, cleanMatrix, invert, linearPart, multiply, roundRect, worldCorners, worldMatrix, type Rect } from './geometry.ts';
import {
  addShape, applyChanges, composeTransactions, deleteShape, EMPTY_TRANSACTION, reparentShape, resizeShape, setComponent, updateShape, childrenOf,
  type Transaction
} from './changes.ts';

type Step = (current: DesignDocument) => Transaction;
type IdFactory = () => string;

const NON_GEOMETRY_GROUPS = (Object.keys(SYNC_GROUPS) as SyncGroup[]).filter((group) => group !== 'geometry');
/** 인스턴스 루트에서 동기화하지 않는 묶음. 루트가 부모 안에서 놓이는 방식은 인스턴스마다 다르다(Penpot swap-keep-attrs). */
const ROOT_LOCAL_GROUPS: ReadonlySet<SyncGroup> = new Set(['name', 'constraints', 'layout-item', 'visibility', 'modifiable']);
const COPY_SKIP = new Set(['id', 'parentId', 'children', 'mainInstance', 'touched', 'shapeRef', 'componentSet']);

export function findNode(doc: DesignDocument, id: string): { page: Page; node: DesignNode } | null {
  for (const page of doc.pages) { const node = page.objects[id]; if (node) return { page, node }; }
  return null;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 인스턴스 안의 도형에서 가장 바깥 인스턴스 루트까지 올라간다. shapeRef가 끊기는 곳 바로 아래가 루트다. */
export function topInstanceRoot(page: Page, id: string): DesignNode | null {
  let node = page.objects[id];
  if (!node?.shapeRef) return null;
  while (node.parentId && page.objects[node.parentId]?.shapeRef) node = page.objects[node.parentId]!;
  return node.componentId ? node : null;
}

/** 이 도형을 포함하는 메인 컴포넌트 루트. 메인 안에 있지 않으면 null. */
export function mainRootOf(page: Page, id: string): DesignNode | null {
  for (let current: string | null = id; current; current = page.objects[current]?.parentId ?? null) {
    if (page.objects[current]?.mainInstance) return page.objects[current]!;
  }
  return null;
}

/** 다른 인스턴스 안에 들어 있지 않은 인스턴스 루트. 안쪽 인스턴스는 바깥 인스턴스를 통해 동기화된다. */
function topLevelInstances(doc: DesignDocument, componentId: string): Array<{ page: Page; node: DesignNode }> {
  return doc.pages.flatMap((page) => Object.values(page.objects)
    .filter((node) => node.componentId === componentId && !node.mainInstance && !(node.parentId && page.objects[node.parentId]?.shapeRef))
    .map((node) => ({ page, node })));
}

/** 루트 지역 좌표에서 본 도형의 중심·크기·상대 행렬. 인스턴스와 메인의 위치를 루트 기준으로 비교·복사하는 데 쓴다. */
function relativeBox(node: DesignNode, root: DesignNode): { cx: number; cy: number; width: number; height: number; linear: Matrix } {
  const local = applyPoint(invert(worldMatrix(root)), center(node));
  return { cx: local.x, cy: local.y, width: node.width, height: node.height, linear: cleanMatrix(multiply(invert(linearPart(root.transform)), linearPart(node.transform))) };
}

function sameRelative(a: ReturnType<typeof relativeBox>, b: ReturnType<typeof relativeBox>): boolean {
  return same(a.cx, b.cx) && same(a.cy, b.cy) && same(a.width, b.width) && same(a.height, b.height) && a.linear.every((value, index) => same(value, b.linear[index]));
}

/** 메인 도형의 상대 위치를 인스턴스 루트(rootBox 상자) 안으로 옮긴 페이지 좌표 상자와 행렬. */
function placeRelative(main: DesignNode, mainRoot: DesignNode, root: DesignNode, rootBox: Rect): Pick<DesignNode, 'x' | 'y' | 'width' | 'height' | 'transform'> {
  const relative = relativeBox(main, mainRoot);
  const target = { ...root, ...rootBox };
  const placed = applyPoint(worldMatrix(target), { x: relative.cx, y: relative.cy });
  const box = roundRect({ x: placed.x - main.width / 2, y: placed.y - main.height / 2, width: main.width, height: main.height });
  return { ...box, transform: cleanMatrix(multiply(linearPart(root.transform), relative.linear)) };
}

function copyAttrs(source: DesignNode): Partial<NodeInput> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !COPY_SKIP.has(key))) as Partial<NodeInput>;
}

/** 도형(프레임·그룹 등)을 메인 컴포넌트로 만든다. 다른 인스턴스 안에 있거나 이미 컴포넌트면 거부한다. variant 세트 안이면 이름을 속성으로 읽는다. */
export function createComponent(doc: DesignDocument, pageId: string, nodeId: string, componentId: string): Transaction {
  const found = findNode(doc, nodeId);
  if (!found || found.page.id !== pageId) throw new Error('[createComponent] 도형 없음');
  const { page, node } = found;
  if (node.componentId || node.shapeRef || mainRootOf(page, nodeId)) throw new Error('이미 컴포넌트이거나 컴포넌트 안에 있는 요소는 컴포넌트로 만들 수 없습니다.');
  const set = node.parentId && page.objects[node.parentId]?.componentSet ? page.objects[node.parentId]! : null;
  const variant = set ? parseVariantName(node.name) ?? { 'Property 1': node.name } : undefined;
  return composeTransactions(doc, [
    (current) => updateShape(current, pageId, nodeId, { componentId, mainInstance: true, ...(variant ? { name: variantName(variant) } : {}) }),
    (current) => setComponent(current, { id: componentId, name: set ? set.name : node.name, mainId: nodeId, pageId, ...(set ? { setId: set.id, variant } : {}) })
  ]);
}

/**
 * 컴포넌트 인스턴스를 만든다. 메인 하위 트리를 새 id로 복사하고 각 도형에 shapeRef를 단다.
 * 자식 id는 `루트id/메인도형id`로 정해, 나중에 메인에 생긴 도형을 동기화로 추가할 때도 같은 규칙을 쓴다.
 *
 * Args:
 *   place: 부모·왼쪽 위 좌표·순서
 *   makeId: 인스턴스 루트 id를 만드는 함수
 */
export function createInstance(doc: DesignDocument, pageId: string, componentId: string, place: { parentId: string | null; x: number; y: number; index?: number }, makeId: IdFactory): { tx: Transaction; rootId: string } {
  const component = doc.components[componentId];
  const main = component ? findNode(doc, component.mainId) : null;
  if (!component || !main) throw new Error('[createInstance] 컴포넌트 없음');
  const rootId = makeId();
  const nodes = walkPage(main.page, [main.node.id]);
  const dx = place.x - main.node.x;
  const dy = place.y - main.node.y;
  const idOf = (mainId: string): string => (mainId === main.node.id ? rootId : `${rootId}/${mainId}`);
  const steps: Step[] = nodes.map((source, index) => (current: DesignDocument) => addShape(current, pageId, {
    ...copyAttrs(source),
    id: idOf(source.id),
    type: source.type,
    // 인스턴스 루트 이름은 컴포넌트 이름이다. variant 메인의 "속성=값" 이름 대신 세트 이름(예: Breadcrumb)을 쓴다.
    name: index === 0 ? component.name : source.name,
    parentId: index === 0 ? place.parentId : idOf(source.parentId!),
    x: source.x + dx, y: source.y + dy, width: source.width, height: source.height, fills: source.fills,
    shapeRef: source.id,
    ...(index === 0 ? { componentId } : {})
  } as NodeInput, index === 0 ? place.index : undefined));
  return { tx: composeTransactions(doc, steps), rootId };
}

/** 인스턴스를 일반 도형으로 바꾼다. 안쪽 인스턴스는 바깥 메인을 거친 참조를 자기 메인 참조로 바꿔 그대로 인스턴스로 남긴다. */
export function detachInstance(doc: DesignDocument, pageId: string, rootId: string): Transaction {
  const found = findNode(doc, rootId);
  if (!found || !found.node.componentId || found.node.mainInstance) return EMPTY_TRANSACTION;
  const { page } = found;
  const nodes = walkPage(page, [rootId]);
  const nestedRoots = new Set(nodes.filter((node) => node.id !== rootId && node.componentId).map((node) => node.id));
  const insideNested = (node: DesignNode): boolean => { for (let p: string | null = node.id; p && p !== rootId; p = page.objects[p]?.parentId ?? null) if (nestedRoots.has(p)) return true; return false; };
  return composeTransactions(doc, nodes.map((node) => (current: DesignDocument) => {
    if (insideNested(node)) {
      const viaOuter = node.shapeRef ? findNode(current, node.shapeRef)?.node.shapeRef : undefined;
      return updateShape(current, pageId, node.id, { shapeRef: viaOuter, touched: undefined });
    }
    return updateShape(current, pageId, node.id, { shapeRef: undefined, touched: undefined, ...(node.id === rootId ? { componentId: undefined } : {}) });
  }));
}

/** 인스턴스의 override를 모두 지우고 메인 상태로 되돌린다. */
export function resetOverrides(doc: DesignDocument, pageId: string, rootId: string): Transaction {
  const found = findNode(doc, rootId);
  if (!found) return EMPTY_TRANSACTION;
  return composeTransactions(doc, [
    ...walkPage(found.page, [rootId]).map((node) => (current: DesignDocument) => updateShape(current, pageId, node.id, { touched: undefined })),
    (current) => syncInstance(current, pageId, rootId, 'reset')
  ]);
}

/**
 * 사용자가 바꾼 인스턴스 도형에 touched 묶음을 기록한다. 레이아웃·동기화가 만든 변경은 포함하지 않도록 사용자 편집(userTx)만 본다.
 * 위치·크기는 인스턴스 루트 기준 상대값으로 비교해서, 인스턴스 전체를 옮기거나 돌린 것은 override로 보지 않는다.
 */
export function markTouched(before: DesignDocument, after: DesignDocument, userTx: Transaction): Transaction {
  const ids = new Map<string, Set<string>>();
  // touched를 직접 다루는 편집(override 초기화, variant 전환)은 그 결과를 다시 override로 기록하지 않는다.
  const managed = new Set(userTx.redo.flatMap((change) => (change.type === 'modObj' && ('touched' in change.set || change.unset?.includes('touched' as never)) ? [change.id] : [])));
  for (const change of userTx.redo) if (change.type === 'modObj' && !managed.has(change.id)) ids.set(change.pageId, (ids.get(change.pageId) ?? new Set()).add(change.id));
  const steps: Step[] = [];
  for (const [pageId, set] of ids) {
    const pageBefore = before.pages.find((page) => page.id === pageId);
    const pageAfter = after.pages.find((page) => page.id === pageId);
    if (!pageBefore || !pageAfter) continue;
    for (const id of set) {
      const groups = touchedGroups(pageBefore, pageAfter, id);
      if (groups) steps.push((current) => updateShape(current, pageId, id, { touched: groups }));
    }
  }
  return composeTransactions(after, steps);
}

function touchedGroups(pageBefore: Page, pageAfter: Page, id: string): SyncGroup[] | null {
  const prev = pageBefore.objects[id];
  const next = pageAfter.objects[id];
  if (!prev || !next?.shapeRef) return null;
  const groups = new Set(next.touched ?? []);
  const size = groups.size;
  for (const group of NON_GEOMETRY_GROUPS) {
    if ((SYNC_GROUPS[group] as readonly string[]).some((attr) => !same((prev as unknown as Record<string, unknown>)[attr], (next as unknown as Record<string, unknown>)[attr]))) groups.add(group);
  }
  const rootAfter = topInstanceRoot(pageAfter, id);
  const rootBefore = rootAfter ? pageBefore.objects[rootAfter.id] : undefined;
  // 같은 편집에서 조상의 크기가 바뀌었다면 이 도형의 이동은 제약·레이아웃이 만든 것이지 사용자의 override가 아니다.
  if (rootAfter && rootBefore && (id === rootAfter.id || !ancestorResized(pageBefore, pageAfter, id, rootAfter.id))) {
    const moved = id === rootAfter.id
      ? !same(prev.width, next.width) || !same(prev.height, next.height)
      : !sameRelative(relativeBox(prev, rootBefore), relativeBox(next, rootAfter));
    if (moved) groups.add('geometry');
  }
  return groups.size > size ? [...groups] : null;
}

function ancestorResized(pageBefore: Page, pageAfter: Page, id: string, rootId: string): boolean {
  for (let current = pageAfter.objects[id]?.parentId ?? null; current; current = pageAfter.objects[current]?.parentId ?? null) {
    const before = pageBefore.objects[current];
    const after = pageAfter.objects[current];
    if (before && after && (!same(before.width, after.width) || !same(before.height, after.height))) return true;
    if (current === rootId) break;
  }
  return false;
}

/**
 * 바뀐 메인 컴포넌트의 인스턴스를 메인에 맞춘다. 메인 안의 안쪽 인스턴스가 바뀌면 그 메인도 바뀐 것이므로 몇 번 반복한다.
 *
 * Args:
 *   before: 편집 전 문서. 메인의 위치·크기가 얼마나 바뀌었는지 계산하는 기준이다.
 *   changed: 이번 편집에서 바뀐 도형 id(페이지 무관)
 */
export function syncComponents(before: DesignDocument, doc: DesignDocument, changed: ReadonlySet<string>): Transaction {
  let previous = before;
  let current = doc;
  let pending = componentsTouchedBy(current, changed);
  const collected: Transaction[] = [];
  for (let pass = 0; pass < 4 && pending.size; pass++) {
    const reference = previous;
    const steps = [...pending].flatMap((componentId) => topLevelInstances(current, componentId).map(({ page, node }) => (next: DesignDocument) => syncInstance(next, page.id, node.id, { before: reference })));
    const tx = composeTransactions(current, steps);
    if (tx.redo.length === 0) break;
    collected.push(tx);
    previous = current;
    current = applyChanges(current, tx.redo);
    pending = componentsTouchedBy(current, idsOf(tx));
  }
  return { redo: collected.flatMap((tx) => tx.redo), undo: [...collected].reverse().flatMap((tx) => tx.undo) };
}

export function idsOf(tx: Transaction): Set<string> {
  const ids = new Set<string>();
  for (const change of tx.redo) {
    if (change.type === 'modObj' || change.type === 'delObj') ids.add(change.id);
    if (change.type === 'addObj') { ids.add(change.obj.id); if (change.obj.parentId) ids.add(change.obj.parentId); }
    if (change.type === 'movObjects') { change.ids.forEach((id) => ids.add(id)); if (change.parentId) ids.add(change.parentId); }
  }
  return ids;
}

function componentsTouchedBy(doc: DesignDocument, ids: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    const found = findNode(doc, id);
    const main = found ? mainRootOf(found.page, id) : null;
    if (main?.componentId) result.add(main.componentId);
  }
  return result;
}

/**
 * 인스턴스 하나를 메인에 맞춘다. 순서: 메인에 없는 도형 지우기 → 메인에 새로 생긴 도형 넣기 → touched가 아닌 속성 복사 → 위치·크기.
 * 위치·크기는 메인 도형이 실제로 움직인 만큼만 같은 인스턴스 도형에 더한다(Penpot과 같은 방식). 인스턴스마다 다른 레이아웃 결과를 지키기 위해서다.
 *
 * Args:
 *   mode: { before }면 그 문서 대비 메인의 변화량을 옮기고, 'reset'이면 메인 기준으로 전부 다시 놓는다(override 초기화).
 */
export function syncInstance(doc: DesignDocument, pageId: string, rootId: string, mode: { before: DesignDocument } | 'reset'): Transaction {
  const instPage = doc.pages.find((page) => page.id === pageId);
  const root = instPage?.objects[rootId];
  const component = root?.componentId ? doc.components[root.componentId] : undefined;
  const main = component ? findNode(doc, component.mainId) : null;
  if (!instPage || !root || !main) return EMPTY_TRANSACTION;
  return composeTransactions(doc, [
    (current) => removeExtraShapes(current, pageId, rootId, main.node.id),
    (current) => addMissingShapes(current, pageId, rootId, main.node.id),
    (current) => copyUntouchedAttrs(current, pageId, rootId, main.node.id),
    (current) => (mode === 'reset' ? placeAll(current, pageId, rootId, main.node.id) : applyMainDeltas(current, mode.before, pageId, rootId, main.node.id))
  ]);
}

function pairOf(doc: DesignDocument, pageId: string, rootId: string, mainId: string): { page: Page; root: DesignNode; mainPage: Page; mainRoot: DesignNode; nodes: DesignNode[]; mainNodes: DesignNode[] } | null {
  const page = doc.pages.find((item) => item.id === pageId);
  const root = page?.objects[rootId];
  const main = findNode(doc, mainId);
  if (!page || !root || !main) return null;
  return { page, root, mainPage: main.page, mainRoot: main.node, nodes: walkPage(page, [rootId]), mainNodes: walkPage(main.page, [mainId]) };
}

function removeExtraShapes(doc: DesignDocument, pageId: string, rootId: string, mainId: string): Transaction {
  const pair = pairOf(doc, pageId, rootId, mainId);
  if (!pair) return EMPTY_TRANSACTION;
  const mainIds = new Set(pair.mainNodes.map((node) => node.id));
  const extra = pair.nodes.filter((node) => node.id !== rootId && node.shapeRef && !mainIds.has(node.shapeRef) && !(node.parentId && pair.page.objects[node.parentId]?.shapeRef && !mainIds.has(pair.page.objects[node.parentId]!.shapeRef!)));
  return composeTransactions(doc, extra.map((node) => (current: DesignDocument) => (current.pages.find((page) => page.id === pageId)?.objects[node.id] ? deleteShape(current, pageId, node.id) : EMPTY_TRANSACTION)));
}

function addMissingShapes(doc: DesignDocument, pageId: string, rootId: string, mainId: string): Transaction {
  const pair = pairOf(doc, pageId, rootId, mainId);
  if (!pair) return EMPTY_TRANSACTION;
  const steps: Step[] = pair.mainNodes.slice(1).map((source) => (current: DesignDocument) => {
    const page = current.pages.find((item) => item.id === pageId)!;
    const byRef = new Map(walkPage(page, [rootId]).map((node) => [node.shapeRef, node]));
    if (byRef.has(source.id)) return EMPTY_TRANSACTION;
    const parent = source.parentId === mainId ? page.objects[rootId] : byRef.get(source.parentId!);
    if (!parent) return EMPTY_TRANSACTION;
    const siblings = pair.mainPage.objects[source.parentId!]?.children ?? [];
    const before = siblings.slice(0, siblings.indexOf(source.id)).filter((id) => byRef.has(id)).length;
    const placed = placeRelative(source, pair.mainRoot, page.objects[rootId]!, page.objects[rootId]!);
    return addShape(current, pageId, { ...copyAttrs(source), ...placed, id: `${rootId}/${source.id}`, type: source.type, name: source.name, parentId: parent.id, fills: source.fills, shapeRef: source.id } as NodeInput, before);
  });
  return composeTransactions(doc, steps);
}

function copyUntouchedAttrs(doc: DesignDocument, pageId: string, rootId: string, mainId: string): Transaction {
  const pair = pairOf(doc, pageId, rootId, mainId);
  if (!pair) return EMPTY_TRANSACTION;
  const steps: Step[] = pair.nodes.map((node) => (current: DesignDocument) => {
    const source = node.id === rootId ? pair.mainRoot : node.shapeRef ? pair.mainPage.objects[node.shapeRef] : undefined;
    if (!source) return EMPTY_TRANSACTION;
    const patch: Record<string, unknown> = {};
    for (const group of NON_GEOMETRY_GROUPS) {
      if (node.touched?.includes(group) || (node.id === rootId && ROOT_LOCAL_GROUPS.has(group))) continue;
      for (const attr of SYNC_GROUPS[group]) {
        const value = (source as unknown as Record<string, unknown>)[attr];
        if (!same((node as unknown as Record<string, unknown>)[attr], value)) patch[attr] = value;
      }
    }
    return Object.keys(patch).length ? updateShape(current, pageId, node.id, patch as Partial<DesignNode>) : EMPTY_TRANSACTION;
  });
  return composeTransactions(doc, steps);
}

/**
 * 메인에서 바뀐 위치·크기만 인스턴스에 더한다. 메인 루트 크기 변화는 인스턴스 루트 크기에(제약 적용), 자식의 변화는 루트 기준 지역 좌표의 변화량으로 옮긴다.
 * 사용자가 위치·크기를 바꾼(geometry touched) 도형은 건드리지 않는다.
 */
function applyMainDeltas(doc: DesignDocument, before: DesignDocument, pageId: string, rootId: string, mainId: string): Transaction {
  const pair = pairOf(doc, pageId, rootId, mainId);
  const old = findNode(before, mainId);
  if (!pair || !old) return EMPTY_TRANSACTION;
  const oldRoot = old.node;
  const { root, mainRoot } = pair;
  const dw = mainRoot.width - oldRoot.width;
  const dh = mainRoot.height - oldRoot.height;
  const steps: Step[] = [];
  if (!root.touched?.includes('geometry') && (!same(dw, 0) || !same(dh, 0))) {
    steps.push((current) => resizeShape(current, pageId, rootId, roundRect({ x: root.x, y: root.y, width: root.width + dw, height: root.height + dh })));
  }
  for (const node of pair.nodes.slice(1)) {
    const main = node.shapeRef ? pair.mainPage.objects[node.shapeRef] : undefined;
    const mainBefore = node.shapeRef ? old.page.objects[node.shapeRef] : undefined;
    if (!main || !mainBefore || node.touched?.includes('geometry')) continue;
    const from = relativeBox(mainBefore, oldRoot);
    const to = relativeBox(main, mainRoot);
    if (sameRelative(from, to)) continue;
    steps.push((current) => moveByDelta(current, pageId, node.id, rootId, from, to));
  }
  return composeTransactions(doc, steps);
}

function moveByDelta(doc: DesignDocument, pageId: string, id: string, rootId: string, from: ReturnType<typeof relativeBox>, to: ReturnType<typeof relativeBox>): Transaction {
  const page = doc.pages.find((item) => item.id === pageId);
  const node = page?.objects[id];
  const root = page?.objects[rootId];
  if (!node || !root) return EMPTY_TRANSACTION;
  const local = relativeBox(node, root);
  const placed = applyPoint(worldMatrix(root), { x: local.cx + to.cx - from.cx, y: local.cy + to.cy - from.cy });
  const width = Math.max(0.01, node.width + to.width - from.width);
  const height = Math.max(0.01, node.height + to.height - from.height);
  const rotated = to.linear.some((value, index) => !same(value, from.linear[index]));
  return updateShape(doc, pageId, id, { ...roundRect({ x: placed.x - width / 2, y: placed.y - height / 2, width, height }), ...(rotated ? { transform: cleanMatrix(multiply(linearPart(root.transform), to.linear)) } : {}) });
}

/** override 초기화용. 루트를 메인 크기로 두고 모든 자식을 메인 상대 위치에 놓은 뒤, 사용자가 바꾼 루트 크기가 있으면 그 크기로 다시 늘린다. */
function placeAll(doc: DesignDocument, pageId: string, rootId: string, mainId: string): Transaction {
  const pair = pairOf(doc, pageId, rootId, mainId);
  if (!pair) return EMPTY_TRANSACTION;
  const { root, mainRoot } = pair;
  const rootLocked = root.touched?.includes('geometry');
  const virtual: Rect = { x: root.x, y: root.y, width: mainRoot.width, height: mainRoot.height };
  const actual: Rect = { x: root.x, y: root.y, width: root.width, height: root.height };
  const targets = pair.nodes.slice(1).filter((node) => !node.touched?.includes('geometry') && node.shapeRef && pair.mainPage.objects[node.shapeRef]).map((node) => ({ node, target: placeRelative(pair.mainPage.objects[node.shapeRef!]!, mainRoot, root, virtual) }));
  const sizeDiffers = !same(root.width, mainRoot.width) || !same(root.height, mainRoot.height);
  // 루트를 메인 크기로 두고 자식을 메인 상대 위치에 놓는다. 사용자가 루트 크기를 바꿨다면 그 크기로 다시 늘려 제약을 적용한다.
  const steps: Step[] = [
    (current) => (sizeDiffers ? updateShape(current, pageId, rootId, virtual) : EMPTY_TRANSACTION),
    ...targets.map(({ node, target }) => (current: DesignDocument) => (current.pages.find((item) => item.id === pageId)?.objects[node.id] ? updateShape(current, pageId, node.id, target) : EMPTY_TRANSACTION)),
    (current) => (rootLocked && sizeDiffers ? resizeShape(current, pageId, rootId, actual) : EMPTY_TRANSACTION)
  ];
  return composeTransactions(doc, steps);
}

/**
 * 같은 부모 아래의 메인 컴포넌트들을 variant 세트로 묶는다. 세트 프레임을 만들고 각 메인의 이름을 "속성=값" 형식으로 읽어 variant로 등록한다.
 */
export function combineAsVariants(doc: DesignDocument, pageId: string, mainIds: readonly string[], setId: string, name: string): Transaction {
  const page = doc.pages.find((item) => item.id === pageId);
  const mains = mainIds.map((id) => page?.objects[id]).filter((node): node is DesignNode => Boolean(node?.mainInstance && node.componentId));
  if (!page || mains.length < 2 || mains.length !== mainIds.length) throw new Error('메인 컴포넌트를 두 개 이상 고르세요.');
  const parentId = mains[0]!.parentId;
  if (mains.some((node) => node.parentId !== parentId)) throw new Error('같은 부모 안의 메인 컴포넌트만 묶을 수 있습니다.');
  const box = boundsOf(mains.flatMap(worldCorners));
  const padding = 20;
  const index = Math.max(...mains.map((node) => childrenOf(page, parentId).indexOf(node.id))) + 1;
  return composeTransactions(doc, [
    (current) => addShape(current, pageId, { id: setId, type: 'frame', name, parentId, componentSet: true, ...roundRect({ x: box.x - padding, y: box.y - padding, width: box.width + padding * 2, height: box.height + padding * 2 }), fills: [], strokes: [{ color: '#9747ff', width: 1, align: 'inside', dash: [4, 4] }] } as NodeInput, index),
    ...mains.map((main, position) => (current: DesignDocument) => reparentShape(current, pageId, main.id, setId, position)),
    ...mains.map((main) => (current: DesignDocument) => {
      const variant = parseVariantName(main.name) ?? { 'Property 1': main.name };
      const component = current.components[main.componentId!]!;
      return composeTransactions(current, [
        (next) => updateShape(next, pageId, main.id, { name: variantName(variant) }),
        (next) => setComponent(next, { ...component, name, setId, variant })
      ]);
    })
  ]);
}

/** variant 세트에 속한 컴포넌트들. 세트가 아니면 자기 자신만. */
export function variantSiblings(doc: DesignDocument, componentId: string): DesignDocument['components'][string][] {
  const component = doc.components[componentId];
  if (!component?.setId) return component ? [component] : [];
  return Object.values(doc.components).filter((item) => item.setId === component.setId);
}

/**
 * 인스턴스를 같은 세트의 다른 variant로 바꾼다. 새 인스턴스를 같은 자리에 만들고, 이름 경로가 같은 도형으로 override를 옮긴다(Penpot component swap).
 */
export function switchVariant(doc: DesignDocument, pageId: string, rootId: string, targetComponentId: string, makeId: IdFactory): { tx: Transaction; rootId: string } {
  const page = doc.pages.find((item) => item.id === pageId);
  const root = page?.objects[rootId];
  if (!page || !root?.componentId) throw new Error('[switchVariant] 인스턴스 없음');
  const index = childrenOf(page, root.parentId).indexOf(rootId);
  const created = createInstance(doc, pageId, targetComponentId, { parentId: root.parentId, x: root.x, y: root.y, index }, makeId);
  const namePath = (node: DesignNode, inPage: Page, top: string): string => { const names: string[] = []; for (let p: DesignNode | undefined = node; p && p.id !== top; p = p.parentId ? inPage.objects[p.parentId] : undefined) names.unshift(p.name); return names.join('/'); };
  const overrides = walkPage(page, [rootId]).filter((node) => node.id !== rootId && node.touched?.length).map((node) => ({ node, path: namePath(node, page, rootId) }));
  const keep = Object.fromEntries((['item', 'constraints', 'hidden', 'locked'] as const).filter((key) => root[key] !== undefined).map((key) => [key, root[key]]));
  const tx = composeTransactions(doc, [
    () => created.tx,
    (current) => updateShape(current, pageId, created.rootId, keep as Partial<DesignNode>),
    ...overrides.map(({ node, path }) => (current: DesignDocument) => {
      const nextPage = current.pages.find((item) => item.id === pageId)!;
      const target = walkPage(nextPage, [created.rootId]).find((candidate) => candidate.id !== created.rootId && namePath(candidate, nextPage, created.rootId) === path);
      if (!target) return EMPTY_TRANSACTION;
      const groups = (node.touched ?? []).filter((group) => group !== 'geometry');
      const patch = Object.fromEntries(groups.flatMap((group) => SYNC_GROUPS[group].map((attr) => [attr, (node as unknown as Record<string, unknown>)[attr]])));
      return updateShape(current, pageId, target.id, { ...patch, touched: groups.length ? groups : undefined } as Partial<DesignNode>);
    }),
    (current) => deleteShape(current, pageId, rootId)
  ]);
  return { tx, rootId: created.rootId };
}

/** 토큰 값을 속성 자리에 쓰는 패치. fill은 첫 단색 채우기를 바꾸고 없으면 단색 하나로 둔다. */
export function tokenPatch(node: DesignNode, slot: TokenSlot, token: Token): Partial<DesignNode> {
  switch (slot) {
    case 'fill': {
      const color = String(token.value);
      const index = node.fills.findIndex((paint) => paint.type === 'solid');
      return { fills: index >= 0 ? node.fills.map((paint, position) => (position === index ? { ...paint, color } : paint)) : [{ type: 'solid', color }] };
    }
    case 'stroke': {
      const color = String(token.value);
      const strokes = node.strokes?.length ? node.strokes.map((stroke, position) => (position === 0 ? { ...stroke, color } : stroke)) : [{ color, width: 1, align: 'inside' as const }];
      return { strokes };
    }
    case 'radius': return { radius: Number(token.value) };
    case 'fontSize': return { fontSize: Number(token.value) };
    case 'gap': {
      const gap = Number(token.value);
      // Grid는 열·행 간격 둘 다에 같은 값을 쓴다.
      if (node.layout?.type === 'grid') return { layout: { ...node.layout, columnGap: gap, rowGap: gap } };
      return node.layout ? { layout: { ...node.layout, gap } } : {};
    }
  }
}

/** 속성 자리에 토큰을 연결하거나(tokenId) 끊는다(null). 연결하면 토큰 값을 바로 쓴다. */
export function applyToken(doc: DesignDocument, pageId: string, nodeId: string, slot: TokenSlot, tokenId: string | null): Transaction {
  const node = doc.pages.find((page) => page.id === pageId)?.objects[nodeId];
  if (!node) return EMPTY_TRANSACTION;
  const token = tokenId ? doc.tokens[tokenId] : undefined;
  if (tokenId && (!token || token.type !== TOKEN_SLOT_TYPE[slot])) throw new Error('이 속성에 쓸 수 없는 토큰입니다.');
  const { [slot]: _old, ...rest } = node.tokens ?? {};
  void _old;
  const tokens = token ? { ...rest, [slot]: token.id } : rest;
  return updateShape(doc, pageId, nodeId, { tokens: Object.keys(tokens).length ? tokens : undefined, ...(token ? tokenPatch(node, slot, token) : {}) });
}

/** 바뀐 토큰을 참조하는 모든 도형의 속성을 새 값으로 맞춘다. 지워진 토큰은 참조만 끊고 값은 둔다. */
export function syncTokens(doc: DesignDocument, tokenIds: ReadonlySet<string>): Transaction {
  if (tokenIds.size === 0) return EMPTY_TRANSACTION;
  const steps: Step[] = doc.pages.flatMap((page) => Object.values(page.objects).flatMap((node) => Object.entries(node.tokens ?? {})
    .filter(([, id]) => tokenIds.has(id!))
    .map(([slot, id]) => (current: DesignDocument) => {
      const token = current.tokens[id!];
      const latest = current.pages.find((item) => item.id === page.id)?.objects[node.id];
      if (!latest) return EMPTY_TRANSACTION;
      if (!token) { const { [slot as TokenSlot]: _gone, ...rest } = latest.tokens ?? {}; void _gone; return updateShape(current, page.id, node.id, { tokens: Object.keys(rest).length ? rest : undefined }); }
      return updateShape(current, page.id, node.id, tokenPatch(latest, slot as TokenSlot, token));
    })));
  return composeTransactions(doc, steps);
}

/**
 * 가져온 인스턴스 도형이 메인과 다른 속성 묶음. 위치·크기는 인스턴스 루트가 메인과 같은 크기일 때만 비교한다.
 * 크기가 다르면 자식 위치 차이는 레이아웃·제약 결과이므로 override로 보지 않는다. Figma 계산값의 반올림 차이(0.5px 이하)도 무시한다.
 */
export function touchedAgainstMain(node: DesignNode, main: DesignNode, root: DesignNode, mainRoot: DesignNode): SyncGroup[] {
  const groups: SyncGroup[] = [];
  for (const group of NON_GEOMETRY_GROUPS) {
    if (node === root && ROOT_LOCAL_GROUPS.has(group)) continue;
    if ((SYNC_GROUPS[group] as readonly string[]).some((attr) => !same((node as unknown as Record<string, unknown>)[attr], (main as unknown as Record<string, unknown>)[attr]))) groups.push(group);
  }
  const close = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5;
  const rootResized = !close(root.width, mainRoot.width) || !close(root.height, mainRoot.height);
  if (node === root ? rootResized : !rootResized && (() => {
    const a = relativeBox(node, root);
    const b = relativeBox(main, mainRoot);
    return !close(a.cx, b.cx) || !close(a.cy, b.cy) || !close(a.width, b.width) || !close(a.height, b.height);
  })()) groups.push('geometry');
  return groups;
}
