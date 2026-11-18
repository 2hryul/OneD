export type NodeType = 'frame' | 'group' | 'rectangle' | 'ellipse' | 'text' | 'vector';

/** 2×3 affine 행렬 [a, b, c, d, e, f]. 위치는 x, y에 페이지 절대 좌표로 두고 행렬은 회전·뒤집기만 담는다. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Readonly<Matrix> = [1, 0, 0, 1, 0, 0];

/** 0..1 상자 비율 좌표. (0, 0)이 왼쪽 위, (1, 1)이 오른쪽 아래. */
export interface UnitPoint { x: number; y: number }
export interface GradientStop { offset: number; color: string }
export type ImageFit = 'fill' | 'fit' | 'tile' | 'stretch';

/**
 * 채우기 하나. Penpot `:fills`처럼 도형마다 목록으로 두고, 목록 뒤쪽이 위에 그려진다.
 * 색은 CSS 색 문자열(#rrggbb 또는 #rrggbbaa)이다.
 */
export type Paint =
  | { type: 'solid'; color: string; opacity?: number }
  | { type: 'linear'; from: UnitPoint; to: UnitPoint; stops: GradientStop[]; opacity?: number }
  | { type: 'radial'; center: UnitPoint; radius: UnitPoint; stops: GradientStop[]; opacity?: number }
  | { type: 'image'; assetId: string; fit: ImageFit; opacity?: number };

export type StrokeAlign = 'inside' | 'center' | 'outside';
export interface Stroke { color: string; width: number; align: StrokeAlign; dash?: number[] }

export type Effect =
  | { type: 'drop-shadow' | 'inner-shadow'; x: number; y: number; blur: number; spread: number; color: string }
  | { type: 'layer-blur' | 'background-blur'; radius: number };

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

/** 텍스트 일부 구간의 스타일. start 이상 end 미만 글자에 적용하고, 지정하지 않은 값은 도형 값을 따른다. */
export interface TextSpan { start: number; end: number; fontSize?: number; fontWeight?: number; fontFamily?: string; color?: string }

export interface DesignNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  /** frame과 group에만 있다. 자식 id를 그리는 순서(아래에서 위)대로 담고, 레이어 순서도 여기서 정한다. */
  children?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  transform: Matrix;
  /** 텍스트는 첫 단색 채우기를 글자색으로 쓴다. */
  fills: Paint[];
  strokes?: Stroke[];
  effects?: Effect[];
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  /** 줄 높이(px). 없으면 글꼴 기본값. */
  lineHeight?: number;
  /** 자간(px). */
  letterSpacing?: number;
  spans?: TextSpan[];
  opacity?: number;
  radius?: number;
  sourceType?: string;
  /** frame에만 의미가 있다. 있으면 자식 위치·크기를 레이아웃 엔진이 정한다(Figma Auto Layout, Penpot flex). */
  layout?: FlexLayout;
  /** 레이아웃 안에서의 크기 규칙과 정렬. 레이아웃 컨테이너 자신의 'auto'는 내용에 맞춤(hug)이다. */
  item?: LayoutItem;
  /** 레이아웃이 없는 프레임의 크기가 바뀔 때 이 자식이 따라가는 방식. 없으면 left·top. */
  constraints?: Constraints;
  vectorPaths?: Array<{ d: string; fill: string; stroke?: string; strokeWidth?: number; fillRule?: 'evenodd' }>;
  /** frame에서 false면 내용을 자르지 않는다(Figma의 Clip content 끔). 기본은 자른다. */
  clipContent?: boolean;
  hidden?: boolean;
  /** 캔버스에서 선택·이동되지 않는다. 레이어 패널에서는 선택할 수 있다. */
  locked?: boolean;
}

/** 변경 명령으로 바꿀 수 있는 속성. 정체성(id, type)과 계층(parentId, children)은 별도 변경으로만 바꾼다. */
export type ShapeAttrs = Omit<DesignNode, 'id' | 'type' | 'parentId' | 'children'>;

export interface Page {
  id: string;
  name: string;
  /** 최상위 도형 id. 그리는 순서대로 담는다. */
  children: string[];
  objects: Record<string, DesignNode>;
}

export interface DesignDocument { version: 4; name: string; pages: Page[] }

export type FlexDirection = 'row' | 'column';
export type FlexJustify = 'start' | 'center' | 'end' | 'space-between';
export type FlexAlign = 'start' | 'center' | 'end' | 'stretch';

/** Penpot `:layout :flex` 속성과 같은 구성. padding은 위·오른쪽·아래·왼쪽 순서다. */
export interface FlexLayout {
  type: 'flex';
  direction: FlexDirection;
  wrap: boolean;
  /** 주축 방향 자식 사이 간격. */
  gap: number;
  /** 줄바꿈된 줄 사이 간격. */
  crossGap: number;
  padding: [number, number, number, number];
  justify: FlexJustify;
  align: FlexAlign;
}

