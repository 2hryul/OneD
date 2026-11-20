import { parseFig, resolveVectorNodePaths, type FigDocument, type FigNode, type FigPaint } from 'openfig-core';
import { TOKEN_SLOT_TYPE, isContainer, pageFromNodes, parseVariantName, type Component, type DesignDocument, type Layout, type Matrix, type NodeInput, type NodeType, type Page, type Token, type TokenSlot } from './model.ts';
import { topInstanceRoot, touchedAgainstMain } from './components.ts';
import { applyPoint, cleanMatrix, linearPart, multiply } from './geometry.ts';
import type { AssetRecord } from './assets.ts';
import { figColor, figEffects, figPaints, figStrokes, figTextStyle, type ImportIssue, type StyleSink } from './figStyles.ts';
import { fontAvailable } from './glyphs.ts';
import { vectorNetworkPaths } from './vectorNetwork.ts';
import { figConstraints, figItem, figLayout } from './figLayout.ts';
import { applyProps, collectProps, componentPropsOf, instanceValues, nodePropRefs, scopeOf, type FigPropAssignment, type PropScope, type PropValues } from './figProps.ts';
import { ancestorModes, boundVariables, variableIndex, variableToken, withModes, withVariableColors, type ModeMap, type VariableIndex } from './figVariables.ts';

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
  /** Components 페이지에 만든 메인 컴포넌트 수와, 메인에 연결한 인스턴스 수. */
  components: number;
  linkedInstances: number;
  /** Figma 채우기·선 스타일과 변수에서 만든 토큰 수. */
  tokens: number;
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

/**
 * 자식 노드를 그리는 순서(parentIndex.position)대로. Figma의 순서 문자열은 문자 코드 순으로 비교해야 한다.
 * 파서(openfig-core)는 localeCompare로 정렬해 공백 등이 든 문자열(" ~")의 순서가 틀어지므로 여기서 다시 정렬한다.
 * 정렬 결과는 문서 하나 안에서 같으므로 부모 id별로 한 번만 계산한다.
 */
