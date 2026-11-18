import { assertNodeFields, walkPage, type DesignDocument, type DesignNode, type NodeType } from './model';
import { EMPTY_TRANSACTION, addShape, composeTransactions, deleteShapes, resizeShape, updateShape, type Transaction } from './changes';

/** 플러그인 권한. read는 문서·선택 읽기, write는 도형 만들기·고치기·지우기·선택 바꾸기. */
export type PluginPermission = 'read' | 'write';

/** 설치한 플러그인. 코드는 이 브라우저에만 저장하고 격리된 iframe에서만 실행한다. */
export interface PluginInfo { id: string; name: string; code: string; permissions: PluginPermission[] }

/** 편집기가 플러그인 호출에 내주는 기능. 쓰기는 모두 edit를 거쳐 undo·공동 편집에 들어간다. */
export interface PluginHost {
  doc: () => DesignDocument;
  pageId: () => string;
  selection: () => string[];
  edit: (build: (doc: DesignDocument) => Transaction) => boolean;
  select: (ids: string[]) => void;
  notify: (message: string) => void;
  newId: () => string;
}

/** 플러그인에 돌려줄 오류. 메시지는 플러그인 개발자가 읽는 문장이다. */
export class PluginError extends Error {}

const WRITABLE_TYPES: readonly NodeType[] = ['frame', 'rectangle', 'ellipse', 'text'];
/** 플러그인이 고칠 수 있는 속성. 계층·컴포넌트·토큰 연결처럼 일관성이 얽힌 속성은 막는다. */
const PATCH_KEYS = new Set(['name', 'x', 'y', 'width', 'height', 'fills', 'strokes', 'effects', 'opacity', 'radius', 'text', 'fontSize', 'fontWeight', 'fontFamily', 'textAlign', 'verticalAlign', 'lineHeight', 'letterSpacing', 'hidden', 'locked']);
const GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height']);
const READ_METHODS = new Set(['getDocumentInfo', 'getPage', 'getNode', 'getSelection', 'findNodes']);
const WRITE_METHODS = new Set(['createShape', 'updateShape', 'deleteShapes', 'select']);
const MAX_RESULTS = 5000;

/** 플러그인 머리말의 이름·권한을 읽는다. 예: `// @name 레이어 정리` `// @permissions read, write` */
export function readManifest(code: string, fallbackName: string): { name: string; permissions: PluginPermission[] } {
  const name = /^\s*\/\/\s*@name\s+(.+)$/m.exec(code)?.[1]?.trim().slice(0, 60) || fallbackName;
  const declared = /^\s*\/\/\s*@permissions\s+(.+)$/m.exec(code)?.[1] ?? 'read';
  const permissions = (['read', 'write'] as const).filter((permission) => declared.split(/[\s,]+/).includes(permission));
  return { name, permissions: permissions.length ? permissions : ['read'] };
}

function page(host: PluginHost) {
  const found = host.doc().pages.find((item) => item.id === host.pageId());
  if (!found) throw new PluginError('현재 페이지를 찾을 수 없습니다.');
  return found;
}

/** 플러그인에 넘기는 노드 복사본. 구조화 복제가 되는 순수 데이터다. */
function copy(node: DesignNode): DesignNode {
  return JSON.parse(JSON.stringify(node)) as DesignNode;
}

function nodeOf(host: PluginHost, id: unknown): DesignNode {
  const node = typeof id === 'string' ? page(host).objects[id] : undefined;
  if (!node) throw new PluginError(`도형을 찾을 수 없습니다: ${String(id)}`);
  return node;
}

/**
 * 플러그인 호출 하나를 처리한다. 권한 밖의 메서드, 형식이 틀린 인자, 저장 형식에 맞지 않는 결과는 PluginError로 거절한다.
 * @param permissions 사용자가 허용한 권한
 */
export function handlePluginCall(host: PluginHost, method: unknown, args: unknown, permissions: readonly PluginPermission[]): unknown {
  if (typeof method !== 'string' || !(READ_METHODS.has(method) || WRITE_METHODS.has(method) || method === 'notify')) throw new PluginError(`알 수 없는 메서드: ${String(method)}`);
  if (READ_METHODS.has(method) && !permissions.includes('read')) throw new PluginError('읽기 권한이 없습니다.');
  if (WRITE_METHODS.has(method) && !permissions.includes('write')) throw new PluginError('쓰기 권한이 없습니다.');
  const list = Array.isArray(args) ? args : [];
  switch (method) {
    case 'getDocumentInfo': { const doc = host.doc(); return { name: doc.name, pageId: host.pageId(), pages: doc.pages.map((item) => ({ id: item.id, name: item.name })) }; }
    case 'getPage': { const current = page(host); return { id: current.id, name: current.name, children: [...current.children] }; }
    case 'getNode': return copy(nodeOf(host, list[0]));
    case 'getSelection': return host.selection().map((id) => page(host).objects[id]).filter((node): node is DesignNode => Boolean(node)).map(copy);
    case 'findNodes': return findNodes(host, list[0]);
    case 'createShape': return createShape(host, list[0]);
    case 'updateShape': updateNode(host, list[0], list[1]); return true;
    case 'deleteShapes': return deleteNodes(host, list[0]);
    case 'select': return selectNodes(host, list[0]);
    case 'notify': host.notify(`플러그인: ${String(list[0]).slice(0, 200)}`); return true;
  }
  return undefined;
}

