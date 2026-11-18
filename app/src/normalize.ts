import type { DesignDocument } from './model.ts';
import { applyChanges, composeTransactions, normalizeGroups, type Transaction } from './changes.ts';
import { relayoutTouched, touchedIds } from './layoutEdits.ts';
import { idsOf, markTouched, syncComponents, syncTokens } from './components.ts';

/**
 * 사용자 편집 하나에 뒤따르는 보정을 같은 Transaction에 붙인다. undo 한 번에 모두 되돌아간다.
 * 1) 인스턴스에서 바꾼 속성을 touched로 기록 2) 바뀐 토큰 값을 참조하는 속성에 반영 3) 레이아웃 재배치
 * 4) 바뀐 메인 컴포넌트를 인스턴스에 동기화 5) 동기화로 바뀐 곳 재배치 6) 그룹 상자 맞춤.
 * 레이아웃을 동기화보다 먼저 하는 이유는 메인이 최종 배치된 뒤의 값을 인스턴스에 옮기기 위해서다.
 */
export function normalizeAfterEdit(before: DesignDocument, tx: Transaction): Transaction {
  if (tx.redo.length === 0 || tx.redo.some((change) => change.type === 'setDocument')) return tx;
  const tokenIds = new Set(tx.redo.flatMap((change) => (change.type === 'setToken' ? [change.token.id] : change.type === 'delToken' ? [change.id] : [])));
  const full = composeTransactions(before, [
    () => tx,
    (current) => markTouched(before, current, tx),
    (current) => syncTokens(current, tokenIds),
    (current) => relayoutTouched(current, touchedIds(before, tx)),
    (current) => syncAfter(before, current)
  ]);
  return normalizeGroups(before, full);
}

/** 지금까지 바뀐 도형으로 컴포넌트를 동기화하고, 동기화가 바꾼 도형을 다시 배치한다. */
function syncAfter(before: DesignDocument, current: DesignDocument): Transaction {
  const changed = idsOf({ redo: diffIds(before, current), undo: [] });
  const sync = syncComponents(before, current, changed);
  if (sync.redo.length === 0) return sync;
  const synced = applyChanges(current, sync.redo);
  return composeTransactions(current, [() => sync, () => relayoutTouched(synced, touchedIds(current, sync))]);
}

/**
 * before와 current 사이에 바뀐 도형을 modObj 형태로 표시한다. 사용자 편집뿐 아니라 토큰·레이아웃 단계가 바꾼 메인 도형도 동기화 대상에 넣기 위해서다.
 * 도형을 지우면 부모의 children이 바뀌어 부모 객체가 새로 만들어지므로, 지운 경우도 부모를 통해 잡힌다.
 */
function diffIds(before: DesignDocument, current: DesignDocument): Transaction['redo'] {
  const result: Transaction['redo'] = [];
  for (const page of current.pages) {
    const old = before.pages.find((item) => item.id === page.id);
    for (const [id, node] of Object.entries(page.objects)) if (old?.objects[id] !== node) result.push({ type: 'modObj', pageId: page.id, id, set: {} });
  }
  return result;
}
