import type { CSSProperties } from 'react';
import { IDENTITY, type DesignNode, type Matrix, type Page } from './model';
import { HANDLES, boundsOf, cssMatrix, handlePoint, invert, multiply, worldCorners, worldMatrix, type Handle, type Rect } from './geometry';
import type { Guide } from './snapping';

const HANDLE_CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

interface CanvasNodesProps {
  page: Page;
  editingId: string | null;
  onTextDone: (id: string, text: string | null) => void;
}

/** 페이지의 최상위 도형부터 트리 그대로 중첩해 그린다. */
export function CanvasNodes({ page, editingId, onTextDone }: CanvasNodesProps): JSX.Element {
  return <>{page.children.map((id) => <NodeView key={id} page={page} id={id} parentWorld={IDENTITY as Matrix} parentLocked={false} editingId={editingId} onTextDone={onTextDone} />)}</>;
}

interface NodeViewProps extends CanvasNodesProps { id: string; parentWorld: Matrix; parentLocked: boolean }

/**
 * 도형 하나와 그 자식을 그린다.
 * 각 요소는 부모 요소 안에서 (부모 월드 행렬의 역) × (자기 월드 행렬)로 배치한다.
 * 이렇게 하면 프레임의 overflow:hidden이 회전된 프레임에서도 정확히 자르고, opacity가 자식에 상속된다.
 */
function NodeView({ page, id, parentWorld, parentLocked, editingId, onTextDone }: NodeViewProps): JSX.Element | null {
  const node = page.objects[id];
  if (!node || node.hidden) return null;
  const world = worldMatrix(node);
  const locked = parentLocked || Boolean(node.locked);
  return (
    <div data-node-id={node.id} className={`design-node node-${node.type}`} style={nodeStyle(node, multiply(invert(parentWorld), world), locked)}>
      {node.type === 'text' ? (editingId === node.id ? <TextEditor node={node} onDone={onTextDone} /> : node.text) : null}
      {node.type === 'vector' ? <svg width="100%" height="100%" viewBox={`0 0 ${node.width} ${node.height}`} aria-hidden="true">{node.vectorPaths?.map((path, index) => <path key={index} d={path.d} fill={path.fill} stroke={path.stroke} strokeWidth={path.strokeWidth} />)}</svg> : null}
      {node.children?.map((child) => <NodeView key={child} page={page} id={child} parentWorld={world} parentLocked={locked} editingId={editingId} onTextDone={onTextDone} />)}
    </div>
  );
}

function nodeStyle(node: DesignNode, local: Matrix, locked: boolean): CSSProperties {
  const filled = node.type === 'frame' || node.type === 'rectangle' || node.type === 'ellipse';
  return {
    width: node.width,
    height: node.height,
    transform: cssMatrix(local),
    background: filled ? node.fill : 'transparent',
    color: node.type === 'text' ? node.fill : undefined,
    fontSize: node.type === 'text' ? node.fontSize ?? 18 : undefined,
    fontFamily: node.type === 'text' ? node.fontFamily : undefined,
    fontWeight: node.type === 'text' ? node.fontWeight : undefined,
    opacity: node.opacity,
    borderRadius: node.type === 'ellipse' ? '50%' : node.radius ?? 0,
    // 그룹 상자의 빈 곳은 클릭되지 않게 하고 자식만 받는다. 잠긴 도형은 클릭이 아래 도형으로 지나간다.
    pointerEvents: locked || node.type === 'group' ? 'none' : 'auto'
  };
}

function TextEditor({ node, onDone }: { node: DesignNode; onDone: (id: string, text: string | null) => void }): JSX.Element {
  return (
    <textarea
      className="text-editor"
      autoFocus
      defaultValue={node.text ?? ''}
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => onDone(node.id, event.currentTarget.value)}
      onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }}
    />
  );
}

interface OverlayProps {
  page: Page;
  selectedIds: readonly string[];
  editingId: string | null;
  zoom: number;
  guides: readonly Guide[];
  marquee: Rect | null;
}

/** 선택 상자, 크기·회전 핸들, 정렬선, 사각형 선택 영역, 최상위 프레임 이름을 도형 위에 그린다. 굵기는 확대율과 상관없이 화면 기준으로 일정하게 맞춘다. */
export function SelectionOverlay({ page, selectedIds, editingId, zoom, guides, marquee }: OverlayProps): JSX.Element {
  const unit = 1 / zoom;
  const nodes = selectedIds.map((id) => page.objects[id]).filter((node): node is DesignNode => Boolean(node && !node.hidden));
  const single = nodes.length === 1 && !nodes[0]!.locked && editingId !== nodes[0]!.id ? nodes[0]! : null;
  return (
    <div className="canvas-overlay">
      {page.children.map((id) => page.objects[id]).filter((node): node is DesignNode => node?.type === 'frame' && !node.hidden).map((frame) => <FrameTitle key={frame.id} frame={frame} unit={unit} />)}
      {nodes.map((node) => <div key={node.id} className="selection-box" style={{ width: node.width, height: node.height, transform: cssMatrix(worldMatrix(node)), borderWidth: 1.5 * unit }} />)}
      {nodes.length > 1 ? <MultiBox nodes={nodes} unit={unit} /> : null}
      {single ? <Handles node={single} unit={unit} /> : null}
      {guides.map((guide, index) => <div key={index} className="guide" style={guide.axis === 'x' ? { left: guide.at, top: guide.from, width: unit, height: guide.to - guide.from } : { left: guide.from, top: guide.at, width: guide.to - guide.from, height: unit }} />)}
      {marquee ? <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height, borderWidth: unit }} /> : null}
    </div>
  );
}

function FrameTitle({ frame, unit }: { frame: DesignNode; unit: number }): JSX.Element {
  const bounds = boundsOf(worldCorners(frame));
  return <div data-node-id={frame.id} className="frame-title" style={{ left: bounds.x, top: bounds.y, transform: `translateY(-100%) scale(${unit})` }}>{frame.name}</div>;
}

function MultiBox({ nodes, unit }: { nodes: readonly DesignNode[]; unit: number }): JSX.Element {
  const bounds = boundsOf(nodes.flatMap(worldCorners));
  return <div className="multi-box" style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, borderWidth: unit }} />;
}

function Handles({ node, unit }: { node: DesignNode; unit: number }): JSX.Element {
  const size = 8 * unit;
  return (
    <div className="handle-layer" style={{ width: node.width, height: node.height, transform: cssMatrix(worldMatrix(node)) }}>
      {HANDLES.map((handle) => {
        const point = handlePoint(handle, node.width, node.height);
        return <span key={handle} data-handle={handle} className="handle" style={{ left: point.x - size / 2, top: point.y - size / 2, width: size, height: size, borderWidth: unit, cursor: HANDLE_CURSOR[handle] }} />;
      })}
      <span data-handle="rotate" className="rotate-handle" title="회전 (Shift: 15도 단위)" style={{ left: node.width / 2 - size / 2, top: -24 * unit - size / 2, width: size, height: size }} />
    </div>
  );
}
