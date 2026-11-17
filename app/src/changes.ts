import { IDENTITY, isContainer, walkPage, type DesignDocument, type DesignNode, type Matrix, type NodeInput, type Page, type ShapeAttrs } from './model';
import { applyVector, boundsOf, center, cleanMatrix, invert, linearPart, multiply, rotation, roundRect, worldCorners, type Rect } from './geometry';

/**
 * 문서 변경의 최소 단위. Penpot `common/files/changes.cljc`의 add-obj, mod-obj, del-obj, mov-objects를 따른다.
 * 모든 편집은 변경 목록과, 그 목록을 되돌리는 역변경 목록의 쌍(Transaction)으로 표현한다.
 */
export type Change =
  | { type: 'addObj'; pageId: string; obj: DesignNode; index: number }
  | { type: 'modObj'; pageId: string; id: string; set: Partial<ShapeAttrs>; unset?: Array<keyof ShapeAttrs> }
  | { type: 'delObj'; pageId: string; id: string }
  | { type: 'movObjects'; pageId: string; ids: string[]; parentId: string | null; index: number }
  | { type: 'addPage'; page: Page; index: number }
  | { type: 'delPage'; pageId: string }
  // 파일 열기·가져오기는 도형 단위 편집이 아니라 문서 교체다. 되돌릴 수 있도록 문서 전체를 담는다.
  | { type: 'setDocument'; document: DesignDocument };

export interface Transaction { redo: Change[]; undo: Change[] }

export interface HistoryEntry extends Transaction {
  /** 같은 키의 연속 편집을 하나로 합칠 때 쓴다. 예: `노드id:width`. */
  mergeKey?: string;
  at: number;
}

export const EMPTY_TRANSACTION: Transaction = { redo: [], undo: [] };
export const HISTORY_LIMIT = 100;
export const MERGE_WINDOW_MS = 1000;

const LOCKED_KEYS = new Set(['id', 'type', 'parentId', 'children']);

/**
 * 변경 목록을 순서대로 적용한 새 문서를 돌려준다. 입력 문서는 바꾸지 않는다.
 * 페이지와 객체 표는 호출 한 번에 한 번만 복사한다. 드래그 중 수백 개 도형을 옮길 때 변경마다 복사하지 않기 위해서다.
 */
export function applyChanges(doc: DesignDocument, changes: readonly Change[]): DesignDocument {
  let base = doc;
  const drafts = new Map<string, Page>();
  const draftPage = (pageId: string): Page => {
    const existing = drafts.get(pageId);
    if (existing) return existing;
    const source = base.pages.find((page) => page.id === pageId);
    if (!source) throw new Error(`[applyChanges] 페이지 없음 - ${pageId}`);
    const draft = { ...source, children: [...source.children], objects: { ...source.objects } };
    drafts.set(pageId, draft);
    return draft;
  };
  for (const change of changes) {
    if (change.type === 'setDocument') { base = change.document; drafts.clear(); continue; }
    if (change.type === 'addPage') { base = withPageAdded(base, change.page, change.index); continue; }
    if (change.type === 'delPage') { base = { ...base, pages: base.pages.filter((page) => page.id !== change.pageId) }; drafts.delete(change.pageId); continue; }
    applyToPage(draftPage(change.pageId), change);
  }
  if (drafts.size === 0) return base;
  return { ...base, pages: base.pages.map((page) => drafts.get(page.id) ?? page) };
}

function withPageAdded(doc: DesignDocument, page: Page, index: number): DesignDocument {
  if (doc.pages.some((item) => item.id === page.id)) throw new Error(`[applyChanges] 페이지 id 중복 - ${page.id}`);
  const pages = [...doc.pages];
  pages.splice(Math.max(0, Math.min(index, pages.length)), 0, page);
  return { ...doc, pages };
}

