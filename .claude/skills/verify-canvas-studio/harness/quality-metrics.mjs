// export-quality 여정의 순수 계산(브라우저 없이 시험할 수 있는 부분). zip 풀기, 픽셀 차이, 목표 판정.

/** 앱 zip(무압축 저장 방식)에서 파일 이름과 바이트를 꺼낸다. 압축된 항목은 읽지 않고 오류를 낸다(앱 zip.ts는 저장 방식만 쓴다). */
export function extractZip(buffer) {
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
    if (method !== 0) throw new Error(`압축된 zip 항목은 읽지 않습니다: ${name}`);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    entries.push({ name, bytes: buffer.subarray(start, start + size) });
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}

/**
 * 같은 크기의 RGBA 두 장에서 채널 차이가 threshold를 넘는 픽셀 비율(%)을 센다. 브라우저 안에서도 쓰도록 다른 함수에 기대지 않는다.
 * mark가 있으면 다른 픽셀을 빨강, 같은 픽셀을 흐린 회색으로 칠한다(차이 이미지).
 */
export function countDiff(a, b, threshold, mark) {
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    const different = d > threshold;
    if (different) diff++;
    if (mark) {
      const gray = (a[i] + a[i + 1] + a[i + 2]) / 12 + 170;
      mark[i] = different ? 230 : gray; mark[i + 1] = different ? 30 : gray; mark[i + 2] = different ? 30 : gray; mark[i + 3] = 255;
    }
  }
  const pixels = a.length / 4;
  return pixels ? Math.round((diff / pixels) * 1000) / 10 : 0;
}

/**
 * 목표값. plan(doc/계획_역할별만족도_20261124.md) Appendix D와 같다. frames는 프레임 키(파일#node-id)로 고른다.
 * PR-3의 역할 지정과 PR-6·PR-7의 목표는 이 여정이 재지 않으므로 여기 없다.
 */
export const UI_FRAMES = ['web-developer-portfolio.fig#22:314', 'web-urban-riders.fig#1:2', 'web-urban-riders.fig#1:47', 'web-urban-riders.fig#1:95'];
export const TARGETS = [
  { id: 'mobile-outside', label: '375px 화면 밖 요소 비율 ≤ 5% (UI 화면 4개)', frames: UI_FRAMES, value: (m) => m.widths?.[375]?.outsidePct, pass: (v) => v <= 5, unit: '%' },
  { id: 'build', label: 'strict tsc와 빌드 성공 (모든 프레임)', frames: null, value: (m) => (m.tsc === 'ok' && m.build === 'ok' ? 1 : 0), pass: (v) => v === 1, unit: '' },
  { id: 'pixel-diff', label: '1440px 편집기 대비 픽셀 차이 ≤ 3% (UI 화면 4개와 버거)', frames: [...UI_FRAMES, 'web-burger-landing.fig#1:2'], value: (m) => m.pixelDiffPct, pass: (v) => v <= 3, unit: '%' },
  { id: 'text-overflow', label: '1440px 글자 넘침 0 (버거)', frames: ['web-burger-landing.fig#1:2'], value: (m) => m.widths?.[1440]?.textOverflow, pass: (v) => v === 0, unit: '개' },
  { id: 'h1', label: '화면당 h1 ≤ 1 (모든 프레임)', frames: null, value: (m) => m.tags?.h1, pass: (v) => v <= 1, unit: '개' },
  { id: 'tsx-lines', label: 'MacBook Pro 화면 TSX ≤ 300줄', frames: ['web-urban-riders.fig#1:364'], value: (m) => m.tsxLines, pass: (v) => v <= 300, unit: '줄' }
];

/**
 * 프레임별 지표를 목표마다 판정한다. 목표가 정한 프레임이 하나라도 빠졌거나(일부만 잰 실행) 값을 못 잰 목표는 measured: false다.
 * 잰 프레임 중 기준을 못 넘은 것은 failing에 남는다.
 */
export function judgeTargets(metricsByKey, targets = TARGETS) {
  return targets.map((target) => {
    const keys = target.frames ?? Object.keys(metricsByKey);
    const missing = keys.filter((key) => !metricsByKey[key]);
    const rows = keys.filter((key) => metricsByKey[key]).map((key) => ({ key, value: target.value(metricsByKey[key]) }));
    const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
    const measured = rows.length > 0 && missing.length === 0 && rows.every((row) => numeric(row.value));
    const failing = rows.filter((row) => !(numeric(row.value) && target.pass(row.value))).map((row) => row.key);
    return { id: target.id, label: target.label, measured, pass: measured && failing.length === 0, rows, missing, failing };
  });
}

/** 파일 이름과 node-id로 프레임 키를 만든다. */
export const frameKey = (file, id) => `${file}#${id}`;
