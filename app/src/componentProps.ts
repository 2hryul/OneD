import { walkPage, type ComponentProp, type DesignDocument, type DesignNode, type Page, type PropRefs } from './model.ts';
import { EMPTY_TRANSACTION, composeTransactions, setComponent, updateShape, type Transaction } from './changes.ts';

/** 속성을 쓰는 도형 자리 → 속성 종류. 글자는 text 속성, 보이기는 boolean 속성이다. */
const FIELD_TYPE = { text: 'text', visible: 'boolean' } as const;
export type PropField = keyof PropRefs;

function findPage(doc: DesignDocument, pageId: string): Page | undefined {
  return doc.pages.find((page) => page.id === pageId);
}

/**
 * 도형의 속성 참조가 어느 컴포넌트 루트(메인 또는 인스턴스)에 속하는지. 자기 자신이 아닌 가장 가까운 조상 루트다.
 * 중첩 인스턴스 루트의 보이기 참조는 바깥 컴포넌트의 속성이므로 자기 자신은 빼고 찾는다.
 */
export function propOwner(page: Page, node: DesignNode): DesignNode | undefined {
  for (let id = node.parentId; id; id = page.objects[id]?.parentId ?? null) {
    const parent = page.objects[id];
    if (parent?.componentId) return parent;
  }
  return undefined;
}

/** 속성 값이 그 속성 종류에 맞는지(글자는 문자열, 보이기는 참·거짓). 외부 입력(편집 칸, 플러그인)을 받을 때 검사한다. */
function validValue(prop: ComponentProp, value: unknown): value is string | boolean {
  return prop.type === 'boolean' ? typeof value === 'boolean' : typeof value === 'string';
}

/** 속성 값을 도형에 쓰는 패치. 글자는 바꾸면서 구간 스타일을 지우고(길이가 달라지면 맞지 않으므로), 보이기는 hidden으로 쓴다. */
function fieldPatch(node: DesignNode, field: PropField, value: string | boolean): Partial<DesignNode> | null {
  if (field === 'text') {
    if (node.type !== 'text' || node.text === value) return null;
    return { text: String(value), spans: undefined };
  }
  const hidden = value === false ? true : undefined;
  return Boolean(node.hidden) === Boolean(hidden) ? null : { hidden };
}

/**
 * 메인 컴포넌트 안 도형으로 새 속성을 만든다(Figma "속성 만들기"). 글자 자리는 텍스트 도형만, 보이기는 메인 루트가 아닌 도형만 된다.
 * 기본값은 지금 도형 값(글자, 보이는지)이다. 인스턴스는 다음 동기화에서 참조를 받아 기본값으로 그려진다.
 *
 * Args:
 *   field: 도형에서 속성이 정할 자리(text 또는 visible)
 *   name: 사람이 보는 속성 이름(빈 문자열 불가)
 *   propId: 새 속성 id(호출하는 쪽이 만든다)
 */
export function addComponentProp(doc: DesignDocument, pageId: string, nodeId: string, field: PropField, name: string, propId: string): Transaction {
  const page = findPage(doc, pageId);
  const node = page?.objects[nodeId];
  if (!page || !node) throw new Error('[addComponentProp] 도형 없음');
  const owner = propOwner(page, node);
  if (!owner?.mainInstance || !owner.componentId) throw new Error('메인 컴포넌트 안의 도형에서만 속성을 만들 수 있습니다.');
  if (field === 'text' && node.type !== 'text') throw new Error('텍스트 속성은 텍스트 도형에서만 만들 수 있습니다.');
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('속성 이름을 입력하세요.');
  const component = doc.components[owner.componentId]!;
  const prop: ComponentProp = { id: propId, name: clean, type: FIELD_TYPE[field], defaultValue: field === 'text' ? node.text ?? '' : !node.hidden };
  return composeTransactions(doc, [
    (current) => setComponent(current, { ...component, props: [...(component.props ?? []), prop] }),
    (current) => updateShape(current, pageId, nodeId, { propRefs: { ...node.propRefs, [field]: propId } })
  ]);
}

/** 메인에서 이 속성을 쓰는 도형들. 기본값을 바꾸면 이 도형들을 함께 바꾼다. */
function mainRefs(doc: DesignDocument, componentId: string, propId: string): Array<{ node: DesignNode; field: PropField; pageId: string }> {
  const component = doc.components[componentId];
  const page = component ? findPage(doc, component.pageId) : undefined;
  if (!component || !page) return [];
  return walkPage(page, [component.mainId]).flatMap((node) => (Object.entries(node.propRefs ?? {}) as Array<[PropField, string]>)
    .filter(([, id]) => id === propId).map(([field]) => ({ node, field, pageId: page.id })));
}

/**
 * 속성 이름·기본값을 바꾼다. 기본값을 바꾸면 메인의 참조 도형도 그 값으로 바꾸고, 값을 정하지 않은 인스턴스는 동기화로 따라온다.
 */
export function updateComponentProp(doc: DesignDocument, componentId: string, propId: string, patch: { name?: string; defaultValue?: string | boolean }): Transaction {
  const component = doc.components[componentId];
  const prop = component?.props?.find((item) => item.id === propId);
  if (!component || !prop) throw new Error('[updateComponentProp] 속성 없음');
  if (patch.defaultValue !== undefined && !validValue(prop, patch.defaultValue)) throw new Error('[updateComponentProp] 속성 종류와 맞지 않는 기본값');
  const name = patch.name === undefined ? prop.name : patch.name.trim().slice(0, 80) || prop.name;
  const next: ComponentProp = { ...prop, name, defaultValue: patch.defaultValue ?? prop.defaultValue };
  return composeTransactions(doc, [
    (current) => setComponent(current, { ...component, props: component.props!.map((item) => (item.id === propId ? next : item)) }),
    ...mainRefs(doc, componentId, propId).map(({ node, field, pageId }) => (current: DesignDocument) => {
      const value = fieldPatch(node, field, next.defaultValue);
      return value ? updateShape(current, pageId, node.id, value) : EMPTY_TRANSACTION;
    })
  ]);
}

