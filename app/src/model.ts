export type NodeType = 'frame' | 'rectangle' | 'ellipse' | 'text' | 'vector';

export interface DesignNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
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
}

export interface DesignDocument { version: 1; name: string; nodes: DesignNode[] }

export function sampleDocument(): DesignDocument {
  return { version: 1, name: 'Untitled design', nodes: [
    { id: 'frame-1', type: 'frame', name: 'Landing page', parentId: null, x: 120, y: 95, width: 720, height: 520, fill: '#ffffff' },
    { id: 'rect-1', type: 'rectangle', name: 'Hero panel', parentId: 'frame-1', x: 164, y: 150, width: 632, height: 336, fill: '#e6ebff', radius: 24 },
    { id: 'text-1', type: 'text', name: 'Heading', parentId: 'frame-1', x: 210, y: 218, width: 470, height: 72, fill: '#202c65', text: 'Design starts here', fontSize: 42 },
    { id: 'text-2', type: 'text', name: 'Description', parentId: 'frame-1', x: 210, y: 315, width: 470, height: 48, fill: '#52618a', text: 'Shape ideas into reusable interfaces.', fontSize: 20 },
    { id: 'rect-2', type: 'rectangle', name: 'Button', parentId: 'frame-1', x: 210, y: 392, width: 164, height: 52, fill: '#5369f8', radius: 12 },
    { id: 'text-3', type: 'text', name: 'Button label', parentId: 'frame-1', x: 238, y: 405, width: 110, height: 26, fill: '#ffffff', text: 'Get started', fontSize: 18 }
  ] };
}

export function descendantsOf(doc: DesignDocument, id: string): DesignNode[] {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of doc.nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true; }
    }
  }
  return doc.nodes.filter((node) => ids.has(node.id));
}

export function moveNode(doc: DesignDocument, id: string, dx: number, dy: number): DesignDocument {
  const ids = new Set(descendantsOf(doc, id).map((node) => node.id));
  return { ...doc, nodes: doc.nodes.map((node) => ids.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node) };
}

export function updateNode(doc: DesignDocument, id: string, patch: Partial<DesignNode>): DesignDocument {
  const { id: _id, parentId: _parentId, type: _type, ...properties } = patch;
  void _id; void _parentId; void _type;
  return { ...doc, nodes: doc.nodes.map((node) => node.id === id ? { ...node, ...properties } : node) };
}

export function deleteNode(doc: DesignDocument, id: string): DesignDocument {
  const ids = new Set(descendantsOf(doc, id).map((node) => node.id));
  return { ...doc, nodes: doc.nodes.filter((node) => !ids.has(node.id)) };
}

export function addNode(doc: DesignDocument, node: DesignNode): DesignDocument {
  if (doc.nodes.some((item) => item.id === node.id)) throw new Error('Duplicate node id');
  if (node.parentId && !doc.nodes.some((item) => item.id === node.parentId && item.type === 'frame')) throw new Error('Parent must be a frame');
  return { ...doc, nodes: [...doc.nodes, node] };
}

export function parseDocument(raw: string): DesignDocument {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid document');
  const candidate = value as Partial<DesignDocument>;
  if (candidate.version !== 1 || typeof candidate.name !== 'string' || !Array.isArray(candidate.nodes)) throw new Error('Unsupported document format');
  const ids = new Set<string>();
  for (const node of candidate.nodes) {
    if (!node || typeof node.id !== 'string' || ids.has(node.id) || !['frame', 'rectangle', 'ellipse', 'text', 'vector'].includes(node.type) ||
      typeof node.name !== 'string' || typeof node.x !== 'number' || typeof node.y !== 'number' ||
      typeof node.width !== 'number' || typeof node.height !== 'number' || typeof node.fill !== 'string' ||
      !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.width) || !Number.isFinite(node.height) ||
      node.width <= 0 || node.height <= 0) throw new Error('Invalid node');
    ids.add(node.id);
  }
  for (const node of candidate.nodes) {
    if (node.parentId !== null && (typeof node.parentId !== 'string' || !candidate.nodes.some((item) => item.id === node.parentId && item.type === 'frame'))) throw new Error('Invalid parent');
  }
  return candidate as DesignDocument;
}
