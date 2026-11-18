// 배포 파일은 default 객체 하나를 내보내고 타입 선언은 개별 함수만 선언한다. default로 가져와 실제 형태에 맞는 타입을 붙인다.
import clippingModule from 'polygon-clipping';
import type { BoolOp, DesignNode, Page, SubPath } from './model.ts';
import { applyPoint, invert, worldMatrix, type Point } from './geometry.ts';
import { flatten, parsePathD } from './path.ts';

type Pair = [number, number];
type MultiPolygon = Pair[][][];
const clipping = clippingModule as {
  union: (...geoms: MultiPolygon[]) => MultiPolygon;
  intersection: (...geoms: MultiPolygon[]) => MultiPolygon;
  xor: (...geoms: MultiPolygon[]) => MultiPolygon;
  difference: (subject: MultiPolygon, ...clips: MultiPolygon[]) => MultiPolygon;
};

const KAPPA = 0.5522847498;

/** 사각형·프레임의 지역 좌표 윤곽. 모서리 반경은 곡선을 짧은 선분으로 편다. */
function roundedRect(width: number, height: number, radius: number): Point[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0) return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const corners: Array<[number, number, number]> = [[width - r, r, -90], [width - r, height - r, 0], [r, height - r, 90], [r, r, 180]];
  return corners.flatMap(([cx, cy, start]) => Array.from({ length: 9 }, (_, step) => {
    const angle = ((start + step * 11.25) * Math.PI) / 180;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }));
}

/** 타원을 네 개의 베지어로 나타낸 경로. 경로 편집으로 바꿀 때와 윤곽 계산에 쓴다. */
export function ellipsePath(width: number, height: number): SubPath[] {
  const rx = width / 2;
  const ry = height / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [{ closed: true, points: [
    { x: rx, y: 0, in: { x: rx - kx, y: 0 }, out: { x: rx + kx, y: 0 } },
    { x: width, y: ry, in: { x: width, y: ry - ky }, out: { x: width, y: ry + ky } },
    { x: rx, y: height, in: { x: rx + kx, y: height }, out: { x: rx - kx, y: height } },
    { x: 0, y: ry, in: { x: 0, y: ry + ky }, out: { x: 0, y: ry - ky } }
  ] }];
}

/** 벡터의 편집 경로 또는 가져온 경로를 하위 경로 목록으로. 가져온 경로는 viewBox 크기에서 도형 크기로 늘린다. */
export function vectorSubPaths(node: DesignNode): SubPath[] {
  if (node.path) return node.path;
  const view = node.viewBox ?? { width: node.width, height: node.height };
  const sx = node.width / (view.width || 1);
  const sy = node.height / (view.height || 1);
  const fills = (node.vectorPaths ?? []).filter((path) => path.fill !== 'none');
  return fills.flatMap((path) => parsePathD(path.d)).map((subpath) => ({ closed: true, points: subpath.points.map((point) => ({ x: point.x * sx, y: point.y * sy, ...(point.in ? { in: { x: point.in.x * sx, y: point.in.y * sy } } : {}), ...(point.out ? { out: { x: point.out.x * sx, y: point.out.y * sy } } : {}) })) }));
}

/** 지역 좌표 꺾은선들을 페이지 좌표 다각형으로. 링끼리는 짝홀 규칙(xor)으로 합쳐 구멍을 표현한다. */
function ringsToGeometry(rings: Point[][], node: DesignNode): MultiPolygon {
  const matrix = worldMatrix(node);
  const polygons: MultiPolygon[] = rings.filter((ring) => ring.length >= 3).map((ring) => [[ring.map((point) => { const p = applyPoint(matrix, point); return [p.x, p.y] as Pair; })]]);
  if (polygons.length === 0) return [];
  return polygons.length === 1 ? polygons[0]! : clipping.xor(polygons[0]!, ...polygons.slice(1));
}

/**
 * 도형이 페이지에서 차지하는 모양(다각형 모음). 불리언 피연산자로 쓴다.
 * 그룹은 자식 모양의 합, 불리언 그룹은 계산해 둔 결과 경로, 텍스트는 상자다. 숨긴 도형은 빈 모양이다.
 */
export function outline(page: Page, node: DesignNode): MultiPolygon {
  if (node.hidden) return [];
  switch (node.type) {
    case 'group': {
      if (node.boolOp) return ringsToGeometry((node.path ?? []).map((subpath) => flatten(subpath)), node);
      const parts = (node.children ?? []).map((id) => page.objects[id]).filter((child): child is DesignNode => Boolean(child)).map((child) => outline(page, child)).filter((part) => part.length);
      return parts.length === 0 ? [] : parts.length === 1 ? parts[0]! : clipping.union(parts[0]!, ...parts.slice(1));
    }
    case 'ellipse': return ringsToGeometry(ellipsePath(node.width, node.height).map((subpath) => flatten(subpath, 24)), node);
    case 'vector': return ringsToGeometry(vectorSubPaths(node).map((subpath) => flatten(subpath)), node);
    case 'text': return ringsToGeometry([roundedRect(node.width, node.height, 0)], node);
    default: return ringsToGeometry([roundedRect(node.width, node.height, node.radius ?? 0)], node);
  }
}

/**
 * 불리언 연산 결과(페이지 좌표). 빼기는 맨 아래 피연산자에서 나머지를 뺀다(Figma와 같음).
 */
export function booleanGeometry(page: Page, group: DesignNode): MultiPolygon {
  const parts = (group.children ?? []).map((id) => page.objects[id]).filter((child): child is DesignNode => Boolean(child && !child.hidden)).map((child) => outline(page, child));
  const nonEmpty = parts.filter((part) => part.length);
  if (nonEmpty.length === 0) return [];
  const [first, ...rest] = group.boolOp === 'subtract' ? parts : nonEmpty;
  if (!first?.length) return [];
  if (rest.length === 0) return first;
  return OPERATIONS[group.boolOp ?? 'union'](first, rest.filter((part) => part.length));
}

const OPERATIONS: Record<BoolOp, (first: MultiPolygon, rest: MultiPolygon[]) => MultiPolygon> = {
  union: (first, rest) => clipping.union(first, ...rest),
  subtract: (first, rest) => (rest.length ? clipping.difference(first, ...rest) : first),
  intersect: (first, rest) => clipping.intersection(first, ...rest),
  exclude: (first, rest) => clipping.xor(first, ...rest)
};

/** 다각형 모음의 모든 꼭짓점. 상자 계산에 쓴다. */
export function geometryPoints(geometry: MultiPolygon): Point[] {
  return geometry.flatMap((polygon) => polygon.flatMap((ring) => ring.map(([x, y]) => ({ x, y }))));
}

/** 페이지 좌표 다각형을 도형(box) 지역 좌표의 닫힌 하위 경로로. */
export function geometryToPath(geometry: MultiPolygon, box: DesignNode): SubPath[] {
  const toLocal = invert(worldMatrix(box));
  const round = (value: number): number => Math.round(value * 100) / 100;
  return geometry.flatMap((polygon) => polygon.map((ring) => {
    // polygon-clipping은 첫 점을 끝에 한 번 더 넣는다. 닫힌 경로에서는 필요 없다.
    const points = ring.slice(0, ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? -1 : undefined);
    return { closed: true, points: points.map(([x, y]) => { const p = applyPoint(toLocal, { x, y }); return { x: round(p.x), y: round(p.y) }; }) };
  }));
}