const orderCache = new WeakMap<FigDocument, Map<string, FigNode[]>>();
function childrenOf(fig: FigDocument, parentId: string): FigNode[] {
  const cache = orderCache.get(fig) ?? new Map<string, FigNode[]>();
  orderCache.set(fig, cache);
  const cached = cache.get(parentId);
  if (cached) return cached;
  const position = (node: FigNode): string => (node.parentIndex as { position?: string } | undefined)?.position ?? '';
  const sorted = [...(fig.childrenMap.get(parentId) ?? [])].sort((a, b) => (position(a) < position(b) ? -1 : position(a) > position(b) ? 1 : 0));
  cache.set(parentId, sorted);
  return sorted;
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
export function importFigNode(fig: FigDocument, rootId: string, options: FigImportOptions = {}): FigImportResult {
  const root = fig.nodeMap.get(rootId);
  if (!root) throw new Error(`Figma 노드 ${rootId}를 찾지 못했습니다.`);
  if (!root.size) throw new Error('크기가 없는 노드는 가져올 수 없습니다. 프레임을 선택하세요.');
  const state = createState(fig, options);
  const rootWorld = linearPart(figMatrix(root));
  walk(state, { source: root, id: rootId, parentId: null, world: rootWorld, isRoot: true, symbolTrail: new Set(), overrides: [], modes: ancestorModes(fig, root) });
  finishOverrideReport(state);
  // walk가 부모를 먼저 방문하므로 형제 순서가 Figma 레이어 순서(아래에서 위)와 같다.
  const frameNodes = state.nodes;
  const mains = importMains(state);
  const components = linkInstances(state, [...frameNodes, ...mains.nodes], mains);
  const pages = [pageFromNodes('page-1', 'Page 1', frameNodes), ...(mains.nodes.length ? [pageFromNodes(COMPONENTS_PAGE, 'Components', mains.nodes)] : [])];
  state.report.linkedInstances = markImportedOverrides(pages);
  state.report.components = Object.keys(components).length;
  state.report.tokens = state.tokens.size;
  return {
    document: { version: 5, components, tokens: Object.fromEntries(state.tokens), name: `${root.name || 'Figma frame'} (${rootId})`, pages },
    assets: [...state.sink.assets.values()],
    report: state.report
  };
}

const COMPONENTS_PAGE = 'components';

interface MainImport { nodes: NodeInput[]; mainIdOf: Map<string, string>; components: Record<string, Component>; setIds: Set<string> }

/**
 * 가져온 프레임이 쓰는 컴포넌트의 메인을 Components 페이지에 만든다. 메인 안의 인스턴스가 쓰는 컴포넌트도 차례로 가져온다.
 * variant면 세트 전체를 가져와야 다른 variant로 바꿀 수 있으므로 세트 프레임을 통째로 가져온다.
 * 메인을 가져오며 생긴 개수·보고는 가져오기 결과 통계에 섞이지 않도록 되돌린다.
 */
function importMains(state: WalkState): MainImport {
  const counts = { ...state.report, issues: state.report.issues.length };
  const result: MainImport = { nodes: [], mainIdOf: new Map(), components: {}, setIds: new Set() };
  const queue = [...new Set(state.instanceSymbols.values())];
  let offsetY = 0;
  while (queue.length) {
    const symbolId = queue.shift()!;
    if (result.mainIdOf.has(symbolId)) continue;
    const symbol = state.fig.nodeMap.get(symbolId);
    if (!symbol?.size) continue;
    const parent = symbol.parentIndex?.guid ? state.fig.nodeMap.get(guidId(symbol.parentIndex.guid as Guid)) : undefined;
    const source = parent?.isStateGroup ? parent : symbol;
    const rootId = parent?.isStateGroup ? `set:${guidId(parent.guid)}` : `main:${symbolId}`;
    const start = result.nodes.length;
    state.nodes = result.nodes;
    walk(state, { source, id: rootId, parentId: null, world: linearPart(figMatrix(source)), isRoot: true, symbolTrail: new Set([symbolId]), overrides: [], modes: ancestorModes(state.fig, source) });
    // 메인들을 세로로 늘어놓는다. 가져오기는 루트를 원점에 두므로 이번에 추가된 도형만 아래로 민다.
    for (const node of result.nodes.slice(start)) node.y += offsetY;
    offsetY += (source.size?.y ?? 0) + 200;
    registerMains(state, source, rootId, result);
    for (const used of state.instanceSymbols.values()) if (!result.mainIdOf.has(used)) queue.push(used);
  }
  Object.assign(state.report, { imported: counts.imported, expandedInstances: counts.expandedInstances, unresolvedInstances: counts.unresolvedInstances, approximatedShapes: counts.approximatedShapes });
  state.report.issues.length = counts.issues;
  return result;
}

function registerMains(state: WalkState, source: FigNode, rootId: string, result: MainImport): void {
  if (!source.isStateGroup) {
    const id = guidId(source.guid);
    result.mainIdOf.set(id, rootId);
    result.components[id] = { id, name: source.name, mainId: rootId, pageId: COMPONENTS_PAGE, ...componentPropsOf(scopeOf(state.fig, source)) };
    return;
  }
  result.setIds.add(rootId);
  for (const child of childrenOf(state.fig, guidId(source.guid))) {
    if (child.type !== 'SYMBOL') continue;
    const id = guidId(child.guid);
    const mainId = `${rootId}/${id}`;
    if (!result.nodes.some((node) => node.id === mainId)) continue;
    result.mainIdOf.set(id, mainId);
    result.components[id] = { id, name: source.name, mainId, pageId: COMPONENTS_PAGE, setId: rootId, variant: parseVariantName(child.name) ?? { 'Property 1': child.name }, ...componentPropsOf(scopeOf(state.fig, child)) };
  }
}

/**
 * 펼쳐 둔 인스턴스를 메인에 연결한다. 가장 바깥 인스턴스 아래 도형은 그 메인의 같은 경로 도형을 가리킨다(id 뒷부분이 같다).
 * 안쪽 인스턴스 루트는 자기 컴포넌트 id를 유지해 바깥 인스턴스를 풀어도 인스턴스로 남게 한다.
 */
function linkInstances(state: WalkState, nodes: NodeInput[], mains: MainImport): Record<string, Component> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const [symbolId, mainId] of mains.mainIdOf) { const main = byId.get(mainId); if (main) Object.assign(main, { componentId: symbolId, mainInstance: true }); }
  for (const setId of mains.setIds) { const set = byId.get(setId); if (set) set.componentSet = true; }
  for (const node of nodes) {
    let outer: NodeInput | undefined;
    for (let current: NodeInput | undefined = node; current; current = current.parentId ? byId.get(current.parentId) : undefined) if (state.instanceSymbols.has(current.id)) outer = current;
    const ownSymbol = state.instanceSymbols.get(node.id);
    if (ownSymbol && mains.mainIdOf.has(ownSymbol)) node.componentId = ownSymbol;
    if (!outer) continue;
    const mainId = mains.mainIdOf.get(state.instanceSymbols.get(outer.id)!);
    if (!mainId) continue;
    const ref = node === outer ? mainId : `${mainId}${node.id.slice(outer.id.length)}`;
    if (byId.has(ref)) node.shapeRef = ref;
  }
  return mains.components;
}

