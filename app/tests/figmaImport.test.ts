import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFig, type FigDocument, type FigNode } from 'openfig-core';
import { figmaNodeId, importFigNode } from '../src/figmaImport';

const figNode = (localID: number, type: string, name: string, x: number, y: number, width: number, height: number): FigNode => ({
  guid: { sessionID: 1, localID }, type, name, size: { x: width, y: height },
  transform: { m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y }
});

describe('Figma import', () => {
  it('reads the node ID from a link', () => {
    expect(figmaNodeId('https://www.figma.com/design/key/name?node-id=779-23219&t=x')).toBe('779:23219');
    expect(figmaNodeId('779:23219')).toBe('779:23219');
    expect(figmaNodeId('invalid')).toBeNull();
  });

  it('maps nested coordinates and expands a component definition', () => {
    const root = figNode(1, 'FRAME', 'Screen', 500, 600, 320, 240);
    const text = { ...figNode(2, 'TEXT', 'Title', 40, 50, 100, 24), textData: { characters: 'Hello' }, fontSize: 20 };
    const instance = { ...figNode(3, 'INSTANCE', 'Button', 100, 60, 120, 40), symbolData: { symbolID: { sessionID: 1, localID: 4 }, symbolOverrides: [
      { guidPath: { guids: [{ sessionID: 9, localID: 9 }] }, textData: { characters: 'Changed' } }
    ] } };
    const symbol = figNode(4, 'SYMBOL', 'Button source', 0, 0, 120, 40);
    const label = { ...figNode(5, 'TEXT', 'Label', 5, 6, 80, 20), textData: { characters: 'Click' }, overrideKey: { sessionID: 9, localID: 9 } };
    const nodes = [root, text, instance, symbol, label];
    const fig = {
      nodes, nodeMap: new Map(nodes.map((node) => [`1:${node.guid.localID}`, node])),
      childrenMap: new Map([['1:1', [text, instance]], ['1:4', [label]]])
    } as unknown as FigDocument;
    const imported = importFigNode(fig, '1:1');
    expect(imported.document.nodes).toHaveLength(4);
    expect(imported.document.nodes[0]).toMatchObject({ x: 0, y: 0, width: 320, height: 240 });
    expect(imported.document.nodes[1]).toMatchObject({ x: 40, y: 50, text: 'Hello' });
    expect(imported.document.nodes[3]).toMatchObject({ x: 105, y: 66, text: 'Changed' });
    expect(imported.report.expandedInstances).toBe(1);
    expect(imported.report.appliedOverrides).toBe(1);
    expect(imported.report.unappliedOverrides).toBe(0);
  });

  const file = process.env.FIGMA_TEST_FILE;
  (file ? it : it.skip)('imports the supplied Figma file node', () => {
    const parsed = parseFig(new Uint8Array(readFileSync(file!)));
    const imported = importFigNode(parsed, '779:23219');
    expect(imported.document.nodes[0]).toMatchObject({ name: 'Contents', width: 1200, height: 2143 });
    expect(imported.document.nodes.length).toBeGreaterThan(100);
    expect(imported.report.expandedInstances).toBeGreaterThan(0);
    expect(new Set(imported.document.nodes.map((node) => node.id)).size).toBe(imported.document.nodes.length);
    const ids = new Set(imported.document.nodes.map((node) => node.id));
    expect(imported.document.nodes.every((node) => node.parentId === null || ids.has(node.parentId))).toBe(true);
  });
});