function findNodes(host: PluginHost, query: unknown): DesignNode[] {
  const { type, name } = (typeof query === 'object' && query !== null ? query : {}) as { type?: unknown; name?: unknown };
  const needle = typeof name === 'string' ? name.toLowerCase() : null;
  return walkPage(page(host)).filter((node) => (type === undefined || node.type === type) && (needle === null || node.name.toLowerCase().includes(needle))).slice(0, MAX_RESULTS).map(copy);
}

/** 새 도형. 위치·크기·채우기 등은 저장 형식 검사를 통과해야 한다. parentId가 있으면 그 컨테이너 안에 넣는다. */
function createShape(host: PluginHost, input: unknown): string {
  if (typeof input !== 'object' || input === null) throw new PluginError('createShape에는 도형 정보 객체가 필요합니다.');
  const record = input as Record<string, unknown>;
  if (!WRITABLE_TYPES.includes(record.type as NodeType)) throw new PluginError(`만들 수 있는 종류는 ${WRITABLE_TYPES.join(', ')}입니다.`);
  const unknownKeys = Object.keys(record).filter((key) => key !== 'type' && key !== 'parentId' && !PATCH_KEYS.has(key));
  if (unknownKeys.length) throw new PluginError(`쓸 수 없는 속성: ${unknownKeys.join(', ')}`);
  const id = host.newId();
  const shape = { name: String(record.type), x: 0, y: 0, width: 100, height: 100, fills: [], ...record, id, parentId: record.parentId ?? null, ...(record.type === 'frame' ? { children: [] } : {}), transform: [1, 0, 0, 1, 0, 0] };
  validate(shape);
  const { children: _children, transform: _transform, ...nodeInput } = shape as unknown as DesignNode;
  if (!host.edit((doc) => addShape(doc, host.pageId(), nodeInput))) throw new PluginError('도형을 만들지 못했습니다(부모가 없거나 컨테이너가 아님).');
  return id;
}

function validate(node: unknown): void {
  try { assertNodeFields(node); }
  catch (error) { throw new PluginError(`도형 값이 올바르지 않습니다: ${error instanceof Error ? error.message : String(error)}`); }
}

/** 속성 고치기. 위치·크기는 크기 바꾸기 규칙(그룹·프레임 자식 따라감)으로, 나머지는 그대로 바꾼다. 한 번이 undo 한 단계다. */
function updateNode(host: PluginHost, id: unknown, patchInput: unknown): void {
  const node = nodeOf(host, id);
  if (typeof patchInput !== 'object' || patchInput === null) throw new PluginError('updateShape에는 바꿀 속성 객체가 필요합니다.');
  const patch = patchInput as Record<string, unknown>;
  const unknownKeys = Object.keys(patch).filter((key) => !PATCH_KEYS.has(key));
  if (unknownKeys.length) throw new PluginError(`쓸 수 없는 속성: ${unknownKeys.join(', ')}`);
  validate({ ...node, ...patch });
  const geometry = Object.fromEntries(Object.entries(patch).filter(([key]) => GEOMETRY_KEYS.has(key))) as Partial<Record<'x' | 'y' | 'width' | 'height', number>>;
  const rest = Object.fromEntries(Object.entries(patch).filter(([key]) => !GEOMETRY_KEYS.has(key))) as Partial<DesignNode>;
  const box = { x: geometry.x ?? node.x, y: geometry.y ?? node.y, width: geometry.width ?? node.width, height: geometry.height ?? node.height };
  const ok = host.edit((doc) => composeTransactions(doc, [
    (next) => Object.keys(geometry).length ? resizeShape(next, host.pageId(), node.id, box) : EMPTY_TRANSACTION,
    (next) => Object.keys(rest).length ? updateShape(next, host.pageId(), node.id, rest) : EMPTY_TRANSACTION
  ]));
  if (!ok) throw new PluginError('도형을 고치지 못했습니다.');
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string') || value.length > MAX_RESULTS) throw new PluginError('id 목록(문자열 배열)이 필요합니다.');
  return value;
}

function deleteNodes(host: PluginHost, value: unknown): number {
  const ids = idList(value).filter((id) => page(host).objects[id]);
  if (ids.length && !host.edit((doc) => deleteShapes(doc, host.pageId(), ids))) throw new PluginError('도형을 지우지 못했습니다.');
  return ids.length;
}

function selectNodes(host: PluginHost, value: unknown): number {
  const ids = idList(value).filter((id) => page(host).objects[id]);
  host.select(ids);
  return ids.length;
}
