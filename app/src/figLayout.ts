import type { FigNode } from 'openfig-core';
import type { Constraints, FlexAlign, FlexJustify, FlexLayout, HConstraint, LayoutItem, NodeType, VConstraint } from './model.ts';
import type { StyleSink } from './figStyles.ts';

const JUSTIFY: Record<string, FlexJustify> = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'space-between', SPACE_EVENLY: 'space-between' };
const ALIGN: Record<string, FlexAlign> = { MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'start' };
const H_CONSTRAINT: Record<string, HConstraint> = { MIN: 'left', MAX: 'right', CENTER: 'center', STRETCH: 'left-right', SCALE: 'scale' };
const V_CONSTRAINT: Record<string, VConstraint> = { MIN: 'top', MAX: 'bottom', CENTER: 'center', STRETCH: 'top-bottom', SCALE: 'scale' };

function report(sink: StyleSink, node: FigNode, nodeId: string, kind: string, detail: string): void {
  sink.issues.push({ nodeId, name: node.name || node.type, kind, detail });
}

/**
 * Figma Auto Layout(stack*)을 FlexLayout으로. padding은 stackVerticalPadding(위)·stackPaddingRight·stackPaddingBottom·stackHorizontalPadding(왼쪽)이고,
 * 오른쪽·아래 값이 없는 오래된 파일은 왼쪽·위 값을 같이 쓴다. Grid는 아직 지원하지 않아 보고만 남긴다.
 */
export function figLayout(sink: StyleSink, node: FigNode, nodeId: string): FlexLayout | undefined {
  if (!node.stackMode || node.stackMode === 'NONE') return undefined;
  if (node.stackMode === 'GRID') { report(sink, node, nodeId, 'layout-unsupported', 'Grid 오토 레이아웃은 아직 지원하지 않음. 현재 위치로 고정'); return undefined; }
  // "선을 레이아웃에 포함"(bordersTakeSpace)이면 Figma는 선 두께만큼 안쪽 여백을 더 둔다. 안쪽 선은 전체, 가운데 선은 절반이다.
  const inset = strokeInset(node);
  const top = (node.stackVerticalPadding ?? 0) + inset;
  const left = (node.stackHorizontalPadding ?? 0) + inset;
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
export function figItem(node: FigNode, type: NodeType, layout: FlexLayout | undefined, parentLayout: FlexLayout | undefined): LayoutItem | undefined {
  const item: LayoutItem = {};
  if (layout) {
    const [h, v] = layout.direction === 'row' ? [node.stackPrimarySizing, node.stackCounterSizing] : [node.stackCounterSizing, node.stackPrimarySizing];
    if (isHug(h)) item.h = 'auto';
    if (isHug(v)) item.v = 'auto';
  }
  if (type === 'text' && node.textAutoResize === 'WIDTH_AND_HEIGHT') { item.h = 'auto'; item.v = 'auto'; }
  if (type === 'text' && node.textAutoResize === 'HEIGHT') item.v = 'auto';
  if (parentLayout) {
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

/** 부모 프레임 크기가 바뀔 때의 제약. 기본값(left·top)이면 저장하지 않는다. */
export function figConstraints(node: FigNode): Constraints | undefined {
  const h = H_CONSTRAINT[node.horizontalConstraint as string] ?? 'left';
  const v = V_CONSTRAINT[node.verticalConstraint as string] ?? 'top';
  return h === 'left' && v === 'top' ? undefined : { h, v };
}
