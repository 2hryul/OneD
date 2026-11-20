import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import type { FigDocument, FigNode } from 'openfig-core';
import { parseDocument, solid, walkPage, type DesignDocument, type NodeInput } from '../src/model';
import { addShape, applyChanges, updateShape, type Transaction } from '../src/changes';
import { createComponent, createInstance } from '../src/components';
import { addComponentProp, removeComponentProp, setInstanceProp, updateComponentProp } from '../src/componentProps';
import { normalizeAfterEdit } from '../src/normalize';
import { exportTsx } from '../src/export';
import { importFigNode } from '../src/figmaImport';

const PAGE = 'page-1';
const commit = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, normalizeAfterEdit(doc, tx).redo);
const obj = (doc: DesignDocument, id: string) => doc.pages[0]!.objects[id]!;

/** 카드 컴포넌트(제목 글자 + 배지)와 그 인스턴스 하나. */
function cardDoc(): { doc: DesignDocument; instance: string } {
  let doc: DesignDocument = { version: 5, name: 'Props', components: {}, tokens: {}, pages: [{ id: PAGE, name: 'Page 1', children: [], objects: {} }] };
  const add = (shape: NodeInput): void => { doc = applyChanges(doc, addShape(doc, PAGE, shape).redo); };
  add({ id: 'card', type: 'frame', name: 'Card', parentId: null, x: 0, y: 0, width: 200, height: 80, fills: solid('#ffffff') });
  add({ id: 'title', type: 'text', name: 'Title', parentId: 'card', x: 10, y: 10, width: 180, height: 24, fills: solid('#111111'), text: 'Hello', fontSize: 16 });
  add({ id: 'badge', type: 'rectangle', name: 'Badge', parentId: 'card', x: 10, y: 50, width: 40, height: 20, fills: solid('#ff0000') });
  doc = applyChanges(doc, createComponent(doc, PAGE, 'card', 'c-card').redo);
  let next = 0;
  const created = createInstance(doc, PAGE, 'c-card', { parentId: null, x: 300, y: 0 }, () => `i${next++}`);
  doc = applyChanges(doc, created.tx.redo);
  return { doc, instance: created.rootId };
}
const inInstance = (doc: DesignDocument, rootId: string, mainId: string) => walkPage(doc.pages[0]!, [rootId]).find((node) => node.shapeRef === mainId)!;

