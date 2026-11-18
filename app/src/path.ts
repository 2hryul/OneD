import { parseSVGPathData } from 'openfig-core';
import type { PathPoint, SubPath } from './model.ts';
import type { Point, Rect } from './geometry.ts';

type Bezier = [Point, Point, Point, Point];

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** 두 점 사이 구간을 3차 베지어 네 점으로. 핸들이 없으면 끝점과 같아 직선이 된다. */
export function segmentCurve(a: PathPoint, b: PathPoint): Bezier {
  return [{ x: a.x, y: a.y }, a.out ?? { x: a.x, y: a.y }, b.in ?? { x: b.x, y: b.y }, { x: b.x, y: b.y }];
}

function isLine(a: PathPoint, b: PathPoint): boolean {
  return !a.out && !b.in;
}

/** 하위 경로의 구간 목록. 닫힌 경로는 마지막 점에서 첫 점으로 가는 구간이 더 있다. */
export function segments(subpath: SubPath): Array<[PathPoint, PathPoint, number]> {
  const { points } = subpath;
  const result: Array<[PathPoint, PathPoint, number]> = [];
  for (let index = 0; index < points.length - 1; index++) result.push([points[index]!, points[index + 1]!, index]);
  if (subpath.closed && points.length > 1) result.push([points[points.length - 1]!, points[0]!, points.length - 1]);
  return result;
}

/** 경로를 SVG d 문자열로. 직선 구간은 L, 곡선 구간은 C를 쓴다. */
export function pathToD(subpaths: readonly SubPath[]): string {
  return subpaths.filter((subpath) => subpath.points.length > 0).map((subpath) => {
    const first = subpath.points[0]!;
    const parts = [`M${round(first.x)} ${round(first.y)}`];
    for (const [a, b] of segments(subpath)) {
      if (isLine(a, b)) parts.push(`L${round(b.x)} ${round(b.y)}`);
      else { const [, c1, c2, end] = segmentCurve(a, b); parts.push(`C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(end.x)} ${round(end.y)}`); }
    }
    if (subpath.closed) parts.push('Z');
    return parts.join(' ');
  }).join(' ');
}

export function bezierAt([p0, p1, p2, p3]: Bezier, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  };
}

/** 하위 경로를 꺾은선으로 편다. 곡선 구간은 steps개로 나눈다. 닫힌 경로의 끝은 첫 점과 겹치지 않게 뺀다. */
export function flatten(subpath: SubPath, steps = 16): Point[] {
  const first = subpath.points[0];
  if (!first) return [];
  const result: Point[] = [{ x: first.x, y: first.y }];
  for (const [a, b] of segments(subpath)) {
    if (isLine(a, b)) result.push({ x: b.x, y: b.y });
    else { const curve = segmentCurve(a, b); for (let step = 1; step <= steps; step++) result.push(bezierAt(curve, step / steps)); }
  }
  if (subpath.closed && result.length > 1) result.pop();
  return result;
}

/** 경로가 실제로 차지하는 상자(곡선은 펴서 계산). 핸들은 포함하지 않는다. */
export function pathBounds(subpaths: readonly SubPath[]): Rect | null {
  const points = subpaths.flatMap((subpath) => flatten(subpath, 24));
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** 점과 핸들에 같은 변환을 적용한다. 이동·확대에 쓴다. */
export function mapPath(subpaths: readonly SubPath[], map: (point: Point) => Point): SubPath[] {
  const apply = (p: { x: number; y: number }): { x: number; y: number } => { const q = map(p); return { x: round(q.x), y: round(q.y) }; };
  return subpaths.map((subpath) => ({
    closed: subpath.closed,
    points: subpath.points.map((point) => ({ ...apply(point), ...(point.in ? { in: apply(point.in) } : {}), ...(point.out ? { out: apply(point.out) } : {}) }))
  }));
}

/**
 * 구간 하나를 t에서 둘로 나눈다(de Casteljau). 나눈 자리에 새 점이 생기고 양쪽 핸들이 원래 곡선 모양을 유지하도록 바뀐다.
 * 돌려주는 값: [a의 새 out, 새 점, b의 새 in]
 */
export function splitSegment(a: PathPoint, b: PathPoint, t: number): [Point | undefined, PathPoint, Point | undefined] {
  if (isLine(a, b)) return [undefined, { x: round(a.x + (b.x - a.x) * t), y: round(a.y + (b.y - a.y) * t) }, undefined];
  const [p0, p1, p2, p3] = segmentCurve(a, b);
  const lerp = (u: Point, v: Point): Point => ({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t });
  const q0 = lerp(p0, p1); const q1 = lerp(p1, p2); const q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1); const r1 = lerp(q1, q2);
  const mid = lerp(r0, r1);
  return [q0, { x: round(mid.x), y: round(mid.y), in: r0, out: r1 }, q2];
}

