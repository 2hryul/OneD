import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const RETENTION_DAYS = 30;

/** 사용자 이름은 개인정보로 보고 앞 두 글자만 남긴다. 예: "minsoo" → "mi****" */
export function maskName(name: string): string {
  return name.length <= 2 ? `${name[0] ?? ''}*` : `${name.slice(0, 2)}${'*'.repeat(Math.min(4, name.length - 2))}`;
}

/** 30일보다 오래된 로그 파일을 지운다. 지우지 못한 파일은 건너뛴다(다음 시작 때 다시 시도). */
export function pruneLogs(dir: string, now = Date.now()): number {
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!/^server-\d{8}\.log$/.test(name)) continue;
    const file = join(dir, name);
    try {
      if (now - statSync(file).mtimeMs > RETENTION_DAYS * 86_400_000) { unlinkSync(file); removed++; }
    } catch { /* 다른 프로세스가 쥐고 있으면 다음에 지운다 */ }
  }
  return removed;
}

/**
 * 날짜별 파일(server-YYYYMMDD.log)에 쓰는 로거. 비밀번호·토큰은 넘기지 않는 것이 규칙이고,
 * 이름은 maskName으로 가려서 넘긴다. 파일 쓰기에 실패하면 콘솔에만 남긴다.
 */
export function createLogger(dir: string, echo = true): Logger {
  try { mkdirSync(dir, { recursive: true }); pruneLogs(dir); }
  catch (error) { console.error(`[createLogger] 로그 폴더 준비 실패 - ${dir}: ${error instanceof Error ? error.message : String(error)}`); }
  const write = (level: string, message: string): void => {
    const now = new Date();
    const line = `${now.toISOString()} ${level} ${message}\n`;
    const day = now.toISOString().slice(0, 10).replaceAll('-', '');
    try { appendFileSync(join(dir, `server-${day}.log`), line, 'utf8'); }
    catch { /* 디스크 문제로 로그가 서버를 멈추게 하지 않는다 */ }
    if (echo) (level === 'ERROR' ? console.error : console.log)(line.trimEnd());
  };
  return { info: (message) => write('INFO', message), warn: (message) => write('WARN', message), error: (message) => write('ERROR', message) };
}
