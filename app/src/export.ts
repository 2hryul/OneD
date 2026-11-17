import { descendantsOf, type DesignDocument, type DesignNode } from './model';

function identifier(name: string): string {
  const parts = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const result = parts.map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
  return /^[A-Za-z]/.test(result) ? result : `Design${result}`;
}

function propertyName(node: DesignNode, index: number): string {
  const name = identifier(node.name);
  return `${name[0]!.toLowerCase()}${name.slice(1)}${index}`;
}

function styleFor(node: DesignNode, root: DesignNode, isRoot: boolean): Record<string, string | number> {
  const style: Record<string, string | number> = {
    position: isRoot ? 'relative' : 'absolute',
    width: node.width,
    height: node.height,
    boxSizing: 'border-box'
  };
  if (!isRoot) { style.left = node.x - root.x; style.top = node.y - root.y; }
  if (node.type !== 'text' && node.type !== 'vector') style.backgroundColor = node.fill;
  if (node.opacity !== undefined) style.opacity = node.opacity;
  if (node.type === 'ellipse') style.borderRadius = '50%';
  if (node.radius) style.borderRadius = node.radius;
  if (node.type === 'text') {
    style.color = node.fill;
    style.fontSize = node.fontSize ?? 18;
    if (node.fontFamily) style.fontFamily = node.fontFamily;
    if (node.fontWeight) style.fontWeight = node.fontWeight;
    style.whiteSpace = 'pre-wrap';
    style.overflow = 'hidden';
  }
  return style;
}

export function exportTsx(doc: DesignDocument, selectedId: string): { name: string; code: string } {
  const root = doc.nodes.find((node) => node.id === selectedId);
  if (!root) throw new Error('Select a node to export');
  const nodes = descendantsOf(doc, selectedId);
  const name = identifier(root.name);
  const textNodes = nodes.filter((node) => node.type === 'text');
  const props = new Map(textNodes.map((node, index) => [node.id, propertyName(node, index)]));
  const propLines = textNodes.map((node) => `  ${props.get(node.id)}?: string;`).join('\n');
  const body = nodes.map((node) => {
    const style = JSON.stringify(styleFor(node, root, node.id === root.id));
    if (node.type === 'text') {
      const value = props.get(node.id)!;
      return `      <span style={${style}}>{props.${value} ?? ${JSON.stringify(node.text ?? '')}}</span>`;
    }
    if (node.type === 'vector') {
      const paths = (node.vectorPaths ?? []).map((path) => `<path d=${JSON.stringify(path.d)} fill=${JSON.stringify(path.fill)}${path.stroke ? ` stroke=${JSON.stringify(path.stroke)} strokeWidth={${path.strokeWidth ?? 1}}` : ''} />`).join('');
      return `      <svg style={${style}} viewBox="0 0 ${node.width} ${node.height}" aria-hidden="true">${paths}</svg>`;
    }
    return `      <div style={${style}} />`;
  }).join('\n');
  const code = `export interface ${name}Props {\n  className?: string;\n${propLines ? `${propLines}\n` : ''}}\n\n` +
    `export function ${name}(props: ${name}Props) {\n` +
    `  return (\n    <div className={props.className} style={{ position: 'relative', width: ${root.width}, height: ${root.height} }}>\n` +
    `${body}\n    </div>\n  );\n}\n`;
  return { name, code };
}