/** 가져온 인스턴스 도형을 메인과 비교해 다른 속성 묶음을 touched로 둔다. 연결한 인스턴스 루트 수를 돌려준다. */
function markImportedOverrides(pages: Page[]): number {
  const objects = new Map(pages.flatMap((page) => Object.values(page.objects).map((node) => [node.id, node] as const)));
  let roots = 0;
  for (const page of pages) {
    for (const node of Object.values(page.objects)) {
      if (!node.shapeRef) continue;
      const main = objects.get(node.shapeRef);
      const root = topInstanceRoot(page, node.id);
      const mainRoot = root?.shapeRef ? objects.get(root.shapeRef) : undefined;
      if (!main || !root || !mainRoot) continue;
      if (node === root) roots++;
      const groups = touchedAgainstMain(node, main, root, mainRoot);
      if (groups.length) node.touched = groups;
    }
  }
  return roots;
}

interface WalkState {
  fig: FigDocument;
  sink: StyleSink;
  /** 펼친 인스턴스 id → 컴포넌트(SYMBOL) id. 메인을 가져오고 인스턴스를 연결할 때 쓴다. */
  instanceSymbols: Map<string, string>;
  /** Figma 채우기 스타일 키 → 스타일 노드. */
  styles: Map<string, FigNode>;
  tokens: Map<string, Token>;
  /** 파일의 Figma 변수 표. 변수를 쓰는 노드를 처음 만날 때 만든다. */
  variables?: VariableIndex;
  nodes: NodeInput[];
  report: ImportReport;
  overrides: FigOverride[];
  applied: Set<string>;
  hiddenTargets: Set<string>;
}

/**
 * 가져오기 선택 사항. fontAvailable은 글꼴을 쓸 수 있는지 판단한다(기본은 이 브라우저의 글꼴 확인).
 * 쓸 수 없는 글꼴의 텍스트만 파일의 글리프 윤곽을 함께 저장한다(모든 텍스트에 저장하면 문서가 커진다).
 */
export interface FigImportOptions { fontAvailable?: (family: string) => boolean }

/** scope: 이 노드를 가진 컴포넌트(세트)의 속성 범위. props: 바깥 인스턴스들이 정한 속성 값. */
interface WalkInput { source: FigNode; id: string; parentId: string | null; world: Matrix; isRoot: boolean; symbolTrail: Set<string>; overrides: FigOverride[]; parentLayout?: Layout; props?: PropValues; scope?: PropScope; modes?: ModeMap }

function createState(fig: FigDocument, options: FigImportOptions): WalkState {
  const report: ImportReport = { imported: 0, expandedInstances: 0, unresolvedInstances: 0, approximatedShapes: 0, appliedOverrides: 0, unappliedOverrides: 0, issues: [], components: 0, linkedInstances: 0, tokens: 0 };
  const styles = new Map(fig.nodes.filter((node) => node.styleType === 'FILL' && typeof node.key === 'string').map((node) => [node.key as string, node]));
  return { fig, sink: { fig, assets: new Map(), issues: report.issues, fontAvailable: options.fontAvailable ?? fontAvailable }, nodes: [], report, overrides: [], applied: new Set(), hiddenTargets: new Set(), instanceSymbols: new Map(), styles, tokens: new Map() };
}

/**
 * override 경로 한 칸이 이 노드를 가리키는지. 새 파일은 노드의 overrideKey를, 예전 방식 파일은 노드 guid를 경로에 쓴다.
 * 둘 다 받아야 두 형식의 파일에서 override가 적용된다(커뮤니티 템플릿에서 guid 형식을 확인).
 */
function pathMatcher(node: FigNode | undefined): (step: string | undefined) => boolean {
  if (!node) return () => false;
  const keys = new Set([nodeId(node), ...(node.overrideKey ? [guidId(node.overrideKey as Guid)] : [])]);
  return (step) => step !== undefined && keys.has(step);
}

