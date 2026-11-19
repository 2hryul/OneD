import type { FlexAlign, GridLayout, GridTrack } from './model.ts';
import { sizingOf, type Box, type FlexChild, type FlexResult } from './layout.ts';

/** Grid 컨테이너. item은 컨테이너 자신의 크기 규칙(auto면 그 축은 내용에 맞춤)이다. */
export interface GridContainer { width: number; height: number; layout: GridLayout; item?: FlexChild['item'] }

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * 자식을 칸에 배치한다. gridCell이 있는 자식을 먼저 그 칸에 두고, 나머지는 빈 칸을 행 순서로 채운다(CSS grid auto-flow: row).
 * 지정 칸이 열 수를 넘으면 마지막 열로 옮긴다. 행은 필요한 만큼 늘어난다.
 *
 * Returns: 자식 id → [행, 열], 쓰인 행 수
 */
export function placeCells(columns: number, children: readonly FlexChild[]): { cells: Map<string, [number, number]>; rows: number } {
  const cells = new Map<string, [number, number]>();
  const taken = new Set<string>();
  for (const child of children) {
    const cell = child.item?.gridCell;
    if (!cell) continue;
    const column = Math.min(cell.column, columns - 1);
    cells.set(child.id, [cell.row, column]);
    taken.add(`${cell.row}:${column}`);
  }
  let cursor = 0;
  for (const child of children) {
    if (cells.has(child.id)) continue;
    while (taken.has(`${Math.floor(cursor / columns)}:${cursor % columns}`)) cursor++;
    cells.set(child.id, [Math.floor(cursor / columns), cursor % columns]);
    taken.add(`${Math.floor(cursor / columns)}:${cursor % columns}`);
    cursor++;
  }
  const rows = Math.max(0, ...[...cells.values()].map(([row]) => row + 1));
  return { cells, rows };
}

/**
 * 트랙 크기. 고정은 그 값, 내용에 맞춤은 그 줄에서 가장 큰 고정·맞춤 자식 크기, 비율(fr)은 남는 공간을 비율로 나눈다.
 * 컨테이너가 그 축에서 내용에 맞춤(hug)이면 비율 트랙도 내용에 맞춤처럼 계산한다(나눌 남는 공간이 없다).
 */
export function trackSizes(tracks: readonly GridTrack[], inner: number, gap: number, content: readonly number[], hug: boolean): number[] {
  const sizes = tracks.map((track, index) => (track.type === 'fixed' ? track.value : track.type === 'auto' || hug ? content[index] ?? 0 : 0));
  if (hug) return sizes;
  const totalFr = tracks.reduce((sum, track) => sum + (track.type === 'flex' ? track.value : 0), 0);
  const used = sizes.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, tracks.length - 1);
  const free = Math.max(0, inner - used);
  return tracks.map((track, index) => (track.type === 'flex' && totalFr > 0 ? (free * track.value) / totalFr : sizes[index]!));
}

/** 칸 안 정렬. 채우기 자식은 칸 크기로 늘어나고, 나머지는 정렬에 따라 놓인다. */
function alignIn(start: number, cell: number, size: number, fill: boolean, align: FlexAlign): [number, number] {
  if (fill) return [start, cell];
  if (align === 'center') return [start + (cell - size) / 2, size];
  if (align === 'end') return [start + cell - size, size];
  return [start, size];
}

function offsets(sizes: readonly number[], gap: number, start: number): number[] {
  const out: number[] = [];
  let position = start;
  for (const size of sizes) { out.push(position); position += size + gap; }
  return out;
}

/**
 * Grid 레이아웃을 계산한다(Penpot grid-layout과 같은 순서).
 * 1) 자식을 칸에 놓고 2) 열·행 트랙 크기를 정하고 3) 칸 안에서 크기·정렬을 정한다.
 * 정의된 행보다 자식이 많으면 늘어난 행은 내용에 맞춤이다. 채우기 자식은 트랙 크기 계산에 들어가지 않는다(CSS와 같음).
 *
 * Args:
 *   container: 컨테이너 크기·레이아웃·자기 크기 규칙
 *   children: 흐름에 참여하는 자식(숨김·absolute 제외)을 그리는 순서대로
 */