function applyToPage(page: Page, change: Extract<Change, { pageId: string; type: 'addObj' | 'modObj' | 'delObj' | 'movObjects' }>): void {
  switch (change.type) {
    case 'addObj': {
      if (page.objects[change.obj.id]) throw new Error(`[applyChanges] 도형 id 중복 - ${change.obj.id}`);
      // 자식은 각자의 addObj로 다시 붙는다. 여기서 children을 비워야 중복으로 들어가지 않는다.
      page.objects[change.obj.id] = { ...change.obj, ...(isContainer(change.obj) ? { children: [] } : {}) };
      insertChildren(page, change.obj.parentId, [change.obj.id], change.index);
      return;
    }
    case 'modObj': {
      const node = requireNode(page, change.id);
      const next: Record<string, unknown> = { ...node, ...change.set };
      for (const key of change.unset ?? []) delete next[key];
      page.objects[change.id] = next as unknown as DesignNode;
      return;
    }
    case 'delObj': {
      const node = requireNode(page, change.id);
      if (node.children?.length) throw new Error(`[applyChanges] 자식이 남은 도형은 지울 수 없음 - ${change.id}`);
      removeChild(page, node.parentId, node.id);
      delete page.objects[change.id];
      return;
    }
    case 'movObjects': {
      if (change.parentId !== null) {
        const parent = requireNode(page, change.parentId);
        if (!isContainer(parent)) throw new Error(`[applyChanges] 부모가 컨테이너가 아님 - ${change.parentId}`);
        for (const id of change.ids) {
          if (isSameOrAncestor(page, id, change.parentId)) throw new Error(`[applyChanges] 자기 하위로 옮길 수 없음 - ${id}`);
        }
      }
      for (const id of change.ids) {
        const node = requireNode(page, id);
        removeChild(page, node.parentId, id);
        page.objects[id] = { ...node, parentId: change.parentId };
      }
      insertChildren(page, change.parentId, change.ids, change.index);
    }
  }
}

function requireNode(page: Page, id: string): DesignNode {
  const node = page.objects[id];
  if (!node) throw new Error(`[applyChanges] 도형 없음 - ${id}`);
  return node;
}

export function childrenOf(page: Page, parentId: string | null): readonly string[] {
  return parentId === null ? page.children : page.objects[parentId]?.children ?? [];
}

function setChildren(page: Page, parentId: string | null, children: string[]): void {
  if (parentId === null) { page.children = children; return; }
  const parent = requireNode(page, parentId);
  if (!isContainer(parent)) throw new Error(`[applyChanges] 부모가 컨테이너가 아님 - ${parentId}`);
  page.objects[parentId] = { ...parent, children };
}

function insertChildren(page: Page, parentId: string | null, ids: readonly string[], index: number): void {
  const current = [...childrenOf(page, parentId)];
  current.splice(Math.max(0, Math.min(index, current.length)), 0, ...ids);
  setChildren(page, parentId, current);
}

function removeChild(page: Page, parentId: string | null, id: string): void {
  setChildren(page, parentId, childrenOf(page, parentId).filter((item) => item !== id));
}

function isSameOrAncestor(page: Page, candidate: string, id: string | null): boolean {
  for (let current = id; current !== null; current = page.objects[current]?.parentId ?? null) {
    if (current === candidate) return true;
  }
  return false;
}

function findPage(doc: DesignDocument, pageId: string): Page {
  const page = doc.pages.find((item) => item.id === pageId);
  if (!page) throw new Error(`페이지 없음 - ${pageId}`);
  return page;
}

function findNode(page: Page, id: string): DesignNode {
  const node = page.objects[id];
  if (!node) throw new Error(`도형 없음 - ${id}`);
  return node;
}

/**
 * 도형을 추가하는 변경을 만든다.
 *
 * Args:
 *   index: 부모의 children에서 들어갈 위치. 생략하면 맨 위(마지막)에 놓는다.
 */
export function addShape(doc: DesignDocument, pageId: string, shape: NodeInput, index?: number): Transaction {
  const page = findPage(doc, pageId);
  if (page.objects[shape.id]) throw new Error('Duplicate node id');
  const parent = shape.parentId === null ? null : page.objects[shape.parentId];
  if (shape.parentId !== null && (!parent || !isContainer(parent))) throw new Error('Parent must be a frame or group');
  const obj: DesignNode = { ...shape, transform: [...(shape.transform ?? IDENTITY)] as Matrix, ...(isContainer(shape) ? { children: [] } : {}) };
  return {
    redo: [{ type: 'addObj', pageId, obj, index: index ?? childrenOf(page, shape.parentId).length }],
    undo: [{ type: 'delObj', pageId, id: shape.id }]
  };
}