function walk(state: WalkState, input: WalkInput): void {
  const { source, id, overrides } = input;
  const matches = pathMatcher(source);
  const own = overrides.filter((item) => matches(item.path[0]) && item.path.length === 1);
  // 컴포넌트 속성을 먼저 적용하고, 사용자가 직접 바꾼 override가 그 위를 덮는다.
  const swapReport = (): void => { state.report.issues.push({ nodeId: id, name: source.name || source.type, kind: 'prop-unsupported', detail: '인스턴스 교체 속성은 아직 지원하지 않음. 기본 컴포넌트로 표시' }); };
  const effective = Object.assign({}, applyProps(source, input.scope, input.props, swapReport), ...own.map((item) => item.patch)) as FigNode;
  for (const item of own) state.applied.add(item.id);
  const remaining = overrides.flatMap((item) => matches(item.path[0]) ? (item.path.length > 1 ? [{ ...item, path: item.path.slice(1) }] : []) : [item]);
  // 숨긴 노드도 hidden으로 가져온다. 메인에서는 숨겼지만 인스턴스에서 override로 보이게 한 노드가 메인 쪽 짝을 가져야 동기화가 지우지 않는다.
  if (effective.phase === 'REMOVED' || !effective.size) {
    for (const item of overrides) if (matches(item.path[0]) && item.path.length > 1) state.hiddenTargets.add(item.id);
    return;
  }
  // 이 노드가 고른 변수 모드(라이트·다크 등)는 자기와 자손의 변수 값에 적용된다.
  const modes = withModes(input.modes, effective);
  const instance = effective.type === 'INSTANCE' ? prepareInstance(state, effective, id) : null;
  const shaped = instance ? ({ ...instance.rootPatch, ...effective } as FigNode) : effective;
  const world = input.isRoot ? input.world : multiply(input.world, figMatrix(shaped));
  const converted = convertNode(state, resolveColors(state, shaped, modes), id, input.parentId, world, input.parentLayout, modes, input.scope);
  state.nodes.push(converted);
  state.report.imported++;
  // 불리언 연산 등 벡터로 바꾼 노드의 자식(피연산자)은 이미 경로에 들어 있으므로 따로 가져오지 않는다.
  if (!isContainer(converted)) return;
  for (const child of childrenOf(state.fig, nodeId(source))) {
    walk(state, { source: child, id: `${id}/${nodeId(child)}`, parentId: id, world, isRoot: false, symbolTrail: input.symbolTrail, overrides: remaining, parentLayout: converted.layout, props: input.props, modes, scope: effective.type === 'SYMBOL' ? scopeOf(state.fig, source) : input.scope });
  }
  if (instance) {
    const assignments = [source, ...own.map((item) => item.patch)].map((patch) => (patch as unknown as { componentPropAssignments?: FigPropAssignment[] }).componentPropAssignments);
    const symbolGuid = shaped.symbolData?.symbolID as Guid | undefined;
    const scope = scopeOf(state.fig, symbolGuid ? state.fig.nodeMap.get(guidId(symbolGuid)) : undefined);
    const props = collectProps(input.props, scope, assignments);
    // 편집기에서 속성 값을 고칠 수 있도록 이 인스턴스가 정한 값을 인스턴스 루트에 남긴다(글자·보이기는 이미 적용돼 있다).
    const propValues = instanceValues(scope, collectProps(undefined, scope, assignments));
    if (propValues) converted.propValues = propValues;
    expandInstance(state, shaped, id, world, { trail: input.symbolTrail, own: instance.own, remaining, layout: converted.layout, props, modes, scope });
  }
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
  const isRoot = pathMatcher(symbol);
  const atRoot = all.filter((item) => item.path.length === 1 && isRoot(item.path[0]));
  for (const item of atRoot) state.applied.add(item.id);
  const rootPatch = Object.assign({}, ...atRoot.map((item) => { const { guidPath: _guidPath, ...rest } = item.patch as Record<string, unknown>; void _guidPath; return rest; })) as Partial<FigNode>;
  return { own: [...all.filter((item) => !atRoot.includes(item)), ...derived], rootPatch };
}

