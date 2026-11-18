import type { Constraints, FlexAlign, FlexLayout, ItemSizing, LayoutItem } from './model.ts';

/** 컨테이너 왼쪽 위를 (0, 0)으로 하는 지역 좌표의 상자. */
export interface Box { x: number; y: number; width: number; height: number }
export interface FlexChild { id: string; width: number; height: number; item?: LayoutItem }
export interface FlexContainer { width: number; height: number; layout: FlexLayout; item?: LayoutItem }
export interface FlexResult { width: number; height: number; boxes: Map<string, Box> }

/** 주축(main)·교차축(cross)으로 바꿔 계산하기 위한 항목. 방향과 상관없이 같은 식을 쓰려고 축을 추상화한다. */
interface AxisItem {
  id: string;
  main: number;
  cross: number;
  fillMain: boolean;
  fillCross: boolean;
  align: FlexAlign;
  minMain: number;
  maxMain: number;
  minCross: number;
  maxCross: number;
}

interface Line { items: AxisItem[]; main: number; cross: number }

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Flex 레이아웃을 계산한다. Penpot flex-layout(layout_data·positions)과 같은 순서로 동작한다.
 * 1) 자식을 줄로 나누고 2) 줄마다 fill 자식에 남는 공간을 min·max를 지키며 나누고 3) 정렬에 따라 위치를 정한다.
 * 컨테이너 자신의 item.h·v가 'auto'면 그 축은 내용에 맞춰(hug) 크기가 정해진다.
 *
 * Args:
 *   container: 컨테이너 크기·레이아웃·자기 크기 규칙
 *   children: 흐름에 참여하는 자식(숨김·absolute 제외)을 그리는 순서대로
 */
export function computeFlex(container: FlexContainer, children: readonly FlexChild[]): FlexResult {
  const { layout } = container;
  const row = layout.direction === 'row';
  const [top, right, bottom, left] = layout.padding;
  const hugMain = sizingOf(container.item, row ? 'h' : 'v') === 'auto';
  const hugCross = sizingOf(container.item, row ? 'v' : 'h') === 'auto';
  const innerMain = row ? container.width - left - right : container.height - top - bottom;
  const innerCross = row ? container.height - top - bottom : container.width - left - right;
  const items = children.map((child) => toAxisItem(child, layout, row, hugMain));
  // Figma의 '자동 간격'(space-between)은 저장된 gap을 쓰지 않고 남는 공간을 고르게 나눈다. 고정 크기·한 줄일 때만 그렇다.
  const autoSpacing = layout.justify === 'space-between' && !hugMain && !layout.wrap;
  const gap = autoSpacing ? 0 : layout.gap;
  const lines = (layout.wrap && !hugMain ? breakLines(items, innerMain, gap) : [items]).map((line) => sizeLine(line, gap, hugMain ? null : innerMain));
  const usedMain = hugMain ? Math.max(0, ...lines.map((line) => line.main)) : innerMain;
  if (lines.length === 1 && !hugCross) lines[0]!.cross = innerCross;
  const usedCross = hugCross ? lines.reduce((sum, line) => sum + line.cross, 0) + layout.crossGap * Math.max(0, lines.length - 1) : innerCross;
  const boxes = placeLines(lines, { ...layout, gap }, usedMain, row, [top, left]);
  return {
    width: round(row ? (hugMain ? usedMain + left + right : container.width) : (hugCross ? usedCross + left + right : container.width)),
    height: round(row ? (hugCross ? usedCross + top + bottom : container.height) : (hugMain ? usedMain + top + bottom : container.height)),
    boxes
  };
}

export function sizingOf(item: LayoutItem | undefined, axis: 'h' | 'v'): ItemSizing {
  return item?.[axis] ?? 'fix';
}

function toAxisItem(child: FlexChild, layout: FlexLayout, row: boolean, hugMain: boolean): AxisItem {
  const item = child.item;
  const align = item?.alignSelf ?? layout.align;
  return {
    id: child.id,
    main: row ? child.width : child.height,
    cross: row ? child.height : child.width,
    // 내용에 맞추는(hug) 부모 안의 fill은 채울 공간이 정해지지 않는다. Figma처럼 현재 크기로 둔다.
    fillMain: sizingOf(item, row ? 'h' : 'v') === 'fill' && !hugMain,
    fillCross: sizingOf(item, row ? 'v' : 'h') === 'fill' || align === 'stretch',
    align,
    minMain: (row ? item?.minWidth : item?.minHeight) ?? 0,
    maxMain: (row ? item?.maxWidth : item?.maxHeight) ?? Infinity,
    minCross: (row ? item?.minHeight : item?.minWidth) ?? 0,
    maxCross: (row ? item?.maxHeight : item?.maxWidth) ?? Infinity
  };
}

