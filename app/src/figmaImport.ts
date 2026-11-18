import { parseFig, resolveVectorNodePaths, type FigDocument, type FigNode, type FigPaint } from 'openfig-core';
import { pageFromNodes, type DesignDocument, type FlexLayout, type Matrix, type NodeInput, type NodeType } from './model.ts';
import { applyPoint, cleanMatrix, linearPart, multiply } from './geometry.ts';
import type { AssetRecord } from './assets.ts';
import { figColor, figEffects, figPaints, figStrokes, figTextStyle, type ImportIssue, type StyleSink } from './figStyles.ts';
import { vectorNetworkPaths } from './vectorNetwork.ts';
import { figConstraints, figItem, figLayout } from './figLayout.ts';

export type { ImportIssue } from './figStyles.ts';

export interface ImportReport {
  imported: number;
  expandedInstances: number;
  unresolvedInstances: number;
  approximatedShapes: number;
  appliedOverrides: number;
  unappliedOverrides: number;
  /** 변환하지 못했거나 근사한 항목. 노드 id(Figma), 이름, 종류, 내용. */
  issues: ImportIssue[];
}

export interface FigImportResult {
  document: DesignDocument;
  /** 문서가 참조하는 이미지 바이트. assetId는 Figma 이미지 해시다. */
  assets: AssetRecord[];
  report: ImportReport;
}

interface FigOverride { id: string; instance: string; path: string[]; patch: Partial<FigNode> }
type Guid = { sessionID: number; localID: number };

