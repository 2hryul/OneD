// export-quality 여정. test/의 .fig 프레임마다 실제 앱 흐름(열기 → 가져오기 → React 코드 → zip 받기)으로 코드를 받아
// strict tsc·esbuild로 빌드하고, 1440·768·375px에서 배치·태그·글자 넘침과 편집기 대비 픽셀 차이를 잰다.
// 지표는 <증거>/metrics.json, 목표 판정은 <증거>/targets.json에 쓴다. 목표 미달은 여정 실패가 아니다(측정이 끝나면 PASS).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_DIR, REPO_DIR } from './lib.mjs';
import { countDiff, extractZip, frameKey, judgeTargets } from './quality-metrics.mjs';

const WIDTHS = [1440, 768, 375];
const appRequire = createRequire(join(APP_DIR, 'package.json'));

/** 가져오기 창 목록의 "이름 · 1440×1024" 또는 "이름 · 종류 · 2560×1920 · 1:2"에서 크기를 읽는다. */
const sizeOf = (label) => { const m = /(\d+)×(\d+)/.exec(label); return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1440, height: 900 }; };

async function openFig(page, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '열기', exact: true }).click();
  await (await chooser).setFiles(file);
  const modal = page.locator('.import-modal', { hasText: 'Figma 프레임 가져오기' });
  await modal.waitFor({ timeout: 60_000 });
  return modal;
}

/** 파일 하나의 프레임 후보(가져오기 창 목록). 목록이 없는 파일은 빈 배열. */
async function listFrames(page, file) {
  const modal = await openFig(page, file);
  const options = await modal.locator('select option').evaluateAll((list) => list.map((o) => ({ id: o.value, label: o.textContent ?? '' })).filter((o) => o.id));
  await modal.getByRole('button', { name: '취소' }).click();
  await modal.waitFor({ state: 'detached' });
  return options;
}

function writeRunner(dir, screenFile) {
  const source = readFileSync(join(dir, 'src', screenFile), 'utf8');
  const name = /export function (\w+)/.exec(source)?.[1];
  if (!name) throw new Error(`${screenFile}에 export function이 없습니다`);
  const modules = join(APP_DIR, 'node_modules').replaceAll('\\', '/');
  writeFileSync(join(dir, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client';\nimport { ${name} } from './${screenFile.replace(/\.tsx$/, '')}';\n\ncreateRoot(document.getElementById('root')!).render(<${name} />);\n`);
  writeFileSync(join(dir, 'src', 'vite-env.d.ts'), `/// <reference path="${modules}/vite/client.d.ts" />\n`);
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true,
      noUnusedLocals: true, noUnusedParameters: true, skipLibCheck: true, noEmit: true, types: [], baseUrl: '.',
      paths: { react: [`${modules}/@types/react`], 'react/*': [`${modules}/@types/react/*`], 'react-dom/*': [`${modules}/@types/react-dom/*`] }
    },
    include: ['src']
  }, null, 2));
}

