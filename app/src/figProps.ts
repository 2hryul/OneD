import type { FigDocument, FigNode } from 'openfig-core';
import type { Component, NodeInput } from './model.ts';

/**
 * Figma 컴포넌트 속성(component properties) 가져오기.
 * 속성 정의 id는 파일 전체에서 유일하지 않다(복제한 컴포넌트들이 같은 "3:0"을 다른 속성으로 쓴다). 그래서 id는 항상
 * 그 노드를 가진 컴포넌트(세트) 안에서 풀고, 문서 id에는 컴포넌트(세트) id를 앞에 붙인다(`p-<컴포넌트>-<정의>`).
 */

interface Guid { sessionID?: number; localID?: number }
interface FigPropDef { id?: Guid; parentPropDefId?: Guid; name?: string; type?: string; initialValue?: { textValue?: { characters?: string }; boolValue?: boolean } }
export interface FigPropAssignment { defID?: Guid; value?: { textValue?: { characters?: string }; boolValue?: boolean } }
interface FigPropRef { defID?: Guid; componentPropNodeField?: string }

/** 컴포넌트 속성의 범위: 컴포넌트(variant면 세트) id, 그 범위의 텍스트·불리언 정의, variant 자기 id → 세트 정의 id 표. */
export interface PropScope { id: string; defs: Map<string, FigPropDef>; local: Map<string, string> }
/** 문서 속성 id → 값. 텍스트 속성은 text, 불리언 속성은 bool이다. */
export type PropValues = Map<string, { text?: string; bool?: boolean }>;

const guidId = (guid: Guid | undefined): string => `${guid?.sessionID ?? ''}:${guid?.localID ?? ''}`;
const defsOf = (node: FigNode | undefined): FigPropDef[] => (node as unknown as { componentPropDefs?: FigPropDef[] } | undefined)?.componentPropDefs ?? [];

const scopes = new WeakMap<FigNode, PropScope>();

/**
 * 컴포넌트(SYMBOL)의 속성 범위. variant 세트 안이면 세트의 정의를 쓰고, variant가 가진 자기 id(parentPropDefId로 세트 정의를 가리킴)를 세트 정의 id로 바꾸는 표를 만든다.
 */
export function scopeOf(fig: FigDocument, symbol: FigNode | undefined): PropScope | undefined {
  if (!symbol) return undefined;
  const cached = scopes.get(symbol);
  if (cached) return cached;
  const parentGuid = symbol.parentIndex?.guid as Guid | undefined;
  const parent = parentGuid ? fig.nodeMap.get(guidId(parentGuid)) : undefined;
  const set = parent?.isStateGroup ? parent : undefined;
  const scope: PropScope = { id: guidId((set ?? symbol).guid as Guid), defs: new Map(), local: new Map() };
  for (const def of [...defsOf(set), ...defsOf(symbol)]) {
    if (!def.id) continue;
    if (def.parentPropDefId) scope.local.set(guidId(def.id), guidId(def.parentPropDefId));
    else if (def.type === 'TEXT' || def.type === 'BOOL') scope.defs.set(guidId(def.id), def);
  }
  scopes.set(symbol, scope);
  return scope;
}

/** 범위 안의 정의 id를 문서 속성 id로. 범위에 없는 정의(다른 컴포넌트에서 복사돼 남은 참조 등)면 undefined다. */
export function docPropId(scope: PropScope | undefined, defId: Guid | undefined): string | undefined {
  if (!scope || !defId) return undefined;
  const raw = guidId(defId);
  const canonical = scope.local.get(raw) ?? raw;
  return scope.defs.has(canonical) ? `p-${scope.id}-${canonical}` : undefined;
}

/** 컴포넌트 등록 정보의 속성 목록. 기본값은 정의의 초기값이다. */
export function componentPropsOf(scope: PropScope | undefined): { props?: Component['props'] } {
  if (!scope?.defs.size) return {};
  const props = [...scope.defs].map(([id, def]) => def.type === 'TEXT'
    ? { id: `p-${scope.id}-${id}`, name: def.name || 'text', type: 'text' as const, defaultValue: def.initialValue?.textValue?.characters ?? '' }
    : { id: `p-${scope.id}-${id}`, name: def.name || 'boolean', type: 'boolean' as const, defaultValue: def.initialValue?.boolValue ?? true });
  return { props };
}

