// 공용 도우미: 경로, 개발 서버 시작·종료, 브라우저 찾기, 증거 기록, zip 목록 읽기.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = resolve(HARNESS_DIR, '..');
export const REPO_DIR = resolve(SKILL_DIR, '..', '..', '..');
export const APP_DIR = join(REPO_DIR, 'app');
export const EVIDENCE_ROOT = join(REPO_DIR, '.verify-evidence');
export const PID_FILE = join(EVIDENCE_ROOT, 'server.pid.json');
export const DEFAULT_PORT = 5179;

const BROWSER_CANDIDATES = [
  ['msedge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
  ['msedge', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
  ['chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  ['chrome', '/usr/bin/google-chrome'],
  ['chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
];

/** 설치된 Edge 또는 Chrome. VERIFY_BROWSER로 실행 파일 경로를 직접 줄 수 있다. */
export function findBrowser() {
  if (process.env.VERIFY_BROWSER) return { name: 'custom', path: process.env.VERIFY_BROWSER };
  for (const [name, path] of BROWSER_CANDIDATES) if (existsSync(path)) return { name, path };
  return null;
}

export function viteBin() { return join(APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js'); }

export async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const text = await response.text();
    return { ok: response.ok, isCanvasStudio: text.includes('<title>Canvas Studio</title>') };
  } catch { return { ok: false, isCanvasStudio: false }; }
}

/** 개발 서버를 이 하네스가 직접 띄운다. 포트가 차 있으면 실패(strictPort). PID를 파일에 남겨 cleanup이 우리 것만 끄게 한다. */
export async function startServer(port) {
  const url = `http://127.0.0.1:${port}/`;
  if ((await probe(url)).ok) throw new Error(`포트 ${port}에 이미 서버가 있습니다. 남이 띄운 서버는 몰지 않습니다. --port로 다른 포트를 주거나 cleanup.mjs를 실행하세요.`);
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const child = spawn(process.execPath, [viteBin(), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: APP_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() }));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite가 시작 중 종료됨 (code ${child.exitCode}):\n${log}`);
    // 준비 = HTML이 Canvas Studio이고 진입 모듈이 변환되어 나온다(첫 요청 때 Vite가 의존성을 미리 묶는다).
    if ((await probe(url)).isCanvasStudio) {
      const entry = await fetch(`${url}src/main.tsx`).then((r) => r.ok).catch(() => false);
      if (entry) return { child, url, log: () => log };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  stopPid(child.pid);
  throw new Error(`vite가 30초 안에 준비되지 않음:\n${log}`);
}

/** 우리가 띄운 PID와 그 자식만 끈다. 이름으로 프로세스를 죽이지 않는다. */
export function stopPid(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch { /* 이미 끝남 */ }
}

export function stopRecordedServer() {
  if (!existsSync(PID_FILE)) return null;
  const record = JSON.parse(readFileSync(PID_FILE, 'utf8'));
  stopPid(record.pid);
  rmSync(PID_FILE, { force: true });
  return record;
}

export function newEvidenceDir(journey) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(EVIDENCE_ROOT, `${stamp}-${journey}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 저장 방식(무압축)·deflate 모두에서 중앙 디렉터리로 파일 이름 목록을 읽는다. 앱의 zip.ts는 저장 방식이다. */
export function zipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip 끝 레코드가 없습니다');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip 중앙 디렉터리가 깨졌습니다');
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extra = buffer.readUInt16LE(offset + 30);
    const comment = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localName = buffer.readUInt16LE(local + 26);
    const localExtra = buffer.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    entries.push({ name, size, method, text: method === 0 ? buffer.subarray(start, start + size).toString('utf8') : null });
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}
