import { memo, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { isContainer, type DesignNode, type NodeType, type Page } from './model';
import { rotationDegrees } from './geometry';
import { layerRows } from './selection';
import { parseNumberInput } from './numberInput';
import { EffectsSection, FillsSection, StrokesSection, TextSection } from './stylePanels';
import { AutoLayoutSection, ConstraintsSection, SizingSection } from './layoutPanels';

export type DropPosition = 'above' | 'below' | 'inside';

export function nodeIcon(node: DesignNode): string {
  if (node.componentSet) return '⬖';
  if (node.mainInstance) return '◆';
  if (node.componentId) return '◇';
  const icons: Record<NodeType, string> = { frame: '▣', group: '⧉', rectangle: '▭', ellipse: '◯', text: 'T', vector: '⌁' };
  return icons[node.type];
}

/**
 * 입력 중인 원문을 따로 보관하는 숫자 입력칸.
 * 문서 값에 바로 묶으면 칸을 비우는 순간 이전 값이 되돌아와 새 숫자를 입력할 수 없다.
 *
 * Args:
 *   value: 문서에 저장된 현재 값
 *   min: 허용하는 최솟값
 *   onCommit: 해석 가능한 값이 입력될 때마다 호출된다
 */
export function NumberField({ value, min, onCommit }: { value: number; min?: number; onCommit: (next: number) => void }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  return <input type="number" min={min} value={draft ?? value} onBlur={() => setDraft(null)} onChange={(event) => {
    setDraft(event.target.value);
    const next = parseNumberInput(event.target.value, Number.NaN, min);
    if (!Number.isNaN(next)) onCommit(next);
  }} />;
}

interface PagesPanelProps {
  pages: readonly Page[];
  currentId: string;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/** 페이지 목록. 이름을 더블클릭해 바꾸고, 올리면 보이는 ×로 지운다(되돌리기 가능). 한 페이지만 남으면 지우기 버튼을 감춘다. */
export function PagesPanel({ pages, currentId, onSwitch, onAdd, onRename, onDelete }: PagesPanelProps): JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div className="pages">
      <div className="pages-heading"><strong>페이지</strong><button title="페이지 추가" aria-label="페이지 추가" onClick={onAdd}>+</button></div>
      {pages.map((page) => (
        <div key={page.id} className={`page-row ${page.id === currentId ? 'active' : ''}`} onClick={() => onSwitch(page.id)}>
          {renaming === page.id
            ? <input className="layer-rename" autoFocus defaultValue={page.name} aria-label="페이지 이름" onClick={(event) => event.stopPropagation()} onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = page.name; event.currentTarget.blur(); } }}
              onBlur={(event) => { onRename(page.id, event.currentTarget.value); setRenaming(null); }} />
            : <span className="page-name" title="더블클릭해 이름 바꾸기" onDoubleClick={(event) => { event.stopPropagation(); setRenaming(page.id); }}>{page.name}</span>}
          {pages.length > 1 && renaming !== page.id ? <button className="page-delete" title="페이지 지우기" aria-label={`${page.name} 페이지 지우기`} onClick={(event) => { event.stopPropagation(); onDelete(page.id); }}>×</button> : null}
        </div>
      ))}
    </div>
  );
}

interface LayersPanelProps {
  page: Page;
  selectedIds: readonly string[];
  onSelect: (id: string, additive: boolean) => void;
  onToggle: (id: string, key: 'hidden' | 'locked') => void;
  /** 레이어 이름을 더블클릭해 바꾼 결과. */
  onRename: (id: string, name: string) => void;
  onDrop: (dragId: string, targetId: string, position: DropPosition) => void;
}

