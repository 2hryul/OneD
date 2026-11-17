import { useCallback, useEffect, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { emptyPage, parseDocument, walkPage, type DesignDocument, type DesignNode, type NodeInput, type Page } from './model';
import {
  EMPTY_TRANSACTION, addPage, addShape, applyChanges, childrenOf, composeTransactions, deleteShapes, groupShapes, moveMany, moveShapes,
  normalizeGroups, recordTransaction, reparentShape, replaceDocument, resizeShape, rotateShape, topLevelIds, ungroupShape, updateShape,
  type HistoryEntry, type Transaction
} from './changes';
import { boundsOf, center, resizeBox, rotationDegrees, worldCorners, type Handle, type Point, type Rect } from './geometry';
import { snapMove, type Guide } from './snapping';
import { boundsOfIds, frameAt, marqueeHits, nearestFrameId, rectBetween, selectionTarget, snapTargets, subtreeIds } from './selection';
import { CanvasNodes, SelectionOverlay } from './canvas';
import { LayersPanel, PagesPanel, PropertiesPanel, type DropPosition } from './panels';
import { exportTsx } from './export';
import { figmaNodeId, importFigFile } from './figmaImport';
import { loadStoredDocument, readRecovery, saveStoredDocument } from './storage';

type Tool = 'select' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text';
type DrawTool = Exclude<Tool, 'select' | 'hand'>;

/** 진행 중인 포인터 조작. 문서를 바꾸는 조작은 시작 시점 문서(before)에서 매번 다시 계산하고, 끝날 때 Transaction 하나로 기록한다. */
type Drag =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'marquee'; pageId: string; start: Point; base: string[] }
  | { kind: 'move'; startX: number; startY: number; before: DesignDocument; pageId: string; ids: string[]; moving: Rect; others: Rect[]; tx?: Transaction }
  | { kind: 'resize'; startX: number; startY: number; before: DesignDocument; pageId: string; id: string; handle: Handle; tx?: Transaction }
  | { kind: 'rotate'; before: DesignDocument; pageId: string; id: string; pivot: Point; startAngle: number; baseAngle: number; tx?: Transaction };

const TOOLS: { id: Tool; icon: string; label: string; shortcut: string }[] = [
  { id: 'select', icon: '↖', label: '선택', shortcut: 'V' },
  { id: 'hand', icon: '✋', label: '손', shortcut: 'H' },
  { id: 'frame', icon: '▣', label: '프레임', shortcut: 'F' },
  { id: 'rectangle', icon: '▭', label: '사각형', shortcut: 'R' },
  { id: 'ellipse', icon: '◯', label: '타원', shortcut: 'O' },
  { id: 'text', icon: 'T', label: '텍스트', shortcut: 'T' }
];

const DRAW_DEFAULTS: Record<DrawTool, { width: number; height: number; fill: string; name: string }> = {
  frame: { width: 360, height: 240, fill: '#ffffff', name: 'Frame' },
  rectangle: { width: 160, height: 100, fill: '#9aa8ff', name: 'Rectangle' },
  ellipse: { width: 120, height: 120, fill: '#ffc890', name: 'Ellipse' },
  text: { width: 220, height: 38, fill: '#17223a', name: 'Text' }
};

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pageOf(doc: DesignDocument, pageId: string): Page {
  return doc.pages.find((page) => page.id === pageId) ?? doc.pages[0]!;
}