function typecheck(dir) {
  try {
    execFileSync(process.execPath, [join(APP_DIR, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(dir, 'tsconfig.json')], { stdio: 'pipe' });
    return { result: 'ok', errors: [] };
  } catch (error) {
    const errors = String(error.stdout ?? '').split('\n').filter((line) => line.includes('error TS'));
    return { result: `${errors.length} errors`, errors: errors.slice(0, 5) };
  }
}

async function bundle(dir) {
  const esbuild = appRequire('esbuild');
  try {
    await esbuild.build({
      entryPoints: [join(dir, 'src', 'main.tsx')], bundle: true, outdir: join(dir, 'dist'), format: 'iife', jsx: 'automatic', minify: true, logLevel: 'silent',
      nodePaths: [join(APP_DIR, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.png': 'file', '.jpg': 'file', '.gif': 'file', '.webp': 'file', '.svg': 'file' }
    });
    const css = existsSync(join(dir, 'dist', 'main.css')) ? '<link rel="stylesheet" href="main.css">' : '';
    writeFileSync(join(dir, 'dist', 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${css}<style>html,body{margin:0;background:#fff}</style></head><body><div id="root"></div><script src="main.js"></script></body></html>`);
    return 'ok';
  } catch (error) {
    return `fail: ${String(error.message).split('\n').slice(0, 2).join(' ')}`;
  }
}

/** 레이아웃이 끝날 때까지(글꼴 준비 + 두 프레임) 기다린다. 고정 시간 대기보다 빠르고 같은 결과를 낸다. */
const settled = (page) => page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });

/** 내보낸 화면 하나를 지금 폭으로 재서 배치·태그·글자 넘침을 돌려준다. 정의는 2026-11-24 수동 측정과 같다. */
async function measureExport(page, shotPath, rootShotPath) {
  await settled(page);
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('#root > *');
    if (!root) return null;
    const vw = document.documentElement.clientWidth;
    const elements = [...root.querySelectorAll('*')];
    const outside = elements.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1); }).length;
    const texts = elements.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const textOverflow = texts.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).length;
    const tags = {};
    for (const tag of ['h1', 'h2', 'h3', 'input', 'textarea', 'button', 'a', 'img', 'nav', 'header', 'footer']) tags[tag] = root.querySelectorAll(tag).length + (root.tagName.toLowerCase() === tag ? 1 : 0);
    return { elements: elements.length, outside, outsidePct: elements.length ? Math.round((outside / elements.length) * 1000) / 10 : 0, textOverflow, scrollWidth: document.documentElement.scrollWidth, tags };
  });
  if (shotPath) await page.screenshot({ path: shotPath });
  if (rootShotPath) await page.locator('#root > *').first().screenshot({ path: rootShotPath });
  return metrics;
}

/** 내보낸 화면을 한 번 띄우고 폭만 바꿔 가며 잰다. 마지막에 디자인 폭으로 루트를 찍는다(픽셀 비교용). */
async function measureAllWidths(browser, dir, designWidth, designHeight) {
  const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(pathToFileURL(join(dir, 'dist', 'index.html')).href);
    const widths = {};
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 1000 });
      widths[width] = await measureExport(page, join(dir, `export-${width}.png`), null);
    }
    await page.setViewportSize({ width: designWidth + 200, height: Math.max(1000, designHeight + 200) });
    await measureExport(page, null, join(dir, 'export-design.png'));
    return { widths, errors };
  } finally {
    await context.close();
  }
}

