import type { Constraints, DesignNode, FlexAlign, FlexJustify, FlexLayout, HConstraint, ItemSizing, LayoutItem, VConstraint } from './model';
import { NumberField } from './panels';

type Change = (patch: Partial<DesignNode>) => void;

const JUSTIFY_LABEL: Record<FlexJustify, string> = { start: '앞', center: '가운데', end: '뒤', 'space-between': '자동 간격' };
const ALIGN_LABEL: Record<FlexAlign, string> = { start: '앞', center: '가운데', end: '뒤', stretch: '늘이기' };
const SIZING_LABEL: Record<ItemSizing, string> = { fix: '고정', fill: '채우기', auto: '내용에 맞춤' };
const H_LABEL: Record<HConstraint, string> = { left: '왼쪽', right: '오른쪽', center: '가운데', 'left-right': '왼쪽·오른쪽', scale: '비율' };
const V_LABEL: Record<VConstraint, string> = { top: '위', bottom: '아래', center: '가운데', 'top-bottom': '위·아래', scale: '비율' };
const PADDING_LABEL = ['위', '오른쪽', '아래', '왼쪽'] as const;

export const DEFAULT_FLEX: FlexLayout = { type: 'flex', direction: 'column', wrap: false, gap: 10, crossGap: 10, padding: [10, 10, 10, 10], justify: 'start', align: 'start' };

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (value: T) => void }): JSX.Element {
  return (
    <label className="field"><span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {(Object.keys(options) as T[]).map((key) => <option key={key} value={key}>{options[key]}</option>)}
      </select>
    </label>
  );
}

/** 프레임의 오토 레이아웃. 추가하면 자식이 즉시 다시 배치되고, 제거하면 자식은 지금 위치에 남는다. */
export function AutoLayoutSection({ node, onChange }: { node: DesignNode; onChange: Change }): JSX.Element {
  const layout = node.layout;
  const set = (patch: Partial<FlexLayout>): void => onChange({ layout: { ...layout!, ...patch } });
  return (
    <section className="style-section">
      <div className="style-heading"><span>오토 레이아웃</span>
        {layout ? <button aria-label="오토 레이아웃 제거" title="오토 레이아웃 제거" onClick={() => onChange({ layout: undefined })}>−</button>
          : <button aria-label="오토 레이아웃 추가" title="오토 레이아웃 추가" onClick={() => onChange({ layout: DEFAULT_FLEX })}>+</button>}
      </div>
      {layout ? (
        <>
          <div className="fields-grid">
            <Select label="방향" value={layout.direction} options={{ row: '가로', column: '세로' }} onChange={(direction) => set({ direction })} />
            <label className="field"><span>간격</span><NumberField value={layout.gap} min={0} onCommit={(gap) => set({ gap })} /></label>
            <Select label="주축 정렬" value={layout.justify} options={JUSTIFY_LABEL} onChange={(justify) => set({ justify })} />
            <Select label="교차축 정렬" value={layout.align} options={ALIGN_LABEL} onChange={(align) => set({ align })} />
            {PADDING_LABEL.map((label, index) => (
              <label className="field" key={label}><span>여백 {label}</span><NumberField value={layout.padding[index]!} min={0} onCommit={(value) => set({ padding: layout.padding.map((item, position) => (position === index ? value : item)) as FlexLayout['padding'] })} /></label>
            ))}
          </div>
          <div className="style-line">
            <label className="check"><input type="checkbox" checked={layout.wrap} onChange={(event) => set({ wrap: event.target.checked })} />줄바꿈</label>
            {layout.wrap ? <label className="mini"><span>줄 간격</span><NumberField value={layout.crossGap} min={0} onCommit={(crossGap) => set({ crossGap })} /></label> : null}
          </div>
        </>
      ) : null}
    </section>
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