interface ExpandContext { trail: Set<string>; own: FigOverride[]; remaining: FigOverride[]; layout?: Layout; props?: PropValues; modes?: ModeMap; scope?: PropScope }

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
  state.instanceSymbols.set(id, symbolId);
  const trail = new Set(symbolTrail).add(symbolId);
  for (const child of childrenOf(state.fig, symbolId)) {
    walk(state, { source: child, id: `${id}/${nodeId(child)}`, parentId: id, world, isRoot: false, symbolTrail: trail, overrides: [...own, ...remaining], parentLayout: context.layout, props: context.props, modes: context.modes, scope: context.scope });
  }
}

function convertNode(state: WalkState, node: FigNode, id: string, parentId: string | null, world: Matrix, parentLayout?: Layout, modes?: ModeMap, scope?: PropScope): NodeInput {
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
    ...(node.visible === false ? { hidden: true } : {}),
    ...(strokes.length ? { strokes } : {}),
    ...(effects.length ? { effects } : {}),
    ...(node.opacity !== undefined && node.opacity < 1 ? { opacity: node.opacity } : {}),
    ...cornerRadius(state, node, id),
    ...(type === 'frame' && node.frameMaskDisabled ? { clipContent: false } : {}),
    // Figma "마스크로 쓰기". 같은 부모 안에서 위의 형제를 이 도형 모양으로 자른다.
    ...((node as { mask?: boolean }).mask ? { mask: true } : {}),
    // Figma "스크롤할 때 위치 고정". 보기 모드는 화면 바로 아래 자식에서만 이 값을 쓴다.
    ...((node as { scrollBehavior?: string }).scrollBehavior === 'FIXED_WHEN_CHILD_OF_SCROLLING_FRAME' ? { fixedScroll: true } : {}),
    ...(layout ? { layout } : {}),
    ...(item ? { item } : {}),
    ...(constraints ? { constraints } : {}),
    ...styleTokens(state, node),
    ...nodePropRefs(scope, node),
    // variableTokens는 아래에서 base 값과 비교해 합친다.
    ...(type === 'text' ? figTextStyle(state.sink, node, id) : {})
  };
  if (type === 'vector') { base.vectorPaths = vectorPaths(state, node, id, width, height); base.viewBox = { width, height }; }
  const variables = variableTokens(state, node, id, base, modes);
  if (Object.keys(variables).length) base.tokens = { ...base.tokens, ...variables };
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
    state.report.issues.push({ nodeId: item.instance, name: `override ${item.path.join(' > ')}`, kind: hidden ? 'override-target-hidden' : 'override-target-missing', detail: `${hidden ? '대상이 삭제됐거나 크기가 없는 노드 아래에 있음' : '경로에 맞는 노드 없음'} · 속성: ${keys}` });
  }
}

/**
 * Figma 채우기·선 스타일 참조를 색 토큰으로 바꾼다. 같은 스타일은 같은 토큰 하나가 되고, 이름은 스타일 이름(예: Primary/Gray/900)이다.
 */
function styleTokens(state: WalkState, node: FigNode): { tokens?: Partial<Record<'fill' | 'stroke', string>> } {
  const refs: Partial<Record<'fill' | 'stroke', string>> = {};
  const fillKey = (node.styleIdForFill as { assetRef?: { key?: string } } | undefined)?.assetRef?.key;
  const strokeKey = (node.styleIdForStrokeFill as { assetRef?: { key?: string } } | undefined)?.assetRef?.key;
  const fill = fillKey ? styleToken(state, fillKey) : null;
  const stroke = strokeKey ? styleToken(state, strokeKey) : null;
  if (fill && node.fillPaints?.some((paint) => paint.type === 'SOLID' && paint.visible !== false)) refs.fill = fill;
  if (stroke && node.strokePaints?.some((paint) => paint.type === 'SOLID' && paint.visible !== false)) refs.stroke = stroke;
  return Object.keys(refs).length ? { tokens: refs } : {};
}

/** 변수에 연결된 채우기·선 색을 이 자리의 변수 모드 값으로 바꾼 노드. 연결이 없으면 그대로다. */
function resolveColors(state: WalkState, node: FigNode, modes: ModeMap | undefined): FigNode {
  if (!node.fillPaints?.some((paint) => (paint as { colorVar?: unknown }).colorVar) && !node.strokePaints?.some((paint) => (paint as { colorVar?: unknown }).colorVar)) return node;
  state.variables ??= variableIndex(state.fig);
  return { ...node, fillPaints: withVariableColors(state.variables, node.fillPaints as never[], modes), strokePaints: withVariableColors(state.variables, node.strokePaints as never[], modes) } as FigNode;
}