/** fix는 현재 크기 고정, fill은 부모 남는 공간 채우기, auto는 내용에 맞춤(hug). */
export type ItemSizing = 'fix' | 'fill' | 'auto';

export interface LayoutItem {
  h?: ItemSizing;
  v?: ItemSizing;
  alignSelf?: FlexAlign;
  /** 레이아웃 흐름에서 빠져 지금 위치를 유지한다(Figma absolute position). */
  absolute?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export type HConstraint = 'left' | 'right' | 'center' | 'left-right' | 'scale';
export type VConstraint = 'top' | 'bottom' | 'center' | 'top-bottom' | 'scale';
export interface Constraints { h: HConstraint; v: VConstraint }

/** 도형을 만들 때의 입력. children과 transform은 생성 함수가 채운다. */
export type NodeInput = Omit<DesignNode, 'children' | 'transform'> & { transform?: Matrix };

const NODE_TYPES: readonly NodeType[] = ['frame', 'group', 'rectangle', 'ellipse', 'text', 'vector'];

/** 자식을 가질 수 있는 도형인지. frame은 내용을 자르고, group은 자식 영역에 맞춰 크기가 정해진다. */
export function isContainer(node: Pick<DesignNode, 'type'>): boolean {
  return node.type === 'frame' || node.type === 'group';
}

export function solid(color: string): Paint[] {
  return [{ type: 'solid', color }];
}

/** 텍스트 색과 패널 색상칸에 쓸 대표 색. 단색이 없으면 그라디언트 첫 정지점 색을 쓴다. */
export function primaryColor(node: Pick<DesignNode, 'fills'>, fallback = '#000000'): string {
  for (const paint of [...node.fills].reverse()) {
    if (paint.type === 'solid') return paint.color;
    if (paint.type === 'linear' || paint.type === 'radial') return paint.stops[0]?.color ?? fallback;
  }
  return fallback;
}

export function emptyPage(id: string, name: string): Page {
  return { id, name, children: [], objects: {} };
}

/**
 * 부모가 먼저 나오는 도형 목록으로 페이지를 만든다.
 * 형제 순서는 목록 순서를 따르므로, 앞쪽 도형이 아래에 그려진다.
 *
 * Args:
 *   id, name: 페이지 id와 이름
 *   nodes: parentId로 부모를 가리키는 도형 목록
 */
export function pageFromNodes(id: string, name: string, nodes: readonly NodeInput[]): Page {
  const objects: Record<string, DesignNode> = {};
  const children: string[] = [];
  for (const input of nodes) {
    if (objects[input.id]) throw new Error(`[pageFromNodes] 도형 id 중복 - ${input.id}`);
    objects[input.id] = { ...input, transform: [...(input.transform ?? IDENTITY)] as Matrix, ...(isContainer(input) ? { children: [] } : {}) };
  }
  for (const input of nodes) {
    if (input.parentId === null) { children.push(input.id); continue; }
    const parent = objects[input.parentId];
    if (!parent || !isContainer(parent)) throw new Error(`[pageFromNodes] 부모가 컨테이너가 아님 - ${input.id}`);
    parent.children!.push(input.id);
  }
  return { id, name, children, objects };
}

/** 페이지의 도형을 그리는 순서(부모 먼저, 형제는 아래에서 위)로 나열한다. roots를 주면 그 하위 트리만 나열한다. */
export function walkPage(page: Page, roots: readonly string[] = page.children): DesignNode[] {
  const result: DesignNode[] = [];
  const visit = (id: string): void => {
    const node = page.objects[id];
    if (!node) return;
    result.push(node);
    node.children?.forEach(visit);
  };
  roots.forEach(visit);
  return result;
}

export function sampleDocument(): DesignDocument {
  return { version: 4, name: 'Untitled design', pages: [pageFromNodes('page-1', 'Page 1', [
    { id: 'frame-1', type: 'frame', name: 'Landing page', parentId: null, x: 120, y: 95, width: 720, height: 520, fills: solid('#ffffff') },
    { id: 'rect-1', type: 'rectangle', name: 'Hero panel', parentId: 'frame-1', x: 164, y: 150, width: 632, height: 336, fills: solid('#e6ebff'), radius: 24 },
    { id: 'text-1', type: 'text', name: 'Heading', parentId: 'frame-1', x: 210, y: 218, width: 470, height: 72, fills: solid('#202c65'), text: 'Design starts here', fontSize: 42 },
    { id: 'text-2', type: 'text', name: 'Description', parentId: 'frame-1', x: 210, y: 315, width: 470, height: 48, fills: solid('#52618a'), text: 'Shape ideas into reusable interfaces.', fontSize: 20 },
    { id: 'rect-2', type: 'rectangle', name: 'Button', parentId: 'frame-1', x: 210, y: 392, width: 164, height: 52, fills: solid('#5369f8'), radius: 12 },
    { id: 'text-3', type: 'text', name: 'Button label', parentId: 'frame-1', x: 238, y: 405, width: 110, height: 26, fills: solid('#ffffff'), text: 'Get started', fontSize: 18 }
  ])] };
}

/**
 * 저장된 JSON을 문서로 읽는다. version 1~3 문서는 version 4로 변환한다.
 * 외부 입력이므로 구조를 모두 검사하고, 어긋나면 원인을 담은 오류를 던진다.
 */
export function parseDocument(raw: string): DesignDocument {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.name !== 'string') throw new Error('Invalid document');
  if (value.version === 1) return migrateV1(value.name, value.nodes);
  if (value.version === 2 || value.version === 3 || value.version === 4) return validatePages(value.name, value.pages, value.version);
  throw new Error('Unsupported document format');
}

