import { assertNodeFields, type DesignDocument, type DesignNode, type NodeInput, type Page } from './model';
import { addShape, childrenOf, composeTransactions, topLevelIds, type Transaction } from './changes';

/** 클립보드 내용. 시스템 클립보드에는 이 객체를 JSON으로 싣고 표식으로 알아본다. */
export interface ClipboardData { marker: typeof MARKER; roots: string[]; nodes: DesignNode[] }

const MARKER = 'canvas-studio-clipboard/1';
const MAX_NODES = 50_000;

/**
 * 선택한 도형(하위 포함)을 클립보드 내용으로 만든다. 조상과 자손을 함께 고르면 조상만 루트로 친다.
 * 루트는 그리는 순서대로 담아 붙여 넣을 때 위아래가 유지되게 한다.
 */
export function copyNodes(page: Page, ids: readonly string[]): ClipboardData | null {
  const roots = topLevelIds(page, ids).filter((id) => page.objects[id]);
  if (roots.length === 0) return null;
  const order = (id: string): number => childrenOf(page, page.objects[id]!.parentId).indexOf(id);
  roots.sort((a, b) => order(a) - order(b));
  const nodes: DesignNode[] = [];
  const visit = (id: string): void => {
    const node = page.objects[id];
    if (!node) return;
    nodes.push(structuredClone(node));
    node.children?.forEach(visit);
  };
  roots.forEach(visit);
  return { marker: MARKER, roots, nodes };
}

/**
 * 시스템 클립보드 글을 읽는다. 다른 프로그램의 글이면 null. 밖에서 온 입력이므로 노드마다 저장 형식 검사를 하고,
 * 루트·자식 참조가 내용 안에서 닫혀 있는지 확인한다. 어긋나면 던진다.
 */
export function parseClipboard(text: string): ClipboardData | null {
  if (!text.includes(MARKER)) return null;
  const value = JSON.parse(text) as Partial<ClipboardData>;
  if (value.marker !== MARKER || !Array.isArray(value.roots) || !Array.isArray(value.nodes) || value.nodes.length > MAX_NODES) throw new Error('[parseClipboard] 클립보드 형식이 올바르지 않습니다.');
  const ids = new Set<string>();
  for (const node of value.nodes) { assertNodeFields(node); ids.add(node.id); }
  const children = value.nodes.flatMap((node) => node.children ?? []);
  if (!value.roots.every((id) => ids.has(id)) || !children.every((id) => ids.has(id))) throw new Error('[parseClipboard] 클립보드의 도형 참조가 맞지 않습니다.');
  return value as ClipboardData;
}

export interface PasteOptions {
  /** 붙여 넣을 부모(null이면 페이지 최상위). */
  parentId: string | null;
  /** 이 부모 안에서 넣을 자리. 없으면 맨 위. */
  index?: number;
  dx: number;
  dy: number;
  newId: () => string;
}

/**
 * 클립보드 내용을 새 id로 붙여 넣는 Transaction. 위치는 dx·dy만큼 옮긴다.
 * 메인 컴포넌트를 복사했으면 그 컴포넌트의 인스턴스로 붙인다(Figma와 같음). 문서에 없는 컴포넌트·토큰 연결은 끊는다(다른 문서에서 복사한 경우).
 */
export function pasteNodes(doc: DesignDocument, pageId: string, data: ClipboardData, options: PasteOptions): { tx: Transaction; rootIds: string[] } {
  const ids = new Map(data.nodes.map((node) => [node.id, options.newId()] as const));
  const byId = new Map(data.nodes.map((node) => [node.id, node] as const));
  const rootSet = new Set(data.roots);
  const page = doc.pages.find((item) => item.id === pageId);
  if (!page) throw new Error(`[pasteNodes] 페이지 없음 - ${pageId}`);
  const base = options.index ?? childrenOf(page, options.parentId).length;
  // 루트는 원래 위아래 순서대로 base부터 차례로 넣는다. 자식은 부모 뒤에 순서대로 붙는다(복사가 전위 순회 순서).
  const rootIndex = new Map(data.roots.map((id, order) => [id, base + order] as const));
  const tx = composeTransactions(doc, data.nodes.map((node) => (current: DesignDocument) => {
    const parentId = rootSet.has(node.id) ? options.parentId : ids.get(node.parentId ?? '') ?? options.parentId;
    return addShape(current, pageId, toInput(doc, node, ids, parentId, options, componentContext(byId, node)), rootIndex.get(node.id));
  }));
  return { tx, rootIds: data.roots.map((id) => ids.get(id)!) };
}

type ComponentContext = { kind: 'main' | 'instance'; componentId: string } | { kind: 'none' };

/**
 * 복사한 내용 안에서 이 도형이 메인 컴포넌트 하위인지, 인스턴스 하위인지. 가장 가까운 컴포넌트 루트로 정한다.
 * 인스턴스 안쪽 도형만 따로 복사하면 루트가 없으므로 연결을 끊는다(none).
 */
function componentContext(byId: Map<string, DesignNode>, node: DesignNode): ComponentContext {
  for (let current: DesignNode | undefined = node; current; current = current.parentId ? byId.get(current.parentId) : undefined) {
    if (current.componentId && current.mainInstance) return { kind: 'main', componentId: current.componentId };
    if (current.componentId) return { kind: 'instance', componentId: current.componentId };
  }
  return { kind: 'none' };
}

function toInput(doc: DesignDocument, node: DesignNode, ids: Map<string, string>, parentId: string | null, options: PasteOptions, context: ComponentContext): NodeInput {
  const { children: _children, mainInstance, componentSet: _set, ...rest } = node;
  const input: NodeInput = { ...rest, id: ids.get(node.id)!, parentId, x: node.x + options.dx, y: node.y + options.dy };
  const unlink = (): void => { delete input.componentId; delete input.shapeRef; delete input.touched; };
  if (context.kind === 'main' && doc.components[context.componentId]) {
    // 메인을 복사해 붙이면 그 메인의 인스턴스가 된다. 루트만 componentId를 갖고, 각 도형은 원본(메인 도형)을 가리킨다.
    unlink();
    input.shapeRef = node.id;
    if (mainInstance) input.componentId = context.componentId;
  } else if (context.kind !== 'instance' || !doc.components[context.componentId]) unlink();
  if (input.tokens) {
    const tokens = Object.fromEntries(Object.entries(input.tokens).filter(([, id]) => id && doc.tokens[id]));
    if (Object.keys(tokens).length) input.tokens = tokens; else delete input.tokens;
  }
  return input;
}


/** Ctrl+A: 선택한 도형과 같은 부모의 형제 모두, 선택이 없으면 최상위 모두. 숨긴 도형은 뺀다. */
export function selectAllIds(page: Page, selected: readonly string[]): string[] {
  const parentId = selected.length ? page.objects[selected[0]!]?.parentId ?? null : null;
  return childrenOf(page, parentId).filter((id) => !page.objects[id]?.hidden);
}
