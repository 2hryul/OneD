import { useEffect, useState } from 'react';
import type { Constraints, DesignNode, FlexAlign, FlexJustify, FlexLayout, GridLayout, GridTrack, HConstraint, ItemSizing, Layout, LayoutItem, VConstraint } from './model';
import { NumberField } from './panels';
import { formatTracks, parseTracks } from './gridLayout';

type Change = (patch: Partial<DesignNode>) => void;

const JUSTIFY_LABEL: Record<FlexJustify, string> = { start: '앞', center: '가운데', end: '뒤', 'space-between': '자동 간격' };
const ALIGN_LABEL: Record<FlexAlign, string> = { start: '앞', center: '가운데', end: '뒤', stretch: '늘이기' };
const SIZING_LABEL: Record<ItemSizing, string> = { fix: '고정', fill: '채우기', auto: '내용에 맞춤' };
const H_LABEL: Record<HConstraint, string> = { left: '왼쪽', right: '오른쪽', center: '가운데', 'left-right': '왼쪽·오른쪽', scale: '비율' };
const V_LABEL: Record<VConstraint, string> = { top: '위', bottom: '아래', center: '가운데', 'top-bottom': '위·아래', scale: '비율' };
const PADDING_LABEL = ['위', '오른쪽', '아래', '왼쪽'] as const;

export const DEFAULT_FLEX: FlexLayout = { type: 'flex', direction: 'column', wrap: false, gap: 10, crossGap: 10, padding: [10, 10, 10, 10], justify: 'start', align: 'start' };
export const DEFAULT_GRID: GridLayout = { type: 'grid', columns: [{ type: 'flex', value: 1 }, { type: 'flex', value: 1 }], rows: [], columnGap: 10, rowGap: 10, padding: [10, 10, 10, 10], justifyItems: 'start', alignItems: 'start' };

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (value: T) => void }): JSX.Element {
  return (
    <label className="field"><span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {(Object.keys(options) as T[]).map((key) => <option key={key} value={key}>{options[key]}</option>)}
      </select>
    </label>
  );
}

/** 레이아웃 종류 선택값. */
type LayoutKind = 'column' | 'row' | 'grid';
const KIND_LABEL: Record<LayoutKind, string> = { column: '세로', row: '가로', grid: '그리드' };

/** 종류를 바꿀 때 여백과 간격은 유지한다. 그리드로 바꾸면 2열 비율 트랙에서 시작한다. */
function switchKind(layout: Layout, kind: LayoutKind): Layout {
  if (kind === 'grid') return layout.type === 'grid' ? layout : { ...DEFAULT_GRID, padding: layout.padding, columnGap: layout.gap, rowGap: layout.wrap ? layout.crossGap : layout.gap };
  const base = layout.type === 'flex' ? layout : { ...DEFAULT_FLEX, padding: layout.padding, gap: layout.columnGap };
  return { ...base, direction: kind };
}

/** 프레임의 오토 레이아웃(세로·가로 flex와 그리드). 추가하면 자식이 즉시 다시 배치되고, 제거하면 자식은 지금 위치에 남는다. */
export function AutoLayoutSection({ node, onChange }: { node: DesignNode; onChange: Change }): JSX.Element {
  const layout = node.layout;
  return (
    <section className="style-section">
      <div className="style-heading"><span>오토 레이아웃</span>
        {layout ? <button aria-label="오토 레이아웃 제거" title="오토 레이아웃 제거" onClick={() => onChange({ layout: undefined })}>−</button>
          : <button aria-label="오토 레이아웃 추가" title="오토 레이아웃 추가" onClick={() => onChange({ layout: DEFAULT_FLEX })}>+</button>}
      </div>
      {layout ? (
        <>
          <div className="fields-grid">
            <Select label="종류" value={layout.type === 'grid' ? 'grid' : layout.direction} options={KIND_LABEL} onChange={(kind) => onChange({ layout: switchKind(layout, kind) })} />
          </div>
          {layout.type === 'grid' ? <GridFields layout={layout} onChange={(next) => onChange({ layout: next })} /> : <FlexFields layout={layout} onChange={(next) => onChange({ layout: next })} />}
        </>
      ) : null}
    </section>
  );
}

