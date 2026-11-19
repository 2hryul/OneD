import { Fragment, createContext, memo, useContext, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { IDENTITY, type DesignNode, type Matrix, type Page } from './model';
import { HANDLES, boundsOf, cssMatrix, handlePoint, invert, multiply, worldCorners, worldMatrix, type Handle, type Rect } from './geometry';
import type { Guide } from './snapping';
import type { Measure } from './measure';
import { fontStack, pathPaint, paintsToBackground, strokeAndEffectCss, textCss, textRuns, type AssetResolver } from './styleCss';
import { pathToD } from './path';
import { hasMask, maskImageUrl, maskRuns } from './mask';

const HANDLE_CURSOR: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

interface CanvasNodesProps {
  page: Page;
  editingId: string | null;
  onTextDone: (id: string, text: string | null) => void;
  resolveAsset: AssetResolver;
  /** 그리지 않을 도형 id(보기 모드에서 스크롤 고정 자식을 따로 그릴 때). */
  skip?: ReadonlySet<string>;
}

/**
 * 그릴 장면(페이지·편집 중인 글·이미지 주소). 도형마다 자기 노드만 구독해, 화면 이동처럼 문서가 그대로인 렌더에서는
 * 도형이 다시 그려지지 않고, 편집하면 바뀐 노드 객체를 가진 도형만 다시 그려진다(applyChanges는 안 바뀐 노드 객체를 그대로 둔다).
 */
class SceneStore {
  scene: CanvasNodesProps;
  private readonly listeners = new Set<() => void>();
  constructor(scene: CanvasNodesProps) { this.scene = scene; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  notify(): void { this.listeners.forEach((listener) => listener()); }
}

const SceneContext = createContext<SceneStore | null>(null);

/** 장면 저장소를 만들고, 렌더마다 장면을 바꾼 뒤 레이아웃 단계에서 구독한 도형에 알린다. */
function useSceneStore(scene: CanvasNodesProps): SceneStore {
  const [store] = useState(() => new SceneStore(scene));
  store.scene = scene;
  useLayoutEffect(() => { store.notify(); });
  return store;
}

/**
 * 도형 하나를 루트로 그 하위 트리를 그린다. 루트의 왼쪽 위가 (0, 0)에 온다. 보기 모드의 화면·오버레이·고정 요소에 쓴다.
 * origin은 (0, 0)으로 옮길 페이지 좌표다. 고정 요소는 화면의 왼쪽 위를 origin으로 준다.
 */
export function NodeTree({ page, id, origin, skip, resolveAsset }: { page: Page; id: string; origin: { x: number; y: number }; skip?: ReadonlySet<string>; resolveAsset: AssetResolver }): JSX.Element {
  const store = useSceneStore({ page, editingId: null, onTextDone: () => undefined, resolveAsset, skip });
  return <SceneContext.Provider value={store}><NodeView id={id} parentWorld={[1, 0, 0, 1, origin.x, origin.y]} parentLocked={false} /></SceneContext.Provider>;
}

/** 페이지의 최상위 도형부터 트리 그대로 중첩해 그린다. */
export function CanvasNodes(props: CanvasNodesProps): JSX.Element {
  const store = useSceneStore(props);
  return <SceneContext.Provider value={store}>{props.page.children.map((id) => <NodeView key={id} id={id} parentWorld={IDENTITY as Matrix} parentLocked={false} />)}</SceneContext.Provider>;
}

interface NodeViewProps { id: string; parentWorld: Matrix; parentLocked: boolean }

function sameMatrix(a: Matrix, b: Matrix): boolean {
  return a === b || a.every((value, index) => value === b[index]);
}

/**
 * 도형 하나와 그 자식을 그린다.
 * 각 요소는 부모 요소 안에서 (부모 월드 행렬의 역) × (자기 월드 행렬)로 배치한다.
 * 이렇게 하면 프레임의 overflow:hidden이 회전된 프레임에서도 정확히 자르고, opacity가 자식에 상속된다.
 */
const NodeView = memo(function NodeView({ id, parentWorld, parentLocked }: NodeViewProps): JSX.Element | null {
  const store = useContext(SceneContext)!;
  const node = useSyncExternalStore(store.subscribe, () => store.scene.page.objects[id]);
  const editing = useSyncExternalStore(store.subscribe, () => store.scene.editingId === id);
  const skipped = useSyncExternalStore(store.subscribe, () => Boolean(store.scene.skip?.has(id)));
  const resolveAsset = useSyncExternalStore(store.subscribe, () => store.scene.resolveAsset);
  // 마스크 자식의 모양·위치가 바뀌면 이 부모도 다시 그려야 한다. 마스크 그림 글자를 구독해 바뀔 때만 다시 그린다.
  const maskKey = useSyncExternalStore(store.subscribe, () => masksOf(store.scene.page, id));
  if (!node || node.hidden || skipped) return null;
  const world = worldMatrix(node);
  const locked = parentLocked || Boolean(node.locked);
  const child = (childId: string): JSX.Element => <NodeView key={childId} id={childId} parentWorld={world} parentLocked={locked} />;
  return (
    <div data-node-id={node.id} data-interactive={node.interactions?.length ? 'true' : undefined} className={`design-node node-${node.type}`} style={nodeStyle(node, multiply(invert(parentWorld), world), locked, resolveAsset)}>
      {node.type === 'text' ? (editing ? <TextEditor node={node} onDone={(nodeId, text) => store.scene.onTextDone(nodeId, text)} /> : <TextContent node={node} />) : null}
      {node.type === 'vector' || node.boolOp ? <VectorContent node={node} /> : null}
      {/* 불리언 그룹은 결과 경로만 보인다. 피연산자는 레이어에서 선택해 편집한다. */}
      {node.boolOp ? null : maskKey ? maskRuns(store.scene.page, node).map((run, index) => (run.mask
        ? <div key={`mask-${run.mask.id}`} className="mask-run" style={{ width: node.width, height: node.height, maskImage: maskImageUrl(node, run.mask), WebkitMaskImage: maskImageUrl(node, run.mask) }}>{run.ids.map(child)}</div>
        : <Fragment key={`free-${index}`}>{run.ids.map(child)}</Fragment>))
        : node.children?.map(child)}
    </div>
  );
}, (prev, next) => prev.id === next.id && prev.parentLocked === next.parentLocked && sameMatrix(prev.parentWorld, next.parentWorld));

/**
 * 부모의 마스크 그림 글자(마스크마다 data URL). 마스크가 없으면 빈 글자라 렌더 비용이 없다.
 * 마스크 도형이 움직이거나 모양이 바뀌면 글자가 바뀌어 부모가 다시 그려진다.
 */
function masksOf(page: Page, id: string): string {
  const parent = page.objects[id];
  if (!parent || parent.boolOp || !hasMask(page, parent)) return '';
  return maskRuns(page, parent).flatMap((run) => (run.mask ? [maskImageUrl(parent, run.mask)] : [])).join('|');
}

/**
 * 벡터 내용. 편집 경로가 있으면(펜·평탄화·불리언) 그 경로를 도형 좌표 그대로 그리고,
 * 가져온 벡터는 원래 viewBox에서 도형 크기로 늘린다(크기를 바꿔도 모양이 따라온다).
 */
function VectorContent({ node }: { node: DesignNode }): JSX.Element {
  if (node.path) {
    return <svg width="100%" height="100%" viewBox={`0 0 ${node.width} ${node.height}`} overflow="visible" aria-hidden="true"><path d={pathToD(node.path)} {...pathPaint(node)} /></svg>;
  }
  const view = node.viewBox ?? { width: node.width, height: node.height };
  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${view.width} ${view.height}`} preserveAspectRatio="none" overflow="visible" aria-hidden="true">
      {node.vectorPaths?.map((path, index) => <path key={index} d={path.d} fill={path.fill} fillRule={path.fillRule} stroke={path.stroke} strokeWidth={path.strokeWidth} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

function nodeStyle(node: DesignNode, local: Matrix, locked: boolean, resolveAsset: AssetResolver): CSSProperties {
  const paintable = node.type === 'frame' || node.type === 'rectangle' || node.type === 'ellipse';
  return {
    width: node.width,
    height: node.height,
    transform: cssMatrix(local),
    background: paintable ? paintsToBackground(node.fills, node.width, node.height, resolveAsset) : undefined,
    ...strokeAndEffectCss(node),
    ...(node.type === 'text' ? { ...textCss(node), fontSize: node.fontSize ?? 18, fontFamily: fontStack(node.fontFamily), fontWeight: node.fontWeight } : {}),
    opacity: node.opacity,
    overflow: node.type === 'frame' && node.clipContent !== false ? 'hidden' : undefined,
    borderRadius: node.type === 'ellipse' ? '50%' : node.radius ?? 0,
    // 그룹 상자의 빈 곳은 클릭되지 않게 하고 자식만 받는다(불리언 그룹은 자식을 그리지 않으므로 스스로 받는다). 잠긴 도형은 클릭이 아래 도형으로 지나간다.
    pointerEvents: locked || (node.type === 'group' && !node.boolOp) ? 'none' : 'auto'
  } as CSSProperties;
}

/** 스타일 구간별로 글자를 나눠 그린다. 세로 정렬을 위해 한 덩어리로 감싼다. */
function TextContent({ node }: { node: DesignNode }): JSX.Element {
  return (
    <div className="text-content">
      {textRuns(node).map((run, index) => run.span
        ? <span key={index} style={{ fontSize: run.span.fontSize, fontWeight: run.span.fontWeight, fontFamily: run.span.fontFamily ? fontStack(run.span.fontFamily) : undefined, color: run.span.color }}>{run.text}</span>
        : <span key={index}>{run.text}</span>)}
    </div>
  );
}

/** Canvas 렌더러에서 텍스트를 고칠 때 그 자리에 놓는 DOM 편집기. 캔버스는 이 도형을 그리지 않는다. */
export function TextEditOverlay({ node, onDone }: { node: DesignNode; onDone: (id: string, text: string | null) => void }): JSX.Element {
  return <div className={`design-node node-text`} style={nodeStyle(node, worldMatrix(node), false, () => null)}><TextEditor node={node} onDone={onDone} /></div>;
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
  /** 보이는 영역(페이지 좌표). 이 안의 프레임만 이름표를 단다. */
  visible: Rect;
  /** false면 프레임 이름표를 그리지 않는다(Canvas 렌더러가 직접 그린다). */
  titles?: boolean;
  /** Alt를 누른 채 올린 도형의 상자와, 고른 영역에서 그 도형까지의 거리선. */
  measure?: { target: Rect; lines: readonly Measure[] } | null;
}

/** 보이는 영역을 화면 절반 크기 격자에 맞춰 조금 넓힌다. 조금 움직일 때는 같은 값이 나와 이름표를 다시 그리지 않는다. */
function snapView(visible: Rect): [number, number, number, number] {
  const step = Math.max(visible.width, visible.height) / 2;
  const x = Math.floor(visible.x / step) * step - step;
  const y = Math.floor(visible.y / step) * step - step;
  return [x, y, x + visible.width + step * 3, y + visible.height + step * 3];
}

/** 선택 상자, 크기·회전 핸들, 정렬선, 사각형 선택 영역, 최상위 프레임 이름을 도형 위에 그린다. 굵기는 확대율과 상관없이 화면 기준으로 일정하게 맞춘다. */
export function SelectionOverlay({ page, selectedIds, editingId, zoom, guides, marquee, visible, titles = true, measure = null }: OverlayProps): JSX.Element {
  const [left, top, right, bottom] = snapView(visible);
  const unit = 1 / zoom;
  const nodes = selectedIds.map((id) => page.objects[id]).filter((node): node is DesignNode => Boolean(node && !node.hidden));
  const single = nodes.length === 1 && !nodes[0]!.locked && editingId !== nodes[0]!.id ? nodes[0]! : null;
  return (
    <div className="canvas-overlay">
      {titles ? <FrameTitles page={page} left={left} top={top} right={right} bottom={bottom} /> : null}
      {nodes.map((node) => <div key={node.id} className="selection-box" style={{ width: node.width, height: node.height, transform: cssMatrix(worldMatrix(node)), borderWidth: 1.5 * unit }} />)}
      {nodes.length > 1 ? <MultiBox nodes={nodes} unit={unit} /> : null}
      {single ? <Handles node={single} unit={unit} /> : null}
      {guides.map((guide, index) => <div key={index} className="guide" style={guide.axis === 'x' ? { left: guide.at, top: guide.from, width: unit, height: guide.to - guide.from } : { left: guide.from, top: guide.at, width: guide.to - guide.from, height: unit }} />)}
      {measure ? <MeasureLines target={measure.target} lines={measure.lines} unit={unit} /> : null}
      {marquee ? <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height, borderWidth: unit }} /> : null}
    </div>
  );
}

/** 최상위 프레임 이름표. 페이지나 확대율이 바뀔 때만 다시 그린다(큰 문서에서 화면 이동마다 수천 개를 다시 만들지 않게). */
const FrameTitles = memo(function FrameTitles({ page, left, top, right, bottom }: { page: Page; left: number; top: number; right: number; bottom: number }): JSX.Element {
  const frames = page.children.map((id) => page.objects[id]).filter((node): node is DesignNode => node?.type === 'frame' && !node.hidden && node.x <= right && node.x + node.width >= left && node.y <= bottom && node.y + node.height >= top);
  return <>{frames.map((frame) => <FrameTitle key={frame.id} frame={frame} />)}</>;
});

/** 확대율에 반비례하는 크기는 캔버스 층의 CSS 변수 --unit으로 맞춘다. 확대할 때 이름표를 다시 만들지 않기 위해서다. */
function FrameTitle({ frame }: { frame: DesignNode }): JSX.Element {
  const bounds = boundsOf(worldCorners(frame));
  return <div data-node-id={frame.id} className="frame-title" style={{ left: bounds.x, top: bounds.y, transform: 'translateY(-100%) scale(var(--unit))' }}>{frame.name}</div>;
}

/** 거리선과 숫자. 선 굵기와 글자 크기는 확대율과 상관없이 화면 기준으로 같게 둔다. */
function MeasureLines({ target, lines, unit }: { target: Rect; lines: readonly Measure[]; unit: number }): JSX.Element {
  return (
    <>
      <div className="measure-target" style={{ left: target.x, top: target.y, width: target.width, height: target.height, borderWidth: unit }} />
      {lines.map((line, index) => {
        const box = line.axis === 'x' ? { left: line.from, top: line.at - unit / 2, width: line.to - line.from, height: unit } : { left: line.at - unit / 2, top: line.from, width: unit, height: line.to - line.from };
        const middle = (line.from + line.to) / 2;
        const label = line.axis === 'x' ? { left: middle, top: line.at } : { left: line.at, top: middle };
        return (
          <div key={index}>
            <div className="measure-line" style={box} />
            <span className="measure-label" style={{ ...label, transform: `scale(${unit}) ${line.axis === 'x' ? 'translate(-50%, 4px)' : 'translate(6px, -50%)'}`, transformOrigin: '0 0' }}>{line.value}</span>
          </div>
        );
      })}
    </>
  );
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
