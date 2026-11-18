import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** JSON 파일을 읽는다. 없으면 fallback. 깨진 파일은 덮어쓰지 않도록 오류를 던진다. */
export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')) as T; }
  catch (error) { throw new Error(`[readJson] JSON 읽기 실패 - ${file}: ${error instanceof Error ? error.message : String(error)}`); }
}

/** 임시 파일에 쓴 뒤 이름을 바꿔, 쓰는 중에 서버가 꺼져도 이전 파일이 남게 한다. */
export function writeJsonAtomic(file: string, value: unknown): void {
  const temp = `${file}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temp, JSON.stringify(value), 'utf8');
    renameSync(temp, file);
  } catch (error) {
    throw new Error(`[writeJsonAtomic] 저장 실패 - ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
