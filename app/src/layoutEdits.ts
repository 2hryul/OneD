import { walkPage, type DesignDocument, type DesignNode, type Matrix, type Page } from './model.ts';
import { applyPoint, boundsOf, center, invert, linearPart, multiply, roundRect, worldCorners, worldMatrix, type Point } from './geometry.ts';
import { applyChanges, composeTransactions, EMPTY_TRANSACTION, moveShapes, resizeShape, updateShape, type Transaction } from './changes.ts';
import { computeFlex, type Box } from './layout.ts';

const MAX_PASSES = 8;

function pageOf(doc: DesignDocument, pageId: string): Page | undefined {
  return doc.pages.find((page) => page.id === pageId);
}

/** 레이아웃 흐름에 참여하는 자식. 숨긴 자식과 absolute 자식은 빠진다. */
export function flowChildren(page: Page, container: DesignNode): DesignNode[] {
  return (container.children ?? []).map((id) => page.objects[id]).filter((child): child is DesignNode => Boolean(child && !child.hidden && !child.item?.absolute));
}

/** 컨테이너 지역 좌표에서 본 자식의 영역. 자식이 컨테이너와 다르게 회전돼 있으면 회전된 꼭짓점을 감싸는 상자다(Figma와 같음). */
interface LocalChild { node: DesignNode; bounds: Box; rotated: boolean }

function localChild(child: DesignNode, toLocal: Matrix, containerLinear: Matrix): LocalChild {
  const bounds = boundsOf(worldCorners(child).map((point) => applyPoint(toLocal, point)));
  const relative = multiply(invert(containerLinear), linearPart(child.transform));
  const rotated = Math.abs(relative[0] - 1) > 1e-6 || Math.abs(relative[3] - 1) > 1e-6 || Math.abs(relative[1]) > 1e-6 || Math.abs(relative[2]) > 1e-6;
  return { node: child, bounds, rotated };
}

/**
 * 레이아웃 컨테이너 하나를 다시 배치하는 Transaction.
 * 자식 영역을 컨테이너 지역 좌표로 바꿔 엔진에 넣고, 결과를 컨테이너 행렬로 되돌린다. 회전된 컨테이너도 같은 식이다.
 * 컨테이너와 다르게 회전된 자식은 회전 상자로 자리만 잡고 크기는 바꾸지 않는다.
 * 내용에 맞춤(hug)이면 컨테이너는 왼쪽 위를 기준으로 크기가 바뀐다.
 */
export function layoutContainer(doc: DesignDocument, pageId: string, id: string): Transaction {
  const page = pageOf(doc, pageId);
  const node = page?.objects[id];
  if (!page || !node?.layout) return EMPTY_TRANSACTION;
  const world = worldMatrix(node);
  const toLocal = invert(world);
  const children = flowChildren(page, node).map((child) => localChild(child, toLocal, linearPart(node.transform)));
  // 보이는 자식이 없으면 Figma는 내용에 맞춤이어도 마지막 크기를 유지한다.
  if (children.length === 0) return EMPTY_TRANSACTION;
  const result = computeFlex({ width: node.width, height: node.height, layout: node.layout, item: node.item }, children.map(({ node: child, bounds, rotated }) => ({
    id: child.id, width: bounds.width, height: bounds.height, item: rotated ? { ...child.item, h: 'fix', v: 'fix' } : child.item
  })));
  const middle = applyPoint(world, { x: result.width / 2, y: result.height / 2 });
  const box = roundRect({ x: middle.x - result.width / 2, y: middle.y - result.height / 2, width: result.width, height: result.height });
  // 왼쪽 위를 기준으로 크기만 바뀌므로 지역 좌표 → 페이지 좌표 변환은 바뀌기 전 행렬과 같다.
  const steps = children.map((child) => (current: DesignDocument) => placeChild(current, pageId, child, world, result.boxes.get(child.node.id)!));
  return composeTransactions(doc, [(current) => updateShape(current, pageId, id, box), ...steps]);
}

