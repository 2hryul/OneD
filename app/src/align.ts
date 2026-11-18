import type { DesignDocument, DesignNode, Page } from './model';
import { boundsOf, worldCorners, type Rect } from './geometry';
import { composeTransactions, moveShapes, type Transaction } from './changes';

export type AlignMode = 'left' | 'h-center' | 'right' | 'top' | 'v-center' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** 오토 레이아웃이 위치를 정하는 도형. 정렬로 옮겨도 다시 배치되므로 건너뛴다(Figma도 막는다). */
function laidOut(page: Page, node: DesignNode): boolean {
  const parent = node.parentId ? page.objects[node.parentId] : undefined;
  return Boolean(parent?.layout && !node.item?.absolute);
}

function movable(page: Page, ids: readonly string[]): DesignNode[] {
  const nodes = ids.map((id) => page.objects[id]).filter((node): node is DesignNode => Boolean(node && !node.locked));
  const free = nodes.filter((node) => !laidOut(page, node));
  if (nodes.length && free.length === 0) throw new Error('오토 레이아웃 안의 요소는 정렬할 수 없습니다. 레이아웃의 정렬을 쓰세요.');
  return free;
}

const boxOf = (node: DesignNode): Rect => boundsOf(worldCorners(node));

function offset(mode: AlignMode, box: Rect, target: Rect): { dx: number; dy: number } {
  switch (mode) {
    case 'left': return { dx: target.x - box.x, dy: 0 };
    case 'h-center': return { dx: target.x + target.width / 2 - (box.x + box.width / 2), dy: 0 };
    case 'right': return { dx: target.x + target.width - (box.x + box.width), dy: 0 };
    case 'top': return { dx: 0, dy: target.y - box.y };
    case 'v-center': return { dx: 0, dy: target.y + target.height / 2 - (box.y + box.height / 2) };
    case 'bottom': return { dx: 0, dy: target.y + target.height - (box.y + box.height) };
  }
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * 정렬. 하나만 고르면 부모 프레임에 맞추고(최상위면 할 일 없음), 여럿이면 고른 것 전체 상자에 맞춘다.
 * 회전한 도형도 화면에 보이는 상자 기준으로 맞춘다.
 */
export function alignNodes(doc: DesignDocument, pageId: string, ids: readonly string[], mode: AlignMode): Transaction {
  const page = doc.pages.find((item) => item.id === pageId)!;
  const nodes = movable(page, ids);
  const parent = nodes.length === 1 && nodes[0]!.parentId ? page.objects[nodes[0]!.parentId] : undefined;
  if (nodes.length === 0 || (nodes.length === 1 && !parent)) return { redo: [], undo: [] };
  const target = nodes.length === 1 ? boxOf(parent!) : boundsOf(nodes.flatMap(worldCorners));
  return composeTransactions(doc, nodes.map((node) => (current: DesignDocument) => {
    const { dx, dy } = offset(mode, boxOf(node), target);
    return moveShapes(current, pageId, node.id, round(dx), round(dy));
  }));
}

/** 간격 맞추기. 셋 이상을 위치 순으로 놓고, 양 끝은 그대로 둔 채 사이 간격을 같게 한다. */
export function distributeNodes(doc: DesignDocument, pageId: string, ids: readonly string[], axis: DistributeAxis): Transaction {
  const page = doc.pages.find((item) => item.id === pageId)!;
  const nodes = movable(page, ids);
  if (nodes.length < 3) throw new Error('간격 맞추기에는 요소가 세 개 이상 필요합니다.');
  const horizontal = axis === 'horizontal';
  const items = nodes.map((node) => ({ node, box: boxOf(node) })).sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y));
  const start = horizontal ? items[0]!.box.x : items[0]!.box.y;
  const last = items[items.length - 1]!.box;
  const end = horizontal ? last.x + last.width : last.y + last.height;
  const sizes = items.reduce((sum, item) => sum + (horizontal ? item.box.width : item.box.height), 0);
  const gap = (end - start - sizes) / (items.length - 1);
  let cursor = start;
  const moves = items.map(({ node, box }) => {
    const delta = cursor - (horizontal ? box.x : box.y);
    cursor += (horizontal ? box.width : box.height) + gap;
    return { id: node.id, dx: horizontal ? round(delta) : 0, dy: horizontal ? 0 : round(delta) };
  });
  return composeTransactions(doc, moves.map((move) => (current: DesignDocument) => moveShapes(current, pageId, move.id, move.dx, move.dy)));
}
