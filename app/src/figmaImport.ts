import { parseFig, resolveVectorNodePaths, type FigDocument, type FigNode, type FigPaint } from 'openfig-core';
import type { DesignDocument, DesignNode, NodeType } from './model';

export interface FigImportResult {
  document: DesignDocument;
  report: { imported: number; expandedInstances: number; unresolvedInstances: number; approximatedShapes: number; appliedOverrides: number; unappliedOverrides: number };
}

interface FigOverride { id: string; path: string[]; patch: Partial<FigNode> }

export function figmaNodeId(value: string): string | null {
  const match = value.match(/node-id=([0-9]+)[-:]([0-9]+)/) ?? value.trim().match(/^([0-9]+)[-:]([0-9]+)$/);
  return match ? `${match[1]}:${match[2]}` : null;
}

export function importFigFile(bytes: Uint8Array, rootId: string): FigImportResult {
  return importFigNode(parseFig(bytes), rootId);
}

function nodeId(node: FigNode): string {
  return `${node.guid.sessionID}:${node.guid.localID}`;
}

function guidId(guid: { sessionID: number; localID: number }): string {
  return `${guid.sessionID}:${guid.localID}`;
}

function solidColor(paints: FigPaint[] | undefined, fallback: string): string {
  const paint = paints?.find((item) => item.visible !== false && item.type === 'SOLID' && item.color);
  if (!paint?.color) return fallback;
  const channel = (value: number): string => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
  return `#${channel(paint.color.r)}${channel(paint.color.g)}${channel(paint.color.b)}`;
}

function toType(type: string): NodeType {
  if (type === 'TEXT') return 'text';
  if (type === 'ELLIPSE') return 'ellipse';
  if (type === 'VECTOR' || type === 'LINE' || type === 'BOOLEAN_OPERATION') return 'vector';
  if (type === 'ROUNDED_RECTANGLE' || type === 'RECTANGLE') return 'rectangle';
  return 'frame';
}

function fontWeight(style: string | undefined): number {
  if (!style) return 400;
  if (/black|heavy/i.test(style)) return 900;
  if (/extra.?bold/i.test(style)) return 800;
  if (/bold/i.test(style)) return 700;
  if (/semi.?bold/i.test(style)) return 600;
  if (/medium/i.test(style)) return 500;
  if (/light/i.test(style)) return 300;
  return 400;
}

