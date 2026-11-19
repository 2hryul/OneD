import { describe, expect, it } from 'vitest';
import type { FigDocument, FigNode } from 'openfig-core';
import { parseDocument, walkPage } from '../src/model';
import { importFigNode } from '../src/figmaImport';

/** 가짜 Figma 노드. patch로 필요한 필드만 덮는다. */
const f = (localID: number, type: string, name: string, patch: Record<string, unknown> = {}): FigNode => ({
  guid: { sessionID: 1, localID }, type, name, size: { x: 100, y: 40 }, transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, ...patch
}) as unknown as FigNode;

/** 노드 목록과 부모 → 자식 표로 파서 결과 모양을 만든다. 자식 순서는 일부러 파서처럼 주어진 순서 그대로 둔다. */
function figOf(nodes: FigNode[], children: Record<string, FigNode[]>): FigDocument {
  const id = (node: FigNode): string => `${(node.guid as { sessionID: number }).sessionID}:${(node.guid as { localID: number }).localID}`;
  return { nodes, nodeMap: new Map(nodes.map((node) => [id(node), node])), childrenMap: new Map(Object.entries(children)), images: new Map() } as unknown as FigDocument;
}

const text = (characters: string) => ({ characters, lines: [] });

describe('values Figma stores as Infinity or NaN', () => {
  it('drops unlimited max sizes and auto spacing so the document can be saved and opened again', () => {
    const root = f(1, 'FRAME', 'Root', { stackMode: 'HORIZONTAL', stackWrap: 'WRAP', stackSpacing: 16, stackCounterSpacing: Number.NaN, stackPrimarySizing: 'FIXED' });
    const child = f(2, 'RECTANGLE', 'Card', { maxSize: { value: { x: 320, y: Number.POSITIVE_INFINITY } }, minSize: { value: { x: Number.NaN, y: 10 } } });
    const { document } = importFigNode(figOf([root, child], { '1:1': [child] }), '1:1');
    const [rootNode, childNode] = walkPage(document.pages[0]!);
    expect(rootNode!.layout).toMatchObject({ type: 'flex', gap: 16, crossGap: 16 });
    expect(childNode!.item).toEqual({ maxWidth: 320, minHeight: 10 });
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
  });
});

describe('instances from files that use node ids in override paths', () => {
  /** 컴포넌트(글자 Label, 아이콘 Icon)와 그 인스턴스. 인스턴스는 override 또는 컴포넌트 속성으로 글자를 바꾼다. */
  function instanceFile(instancePatch: Record<string, unknown>): FigDocument {
    const symbol = f(10, 'SYMBOL', 'Button', { componentPropDefs: [{ id: { sessionID: 3, localID: 7 }, name: 'label', type: 'TEXT' }, { id: { sessionID: 3, localID: 8 }, name: 'show label', type: 'BOOL' }] });
    const label = f(11, 'TEXT', 'Label', { textData: text('Button'), parentIndex: { position: '"' }, componentPropRefs: [{ defID: { sessionID: 3, localID: 7 }, componentPropNodeField: 'TEXT_DATA' }, { defID: { sessionID: 3, localID: 8 }, componentPropNodeField: 'VISIBLE' }] });
    const icon = f(12, 'RECTANGLE', 'Icon', { parentIndex: { position: '!' } });
    const page = f(20, 'FRAME', 'Page', { size: { x: 300, y: 100 } });
    const instance = f(21, 'INSTANCE', 'Button', { symbolData: { symbolID: { sessionID: 1, localID: 10 }, symbolOverrides: [] }, ...instancePatch });
    return figOf([symbol, label, icon, page, instance], { '1:10': [label, icon], '1:20': [instance] });
  }
  const labelOf = (fig: FigDocument) => walkPage(importFigNode(fig, '1:20').document.pages[0]!).find((node) => node.name === 'Label' && node.parentId?.startsWith('1:20'))!;

  it('applies an override whose path names the node guid (no overrideKey in the file)', () => {
    const fig = instanceFile({ symbolData: { symbolID: { sessionID: 1, localID: 10 }, symbolOverrides: [{ guidPath: { guids: [{ sessionID: 1, localID: 11 }] }, textData: text('Save') }] } });
    expect(labelOf(fig).text).toBe('Save');
    expect(importFigNode(fig, '1:20').report.unappliedOverrides).toBe(0);
  });

  it('applies text and visibility component properties to the nodes that reference them', () => {
    const fig = instanceFile({ componentPropAssignments: [{ defID: { sessionID: 3, localID: 7 }, value: { textValue: text('Get started') } }, { defID: { sessionID: 3, localID: 8 }, value: { boolValue: false } }] });
    expect(labelOf(fig)).toMatchObject({ text: 'Get started', hidden: true });
  });

  it('orders children by the character codes of their position strings', () => {
    const fig = instanceFile({});
    const names = walkPage(importFigNode(fig, '1:20').document.pages[0]!).filter((node) => node.parentId === '1:20/1:21').map((node) => node.name);
    expect(names).toEqual(['Icon', 'Label']);
    const page = f(30, 'FRAME', 'Order');
    const spaced = f(31, 'RECTANGLE', 'First', { parentIndex: { position: ' ~' } });
    const bang = f(32, 'RECTANGLE', 'Second', { parentIndex: { position: '!' } });
    const order = walkPage(importFigNode(figOf([page, bang, spaced], { '1:30': [bang, spaced] }), '1:30').document.pages[0]!).slice(1).map((node) => node.name);
    // 파서의 localeCompare는 공백을 무시해 " ~"를 "!" 뒤로 보낸다. 문자 코드 순(공백 32 < ! 33)이 Figma와 같다.
    expect(order).toEqual(['First', 'Second']);
  });
});
