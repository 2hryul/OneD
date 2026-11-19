import type { FigNode } from 'openfig-core';
import type { Constraints, FlexAlign, FlexJustify, GridLayout, GridTrack, HConstraint, Layout, LayoutItem, NodeType, VConstraint } from './model.ts';
import type { StyleSink } from './figStyles.ts';

const JUSTIFY: Record<string, FlexJustify> = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'space-between', SPACE_EVENLY: 'space-between' };
const ALIGN: Record<string, FlexAlign> = { MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'start' };
const H_CONSTRAINT: Record<string, HConstraint> = { MIN: 'left', MAX: 'right', CENTER: 'center', STRETCH: 'left-right', SCALE: 'scale' };
const V_CONSTRAINT: Record<string, VConstraint> = { MIN: 'top', MAX: 'bottom', CENTER: 'center', STRETCH: 'top-bottom', SCALE: 'scale' };

function report(sink: StyleSink, node: FigNode, nodeId: string, kind: string, detail: string): void {
  sink.issues.push({ nodeId, name: node.name || node.type, kind, detail });
}

/**
 * Grid 트랙 id(sessionID:localID) → 순서. 자식의 gridRowAnchor·gridColumnAnchor를 칸 번호로 바꾸는 데 쓴다.
 * 문서 모델에는 칸 번호만 남기므로 가져오는 동안만 레이아웃 객체에 붙여 둔다.
 */
export const gridAnchors = new WeakMap<GridLayout, { rows: Map<string, number>; columns: Map<string, number> }>();

interface FigGuid { sessionID?: number; localID?: number }
interface FigTrackList { entries?: Array<{ id?: FigGuid; position?: string }> }
interface FigTrackSizes { entries?: Array<{ id?: FigGuid; trackSize?: { maxSizing?: { type?: string; value?: number } } }> }

const guidKey = (id: FigGuid | undefined): string => `${id?.sessionID ?? ''}:${id?.localID ?? ''}`;

/** Figma 트랙 목록을 위치(분수 순서 문자열) 순으로 정렬하고 크기 종류를 붙인다. FLEX → fr, HUG → 내용에 맞춤, FIXED → px. */
function figTracks(list: FigTrackList | undefined, sizes: FigTrackSizes | undefined): { tracks: GridTrack[]; index: Map<string, number> } {
  const sizing = new Map((sizes?.entries ?? []).map((entry) => [guidKey(entry.id), entry.trackSize?.maxSizing]));
  const ordered = [...(list?.entries ?? [])].sort((a, b) => ((a.position ?? '') < (b.position ?? '') ? -1 : (a.position ?? '') > (b.position ?? '') ? 1 : 0));
  const tracks = ordered.map((entry): GridTrack => {
    const size = sizing.get(guidKey(entry.id));
    if (size?.type === 'FIXED') return { type: 'fixed', value: size.value ?? 0 };
    if (size?.type === 'FLEX') return { type: 'flex', value: size.value ?? 1 };
    return { type: 'auto', value: 1 };
  });
  return { tracks, index: new Map(ordered.map((entry, position) => [guidKey(entry.id), position])) };
}

/** Figma Grid 오토 레이아웃(stackMode GRID)을 GridLayout으로. 여백은 Flex와 같은 stack* 값을 쓴다. */
function figGrid(node: FigNode, padding: GridLayout['padding']): GridLayout | undefined {
  const raw = node as unknown as { gridRows?: FigTrackList; gridColumns?: FigTrackList; gridRowsSizing?: FigTrackSizes; gridColumnsSizing?: FigTrackSizes; gridRowGap?: number; gridColumnGap?: number; gridReflowEnabled?: boolean };
  const columns = figTracks(raw.gridColumns, raw.gridColumnsSizing);
  const rows = figTracks(raw.gridRows, raw.gridRowsSizing);
  if (columns.tracks.length === 0) return undefined;
  const layout: GridLayout = { type: 'grid', columns: columns.tracks, rows: rows.tracks, columnGap: raw.gridColumnGap ?? 0, rowGap: raw.gridRowGap ?? 0, padding, justifyItems: 'start', alignItems: 'start' };
  // 자동 재배치(gridReflowEnabled)가 켜진 그리드는 자식 순서대로 칸을 채운다. 이때 저장된 칸 기준은 복제 전 값이 남아 실제 배치와 다를 수 있어(실제 파일에서 확인) 쓰지 않는다.
  if (!raw.gridReflowEnabled) gridAnchors.set(layout, { rows: rows.index, columns: columns.index });
  return layout;
}

/**
 * Figma Auto Layout(stack*)을 FlexLayout·GridLayout으로. padding은 stackVerticalPadding(위)·stackPaddingRight·stackPaddingBottom·stackHorizontalPadding(왼쪽)이고,
 * 오른쪽·아래 값이 없는 오래된 파일은 왼쪽·위 값을 같이 쓴다.
 */