describe('component properties', () => {
  it('turns a main text into a text property that instances can set and reset', () => {
    let { doc, instance } = cardDoc();
    doc = commit(doc, addComponentProp(doc, PAGE, 'title', 'text', 'Title', 'p-title'));
    expect(doc.components['c-card']!.props).toEqual([{ id: 'p-title', name: 'Title', type: 'text', defaultValue: 'Hello' }]);
    expect(inInstance(doc, instance, 'title').propRefs).toEqual({ text: 'p-title' });
    doc = commit(doc, setInstanceProp(doc, PAGE, instance, 'p-title', 'Sale'));
    expect(inInstance(doc, instance, 'title').text).toBe('Sale');
    expect(obj(doc, instance).propValues).toEqual({ 'p-title': 'Sale' });
    // 메인을 고쳐 동기화가 돌아도 속성 값은 덮이지 않는다.
    doc = commit(doc, updateShape(doc, PAGE, 'title', { fontSize: 20 }));
    expect(inInstance(doc, instance, 'title')).toMatchObject({ text: 'Sale', fontSize: 20 });
    doc = commit(doc, setInstanceProp(doc, PAGE, instance, 'p-title', undefined));
    expect(inInstance(doc, instance, 'title').text).toBe('Hello');
    expect(obj(doc, instance).propValues).toBeUndefined();
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });

  it('changes the default in the main and every instance that keeps the default', () => {
    let { doc, instance } = cardDoc();
    doc = commit(doc, addComponentProp(doc, PAGE, 'title', 'text', 'Title', 'p-title'));
    doc = commit(doc, updateComponentProp(doc, 'c-card', 'p-title', { name: 'Heading', defaultValue: 'Welcome' }));
    expect(obj(doc, 'title').text).toBe('Welcome');
    expect(inInstance(doc, instance, 'title').text).toBe('Welcome');
    expect(doc.components['c-card']!.props![0]!.name).toBe('Heading');
  });

  it('shows and hides a layer with a boolean property and removes the property cleanly', () => {
    let { doc, instance } = cardDoc();
    const before = doc;
    const tx = normalizeAfterEdit(doc, addComponentProp(doc, PAGE, 'badge', 'visible', 'Show badge', 'p-badge'));
    doc = applyChanges(doc, tx.redo);
    doc = commit(doc, setInstanceProp(doc, PAGE, instance, 'p-badge', false));
    expect(inInstance(doc, instance, 'badge').hidden).toBe(true);
    expect(obj(doc, 'badge').hidden).toBeUndefined();
    doc = commit(doc, removeComponentProp(doc, 'c-card', 'p-badge'));
    expect(doc.components['c-card']!.props).toEqual([]);
    expect(obj(doc, instance).propValues).toBeUndefined();
    expect(inInstance(doc, instance, 'badge').hidden).toBeUndefined();
    expect(applyChanges(applyChanges(before, tx.redo), tx.undo)).toEqual(before);
  });

  it('rejects properties outside a main, values of the wrong type and broken saved data', () => {
    const { doc, instance } = cardDoc();
    expect(() => addComponentProp(doc, PAGE, 'badge', 'text', 'x', 'p')).toThrow(/텍스트 도형/);
    expect(() => addComponentProp(doc, PAGE, inInstance(doc, instance, 'title').id, 'text', 'x', 'p')).toThrow(/메인 컴포넌트 안/);
    expect(() => addComponentProp(doc, PAGE, 'title', 'text', '   ', 'p')).toThrow(/이름/);
    const withProp = commit(doc, addComponentProp(doc, PAGE, 'title', 'text', 'Title', 'p-title'));
    expect(() => setInstanceProp(withProp, PAGE, instance, 'p-title', true)).toThrow(/종류/);
    const broken = structuredClone(withProp);
    broken.components['c-card']!.props = [{ id: 'p', name: 'x', type: 'boolean', defaultValue: 'yes' as never }];
    expect(() => parseDocument(JSON.stringify(broken))).toThrow(/props/);
  });

  it('exports text properties as string props and boolean properties as conditional rendering', () => {
    let { doc, instance } = cardDoc();
    doc = commit(doc, addComponentProp(doc, PAGE, 'title', 'text', 'Title', 'p-title'));
    doc = commit(doc, addComponentProp(doc, PAGE, 'badge', 'visible', 'Show badge', 'p-badge'));
    doc = commit(doc, setInstanceProp(doc, PAGE, instance, 'p-title', 'Sale'));
    doc = commit(doc, setInstanceProp(doc, PAGE, instance, 'p-badge', false));
    let frameDoc = doc;
    frameDoc = applyChanges(frameDoc, addShape(frameDoc, PAGE, { id: 'screen', type: 'frame', name: 'Screen', parentId: null, x: 0, y: 200, width: 600, height: 200, fills: [] }).redo);
    const main = exportTsx(frameDoc, PAGE, 'card').code;
    expect(main).toMatch(/title\?: string;\n {2}showBadge\?: boolean;/);
    expect(main).toContain('{title ?? "Hello"}');
    expect(main).toMatch(/\{\(showBadge \?\? true\) && \(\n\s*<div className="card__badge" \/>\n\s*\)\}/);
    transformSync(main, { loader: 'tsx', jsx: 'automatic' });
    const usage = exportTsx(doc, PAGE, instance).code;
    expect(usage).toContain('export function Card');
  });
});

