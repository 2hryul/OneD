// 사용법: node doctor.mjs [--port 5179]
// 읽기 전용 점검: Node 버전, 앱 의존성, 하네스 의존성, 브라우저, 포트 상태, 남은 서버 기록. 아무것도 띄우거나 끄지 않는다.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR, HARNESS_DIR, DEFAULT_PORT, PID_FILE, findBrowser, probe, viteBin } from './lib.mjs';

const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : DEFAULT_PORT;
let bad = 0;
const line = (ok, label, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); };
const warn = (label, detail = '') => console.log(`warn ${label}${detail ? ` — ${detail}` : ''}`);

const major = Number(process.versions.node.split('.')[0]);
line(major >= 20, 'Node 20 이상', process.version);
line(existsSync(viteBin()), '앱 의존성 설치됨(app/node_modules/vite)', existsSync(viteBin()) ? '' : 'cd app && npm ci');
const harnessReady = existsSync(join(HARNESS_DIR, 'node_modules', 'playwright-core'));
line(harnessReady, '하네스 의존성 설치됨(playwright-core)', harnessReady ? '' : 'cd .claude/skills/verify-canvas-studio/harness && npm ci');
const browser = findBrowser();
line(Boolean(browser), '브라우저(Edge/Chrome)', browser ? browser.path : 'VERIFY_BROWSER에 경로를 주세요');
const pkg = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8'));
line(pkg.name === 'canvas-studio', 'app/package.json이 canvas-studio', `${pkg.name}@${pkg.version}`);

const state = await probe(`http://127.0.0.1:${port}/`);
if (existsSync(PID_FILE)) {
  const record = JSON.parse(readFileSync(PID_FILE, 'utf8'));
  warn('이전 실행의 서버 기록이 남아 있음', `pid ${record.pid}, port ${record.port}, ${record.startedAt} — 정리하려면 node cleanup.mjs`);
}
if (!state.ok) line(true, `포트 ${port} 비어 있음(run.mjs가 서버를 띄울 수 있음)`);
else if (state.isCanvasStudio) warn(`포트 ${port}에 Canvas Studio가 이미 떠 있음`, '내가 띄운 것이면 cleanup.mjs, 남의 것이면 --port로 다른 포트 사용');
else line(false, `포트 ${port}를 다른 프로그램이 쓰는 중`, '--port로 다른 포트 사용');

const user = await probe('http://127.0.0.1:5173/');
if (user.isCanvasStudio) warn('사용자 개발 서버가 5173에서 실행 중', '건드리지 않는다. 그 서버를 몰려면 run.mjs --url http://127.0.0.1:5173/');
process.exit(bad ? 1 : 0);