/** v1·v2의 단일 채우기 문자열을 채우기 목록으로 바꾼다. 'transparent'는 채우기 없음이다. */
function fillToFills(node: Record<string, unknown>): Record<string, unknown> {
  const { fill, ...rest } = node;
  return { ...rest, fills: fill === 'transparent' || fill === '' ? [] : solid(fill as string) };
}

/**
 * v1~v3의 layout('HORIZONTAL' 등)·gap은 가져올 때 표시용으로만 남긴 값이었다. 패딩·정렬 정보가 없어
 * 레이아웃으로 바꾸면 다음 편집에서 자식이 엉뚱한 곳으로 움직이므로 버린다. 정확한 레이아웃은 다시 가져오면 생긴다.
 */
function dropLegacyLayout(node: Record<string, unknown>): Record<string, unknown> {
  const { layout: _layout, gap: _gap, ...rest } = node;
  void _layout; void _gap;
  return rest;
}

function migrateV1(name: string, nodes: unknown): DesignDocument {
  if (!Array.isArray(nodes)) throw new Error('Unsupported document format');
  for (const node of nodes) checkNodeFields(node, 1);
  // v1은 배열 순서가 곧 그리는 순서였다. 같은 부모 안의 형제 순서를 그대로 보존한다.
  const inputs = nodes.map((node: Record<string, unknown>) => {
    const { children: _children, ...rest } = node;
    void _children;
    return dropLegacyLayout(fillToFills(rest)) as unknown as NodeInput;
  });
  try { return { version: 4, name, pages: [pageFromNodes('page-1', 'Page 1', inputs)] }; }
  catch { throw new Error('Invalid parent'); }
}

function validatePages(name: string, pages: unknown, version: 2 | 3 | 4): DesignDocument {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('Unsupported document format');
  const pageIds = new Set<string>();
  const result: Page[] = [];
  for (const page of pages) {
    if (!isRecord(page) || typeof page.id !== 'string' || pageIds.has(page.id) || typeof page.name !== 'string' ||
      !isStringArray(page.children) || !isRecord(page.objects)) throw new Error('Invalid page');
    pageIds.add(page.id);
    const objects = version === 4 ? page.objects : Object.fromEntries(Object.entries(page.objects).map(([key, node]) => {
      checkNodeFields(node, version);
      return [key, dropLegacyLayout(version === 2 ? fillToFills(node) : node)];
    }));
    const next = { ...page, objects } as unknown as Page;
    checkPageTree(next);
    result.push(next);
  }
  return { version: 4, name, pages: result };
}

/** 모든 도형이 정확히 한 곳(최상위 목록 또는 부모의 children)에서 참조되고, 최상위에서 모두 닿을 수 있는지 검사한다. 순환 참조도 여기서 걸러진다. */
function checkPageTree(page: Page): void {
  const entries = Object.entries(page.objects);
  for (const [key, node] of entries) {
    checkNodeFields(node, 4);
    if (node.id !== key || !isMatrix(node.transform)) throw new Error('Invalid node');
    if (isContainer(node as DesignNode) !== isStringArray(node.children)) throw new Error('Invalid node');
  }
  const referenced = new Set<string>();
  const claim = (id: string, parentId: string | null): void => {
    const node = page.objects[id];
    if (!node || node.parentId !== parentId || referenced.has(id)) throw new Error('Invalid parent');
    referenced.add(id);
  };
  page.children.forEach((id) => claim(id, null));
  for (const [, node] of entries) node.children?.forEach((id) => claim(id, node.id));
  if (referenced.size !== entries.length || walkPage(page).length !== entries.length) throw new Error('Invalid parent');
}