/** 도형 속성을 바꾸는 변경을 만든다. 값이 같은 속성과 계층 속성은 무시하고, 바뀐 것이 없으면 빈 Transaction을 돌려준다. */
export function updateShape(doc: DesignDocument, pageId: string, id: string, patch: Partial<DesignNode>): Transaction {
  const node = findNode(findPage(doc, pageId), id);
  const set: Record<string, unknown> = {};
  const undoSet: Record<string, unknown> = {};
  const undoUnset: Array<keyof ShapeAttrs> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (LOCKED_KEYS.has(key) || value === undefined) continue;
    const previous = (node as unknown as Record<string, unknown>)[key];
    if (sameValue(previous, value)) continue;
    set[key] = value;
    if (key in node) undoSet[key] = previous; else undoUnset.push(key as keyof ShapeAttrs);
  }
  if (Object.keys(set).length === 0) return EMPTY_TRANSACTION;
  return {
    redo: [{ type: 'modObj', pageId, id, set: set as Partial<ShapeAttrs> }],
    undo: [{ type: 'modObj', pageId, id, set: undoSet as Partial<ShapeAttrs>, ...(undoUnset.length ? { unset: undoUnset } : {}) }]
  };
}

/** 도형과 모든 하위 도형을 dx, dy만큼 옮기는 변경을 만든다. 좌표가 절대값이라 하위 도형도 함께 바꿔야 한다. */
export function moveShapes(doc: DesignDocument, pageId: string, id: string, dx: number, dy: number): Transaction {
  if (dx === 0 && dy === 0) return EMPTY_TRANSACTION;
  const page = findPage(doc, pageId);
  findNode(page, id);
  const nodes = walkPage(page, [id]);
  return {
    redo: nodes.map((node) => ({ type: 'modObj', pageId, id: node.id, set: { x: node.x + dx, y: node.y + dy } })),
    undo: nodes.map((node) => ({ type: 'modObj', pageId, id: node.id, set: { x: node.x, y: node.y } }))
  };
}

/** 도형과 하위 도형을 지우는 변경을 만든다. 되돌리면 원래 부모의 같은 위치에 같은 순서로 복원된다. */
export function deleteShape(doc: DesignDocument, pageId: string, id: string): Transaction {
  const page = findPage(doc, pageId);
  findNode(page, id);
  const nodes = walkPage(page, [id]);
  // 지울 때는 자식부터, 복원할 때는 부모부터 처리해야 한다. walkPage 결과가 부모 먼저이므로 지우기는 역순으로 한다.
  return {
    redo: [...nodes].reverse().map((node) => ({ type: 'delObj', pageId, id: node.id })),
    undo: nodes.map((node) => ({ type: 'addObj', pageId, obj: node, index: childrenOf(page, node.parentId).indexOf(node.id) }))
  };
}

/** 도형을 다른 부모의 index 위치로 옮기는 변경을 만든다. 좌표는 바꾸지 않는다. */
export function reparentShape(doc: DesignDocument, pageId: string, id: string, parentId: string | null, index: number): Transaction {
  const page = findPage(doc, pageId);
  const node = findNode(page, id);
  return {
    redo: [{ type: 'movObjects', pageId, ids: [id], parentId, index }],
    undo: [{ type: 'movObjects', pageId, ids: [id], parentId: node.parentId, index: childrenOf(page, node.parentId).indexOf(id) }]
  };
}

/** 문서 전체를 바꾸는 변경을 만든다. 파일 열기와 `.fig` 가져오기에 쓴다. */
export function replaceDocument(doc: DesignDocument, next: DesignDocument): Transaction {
  return { redo: [{ type: 'setDocument', document: next }], undo: [{ type: 'setDocument', document: doc }] };
}

/**
 * undo 기록에 Transaction을 추가한다.
 * 직전 기록과 mergeKey가 같고 MERGE_WINDOW_MS 안에 이어진 편집이면 하나로 합쳐, 입력칸에 여러 글자를 쳐도 undo 한 번에 되돌아가게 한다.
 *
 * Args:
 *   past: 지금까지의 undo 기록
 *   now: 현재 시각(ms). 테스트에서 시간을 고정하려고 인자로 받는다.
 *   mergeKey: 합칠 편집을 구분하는 키. 생략하면 합치지 않는다.
 */
