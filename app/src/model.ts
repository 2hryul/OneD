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

/** 경로의 점 하나. in·out은 들어오고 나가는 베지어 핸들의 위치(같은 지역 좌표)이고, 없으면 그쪽은 직선이다. */
export interface PathPoint { x: number; y: number; in?: { x: number; y: number }; out?: { x: number; y: number } }
export interface SubPath { closed: boolean; points: PathPoint[] }
export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';

/** 프로토타입 상호작용(Penpot types/shape/interactions.cljc). 트리거가 일어나면 동작을 보기 모드에서 실행한다. */
export type InteractionTrigger = 'click' | 'mouse-enter' | 'mouse-leave' | 'after-delay';
export type OverlayPosition = 'center' | 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
/** 동작. destination은 같은 페이지의 최상위 프레임(화면) id다. */
export type InteractionAction =
  | { type: 'navigate'; destination: string }
  | { type: 'open-overlay' | 'toggle-overlay'; destination: string; position: OverlayPosition; closeOnOutside: boolean; background: boolean }
  | { type: 'close-overlay'; destination?: string }
  | { type: 'back' }
  | { type: 'open-url'; url: string };
/** delay는 after-delay 트리거의 대기 시간(ms)이다. */
export interface Interaction { trigger: InteractionTrigger; delay?: number; action: InteractionAction }
export const TRIGGERS: readonly InteractionTrigger[] = ['click', 'mouse-enter', 'mouse-leave', 'after-delay'];
export const OVERLAY_POSITIONS: readonly OverlayPosition[] = ['center', 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

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
  /** frame에만 의미가 있다. 있으면 자식 위치·크기를 레이아웃 엔진이 정한다(Figma Auto Layout·Grid, Penpot flex·grid). */
  layout?: Layout;
  /** 레이아웃 안에서의 크기 규칙과 정렬. 레이아웃 컨테이너 자신의 'auto'는 내용에 맞춤(hug)이다. */
  item?: LayoutItem;
  /** 레이아웃이 없는 프레임의 크기가 바뀔 때 이 자식이 따라가는 방식. 없으면 left·top. */
  constraints?: Constraints;
  vectorPaths?: Array<{ d: string; fill: string; stroke?: string; strokeWidth?: number; fillRule?: 'evenodd' }>;
  /**
   * text에만 있다. Figma 파일에 저장된 글리프 윤곽(글자 상자 지역 좌표의 SVG 경로)과, 그 윤곽이 맞는 글자·글꼴·크기·굵기(key).
   * 글꼴이 이 PC에 없을 때 Figma와 같은 모양으로 그리는 데 쓰고, 글자가 바뀌어 key가 다르면 쓰지 않는다.
   */
  glyphs?: { key: string; d: string };
  /** vectorPaths 좌표계의 크기. 도형 크기가 바뀌어도 경로가 같이 늘어나도록 SVG viewBox로 쓴다. 없으면 도형 크기. */
  viewBox?: { width: number; height: number };
  /** 편집 경로의 채우기 규칙. 불리언 결과처럼 구멍이 있는 경로는 evenodd다. */
  fillRule?: 'evenodd';
  /** 편집할 수 있는 벡터 경로(도형 지역 좌표). 있으면 vectorPaths 대신 이 경로를 도형의 채우기·선으로 그린다. */
  path?: SubPath[];
  /** group에만 있다. 있으면 자식(피연산자)을 이 연산으로 합친 결과 경로(path)를 그린다(비파괴 불리언). */
  boolOp?: BoolOp;
  /**
   * true면 마스크 도형이다(Figma Use as mask). 자신은 그려지지 않고, 같은 부모 안에서 자기 위에 그려지는 형제를
   * 다음 마스크 전까지 자기 채우기 윤곽으로 자른다.
   */
  mask?: boolean;
  /** frame에서 false면 내용을 자르지 않는다(Figma의 Clip content 끔). 기본은 자른다. */
  clipContent?: boolean;
  hidden?: boolean;
  /** 캔버스에서 선택·이동되지 않는다. 레이어 패널에서는 선택할 수 있다. */
  locked?: boolean;
  /** 컴포넌트 루트에만 있다. 메인 컴포넌트와 그 인스턴스의 루트가 같은 값을 가진다. */
  componentId?: string;
  /** 메인 컴포넌트의 루트. 이 하위 트리가 인스턴스들의 원본이다. */
  mainInstance?: boolean;
  /** variant 메인들을 묶는 프레임(Figma 컴포넌트 세트, Penpot variant 컨테이너). */
  componentSet?: boolean;
  /** 인스턴스 안의 도형이 대응하는 메인 컴포넌트 도형 id. 인스턴스 루트에도 있다. */
  shapeRef?: string;
  /** 인스턴스에서 사용자가 바꾼 속성 묶음. 여기 든 묶음은 메인이 바뀌어도 덮어쓰지 않는다(Penpot touched). */
  touched?: SyncGroup[];
  /** 메인 컴포넌트 안 도형(과 인스턴스의 대응 도형)이 쓰는 컴포넌트 속성 id. */
  propRefs?: PropRefs;
  /** 인스턴스 루트에만 있다. 컴포넌트 속성 id → 이 인스턴스의 값. 없는 속성은 기본값을 쓴다. */
  propValues?: Record<string, string | boolean>;
  /** 속성에 연결된 디자인 토큰 id. 토큰 값이 바뀌면 이 속성도 바뀐다. */
  tokens?: Partial<Record<TokenSlot, string>>;
  /** 프로토타입 상호작용. 보기 모드에서만 동작한다. */
  interactions?: Interaction[];
  /** 화면(최상위 프레임)의 바로 아래 자식에서 true면 화면을 스크롤해도 제자리에 남는다(Figma Fix position when scrolling). */
  fixedScroll?: boolean;
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

export interface DesignDocument {
  version: 5;
  name: string;
  pages: Page[];
  components: Record<string, Component>;
  tokens: Record<string, Token>;
}

/** 메인 컴포넌트 등록 정보. variant면 세트 프레임 id와 속성 값(예: { State: 'Hover' })을 가진다. */
export interface Component {
  id: string;
  name: string;
  mainId: string;
  pageId: string;
  setId?: string;
  variant?: Record<string, string>;
  /** 컴포넌트 속성(Figma component properties). 메인 안 도형의 propRefs가 이 id를 가리키고, 인스턴스 루트의 propValues가 값을 정한다. */
  props?: ComponentProp[];
}

/**
 * 컴포넌트 속성 하나. text는 글자, boolean은 보이기다(인스턴스 교체 속성은 아직 없다).
 * defaultValue는 값을 정하지 않은 인스턴스가 쓰는 값이고, 메인 도형도 이 값으로 그려진다.
 */
export interface ComponentProp { id: string; name: string; type: ComponentPropType; defaultValue: string | boolean }
export type ComponentPropType = 'text' | 'boolean';
/** 도형이 컴포넌트 속성을 쓰는 자리. text는 글자, visible은 보이기다. */
export interface PropRefs { text?: string; visible?: string }

export type TokenType = 'color' | 'number';
export interface Token { id: string; name: string; type: TokenType; value: string | number }

/** 토큰을 연결할 수 있는 속성 자리. fill은 첫 단색 채우기(텍스트면 글자색), stroke는 첫 선 색, gap은 오토 레이아웃 간격이다. */
export type TokenSlot = 'fill' | 'stroke' | 'radius' | 'fontSize' | 'gap';
export const TOKEN_SLOT_TYPE: Record<TokenSlot, TokenType> = { fill: 'color', stroke: 'color', radius: 'number', fontSize: 'number', gap: 'number' };

/**
 * 메인→인스턴스 동기화 단위. Penpot component.cljc의 sync-attrs 묶음을 이 모델 속성에 맞춘 것이다.
 * geometry(x·y·크기·행렬)는 인스턴스 루트 기준 상대 위치로 비교·동기화한다.
 */
export const SYNC_GROUPS = {
  name: ['name'],
  fill: ['fills'],
  content: ['text', 'spans', 'glyphs', 'vectorPaths', 'viewBox', 'fillRule', 'path', 'boolOp', 'mask', 'propRefs'],
  visibility: ['hidden'],
  modifiable: ['locked'],
  'text-font': ['fontSize', 'fontFamily', 'fontWeight'],
  'text-display': ['letterSpacing', 'lineHeight', 'textAlign', 'verticalAlign'],
  stroke: ['strokes'],
  radius: ['radius'],
  'layer-effects': ['opacity'],
  effects: ['effects'],
  constraints: ['constraints'],
  layout: ['layout'],
  'layout-item': ['item'],
  clip: ['clipContent'],
  tokens: ['tokens'],
  /** 중첩 인스턴스 루트가 가진 컴포넌트 속성 값. 메인의 중첩 인스턴스에 정한 값이 인스턴스로 내려온다. */
  props: ['propValues'],
  prototype: ['interactions', 'fixedScroll'],
  geometry: ['x', 'y', 'width', 'height', 'transform']
} as const satisfies Record<string, readonly string[]>;
export type SyncGroup = keyof typeof SYNC_GROUPS;
const SYNC_GROUP_NAMES = Object.keys(SYNC_GROUPS) as SyncGroup[];

/** variant 메인 이름 "State=Hover, Size=L"을 속성 표로. 형식이 아니면 null. */
export function parseVariantName(name: string): Record<string, string> | null {
  const parts = name.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !part.includes('='))) return null;
  return Object.fromEntries(parts.map((part) => { const [key, ...rest] = part.split('='); return [key!.trim(), rest.join('=').trim()]; }));
}

