export type NodeType = 'frame' | 'group' | 'rectangle' | 'ellipse' | 'text' | 'vector';

/** 2×3 affine 행렬 [a, b, c, d, e, f]. 위치는 x, y에 페이지 절대 좌표로 두고 행렬은 회전·기울임만 담는다. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Readonly<Matrix> = [1, 0, 0, 1, 0, 0];

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
  fill: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  opacity?: number;
  radius?: number;
  sourceType?: string;
  layout?: 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  gap?: number;
  vectorPaths?: Array<{ d: string; fill: string; stroke?: string; strokeWidth?: number }>;
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

export interface DesignDocument { version: 2; name: string; pages: Page[] }

/** 도형을 만들 때의 입력. children과 transform은 생성 함수가 채운다. */
export type NodeInput = Omit<DesignNode, 'children' | 'transform'> & { transform?: Matrix };

const NODE_TYPES: readonly NodeType[] = ['frame', 'group', 'rectangle', 'ellipse', 'text', 'vector'];

/** 자식을 가질 수 있는 도형인지. frame은 내용을 자르고, group은 자식 영역에 맞춰 크기가 정해진다. */
export function isContainer(node: Pick<DesignNode, 'type'>): boolean {
  return node.type === 'frame' || node.type === 'group';
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
  return { version: 2, name: 'Untitled design', pages: [pageFromNodes('page-1', 'Page 1', [
    { id: 'frame-1', type: 'frame', name: 'Landing page', parentId: null, x: 120, y: 95, width: 720, height: 520, fill: '#ffffff' },
    { id: 'rect-1', type: 'rectangle', name: 'Hero panel', parentId: 'frame-1', x: 164, y: 150, width: 632, height: 336, fill: '#e6ebff', radius: 24 },
    { id: 'text-1', type: 'text', name: 'Heading', parentId: 'frame-1', x: 210, y: 218, width: 470, height: 72, fill: '#202c65', text: 'Design starts here', fontSize: 42 },
    { id: 'text-2', type: 'text', name: 'Description', parentId: 'frame-1', x: 210, y: 315, width: 470, height: 48, fill: '#52618a', text: 'Shape ideas into reusable interfaces.', fontSize: 20 },
    { id: 'rect-2', type: 'rectangle', name: 'Button', parentId: 'frame-1', x: 210, y: 392, width: 164, height: 52, fill: '#5369f8', radius: 12 },
    { id: 'text-3', type: 'text', name: 'Button label', parentId: 'frame-1', x: 238, y: 405, width: 110, height: 26, fill: '#ffffff', text: 'Get started', fontSize: 18 }
  ])] };
}

/**
 * 저장된 JSON을 문서로 읽는다. version 1 문서는 version 2로 변환한다.
 * 외부 입력이므로 구조를 모두 검사하고, 어긋나면 원인을 담은 오류를 던진다.
 */
export function parseDocument(raw: string): DesignDocument {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.name !== 'string') throw new Error('Invalid document');
  if (value.version === 1) return migrateV1(value.name, value.nodes);
  if (value.version === 2) return validateV2(value.name, value.pages);
  throw new Error('Unsupported document format');
}

function migrateV1(name: string, nodes: unknown): DesignDocument {
  if (!Array.isArray(nodes)) throw new Error('Unsupported document format');
  for (const node of nodes) checkNodeFields(node);
  // v1은 배열 순서가 곧 그리는 순서였다. 같은 부모 안의 형제 순서를 그대로 보존한다.
  const inputs = nodes.map((node: Record<string, unknown>) => {
    const { children: _children, ...rest } = node;
    void _children;
    return rest as unknown as NodeInput;
  });
  try { return { version: 2, name, pages: [pageFromNodes('page-1', 'Page 1', inputs)] }; }
  catch { throw new Error('Invalid parent'); }
}

function validateV2(name: string, pages: unknown): DesignDocument {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('Unsupported document format');
  const pageIds = new Set<string>();
  for (const page of pages) {
    if (!isRecord(page) || typeof page.id !== 'string' || pageIds.has(page.id) || typeof page.name !== 'string' ||
      !isStringArray(page.children) || !isRecord(page.objects)) throw new Error('Invalid page');
    pageIds.add(page.id);
    checkPageTree(page as unknown as Page);
  }
  return { version: 2, name, pages: pages as Page[] };
}

/** 모든 도형이 정확히 한 곳(최상위 목록 또는 부모의 children)에서 참조되고, 최상위에서 모두 닿을 수 있는지 검사한다. 순환 참조도 여기서 걸러진다. */
function checkPageTree(page: Page): void {
  const entries = Object.entries(page.objects);
  for (const [key, node] of entries) {
    checkNodeFields(node);
    if (node.id !== key || !isMatrix(node.transform)) throw new Error('Invalid node');
    if (isContainer(node as DesignNode) !== isStringArray(node.children)) throw new Error('Invalid node');
    if ((node.hidden !== undefined && typeof node.hidden !== 'boolean') || (node.locked !== undefined && typeof node.locked !== 'boolean')) throw new Error('Invalid node');
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

function checkNodeFields(node: unknown): asserts node is Record<string, unknown> {
  if (!isRecord(node) || typeof node.id !== 'string' || !NODE_TYPES.includes(node.type as NodeType) ||
    typeof node.name !== 'string' || typeof node.fill !== 'string' ||
    !isFiniteNumber(node.x) || !isFiniteNumber(node.y) || !isFiniteNumber(node.width) || !isFiniteNumber(node.height) ||
    node.width <= 0 || node.height <= 0 || (node.parentId !== null && typeof node.parentId !== 'string')) throw new Error('Invalid node');
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