function checkNodeFields(node: unknown, version: 1 | 2 | 3 | 4): asserts node is Record<string, unknown> {
  if (!isRecord(node) || typeof node.id !== 'string' || !NODE_TYPES.includes(node.type as NodeType) ||
    typeof node.name !== 'string' ||
    !isFiniteNumber(node.x) || !isFiniteNumber(node.y) || !isFiniteNumber(node.width) || !isFiniteNumber(node.height) ||
    node.width <= 0 || node.height <= 0 || (node.parentId !== null && typeof node.parentId !== 'string')) throw new Error('Invalid node');
  if (version < 3 ? typeof node.fill !== 'string' : !isArrayOf(node.fills, isPaint)) throw new Error('Invalid node');
  if (!optional(node.hidden, isBoolean) || !optional(node.locked, isBoolean) || !optional(node.clipContent, isBoolean)) throw new Error('Invalid node');
  if (!optional(node.strokes, (value) => isArrayOf(value, isStroke)) || !optional(node.effects, (value) => isArrayOf(value, isEffect))) throw new Error('Invalid style');
  if (!optional(node.spans, (value) => isArrayOf(value, isSpan))) throw new Error('Invalid text');
  if (!optional(node.textAlign, (value) => ['left', 'center', 'right', 'justify'].includes(value as string)) ||
    !optional(node.verticalAlign, (value) => ['top', 'middle', 'bottom'].includes(value as string)) ||
    !optional(node.lineHeight, isFiniteNumber) || !optional(node.letterSpacing, isFiniteNumber)) throw new Error('Invalid text');
  if (version === 4 && (!optional(node.layout, isFlexLayout) || !optional(node.item, isLayoutItem) || !optional(node.constraints, isConstraints))) throw new Error('Invalid layout');
}

function isFlexLayout(value: unknown): boolean {
  return isRecord(value) && value.type === 'flex' && ['row', 'column'].includes(value.direction as string) && isBoolean(value.wrap) &&
    isFiniteNumber(value.gap) && isFiniteNumber(value.crossGap) && Array.isArray(value.padding) && value.padding.length === 4 && value.padding.every(isFiniteNumber) &&
    ['start', 'center', 'end', 'space-between'].includes(value.justify as string) && ['start', 'center', 'end', 'stretch'].includes(value.align as string);
}

function isLayoutItem(value: unknown): boolean {
  const sizing = (item: unknown): boolean => ['fix', 'fill', 'auto'].includes(item as string);
  return isRecord(value) && optional(value.h, sizing) && optional(value.v, sizing) && optional(value.absolute, isBoolean) &&
    optional(value.alignSelf, (item) => ['start', 'center', 'end', 'stretch'].includes(item as string)) &&
    [value.minWidth, value.maxWidth, value.minHeight, value.maxHeight].every((item) => optional(item, isFiniteNumber));
}

function isConstraints(value: unknown): boolean {
  return isRecord(value) && ['left', 'right', 'center', 'left-right', 'scale'].includes(value.h as string) && ['top', 'bottom', 'center', 'top-bottom', 'scale'].includes(value.v as string);
}

function isPaint(value: unknown): boolean {
  if (!isRecord(value) || !optional(value.opacity, isFiniteNumber)) return false;
  switch (value.type) {
    case 'solid': return typeof value.color === 'string';
    case 'linear': return isUnitPoint(value.from) && isUnitPoint(value.to) && isArrayOf(value.stops, isStop);
    case 'radial': return isUnitPoint(value.center) && isUnitPoint(value.radius) && isArrayOf(value.stops, isStop);
    case 'image': return typeof value.assetId === 'string' && ['fill', 'fit', 'tile', 'stretch'].includes(value.fit as string);
    default: return false;
  }
}

function isStroke(value: unknown): boolean {
  return isRecord(value) && typeof value.color === 'string' && isFiniteNumber(value.width) && value.width >= 0 &&
    ['inside', 'center', 'outside'].includes(value.align as string) && optional(value.dash, (dash) => isArrayOf(dash, isFiniteNumber));
}

function isEffect(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.type === 'drop-shadow' || value.type === 'inner-shadow') {
    return [value.x, value.y, value.blur, value.spread].every(isFiniteNumber) && typeof value.color === 'string';
  }
  return (value.type === 'layer-blur' || value.type === 'background-blur') && isFiniteNumber(value.radius);
}

function isSpan(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.start) && isFiniteNumber(value.end) && optional(value.fontSize, isFiniteNumber) &&
    optional(value.fontWeight, isFiniteNumber) && optional(value.fontFamily, (item) => typeof item === 'string') && optional(value.color, (item) => typeof item === 'string');
}

function isStop(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.offset) && typeof value.color === 'string';
}

function isUnitPoint(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function optional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

function isArrayOf(value: unknown, check: (value: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}

function isBoolean(value: unknown): boolean {
  return typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMatrix(value: unknown): value is Matrix {
  return Array.isArray(value) && value.length === 6 && value.every(isFiniteNumber);
}
