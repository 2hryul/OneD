// 사용법: node run.mjs <journey> [--port 5179] [--headed] [--url http://127.0.0.1:5173/]
//   journey: json-open | reload-persist | code-zip | fig-import | all
//   --url을 주면 서버를 띄우지 않고 이미 떠 있는 Canvas Studio를 몬다(그 서버는 끄지 않는다).
// 끝나면 증거 폴더 경로와 PASS/FAIL을 출력한다. 하나라도 실패하면 종료 코드 1.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DEFAULT_PORT, SKILL_DIR, findBrowser, startServer, stopPid, newEvidenceDir, zipEntries, probe, PID_FILE } from './lib.mjs';
import { rmSync } from 'node:fs';

const FIXTURE = join(SKILL_DIR, 'fixtures', 'verify-doc.json');
const FIXTURE_DOC_NAME = 'VERIFY 문서';
const FIXTURE_LAYER = 'VERIFY Card';
const FIXTURE_TEXT = 'Verify text 검증';

function parseArgs(argv) {
  const args = { journey: argv[0], port: DEFAULT_PORT, headed: false, url: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--headed') args.headed = true;
    else if (argv[i] === '--url') args.url = argv[++i];
  }
  return args;
}

/** 단계별 스크린샷·확인 결과·내려받은 파일을 증거 폴더에 쌓는다. */
class Evidence {
  constructor(dir, page) { this.dir = dir; this.page = page; this.steps = []; this.failed = false; this.n = 0; }
  async shot(label) {
    const file = `${String(++this.n).padStart(2, '0')}-${label}.png`;
    await this.page.screenshot({ path: join(this.dir, file) });
    this.steps.push({ type: 'screenshot', label, file });
    return file;
  }
  check(label, ok, detail) {
    this.steps.push({ type: 'check', label, ok: Boolean(ok), detail });
    if (!ok) this.failed = true;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    return Boolean(ok);
  }
  async saveDownload(download) {
    const file = join(this.dir, `download-${download.suggestedFilename()}`);
    await download.saveAs(file);
    this.steps.push({ type: 'download', name: download.suggestedFilename(), file: basename(file) });
    return file;
  }
  fail(label, detail) { return this.check(label, false, detail); }
}

