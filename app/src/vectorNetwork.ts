import { getBlobBytes, parseVectorNetworkBlob, type FigDocument, type FigNode } from 'openfig-core';

type Network = ReturnType<typeof parseVectorNetworkBlob>;
type Segment = Network['segments'][number];

export interface NetworkPaths { fills: Array<{ d: string; evenOdd: boolean }>; strokes: string[] }

/**
 * fillGeometry 없이 vectorData(벡터 네트워크)만 가진 벡터를 SVG 경로로 바꾼다.
 * 영역(region)의 각 루프는 닫힌 채우기 경로가 되고, 영역이 없으면 모든 세그먼트를 열린 선 경로로 쓴다.
 * 네트워크 좌표는 normalizedSize 기준이라 도형 크기로 늘린다. 데이터가 없으면 null.
 */
export function vectorNetworkPaths(fig: FigDocument, node: FigNode): NetworkPaths | null {
  const data = node.vectorData as { vectorNetworkBlob?: number; normalizedSize?: { x: number; y: number } } | undefined;
  const bytes = data ? getBlobBytes(fig, data.vectorNetworkBlob) : null;
  if (!bytes || !node.size) return null;
  const network = parseVectorNetworkBlob(bytes);
  const sx = node.size.x / (data?.normalizedSize?.x || node.size.x);
  const sy = node.size.y / (data?.normalizedSize?.y || node.size.y);
  const point = (x: number, y: number): string => `${round(x * sx)} ${round(y * sy)}`;
  const fills = network.regions.flatMap((region) => region.loops.map((loop) => ({ d: loopPath(network, loop, point), evenOdd: region.windingRule === 'ODD' })));
  const strokes = network.segments.map((segment) => `M${point(vertex(network, segment.start.vertex).x, vertex(network, segment.start.vertex).y)} ${segmentCommand(network, segment, false, point)}`);
  return { fills: fills.filter((item) => item.d), strokes };
}

function vertex(network: Network, index: number): { x: number; y: number } {
  return network.vertices[index] ?? { x: 0, y: 0 };
}

/** 세그먼트를 C(곡선) 또는 L(직선) 명령으로. reversed면 끝에서 시작 방향으로 그린다. */
function segmentCommand(network: Network, segment: Segment, reversed: boolean, point: (x: number, y: number) => string): string {
  const from = reversed ? segment.end : segment.start;
  const to = reversed ? segment.start : segment.end;
  const a = vertex(network, from.vertex);
  const b = vertex(network, to.vertex);
  if (segment.isStraight) return `L${point(b.x, b.y)}`;
  return `C${point(a.x + from.dx, a.y + from.dy)} ${point(b.x + to.dx, b.y + to.dy)} ${point(b.x, b.y)}`;
}

/** 루프의 세그먼트는 방향이 섞여 있다. 앞 세그먼트의 끝 정점에 이어지도록 각 세그먼트의 방향을 정해 한 경로로 잇는다. */
function loopPath(network: Network, loop: readonly number[], point: (x: number, y: number) => string): string {
  const segments = loop.map((index) => network.segments[index]).filter((segment): segment is Segment => Boolean(segment));
  if (segments.length === 0) return '';
  const first = segments[0]!;
  const next = segments[1];
  const firstReversed = Boolean(next && (first.start.vertex === next.start.vertex || first.start.vertex === next.end.vertex));
  let current = firstReversed ? first.start.vertex : first.end.vertex;
  const startVertex = vertex(network, firstReversed ? first.end.vertex : first.start.vertex);
  const commands = [`M${point(startVertex.x, startVertex.y)}`, segmentCommand(network, first, firstReversed, point)];
  for (const segment of segments.slice(1)) {
    const reversed = segment.start.vertex !== current;
    commands.push(segmentCommand(network, segment, reversed, point));
    current = reversed ? segment.start.vertex : segment.end.vertex;
  }
  return `${commands.join(' ')} Z`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