/** 레이어 트리. 위에 그려지는 도형이 위에 오고, 끌어서 순서·부모를 바꾼다. 프레임·그룹 행의 가운데에 놓으면 그 안으로 들어간다. */
/** 선택한 도형의 조상 id. 레이어 패널에서 선택이 보이도록 이 컨테이너들은 펼친다. */
function ancestorsOf(page: Page, ids: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    for (let parent = page.objects[id]?.parentId; parent && !result.has(parent); parent = page.objects[parent]?.parentId) result.add(parent);
  }
  return result;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * 레이어 패널. 컨테이너는 접힌 채 시작하고(▸로 펼침), 선택한 도형의 조상은 자동으로 펼친다.
 * 문서·선택·콜백이 그대로면 다시 그리지 않는다(화면 이동 때 수천 행을 다시 만들지 않기 위해).
 */
export const LayersPanel = memo(function LayersPanel({ page, selectedIds, onSelect, onToggle, onDrop, onRename }: LayersPanelProps): JSX.Element {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hint, setHint] = useState<{ id: string; position: DropPosition } | null>(null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const expanded = useMemo(() => new Set([...ancestorsOf(page, selectedIds), ...opened].filter((id) => !closed.has(id))), [page, selectedIds, opened, closed]);
  const rows = useMemo(() => layerRows(page, expanded), [page, expanded]);
  const toggleOpen = (id: string): void => {
    const open = !expanded.has(id);
    setOpened((current) => { const next = new Set(current); if (open) next.add(id); else next.delete(id); return next; });
    setClosed((current) => { const next = new Set(current); if (open) next.delete(id); else next.add(id); return next; });
  };
  const reset = (): void => { setDragging(null); setHint(null); };
  if (rows.length === 0) return <div className="layer-list"><p className="empty">도구로 새 요소를 만들어 보세요.</p></div>;
  return (
    <div className="layer-list">
      {rows.map(({ node, depth }) => (
        <div
          key={node.id}
          data-layer-id={node.id}
          className={`layer-row ${selectedIds.includes(node.id) ? 'selected' : ''} ${node.hidden ? 'is-hidden' : ''} ${hint?.id === node.id ? `drop-${hint.position}` : ''}`}
          style={{ paddingLeft: 15 + depth * 14 }}
          draggable
          onClick={(event) => onSelect(node.id, event.shiftKey)}
          onDragStart={(event) => { setDragging(node.id); event.dataTransfer.setData('text/plain', node.id); event.dataTransfer.effectAllowed = 'move'; }}
          onDragOver={(event) => { if (!dragging || dragging === node.id) return; event.preventDefault(); setHint({ id: node.id, position: dropPosition(event, node) }); }}
          onDrop={(event) => { event.preventDefault(); if (dragging && hint) onDrop(dragging, node.id, hint.position); reset(); }}
          onDragEnd={reset}
        >
          {node.children?.length ? <button className="layer-caret" aria-label={expanded.has(node.id) ? '접기' : '펼치기'} onClick={(event) => { event.stopPropagation(); toggleOpen(node.id); }}>{expanded.has(node.id) ? '▾' : '▸'}</button> : <span className="layer-caret" />}
          <span className="layer-icon">{nodeIcon(node)}</span>
          {renaming === node.id
            ? <input className="layer-rename" autoFocus defaultValue={node.name} aria-label="레이어 이름" onClick={(event) => event.stopPropagation()} onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.currentTarget.value = node.name; event.currentTarget.blur(); } }}
              onBlur={(event) => { onRename(node.id, event.currentTarget.value); setRenaming(null); }} />
            : <span className="layer-name" title="더블클릭해 이름 바꾸기" onDoubleClick={(event) => { event.stopPropagation(); setRenaming(node.id); }}>{node.name}</span>}
          <span className="layer-actions">
            <button title={node.hidden ? '보이기' : '숨기기'} aria-label={node.hidden ? '보이기' : '숨기기'} onClick={(event) => { event.stopPropagation(); onToggle(node.id, 'hidden'); }}>{node.hidden ? '○' : '◉'}</button>
            <button title={node.locked ? '잠금 해제' : '잠그기'} aria-label={node.locked ? '잠금 해제' : '잠그기'} className={node.locked ? 'on' : ''} onClick={(event) => { event.stopPropagation(); onToggle(node.id, 'locked'); }}>{node.locked ? '■' : '□'}</button>
          </span>
        </div>
      ))}
    </div>
  );
}, (prev, next) => prev.page === next.page && sameIds(prev.selectedIds, next.selectedIds) && prev.onSelect === next.onSelect && prev.onToggle === next.onToggle && prev.onDrop === next.onDrop && prev.onRename === next.onRename);