export function recordTransaction(past: readonly HistoryEntry[], tx: Transaction, now: number, mergeKey?: string): HistoryEntry[] {
  if (tx.redo.length === 0) return [...past];
  const last = past[past.length - 1];
  if (mergeKey && last?.mergeKey === mergeKey && now - last.at <= MERGE_WINDOW_MS) {
    return [...past.slice(0, -1), { redo: [...last.redo, ...tx.redo], undo: [...tx.undo, ...last.undo], mergeKey, at: now }];
  }
  return [...past, { ...tx, mergeKey, at: now }].slice(-HISTORY_LIMIT);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

type Step = (current: DesignDocument) => Transaction;

/**
 * 여러 편집을 하나의 Transaction으로 묶는다. 각 단계는 앞 단계를 적용한 문서를 받아 변경을 만든다.
 * 역변경은 뒤 단계부터 되돌리도록 앞에 쌓는다.
 */
export function composeTransactions(doc: DesignDocument, steps: readonly Step[]): Transaction {
  let current = doc;
  const redo: Change[] = [];
  let undo: Change[] = [];
  for (const step of steps) {
    const tx = step(current);
    if (tx.redo.length === 0) continue;
    current = applyChanges(current, tx.redo);
    redo.push(...tx.redo);
    undo = [...tx.undo, ...undo];
  }
  return { redo, undo };
}

/** 여러 도형을 함께 옮긴다. 선택에 부모와 자식이 같이 있으면 자식이 두 번 움직이므로 호출 전에 topLevelIds로 정리한다. */
export function moveMany(doc: DesignDocument, pageId: string, ids: readonly string[], dx: number, dy: number): Transaction {
  return composeTransactions(doc, ids.map((id) => (current: DesignDocument) => moveShapes(current, pageId, id, dx, dy)));
}

export function deleteShapes(doc: DesignDocument, pageId: string, ids: readonly string[]): Transaction {
  return composeTransactions(doc, ids.map((id) => (current: DesignDocument) => {
    const page = findPage(current, pageId);
    return page.objects[id] ? deleteShape(current, pageId, id) : EMPTY_TRANSACTION;
  }));
}

/** 선택 목록에서 다른 선택 도형의 하위에 있는 id를 뺀다. */
export function topLevelIds(page: Page, ids: readonly string[]): string[] {
  const selected = new Set(ids);
  return ids.filter((id) => {
    for (let parent = page.objects[id]?.parentId ?? null; parent !== null; parent = page.objects[parent]?.parentId ?? null) {
      if (selected.has(parent)) return false;
    }
    return Boolean(page.objects[id]);
  });
}

/**
 * 도형과 하위 도형을 도형 중심 기준으로 degrees만큼 회전한다.
 * 좌표가 절대값이라 하위 도형도 중심을 회전시켜 옮기고 각자의 행렬에 같은 회전을 곱한다.
 */
export function rotateShape(doc: DesignDocument, pageId: string, id: string, degrees: number): Transaction {
  if (!degrees) return EMPTY_TRANSACTION;
  const page = findPage(doc, pageId);
  const pivot = center(findNode(page, id));
  const turn = rotation(degrees);
  const nodes = walkPage(page, [id]);
  return {
    redo: nodes.map((node): Change => {
      const c = center(node);
      const v = applyVector(turn, { x: c.x - pivot.x, y: c.y - pivot.y });
      const box = roundRect({ x: pivot.x + v.x - node.width / 2, y: pivot.y + v.y - node.height / 2, width: node.width, height: node.height });
      return { type: 'modObj', pageId, id: node.id, set: { x: box.x, y: box.y, transform: cleanMatrix(multiply(turn, node.transform)) } };
    }),
    undo: nodes.map((node): Change => ({ type: 'modObj', pageId, id: node.id, set: { x: node.x, y: node.y, transform: node.transform } }))
  };
}

/**
 * 도형 상자를 box로 바꾼다. 프레임의 자식은 그대로 두고(Figma 기본 제약 left, top), 그룹은 자식을 같은 비율로 늘린다.
 */
export function resizeShape(doc: DesignDocument, pageId: string, id: string, box: Rect): Transaction {
  const page = findPage(doc, pageId);
  const node = findNode(page, id);
  if (node.type !== 'group') return updateShape(doc, pageId, id, box);
  const sx = box.width / node.width;
  const sy = box.height / node.height;
  const linear = linearPart(node.transform);
  const toLocal = invert(linear);
  const from = center(node);
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const steps: Step[] = walkPage(page, [id]).slice(1).map((child) => (current: DesignDocument) => {
    const local = applyVector(toLocal, { x: center(child).x - from.x, y: center(child).y - from.y });
    const moved = applyVector(linear, { x: local.x * sx, y: local.y * sy });
    const width = child.width * sx;
    const height = child.height * sy;
    return updateShape(current, pageId, child.id, roundRect({ x: to.x + moved.x - width / 2, y: to.y + moved.y - height / 2, width, height }));
  });
  return composeTransactions(doc, [(current) => updateShape(current, pageId, id, box), ...steps]);
}

/** 같은 부모 아래의 도형들을 새 그룹으로 묶는다. 그룹은 묶인 도형 중 가장 위 도형 자리에 들어간다. */
export function groupShapes(doc: DesignDocument, pageId: string, ids: readonly string[], groupId: string): Transaction {
  const page = findPage(doc, pageId);
  const nodes = ids.map((id) => findNode(page, id));
  if (nodes.length === 0) return EMPTY_TRANSACTION;
  const parentId = nodes[0]!.parentId;
  if (nodes.some((node) => node.parentId !== parentId)) throw new Error('같은 부모 안의 요소만 묶을 수 있습니다.');
  const siblings = childrenOf(page, parentId);
  const ordered = [...ids].sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b));
  const top = siblings.indexOf(ordered[ordered.length - 1]!);
  const box = roundRect(boundsOf(nodes.flatMap(worldCorners)));
  return composeTransactions(doc, [
    (current) => addShape(current, pageId, { id: groupId, type: 'group', name: 'Group', parentId, ...box, fill: 'transparent' }, top + 1),
    ...ordered.map((id, index) => (current: DesignDocument) => reparentShape(current, pageId, id, groupId, index))
  ]);
}

