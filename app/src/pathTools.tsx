import type { BoolOp, DesignNode, NodeInput, PathPoint, SubPath } from './model';
import { cssMatrix, worldMatrix, type Point } from './geometry';
import { mapPath, pathBounds, pathToD } from './path';

/** 펜으로 그리는 중인 경로. 점은 페이지 좌표다. 끝낼 때 도형 지역 좌표로 바꿔 벡터를 만든다. */
export interface PenDraft { pageId: string; points: PathPoint[] }

/** 경로 편집에서 잡은 대상. part는 점 자체(anchor) 또는 들어오는(in)·나가는(out) 핸들이다. */
export interface PathTarget { sub: number; index: number; part: 'anchor' | 'in' | 'out' }

const PARTS = new Set(['anchor', 'in', 'out']);

/** 오버레이 요소의 data-path-part 값("sub:index:part")을 읽는다. 형식이 어긋나면 null. */
export function parseTarget(value: string | undefined): PathTarget | null {
  const [sub, index, part] = (value ?? '').split(':');
  if (!part || !PARTS.has(part) || !/^\d+$/.test(sub ?? '') || !/^\d+$/.test(index ?? '')) return null;
  return { sub: Number(sub), index: Number(index), part: part as PathTarget['part'] };
}

export function penAddPoint(draft: PenDraft, point: Point): PenDraft {
  return { ...draft, points: [...draft.points, { x: round(point.x), y: round(point.y) }] };
}

/** 펜으로 점을 찍은 채 끌면 마지막 점에 대칭 핸들을 단다(Figma와 같음). 거의 안 끌었으면 모서리 점으로 둔다. */
export function penSetHandle(draft: PenDraft, point: Point, minDistance: number): PenDraft {
  const last = draft.points[draft.points.length - 1];
  if (!last) return draft;
  const anchor = { x: last.x, y: last.y };
  const next: PathPoint = Math.hypot(point.x - last.x, point.y - last.y) < minDistance
    ? anchor
    : { ...anchor, out: { x: round(point.x), y: round(point.y) }, in: { x: round(2 * last.x - point.x), y: round(2 * last.y - point.y) } };
  return { ...draft, points: [...draft.points.slice(0, -1), next] };
}

/**
 * 펜 경로로 새 벡터를 만든다. 상자는 경로가 차지하는 영역이고 경로는 상자 지역 좌표다.
 * 닫힌 경로는 회색 채우기, 열린 경로는 채우기 없이 검은 선만 둔다(Figma 기본값).
 */
export function penNodeInput(draft: PenDraft, closed: boolean, id: string, parentId: string | null): NodeInput | null {
  if (draft.points.length < 2) return null;
  const world: SubPath[] = [{ closed, points: draft.points }];
  const bounds = pathBounds(world);
  if (!bounds) return null;
  return {
    id, type: 'vector', name: 'Vector', parentId, x: round(bounds.x), y: round(bounds.y),
    width: Math.max(0.01, round(bounds.width)), height: Math.max(0.01, round(bounds.height)),
    fills: closed ? [{ type: 'solid', color: '#c4c4c4' }] : [], strokes: [{ color: '#000000', width: 2, align: 'center' }],
    path: mapPath(world, (point) => ({ x: point.x - bounds.x, y: point.y - bounds.y }))
  };
}

/**
 * 점 또는 핸들을 p(도형 지역 좌표)로 옮긴 새 경로. 점을 옮기면 핸들이 같이 따라간다.
 * 핸들을 옮길 때 mirror면 반대쪽 핸들을 대칭으로 맞춘다(Alt를 누르면 끊어서 따로 움직인다).
 */
export function movePathPart(path: readonly SubPath[], target: PathTarget, p: Point, mirror: boolean): SubPath[] {
  return path.map((subpath, sub) => sub !== target.sub ? subpath : {
    ...subpath,
    points: subpath.points.map((point, index) => index !== target.index ? point : movedPoint(point, target.part, { x: round(p.x), y: round(p.y) }, mirror))
  });
}

