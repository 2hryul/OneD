import { useState, type DragEvent } from 'react';
import { isContainer, type DesignNode, type NodeType, type Page } from './model';
import { rotationDegrees } from './geometry';
import { layerRows } from './selection';
import { parseNumberInput } from './numberInput';

export type DropPosition = 'above' | 'below' | 'inside';

export function nodeIcon(node: DesignNode): string {
  if (node.sourceType === 'INSTANCE') return '◇';
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

interface PagesPanelProps { pages: readonly Page[]; currentId: string; onSwitch: (id: string) => void; onAdd: () => void }

export function PagesPanel({ pages, currentId, onSwitch, onAdd }: PagesPanelProps): JSX.Element {
  return (
    <div className="pages">
      <div className="pages-heading"><strong>페이지</strong><button title="페이지 추가" aria-label="페이지 추가" onClick={onAdd}>+</button></div>
      {pages.map((page) => <button key={page.id} className={`page-row ${page.id === currentId ? 'active' : ''}`} onClick={() => onSwitch(page.id)}>{page.name}</button>)}
    </div>
  );
}

interface LayersPanelProps {
  page: Page;
  selectedIds: readonly string[];
  onSelect: (id: string, additive: boolean) => void;
  onToggle: (id: string, key: 'hidden' | 'locked') => void;
  onDrop: (dragId: string, targetId: string, position: DropPosition) => void;
}

/** 레이어 트리. 위에 그려지는 도형이 위에 오고, 끌어서 순서·부모를 바꾼다. 프레임·그룹 행의 가운데에 놓으면 그 안으로 들어간다. */
export function LayersPanel({ page, selectedIds, onSelect, onToggle, onDrop }: LayersPanelProps): JSX.Element {
  const [dragging, setDragging] = useState<string | null>(null);
  const [hint, setHint] = useState<{ id: string; position: DropPosition } | null>(null);
  const rows = layerRows(page);
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
          <span className="layer-icon">{nodeIcon(node)}</span>
          <span className="layer-name">{node.name}</span>
          <span className="layer-actions">
            <button title={node.hidden ? '보이기' : '숨기기'} aria-label={node.hidden ? '보이기' : '숨기기'} onClick={(event) => { event.stopPropagation(); onToggle(node.id, 'hidden'); }}>{node.hidden ? '○' : '◉'}</button>
            <button title={node.locked ? '잠금 해제' : '잠그기'} aria-label={node.locked ? '잠금 해제' : '잠그기'} className={node.locked ? 'on' : ''} onClick={(event) => { event.stopPropagation(); onToggle(node.id, 'locked'); }}>{node.locked ? '■' : '□'}</button>
          </span>
        </div>
      ))}
    </div>
  );
}

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
}

export function PropertiesPanel({ node, onChange, onRotate, onOpenCode, onDelete }: PropertiesPanelProps): JSX.Element {
  return (
    <div className="properties">
      <div className="selection-header"><span className="selection-icon">{nodeIcon(node)}</span><div><strong>{node.name}</strong><small>{node.sourceType ?? node.type}</small></div></div>
      <label className="field full"><span>이름</span><input value={node.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
      <div className="section-title">레이아웃</div>
      <div className="fields-grid">
        {(['x', 'y', 'width', 'height'] as const).map((key) => <label className="field" key={key}><span>{key.toUpperCase()}</span><NumberField value={node[key]} min={key === 'width' || key === 'height' ? 1 : undefined} onCommit={(next) => onChange({ [key]: next })} /></label>)}
        <label className="field"><span>회전</span><NumberField value={rotationDegrees(node.transform)} onCommit={onRotate} /></label>
      </div>
      <div className="section-title">표현</div>
      {node.type !== 'group' ? <label className="field full"><span>{node.type === 'text' ? '글자색' : '채우기'}</span><div className="color-field"><input type="color" value={/^#[0-9a-f]{6}$/i.test(node.fill) ? node.fill : '#000000'} onChange={(event) => onChange({ fill: event.target.value })} /><input value={node.fill} onChange={(event) => onChange({ fill: event.target.value })} /></div></label> : null}
      {node.layout ? <div className="import-detail">오토 레이아웃 {node.layout === 'VERTICAL' ? '세로' : node.layout === 'HORIZONTAL' ? '가로' : '그리드'} · 간격 {node.gap ?? 0}px</div> : null}
      {node.type === 'rectangle' || node.type === 'frame' ? <label className="field full"><span>모서리 반경</span><NumberField value={node.radius ?? 0} min={0} onCommit={(next) => onChange({ radius: next })} /></label> : null}
      {node.type === 'text' ? <><label className="field full"><span>텍스트</span><textarea rows={3} value={node.text ?? ''} onChange={(event) => onChange({ text: event.target.value })} /></label><label className="field full"><span>글자 크기</span><NumberField value={node.fontSize ?? 18} min={1} onCommit={(next) => onChange({ fontSize: next })} /></label></> : null}
      <div className="section-title">내보내기</div><button className="wide-action" onClick={onOpenCode}>React 컴포넌트 보기 →</button>
      <button className="danger-link" onClick={onDelete}>요소 삭제</button>
    </div>
  );
}
