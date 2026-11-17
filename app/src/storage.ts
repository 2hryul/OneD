import { parseDocument, sampleDocument, type DesignDocument } from './model';

export const STORAGE_KEY = 'canvas-studio-v1';
export const RECOVERY_KEY = 'canvas-studio-v1.recovery';

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export interface LoadResult {
  document: DesignDocument;
  /** 저장본을 읽지 못해 샘플로 시작했을 때 사용자에게 보여줄 안내. 정상 로드면 undefined. */
  notice?: string;
}

/**
 * 자동 저장본을 읽어 시작 문서를 정한다.
 * 저장본을 해석하지 못하면 원문을 복구 키로 옮긴 뒤 샘플로 시작한다.
 * 곧바로 이어지는 자동 저장이 원문을 덮어쓰므로, 옮기지 않으면 사용자의 작업이 사라진다.
 *
 * Args:
 *   store: localStorage 또는 테스트용 저장소
 */
export function loadStoredDocument(store: KeyValueStore): LoadResult {
  let raw: string | null;
  try { raw = store.getItem(STORAGE_KEY); }
  catch (error) { return { document: sampleDocument(), notice: `[loadStoredDocument] 자동 저장소 읽기 실패 - ${reason(error)}` }; }
  if (!raw) return { document: sampleDocument() };
  try { return { document: parseDocument(raw) }; }
  catch (error) {
    // 이전 실패의 복구본이 남아 있으면 지우지 않는다. 사용자가 아직 꺼내지 않은 작업일 수 있다.
    let kept = false;
    try {
      if (store.getItem(RECOVERY_KEY) === null) store.setItem(RECOVERY_KEY, raw);
      kept = true;
    } catch { kept = false; }
    const where = kept ? '이전 작업은 복구본으로 보관했습니다.' : '복구본도 저장하지 못했습니다.';
    return { document: sampleDocument(), notice: `자동 저장본을 열지 못해 샘플로 시작했습니다 (${reason(error)}). ${where}` };
  }
}

/**
 * 문서를 자동 저장소에 쓴다.
 *
 * Returns:
 *   저장에 성공하면 true. 용량 초과 등으로 실패하면 false.
 */
export function saveStoredDocument(store: KeyValueStore, document: DesignDocument): boolean {
  try { store.setItem(STORAGE_KEY, JSON.stringify(document)); return true; }
  catch { return false; }
}

/** 보관 중인 복구본 원문. 없거나 읽을 수 없으면 null. */
export function readRecovery(store: KeyValueStore): string | null {
  try { return store.getItem(RECOVERY_KEY); }
  catch { return null; }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