/** 줄바꿈. 다음 자식을 더하면 안쪽 너비를 넘을 때 새 줄을 시작한다. 0.5px 오차는 같은 줄로 본다. */
function breakLines(items: readonly AxisItem[], innerMain: number, gap: number): AxisItem[][] {
  const lines: AxisItem[][] = [];
  let current: AxisItem[] = [];
  let used = 0;
  for (const item of items) {
    const size = item.fillMain ? item.minMain : item.main;
    const next = current.length ? used + gap + size : size;
    if (current.length && next > innerMain + 0.5) { lines.push(current); current = []; used = 0; }
    used = current.length ? used + gap + size : size;
    current.push(item);
  }
  if (current.length) lines.push(current);
  return lines;
}

/** 줄 하나의 주축 크기를 정한다. available이 있으면 fill 자식이 남는 공간을 나눠 갖는다. */
function sizeLine(items: AxisItem[], gap: number, available: number | null): Line {
  const gaps = gap * Math.max(0, items.length - 1);
  const fills = items.filter((item) => item.fillMain);
  if (available !== null && fills.length) {
    const fixed = items.filter((item) => !item.fillMain).reduce((sum, item) => sum + item.main, 0);
    const sizes = distribute(available - fixed - gaps, fills.map((item) => item.minMain), fills.map((item) => item.maxMain));
    fills.forEach((item, index) => { item.main = sizes[index]!; });
  }
  const crossBase = items.filter((item) => !item.fillCross);
  return {
    items,
    main: items.reduce((sum, item) => sum + item.main, 0) + gaps,
    cross: Math.max(0, ...(crossBase.length ? crossBase : items).map((item) => item.cross))
  };
}

/**
 * 남는 공간을 같은 몫으로 나누되 max를 넘지 않게 하고, max에 닿은 항목의 남은 몫은 다른 항목에 다시 나눈다.
 * 시작값은 각 항목의 min이다(Figma·CSS의 flex-basis 0과 같음).
 */
export function distribute(free: number, mins: readonly number[], maxs: readonly number[]): number[] {
  const sizes = [...mins];
  let remaining = free - sizes.reduce((sum, value) => sum + value, 0);
  let open = sizes.map((_, index) => index).filter((index) => sizes[index]! < maxs[index]!);
  while (remaining > 1e-6 && open.length) {
    const share = remaining / open.length;
    let given = 0;
    for (const index of open) {
      const add = Math.min(share, maxs[index]! - sizes[index]!);
      sizes[index] = sizes[index]! + add;
      given += add;
    }
    remaining -= given;
    if (given < 1e-9) break;
    open = open.filter((index) => sizes[index]! < maxs[index]! - 1e-9);
  }
  return sizes;
}

function placeLines(lines: readonly Line[], layout: FlexLayout, usedMain: number, row: boolean, [top, left]: [number, number]): Map<string, Box> {
  const boxes = new Map<string, Box>();
  let crossOffset = 0;
  for (const line of lines) {
    const free = Math.max(0, usedMain - line.main);
    const between = layout.justify === 'space-between' && line.items.length > 1 ? layout.gap + free / (line.items.length - 1) : layout.gap;
    let mainPos = layout.justify === 'center' ? free / 2 : layout.justify === 'end' ? free : 0;
    for (const item of line.items) {
      const cross = item.fillCross ? clamp(line.cross, item.minCross, item.maxCross) : item.cross;
      const crossPos = crossOffset + (item.align === 'center' ? (line.cross - cross) / 2 : item.align === 'end' ? line.cross - cross : 0);
      boxes.set(item.id, row
        ? { x: round(left + mainPos), y: round(top + crossPos), width: round(item.main), height: round(cross) }
        : { x: round(left + crossPos), y: round(top + mainPos), width: round(cross), height: round(item.main) });
      mainPos += item.main + between;
    }
    crossOffset += line.cross + layout.crossGap;
  }
  return boxes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 부모 크기가 old에서 next로 바뀔 때 자식 상자를 제약에 따라 옮긴다. 좌표는 부모 지역 좌표다.
 * left·top은 그대로, right·bottom은 늘어난 만큼 이동, center는 절반 이동, left-right·top-bottom은 크기가 늘고, scale은 비율대로 바뀐다.
 */
export function applyConstraints(child: Box, old: { width: number; height: number }, next: { width: number; height: number }, rule: Constraints): Box {
  const [x, width] = constrainAxis(child.x, child.width, old.width, next.width, rule.h === 'left' ? 'start' : rule.h === 'right' ? 'end' : rule.h === 'left-right' ? 'both' : rule.h);
  const [y, height] = constrainAxis(child.y, child.height, old.height, next.height, rule.v === 'top' ? 'start' : rule.v === 'bottom' ? 'end' : rule.v === 'top-bottom' ? 'both' : rule.v);
  return { x, y, width, height };
}

function constrainAxis(position: number, size: number, oldSize: number, newSize: number, rule: 'start' | 'end' | 'center' | 'both' | 'scale'): [number, number] {
  const delta = newSize - oldSize;
  switch (rule) {
    case 'start': return [position, size];
    case 'end': return [position + delta, size];
    case 'center': return [position + delta / 2, size];
    case 'both': return [position, Math.max(1, size + delta)];
    case 'scale': { const ratio = oldSize ? newSize / oldSize : 1; return [position * ratio, Math.max(1, size * ratio)]; }
  }
}