function placeChild(doc: DesignDocument, pageId: string, child: LocalChild, parentWorld: Matrix, local: Box): Transaction {
  const node = pageOf(doc, pageId)?.objects[child.node.id];
  if (!node) return EMPTY_TRANSACTION;
  const placed: Point = applyPoint(parentWorld, { x: local.x + local.width / 2, y: local.y + local.height / 2 });
  const sizeChanged = !child.rotated && (Math.abs(local.width - node.width) > 0.005 || Math.abs(local.height - node.height) > 0.005);
  if (!sizeChanged) {
    const now = applyPoint(parentWorld, { x: child.bounds.x + child.bounds.width / 2, y: child.bounds.y + child.bounds.height / 2 });
    return moveShapes(doc, pageId, node.id, round(placed.x - now.x), round(placed.y - now.y));
  }
  return resizeShape(doc, pageId, node.id, roundRect({ x: placed.x - local.width / 2, y: placed.y - local.height / 2, width: local.width, height: local.height }));
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** 편집이 건드린 도형 id를 페이지별로 모은다. 지워지거나 옮겨진 도형은 원래 부모도 포함한다. */
export function touchedIds(before: DesignDocument, tx: Transaction): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const add = (pageId: string, id: string | null | undefined): void => {
    if (!id) return;
    const set = result.get(pageId) ?? new Set<string>();
    set.add(id);
    result.set(pageId, set);
  };
  const parentBefore = (pageId: string, id: string): string | null | undefined => pageOf(before, pageId)?.objects[id]?.parentId;
  for (const change of tx.redo) {
    if (change.type === 'addObj') { add(change.pageId, change.obj.id); add(change.pageId, change.obj.parentId); }
    else if (change.type === 'modObj') add(change.pageId, change.id);
    else if (change.type === 'delObj') add(change.pageId, parentBefore(change.pageId, change.id));
    else if (change.type === 'movObjects') {
      add(change.pageId, change.parentId);
      for (const id of change.ids) { add(change.pageId, id); add(change.pageId, parentBefore(change.pageId, id)); }
    }
  }
  return result;
}

/** 다시 배치할 컨테이너: 건드린 도형 자신(레이아웃이면)과 레이아웃을 가진 모든 조상. 안쪽부터 계산하도록 깊이 역순으로 정렬한다. */
function affectedContainers(page: Page, ids: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const id of ids) {
    for (let current: string | null = id; current !== null; current = page.objects[current]?.parentId ?? null) {
      if (page.objects[current]?.layout) found.add(current);
    }
  }
  const depth = (id: string): number => { let count = 0; for (let p = page.objects[id]?.parentId ?? null; p; p = page.objects[p]?.parentId ?? null) count++; return count; };
  return [...found].sort((a, b) => depth(b) - depth(a));
}

export function relayoutTouched(doc: DesignDocument, touched: Map<string, Set<string>>): Transaction {
  const steps = [...touched].map(([pageId, ids]) => (current: DesignDocument) => relayoutPage(current, pageId, ids));
  return composeTransactions(doc, steps);
}

function relayoutPage(doc: DesignDocument, pageId: string, ids: Set<string>): Transaction {
  let current = doc;
  let pending = new Set(ids);
  const collected: Transaction[] = [];
  for (let pass = 0; pass < MAX_PASSES && pending.size; pass++) {
    const page = pageOf(current, pageId);
    if (!page) break;
    const containers = affectedContainers(page, pending);
    const tx = composeTransactions(current, containers.map((id) => (next: DesignDocument) => layoutContainer(next, pageId, id)));
    if (tx.redo.length === 0) break;
    collected.push(tx);
    current = applyChanges(current, tx.redo);
    // 크기가 바뀐 레이아웃 컨테이너(바깥에서 fill로 늘어난 경우)를 다음 차례에 다시 배치한다.
    pending = new Set(tx.redo.flatMap((change) => change.type === 'modObj' && ('width' in change.set || 'height' in change.set) && pageOf(current, pageId)?.objects[change.id]?.layout ? [change.id] : []));
  }
  return { redo: collected.flatMap((tx) => tx.redo), undo: collected.reverse().flatMap((tx) => tx.undo) };
}

/**
 * 레이아웃 컨테이너 안에서 point(페이지 좌표)에 놓을 순서. 주축에서 point보다 앞에 있는 형제 수다.
 * 끌어서 놓을 때 Figma처럼 자식 순서를 바꾸는 데 쓴다.
 */
export function dropIndex(page: Page, containerId: string, point: Point, moving: ReadonlySet<string>): number {
  const container = page.objects[containerId];
  if (!container?.layout) return container?.children?.length ?? 0;
  const toLocal = invert(worldMatrix(container));
  const local = applyPoint(toLocal, point);
  const axis = container.layout.direction === 'row' ? 'x' : 'y';
  const siblings = (container.children ?? []).filter((id) => !moving.has(id));
  let index = 0;
  siblings.forEach((id, position) => {
    const child = page.objects[id];
    if (child && !child.hidden && !child.item?.absolute && applyPoint(toLocal, center(child))[axis] < local[axis]) index = position + 1;
  });
  return index;
}

/** 페이지의 모든 레이아웃 컨테이너. 가져온 문서가 엔진과 얼마나 맞는지 잴 때 쓴다. */
export function layoutContainers(page: Page): DesignNode[] {
  return walkPage(page).filter((node) => node.layout);
}