export function variantName(variant: Record<string, string>): string {
  return Object.entries(variant).map(([key, value]) => `${key}=${value}`).join(', ');
}

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

/** Grid 트랙 크기. fixed는 px, flex는 남는 공간의 비율(fr), auto는 그 줄 내용 중 가장 큰 크기에 맞춤(hug). */
export interface GridTrack { type: 'fixed' | 'flex' | 'auto'; value: number }

/**
 * Penpot `:layout :grid`·Figma Grid auto layout과 같은 구성. padding은 위·오른쪽·아래·왼쪽 순서다.
 * 자식은 item.gridCell이 있으면 그 칸에, 없으면 빈 칸을 행 순서로 채운다. 칸이 모자라면 내용에 맞춤 행이 늘어난다.
 * justifyItems는 칸 안 가로 정렬, alignItems는 세로 정렬이다(stretch는 '채우기' 자식에만 의미가 있다).
 */
export interface GridLayout {
  type: 'grid';
  columns: GridTrack[];
  rows: GridTrack[];
  columnGap: number;
  rowGap: number;
  padding: [number, number, number, number];
  justifyItems: FlexAlign;
  alignItems: FlexAlign;
}

export type Layout = FlexLayout | GridLayout;

/** fix는 현재 크기 고정, fill은 부모 남는 공간 채우기, auto는 내용에 맞춤(hug). */
export type ItemSizing = 'fix' | 'fill' | 'auto';