function movedPoint(point: PathPoint, part: PathTarget['part'], p: Point, mirror: boolean): PathPoint {
  if (part === 'anchor') {
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    const shift = (h: Point): Point => ({ x: round(h.x + dx), y: round(h.y + dy) });
    return { ...p, ...(point.in ? { in: shift(point.in) } : {}), ...(point.out ? { out: shift(point.out) } : {}) };
  }
  const other = part === 'in' ? 'out' : 'in';
  const opposite = mirror && point[other] ? { [other]: { x: round(2 * point.x - p.x), y: round(2 * point.y - p.y) } } : {};
  return { ...point, [part]: p, ...opposite };
}

/** 점 하나를 지운 경로. 점이 둘보다 적게 남는 하위 경로는 없앤다. */
export function removePathPoint(path: readonly SubPath[], sub: number, index: number): SubPath[] {
  return path
    .map((subpath, position) => position !== sub ? subpath : { ...subpath, points: subpath.points.filter((_, at) => at !== index) })
    .filter((subpath) => subpath.points.length >= 2);
}

/**
 * 점을 곡선 점↔모서리 점으로 바꾼다. 핸들이 있으면 지우고, 없으면 이웃 점을 잇는 방향으로 이웃 거리의 1/4 길이 핸들을 단다.
 * Figma에서 점을 더블클릭하는 동작과 같다.
 */
export function toggleSmooth(path: readonly SubPath[], sub: number, index: number): SubPath[] {
  return path.map((subpath, position) => {
    if (position !== sub) return subpath;
    const points = subpath.points;
    const point = points[index];
    if (!point) return subpath;
    const { in: _in, out: _out, ...corner } = point;
    if (point.in || point.out) return { ...subpath, points: points.map((item, at) => at === index ? corner : item) };
    const count = points.length;
    const prev = points[(index - 1 + count) % count]!;
    const next = points[(index + 1) % count]!;
    const dx = (next.x - prev.x) / 4;
    const dy = (next.y - prev.y) / 4;
    const smooth = { ...corner, in: { x: round(point.x - dx), y: round(point.y - dy) }, out: { x: round(point.x + dx), y: round(point.y + dy) } };
    return { ...subpath, points: points.map((item, at) => at === index ? smooth : item) };
  });
}

/** 그리는 중인 펜 경로와 마지막 점에서 포인터까지의 미리보기 선. 페이지 좌표로 그린다. */
export function PenOverlay({ draft, cursor, unit }: { draft: PenDraft; cursor: Point | null; unit: number }): JSX.Element {
  const last = draft.points[draft.points.length - 1];
  const first = draft.points[0];
  return (
    <svg className="path-overlay" width="1" height="1" overflow="visible">
      <path d={pathToD([{ closed: false, points: draft.points }])} fill="none" stroke="#687aff" strokeWidth={1.5 * unit} />
      {last && cursor ? <line x1={last.out?.x ?? last.x} y1={last.out?.y ?? last.y} x2={cursor.x} y2={cursor.y} stroke="#687aff" strokeWidth={unit} strokeDasharray={`${4 * unit} ${3 * unit}`} /> : null}
      {last?.in ? <HandleLines point={last} unit={unit} /> : null}
      {draft.points.map((point, index) => <rect key={index} x={point.x - 3.5 * unit} y={point.y - 3.5 * unit} width={7 * unit} height={7 * unit} fill={index === 0 && first ? '#687aff' : '#fff'} stroke="#687aff" strokeWidth={unit} />)}
    </svg>
  );
}

function HandleLines({ point, unit, prefix }: { point: PathPoint; unit: number; prefix?: string }): JSX.Element {
  return (
    <>
      {(['in', 'out'] as const).map((part) => {
        const handle = point[part];
        if (!handle) return null;
        return (
          <g key={part}>
            <line x1={point.x} y1={point.y} x2={handle.x} y2={handle.y} stroke="#687aff" strokeWidth={unit} />
            <circle className="path-handle" data-path-part={prefix ? `${prefix}:${part}` : undefined} cx={handle.x} cy={handle.y} r={3.5 * unit} fill="#fff" stroke="#687aff" strokeWidth={unit} />
          </g>
        );
      })}
    </>
  );
}