/** 편집기에서 가져오고 zip을 받고, 100% 화면을 찍는다. */
async function editorPass(browser, url, file, frame, dir) {
  const size = sizeOf(frame.label);
  const context = await browser.newContext({ viewport: { width: Math.max(1600, size.width + 600), height: Math.max(1000, size.height + 400) }, deviceScaleFactor: 1, acceptDownloads: true, locale: 'ko-KR' });
  // 픽셀 비교는 DOM 렌더러 기준이다(큰 문서는 자동으로 Canvas가 된다).
  await context.addInitScript(() => { try { localStorage.setItem('canvas-studio-renderer', 'dom'); } catch { /* 저장소 없음 */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location().url ?? '')) errors.push(m.text()); });
  try {
    await page.goto(url);
    await page.getByLabel('문서 이름').waitFor({ timeout: 15_000 });
    const modal = await openFig(page, file);
    await modal.locator('input').fill(frame.id);
    await modal.getByRole('button', { name: '가져오기', exact: true }).click();
    await modal.waitFor({ state: 'detached', timeout: 120_000 });
    const report = page.locator('.report-modal');
    if (await report.isVisible().catch(() => false)) await report.getByRole('button', { name: '닫기' }).last().click();
    const rootId = await page.evaluate(async (id) => {
      for (let tries = 0; tries < 40; tries++) {
        try { const doc = JSON.parse(localStorage.getItem('canvas-studio-v1') ?? 'null'); if (doc?.name?.endsWith(`(${id})`)) return doc.pages[0].children[0]; } catch { /* 아직 저장 전 */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    }, frame.id);
    if (!rootId) throw new Error('가져온 문서가 자동 저장소에 없습니다');
    // 가져오면 루트가 선택된다. 코드 창 → zip 받기.
    await page.getByRole('button', { name: 'React 코드' }).click();
    const code = page.locator('.code-modal');
    await code.waitFor({ timeout: 120_000 });
    // 코드 창은 그림 형식(MIME)을 IndexedDB에서 읽은 뒤 import 경로에 확장자를 붙인다. 확장자 없는 그림 import가 사라질 때까지 기다린다.
    await page.waitForFunction(() => !/assets\/[0-9a-f]{40}';/.test(document.querySelector('.code-modal pre')?.textContent ?? ''), null, { timeout: 15_000 });
    const download = page.waitForEvent('download', { timeout: 120_000 });
    await code.getByRole('button', { name: /^zip 받기/ }).click();
    const zipPath = join(dir, (await download).suggestedFilename());
    await (await download).saveAs(zipPath);
    const notice = (await page.locator('footer.statusbar').innerText()).split('\n')[0];
    await page.keyboard.press('Escape');
    await code.waitFor({ state: 'detached', timeout: 10_000 }).catch(async () => { await page.mouse.click(5, 5); });
    await page.locator('.zoom-value').click();
    await page.keyboard.press('Escape');
    // 배경이 투명한 프레임은 캔버스 색이 비쳐 보인다. 내보낸 화면처럼 흰 바탕에서 찍는다.
    await page.addStyleTag({ content: '.canvas-viewport{background:#fff !important;background-image:none !important}' });
    await settled(page);
    await page.locator(`.design-node[data-node-id="${rootId}"]`).screenshot({ path: join(dir, 'editor.png') });
    return { zipPath, notice, size, errors };
  } finally {
    await context.close();
  }
}

async function pixelDiff(browser, editorPng, exportPng, diffPng) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const result = await page.evaluate(async ({ a, b, src }) => {
    const count = new Function(`return (${src})`)();
    const load = (data) => new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = data; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width); const h = Math.min(ia.height, ib.height);
    const pixels = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
    const da = pixels(ia); const db = pixels(ib);
    const out = new ImageData(w, h);
    const pct = count(da.data, db.data, 32, out.data);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(out, 0, 0);
    return { pct, editor: [ia.width, ia.height], exported: [ib.width, ib.height], png: c.toDataURL('image/png') };
  }, { a: `data:image/png;base64,${readFileSync(editorPng).toString('base64')}`, b: `data:image/png;base64,${readFileSync(exportPng).toString('base64')}`, src: countDiff.toString() });
  writeFileSync(diffPng, Buffer.from(result.png.split(',')[1], 'base64'));
  await context.close();
  return { pct: result.pct, editorSize: result.editor, exportSize: result.exported };
}

async function measureFrame(browser, url, file, frame, dir, ev) {
  const started = Date.now();
  mkdirSync(join(dir, 'src'), { recursive: true });
  const pass = await editorPass(browser, url, file, frame, dir);
  const entries = extractZip(readFileSync(pass.zipPath));
  for (const entry of entries) { mkdirSync(dirname(join(dir, 'src', entry.name)), { recursive: true }); writeFileSync(join(dir, 'src', entry.name), entry.bytes); }
  const screen = entries.map((e) => e.name).find((name) => name.endsWith('.tsx') && !name.includes('/'));
  if (!screen) throw new Error('zip에 화면 TSX가 없습니다');
  writeRunner(dir, screen);
  const tsc = typecheck(dir);
  const build = await bundle(dir);
  const tsx = readFileSync(join(dir, 'src', screen), 'utf8');
  const cssBytes = entries.filter((e) => e.name.endsWith('.css')).reduce((sum, e) => sum + e.bytes.length, 0);
  const metrics = {
    key: frameKey(file.split(/[\\/]/).pop(), frame.id), frame: frame.label.trim(), designSize: pass.size, notice: pass.notice,
    zipFiles: entries.length, missingAssets: Number(/그림 (\d+)개는 저장소에 없어/.exec(pass.notice)?.[1] ?? 0),
    tsc: tsc.result, tscErrors: tsc.errors, build, tsxLines: tsx.split('\n').length, cssKB: Math.round(cssBytes / 1024), widths: {}, tags: null, pixelDiffPct: null, editorErrors: pass.errors
  };
  if (build === 'ok') {
    // 픽셀 비교는 디자인 폭으로 띄운 내보낸 화면과 편집기 100% 화면이다.
    const rendered = await measureAllWidths(browser, dir, Math.max(1440, pass.size.width), pass.size.height);
    metrics.widths = rendered.widths;
    metrics.exportErrors = rendered.errors;
    metrics.tags = metrics.widths[1440].tags;
    const diff = await pixelDiff(browser, join(dir, 'editor.png'), join(dir, 'export-design.png'), join(dir, 'diff.png'));
    metrics.pixelDiffPct = diff.pct;
    metrics.pixelSizes = { editor: diff.editorSize, exported: diff.exportSize };
  }
  metrics.seconds = Math.round((Date.now() - started) / 100) / 10;
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  ev.steps.push({ type: 'frame', key: metrics.key, dir });
  return metrics;
}