const status = async (page) => (await page.locator('footer.statusbar').innerText()).replace(/\s*\n\s*/g, ' | ');
const layerRow = (page, name) => page.locator('.layer-row', { has: page.locator('.layer-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const docName = (page) => page.getByLabel('문서 이름').inputValue();

/** 사용자가 위쪽 "열기" 버튼을 누르고 파일 선택 창에서 고르는 것과 같은 경로. */
async function openViaButton(page, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await (await chooser).setFiles(file);
}

async function readAutosave(page) {
  return page.evaluate(() => localStorage.getItem('canvas-studio-v1'));
}

const journeys = {
  /** JSON 열기: 고정 문서를 열면 이름·레이어·캔버스 글자가 바뀌고 자동 저장소에도 들어간다. */
  async 'json-open'(page, ev) {
    await ev.shot('before-open');
    await openViaButton(page, FIXTURE);
    await page.getByText(`${basename(FIXTURE)}을(를) 열었습니다.`).waitFor({ timeout: 10_000 }).catch(() => {});
    ev.check('상태 표시줄 열기 알림', (await status(page)).includes(`${basename(FIXTURE)}을(를) 열었습니다.`), await status(page));
    ev.check('문서 이름이 고정 문서 이름', (await docName(page)) === FIXTURE_DOC_NAME, await docName(page));
    ev.check('페이지 목록에 고정 문서 페이지(Verify page)', await page.getByText('Verify page', { exact: true }).isVisible());
    // 열면 최상위 프레임만 보이고 자식은 접혀 있다. 사용자처럼 프레임 행의 펼치기 단추를 누른다.
    await layerRow(page, 'Landing page').getByRole('button', { name: '펼치기' }).click();
    ev.check('펼친 레이어 목록에 고정 문서 레이어(VERIFY Card)', await layerRow(page, FIXTURE_LAYER).isVisible());
    ev.check('캔버스에 고정 문서 글자', await page.locator('main, .canvas-wrap, body').getByText(FIXTURE_TEXT).first().isVisible().catch(() => false));
    const saved = await readAutosave(page);
    ev.check('자동 저장소(localStorage canvas-studio-v1)에 고정 문서 이름', Boolean(saved && JSON.parse(saved).name === FIXTURE_DOC_NAME), saved ? JSON.parse(saved).name : null);
    await ev.shot('after-open');
  },

  /** 저장 뒤 새로 고침: 이름을 바꾸고 JSON 저장 → 새로 고침해도 자동 저장본이 남고, 내려받은 JSON을 다시 열 수 있다. */
  async 'reload-persist'(page, ev) {
    const token = `persist-${Date.now()}`;
    const nameInput = page.getByLabel('문서 이름');
    await nameInput.fill(token);
    await ev.shot('renamed');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON 저장' }).click();
    const file = await ev.saveDownload(await download);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    ev.check('내려받은 JSON의 name이 바꾼 이름', saved.name === token, saved.name);
    ev.check('내려받은 JSON이 문서 형식(version·pages)', typeof saved.version === 'number' && Array.isArray(saved.pages), { version: saved.version, pages: saved.pages?.length });
    await page.waitForFunction((t) => (localStorage.getItem('canvas-studio-v1') ?? '').includes(t), token, { timeout: 5_000 }).catch(() => {});
    await page.reload();
    await page.getByLabel('문서 이름').waitFor();
    ev.check('새로 고침 뒤 문서 이름 유지', (await docName(page)) === token, await docName(page));
    ev.check('새로 고침 뒤 레이어 유지(Landing page)', await layerRow(page, 'Landing page').isVisible());
    await ev.shot('after-reload');
    await nameInput.fill('reset-before-reopen');
    await openViaButton(page, file);
    await page.waitForFunction((t) => document.querySelector('input[aria-label="문서 이름"]')?.value === t, token, { timeout: 10_000 }).catch(() => {});
    ev.check('내려받은 JSON 다시 열기', (await docName(page)) === token, await docName(page));
    await ev.shot('reopened-download');
  },

  /** React 코드 zip: 프레임을 고르고 코드 창에서 zip 받기 → zip 안에 TSX·CSS가 있고 글자가 들어 있다. */
  async 'code-zip'(page, ev) {
    await layerRow(page, 'Landing page').click();
    const codeButton = page.getByRole('button', { name: 'React 코드' });
    ev.check('프레임 선택 뒤 React 코드 버튼 활성', await codeButton.isEnabled());
    await codeButton.click();
    const modal = page.locator('.code-modal');
    await modal.waitFor();
    const title = await modal.locator('header strong').innerText();
    ev.check('코드 창 제목에 .tsx와 .css', /\.tsx · .+\.css$/.test(title), title);
    await ev.shot('code-modal');
    const download = page.waitForEvent('download');
    await modal.getByRole('button', { name: /^zip 받기/ }).click();
    const file = await ev.saveDownload(await download);
    const entries = zipEntries(readFileSync(file));
    writeFileSync(join(ev.dir, 'zip-entries.json'), JSON.stringify(entries.map(({ name, size, method }) => ({ name, size, method })), null, 2));
    const tsx = entries.filter((e) => e.name.endsWith('.tsx'));
    const css = entries.filter((e) => e.name.endsWith('.css'));
    ev.check('zip에 .tsx 파일', tsx.length > 0, entries.map((e) => e.name));
    ev.check('zip에 .css 파일', css.length > 0);
    ev.check('TSX에 화면 글자(Design starts here)', tsx.some((e) => e.text?.includes('Design starts here')));
    ev.check('상태 표시줄 zip 알림 파일 수 = zip 항목 수', (await status(page)).includes(`zip을 받았습니다(파일 ${entries.length}개)`), await status(page));
    await ev.shot('after-zip');
  },

  /** .fig 가져오기: VERIFY_FIG_FILE(저장소 밖의 .fig)과 선택적 VERIFY_FIG_NODE가 필요하다. */
  async 'fig-import'(page, ev) {
    const fig = process.env.VERIFY_FIG_FILE;
    if (!fig || !existsSync(fig)) { ev.fail('VERIFY_FIG_FILE에 있는 .fig 파일', fig ?? '(설정 안 됨) — 원본 .fig는 저장소에 없다. 경로를 환경 변수로 주고 다시 실행.'); return; }
    const before = await status(page);
    await openViaButton(page, fig);
    const modal = page.locator('.import-modal', { hasText: 'Figma 프레임 가져오기' });
    await modal.waitFor({ timeout: 60_000 });
    const options = await modal.locator('select option').evaluateAll((list) => list.map((o) => ({ value: o.value, text: o.textContent })).filter((o) => o.value));
    ev.check('가져오기 창에 프레임 목록', options.length > 0, `${options.length}개`);
    const node = process.env.VERIFY_FIG_NODE;
    if (node) await modal.locator('input').fill(node);
    else if (options.length) await modal.locator('select').selectOption(options[0].value);
    await ev.shot('fig-modal');
    await modal.getByRole('button', { name: '가져오기', exact: true }).click();
    await modal.waitFor({ state: 'detached', timeout: 120_000 }).catch(() => {});
    const after = await status(page);
    ev.check('가져오기 창이 닫힘', !(await modal.isVisible()));
    ev.check('상태 표시줄에 가져오기 요약(요소·override)', /개 요소 · 인스턴스 .*override/.test(after), after);
    ev.check('레이어 수가 바뀜', before !== after);
    const report = page.locator('.report-modal');
    if (await report.isVisible().catch(() => false)) await ev.shot('import-report');
    const saved = await readAutosave(page);
    ev.check('가져온 문서가 자동 저장소에 들어감', Boolean(saved) && saved.length > 1000, saved ? `${saved.length}자` : null);
    await ev.shot('after-import');
  }
};

async function runOne(browser, url, name) {
  const dir = newEvidenceDir(name);
  // 새 컨텍스트 = 빈 localStorage·IndexedDB. 사용자의 브라우저 프로필을 건드리지 않는다.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'ko-KR' });
  const page = await context.newPage();
  const consoleErrors = [];
  // 앱에 favicon이 없어 브라우저가 /favicon.ico를 요청하고 404를 콘솔에 남긴다. 그 한 건만 빼고 모든 오류·4xx/5xx 응답을 실패로 본다.
  const ignored = (url) => new URL(url).pathname === '/favicon.ico';
  page.on('console', (m) => { if (m.type() === 'error' && !(m.text().startsWith('Failed to load resource') && ignored(m.location().url || url))) consoleErrors.push(`${m.text()} @ ${m.location().url}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !ignored(r.url())) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const ev = new Evidence(dir, page);
  console.log(`\n[${name}] ${dir}`);
  try {
    await page.goto(url);
    await page.getByLabel('문서 이름').waitFor({ timeout: 15_000 });
    await journeys[name](page, ev);
  } catch (error) {
    ev.fail('여정 실행 중 예외', String(error?.stack ?? error));
    await ev.shot('exception').catch(() => {});
  }
  ev.check('페이지 콘솔 오류 없음', consoleErrors.length === 0, consoleErrors.slice(0, 5));
  await context.close();
  const summary = { journey: name, url, result: ev.failed ? 'FAIL' : 'PASS', finishedAt: new Date().toISOString(), steps: ev.steps };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`[${name}] ${summary.result}`);
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const names = args.journey === 'all' ? Object.keys(journeys).filter((n) => n !== 'fig-import' || process.env.VERIFY_FIG_FILE) : [args.journey];
  if (!names.every((n) => journeys[n])) { console.error(`알 수 없는 여정: ${args.journey}. 가능: ${Object.keys(journeys).join(', ')}, all`); process.exit(2); }
  const browserInfo = findBrowser();
  if (!browserInfo) { console.error('Edge/Chrome을 찾지 못했습니다. VERIFY_BROWSER에 실행 파일 경로를 주세요.'); process.exit(2); }
  let server = null;
  let url = args.url;
  if (url) {
    if (!(await probe(url)).isCanvasStudio) { console.error(`${url}은 Canvas Studio가 아닙니다.`); process.exit(2); }
  } else {
    server = await startServer(args.port);
    url = server.url;
    console.log(`서버 시작: ${url} (pid ${server.child.pid})`);
  }
  const browser = await chromium.launch({ executablePath: browserInfo.path, headless: !args.headed });
  const results = [];
  try {
    for (const name of names) results.push(await runOne(browser, url, name));
  } finally {
    await browser.close();
    if (server) { stopPid(server.child.pid); rmSync(PID_FILE, { force: true }); console.log('서버 종료'); }
  }
  const failed = results.filter((r) => r.result !== 'PASS');
  console.log(`\n결과: ${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