/** 노드의 속성 참조를 문서 형식으로. 글자(TEXT_DATA)와 보이기(VISIBLE)만 옮긴다. scope는 이 노드를 가진 컴포넌트의 범위다. */
export function nodePropRefs(scope: PropScope | undefined, node: FigNode): { propRefs?: NonNullable<NodeInput['propRefs']> } {
  const result: NonNullable<NodeInput['propRefs']> = {};
  for (const ref of (node as unknown as { componentPropRefs?: FigPropRef[] }).componentPropRefs ?? []) {
    const id = docPropId(scope, ref.defID);
    if (!id) continue;
    if (ref.componentPropNodeField === 'TEXT_DATA') result.text = id;
    if (ref.componentPropNodeField === 'VISIBLE') result.visible = id;
  }
  return Object.keys(result).length ? { propRefs: result } : {};
}

/**
 * 인스턴스의 속성 값을 모은다. 바깥에서 물려받은 값(inherited) 위에 이 인스턴스의 값과 override로 들어온 값을 차례로 덮는다.
 * 키는 인스턴스가 쓰는 컴포넌트 범위의 문서 속성 id라 다른 컴포넌트의 같은 정의 id와 섞이지 않는다.
 */
export function collectProps(inherited: PropValues | undefined, scope: PropScope | undefined, lists: ReadonlyArray<FigPropAssignment[] | undefined>): PropValues {
  const props: PropValues = new Map(inherited);
  for (const list of lists) for (const item of list ?? []) {
    const id = docPropId(scope, item.defID);
    if (!id || !item.value) continue;
    const text = item.value.textValue?.characters;
    props.set(id, text !== undefined ? { text } : { bool: item.value.boolValue });
  }
  return props;
}

/** 인스턴스 루트에 남길 속성 값. 이 인스턴스가 정한 값 중 기본값과 다른 것만 남긴다(편집기에서 고칠 수 있게). */
export function instanceValues(scope: PropScope | undefined, own: PropValues): Record<string, string | boolean> | undefined {
  if (!scope) return undefined;
  const values: Record<string, string | boolean> = {};
  for (const [id, def] of scope.defs) {
    const key = `p-${scope.id}-${id}`;
    const value = own.get(key);
    const mine = def.type === 'TEXT' ? value?.text : value?.bool;
    const initial = def.type === 'TEXT' ? def.initialValue?.textValue?.characters : def.initialValue?.boolValue;
    if (mine !== undefined && mine !== initial) values[key] = mine;
  }
  return Object.keys(values).length ? values : undefined;
}

/**
 * 노드가 참조하는 속성 값을 적용한 노드. TEXT_DATA는 글자, VISIBLE은 보이기다. 글자가 바뀌면 글자별 스타일 표는 길이가 맞을 때만 남긴다.
 * 인스턴스 교체 참조가 있으면 onSwap으로 알린다(아직 지원하지 않음).
 */
export function applyProps(node: FigNode, scope: PropScope | undefined, props: PropValues | undefined, onSwap: () => void): FigNode {
  const refs = (node as unknown as { componentPropRefs?: FigPropRef[] }).componentPropRefs;
  if (!refs?.length) return node;
  let next = node;
  for (const ref of refs) {
    if (ref.componentPropNodeField === 'OVERRIDDEN_SYMBOL_ID') { onSwap(); continue; }
    const id = docPropId(scope, ref.defID);
    const value = id ? props?.get(id) : undefined;
    if (!value) continue;
    if (ref.componentPropNodeField === 'TEXT_DATA' && value.text !== undefined) {
      const textData = (next.textData ?? {}) as { characters?: string; characterStyleIDs?: number[] };
      const keepStyles = (textData.characterStyleIDs?.length ?? 0) === value.text.length;
      next = { ...next, textData: { ...textData, characters: value.text, ...(keepStyles ? {} : { characterStyleIDs: [] }) } } as FigNode;
    } else if (ref.componentPropNodeField === 'VISIBLE' && value.bool !== undefined) {
      next = { ...next, visible: value.bool };
    }
  }
  return next;
}
