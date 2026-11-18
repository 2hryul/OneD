import type { DesignNode, Matrix } from './model';

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

type Box = Pick<DesignNode, 'x' | 'y' | 'width' | 'height' | 'transform'>;

/** 행렬 곱 m × n. 배열 순서는 CSS matrix(a, b, c, d, e, f)와 같다. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
}

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) throw new Error('[invert] 역행렬이 없는 행렬');
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export function applyPoint(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** 평행이동을 빼고 방향만 변환한다. 이동량(delta)을 도형 좌표축으로 바꿀 때 쓴다. */
export function applyVector(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y };
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function rotation(degrees: number): Matrix {
  const radians = (degrees * Math.PI) / 180;
  return cleanMatrix([Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]);
}

export function linearPart(m: Matrix): Matrix {
  return [m[0], m[1], m[2], m[3], 0, 0];
}

/** cos(90°) 같은 부동소수 잔여값을 0으로 정리해 저장값과 비교가 흔들리지 않게 한다. */
export function cleanMatrix(m: Matrix): Matrix {
  return m.map((value) => (Math.abs(value) < 1e-10 ? 0 : Math.round(value * 1e10) / 1e10)) as Matrix;
}

/**
 * 행렬의 회전각. 뒤집힌 행렬(행렬식 < 0)은 '회전 × 좌우 반전'으로 보고 반전을 뺀 회전각을 돌려준다.
 * 그래야 좌우로만 뒤집은 도형이 180도로 보이지 않고, 회전 입력도 반전을 유지한 채 동작한다.
 */
export function rotationDegrees(m: Matrix): number {
  const flipped = isFlipped(m);
  const degrees = (Math.atan2(flipped ? -m[1] : m[1], flipped ? -m[0] : m[0]) * 180) / Math.PI;
  return Math.round(degrees * 100) / 100 || 0;
}

/** 좌우나 상하로 뒤집힌(거울상) 행렬인지. 상하 반전은 좌우 반전 + 180도 회전과 같다. */
export function isFlipped(m: Matrix): boolean {
  return m[0] * m[3] - m[1] * m[2] < 0;
}

export function center(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * 도형의 지역 좌표(0..width, 0..height)를 페이지 좌표로 옮기는 행렬.
 * Penpot과 같이 회전은 도형 중심을 기준으로 하고, x·y·width·height는 회전 전 상자를 뜻한다.
 */
export function worldMatrix(box: Box): Matrix {
  const c = center(box);
  return multiply(translation(c.x, c.y), multiply(linearPart(box.transform), translation(-box.width / 2, -box.height / 2)));
}

export function worldCorners(box: Box): Point[] {
  const m = worldMatrix(box);
  return [{ x: 0, y: 0 }, { x: box.width, y: 0 }, { x: box.width, y: box.height }, { x: 0, y: box.height }].map((p) => applyPoint(m, p));
}

export function boundsOf(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** 페이지 좌표 p가 도형의 (회전된) 상자 안에 있는지. */
export function containsPoint(box: Box, p: Point): boolean {
  const local = applyPoint(invert(worldMatrix(box)), p);
  return local.x >= 0 && local.y >= 0 && local.x <= box.width && local.y <= box.height;
}

export function cssMatrix(m: Matrix): string {
  return `matrix(${m.join(',')})`;
}

/** 크기 조절 핸들의 지역 좌표. */
export function handlePoint(handle: Handle, width: number, height: number): Point {
  return {
    x: handle.includes('e') ? width : handle.includes('w') ? 0 : width / 2,
    y: handle.includes('s') ? height : handle.includes('n') ? 0 : height / 2
  };
}

/**
 * 핸들을 delta(페이지 좌표)만큼 끌었을 때의 새 상자를 계산한다.
 * 회전된 도형도 반대쪽 핸들이 페이지에서 제자리에 머물도록, 이동량을 도형 좌표축으로 바꿔 크기를 정하고 중심을 다시 구한다.
 *
 * Args:
 *   keepRatio: Shift를 누른 경우. 원래 가로세로 비율을 유지한다.
 */
export function resizeBox(box: Box, handle: Handle, delta: Point, keepRatio: boolean): Rect {
  const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const sy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  const linear = linearPart(box.transform);
  const local = applyVector(invert(linear), delta);
  let width = sx ? Math.max(1, box.width + sx * local.x) : box.width;
  let height = sy ? Math.max(1, box.height + sy * local.y) : box.height;
  if (keepRatio) [width, height] = keepAspect(box, width, height, sx !== 0, sy !== 0);
  const anchor = (w: number, h: number): Point => ({ x: sx === 1 ? 0 : sx === -1 ? w : w / 2, y: sy === 1 ? 0 : sy === -1 ? h : h / 2 });
  const fixed = applyPoint(worldMatrix(box), anchor(box.width, box.height));
  const moved = anchor(width, height);
  const offset = applyVector(linear, { x: moved.x - width / 2, y: moved.y - height / 2 });
  return roundRect({ x: fixed.x - offset.x - width / 2, y: fixed.y - offset.y - height / 2, width, height });
}

function keepAspect(box: Box, width: number, height: number, horizontal: boolean, vertical: boolean): [number, number] {
  const ratio = box.width / box.height;
  if (horizontal && vertical) {
    const scale = Math.max(width / box.width, height / box.height);
    return [box.width * scale, box.height * scale];
  }
  return horizontal ? [width, width / ratio] : [height * ratio, height];
}

export function roundRect(rect: Rect): Rect {
  const r = (value: number): number => Math.round(value * 100) / 100;
  return { x: r(rect.x), y: r(rect.y), width: r(rect.width), height: r(rect.height) };
}