function dropPosition(event: DragEvent<HTMLDivElement>, node: DesignNode): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  if (isContainer(node) && ratio > 0.3 && ratio < 0.7) return 'inside';
  return ratio < 0.5 ? 'above' : 'below';
}

interface PropertiesPanelProps {
  node: DesignNode;
  onChange: (patch: Partial<DesignNode>) => void;
  onRotate: (degrees: number) => void;
  onOpenCode: () => void;
  onDelete: () => void;
  onPickImage: (index: number) => void;
  /** 레이아웃·제약 항목을 보여줄지 정하는 부모. 최상위 도형이면 없다. */
  parent?: DesignNode;
  /** 맨 위에 넣을 컴포넌트 영역과, 스타일 뒤에 넣을 토큰 영역. */
  header?: ReactNode;
  tokens?: ReactNode;
  /** 불리언·경로 편집 영역. 도형 속성 뒤에 넣는다. */
  path?: ReactNode;
  /** 내보내기 영역에 덧붙일 그림 내보내기 줄. */
  exportRow?: ReactNode;
}

export function PropertiesPanel({ node, parent, header, tokens, path, exportRow, onChange, onRotate, onOpenCode, onDelete, onPickImage }: PropertiesPanelProps): JSX.Element {
  return (
    <div className="properties">
      <div className="selection-header"><span className="selection-icon">{nodeIcon(node)}</span><div><strong>{node.name}</strong><small>{node.sourceType ?? node.type}</small></div></div>
      {header}
      <label className="field full"><span>이름</span><input value={node.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
      <div className="section-title">레이아웃</div>
      <div className="fields-grid">
        {(['x', 'y', 'width', 'height'] as const).map((key) => <label className="field" key={key}><span>{key.toUpperCase()}</span><NumberField value={node[key]} min={key === 'width' || key === 'height' ? 1 : undefined} onCommit={(next) => onChange({ [key]: next })} /></label>)}
        <label className="field"><span>회전</span><NumberField value={rotationDegrees(node.transform)} onCommit={onRotate} /></label>
      </div>
      <div className="section-title">표현</div>
      {node.type === 'frame' ? <AutoLayoutSection node={node} onChange={onChange} /> : null}
      <SizingSection node={node} parent={parent} onChange={onChange} />
      {parent?.type === 'frame' && !parent.layout ? <ConstraintsSection node={node} onChange={onChange} /> : null}
      {node.type === 'rectangle' || node.type === 'frame' ? <label className="field full"><span>모서리 반경</span><NumberField value={node.radius ?? 0} min={0} onCommit={(next) => onChange({ radius: next })} /></label> : null}
      <label className="field full"><span>불투명도 (%)</span><NumberField value={Math.round((node.opacity ?? 1) * 100)} min={0} onCommit={(next) => onChange({ opacity: Math.min(100, next) / 100 })} /></label>
      {node.type === 'text' ? <TextSection node={node} onChange={onChange} /> : null}
      {node.type !== 'group' && node.type !== 'vector' ? <FillsSection node={node} title={node.type === 'text' ? '글자색' : '채우기'} onChange={onChange} onPickImage={onPickImage} /> : null}
      {node.type !== 'text' && node.type !== 'vector' ? <StrokesSection node={node} onChange={onChange} /> : null}
      <EffectsSection node={node} onChange={onChange} />
      {path}
      {tokens}
      <div className="section-title">내보내기</div>{exportRow}<button className="wide-action" onClick={onOpenCode}>React 컴포넌트 보기 →</button>
      <button className="danger-link" onClick={onDelete}>요소 삭제</button>
    </div>
  );
}