/** 여정 본문. run.mjs가 부른다. */
export async function exportQuality(page, ev) {
  const figDir = process.env.VERIFY_FIG_DIR ?? join(REPO_DIR, 'test');
  const only = process.env.VERIFY_FIG_ONLY;
  const files = existsSync(figDir) ? readdirSync(figDir).filter((name) => name.toLowerCase().endsWith('.fig')).sort() : [];
  if (!files.length) { ev.fail('측정할 .fig 파일', `${figDir}에 .fig가 없습니다. VERIFY_FIG_DIR로 폴더를 주거나 test/에 샘플을 둡니다(*.fig는 Git 제외).`); return; }
  const browser = page.context().browser();
  const url = page.url();
  const all = {};
  for (const file of files) {
    const path = join(figDir, file);
    let frames;
    try { frames = await listFrames(page, path); } catch (error) { ev.fail(`${file} 프레임 목록`, String(error.message ?? error)); continue; }
    if (!frames.length) { ev.fail(`${file} 프레임 목록`, '가져오기 창 목록이 비었습니다'); continue; }
    for (const frame of frames) {
      const key = frameKey(file, frame.id);
      if (only && !key.includes(only)) continue;
      const dir = join(ev.dir, key.replace(/[#:]/g, '_'));
      try {
        const m = await measureFrame(browser, url, path, frame, dir, ev);
        all[key] = m;
        const w375 = m.widths[375];
        ev.check(`${key} 측정`, true, `tsc ${m.tsc} · build ${m.build === 'ok' ? 'ok' : 'FAIL'} · 375px 밖 ${w375 ? `${w375.outside}/${w375.elements}` : '-'} · 픽셀 차이 ${m.pixelDiffPct ?? '-'}% · h1 ${m.tags?.h1 ?? '-'} · TSX ${m.tsxLines}줄`);
        ev.check(`${key} 편집기 콘솔 오류 없음`, m.editorErrors.length === 0, m.editorErrors.slice(0, 3));
      } catch (error) {
        ev.fail(`${key} 측정`, String(error.stack ?? error).split('\n').slice(0, 3).join(' | '));
      }
    }
  }
  if (!Object.keys(all).length) { ev.fail('측정한 프레임', '0개'); return; }
  const targets = judgeTargets(all);
  writeFileSync(join(ev.dir, 'metrics.json'), JSON.stringify(all, null, 2));
  writeFileSync(join(ev.dir, 'targets.json'), JSON.stringify(targets, null, 2));
  ev.steps.push({ type: 'targets', file: 'targets.json', achieved: targets.filter((t) => t.pass).length, total: targets.length });
  console.log('\n  목표');
  for (const t of targets) {
    const state = t.pass ? '달성' : t.failing.length ? '미달' : '측정 안 됨';
    const notes = [t.failing.length ? `미달 ${t.failing.join(', ')}` : '', t.missing.length ? `안 잰 프레임 ${t.missing.length}개` : ''].filter(Boolean).join(' · ');
    console.log(`  ${state}  ${t.label}${notes ? ` — ${notes}` : ''}`);
  }
  console.log(`  결과: ${targets.filter((t) => t.pass).length}/${targets.length} 목표 달성`);
}