/** 그룹을 풀어 자식을 그룹이 있던 자리에 같은 순서로 놓는다. 자식의 위치와 회전은 절대값이라 바뀌지 않는다. */
export function ungroupShape(doc: DesignDocument, pageId: string, groupId: string): Transaction {
  const page = findPage(doc, pageId);
  const group = findNode(page, groupId);
  if (group.type !== 'group') return EMPTY_TRANSACTION;
  const index = childrenOf(page, group.parentId).indexOf(groupId);
  return composeTransactions(doc, [
    ...(group.children ?? []).map((id, offset) => (current: DesignDocument) => reparentShape(current, pageId, id, group.parentId, index + offset)),
    (current) => deleteShape(current, pageId, groupId)
  ]);
}

export function addPage(doc: DesignDocument, page: Page, index = doc.pages.length): Transaction {
  return { redo: [{ type: 'addPage', page, index }], undo: [{ type: 'delPage', pageId: page.id }] };
}

/**
 * 편집 뒤 그룹 상자를 자식 영역에 맞추고, 자식이 없는 그룹은 지운다(Figma와 같은 동작).
 * 커밋하는 모든 편집에 붙여서, 그룹 안 도형을 옮기거나 빼낼 때 그룹 상자가 어긋나지 않게 한다.
 */
export function normalizeGroups(doc: DesignDocument, tx: Transaction): Transaction {
  const pageIds = new Set<string>();
  for (const change of tx.redo) {
    if (change.type === 'setDocument') return tx;
    if (change.type === 'addObj' || change.type === 'modObj' || change.type === 'delObj' || change.type === 'movObjects') pageIds.add(change.pageId);
  }
  if (pageIds.size === 0) return tx;
  return composeTransactions(doc, [() => tx, ...[...pageIds].map((pageId) => (current: DesignDocument) => fitGroups(current, pageId))]);
}

function fitGroups(doc: DesignDocument, pageId: string): Transaction {
  const page = doc.pages.find((item) => item.id === pageId);
  if (!page) return EMPTY_TRANSACTION;
  // 안쪽 그룹을 먼저 맞춰야 바깥 그룹이 바뀐 안쪽 그룹 상자를 기준으로 계산된다.
  const groups = walkPage(page).filter((node) => node.type === 'group').reverse();
  return composeTransactions(doc, groups.map((group) => (current: DesignDocument) => fitGroup(current, pageId, group.id)));
}

function fitGroup(doc: DesignDocument, pageId: string, id: string): Transaction {
  const page = findPage(doc, pageId);
  const group = page.objects[id];
  if (!group) return EMPTY_TRANSACTION;
  if (!group.children?.length) return deleteShape(doc, pageId, id);
  return updateShape(doc, pageId, id, groupBounds(page, group));
}

/** 그룹 자식의 꼭짓점을 그룹 회전축 기준으로 감싸는 상자. 그룹이 회전돼 있어도 상자가 그룹과 같이 기울어 있다. */
function groupBounds(page: Page, group: DesignNode): Rect {
  const linear = linearPart(group.transform);
  const toLocal = invert(linear);
  const points = (group.children ?? []).flatMap((id) => (page.objects[id] ? worldCorners(page.objects[id]!) : [])).map((p) => applyVector(toLocal, p));
  const local = boundsOf(points);
  const middle = applyVector(linear, { x: local.x + local.width / 2, y: local.y + local.height / 2 });
  const width = Math.max(1, local.width);
  const height = Math.max(1, local.height);
  return roundRect({ x: middle.x - width / 2, y: middle.y - height / 2, width, height });
}