function PaddingFields({ padding, onCommit }: { padding: Layout['padding']; onCommit: (padding: Layout['padding']) => void }): JSX.Element {
  return (
    <>
      {PADDING_LABEL.map((label, index) => (
        <label className="field" key={label}><span>여백 {label}</span><NumberField value={padding[index]!} min={0} onCommit={(value) => onCommit(padding.map((item, position) => (position === index ? value : item)) as Layout['padding'])} /></label>
      ))}
    </>
  );
}

function FlexFields({ layout, onChange }: { layout: FlexLayout; onChange: (layout: FlexLayout) => void }): JSX.Element {
  const set = (patch: Partial<FlexLayout>): void => onChange({ ...layout, ...patch });
  return (
    <>
      <div className="fields-grid">
        <label className="field"><span>간격</span><NumberField value={layout.gap} min={0} onCommit={(gap) => set({ gap })} /></label>
        <Select label="주축 정렬" value={layout.justify} options={JUSTIFY_LABEL} onChange={(justify) => set({ justify })} />
        <Select label="교차축 정렬" value={layout.align} options={ALIGN_LABEL} onChange={(align) => set({ align })} />
        <PaddingFields padding={layout.padding} onCommit={(padding) => set({ padding })} />
      </div>
      <div className="style-line">
        <label className="check"><input type="checkbox" checked={layout.wrap} onChange={(event) => set({ wrap: event.target.checked })} />줄바꿈</label>
        {layout.wrap ? <label className="mini"><span>줄 간격</span><NumberField value={layout.crossGap} min={0} onCommit={(crossGap) => set({ crossGap })} /></label> : null}
      </div>
    </>
  );
}

/**
 * 트랙 입력칸. CSS처럼 "1fr 1fr 120px auto"로 적고, Enter나 칸을 벗어날 때 반영한다.
 * 읽을 수 없는 글자면 반영하지 않고 원래 값으로 되돌린다. 열은 하나 이상이어야 한다.
 */
function TrackField({ label, tracks, required, onCommit }: { label: string; tracks: GridTrack[]; required: boolean; onCommit: (tracks: GridTrack[]) => void }): JSX.Element {
  const text = formatTracks(tracks);
  const [draft, setDraft] = useState(text);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(text); setInvalid(false); }, [text]);
  const commit = (): void => {
    const parsed = parseTracks(draft);
    if (!parsed || (required && parsed.length === 0)) { setInvalid(true); setDraft(text); return; }
    setInvalid(false);
    if (formatTracks(parsed) !== text) onCommit(parsed);
  };
  return (
    <label className="field full"><span>{label}{invalid ? ' (예: 1fr 1fr 120px auto)' : ''}</span>
      <input value={draft} placeholder={required ? '1fr 1fr' : 'auto'} aria-invalid={invalid || undefined} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </label>
  );
}

function GridFields({ layout, onChange }: { layout: GridLayout; onChange: (layout: GridLayout) => void }): JSX.Element {
  const set = (patch: Partial<GridLayout>): void => onChange({ ...layout, ...patch });
  return (
    <>
      <TrackField label="열" tracks={layout.columns} required onCommit={(columns) => set({ columns })} />
      <TrackField label="행 (비우면 내용에 맞춤)" tracks={layout.rows} required={false} onCommit={(rows) => set({ rows })} />
      <div className="fields-grid">
        <label className="field"><span>열 간격</span><NumberField value={layout.columnGap} min={0} onCommit={(columnGap) => set({ columnGap })} /></label>
        <label className="field"><span>행 간격</span><NumberField value={layout.rowGap} min={0} onCommit={(rowGap) => set({ rowGap })} /></label>
        <Select label="칸 안 가로" value={layout.justifyItems} options={ALIGN_LABEL} onChange={(justifyItems) => set({ justifyItems })} />
        <Select label="칸 안 세로" value={layout.alignItems} options={ALIGN_LABEL} onChange={(alignItems) => set({ alignItems })} />
        <PaddingFields padding={layout.padding} onCommit={(padding) => set({ padding })} />
      </div>
    </>
  );
}

