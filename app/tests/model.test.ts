import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { addNode, deleteNode, moveNode, parseDocument, sampleDocument } from '../src/model';
import { exportTsx } from '../src/export';

describe('document commands', () => {
  it('moves a frame with its descendants', () => {
    const doc = sampleDocument();
    const moved = moveNode(doc, 'frame-1', 20, 30);
    expect(moved.nodes.find((node) => node.id === 'frame-1')?.x).toBe(140);
    expect(moved.nodes.find((node) => node.id === 'text-1')?.x).toBe(230);
    expect(doc.nodes.find((node) => node.id === 'text-1')?.x).toBe(210);
  });

  it('deletes nested nodes with their frame', () => {
    expect(deleteNode(sampleDocument(), 'frame-1').nodes).toHaveLength(0);
  });

  it('rejects missing parents and invalid documents', () => {
    const doc = sampleDocument();
    expect(() => addNode(doc, { id: 'a', type: 'text', name: 'A', parentId: 'missing', x: 0, y: 0, width: 1, height: 1, fill: '#000' })).toThrow();
    expect(() => parseDocument('{"version":1,"name":"x","nodes":[{"id":"a"}]}')).toThrow();
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });
});

describe('React export', () => {
  it('exposes text as props and uses relative coordinates', () => {
    const result = exportTsx(sampleDocument(), 'frame-1');
    expect(result.code).toContain('export function LandingPage');
    expect(result.code).toContain('heading0?: string');
    expect(result.code).toContain('props.heading0');
    expect(result.code).toContain('"left":44');
    expect(() => transformSync(result.code, { loader: 'tsx', jsx: 'automatic' })).not.toThrow();
  });
});