function angleOf(pivot: Point, point: Point): number {
  return (Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180) / Math.PI;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 끌어 놓은 위치의 프레임이 지금 속한 프레임과 다르면 부모를 바꾸는 변경을 이동 Transaction 뒤에 붙인다(S2-06).
 * 그룹 안 도형을 같은 프레임 안에서 옮기면 그룹을 유지한다.
 */
function withDropReparent(before: DesignDocument, pageId: string, ids: readonly string[], tx: Transaction, point: Point): Transaction {
  const moved = pageOf(applyChanges(before, tx.redo), pageId);
  const target = frameAt(moved, point, subtreeIds(moved, ids))?.id ?? null;
  const steps = ids.filter((id) => nearestFrameId(moved, id) !== target).map((id) => (current: DesignDocument) =>
    reparentShape(current, pageId, id, target, childrenOf(pageOf(current, pageId), target).length));
  return steps.length ? composeTransactions(before, [() => tx, ...steps]) : tx;
}

export function App(): JSX.Element {
  const [startup] = useState(() => loadStoredDocument(localStorage));
  const [recovery] = useState(() => readRecovery(localStorage));
  const [doc, setDocState] = useState<DesignDocument>(startup.document);
  const [saveFailed, setSaveFailed] = useState(false);
  const docRef = useRef(doc);
  const history = useRef<{ past: HistoryEntry[]; future: Transaction[] }>({ past: [], future: [] });
  const [, setHistoryVersion] = useState(0);
  const [pageId, setPageId] = useState(startup.document.pages[0]!.id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(0.85);
  const zoomRef = useRef(zoom);
  const [pan, setPan] = useState({ x: 170, y: 92 });
  const panRef = useRef(pan);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [pendingFig, setPendingFig] = useState<File | null>(null);
  const [figInput, setFigInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState(startup.notice ?? '프레임 또는 요소를 선택해 편집하세요.');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const drag = useRef<Drag | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const page = pageOf(doc, pageId);
  const liveSelection = selectedIds.filter((id) => page.objects[id]);
  const selected = liveSelection.length === 1 ? page.objects[liveSelection[0]!]! : null;
  const exported = codeOpen && selected ? exportTsx(page, selected.id) : null;

  const fitCanvas = useCallback((target: Page): void => {
    const viewport = viewportRef.current;
    const corners = walkPage(target).filter((node) => !node.hidden).flatMap(worldCorners);
    if (!viewport || corners.length === 0) return;
    const bounds = viewport.getBoundingClientRect();
    const box = boundsOf(corners);
    const nextZoom = Math.min(1, Math.max(0.2, Math.min((bounds.width - 80) / Math.max(1, box.width), (bounds.height - 80) / Math.max(1, box.height))));
    setZoom(nextZoom);
    setPan({ x: (bounds.width - box.width * nextZoom) / 2 - box.x * nextZoom, y: (bounds.height - box.height * nextZoom) / 2 - box.y * nextZoom });
  }, []);

  useEffect(() => { fitCanvas(pageOf(docRef.current, startup.document.pages[0]!.id)); }, [fitCanvas, startup]);

  const setDoc = useCallback((next: DesignDocument) => { docRef.current = next; setDocState(next); }, []);
  const remember = useCallback((tx: Transaction, mergeKey?: string) => {
    // undo 직후의 편집은 직전 기록과 합치지 않는다. 합치면 되돌린 편집과 새 편집이 한 번에 되돌아간다.
    const key = history.current.future.length === 0 ? mergeKey : undefined;
    history.current.past = recordTransaction(history.current.past, tx, Date.now(), key);
    history.current.future = [];
    setHistoryVersion((value) => value + 1);
  }, []);

  /** before에 tx와 그룹 상자 보정을 적용하고 undo 기록에 남긴다. */
  const finalize = useCallback((before: DesignDocument, tx: Transaction, mergeKey?: string): void => {
    const full = normalizeGroups(before, tx);
    if (full.redo.length === 0) { setDoc(before); return; }
    setDoc(applyChanges(before, full.redo));
    remember(full, mergeKey);
  }, [setDoc, remember]);

  /** 현재 문서로 편집을 만들어 적용한다. 편집이 거부되면(예: 다른 부모의 요소 묶기) 이유를 상태 표시줄에 보여준다. */
  const edit = useCallback((build: (current: DesignDocument) => Transaction, mergeKey?: string): boolean => {
    try { finalize(docRef.current, build(docRef.current), mergeKey); return true; }
    catch (error) { setNotice(message(error)); return false; }
  }, [finalize]);

  const undo = useCallback(() => {
    const entry = history.current.past.pop();
    if (!entry) return;
    setDoc(applyChanges(docRef.current, entry.undo)); history.current.future.push(entry); setHistoryVersion((value) => value + 1);
  }, [setDoc]);
  const redo = useCallback(() => {
    const tx = history.current.future.pop();
    if (!tx) return;
    setDoc(applyChanges(docRef.current, tx.redo)); history.current.past.push({ redo: tx.redo, undo: tx.undo, at: 0 }); setHistoryVersion((value) => value + 1);
  }, [setDoc]);

  const persist = useCallback((current: DesignDocument): void => {
    const saved = saveStoredDocument(localStorage, current);
    setSaveFailed(!saved);
    if (!saved) setNotice('자동 저장 공간이 부족합니다. JSON 저장으로 파일을 보관하세요.');
  }, []);

  useEffect(() => {
    // 드래그 중에는 포인터가 움직일 때마다 문서가 바뀐다. 전체 문서를 매번 직렬화하지 않고 드래그가 끝날 때 한 번 저장한다.
    if (drag.current) return;
    persist(doc);
  }, [doc, persist]);
  useEffect(() => { if (!doc.pages.some((item) => item.id === pageId)) setPageId(doc.pages[0]!.id); }, [doc, pageId]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { spaceHeldRef.current = spaceHeld; }, [spaceHeld]);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const bounds = viewportRef.current!.getBoundingClientRect();
    return { x: (clientX - bounds.left - panRef.current.x) / zoomRef.current, y: (clientY - bounds.top - panRef.current.y) / zoomRef.current };
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const current = drag.current;
      if (!current) return;
      if (current.kind === 'pan') { setPan({ x: current.panX + event.clientX - current.startX, y: current.panY + event.clientY - current.startY }); return; }
      if (current.kind === 'marquee') {
        const rect = rectBetween(current.start, toWorld(event.clientX, event.clientY));
        setMarquee(rect);
        setSelectedIds([...new Set([...current.base, ...marqueeHits(pageOf(docRef.current, current.pageId), rect)])]);
        return;
      }
      const tx = previewTransaction(current, event);
      current.tx = tx;
      setDoc(applyChanges(current.before, tx.redo));
    };
    const previewTransaction = (current: Exclude<Drag, { kind: 'pan' | 'marquee' }>, event: PointerEvent): Transaction => {
      if (current.kind === 'move') {
        // Alt를 누르면 스냅 없이 옮긴다. 기준 거리는 화면 4px이 되도록 확대율로 나눈다.
        const raw = { x: (event.clientX - current.startX) / zoomRef.current, y: (event.clientY - current.startY) / zoomRef.current };
        const snap = event.altKey ? { dx: raw.x, dy: raw.y, guides: [] } : snapMove(current.moving, current.others, raw.x, raw.y, 4 / zoomRef.current);
        setGuides(snap.guides);
        return moveMany(current.before, current.pageId, current.ids, round2(snap.dx), round2(snap.dy));
      }
      const node = pageOf(current.before, current.pageId).objects[current.id]!;
      if (current.kind === 'resize') {
        const delta = { x: (event.clientX - current.startX) / zoomRef.current, y: (event.clientY - current.startY) / zoomRef.current };
        return resizeShape(current.before, current.pageId, current.id, resizeBox(node, current.handle, delta, event.shiftKey));
      }
      let target = current.baseAngle + angleOf(current.pivot, toWorld(event.clientX, event.clientY)) - current.startAngle;
      target = event.shiftKey ? Math.round(target / 15) * 15 : round2(target);
      return rotateShape(current.before, current.pageId, current.id, target - current.baseAngle);
    };
    const onUp = (event: PointerEvent): void => {
      const current = drag.current;
      drag.current = null;
      setGuides([]); setMarquee(null);
      if (!current || current.kind === 'pan' || current.kind === 'marquee') return;
      try {
        let tx = current.tx ?? EMPTY_TRANSACTION;
        if (current.kind === 'move' && tx.redo.length > 0) tx = withDropReparent(current.before, current.pageId, current.ids, tx, toWorld(event.clientX, event.clientY));
        finalize(current.before, tx);
      } catch (error) { setDoc(current.before); setNotice(message(error)); }
      persist(docRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [setDoc, persist, finalize, toWorld]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // React는 wheel 리스너를 passive로 등록해 preventDefault가 무시된다. Ctrl+휠이 브라우저 페이지까지 확대하지 않도록 직접 등록한다.
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) { setPan((value) => ({ x: value.x - event.deltaX, y: value.y - event.deltaY })); return; }
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const next = Math.min(3, Math.max(0.2, zoomRef.current * (event.deltaY < 0 ? 1.1 : 0.9)));
      const px = event.clientX - bounds.left; const py = event.clientY - bounds.top;
      const worldX = (px - panRef.current.x) / zoomRef.current; const worldY = (py - panRef.current.y) / zoomRef.current;
      setPan({ x: px - worldX * next, y: py - worldY * next }); setZoom(next);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  const groupSelection = (): void => {
    const ids = topLevelIds(page, liveSelection);
    if (ids.length === 0) return;
    const id = crypto.randomUUID();
    if (edit((current) => groupShapes(current, page.id, ids, id))) { setSelectedIds([id]); setNotice(`${ids.length}개 요소를 그룹으로 묶었습니다.`); }
  };

  const ungroupSelection = (): void => {
    const groups = liveSelection.filter((id) => page.objects[id]?.type === 'group');
    if (groups.length === 0) return;
    const children = groups.flatMap((id) => page.objects[id]!.children ?? []);
    if (edit((current) => composeTransactions(current, groups.map((id) => (next: DesignDocument) => ungroupShape(next, page.id, id))))) setSelectedIds(children);
  };

  const deleteSelection = (): void => {
    const ids = topLevelIds(page, liveSelection);
    if (ids.length === 0) return;
    edit((current) => deleteShapes(current, page.id, ids));
    setSelectedIds([]);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.code === 'Space' && !event.repeat) { setSpaceHeld(true); if (!editing) event.preventDefault(); }
      if (editing) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (mod && key === 'y') { event.preventDefault(); redo(); return; }
      if (mod && key === 'g') { event.preventDefault(); if (event.shiftKey) ungroupSelection(); else groupSelection(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
      if (event.key === 'Escape') { setTool('select'); setSelectedIds([]); return; }
      if (mod || event.altKey) return;
      const match = TOOLS.find((item) => item.shortcut.toLowerCase() === key);
      if (match) setTool(match.id);
    };
    const onKeyUp = (event: KeyboardEvent): void => { if (event.code === 'Space') setSpaceHeld(false); };
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  });

  const startPan = (event: ReactPointerEvent): void => {
    drag.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, panX: panRef.current.x, panY: panRef.current.y };
  };

  const createAt = (drawTool: DrawTool, point: Point): void => {
    const frame = frameAt(page, point, new Set());
    const id = crypto.randomUUID();
    const base = DRAW_DEFAULTS[drawTool];
    const node: NodeInput = { id, type: drawTool, name: base.name, parentId: frame?.id ?? null,
      x: Math.round(point.x), y: Math.round(point.y), width: base.width, height: base.height, fill: base.fill,
      ...(drawTool === 'text' ? { text: 'Text', fontSize: 22 } : {}),
      ...(drawTool === 'rectangle' ? { radius: 8 } : {}) };
    if (!edit((current) => addShape(current, page.id, node))) return;
    setSelectedIds([id]); setTool('select'); setNotice(`${base.name}을(를) 만들었습니다.`);
    if (drawTool === 'text') setEditingId(id);
  };

  const startMove = (hitId: string, event: ReactPointerEvent): void => {
    const target = selectionTarget(page, hitId, liveSelection);
    const toggled = liveSelection.includes(target) ? liveSelection.filter((id) => id !== target) : [...liveSelection, target];
    const next = event.shiftKey ? toggled : liveSelection.includes(target) ? liveSelection : [target];
    setSelectedIds(next);
    const ids = topLevelIds(page, next).filter((id) => !page.objects[id]?.locked);
    if (ids.length === 0 || !next.includes(target)) return;
    drag.current = { kind: 'move', startX: event.clientX, startY: event.clientY, before: docRef.current, pageId: page.id, ids,
      moving: boundsOfIds(page, ids), others: snapTargets(page, subtreeIds(page, ids)) };
  };

  const startTransform = (handle: string, node: DesignNode, event: ReactPointerEvent, point: Point): void => {
    if (handle === 'rotate') {
      const pivot = center(node);
      drag.current = { kind: 'rotate', before: docRef.current, pageId: page.id, id: node.id, pivot, startAngle: angleOf(pivot, point), baseAngle: rotationDegrees(node.transform) };
      return;
    }
    drag.current = { kind: 'resize', startX: event.clientX, startY: event.clientY, before: docRef.current, pageId: page.id, id: node.id, handle: handle as Handle };
  };

  const onCanvasDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button === 1 || tool === 'hand' || spaceHeldRef.current) { startPan(event); return; }
    if (event.button !== 0) return;
    const element = event.target as HTMLElement;
    const point = toWorld(event.clientX, event.clientY);
    if (tool !== 'select') { createAt(tool, point); return; }
    const handle = element.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    if (handle && selected) { startTransform(handle, selected, event, point); return; }
    const hitId = element.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    if (hitId && page.objects[hitId]) { startMove(hitId, event); return; }
    if (!event.shiftKey) setSelectedIds([]);
    drag.current = { kind: 'marquee', pageId: page.id, start: point, base: event.shiftKey ? liveSelection : [] };
  };

  /** 더블클릭은 그룹 안쪽 도형을 직접 고르고, 텍스트면 캔버스에서 바로 편집한다. */
  const onCanvasDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const hitId = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    const node = hitId ? page.objects[hitId] : undefined;
    if (!node || node.locked) return;
    setSelectedIds([node.id]);
    if (node.type === 'text') setEditingId(node.id);
  };

  const finishText = (id: string, text: string | null): void => {
    setEditingId(null);
    if (text !== null && page.objects[id]) edit((current) => updateShape(current, page.id, id, { text }));
  };

  /** 속성 패널 편집. 프레임은 위치를 바꾸면 자식도 같이 옮기고, 그룹은 크기를 바꾸면 자식을 같은 비율로 늘린다. */
  const setProperty = (node: DesignNode, patch: Partial<DesignNode>): void => {
    const { x, y, width, height, ...rest } = patch;
    const box = { x: x ?? node.x, y: y ?? node.y, width: width ?? node.width, height: height ?? node.height };
    // 같은 도형의 같은 속성을 연달아 고치면 undo 한 번에 되돌아가도록 합칠 키를 붙인다.
    edit((current) => composeTransactions(current, [
      (next) => node.type === 'group' ? resizeShape(next, page.id, node.id, box) : moveShapes(next, page.id, node.id, box.x - node.x, box.y - node.y),
      (next) => node.type === 'group' ? EMPTY_TRANSACTION : updateShape(next, page.id, node.id, { width: box.width, height: box.height }),
      (next) => updateShape(next, page.id, node.id, rest)
    ]), `${node.id}:${Object.keys(patch).join(',')}`);
  };

  const onLayerDrop = (dragId: string, targetId: string, position: DropPosition): void => {
    const target = page.objects[targetId];
    if (!target || subtreeIds(page, [dragId]).has(targetId)) return;
    if (position === 'inside') {
      const count = (target.children ?? []).filter((id) => id !== dragId).length;
      edit((current) => reparentShape(current, page.id, dragId, targetId, count));
      return;
    }
    const siblings = childrenOf(page, target.parentId).filter((id) => id !== dragId);
    // 패널은 위에 그려지는 도형을 위에 보여주므로, 대상 행 위에 놓으면 children 배열에서는 대상 뒤로 간다.
    const index = siblings.indexOf(targetId) + (position === 'above' ? 1 : 0);
    edit((current) => reparentShape(current, page.id, dragId, target.parentId, index));
  };

  const switchPage = (id: string): void => {
    setPageId(id); setSelectedIds([]); setEditingId(null);
    fitCanvas(pageOf(docRef.current, id));
  };

  const addNewPage = (): void => {
    const id = crypto.randomUUID();
    if (edit((current) => addPage(current, emptyPage(id, `Page ${current.pages.length + 1}`)))) { setPageId(id); setSelectedIds([]); }
  };

  const openFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.fig')) {
        setPendingFig(file);
        setFigInput('');
      } else {
        const loaded = parseDocument(await file.text());
        edit((current) => replaceDocument(current, loaded)); setPageId(loaded.pages[0]!.id); setSelectedIds([]); fitCanvas(loaded.pages[0]!);
        setNotice(`${file.name}을(를) 열었습니다.`);
      }
    } catch (error) { setNotice(`열기 실패: ${message(error)}`); }
    finally { event.target.value = ''; }
  };

  const importPendingFig = async (): Promise<void> => {
    if (!pendingFig) return;
    const id = figmaNodeId(figInput);
    if (!id) { setNotice('Figma 링크의 node-id 또는 779:23219 형식의 ID를 입력하세요.'); return; }
    setImporting(true);
    try {
      const imported = importFigFile(new Uint8Array(await pendingFig.arrayBuffer()), id);
      const first = imported.document.pages[0]!;
      edit((current) => replaceDocument(current, imported.document)); setPageId(first.id); setSelectedIds([id]); fitCanvas(first);
      setNotice(`${imported.report.imported}개 요소 · 인스턴스 ${imported.report.expandedInstances}개 · override ${imported.report.appliedOverrides}개 적용/${imported.report.unappliedOverrides}개 미적용 · 도형 ${imported.report.approximatedShapes}개 근사`);
      setPendingFig(null);
    } catch (error) { setNotice(`가져오기 실패: ${message(error)}`); }
    finally { setImporting(false); }
  };

  const shapeCount = walkPage(page).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◆</span><span>Canvas Studio</span></div>
        <div className="file-info"><input aria-label="문서 이름" value={doc.name} onChange={(event) => setDoc({ ...docRef.current, name: event.target.value })} /><span className={`saved-dot ${saveFailed ? 'failed' : ''}`} /> <span>{saveFailed ? '저장 실패' : '자동 저장됨'}</span></div>
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
        <span className="toolbar-hint">Ctrl + 휠 확대 · Space + 드래그 이동 · Ctrl+G 그룹 · Alt 스냅 끄기</span>
      </div>

      <div className="workspace">
        <aside className="left-panel">
          <PagesPanel pages={doc.pages} currentId={page.id} onSwitch={switchPage} onAdd={addNewPage} />
          <div className="panel-heading"><strong>레이어</strong><span>{shapeCount}</span></div>
          <LayersPanel page={page} selectedIds={liveSelection}
            onSelect={(id, additive) => { setTool('select'); setSelectedIds(additive ? (liveSelection.includes(id) ? liveSelection.filter((item) => item !== id) : [...liveSelection, id]) : [id]); }}
            onToggle={(id, key) => edit((current) => updateShape(current, page.id, id, { [key]: !page.objects[id]?.[key] }))}
            onDrop={onLayerDrop} />
        </aside>

        <main className="canvas-area">
          <div className="canvas-top-ruler"><span>0</span><span>200</span><span>400</span><span>600</span><span>800</span><span>1000</span></div>
          <div className="canvas-viewport" ref={viewportRef} onPointerDown={onCanvasDown} onDoubleClick={onCanvasDoubleClick} style={{ cursor: tool === 'hand' || spaceHeld ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
            <div className="canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              <CanvasNodes page={page} editingId={editingId} onTextDone={finishText} />
              <SelectionOverlay page={page} selectedIds={liveSelection} editingId={editingId} zoom={zoom} guides={guides} marquee={marquee} />
            </div>
          </div>
          <div className="zoom-controls"><button onClick={() => setZoom((value) => Math.max(0.2, +(value - 0.1).toFixed(2)))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(3, +(value + 0.1).toFixed(2)))}>+</button><button onClick={() => fitCanvas(page)}>맞춤</button></div>
        </main>

        <aside className="right-panel">
          <div className="panel-heading"><strong>디자인</strong><span className="panel-tab">속성</span></div>
          {selected ? <PropertiesPanel node={selected}
            onChange={(patch) => setProperty(selected, patch)}
            onRotate={(degrees) => edit((current) => rotateShape(current, page.id, selected.id, degrees - rotationDegrees(selected.transform)), `${selected.id}:rotation`)}
            onOpenCode={() => setCodeOpen(true)}
            onDelete={deleteSelection} />
            : liveSelection.length > 1 ? <div className="nothing-selected"><span>⧉</span><strong>{liveSelection.length}개 선택됨</strong><p>Ctrl+G로 묶거나 Delete로 지울 수 있습니다.</p><button className="wide-action" onClick={groupSelection}>그룹으로 묶기</button></div>
            : <div className="nothing-selected"><span>◈</span><strong>선택된 요소가 없습니다</strong><p>캔버스나 레이어에서 요소를 선택하면 속성이 표시됩니다.</p></div>}
        </aside>
      </div>

      <footer className="statusbar"><span>{notice}{recovery ? <button className="recovery-link" onClick={() => download('canvas-studio-recovery.json', recovery, 'application/json')}>복구본 다운로드</button> : null}</span><span>{shapeCount} layers · {selected ? selected.name : liveSelection.length > 1 ? `${liveSelection.length}개 선택` : '선택 없음'}</span></footer>

      {pendingFig ? <div className="modal-backdrop"><section className="import-modal"><header><strong>Figma 프레임 가져오기</strong><button aria-label="닫기" onClick={() => setPendingFig(null)}>×</button></header><p>{pendingFig.name}</p><label className="field full"><span>가져올 프레임의 Figma 링크 또는 node-id</span><input autoFocus placeholder="https://www.figma.com/design/...?node-id=779-23219" value={figInput} onChange={(event) => setFigInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void importPendingFig(); }} /></label><small>현재 프레임의 노드와 참조 컴포넌트를 로컬에서 읽습니다. 이미지·그라디언트·일부 벡터와 override의 표현은 아직 근사치입니다.</small><footer><button onClick={() => setPendingFig(null)}>취소</button><button className="primary" disabled={importing} onClick={() => void importPendingFig()}>{importing ? '가져오는 중…' : '가져오기'}</button></footer></section></div> : null}

      {codeOpen && exported ? <div className="modal-backdrop" onPointerDown={() => setCodeOpen(false)}><section className="code-modal" onPointerDown={(event) => event.stopPropagation()}><header><div><strong>{exported.name}.tsx</strong><span>선택한 요소의 React/TypeScript 초안</span></div><button aria-label="닫기" onClick={() => setCodeOpen(false)}>×</button></header><pre><code>{exported.code}</code></pre><footer><button onClick={() => void navigator.clipboard.writeText(exported.code).then(() => setNotice('코드를 복사했습니다.'))}>복사</button><button className="primary" onClick={() => download(`${exported.name}.tsx`, exported.code, 'text/plain')}>TSX 다운로드</button></footer></section></div> : null}
    </div>
  );
}