/**
 * 모서리 반경. cornerRadius가 없으면 네 모서리 값(rectangle*CornerRadius)을 쓴다. 모두 같으면 그 값,
 * 다르면 문서 모델이 반경 하나만 가지므로 가장 큰 값으로 근사하고 보고한다.
 */
function cornerRadius(state: WalkState, node: FigNode, id: string): { radius?: number } {
  const raw = node as unknown as Record<string, unknown>;
  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) return { radius: node.cornerRadius };
  const corners = ['rectangleTopLeftCornerRadius', 'rectangleTopRightCornerRadius', 'rectangleBottomLeftCornerRadius', 'rectangleBottomRightCornerRadius'].map((key) => raw[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const largest = Math.max(0, ...corners);
  if (largest <= 0) return {};
  if (corners.some((value) => Math.abs(value - largest) > 0.01)) state.report.issues.push({ nodeId: id, name: node.name || node.type, kind: 'radius-approximated', detail: `모서리마다 다른 반경(${corners.join(', ')})을 ${largest}로 근사` });
  return { radius: largest };
}

/** 노드의 현재 값(토큰 자리별). 변수 토큰을 연결해도 화면이 바뀌지 않는지 확인하는 데 쓴다. */
function slotValue(node: NodeInput, slot: TokenSlot): string | number | undefined {
  switch (slot) {
    case 'fill': { const paint = node.fills.find((item) => item.type === 'solid'); return paint?.type === 'solid' ? paint.color : undefined; }
    case 'stroke': return node.strokes?.[0]?.color;
    case 'radius': return node.radius ?? 0;
    case 'fontSize': return node.fontSize;
    case 'gap': return node.layout?.type === 'grid' ? node.layout.columnGap : node.layout?.gap;
  }
}

function sameValue(a: string | number | undefined, b: string | number): boolean {
  if (typeof b === 'number') return typeof a === 'number' && Math.abs(a - b) < 0.01;
  const norm = (value: string): string => value.toLowerCase().replace(/^(#[0-9a-f]{6})ff$/, '$1');
  return typeof a === 'string' && norm(a) === norm(b);
}

/**
 * Figma 변수를 토큰으로 만들고 연결한다. 토큰 값은 이 노드 자리에서 적용되는 모드로 푼 값이다.
 * 토큰은 문서 전체에서 값이 하나라서, 이미 다른 모드 값으로 만든 토큰이거나 노드의 실제 값과 다르면 연결하지 않고 보고만 남긴다(화면을 바꾸지 않기 위해).
 */
function variableTokens(state: WalkState, node: FigNode, id: string, base: NodeInput, modes: ModeMap | undefined): Partial<Record<TokenSlot, string>> {
  state.variables ??= variableIndex(state.fig);
  const refs: Partial<Record<TokenSlot, string>> = {};
  for (const [slot, variable] of Object.entries(boundVariables(state.variables, node)) as Array<[TokenSlot, FigNode]>) {
    const token = variableToken(state.variables, variable, modes);
    if (!token || token.type !== TOKEN_SLOT_TYPE[slot]) continue;
    const existing = state.tokens.get(token.id);
    const value = existing?.value ?? token.value;
    const current = slotValue(base, slot);
    // 벡터의 색은 경로 데이터에 있어 이 자리가 비어 있다. 연결할 곳이 없으므로 조용히 넘어간다.
    if (current === undefined) continue;
    if (!sameValue(current, value)) {
      state.report.issues.push({ nodeId: id, name: node.name || node.type, kind: 'token-mode-mismatch', detail: `변수 ${token.name}: 이 자리 값(${String(current)})과 토큰 값(${String(value)})이 달라 연결하지 않음(다른 모드 값일 수 있음)` });
      continue;
    }
    if (!existing) state.tokens.set(token.id, token);
    refs[slot] = token.id;
  }
  return refs;
}

function styleToken(state: WalkState, key: string): string | null {
  const style = state.styles.get(key);
  const paint = style?.fillPaints?.find((item) => item.type === 'SOLID' && item.visible !== false);
  if (!style || !paint) return null;
  const id = `style-${key}`;
  if (!state.tokens.has(id)) state.tokens.set(id, { id, name: style.name, type: 'color', value: figColor(paint.color, paint.opacity ?? 1) });
  return id;
}