/** 경로에서 p에 가장 가까운 구간과 위치 t. 경로 위를 눌러 점을 넣을 때 쓴다. */
export function nearestSegment(subpaths: readonly SubPath[], p: Point): { sub: number; index: number; t: number; distance: number } | null {
  let best: { sub: number; index: number; t: number; distance: number } | null = null;
  subpaths.forEach((subpath, sub) => {
    for (const [a, b, index] of segments(subpath)) {
      const curve = segmentCurve(a, b);
      for (let step = 0; step <= 40; step++) {
        const t = step / 40;
        const q = bezierAt(curve, t);
        const distance = Math.hypot(q.x - p.x, q.y - p.y);
        if (!best || distance < best.distance) best = { sub, index, t, distance };
      }
    }
  });
  return best;
}

/** 구간 index(하위 경로 sub 안)를 t에서 나눠 점 하나를 넣은 새 경로. */
export function insertPoint(subpaths: readonly SubPath[], sub: number, index: number, t: number): SubPath[] {
  return subpaths.map((subpath, position) => {
    if (position !== sub) return subpath;
    const points = [...subpath.points];
    const nextIndex = (index + 1) % points.length;
    const [aOut, mid, bIn] = splitSegment(points[index]!, points[nextIndex]!, t);
    points[index] = { ...points[index]!, ...(aOut ? { out: aOut } : {}) };
    points[nextIndex] = { ...points[nextIndex]!, ...(bIn ? { in: bIn } : {}) };
    points.splice(index + 1, 0, mid);
    return { ...subpath, points };
  });
}

/**
 * SVG d 문자열을 편집할 수 있는 경로로. 가져온 벡터(Figma 도형 경로)를 경로 편집으로 바꿀 때 쓴다.
 * openfig-core 파서는 M·L·C·Q·H·V·Z를 다루고 Q는 C로 바꿔 준다. 원호(A)는 지원하지 않는다.
 */
export function parsePathD(d: string): SubPath[] {
  const result: SubPath[] = [];
  let current: SubPath | null = null;
  for (const command of parseSVGPathData(d)) {
    if (command.type === 'M') { current = { closed: false, points: [{ x: command.x, y: command.y }] }; result.push(current); continue; }
    if (!current) continue;
    if (command.type === 'Z') { closeSubPath(current); current = null; continue; }
    const last = current.points[current.points.length - 1]!;
    if (command.type === 'L') current.points.push({ x: command.x, y: command.y });
    else { last.out = { x: command.c1x, y: command.c1y }; current.points.push({ x: command.x, y: command.y, in: { x: command.c2x, y: command.c2y } }); }
  }
  return result.filter((subpath) => subpath.points.length > 1);
}

/** 닫을 때 마지막 점이 첫 점과 같으면 합친다(들어오는 핸들은 첫 점으로 옮긴다). */
function closeSubPath(subpath: SubPath): void {
  subpath.closed = true;
  const first = subpath.points[0]!;
  const last = subpath.points[subpath.points.length - 1]!;
  if (subpath.points.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
    subpath.points.pop();
    if (last.in) first.in = last.in;
  }
}