/** Grid 칸 지정. 자동이면 빈 칸을 행 순서로 채운다. 번호는 사람에게 1부터 보여 준다. */
function GridCellFields({ cell, onChange }: { cell?: { row: number; column: number }; onChange: (cell: { row: number; column: number } | undefined) => void }): JSX.Element {
  return (
    <>
      <label className="check"><input type="checkbox" checked={!cell} onChange={(event) => onChange(event.target.checked ? undefined : { row: 0, column: 0 })} />칸 자동 배치</label>
      {cell ? (
        <div className="fields-grid">
          <label className="field"><span>행</span><NumberField value={cell.row + 1} min={1} onCommit={(row) => onChange({ ...cell, row: Math.max(0, Math.round(row) - 1) })} /></label>
          <label className="field"><span>열</span><NumberField value={cell.column + 1} min={1} onCommit={(column) => onChange({ ...cell, column: Math.max(0, Math.round(column) - 1) })} /></label>
        </div>
      ) : null}
    </>
  );
}

/** 크기 규칙. 레이아웃 부모 안이면 채우기를, 레이아웃 컨테이너나 텍스트면 내용에 맞춤을 고를 수 있다. */
export function SizingSection({ node, parent, onChange }: { node: DesignNode; parent?: DesignNode; onChange: Change }): JSX.Element | null {
  const inFlow = Boolean(parent?.layout) && !node.item?.absolute;
  const canHug = Boolean(node.layout) || node.type === 'text';
  if (!inFlow && !canHug && !parent?.layout) return null;
  const options = (Object.keys(SIZING_LABEL) as ItemSizing[]).filter((key) => (key === 'fill' ? inFlow : key === 'auto' ? canHug : true));
  const choices = Object.fromEntries(options.map((key) => [key, SIZING_LABEL[key]])) as Record<ItemSizing, string>;
  const set = (patch: Partial<LayoutItem>): void => onChange({ item: cleanItem({ ...node.item, ...patch }) });
  return (
    <section className="style-section">
      <div className="style-heading"><span>크기 규칙</span></div>
      <div className="fields-grid">
        <Select label="가로" value={node.item?.h ?? 'fix'} options={choices} onChange={(h) => set({ h })} />
        <Select label="세로" value={node.item?.v ?? 'fix'} options={choices} onChange={(v) => set({ v })} />
      </div>
      {parent?.layout?.type === 'grid' && inFlow ? <GridCellFields cell={node.item?.gridCell} onChange={(gridCell) => set({ gridCell })} /> : null}
      {parent?.layout ? <label className="check"><input type="checkbox" checked={Boolean(node.item?.absolute)} onChange={(event) => set({ absolute: event.target.checked || undefined })} />레이아웃 무시(절대 위치)</label> : null}
    </section>
  );
}

/** 레이아웃이 없는 프레임 안의 자식이 부모 크기 변경을 따르는 방식. */
export function ConstraintsSection({ node, onChange }: { node: DesignNode; onChange: Change }): JSX.Element {
  const value: Constraints = node.constraints ?? { h: 'left', v: 'top' };
  const set = (patch: Partial<Constraints>): void => {
    const next = { ...value, ...patch };
    onChange({ constraints: next.h === 'left' && next.v === 'top' ? undefined : next });
  };
  return (
    <section className="style-section">
      <div className="style-heading"><span>제약</span></div>
      <div className="fields-grid">
        <Select label="가로" value={value.h} options={H_LABEL} onChange={(h) => set({ h })} />
        <Select label="세로" value={value.v} options={V_LABEL} onChange={(v) => set({ v })} />
      </div>
    </section>
  );
}

/** 기본값만 남은 항목은 지워 문서를 가볍게 유지한다. */
export function cleanItem(item: LayoutItem): LayoutItem | undefined {
  const entries = Object.entries(item).filter(([key, value]) => value !== undefined && !((key === 'h' || key === 'v') && value === 'fix'));
  return entries.length ? (Object.fromEntries(entries) as LayoutItem) : undefined;
}
