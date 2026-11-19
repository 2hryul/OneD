import type { FigDocument, FigNode } from 'openfig-core';
import type { Token, TokenSlot } from './model.ts';

/** 변수 묶음 id(같은 파일이면 guid, 라이브러리면 key) → 고른 모드 id. 조상의 variableModeBySetMap이 정한다. */
export type ModeMap = Map<string, string>;

interface Guid { sessionID?: number; localID?: number }
interface VariableRef { guid?: Guid; assetRef?: { key?: string } }
interface VariableValue { alias?: VariableRef; colorValue?: { r: number; g: number; b: number; a?: number }; floatValue?: number }
interface VariableEntry { modeID?: Guid; variableData?: { value?: VariableValue } }

/** 파일의 변수를 guid·key로 찾는 표. */
export interface VariableIndex { byGuid: Map<string, FigNode>; byKey: Map<string, FigNode> }

const guidId = (guid: Guid | undefined): string => `${guid?.sessionID ?? ''}:${guid?.localID ?? ''}`;
const raw = (node: FigNode): Record<string, unknown> => node as unknown as Record<string, unknown>;

export function variableIndex(fig: FigDocument): VariableIndex {
  const index: VariableIndex = { byGuid: new Map(), byKey: new Map() };
  for (const node of fig.nodes) {
    if (node.type !== 'VARIABLE') continue;
    index.byGuid.set(guidId(node.guid as Guid), node);
    const key = raw(node).key;
    if (typeof key === 'string') index.byKey.set(key, node);
  }
  return index;
}

/** 변수 참조(같은 파일 guid 또는 라이브러리 key)를 변수 노드로. */
export function findVariable(index: VariableIndex, ref: VariableRef | undefined): FigNode | undefined {
  if (ref?.guid) return index.byGuid.get(guidId(ref.guid));
  if (ref?.assetRef?.key) return index.byKey.get(ref.assetRef.key);
  return undefined;
}

/** 변수 묶음의 id. 같은 파일 묶음은 guid, 라이브러리 묶음은 key다. */
function setIdOf(variable: FigNode): string {
  const ref = raw(variable).variableSetID as VariableRef | undefined;
  return ref?.guid ? guidId(ref.guid) : ref?.assetRef?.key ?? '';
}

/** 노드가 고른 모드를 물려받은 모드 위에 덮는다(Figma: 프레임의 변수 모드 설정). */
export function withModes(inherited: ModeMap | undefined, node: FigNode): ModeMap | undefined {
  const entries = (raw(node).variableModeBySetMap as { entries?: Array<{ variableSetID?: VariableRef; variableModeID?: Guid }> } | undefined)?.entries;
  if (!entries?.length) return inherited;
  const modes: ModeMap = new Map(inherited);
  for (const entry of entries) {
    const setId = entry.variableSetID?.guid ? guidId(entry.variableSetID.guid) : entry.variableSetID?.assetRef?.key;
    if (setId && entry.variableModeID) modes.set(setId, guidId(entry.variableModeID));
  }
  return modes;
}

/** 루트 노드의 조상(페이지까지)이 고른 모드. 위에서 아래로 덮는다. */
export function ancestorModes(fig: FigDocument, node: FigNode): ModeMap | undefined {
  const chain: FigNode[] = [];
  for (let current = node.parentIndex?.guid ? fig.nodeMap.get(guidId(node.parentIndex.guid as Guid)) : undefined; current && chain.length < 64; current = current.parentIndex?.guid ? fig.nodeMap.get(guidId(current.parentIndex.guid as Guid)) : undefined) chain.unshift(current);
  return chain.reduce<ModeMap | undefined>((modes, item) => withModes(modes, item), undefined);
}

/** 색 값을 #rrggbb(투명도가 있으면 #rrggbbaa)로. */
function hex(color: { r: number; g: number; b: number; a?: number }): string {
  const part = (value: number): string => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  const alpha = color.a ?? 1;
  return `#${part(color.r)}${part(color.g)}${part(color.b)}${alpha < 1 ? part(alpha) : ''}`;
}

/**
 * 변수 값을 고른 모드로 푼다. 별칭이면 가리키는 변수를 같은 모드 표로 다시 푼다(최대 16단계, 순환 방지).
 * 모드가 정해지지 않은 묶음은 첫 모드(기본 모드)를 쓴다.
 *
 * Returns: 색은 hex 문자열, 숫자는 number. 풀 수 없으면 null.
 */
