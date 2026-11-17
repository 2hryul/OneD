import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { addNode, deleteNode, moveNode, parseDocument, sampleDocument, updateNode, type DesignDocument, type DesignNode, type NodeType } from './model';
import { exportTsx } from './export';
import { figmaNodeId, importFigFile } from './figmaImport';

type Tool = 'select' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text';
type Drag = { kind: 'move' | 'resize' | 'pan'; startX: number; startY: number; before: DesignDocument; nodeId?: string; panX: number; panY: number };

const STORAGE_KEY = 'canvas-studio-v1';
const TOOLS: { id: Tool; icon: string; label: string; shortcut: string }[] = [
  { id: 'select', icon: '↖', label: '선택', shortcut: 'V' },
  { id: 'hand', icon: '✋', label: '손', shortcut: 'H' },
  { id: 'frame', icon: '▣', label: '프레임', shortcut: 'F' },
  { id: 'rectangle', icon: '▭', label: '사각형', shortcut: 'R' },
  { id: 'ellipse', icon: '◯', label: '타원', shortcut: 'O' },
  { id: 'text', icon: 'T', label: '텍스트', shortcut: 'T' }
];

function initialDocument(): DesignDocument {
  try { const saved = localStorage.getItem(STORAGE_KEY); return saved ? parseDocument(saved) : sampleDocument(); }
  catch { return sampleDocument(); }
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function numberValue(value: string, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function nodeIcon(type: NodeType): string {
  return { frame: '▣', rectangle: '▭', ellipse: '◯', text: 'T', vector: '⌁' }[type];
}

function layerDepth(node: DesignNode, byId: Map<string, DesignNode>): number {
  let depth = 0;
  let parentId = node.parentId;
  while (parentId && depth < 12) { depth++; parentId = byId.get(parentId)?.parentId ?? null; }
  return depth;
}

export function App(): JSX.Element {
  const [doc, setDocState] = useState<DesignDocument>(initialDocument);
  const docRef = useRef(doc);
  const history = useRef<{ past: DesignDocument[]; future: DesignDocument[] }>({ past: [], future: [] });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>('frame-1');
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(0.85);
  const zoomRef = useRef(zoom);
  const [pan, setPan] = useState({ x: 170, y: 92 });
  const panRef = useRef(pan);
  const [codeOpen, setCodeOpen] = useState(false);
  const [pendingFig, setPendingFig] = useState<File | null>(null);
  const [figInput, setFigInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('프레임 또는 요소를 선택해 편집하세요.');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const drag = useRef<Drag | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fitCanvas = useCallback((current: DesignDocument): void => {
    const viewport = viewportRef.current;
    if (!viewport || current.nodes.length === 0) return;
    const bounds = viewport.getBoundingClientRect();
    const minX = Math.min(...current.nodes.map((node) => node.x));
    const minY = Math.min(...current.nodes.map((node) => node.y));
    const maxX = Math.max(...current.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...current.nodes.map((node) => node.y + node.height));
    const nextZoom = Math.min(1, Math.max(0.2, Math.min((bounds.width - 80) / (maxX - minX), (bounds.height - 80) / (maxY - minY))));
    setZoom(nextZoom);
    setPan({ x: (bounds.width - (maxX - minX) * nextZoom) / 2 - minX * nextZoom,
      y: (bounds.height - (maxY - minY) * nextZoom) / 2 - minY * nextZoom });
  }, []);

  useEffect(() => { fitCanvas(docRef.current); }, [fitCanvas]);

  const setDoc = useCallback((next: DesignDocument) => { docRef.current = next; setDocState(next); }, []);
  const commit = useCallback((next: DesignDocument) => {
    if (JSON.stringify(next) === JSON.stringify(docRef.current)) return;
    history.current.past.push(docRef.current);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
    setDoc(next);
    setHistoryVersion((value) => value + 1);
  }, [setDoc]);

  const undo = useCallback(() => {
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(docRef.current); setDoc(previous); setHistoryVersion((value) => value + 1);
  }, [setDoc]);
  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(docRef.current); setDoc(next); setHistoryVersion((value) => value + 1);
  }, [setDoc]);
  void historyVersion;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)); }
    catch { setNotice('자동 저장 공간이 부족합니다. JSON 저장으로 파일을 보관하세요.'); }
  }, [doc]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { spaceHeldRef.current = spaceHeld; }, [spaceHeld]);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const current = drag.current;
      if (!current) return;
      if (current.kind === 'pan') { setPan({ x: current.panX + event.clientX - current.startX, y: current.panY + event.clientY - current.startY }); return; }
      const dx = Math.round((event.clientX - current.startX) / zoomRef.current);
      const dy = Math.round((event.clientY - current.startY) / zoomRef.current);
      if (!current.nodeId) return;
      if (current.kind === 'move') setDoc(moveNode(current.before, current.nodeId, dx, dy));
      else {
        const node = current.before.nodes.find((item) => item.id === current.nodeId);
        if (node) setDoc(updateNode(current.before, node.id, { width: Math.max(8, node.width + dx), height: Math.max(8, node.height + dy) }));
      }
    };
    const onUp = (): void => {
      const current = drag.current;
      if (current && current.kind !== 'pan' && JSON.stringify(current.before) !== JSON.stringify(docRef.current)) {
        history.current.past.push(current.before);
        history.current.future = [];
        setHistoryVersion((value) => value + 1);
      }
      drag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [setDoc]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !event.repeat) { setSpaceHeld(true); if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (editing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); commit(deleteNode(docRef.current, selectedId)); setSelectedId(null); return; }
      if (event.key === 'Escape') { setTool('select'); setSelectedId(null); return; }
      const match = TOOLS.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase());
      if (match) setTool(match.id);
    };
    const onKeyUp = (event: KeyboardEvent): void => { if (event.code === 'Space') setSpaceHeld(false); };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [selectedId, commit, undo, redo]);

  const selected = doc.nodes.find((node) => node.id === selectedId) ?? null;
  const nodesById = new Map(doc.nodes.map((node) => [node.id, node]));
  const exported = selected ? exportTsx(doc, selected.id) : null;

  const worldPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const bounds = viewportRef.current!.getBoundingClientRect();
    return { x: Math.round((clientX - bounds.left - panRef.current.x) / zoomRef.current), y: Math.round((clientY - bounds.top - panRef.current.y) / zoomRef.current) };
  };

  const startPan = (event: ReactPointerEvent): void => {
    drag.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, before: docRef.current, panX: panRef.current.x, panY: panRef.current.y };
  };

  const onCanvasDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button === 1 || tool === 'hand' || spaceHeldRef.current) { startPan(event); return; }
    if (tool === 'select') { setSelectedId(null); return; }
    const point = worldPoint(event.clientX, event.clientY);
    const frame = [...docRef.current.nodes].reverse().find((node) => node.type === 'frame' && point.x >= node.x && point.y >= node.y && point.x <= node.x + node.width && point.y <= node.y + node.height);
    const id = crypto.randomUUID();
    const defaults: Record<Exclude<Tool, 'select' | 'hand'>, { width: number; height: number; fill: string; name: string }> = {
      frame: { width: 360, height: 240, fill: '#ffffff', name: 'Frame' },
      rectangle: { width: 160, height: 100, fill: '#9aa8ff', name: 'Rectangle' },
      ellipse: { width: 120, height: 120, fill: '#ffc890', name: 'Ellipse' },
      text: { width: 220, height: 38, fill: '#17223a', name: 'Text' }
    };
    const base = defaults[tool];
    const node: DesignNode = { id, type: tool, name: base.name, parentId: tool === 'frame' ? null : frame?.id ?? null,
      x: point.x, y: point.y, width: base.width, height: base.height, fill: base.fill,
      ...(tool === 'text' ? { text: 'Double click to edit', fontSize: 22 } : {}),
      ...(tool === 'rectangle' ? { radius: 8 } : {}) };
    commit(addNode(docRef.current, node)); setSelectedId(id); setTool('select'); setNotice(`${base.name}을(를) 만들었습니다.`);
  };

  const onNodeDown = (event: ReactPointerEvent<HTMLDivElement>, node: DesignNode): void => {
    if (event.button === 1 || tool === 'hand' || spaceHeldRef.current) { event.stopPropagation(); startPan(event); return; }
    if (tool !== 'select') return;
    event.stopPropagation();
    setSelectedId(node.id);
    drag.current = { kind: 'move', nodeId: node.id, startX: event.clientX, startY: event.clientY, before: docRef.current, panX: panRef.current.x, panY: panRef.current.y };
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey) { setPan((value) => ({ x: value.x - event.deltaX, y: value.y - event.deltaY })); return; }
    event.preventDefault();
    const bounds = viewportRef.current!.getBoundingClientRect();
    const next = Math.min(3, Math.max(0.2, zoomRef.current * (event.deltaY < 0 ? 1.1 : 0.9)));
    const px = event.clientX - bounds.left; const py = event.clientY - bounds.top;
    const worldX = (px - panRef.current.x) / zoomRef.current; const worldY = (py - panRef.current.y) / zoomRef.current;
    setPan({ x: px - worldX * next, y: py - worldY * next }); setZoom(next);
  };

  const setProperty = (patch: Partial<DesignNode>): void => { if (selected) commit(updateNode(docRef.current, selected.id, patch)); };

  const openFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.fig')) {
        setPendingFig(file);
        setFigInput('');
      } else {
        const loaded = parseDocument(await file.text());
        setDoc(loaded); history.current = { past: [], future: [] }; setSelectedId(null); fitCanvas(loaded);
        setNotice(`${file.name}을(를) 열었습니다.`);
      }
    } catch (error) { setNotice(`열기 실패: ${error instanceof Error ? error.message : String(error)}`); }
    finally { event.target.value = ''; }
  };

  const importPendingFig = async (): Promise<void> => {
    if (!pendingFig) return;
    const id = figmaNodeId(figInput);
    if (!id) { setNotice('Figma 링크의 node-id 또는 779:23219 형식의 ID를 입력하세요.'); return; }
    setImporting(true);
    try {
      const imported = importFigFile(new Uint8Array(await pendingFig.arrayBuffer()), id);
      setDoc(imported.document); history.current = { past: [], future: [] }; setSelectedId(id); fitCanvas(imported.document);
      setNotice(`${imported.report.imported}개 요소 · 인스턴스 ${imported.report.expandedInstances}개 · override ${imported.report.appliedOverrides}개 적용/${imported.report.unappliedOverrides}개 미적용 · 도형 ${imported.report.approximatedShapes}개 근사`);
      setPendingFig(null);
    } catch (error) { setNotice(`가져오기 실패: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setImporting(false); }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◆</span><span>Canvas Studio</span></div>
        <div className="file-info"><input aria-label="문서 이름" value={doc.name} onChange={(event) => setDoc({ ...docRef.current, name: event.target.value })} /><span className="saved-dot" /> <span>자동 저장됨</span></div>
        <div className="top-actions">
          <button onClick={() => fileRef.current?.click()}>열기</button>
          <button onClick={() => download(`${doc.name || 'design'}.json`, JSON.stringify(doc, null, 2), 'application/json')}>JSON 저장</button>
          <button className="primary" disabled={!selected} onClick={() => setCodeOpen(true)}>React 코드</button>
          <input ref={fileRef} type="file" accept=".json,.fig,application/json" hidden onChange={(event) => { void openFile(event); }} />
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-list">{TOOLS.map((item) => <button key={item.id} className={`tool-button ${tool === item.id ? 'active' : ''}`} title={`${item.label} (${item.shortcut})`} aria-label={item.label} onClick={() => setTool(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</div>
        <span className="toolbar-divider" />
        <button title="실행 취소 (Ctrl+Z)" disabled={history.current.past.length === 0} onClick={undo}>↶</button>
        <button title="다시 실행 (Ctrl+Shift+Z)" disabled={history.current.future.length === 0} onClick={redo}>↷</button>
        <span className="toolbar-hint">Ctrl + 휠 확대 · Space + 드래그 이동</span>
      </div>

      <div className="workspace">
        <aside className="left-panel">
          <div className="panel-heading"><strong>레이어</strong><span>{doc.nodes.length}</span></div>
          <div className="layer-list">{doc.nodes.length === 0 ? <p className="empty">도구로 새 요소를 만들어 보세요.</p> : doc.nodes.map((node) => <button key={node.id} className={`layer-row ${selectedId === node.id ? 'selected' : ''}`} style={{ paddingLeft: 15 + layerDepth(node, nodesById) * 14 }} onClick={() => { setSelectedId(node.id); setTool('select'); }}><span className="layer-icon">{node.sourceType === 'INSTANCE' ? '◇' : nodeIcon(node.type)}</span><span className="layer-name">{node.name}</span></button>)}</div>
          <div className="left-footer"><span>페이지</span><strong>Page 1</strong></div>
        </aside>

        <main className="canvas-area">
          <div className="canvas-top-ruler"><span>0</span><span>200</span><span>400</span><span>600</span><span>800</span><span>1000</span></div>
          <div className="canvas-viewport" ref={viewportRef} onPointerDown={onCanvasDown} onWheel={onWheel} style={{ cursor: tool === 'hand' || spaceHeld ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
            <div className="canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              {doc.nodes.map((node) => {
                const style: CSSProperties = { left: node.x, top: node.y, width: node.width, height: node.height,
                  background: node.type === 'text' || node.type === 'vector' ? 'transparent' : node.fill,
                  color: node.type === 'text' ? node.fill : undefined,
                  fontSize: node.type === 'text' ? node.fontSize ?? 18 : undefined,
                  fontFamily: node.type === 'text' ? node.fontFamily : undefined,
                  fontWeight: node.type === 'text' ? node.fontWeight : undefined,
                  opacity: node.opacity,
                  borderRadius: node.type === 'ellipse' ? '50%' : node.radius ?? 0 };
                return <div key={node.id} className={`design-node node-${node.type} ${selectedId === node.id ? 'is-selected' : ''}`} style={style} onPointerDown={(event) => onNodeDown(event, node)} onDoubleClick={(event) => { event.stopPropagation(); if (node.type === 'text') { const text = window.prompt('텍스트', node.text ?? ''); if (text !== null) commit(updateNode(docRef.current, node.id, { text })); } }}>
                  {node.type === 'frame' && selectedId === node.id ? <span className="frame-label">{node.name}</span> : null}
                  {node.type === 'text' ? node.text : null}
                  {node.type === 'vector' ? <svg width="100%" height="100%" viewBox={`0 0 ${node.width} ${node.height}`} aria-hidden="true">{node.vectorPaths?.map((path, index) => <path key={index} d={path.d} fill={path.fill} stroke={path.stroke} strokeWidth={path.strokeWidth} />)}</svg> : null}
                  {selectedId === node.id ? <span className="resize-handle" onPointerDown={(event) => { event.stopPropagation(); drag.current = { kind: 'resize', nodeId: node.id, startX: event.clientX, startY: event.clientY, before: docRef.current, panX: panRef.current.x, panY: panRef.current.y }; }} /> : null}
                </div>;
              })}
            </div>
          </div>
          <div className="zoom-controls"><button onClick={() => setZoom((value) => Math.max(0.2, +(value - 0.1).toFixed(2)))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(3, +(value + 0.1).toFixed(2)))}>+</button><button onClick={() => fitCanvas(docRef.current)}>맞춤</button></div>
        </main>

        <aside className="right-panel">
          <div className="panel-heading"><strong>디자인</strong><span className="panel-tab">속성</span></div>
          {selected ? <div className="properties">
            <div className="selection-header"><span className="selection-icon">{selected.sourceType === 'INSTANCE' ? '◇' : nodeIcon(selected.type)}</span><div><strong>{selected.name}</strong><small>{selected.sourceType ?? selected.type}</small></div></div>
            <label className="field full"><span>이름</span><input value={selected.name} onChange={(event) => setProperty({ name: event.target.value })} /></label>
            <div className="section-title">레이아웃</div>
            <div className="fields-grid">
              {(['x', 'y', 'width', 'height'] as const).map((key) => <label className="field" key={key}><span>{key.toUpperCase()}</span><input type="number" value={selected[key]} onChange={(event) => setProperty({ [key]: numberValue(event.target.value, selected[key]) })} /></label>)}
            </div>
            <div className="section-title">표현</div>
            <label className="field full"><span>{selected.type === 'text' ? '글자색' : '채우기'}</span><div className="color-field"><input type="color" value={/^#[0-9a-f]{6}$/i.test(selected.fill) ? selected.fill : '#000000'} onChange={(event) => setProperty({ fill: event.target.value })} /><input value={selected.fill} onChange={(event) => setProperty({ fill: event.target.value })} /></div></label>
            {selected.layout ? <div className="import-detail">오토 레이아웃 {selected.layout === 'VERTICAL' ? '세로' : selected.layout === 'HORIZONTAL' ? '가로' : '그리드'} · 간격 {selected.gap ?? 0}px</div> : null}
            {selected.type === 'rectangle' || selected.type === 'frame' ? <label className="field full"><span>모서리 반경</span><input type="number" min="0" value={selected.radius ?? 0} onChange={(event) => setProperty({ radius: numberValue(event.target.value, 0) })} /></label> : null}
            {selected.type === 'text' ? <><label className="field full"><span>텍스트</span><textarea rows={3} value={selected.text ?? ''} onChange={(event) => setProperty({ text: event.target.value })} /></label><label className="field full"><span>글자 크기</span><input type="number" min="1" value={selected.fontSize ?? 18} onChange={(event) => setProperty({ fontSize: numberValue(event.target.value, 18) })} /></label></> : null}
            <div className="section-title">내보내기</div><button className="wide-action" onClick={() => setCodeOpen(true)}>React 컴포넌트 보기 →</button>
            <button className="danger-link" onClick={() => { commit(deleteNode(docRef.current, selected.id)); setSelectedId(null); }}>요소 삭제</button>
          </div> : <div className="nothing-selected"><span>◈</span><strong>선택된 요소가 없습니다</strong><p>캔버스나 레이어에서 요소를 선택하면 속성이 표시됩니다.</p></div>}
        </aside>
      </div>

      <footer className="statusbar"><span>{notice}</span><span>{doc.nodes.length} layers · {selected ? selected.name : '선택 없음'}</span></footer>

      {pendingFig ? <div className="modal-backdrop"><section className="import-modal"><header><strong>Figma 프레임 가져오기</strong><button aria-label="닫기" onClick={() => setPendingFig(null)}>×</button></header><p>{pendingFig.name}</p><label className="field full"><span>가져올 프레임의 Figma 링크 또는 node-id</span><input autoFocus placeholder="https://www.figma.com/design/...?node-id=779-23219" value={figInput} onChange={(event) => setFigInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void importPendingFig(); }} /></label><small>현재 프레임의 노드와 참조 컴포넌트를 로컬에서 읽습니다. 이미지·그라디언트·일부 벡터와 override의 표현은 아직 근사치입니다.</small><footer><button onClick={() => setPendingFig(null)}>취소</button><button className="primary" disabled={importing} onClick={() => void importPendingFig()}>{importing ? '가져오는 중…' : '가져오기'}</button></footer></section></div> : null}

      {codeOpen && exported ? <div className="modal-backdrop" onPointerDown={() => setCodeOpen(false)}><section className="code-modal" onPointerDown={(event) => event.stopPropagation()}><header><div><strong>{exported.name}.tsx</strong><span>선택한 요소의 React/TypeScript 초안</span></div><button aria-label="닫기" onClick={() => setCodeOpen(false)}>×</button></header><pre><code>{exported.code}</code></pre><footer><button onClick={() => void navigator.clipboard.writeText(exported.code).then(() => setNotice('코드를 복사했습니다.'))}>복사</button><button className="primary" onClick={() => download(`${exported.name}.tsx`, exported.code, 'text/plain')}>TSX 다운로드</button></footer></section></div> : null}
    </div>
  );
}
