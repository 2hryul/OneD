import type { DesignDocument, Page } from './model';
import { EMPTY_TRANSACTION, childrenOf, composeTransactions, reparentShape, topLevelIds, type Transaction } from './changes';

/** 레이어 순서 바꾸기. forward·backward는 한 칸, front·back은 맨 위·맨 아래로. 목록 뒤쪽이 위에 그려진다. */
export type ReorderMode = 'forward' | 'backward' | 'front' | 'back';

/**
 * 형제 목록에서 고른 것들의 새 순서. 고른 것끼리의 위아래는 유지한다(Figma와 같음).
 * 한 칸 올리기는 바로 위가 고르지 않은 형제일 때만 자리를 바꾼다.
 */
export function reorderedSiblings(siblings: readonly string[], selected: ReadonlySet<string>, mode: ReorderMode): string[] {
  const order = [...siblings];
  if (mode === 'front') return [...order.filter((id) => !selected.has(id)), ...order.filter((id) => selected.has(id))];
  if (mode === 'back') return [...order.filter((id) => selected.has(id)), ...order.filter((id) => !selected.has(id))];
  if (mode === 'forward') {
    for (let index = order.length - 2; index >= 0; index--) {
      if (selected.has(order[index]!) && !selected.has(order[index + 1]!)) [order[index], order[index + 1]] = [order[index + 1]!, order[index]!];
    }
  } else {
    for (let index = 1; index < order.length; index++) {
      if (selected.has(order[index]!) && !selected.has(order[index - 1]!)) [order[index], order[index - 1]] = [order[index - 1]!, order[index]!];
    }
  }
  return order;
}

/** 고른 도형들의 레이어 순서를 바꾸는 Transaction. 부모가 다르면 부모마다 따로 바꾼다. 오토 레이아웃 안에서는 배치 순서도 바뀐다. */
export function reorderNodes(doc: DesignDocument, pageId: string, ids: readonly string[], mode: ReorderMode): Transaction {
  const page = doc.pages.find((item) => item.id === pageId);
  if (!page) return EMPTY_TRANSACTION;
  const roots = topLevelIds(page, ids).filter((id) => page.objects[id]);
  const parents = [...new Set(roots.map((id) => page.objects[id]!.parentId))];
  const steps = parents.flatMap((parentId) => moveSteps(page, parentId, new Set(roots), mode));
  return steps.length ? composeTransactions(doc, steps) : EMPTY_TRANSACTION;
}

/** 목표 순서가 되도록 앞에서부터 한 개씩 제자리로 옮기는 단계들. 이미 제자리인 것은 건너뛴다. */
function moveSteps(page: Page, parentId: string | null, selected: ReadonlySet<string>, mode: ReorderMode): Array<(doc: DesignDocument) => Transaction> {
  const current = childrenOf(page, parentId);
  const target = reorderedSiblings(current, selected, mode);
  const working = [...current];
  const steps: Array<(doc: DesignDocument) => Transaction> = [];
  target.forEach((id, index) => {
    if (working[index] === id) return;
    working.splice(working.indexOf(id), 1);
    working.splice(index, 0, id);
    steps.push((doc) => reparentShape(doc, page.id, id, parentId, index));
  });
  return steps;
}
