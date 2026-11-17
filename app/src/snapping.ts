import type { Rect } from './geometry';

/** 화면에 그릴 정렬선. axis가 'x'면 x=at 세로선을 from~to(y 범위)로 그린다. */
export interface Guide { axis: 'x' | 'y'; at: number; from: number; to: number }

export interface SnapResult { dx: number; dy: number; guides: Guide[] }

interface AxisSnap { offset: number; at: number | null; target: Rect | null }

/**
 * 옮기는 영역의 가장자리·중심을 다른 도형의 가장자리·중심에 맞춘다. 가로·세로를 따로 맞춘다.
 *
 * Args:
 *   moving: 이동 전 영역
 *   others: 맞출 대상 영역
 *   dx, dy: 포인터가 움직인 양(페이지 좌표)
 *   threshold: 이 거리 안이면 맞춘다(페이지 좌표). 확대율에 따라 화면 4px이 되도록 호출하는 쪽이 정한다.
 */
export function snapMove(moving: Rect, others: readonly Rect[], dx: number, dy: number, threshold: number): SnapResult {
  const x = snapAxis(moving.x + dx, moving.width, others, 'x', threshold);
  const y = snapAxis(moving.y + dy, moving.height, others, 'y', threshold);
  const placed: Rect = { ...moving, x: moving.x + dx + x.offset, y: moving.y + dy + y.offset };
  const guides: Guide[] = [];
  if (x.at !== null && x.target) guides.push({ axis: 'x', at: x.at, from: Math.min(placed.y, x.target.y), to: Math.max(placed.y + placed.height, x.target.y + x.target.height) });
  if (y.at !== null && y.target) guides.push({ axis: 'y', at: y.at, from: Math.min(placed.x, y.target.x), to: Math.max(placed.x + placed.width, y.target.x + y.target.width) });
  return { dx: dx + x.offset, dy: dy + y.offset, guides };
}

function snapAxis(start: number, size: number, others: readonly Rect[], axis: 'x' | 'y', threshold: number): AxisSnap {
  const mine = [start, start + size / 2, start + size];
  let best: AxisSnap = { offset: 0, at: null, target: null };
  let bestDistance = threshold;
  for (const other of others) {
    const begin = axis === 'x' ? other.x : other.y;
    const length = axis === 'x' ? other.width : other.height;
    for (const line of [begin, begin + length / 2, begin + length]) {
      for (const edge of mine) {
        const distance = Math.abs(line - edge);
        if (distance <= bestDistance) { bestDistance = distance; best = { offset: line - edge, at: line, target: other }; }
      }
    }
  }
  return best;
}