export function resolveVariable(index: VariableIndex, variable: FigNode, modes: ModeMap | undefined, depth = 0): { type: 'color' | 'number'; value: string | number } | null {
  if (depth > 16) return null;
  const entries = (raw(variable).variableDataValues as { entries?: VariableEntry[] } | undefined)?.entries ?? [];
  const mode = modes?.get(setIdOf(variable));
  const entry = entries.find((item) => mode && guidId(item.modeID) === mode) ?? entries[0];
  const value = entry?.variableData?.value;
  if (!value) return null;
  if (value.alias) {
    const target = findVariable(index, value.alias);
    return target ? resolveVariable(index, target, modes, depth + 1) : null;
  }
  if (value.colorValue) return { type: 'color', value: hex(value.colorValue) };
  if (typeof value.floatValue === 'number' && Number.isFinite(value.floatValue)) return { type: 'number', value: value.floatValue };
  return null;
}

/** 이 가져오기에서 쓰는 Figma 필드 → 토큰 자리. 네 모서리 반경은 모두 같은 변수일 때만 반경 토큰이 된다. */
const FIELD_SLOT: Record<string, TokenSlot> = { STACK_SPACING: 'gap', FONT_SIZE: 'fontSize' };
const CORNERS = ['RECTANGLE_TOP_LEFT_CORNER_RADIUS', 'RECTANGLE_TOP_RIGHT_CORNER_RADIUS', 'RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS', 'RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS'];

/**
 * 노드가 연결한 변수를 토큰 자리별로. 채우기·선은 보이는 첫 단색 칠의 colorVar, 간격·글자 크기는 variableConsumptionMap,
 * 반경은 네 모서리가 같은 변수를 가리킬 때다.
 */
export function boundVariables(index: VariableIndex, node: FigNode): Partial<Record<TokenSlot, FigNode>> {
  const result: Partial<Record<TokenSlot, FigNode>> = {};
  const paintVar = (paints: unknown): FigNode | undefined => {
    const paint = (paints as Array<{ type?: string; visible?: boolean; colorVar?: { value?: { alias?: VariableRef } } }> | undefined)?.find((item) => item.type === 'SOLID' && item.visible !== false);
    return findVariable(index, paint?.colorVar?.value?.alias);
  };
  const fill = paintVar(node.fillPaints);
  const stroke = paintVar(node.strokePaints);
  if (fill) result.fill = fill;
  if (stroke) result.stroke = stroke;
  const entries = (raw(node).variableConsumptionMap as { entries?: Array<{ variableField?: string; variableData?: { value?: VariableValue } }> } | undefined)?.entries ?? [];
  const byField = new Map(entries.map((entry) => [entry.variableField ?? '', findVariable(index, entry.variableData?.value?.alias)]));
  for (const [field, slot] of Object.entries(FIELD_SLOT)) { const variable = byField.get(field); if (variable) result[slot] = variable; }
  const corners = CORNERS.map((field) => byField.get(field));
  if (corners[0] && corners.every((variable) => variable === corners[0])) result.radius = corners[0];
  return result;
}

/** 변수에서 만든 토큰 id. 라이브러리 변수는 key, 같은 파일 변수는 guid로 만든다. */
export function variableTokenId(variable: FigNode): string {
  const key = raw(variable).key;
  return `var-${typeof key === 'string' ? key : guidId(variable.guid as Guid)}`;
}

/** 변수 → 토큰(이 모드의 값). 이름은 Figma 변수 이름("Spacing/4", "background")을 그대로 쓴다. */
export function variableToken(index: VariableIndex, variable: FigNode, modes: ModeMap | undefined): Token | null {
  const resolved = resolveVariable(index, variable, modes);
  return resolved ? { id: variableTokenId(variable), name: variable.name || 'variable', type: resolved.type, value: resolved.value } : null;
}

/**
 * 칠 목록의 단색 중 변수에 연결된 것을 지금 모드의 값으로 바꾼다.
 * 파일에 저장된 칠 색은 다른 모드(예: 메인 컴포넌트의 다크 모드)에서 계산된 값일 수 있어, 라이트 모드 화면이 어둡게 나오는 것을 막는다.
 */
export function withVariableColors<T extends { type?: string; color?: { r: number; g: number; b: number; a?: number }; colorVar?: { value?: { alias?: VariableRef } } }>(index: VariableIndex, paints: readonly T[] | undefined, modes: ModeMap | undefined): T[] | undefined {
  if (!paints?.some((paint) => paint.colorVar)) return paints as T[] | undefined;
  return paints.map((paint) => {
    const variable = paint.type === 'SOLID' ? findVariable(index, paint.colorVar?.value?.alias) : undefined;
    const resolved = variable ? resolveVariable(index, variable, modes) : null;
    if (resolved?.type !== 'color') return paint;
    const hexValue = String(resolved.value);
    const channel = (start: number): number => parseInt(hexValue.slice(start, start + 2), 16) / 255;
    return { ...paint, color: { r: channel(1), g: channel(3), b: channel(5), a: hexValue.length > 7 ? channel(7) : 1 } };
  });
}
