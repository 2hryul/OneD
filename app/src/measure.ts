import type { Rect } from './geometry';

/** 거리 표시선 하나. axis 'x'는 가로선(at은 y), 'y'는 세로선(at은 x). from·to는 선의 양 끝(페이지 좌표). */
export interface Measure { axis: 'x' | 'y'; from: number; to: number; at: number; value: number }

const round = (value: number): number => Math.round(value * 100) / 100;

/** 두 구간이 겹치는 부분의 가운데. 겹치지 않으면 null. */
function overlapMiddle(a0: number, a1: number, b0: number, b1: number): number | null {
  const start = Math.max(a0, b0);
  const end = Math.min(a1, b1);
  return start <= end ? (start + end) / 2 : null;
}

/**
 * 고른 영역(a)과 마우스를 올린 도형(b) 사이의 거리선(Figma에서 Alt를 누른 채 올렸을 때와 같음).
 * 떨어져 있으면 축마다 사이 간격을 한 줄씩, 겹치거나 한쪽이 다른 쪽을 품으면 같은 쪽 변끼리의 거리를 보여 준다.
 * 거리가 0인 선은 뺀다.
 */
export function measureBetween(a: Rect, b: Rect): Measure[] {
  const ax1 = a.x + a.width, ay1 = a.y + a.height, bx1 = b.x + b.width, by1 = b.y + b.height;
  // 변이 맞닿은 경우(간격 0)도 떨어진 것으로 본다. 겹친 것으로 보면 두 도형 너비만큼의 선이 그려진다.
  const apart = { x: ax1 <= b.x || bx1 <= a.x, y: ay1 <= b.y || by1 <= a.y };
  const midY = overlapMiddle(a.y, ay1, b.y, by1) ?? a.y + a.height / 2;
  const midX = overlapMiddle(a.x, ax1, b.x, bx1) ?? a.x + a.width / 2;
  const lines: Measure[] = [];
  const push = (axis: 'x' | 'y', p: number, q: number, at: number): void => {
    if (Math.abs(q - p) < 0.005) return;
    lines.push({ axis, from: Math.min(p, q), to: Math.max(p, q), at, value: round(Math.abs(q - p)) });
  };
  if (apart.x || apart.y) {
    // 떨어진 축만 간격을 잰다. 대각선으로 떨어졌으면 두 축 모두 잰다.
    if (apart.x) push('x', ax1 <= b.x ? ax1 : a.x, ax1 <= b.x ? b.x : bx1, midY);
    if (apart.y) push('y', ay1 <= b.y ? ay1 : a.y, ay1 <= b.y ? b.y : by1, midX);
    return lines;
  }
  push('x', a.x, b.x, a.y + a.height / 2);
  push('x', ax1, bx1, a.y + a.height / 2);
  push('y', a.y, b.y, a.x + a.width / 2);
  push('y', ay1, by1, a.x + a.width / 2);
  return lines;
}