export function figmaNodeId(value: string): string | null {
  const match = value.match(/node-id=([0-9]+)[-:]([0-9]+)/) ?? value.trim().match(/^([0-9]+)[-:]([0-9]+)$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

export function importFigFile(bytes: Uint8Array, rootId: string): FigImportResult {
  return importFigNode(parseFig(bytes), rootId);
}

function nodeId(node: FigNode): string {
  return guidId(node.guid);
}

function guidId(guid: Guid): string {
  return `${guid.sessionID}:${guid.localID}`;
}

function toType(node: FigNode): NodeType {
  const type = node.type;
  if (type === 'TEXT') return 'text';
  if (type === 'ELLIPSE') return 'ellipse';
  if (type === 'VECTOR' || type === 'LINE' || type === 'BOOLEAN_OPERATION' || type === 'STAR' || type === 'REGULAR_POLYGON') return 'vector';
  if (type === 'ROUNDED_RECTANGLE' || type === 'RECTANGLE') return 'rectangle';
  // Figma는 그룹을 resizeToFit 프레임으로 저장한다. 그룹은 내용을 자르지 않으므로 group으로 둔다.
  if (type === 'GROUP' || (type === 'FRAME' && node.resizeToFit)) return 'group';
  return 'frame';
}

/** Figma 지역 행렬(m00 m01 m02 / m10 m11 m12)을 CSS 순서 [a b c d e f]로. */
function figMatrix(node: FigNode): Matrix {
  const t = node.transform;
  return t ? [t.m00, t.m10, t.m01, t.m11, t.m02, t.m12] : [1, 0, 0, 1, 0, 0];
}

/** Figma 월드 행렬(지역 0,0 → 페이지)을 우리 표현(회전 전 상자 + 중심 기준 행렬)으로 바꾼다. */
function placeBox(world: Matrix, width: number, height: number): { x: number; y: number; transform: Matrix } {
  const center = applyPoint(world, { x: width / 2, y: height / 2 });
  const round = (value: number): number => Math.round(value * 100) / 100;
  return { x: round(center.x - width / 2), y: round(center.y - height / 2), transform: cleanMatrix(linearPart(world)) };
}

/**
 * Figma 파일의 노드 하나와 그 하위 트리를 문서로 변환한다.
 * 인스턴스는 참조 컴포넌트를 펼치고 overrideKey 경로가 맞는 override를 적용한다.
 * 위치는 부모부터 Figma 행렬을 곱해 누적하므로 회전된 부모 안의 자식도 제자리에 놓인다.
 */
export function importFigNode(fig: FigDocument, rootId: string): FigImportResult {
  const root = fig.nodeMap.get(rootId);
  if (!root) throw new Error(`Figma 노드 ${rootId}를 찾지 못했습니다.`);
  if (!root.size) throw new Error('크기가 없는 노드는 가져올 수 없습니다. 프레임을 선택하세요.');
  const state = createState(fig);
  const rootWorld = linearPart(figMatrix(root));
  walk(state, { source: root, id: rootId, parentId: null, world: rootWorld, isRoot: true, symbolTrail: new Set(), overrides: [] });
  finishOverrideReport(state);
  return {
    // walk가 부모를 먼저 방문하므로 형제 순서가 Figma 레이어 순서(아래에서 위)와 같다.
    document: { version: 4, name: `${root.name || 'Figma frame'} (${rootId})`, pages: [pageFromNodes('page-1', 'Page 1', state.nodes)] },
    assets: [...state.sink.assets.values()],
    report: state.report
  };
}

interface WalkState {
  fig: FigDocument;
  sink: StyleSink;
  nodes: NodeInput[];
  report: ImportReport;
  overrides: FigOverride[];
  applied: Set<string>;
  hiddenTargets: Set<string>;
}

interface WalkInput { source: FigNode; id: string; parentId: string | null; world: Matrix; isRoot: boolean; symbolTrail: Set<string>; overrides: FigOverride[]; parentLayout?: FlexLayout }

function createState(fig: FigDocument): WalkState {
  const report: ImportReport = { imported: 0, expandedInstances: 0, unresolvedInstances: 0, approximatedShapes: 0, appliedOverrides: 0, unappliedOverrides: 0, issues: [] };
  return { fig, sink: { fig, assets: new Map(), issues: report.issues }, nodes: [], report, overrides: [], applied: new Set(), hiddenTargets: new Set() };
}

function walk(state: WalkState, input: WalkInput): void {
  const { source, id, overrides } = input;
  const key = source.overrideKey ? guidId(source.overrideKey as Guid) : null;
  const own = overrides.filter((item) => item.path[0] === key && item.path.length === 1);
  const effective = Object.assign({}, source, ...own.map((item) => item.patch)) as FigNode;
  for (const item of own) state.applied.add(item.id);
  const remaining = overrides.flatMap((item) => item.path[0] === key ? (item.path.length > 1 ? [{ ...item, path: item.path.slice(1) }] : []) : [item]);
  if (effective.visible === false || effective.phase === 'REMOVED' || !effective.size) {
    // 숨긴 노드 아래를 가리키는 override는 적용할 대상이 그려지지 않는다. 미적용 원인을 구분하려고 기록한다.
    for (const item of overrides) if (item.path[0] === key && item.path.length > 1) state.hiddenTargets.add(item.id);
    return;
  }
  const instance = effective.type === 'INSTANCE' ? prepareInstance(state, effective, id) : null;
  const shaped = instance ? ({ ...instance.rootPatch, ...effective } as FigNode) : effective;
  const world = input.isRoot ? input.world : multiply(input.world, figMatrix(shaped));
  const converted = convertNode(state, shaped, id, input.parentId, world, input.parentLayout);
  state.nodes.push(converted);
  state.report.imported++;
  for (const child of state.fig.childrenMap.get(nodeId(source)) ?? []) {
    walk(state, { source: child, id: `${id}/${nodeId(child)}`, parentId: id, world, isRoot: false, symbolTrail: input.symbolTrail, overrides: remaining, parentLayout: converted.layout });
  }
  if (instance) expandInstance(state, shaped, id, world, { trail: input.symbolTrail, own: instance.own, remaining, layout: converted.layout });
}

interface PreparedInstance { own: FigOverride[]; rootPatch: Partial<FigNode> }

/**
 * 인스턴스의 override를 모은다. 컴포넌트 루트(SYMBOL) 자체를 가리키는 override는 인스턴스 노드에 적용한다.
 * 가져오기에서는 인스턴스 노드가 루트 역할을 하기 때문이다. 인스턴스가 이미 가진 값이 우선한다.
 */
function prepareInstance(state: WalkState, instance: FigNode, id: string): PreparedInstance {
  const all: FigOverride[] = (instance.symbolData?.symbolOverrides ?? [])
    .map((patch: Partial<FigNode> & { guidPath?: { guids?: Guid[] } }, index: number) => ({ id: `${id}:override:${index}`, instance: id, path: (patch.guidPath?.guids ?? []).map(guidId), patch }))
    .filter((item: FigOverride) => item.path.length > 0);
  state.overrides.push(...all);
  // derivedSymbolData는 Figma가 이 인스턴스 크기에서 다시 계산해 저장한 자식 크기·위치·도형·텍스트 배치다.
  // 사용자 override 뒤에 적용해야 마스터 크기 그대로 펼쳐진 자식이 실제 화면과 같아진다. 보고 통계에는 넣지 않는다.
  const derived: FigOverride[] = (instance.derivedSymbolData ?? [])
    .map((patch: Partial<FigNode> & { guidPath?: { guids?: Guid[] } }, index: number) => ({ id: `${id}:derived:${index}`, instance: id, path: (patch.guidPath?.guids ?? []).map(guidId), patch }))
    .filter((item: FigOverride) => item.path.length > 0);
  const symbolGuid = instance.symbolData?.symbolID as Guid | undefined;
  const symbol = symbolGuid ? state.fig.nodeMap.get(guidId(symbolGuid)) : undefined;
  const rootKey = symbol?.overrideKey ? guidId(symbol.overrideKey as Guid) : null;
  const atRoot = all.filter((item) => item.path.length === 1 && item.path[0] === rootKey);
  for (const item of atRoot) state.applied.add(item.id);
  const rootPatch = Object.assign({}, ...atRoot.map((item) => { const { guidPath: _guidPath, ...rest } = item.patch as Record<string, unknown>; void _guidPath; return rest; })) as Partial<FigNode>;
  return { own: [...all.filter((item) => !atRoot.includes(item)), ...derived], rootPatch };
}

interface ExpandContext { trail: Set<string>; own: FigOverride[]; remaining: FigOverride[]; layout?: FlexLayout }

function expandInstance(state: WalkState, instance: FigNode, id: string, world: Matrix, context: ExpandContext): void {
  const { trail: symbolTrail, own, remaining } = context;
  const symbolGuid = instance.symbolData?.symbolID as Guid | undefined;
  const symbolId = symbolGuid ? guidId(symbolGuid) : null;
  if (!symbolId || !state.fig.nodeMap.get(symbolId) || symbolTrail.has(symbolId) || symbolTrail.size >= 8) {
    state.report.unresolvedInstances++;
    state.report.issues.push({ nodeId: id, name: instance.name, kind: 'instance-unresolved', detail: `컴포넌트 ${symbolId ?? '(없음)'} ${symbolId && symbolTrail.has(symbolId) ? '순환 참조' : '찾을 수 없음 또는 중첩 8단계 초과'}` });
    return;
  }
  state.report.expandedInstances++;
  const trail = new Set(symbolTrail).add(symbolId);
  for (const child of state.fig.childrenMap.get(symbolId) ?? []) {
    walk(state, { source: child, id: `${id}/${nodeId(child)}`, parentId: id, world, isRoot: false, symbolTrail: trail, overrides: [...own, ...remaining], parentLayout: context.layout });
  }
}

function convertNode(state: WalkState, node: FigNode, id: string, parentId: string | null, world: Matrix, parentLayout?: FlexLayout): NodeInput {
  const type = toType(node);
  const layout = type === 'frame' ? figLayout(state.sink, node, id) : undefined;
  const item = figItem(node, type, layout, parentLayout);
  const constraints = parentLayout ? undefined : figConstraints(node);
  const width = Math.max(0.01, Math.round(node.size!.x * 100) / 100);
  const height = Math.max(0.01, Math.round(node.size!.y * 100) / 100);
  const strokes = type === 'vector' || type === 'text' ? [] : figStrokes(state.sink, node, id);
  const effects = figEffects(state.sink, node, id);
  const base: NodeInput = {
    id, parentId, type, name: node.name || type, width, height, ...placeBox(world, width, height),
    fills: type === 'group' ? [] : figPaints(state.sink, node, id, node.fillPaints),
    sourceType: node.type,
    ...(strokes.length ? { strokes } : {}),
    ...(effects.length ? { effects } : {}),
    ...(node.opacity !== undefined && node.opacity < 1 ? { opacity: node.opacity } : {}),
    ...(node.cornerRadius ? { radius: node.cornerRadius } : {}),
    ...(type === 'frame' && node.frameMaskDisabled ? { clipContent: false } : {}),
    ...(layout ? { layout } : {}),
    ...(item ? { item } : {}),
    ...(constraints ? { constraints } : {}),
    ...(type === 'text' ? figTextStyle(state.sink, node, id) : {})
  };
  if (type === 'vector') base.vectorPaths = vectorPaths(state, node, id, width, height);
  return base;
}

/** 벡터 경로를 SVG로. 해석하지 못하면 선(LINE)은 대각선으로 근사하고, 나머지는 빈 도형으로 두고 원인을 보고한다. */
function vectorPaths(state: WalkState, node: FigNode, id: string, width: number, height: number): NonNullable<NodeInput['vectorPaths']> {
  let paths: NonNullable<NodeInput['vectorPaths']> = [];
  let reason = '경로 없음';
  try {
    const geometry = resolveVectorNodePaths(state.fig, node);
    paths = [
      ...geometry.fill.map((path) => ({ d: path.svgPath, fill: solidHex(path.paints ?? node.fillPaints, '#000000') })),
      ...geometry.stroke.map((path) => ({ d: path.svgPath, fill: 'none', stroke: solidHex(path.paints ?? node.strokePaints, '#000000'), strokeWidth: node.strokeWeight ?? 1 }))
    ];
  } catch (error) { reason = error instanceof Error ? error.message : String(error); }
  if (paths.length === 0) paths = networkFallback(state, node);
  if (paths.length === 0 && node.type === 'LINE') {
    state.report.issues.push({ nodeId: id, name: node.name, kind: 'shape-approximated', detail: `LINE을 대각선으로 근사 (${reason})` });
    return [{ d: `M0 0 L${width} ${height}`, fill: 'none', stroke: solidHex(node.strokePaints, '#000000'), strokeWidth: node.strokeWeight ?? 1 }];
  }
  if (paths.length === 0) {
    state.report.approximatedShapes++;
    state.report.issues.push({ nodeId: id, name: node.name, kind: 'shape-approximated', detail: `${node.type} 경로를 그리지 못함 (${reason})` });
  }
  return paths;
}

/** fillGeometry가 없을 때 벡터 네트워크로 경로를 만든다. 보이는 채우기·선이 없는 벡터는 그릴 것이 없으므로 빈 목록이 정상이다. */
function networkFallback(state: WalkState, node: FigNode): NonNullable<NodeInput['vectorPaths']> {
  let network: ReturnType<typeof vectorNetworkPaths> = null;
  // 네트워크 blob을 해석하지 못하면 근사 도형으로 보고되도록 빈 목록을 돌려준다.
  try { network = vectorNetworkPaths(state.fig, node); } catch { return []; }
  if (!network) return [];
  const fill = (node.fillPaints ?? []).some((paint) => paint.visible !== false) ? solidHex(node.fillPaints, '#000000') : 'none';
  const visibleStroke = (node.strokePaints ?? []).some((paint) => paint.visible !== false) && (node.strokeWeight ?? 0) > 0;
  const fills = fill === 'none' ? [] : network.fills.map((path) => ({ d: path.d, fill, ...(path.evenOdd ? { fillRule: 'evenodd' as const } : {}) }));
  const strokes = visibleStroke ? network.strokes.map((d) => ({ d, fill: 'none', stroke: solidHex(node.strokePaints, '#000000'), strokeWidth: node.strokeWeight ?? 1 })) : [];
  // 보이는 채우기·선이 없는 벡터는 Figma에서도 보이지 않는다. 형태만 남겨 근사 도형으로 세지 않는다.
  return fills.length || strokes.length ? [...fills, ...strokes] : [{ d: network.strokes.join(' '), fill: 'none' }];
}

function solidHex(paints: FigPaint[] | undefined, fallback: string): string {
  const paint = paints?.find((item) => item.visible !== false && item.type === 'SOLID' && item.color);
  return paint ? figColor(paint.color, paint.opacity ?? 1) : fallback;
}

/** 끝까지 적용되지 않은 override를 원인과 함께 보고한다. 대상 노드가 숨겨져 있었는지, 경로에 맞는 노드가 없었는지 구분한다. */
function finishOverrideReport(state: WalkState): void {
  state.report.appliedOverrides = state.overrides.filter((item) => state.applied.has(item.id)).length;
  state.report.unappliedOverrides = state.overrides.length - state.report.appliedOverrides;
  for (const item of state.overrides) {
    if (state.applied.has(item.id)) continue;
    const keys = Object.keys(item.patch).filter((key) => key !== 'guidPath').join(', ') || '(속성 없음)';
    const hidden = state.hiddenTargets.has(item.id);
    state.report.issues.push({ nodeId: item.instance, name: `override ${item.path.join(' > ')}`, kind: hidden ? 'override-target-hidden' : 'override-target-missing', detail: `${hidden ? '대상이 숨겨진 노드 아래에 있음' : '경로에 맞는 노드 없음'} · 속성: ${keys}` });
  }
}