export function computeGrid(container: GridContainer, children: readonly FlexChild[]): FlexResult {
  const { layout } = container;
  const [top, right, bottom, left] = layout.padding;
  const hugH = sizingOf(container.item, 'h') === 'auto';
  const hugV = sizingOf(container.item, 'v') === 'auto';
  const { cells, rows: usedRows } = placeCells(layout.columns.length, children);
  const rows: GridTrack[] = [...layout.rows, ...Array.from({ length: Math.max(0, usedRows - layout.rows.length) }, () => ({ type: 'auto' as const, value: 1 }))];
  const columnContent = layout.columns.map(() => 0);
  const rowContent = rows.map(() => 0);
  for (const child of children) {
    const [row, column] = cells.get(child.id)!;
    if (sizingOf(child.item, 'h') !== 'fill') columnContent[column] = Math.max(columnContent[column]!, child.width);
    if (sizingOf(child.item, 'v') !== 'fill') rowContent[row] = Math.max(rowContent[row]!, child.height);
  }
  const widths = trackSizes(layout.columns, container.width - left - right, layout.columnGap, columnContent, hugH);
  const heights = trackSizes(rows, container.height - top - bottom, layout.rowGap, rowContent, hugV);
  const xs = offsets(widths, layout.columnGap, left);
  const ys = offsets(heights, layout.rowGap, top);
  const boxes = new Map<string, Box>();
  for (const child of children) {
    const [row, column] = cells.get(child.id)!;
    const fillH = sizingOf(child.item, 'h') === 'fill' || (layout.justifyItems === 'stretch' && sizingOf(child.item, 'h') === 'auto');
    const fillV = sizingOf(child.item, 'v') === 'fill' || (layout.alignItems === 'stretch' && sizingOf(child.item, 'v') === 'auto');
    const [x, width] = alignIn(xs[column]!, widths[column]!, child.width, fillH, layout.justifyItems);
    const [y, height] = alignIn(ys[row]!, heights[row]!, child.height, fillV, layout.alignItems);
    boxes.set(child.id, { x: round(x), y: round(y), width: round(width), height: round(height) });
  }
  const span = (sizes: readonly number[], gap: number): number => sizes.reduce((sum, size) => sum + size, 0) + gap * Math.max(0, sizes.length - 1);
  return {
    width: round(hugH ? span(widths, layout.columnGap) + left + right : container.width),
    height: round(hugV ? span(heights, layout.rowGap) + top + bottom : container.height),
    boxes
  };
}

/** 트랙 목록을 CSS grid-template 글자로("1fr 120px auto"). */
export function formatTracks(tracks: readonly GridTrack[]): string {
  return tracks.map((track) => (track.type === 'fixed' ? `${round(track.value)}px` : track.type === 'flex' ? `${round(track.value)}fr` : 'auto')).join(' ');
}

/**
 * "1fr 1fr 120px auto" 같은 글자를 트랙 목록으로. 단위 없는 숫자는 px로 본다. 읽을 수 없는 조각이 있으면 null.
 * 입력값 검증: 음수·NaN과 알 수 없는 단위는 거부한다.
 */
export function parseTracks(text: string): GridTrack[] | null {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const tracks: GridTrack[] = [];
  for (const part of parts) {
    if (/^auto$/i.test(part)) { tracks.push({ type: 'auto', value: 1 }); continue; }
    const match = /^(\d+(?:\.\d+)?)(fr|px)?$/i.exec(part);
    if (!match) return null;
    tracks.push({ type: match[2]?.toLowerCase() === 'fr' ? 'flex' : 'fixed', value: Number(match[1]) });
  }
  return tracks;
}