export interface LayoutItem {
  h?: ItemSizing;
  v?: ItemSizing;
  alignSelf?: FlexAlign;
  /** Grid 부모 안에서 들어갈 칸(0부터). 없으면 자동 배치된다. */
  gridCell?: { row: number; column: number };
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
  return { version: 5, name: 'Untitled design', components: {}, tokens: {}, pages: [pageFromNodes('page-1', 'Page 1', [
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
  if (value.version === 2 || value.version === 3 || value.version === 4) return { ...validatePages(value.name, value.pages, value.version), components: {}, tokens: {} };
  if (value.version === 5) return validateRegistries({ ...validatePages(value.name, value.pages, 5), components: value.components as DesignDocument['components'], tokens: value.tokens as DesignDocument['tokens'] });
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
  try { return { version: 5, name, components: {}, tokens: {}, pages: [pageFromNodes('page-1', 'Page 1', inputs)] }; }
  catch { throw new Error('Invalid parent'); }
}

function validatePages(name: string, pages: unknown, version: 2 | 3 | 4 | 5): Omit<DesignDocument, 'components' | 'tokens'> & { version: 5 } {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('Unsupported document format');
  const pageIds = new Set<string>();
  const result: Page[] = [];
  for (const page of pages) {
    if (!isRecord(page) || typeof page.id !== 'string' || pageIds.has(page.id) || typeof page.name !== 'string' ||
      !isStringArray(page.children) || !isRecord(page.objects)) throw new Error('Invalid page');
    pageIds.add(page.id);
    const objects = version >= 4 ? page.objects : Object.fromEntries(Object.entries(page.objects).map(([key, node]) => {
      checkNodeFields(node, version);
      return [key, dropLegacyLayout(version === 2 ? fillToFills(node) : node)];
    }));
    const next = { ...page, objects } as unknown as Page;
    checkPageTree(next);
    result.push(next);
  }
  return { version: 5, name, pages: result };
}

/** 모든 도형이 정확히 한 곳(최상위 목록 또는 부모의 children)에서 참조되고, 최상위에서 모두 닿을 수 있는지 검사한다. 순환 참조도 여기서 걸러진다. */
function checkPageTree(page: Page): void {
  const entries = Object.entries(page.objects);
  for (const [key, node] of entries) {
    checkNodeFields(node, 5);
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

/** 노드 하나가 저장 형식(version 5)에 맞는지 검사한다. 플러그인처럼 밖에서 온 노드 값을 받을 때 쓴다. 어긋나면 던진다. */
export function assertNodeFields(node: unknown): void {
  checkNodeFields(node, 5);
  if (!isMatrix(node.transform)) throw new Error('Invalid node');
}

function checkNodeFields(node: unknown, version: 1 | 2 | 3 | 4 | 5): asserts node is Record<string, unknown> {
  if (!isRecord(node) || typeof node.id !== 'string' || !NODE_TYPES.includes(node.type as NodeType) ||
    typeof node.name !== 'string' ||
    !isFiniteNumber(node.x) || !isFiniteNumber(node.y) || !isFiniteNumber(node.width) || !isFiniteNumber(node.height) ||
    node.width <= 0 || node.height <= 0 || (node.parentId !== null && typeof node.parentId !== 'string')) throw new Error('Invalid node');
  if (version < 3 ? typeof node.fill !== 'string' : !isArrayOf(node.fills, isPaint)) throw new Error('Invalid node');
  if (!optional(node.hidden, isBoolean) || !optional(node.locked, isBoolean) || !optional(node.clipContent, isBoolean) || !optional(node.mask, isBoolean)) throw new Error('Invalid node');
  if (!optional(node.strokes, (value) => isArrayOf(value, isStroke)) || !optional(node.effects, (value) => isArrayOf(value, isEffect))) throw new Error('Invalid style');
  if (!optional(node.spans, (value) => isArrayOf(value, isSpan))) throw new Error('Invalid text');
  if (!optional(node.glyphs, (value) => isRecord(value) && typeof value.key === 'string' && typeof value.d === 'string')) throw new Error('Invalid text');
  if (!optional(node.textAlign, (value) => ['left', 'center', 'right', 'justify'].includes(value as string)) ||
    !optional(node.verticalAlign, (value) => ['top', 'middle', 'bottom'].includes(value as string)) ||
    !optional(node.lineHeight, isFiniteNumber) || !optional(node.letterSpacing, isFiniteNumber)) throw new Error('Invalid text');
  if (version === 5 && !isComponentFields(node)) throw new Error('Invalid component fields');
  if (!optional(node.path, (value) => isArrayOf(value, isSubPath)) || !optional(node.boolOp, (value) => ['union', 'subtract', 'intersect', 'exclude'].includes(value as string))) throw new Error('Invalid path');
  if (!optional(node.interactions, (value) => isArrayOf(value, isInteraction)) || !optional(node.fixedScroll, isBoolean)) throw new Error('Invalid interaction');
  if (version >= 4 && (!optional(node.layout, (value) => isFlexLayout(value) || isGridLayout(value)) || !optional(node.item, isLayoutItem) || !optional(node.constraints, isConstraints))) throw new Error('Invalid layout');
}

function isFlexLayout(value: unknown): boolean {
  return isRecord(value) && value.type === 'flex' && ['row', 'column'].includes(value.direction as string) && isBoolean(value.wrap) &&
    isFiniteNumber(value.gap) && isFiniteNumber(value.crossGap) && Array.isArray(value.padding) && value.padding.length === 4 && value.padding.every(isFiniteNumber) &&
    ['start', 'center', 'end', 'space-between'].includes(value.justify as string) && ['start', 'center', 'end', 'stretch'].includes(value.align as string);
}

function isGridLayout(value: unknown): boolean {
  const align = (item: unknown): boolean => ['start', 'center', 'end', 'stretch'].includes(item as string);
  const track = (item: unknown): boolean => isRecord(item) && ['fixed', 'flex', 'auto'].includes(item.type as string) && isFiniteNumber(item.value) && (item.value as number) >= 0;
  return isRecord(value) && value.type === 'grid' && isArrayOf(value.columns, track) && (value.columns as unknown[]).length > 0 && isArrayOf(value.rows, track) &&
    isFiniteNumber(value.columnGap) && isFiniteNumber(value.rowGap) && Array.isArray(value.padding) && value.padding.length === 4 && value.padding.every(isFiniteNumber) &&
    align(value.justifyItems) && align(value.alignItems);
}

function isLayoutItem(value: unknown): boolean {
  const sizing = (item: unknown): boolean => ['fix', 'fill', 'auto'].includes(item as string);
  return isRecord(value) && optional(value.h, sizing) && optional(value.v, sizing) && optional(value.absolute, isBoolean) &&
    optional(value.alignSelf, (item) => ['start', 'center', 'end', 'stretch'].includes(item as string)) &&
    [value.minWidth, value.maxWidth, value.minHeight, value.maxHeight].every((item) => optional(item, isFiniteNumber)) &&
    optional(value.gridCell, (cell) => isRecord(cell) && Number.isInteger(cell.row) && Number.isInteger(cell.column) && (cell.row as number) >= 0 && (cell.column as number) >= 0);
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

function isComponentFields(node: Record<string, unknown>): boolean {
  const isString = (value: unknown): boolean => typeof value === 'string';
  return optional(node.componentId, isString) && optional(node.mainInstance, isBoolean) && optional(node.componentSet, isBoolean) && optional(node.shapeRef, isString) &&
    optional(node.touched, (value) => isArrayOf(value, (group) => SYNC_GROUP_NAMES.includes(group as SyncGroup))) &&
    optional(node.tokens, (value) => isRecord(value) && Object.entries(value).every(([slot, id]) => slot in TOKEN_SLOT_TYPE && typeof id === 'string')) &&
    optional(node.propRefs, (value) => isRecord(value) && Object.entries(value).every(([field, id]) => ['text', 'visible'].includes(field) && isString(id))) &&
    optional(node.propValues, (value) => isRecord(value) && Object.values(value).every((item) => typeof item === 'string' || typeof item === 'boolean'));
}

/** 컴포넌트 속성 정의 검사. 종류별 기본값 형식(text·swap은 문자열, boolean은 참·거짓)도 본다. */
function isComponentProp(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && ['text', 'boolean'].includes(value.type as string) &&
    (value.type === 'boolean' ? typeof value.defaultValue === 'boolean' : typeof value.defaultValue === 'string');
}

/**
 * 컴포넌트·토큰 등록 정보를 검사한다. 메인 도형이 실제로 있고, 인스턴스·토큰 참조가 등록된 id를 가리켜야 한다.
 */
function validateRegistries(doc: DesignDocument): DesignDocument {
  if (!isRecord(doc.components) || !isRecord(doc.tokens)) throw new Error('Invalid registries');
  const objectsById = new Map(doc.pages.flatMap((page) => Object.values(page.objects).map((node) => [node.id, { node, pageId: page.id }] as const)));
  for (const [id, component] of Object.entries(doc.components)) {
    if (!isRecord(component) || component.id !== id || typeof component.name !== 'string' || typeof component.mainId !== 'string' || typeof component.pageId !== 'string') throw new Error('Invalid component');
    const main = objectsById.get(component.mainId);
    if (!main || main.pageId !== component.pageId || main.node.componentId !== id || !main.node.mainInstance) throw new Error(`Invalid component main - ${id}`);
    if (!optional(component.variant, (value) => isRecord(value) && Object.values(value).every((item) => typeof item === 'string')) || !optional(component.setId, (value) => typeof value === 'string')) throw new Error('Invalid component');
    if (!optional(component.props, (value) => isArrayOf(value, isComponentProp))) throw new Error(`Invalid component props - ${id}`);
  }
  for (const [id, token] of Object.entries(doc.tokens)) {
    if (!isRecord(token) || token.id !== id || typeof token.name !== 'string' || !['color', 'number'].includes(token.type as string) ||
      (token.type === 'color' ? typeof token.value !== 'string' : !isFiniteNumber(token.value))) throw new Error('Invalid token');
  }
  for (const { node } of objectsById.values()) {
    if (node.componentId && !doc.components[node.componentId]) throw new Error(`Unknown component - ${node.componentId}`);
    for (const tokenId of Object.values(node.tokens ?? {})) if (!doc.tokens[tokenId!]) throw new Error(`Unknown token - ${tokenId}`);
  }
  return doc;
}

/** 저장된 상호작용 하나를 검사한다. URL은 문자열인지만 보고, 실행할 때 http·https만 연다(viewer). */
function isInteraction(value: unknown): boolean {
  if (!isRecord(value) || !TRIGGERS.includes(value.trigger as InteractionTrigger) || !optional(value.delay, (delay) => isFiniteNumber(delay) && delay >= 0)) return false;
  const action = value.action;
  if (!isRecord(action)) return false;
  const isString = (item: unknown): boolean => typeof item === 'string';
  switch (action.type) {
    case 'navigate': return isString(action.destination);
    case 'open-overlay':
    case 'toggle-overlay':
      return isString(action.destination) && OVERLAY_POSITIONS.includes(action.position as OverlayPosition) && isBoolean(action.closeOnOutside) && isBoolean(action.background);
    case 'close-overlay': return optional(action.destination, isString);
    case 'back': return true;
    case 'open-url': return isString(action.url);
    default: return false;
  }
}

function isSubPath(value: unknown): boolean {
  const isPoint = (point: unknown): boolean => isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y);
  return isRecord(value) && isBoolean(value.closed) && isArrayOf(value.points, (point) => isPoint(point) && optional((point as Record<string, unknown>).in, isPoint) && optional((point as Record<string, unknown>).out, isPoint));
}