/** 가짜 Figma 노드. */
const f = (localID: number, type: string, name: string, patch: Record<string, unknown> = {}): FigNode => ({ guid: { sessionID: 1, localID }, type, name, size: { x: 100, y: 40 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, ...patch }) as unknown as FigNode;
const figOf = (nodes: FigNode[], children: Record<string, FigNode[]>): FigDocument => ({ nodes, nodeMap: new Map(nodes.map((node) => [`${(node.guid as { sessionID: number }).sessionID}:${(node.guid as { localID: number }).localID}`, node])), childrenMap: new Map(Object.entries(children)), images: new Map() }) as unknown as FigDocument;
const g = (localID: number) => ({ sessionID: 9, localID });

describe('Figma component properties and variables import', () => {
  it('maps set property definitions, variant-local reference ids and instance values to one property', () => {
    const set = f(1, 'FRAME', 'Button', { isStateGroup: true, componentPropDefs: [{ id: g(7), name: 'label', type: 'TEXT', initialValue: { textValue: { characters: 'Button' } } }, { id: g(8), name: 'state', type: 'VARIANT' }] });
    const variant = f(2, 'SYMBOL', 'state=default', { parentIndex: { guid: { sessionID: 1, localID: 1 }, position: '!' }, componentPropDefs: [{ id: g(12), parentPropDefId: g(7) }] });
    const label = f(3, 'TEXT', 'Label', { textData: { characters: 'Button' }, componentPropRefs: [{ defID: g(12), componentPropNodeField: 'TEXT_DATA' }] });
    const page = f(10, 'FRAME', 'Page', { size: { x: 300, y: 100 } });
    const instance = f(11, 'INSTANCE', 'Button', { symbolData: { symbolID: { sessionID: 1, localID: 2 }, symbolOverrides: [] }, componentPropAssignments: [{ defID: g(12), value: { textValue: { characters: 'Save' } } }] });
    const { document } = importFigNode(figOf([set, variant, label, page, instance], { '1:1': [variant], '1:2': [label], '1:10': [instance] }), '1:10');
    expect(document.components['1:2']!.props).toEqual([{ id: 'p-1:1-9:7', name: 'label', type: 'text', defaultValue: 'Button' }]);
    const root = walkPage(document.pages[0]!).find((node) => node.name === 'Button')!;
    expect(root.propValues).toEqual({ 'p-1:1-9:7': 'Save' });
    expect(walkPage(document.pages[0]!, [root.id]).find((node) => node.type === 'text')).toMatchObject({ text: 'Save', propRefs: { text: 'p-1:1-9:7' } });
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
  });

  it('reads the same definition id per component, because copied components reuse ids for different properties', () => {
    // 두 컴포넌트가 같은 정의 id 9:0을 서로 다른 속성으로 쓴다. 바깥 카드의 값이 안쪽 배지 글자로 새면 안 된다.
    const badge = f(1, 'SYMBOL', 'Badge', { componentPropDefs: [{ id: g(0), name: 'text', type: 'TEXT', initialValue: { textValue: { characters: 'New' } } }] });
    const badgeText = f(2, 'TEXT', 'Text', { textData: { characters: 'New' }, componentPropRefs: [{ defID: g(0), componentPropNodeField: 'TEXT_DATA' }] });
    const card = f(3, 'SYMBOL', 'Card', { componentPropDefs: [{ id: g(0), name: 'title', type: 'TEXT', initialValue: { textValue: { characters: 'Title' } } }] });
    const title = f(4, 'TEXT', 'Title', { textData: { characters: 'Title' }, parentIndex: { position: '!' }, componentPropRefs: [{ defID: g(0), componentPropNodeField: 'TEXT_DATA' }] });
    const inner = f(5, 'INSTANCE', 'Badge', { parentIndex: { position: '"' }, symbolData: { symbolID: { sessionID: 1, localID: 1 }, symbolOverrides: [] } });
    const page = f(10, 'FRAME', 'Page', { size: { x: 300, y: 100 } });
    const outer = f(11, 'INSTANCE', 'Card', { symbolData: { symbolID: { sessionID: 1, localID: 3 }, symbolOverrides: [] }, componentPropAssignments: [{ defID: g(0), value: { textValue: { characters: 'Hello' } } }] });
    const { document } = importFigNode(figOf([badge, badgeText, card, title, inner, page, outer], { '1:1': [badgeText], '1:3': [title, inner], '1:10': [outer] }), '1:10');
    const texts = walkPage(document.pages[0]!).filter((node) => node.type === 'text').map((node) => [node.text, node.propRefs?.text]);
    expect(texts).toEqual([['Hello', 'p-1:3-9:0'], ['New', 'p-1:1-9:0']]);
  });

  it('turns bound variables into tokens, resolves colors for the frame mode and reads per-corner radii', () => {
    const set = f(20, 'VARIABLE_SET', 'Colors', { variableSetModes: [{ id: g(1), name: 'Light' }, { id: g(2), name: 'Dark' }] });
    const color = (r: number) => ({ r, g: r, b: r, a: 1 });
    const background = f(21, 'VARIABLE', 'background', { variableSetID: { guid: { sessionID: 1, localID: 20 } }, variableResolvedType: 'COLOR', variableDataValues: { entries: [{ modeID: g(1), variableData: { value: { colorValue: color(1) } } }, { modeID: g(2), variableData: { value: { colorValue: color(0) } } }] } });
    const space = f(22, 'VARIABLE', 'Spacing/4', { variableSetID: { guid: { sessionID: 1, localID: 20 } }, variableResolvedType: 'FLOAT', variableDataValues: { entries: [{ modeID: g(1), variableData: { value: { floatValue: 16 } } }] } });
    const alias = { alias: { guid: { sessionID: 1, localID: 22 } } };
    // 파일에 저장된 칠 색은 다크 값(검정)이지만 프레임은 라이트 모드를 고른다.
    const frame = f(30, 'FRAME', 'Card', {
      variableModeBySetMap: { entries: [{ variableSetID: { guid: { sessionID: 1, localID: 20 } }, variableModeID: g(1) }] },
      fillPaints: [{ type: 'SOLID', color: color(0), colorVar: { value: { alias: { guid: { sessionID: 1, localID: 21 } } } } }],
      stackMode: 'VERTICAL', stackSpacing: 16, variableConsumptionMap: { entries: [{ variableField: 'STACK_SPACING', variableData: { value: alias } }] },
      rectangleTopLeftCornerRadius: 8, rectangleTopRightCornerRadius: 8, rectangleBottomLeftCornerRadius: 8, rectangleBottomRightCornerRadius: 8
    });
    const { document } = importFigNode(figOf([set, background, space, frame], {}), '1:30');
    const card = walkPage(document.pages[0]!)[0]!;
    expect(card.fills).toEqual([{ type: 'solid', color: '#ffffff' }]);
    expect(card.radius).toBe(8);
    expect(Object.values(document.tokens).map((token) => [token.name, token.value]).sort()).toEqual([['Spacing/4', 16], ['background', '#ffffff']]);
    expect(card.tokens).toEqual({ fill: 'var-1:21', gap: 'var-1:22' });
  });
});