/**
 * 속성을 지운다. 메인 도형의 참조와 모든 인스턴스의 값을 지운다. 인스턴스 도형은 동기화로 메인 값(마지막 기본값)을 받는다.
 */
export function removeComponentProp(doc: DesignDocument, componentId: string, propId: string): Transaction {
  const component = doc.components[componentId];
  if (!component?.props?.some((item) => item.id === propId)) return EMPTY_TRANSACTION;
  const steps = [(current: DesignDocument) => setComponent(current, { ...component, props: component.props!.filter((item) => item.id !== propId) })];
  for (const page of doc.pages) {
    for (const node of Object.values(page.objects)) {
      const refs = Object.entries(node.propRefs ?? {}).filter(([, id]) => id !== propId);
      if (node.propRefs && refs.length !== Object.keys(node.propRefs).length) {
        // 인스턴스 도형은 속성이 정하던 값(글자·보이기)을 메인 값으로 되돌린다. 속성이 없어지면 메인을 따라야 하기 때문이다.
        const main = node.shapeRef ? doc.pages.flatMap((item) => [item.objects[node.shapeRef!]]).find(Boolean) : undefined;
        const fields = (Object.entries(node.propRefs) as Array<[PropField, string]>).filter(([, id]) => id === propId).map(([field]) => field);
        const restore: Partial<DesignNode> = {};
        if (main && fields.includes('text')) Object.assign(restore, { text: main.text, spans: main.spans });
        if (main && fields.includes('visible')) restore.hidden = main.hidden;
        steps.push((current) => updateShape(current, page.id, node.id, { propRefs: refs.length ? Object.fromEntries(refs) : undefined, ...restore }));
      }
      if (node.propValues && propId in node.propValues) {
        const { [propId]: _removed, ...rest } = node.propValues;
        steps.push((current) => updateShape(current, page.id, node.id, { propValues: Object.keys(rest).length ? rest : undefined }));
      }
    }
  }
  return composeTransactions(doc, steps);
}

/**
 * 인스턴스의 속성 값을 정한다(undefined면 기본값으로 되돌림). 값은 바로 인스턴스 도형에 적용한다.
 * 입력 검증: 속성 종류와 맞지 않는 값은 거부한다.
 */
export function setInstanceProp(doc: DesignDocument, pageId: string, rootId: string, propId: string, value: string | boolean | undefined): Transaction {
  const page = findPage(doc, pageId);
  const root = page?.objects[rootId];
  const prop = root?.componentId ? doc.components[root.componentId]?.props?.find((item) => item.id === propId) : undefined;
  if (!page || !root || !prop) throw new Error('[setInstanceProp] 인스턴스나 속성 없음');
  if (value !== undefined && !validValue(prop, value)) throw new Error('[setInstanceProp] 속성 종류와 맞지 않는 값');
  const { [propId]: _old, ...others } = root.propValues ?? {};
  const propValues = value === undefined || value === prop.defaultValue ? others : { ...others, [propId]: value };
  return composeTransactions(doc, [
    (current) => updateShape(current, pageId, rootId, { propValues: Object.keys(propValues).length ? propValues : undefined }),
    (current) => applyInstanceProps(current, pageId, rootId)
  ]);
}

/**
 * 인스턴스 하나의 속성 값을 도형에 적용한다. 이 인스턴스에 속한 참조(가장 가까운 조상 루트가 이 인스턴스인 도형)만 바꾼다.
 * 값이 없으면 기본값을 쓴다. 메인 동기화 뒤에 불러 메인 값이 속성 값을 덮지 않게 한다.
 */
export function applyInstanceProps(doc: DesignDocument, pageId: string, rootId: string): Transaction {
  const page = findPage(doc, pageId);
  const root = page?.objects[rootId];
  const props = root?.componentId ? doc.components[root.componentId]?.props : undefined;
  if (!page || !root || !props?.length || root.mainInstance) return EMPTY_TRANSACTION;
  const byId = new Map(props.map((prop) => [prop.id, prop]));
  const steps = walkPage(page, [rootId]).flatMap((node) => {
    if (node.id === rootId || !node.propRefs || propOwner(page, node)?.id !== rootId) return [];
    const patch: Partial<DesignNode> = {};
    for (const [field, propId] of Object.entries(node.propRefs) as Array<[PropField, string]>) {
      const prop = byId.get(propId);
      if (!prop) continue;
      const value = root.propValues?.[propId] ?? prop.defaultValue;
      Object.assign(patch, fieldPatch(node, field, value) ?? {});
    }
    return Object.keys(patch).length ? [(current: DesignDocument) => updateShape(current, pageId, node.id, patch)] : [];
  });
  return composeTransactions(doc, steps);
}

/** 인스턴스(와 그 안의 중첩 인스턴스)의 속성 값을 모두 적용한다. 동기화의 마지막 단계다. */
export function applyAllInstanceProps(doc: DesignDocument, pageId: string, rootId: string): Transaction {
  const page = findPage(doc, pageId);
  if (!page?.objects[rootId]) return EMPTY_TRANSACTION;
  const roots = walkPage(page, [rootId]).filter((node) => node.componentId && !node.mainInstance).map((node) => node.id);
  return composeTransactions(doc, roots.map((id) => (current: DesignDocument) => applyInstanceProps(current, pageId, id)));
}