export function figLayout(sink: StyleSink, node: FigNode, nodeId: string): Layout | undefined {
  if (!node.stackMode || node.stackMode === 'NONE') return undefined;
  // "선을 레이아웃에 포함"(bordersTakeSpace)이면 Figma는 선 두께만큼 안쪽 여백을 더 둔다. 안쪽 선은 전체, 가운데 선은 절반이다.
  const inset = strokeInset(node);
  const top = (node.stackVerticalPadding ?? 0) + inset;
  const left = (node.stackHorizontalPadding ?? 0) + inset;
  if (node.stackMode === 'GRID') {
    const grid = figGrid(node, [top, node.stackPaddingRight !== undefined ? node.stackPaddingRight + inset : left, node.stackPaddingBottom !== undefined ? node.stackPaddingBottom + inset : top, left]);
    if (!grid) report(sink, node, nodeId, 'layout-unsupported', '열 정보가 없는 Grid. 현재 위치로 고정');
    return grid;
  }
  if (node.stackCounterAlignItems === 'BASELINE') report(sink, node, nodeId, 'layout-approximated', '기준선 정렬을 위쪽 정렬로 근사');
  const gap = node.stackSpacing ?? 0;
  return {
    type: 'flex',
    direction: node.stackMode === 'HORIZONTAL' ? 'row' : 'column',
    wrap: node.stackWrap === 'WRAP',
    gap,
    crossGap: node.stackCounterSpacing ?? gap,
    padding: [top, node.stackPaddingRight !== undefined ? node.stackPaddingRight + inset : left, node.stackPaddingBottom !== undefined ? node.stackPaddingBottom + inset : top, left],
    justify: JUSTIFY[node.stackPrimaryAlignItems as string] ?? 'start',
    align: ALIGN[node.stackCounterAlignItems as string] ?? 'start'
  };
}

function strokeInset(node: FigNode): number {
  if (!node.bordersTakeSpace) return 0;
  const visible = (node.strokePaints ?? []).some((paint) => paint.visible !== false);
  const weight = visible ? node.strokeWeight ?? 0 : 0;
  return node.strokeAlign === 'INSIDE' ? weight : node.strokeAlign === 'OUTSIDE' ? 0 : weight / 2;
}

const isHug = (sizing: unknown): boolean => sizing === 'RESIZE_TO_FIT' || sizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE';

/**
 * 레이아웃 안의 크기 규칙. 컨테이너 자신의 hug, 텍스트 자동 크기, 부모 레이아웃 안에서의 fill·absolute를 합친다.
 * 부모가 정한 fill이 자기 hug보다 우선한다(Figma에서 한 축은 둘 중 하나만 가능).
 */
export function figItem(node: FigNode, type: NodeType, layout: Layout | undefined, parentLayout: Layout | undefined): LayoutItem | undefined {
  const item: LayoutItem = {};
  if (layout?.type === 'grid') {
    if (isHug(node.stackPrimarySizing)) item.h = 'auto';
    if (isHug(node.stackCounterSizing)) item.v = 'auto';
  } else if (layout) {
    const [h, v] = layout.direction === 'row' ? [node.stackPrimarySizing, node.stackCounterSizing] : [node.stackCounterSizing, node.stackPrimarySizing];
    if (isHug(h)) item.h = 'auto';
    if (isHug(v)) item.v = 'auto';
  }
  if (type === 'text' && node.textAutoResize === 'WIDTH_AND_HEIGHT') { item.h = 'auto'; item.v = 'auto'; }
  if (type === 'text' && node.textAutoResize === 'HEIGHT') item.v = 'auto';
  if (parentLayout?.type === 'grid') Object.assign(item, gridItem(node, parentLayout));
  else if (parentLayout) {
    const row = parentLayout.direction === 'row';
    if ((node.stackChildPrimaryGrow ?? 0) > 0) item[row ? 'h' : 'v'] = 'fill';
    if (node.stackChildAlignSelf === 'STRETCH') item[row ? 'v' : 'h'] = 'fill';
    if (node.stackPositioning === 'ABSOLUTE') item.absolute = true;
  }
  const min = (node.minSize as { value?: { x?: number | null; y?: number | null } } | undefined)?.value;
  const max = (node.maxSize as { value?: { x?: number | null; y?: number | null } } | undefined)?.value;
  if (min?.x) item.minWidth = min.x;
  if (min?.y) item.minHeight = min.y;
  if (max?.x) item.maxWidth = max.x;
  if (max?.y) item.maxHeight = max.y;
  return Object.keys(item).length ? item : undefined;
}

/** Grid 자식의 칸(gridRowAnchor·gridColumnAnchor → 칸 번호)과 절대 위치. 칸을 모르면 자동 배치에 맡긴다. */
function gridItem(node: FigNode, parent: GridLayout): LayoutItem {
  const raw = node as unknown as { gridRowAnchor?: FigGuid; gridColumnAnchor?: FigGuid };
  const anchors = gridAnchors.get(parent);
  const row = anchors?.rows.get(guidKey(raw.gridRowAnchor));
  const column = anchors?.columns.get(guidKey(raw.gridColumnAnchor));
  const item: LayoutItem = {};
  if (row !== undefined && column !== undefined) item.gridCell = { row, column };
  if (node.stackPositioning === 'ABSOLUTE') item.absolute = true;
  return item;
}

/** 부모 프레임 크기가 바뀔 때의 제약. 기본값(left·top)이면 저장하지 않는다. */
export function figConstraints(node: FigNode): Constraints | undefined {
  const h = H_CONSTRAINT[node.horizontalConstraint as string] ?? 'left';
  const v = V_CONSTRAINT[node.verticalConstraint as string] ?? 'top';
  return h === 'left' && v === 'top' ? undefined : { h, v };
}