/**
 * 경로 편집 오버레이. 도형 지역 좌표로 그리고 도형의 월드 행렬로 놓아 회전된 벡터에서도 점이 제자리에 온다.
 * 투명한 굵은 선(data-path-segment)은 경로 위를 눌러 점을 넣는 데, 점·핸들(data-path-part)은 끌어 옮기는 데 쓴다.
 */
export function PathEditOverlay({ node, unit, active }: { node: DesignNode; unit: number; active: { sub: number; index: number } | null }): JSX.Element | null {
  if (!node.path) return null;
  const d = pathToD(node.path);
  return (
    <div className="path-edit-layer" style={{ width: node.width, height: node.height, transform: cssMatrix(worldMatrix(node)) }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${node.width} ${node.height}`} overflow="visible">
        <path className="path-segment-hit" data-path-segment="true" d={d} fill="none" stroke="transparent" strokeWidth={10 * unit} />
        <path d={d} fill="none" stroke="#687aff" strokeWidth={1.5 * unit} pointerEvents="none" />
        {node.path.map((subpath, sub) => subpath.points.map((point, index) => {
          const selected = active?.sub === sub && active.index === index;
          return (
            <g key={`${sub}:${index}`}>
              {selected ? <HandleLines point={point} unit={unit} prefix={`${sub}:${index}`} /> : null}
              <rect className="path-anchor" data-path-part={`${sub}:${index}:anchor`} x={point.x - 4 * unit} y={point.y - 4 * unit} width={8 * unit} height={8 * unit} fill={selected ? '#687aff' : '#fff'} stroke="#687aff" strokeWidth={unit} />
            </g>
          );
        }))}
      </svg>
    </div>
  );
}

const BOOL_LABELS: Array<[BoolOp, string, string]> = [
  ['union', '합치기', 'U'], ['subtract', '빼기', 'S'], ['intersect', '교차', 'I'], ['exclude', '제외', 'X']
];

/** 여러 요소를 골랐을 때 보이는 불리언 버튼 네 개. */
export function BooleanButtons({ onApply }: { onApply: (op: BoolOp) => void }): JSX.Element {
  return (
    <div className="bool-buttons">
      {BOOL_LABELS.map(([op, label, key]) => <button key={op} title={`${label} (Ctrl+Alt+${key})`} onClick={() => onApply(op)}>{label}</button>)}
    </div>
  );
}

interface PathSectionProps { node: DesignNode; onOp: (op: BoolOp) => void; onFlatten: () => void; onEditPath: () => void }

/** 속성 패널의 경로 영역. 불리언 그룹은 연산 종류와 평탄화, 벡터·사각형·타원은 경로 편집을 보여준다. */
export function PathSection({ node, onOp, onFlatten, onEditPath }: PathSectionProps): JSX.Element | null {
  if (node.shapeRef) return null;
  if (node.boolOp) {
    return (
      <>
        <div className="section-title">불리언</div>
        <label className="field full"><span>연산</span>
          <select value={node.boolOp} onChange={(event) => onOp(event.target.value as BoolOp)}>{BOOL_LABELS.map(([op, label]) => <option key={op} value={op}>{label}</option>)}</select>
        </label>
        <button className="wide-action" title="Ctrl+E" onClick={onFlatten}>평탄화(경로로 바꾸기)</button>
      </>
    );
  }
  if (node.type !== 'vector' && node.type !== 'rectangle' && node.type !== 'ellipse') return null;
  return (
    <>
      <div className="section-title">경로</div>
      <button className="wide-action" title="벡터는 더블클릭, Enter로도 편집" onClick={onEditPath}>{node.type === 'vector' && node.path ? '경로 편집' : '경로로 바꿔 편집'}</button>
    </>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