export function importFigNode(fig: FigDocument, rootId: string): FigImportResult {
  const root = fig.nodeMap.get(rootId);
  if (!root) throw new Error(`Figma 노드 ${rootId}를 찾지 못했습니다.`);
  if (!root.size) throw new Error('크기가 없는 노드는 가져올 수 없습니다. 프레임을 선택하세요.');

  const nodes: DesignNode[] = [];
  const report = { imported: 0, expandedInstances: 0, unresolvedInstances: 0, approximatedShapes: 0, appliedOverrides: 0, unappliedOverrides: 0 };
  let totalOverrides = 0;
  const applied = new Set<string>();
  const walk = (source: FigNode, id: string, parentId: string | null, parentX: number, parentY: number, symbolTrail: Set<string>, overrides: FigOverride[] = []): void => {
    const key = source.overrideKey ? guidId(source.overrideKey as { sessionID: number; localID: number }) : null;
    const ownPatches = overrides.filter((item) => item.path[0] === key && item.path.length === 1);
    const effective = Object.assign({}, source, ...ownPatches.map((item) => item.patch)) as FigNode;
    for (const item of ownPatches) applied.add(item.id);
    const remaining = overrides.flatMap((item) => item.path[0] === key
      ? item.path.length > 1 ? [{ ...item, path: item.path.slice(1) }] : []
      : [item]);
    if (effective.visible === false || effective.phase === 'REMOVED' || !effective.size) return;
    const x = parentId === null ? 0 : parentX + (effective.transform?.m02 ?? 0);
    const y = parentId === null ? 0 : parentY + (effective.transform?.m12 ?? 0);
    const type = toType(effective.type);
    const symbolGuid = effective.symbolData?.symbolID as { sessionID: number; localID: number } | undefined;
    const symbolId = symbolGuid ? `${symbolGuid.sessionID}:${symbolGuid.localID}` : null;
    const symbol = symbolId ? fig.nodeMap.get(symbolId) : undefined;
    const width = Math.max(1, Math.round(effective.size.x));
    const height = Math.max(1, Math.round(effective.size.y));
    const base: DesignNode = {
      id, parentId, type, name: effective.name || type,
      x: Math.round(x), y: Math.round(y), width, height,
      fill: solidColor(effective.fillPaints ?? symbol?.fillPaints, type === 'text' ? '#17223a' : 'transparent'),
      sourceType: effective.type,
      ...(effective.opacity !== undefined ? { opacity: effective.opacity } : {}),
      ...(effective.cornerRadius !== undefined ? { radius: effective.cornerRadius } : {}),
      ...(effective.stackMode && effective.stackMode !== 'NONE' ? { layout: effective.stackMode as DesignNode['layout'], gap: effective.stackSpacing ?? 0 } : {}),
      ...(type === 'text' ? { text: effective.textData?.characters ?? '', fontSize: effective.fontSize ?? 16,
        fontFamily: effective.fontName?.family ?? 'Arial', fontWeight: fontWeight(effective.fontName?.style) } : {})
    };
    if (type === 'vector') {
      try {
        const geometry = resolveVectorNodePaths(fig, effective);
        base.vectorPaths = [
          ...geometry.fill.map((path) => ({ d: path.svgPath, fill: solidColor(path.paints ?? effective.fillPaints, '#000000') })),
          ...geometry.stroke.map((path) => ({ d: path.svgPath, fill: 'none', stroke: solidColor(path.paints ?? effective.strokePaints, '#000000'), strokeWidth: effective.strokeWeight ?? 1 }))
        ];
      } catch { base.vectorPaths = []; }
      if (base.vectorPaths.length === 0 && effective.type === 'LINE') base.vectorPaths = [{ d: `M0 0 L${width} ${height}`, fill: 'none', stroke: solidColor(effective.strokePaints, '#000000'), strokeWidth: effective.strokeWeight ?? 1 }];
      if (base.vectorPaths.length === 0) report.approximatedShapes++;
    }
    nodes.push(base);
    report.imported++;

    for (const child of fig.childrenMap.get(nodeId(source)) ?? []) {
      const childId = nodeId(child);
      walk(child, `${id}/${childId}`, id, x, y, symbolTrail, remaining);
    }
    if (effective.type === 'INSTANCE') {
      const ownOverrides: FigOverride[] = (effective.symbolData?.symbolOverrides ?? []).map((patch: Partial<FigNode> & { guidPath?: { guids?: Array<{ sessionID: number; localID: number }> } }, index: number) => ({
        id: `${id}:override:${index}`,
        path: (patch.guidPath?.guids ?? []).map(guidId),
        patch
      })).filter((item: FigOverride) => item.path.length > 0);
      totalOverrides += ownOverrides.length;
      if (!symbol || !symbolId || symbolTrail.has(symbolId) || symbolTrail.size >= 8) { report.unresolvedInstances++; return; }
      report.expandedInstances++;
      const nextTrail = new Set(symbolTrail).add(symbolId);
      for (const child of fig.childrenMap.get(symbolId) ?? []) {
        const childId = nodeId(child);
        walk(child, `${id}/${childId}`, id, x, y, nextTrail, [...ownOverrides, ...remaining]);
      }
    }
  };

  walk(root, rootId, null, 0, 0, new Set());
  report.appliedOverrides = applied.size;
  report.unappliedOverrides = totalOverrides - applied.size;
  return { document: { version: 1, name: `${root.name || 'Figma frame'} (${rootId})`, nodes }, report };
}
