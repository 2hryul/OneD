// 렌더 성능 측정. 개발 서버(npm run dev)를 띄운 브라우저 콘솔에서:
//   const b = await import('/scripts/bench-render.js'); await b.run([100, 400, 800, 1700])
// 큰 문서를 열기 버튼 경로로 열고, 화면 이동·확대 한 단계의 비용(이벤트 → React 반영 → 레이아웃 강제)을 잰다.
// 브라우저 창이 가려져 있어도 잴 수 있도록 프레임 간격 대신 작업 시간을 잰다(그리기 시간은 Canvas 렌더러만 포함).
// 주의: 지금 문서를 큰 문서로 바꾼다. 필요하면 먼저 JSON으로 저장한다.

async function load(cards) {
  const { makeLargeDocument } = await import('/src/largeDoc.ts');
  const json = JSON.stringify(makeLargeDocument(cards));
  const input = document.querySelector('input[type=file][accept*=".json"]');
  const transfer = new DataTransfer();
  transfer.items.add(new File([json], 'large.json', { type: 'application/json' }));
  const start = performance.now();
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  for (let tries = 0; tries < 600; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (document.querySelector('.statusbar')?.textContent.includes(`${cards * 12} layers`)) break;
  }
  document.body.getBoundingClientRect();
  return Math.round(performance.now() - start);
}

/** 이벤트 하나를 보내고 캔버스 변환이 반영된 뒤 레이아웃까지 끝날 때까지의 시간(ms). */
async function step(event) {
  const world = document.querySelector('.canvas-world');
  const start = performance.now();
  const done = new Promise((resolve) => {
    const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
    observer.observe(world, { attributes: true });
    setTimeout(() => { observer.disconnect(); resolve(); }, 3000);
  });
  document.querySelector('.canvas-viewport').dispatchEvent(event);
  await done;
  document.body.offsetHeight;
  return performance.now() - start;
}

async function series(makeEvent, count) {
  const times = [];
  for (let index = 0; index < count; index++) {
    times.push(await step(makeEvent(index)));
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  times.sort((a, b) => a - b);
  return { median: +times[count >> 1].toFixed(1), p90: +times[Math.floor(count * 0.9)].toFixed(1) };
}

export async function measure(cards) {
  const loadMs = await load(cards);
  const pan = await series(() => new WheelEvent('wheel', { deltaX: 3, deltaY: 3, bubbles: true, cancelable: true }), 20);
  const zoom = await series((index) => new WheelEvent('wheel', { deltaY: index % 2 ? 40 : -40, ctrlKey: true, clientX: 400, clientY: 400, bubbles: true, cancelable: true }), 10);
  return { nodes: cards * 12, loadMs, pan, zoom, renderer: document.querySelector('canvas.render-canvas') ? 'canvas' : 'dom' };
}

export async function run(sizes = [100, 400, 800, 1700]) {
  const results = [];
  for (const cards of sizes) results.push(await measure(cards));
  return results;
}
