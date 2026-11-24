import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { emptyPage, isContainer, parseDocument, solid, walkPage, type BoolOp, type DesignDocument, type DesignNode, type Matrix, type NodeInput, type Page, type Paint, type SubPath } from './model';
import {
  EMPTY_TRANSACTION, addPage, addShape, deletePage, renamePage, applyChanges, childrenOf, composeTransactions, createBoolean, createMask, deleteShapes, fitPathBounds, flattenToPath, groupShapes, moveMany,
  flipShapes, recordTransaction, removeToken, reparentShape, replaceDocument, setToken, resizeShape, rotateShape, topLevelIds, ungroupShape, updateShape,
  type FlipAxis, type HistoryEntry, type Transaction
} from './changes';
import { applyPoint, boundsOf, center, invert, resizeBox, rotationDegrees, worldCorners, worldMatrix, type Handle, type Point, type Rect } from './geometry';
import { insertPoint, nearestSegment } from './path';
import { BooleanButtons, PathEditOverlay, PathSection, PenOverlay, movePathPart, parseTarget, penAddPoint, penNodeInput, penSetHandle, removePathPoint, toggleSmooth, type PenDraft, type PathTarget } from './pathTools';
import { snapMove, type Guide } from './snapping';
import { dropIndex } from './layoutEdits';
import { normalizeAfterEdit } from './normalize';
import { cleanItem } from './layoutPanels';
import { boundsOfIds, frameAt, marqueeHits, nearestFrameId, rectBetween, selectionTarget, snapTargets, subtreeIds } from './selection';
import { CanvasNodes, SelectionOverlay, TextEditOverlay } from './canvas';
import { CANVAS_THRESHOLD, CanvasView, type RendererPreference } from './canvasView';
import { frameTitleAt, hitTest } from './hitTest';
import { TITLE_HEIGHT } from './canvasRenderer';
import { PluginManager, PluginPanel } from './pluginPanels';
import { copyNodes, parseClipboard, pasteNodes, selectAllIds, type ClipboardData } from './clipboard';
import { alignNodes, distributeNodes, type AlignMode, type DistributeAxis } from './align';
import { AlignBar, ExportImageRow, type ExportChoice } from './alignBar';
import { exportImage, safeFileName } from './imageExport';
import { reorderNodes, type ReorderMode } from './arrange';
import { Rulers } from './rulers';
import { measureBetween } from './measure';
import type { PluginHost, PluginInfo } from './pluginApi';
import { LayersPanel, PagesPanel, PropertiesPanel, type DropPosition } from './panels';
import { exportTsx } from './export';
import { figmaNodeId, importFigFile, importFigNode, listFigFrames, listFigTopNodes, readFigFile, type FigFrameEntry, type ImportReport } from './figmaImport';
import type { FigDocument } from 'openfig-core';
import { base64ToBytes, bytesToBase64, contentId, getAssets, putAssets, readImageSize, referencedAssets, sniffImageMime, type AssetRecord } from './assets';
import { ImportReportModal } from './report';
import { AssetsPanel } from './assetsPanel';
import { ComponentSection, TokenSection, type PropActions } from './componentPanels';
import { addComponentProp, propOwner, removeComponentProp, setInstanceProp, updateComponentProp } from './componentProps';
import { applyToken, combineAsVariants, createComponent, createInstance, detachInstance, resetOverrides, switchVariant } from './components';
import { loadStoredDocument, readRecovery, saveStoredDocument } from './storage';
import { PrototypeLinks, PrototypePanel } from './prototypePanels';
import { startScreen } from './prototype';
import { Viewer } from './viewer';
import { useCollab } from './useCollab';
import { CommentPins, CommentsPanel, PresenceBar, RemoteCursors, ShareModal } from './collabPanels';
import type { CommentThread } from './collabTypes';
import { InspectPanel } from './inspectPanel';
import { createZip, type ZipEntry } from './zip';

type Tool = 'select' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text' | 'pen' | 'comment';
type DrawTool = Exclude<Tool, 'select' | 'hand' | 'pen' | 'comment'>;

/** 진행 중인 포인터 조작. 문서를 바꾸는 조작은 시작 시점 문서(before)에서 매번 다시 계산하고, 끝날 때 Transaction 하나로 기록한다. */
type Drag =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'marquee'; pageId: string; start: Point; base: string[] }
  | { kind: 'move'; startX: number; startY: number; before: DesignDocument; pageId: string; ids: string[]; moving: Rect; others: Rect[]; tx?: Transaction }
  | { kind: 'resize'; startX: number; startY: number; before: DesignDocument; pageId: string; id: string; handle: Handle; tx?: Transaction }
  | { kind: 'rotate'; before: DesignDocument; pageId: string; id: string; pivot: Point; startAngle: number; baseAngle: number; tx?: Transaction }
  | { kind: 'pen-handle' }
  // 경로 편집: base는 누른 시점 경로(점을 넣었으면 넣은 뒤), path는 지금까지 끈 결과. 놓을 때 상자를 경로에 맞춘다.
  | { kind: 'path'; before: DesignDocument; pageId: string; id: string; target: PathTarget; toLocal: Matrix; base: SubPath[]; path: SubPath[] };

const TOOLS: { id: Tool; icon: string; label: string; shortcut: string }[] = [
  { id: 'select', icon: '↖', label: '선택', shortcut: 'V' },
  { id: 'hand', icon: '✋', label: '손', shortcut: 'H' },
  { id: 'frame', icon: '▣', label: '프레임', shortcut: 'F' },
  { id: 'rectangle', icon: '▭', label: '사각형', shortcut: 'R' },
  { id: 'ellipse', icon: '◯', label: '타원', shortcut: 'O' },
  { id: 'text', icon: 'T', label: '텍스트', shortcut: 'T' },
  { id: 'pen', icon: '✒', label: '펜', shortcut: 'P' },
  { id: 'comment', icon: '💬', label: '코멘트', shortcut: 'C' }
];

const BOOL_KEYS: Record<string, BoolOp> = { u: 'union', s: 'subtract', i: 'intersect', x: 'exclude' };

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

/** 항상 같은 함수를 돌려주되 호출하면 가장 최근 렌더의 fn을 부른다. 메모한 자식이 콜백 때문에 다시 그려지지 않게 한다. */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/** 그림 MIME → 파일 확장자. 내보낸 코드의 import 경로와 zip 안의 파일 이름이 같아야 한다. */
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 확대 범위. 큰 문서 전체를 한 화면에 보고(2%), 작은 아이콘을 자세히 볼 수 있게(800%) 한다. */
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 8;
const clampZoom = (value: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

/** 방향키 → 이동 방향. */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Alt+글자 정렬 단축키(Figma와 같음). */
const ALIGN_KEYS: Record<string, AlignMode> = { a: 'left', d: 'right', h: 'h-center', w: 'top', s: 'bottom', v: 'v-center' };

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
 * 끌어 놓은 위치에 맞게 부모와 순서를 정하는 변경을 이동 Transaction 뒤에 붙인다(S2-06).
 * 다른 프레임에 놓으면 그 프레임으로 옮기고, 오토 레이아웃 프레임에 놓으면 놓은 자리에 맞는 순서로 넣는다(Figma처럼 순서 바꾸기).
 * 그룹 안 도형을 같은 일반 프레임 안에서 옮기면 그룹을 유지한다. absolute 자식은 레이아웃 순서에 끼지 않는다.
 */
function withDropReparent(before: DesignDocument, pageId: string, ids: readonly string[], tx: Transaction, point: Point): Transaction {
  const moved = pageOf(applyChanges(before, tx.redo), pageId);
  const movingSet = subtreeIds(moved, ids);
  const target = frameAt(moved, point, movingSet);
  const targetId = target?.id ?? null;
  const steps = ids.filter((id) => {
    if (target?.layout) return !moved.objects[id]?.item?.absolute || moved.objects[id]?.parentId !== targetId;
    return nearestFrameId(moved, id) !== targetId;
  }).map((id, offset) => (current: DesignDocument) => {
    const page = pageOf(current, pageId);
    const index = target?.layout ? dropIndex(page, target.id, point, movingSet) + offset : childrenOf(page, targetId).length;
    return reparentShape(current, pageId, id, targetId, index);
  });
  return steps.length ? composeTransactions(before, [() => tx, ...steps]) : tx;
}

/**
 * 사용자가 직접 크기를 바꾸면 그 축의 '채우기'·'내용에 맞춤'을 '고정'으로 바꾼다. 그대로 두면 다음 레이아웃 계산이 바꾼 크기를 되돌린다.
 */
function fixSizingOnResize(doc: DesignDocument, pageId: string, node: DesignNode, box: { width: number; height: number }): Transaction {
  const h = node.item?.h && node.item.h !== 'fix' && Math.abs(box.width - node.width) > 0.005 ? 'fix' : node.item?.h;
  const v = node.item?.v && node.item.v !== 'fix' && Math.abs(box.height - node.height) > 0.005 ? 'fix' : node.item?.v;
  if (h === node.item?.h && v === node.item?.v) return EMPTY_TRANSACTION;
  return updateShape(doc, pageId, node.id, { item: cleanItem({ ...node.item, h, v }) });
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
  const [pen, setPen] = useState<PenDraft | null>(null);
  const [penCursor, setPenCursor] = useState<Point | null>(null);
  const [pathEdit, setPathEdit] = useState<{ id: string; point: { sub: number; index: number } | null } | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const zoomRef = useRef(zoom);
  const [pan, setPan] = useState({ x: 170, y: 92 });
  const panRef = useRef(pan);
  const [guides, setGuides] = useState<Guide[]>([]);
  /** Alt를 누른 채 마우스를 올린 도형. 고른 영역에서 이 도형까지 거리를 보여 준다. */
  const [measureId, setMeasureId] = useState<string | null>(null);
  const lastHover = useRef<{ element: HTMLElement; point: Point } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeTab, setCodeTab] = useState<'tsx' | 'css'>('tsx');
  const [pendingFig, setPendingFig] = useState<File | null>(null);
  // 열어 둔 .fig의 해석 결과와 프레임 목록. 목록을 만들 때 한 번 해석한 것을 가져오기에 다시 쓴다(큰 파일은 해석이 오래 걸린다).
  const [figFrames, setFigFrames] = useState<FigFrameEntry[]>([]);
  // 맨 위에 프레임이 없어 figFrames에 프레임 대신 맨 위 도형 후보를 담았는지.
  const [figListIsNodes, setFigListIsNodes] = useState(false);
  const figDocRef = useRef<FigDocument | null>(null);
  const [figInput, setFigInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState(startup.notice ?? '프레임 또는 요소를 선택해 편집하세요.');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceHeldRef = useRef(false);
  const drag = useRef<Drag | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 800 });
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<{ nodeId: string; index: number } | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const requestedAssets = useRef(new Set<string>());
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [leftTab, setLeftTab] = useState<'layers' | 'assets' | 'comments'>('layers');
  const [shareOpen, setShareOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [runningPlugin, setRunningPlugin] = useState<PluginInfo | null>(null);
  const [rendererPref, setRendererPref] = useState<RendererPreference>(() => {
    try { const saved = localStorage.getItem('canvas-studio-renderer'); return saved === 'dom' || saved === 'canvas' ? saved : 'auto'; } catch { return 'auto'; }
  });
  const [commentDraft, setCommentDraft] = useState<{ x: number; y: number } | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'design' | 'prototype' | 'code'>('design');
  const [codeAssets, setCodeAssets] = useState<Map<string, AssetRecord>>(new Map());
  const [viewerStart, setViewerStart] = useState<string | null>(null);

  const page = pageOf(doc, pageId);
  // 이미지 주소가 바뀔 때만 새 함수가 되게 한다. 렌더마다 새 함수면 모든 도형이 다시 그려진다.
  const resolveAsset = useCallback((assetId: string) => assetUrls[assetId] ?? null, [assetUrls]);
  const liveSelection = selectedIds.filter((id) => page.objects[id]);
  const selected = liveSelection.length === 1 ? page.objects[liveSelection[0]!]! : null;
  const assetFile = useCallback((assetId: string) => {
    const mime = codeAssets.get(assetId)?.mime;
    return mime && IMAGE_EXT[mime] ? `${assetId}.${IMAGE_EXT[mime]}` : assetId;
  }, [codeAssets]);
  const exported = codeOpen && selected ? exportTsx(doc, page.id, selected.id, { assetFile }) : null;
  const exportedAssets = exported?.assets.join(',') ?? '';

  // 코드 창이 열리면 코드가 쓰는 그림의 형식(MIME)을 읽어 둔다. import 경로에 확장자를 붙이고 zip에 같은 이름으로 넣기 위해서다.
  useEffect(() => {
    if (!exportedAssets) return;
    let cancelled = false;
    getAssets(exportedAssets.split(','))
      .then((records) => { if (!cancelled) setCodeAssets(new Map(records.map((record) => [record.id, record]))); })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : '[codeAssets] 그림 읽기 실패'));
    return () => { cancelled = true; };
  }, [exportedAssets]);

  /** 프로젝트에 넣을 형태로 나눈 파일(화면, components/, tokens.css)과 그림을 zip 하나로. 저장소에 없는 그림은 빼고 알린다. */
  const downloadCodeZip = (): void => {
    if (!exported) return;
    const files: ZipEntry[] = exported.files.map((file) => ({ path: file.path, data: file.data }));
    const missing = exported.assets.filter((id) => !codeAssets.has(id));
    for (const id of exported.assets) { const record = codeAssets.get(id); if (record) files.push({ path: `assets/${assetFile(id)}`, data: record.bytes }); }
    try {
      downloadBlob(`${exported.name}.zip`, new Blob([createZip(files)], { type: 'application/zip' }));
      setNotice(missing.length ? `zip을 받았습니다. 그림 ${missing.length}개는 저장소에 없어 빠졌습니다.` : `zip을 받았습니다(파일 ${files.length}개).`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '[downloadCodeZip] zip 만들기 실패');
    }
  };

/** 영역(페이지 좌표)이 화면 가운데에 다 보이게 확대·이동한다. maxZoom보다 크게는 확대하지 않는다. */
  const zoomToRect = useCallback((box: Rect, maxZoom: number): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const nextZoom = clampZoom(Math.min(maxZoom, (bounds.width - 80) / Math.max(1, box.width), (bounds.height - 80) / Math.max(1, box.height)));
    setZoom(nextZoom);
    setPan({ x: (bounds.width - box.width * nextZoom) / 2 - box.x * nextZoom, y: (bounds.height - box.height * nextZoom) / 2 - box.y * nextZoom });
  }, []);

  /** 페이지 전체 맞춤(Shift+1). 100%보다 크게는 확대하지 않는다. */
  const fitCanvas = useCallback((target: Page): void => {
    const corners = walkPage(target).filter((node) => !node.hidden).flatMap(worldCorners);
    if (corners.length) zoomToRect(boundsOf(corners), 1);
  }, [zoomToRect]);

  /** 화면 가운데를 기준으로 배율을 바꾼다(Ctrl+0, Ctrl+=, Ctrl+-, 확대 버튼). */
  const zoomAtCenter = useCallback((next: (current: number) => number): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const current = zoomRef.current;
    const target = clampZoom(next(current));
    const cx = bounds.width / 2;
    const cy = bounds.height / 2;
    setPan({ x: cx - ((cx - panRef.current.x) / current) * target, y: cy - ((cy - panRef.current.y) / current) * target });
    setZoom(target);
  }, []);

  useEffect(() => { fitCanvas(pageOf(docRef.current, startup.document.pages[0]!.id)); }, [fitCanvas, startup]);

  const setDoc = useCallback((next: DesignDocument) => { docRef.current = next; setDocState(next); }, []);

  /**
   * 서버에서 온 문서를 화면에 반영한다. 처음 받은 문서면 기록과 선택을 비운다.
   * 문서를 바꾸는 끌기 중에는 반영하지 않는다. 놓을 때 finalize가 서버 문서 위에 내 변경을 얹은 결과로 맞춘다.
   */
  const applyRemoteDocument = useCallback((next: DesignDocument, first: boolean): void => {
    if (first) {
      history.current = { past: [], future: [] }; setHistoryVersion((value) => value + 1);
      setSelectedIds([]); setPageId(next.pages[0]!.id); setDoc(next); fitCanvas(next.pages[0]!);
      return;
    }
    if (drag.current && 'before' in drag.current) return;
    setDoc(next);
  }, [setDoc, fitCanvas]);
  const collab = useCollab({ applyDocument: applyRemoteDocument, setNotice: (text) => setNotice(text) });
  const remember = useCallback((tx: Transaction, mergeKey?: string) => {
    // undo 직후의 편집은 직전 기록과 합치지 않는다. 합치면 되돌린 편집과 새 편집이 한 번에 되돌아간다.
    const key = history.current.future.length === 0 ? mergeKey : undefined;
    history.current.past = recordTransaction(history.current.past, tx, Date.now(), key);
    history.current.future = [];
    setHistoryVersion((value) => value + 1);
  }, []);

  /** before에 tx와 그룹 상자 보정을 적용하고 undo 기록에 남긴다. */
  const finalize = useCallback((before: DesignDocument, tx: Transaction, mergeKey?: string): void => {
    const full = normalizeAfterEdit(before, tx);
    if (full.redo.length > 0) remember(full, mergeKey);
    // 공유 파일이면 변경을 서버로 보내고, 서버 확정 문서 + 확인 대기 변경을 화면에 보인다(끄는 동안 온 남의 변경 포함).
    const shared = collab.session.current?.submit(full.redo);
    if (shared) { setDoc(shared); return; }
    setDoc(full.redo.length ? applyChanges(before, full.redo) : before);
  }, [setDoc, remember, collab.session]);

  /** 현재 문서로 편집을 만들어 적용한다. 편집이 거부되면(예: 다른 부모의 요소 묶기) 이유를 상태 표시줄에 보여준다. */
  const edit = useCallback((build: (current: DesignDocument) => Transaction, mergeKey?: string): boolean => {
    try { finalize(docRef.current, build(docRef.current), mergeKey); return true; }
    catch (error) { setNotice(message(error)); return false; }
  }, [finalize]);

  const undo = useCallback(() => {
    const entry = history.current.past.pop();
    if (!entry) return;
    // 공유 중에는 되돌리기도 변경 하나로 보낸다. 남이 이미 지운 도형이라 얹을 수 없으면 버려지고 알림이 뜬다.
    setDoc(collab.session.current?.submit(entry.undo) ?? applyChanges(docRef.current, entry.undo)); history.current.future.push(entry); setHistoryVersion((value) => value + 1);
  }, [setDoc, collab.session]);
  const redo = useCallback(() => {
    const tx = history.current.future.pop();
    if (!tx) return;
    setDoc(collab.session.current?.submit(tx.redo) ?? applyChanges(docRef.current, tx.redo)); history.current.past.push({ redo: tx.redo, undo: tx.undo, at: 0 }); setHistoryVersion((value) => value + 1);
  }, [setDoc, collab.session]);

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
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { spaceHeldRef.current = spaceHeld; }, [spaceHeld]);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const bounds = viewportRef.current!.getBoundingClientRect();
    return { x: (clientX - bounds.left - panRef.current.x) / zoomRef.current, y: (clientY - bounds.top - panRef.current.y) / zoomRef.current };
  }, []);

  /** 경로 편집 결과를 before 문서 기준 Transaction 하나로 기록한다. 상자를 경로에 맞추는 것까지 한 번에 되돌린다. */
  const commitPath = useCallback((before: DesignDocument, pageId: string, id: string, path: SubPath[]): void => {
    try {
      finalize(before, composeTransactions(before, [(current) => updateShape(current, pageId, id, { path }), (current) => fitPathBounds(current, pageId, id)]));
    } catch (error) { setDoc(before); setNotice(message(error)); }
  }, [finalize, setDoc]);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const current = drag.current;
      if (!current) return;
      if (current.kind === 'pan') { setPan({ x: current.panX + event.clientX - current.startX, y: current.panY + event.clientY - current.startY }); return; }
      if (current.kind === 'pen-handle') { const point = toWorld(event.clientX, event.clientY); setPen((draft) => draft && penSetHandle(draft, point, 2 / zoomRef.current)); return; }
      if (current.kind === 'path') { previewPath(current, event); return; }
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
    const previewPath = (current: Extract<Drag, { kind: 'path' }>, event: PointerEvent): void => {
      const local = applyPoint(current.toLocal, toWorld(event.clientX, event.clientY));
      current.path = movePathPart(current.base, current.target, local, !event.altKey);
      setDoc(applyChanges(current.before, updateShape(current.before, current.pageId, current.id, { path: current.path }).redo));
    };
    const previewTransaction = (current: Exclude<Drag, { kind: 'pan' | 'marquee' | 'pen-handle' | 'path' }>, event: PointerEvent): Transaction => {
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
        const box = resizeBox(node, current.handle, delta, event.shiftKey);
        // 크기 조절은 레이아웃이 자식을 다시 배치하는 모습을 바로 보여준다.
        return normalizeAfterEdit(current.before, composeTransactions(current.before, [
          (doc) => resizeShape(doc, current.pageId, current.id, box),
          (doc) => fixSizingOnResize(doc, current.pageId, node, box)
        ]));
      }
      let target = current.baseAngle + angleOf(current.pivot, toWorld(event.clientX, event.clientY)) - current.startAngle;
      target = event.shiftKey ? Math.round(target / 15) * 15 : round2(target);
      return normalizeAfterEdit(current.before, rotateShape(current.before, current.pageId, current.id, target - current.baseAngle));
    };
    const onUp = (event: PointerEvent): void => {
      const current = drag.current;
      drag.current = null;
      setGuides([]); setMarquee(null);
      if (!current || current.kind === 'pan' || current.kind === 'marquee' || current.kind === 'pen-handle') return;
      if (current.kind === 'path') { commitPath(current.before, current.pageId, current.id, current.path); persist(docRef.current); return; }
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
  }, [setDoc, persist, finalize, toWorld, commitPath]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // React는 wheel 리스너를 passive로 등록해 preventDefault가 무시된다. Ctrl+휠이 브라우저 페이지까지 확대하지 않도록 직접 등록한다.
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) { setPan((value) => ({ x: value.x - event.deltaX, y: value.y - event.deltaY })); return; }
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const next = clampZoom(zoomRef.current * (event.deltaY < 0 ? 1.1 : 0.9));
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

  /** 선택을 마스크 그룹으로(맨 아래 도형이 마스크). 하나만 골랐고 이미 마스크면 마스크를 끈다. */
  const maskSelection = (): void => {
    const ids = topLevelIds(page, liveSelection);
    const only = ids.length === 1 ? page.objects[ids[0]!] : undefined;
    if (only?.mask) { edit((current) => updateShape(current, page.id, only.id, { mask: undefined })); setNotice('마스크를 해제했습니다.'); return; }
    if (ids.length < 2) { setNotice('마스크로 쓰려면 요소를 두 개 이상 고르세요. 맨 아래 요소가 마스크가 됩니다.'); return; }
    const id = crypto.randomUUID();
    try {
      if (edit((current) => createMask(current, page.id, ids, id))) { setSelectedIds([id]); setNotice('맨 아래 요소를 마스크로 썼습니다.'); }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '[maskSelection] 마스크 만들기 실패');
    }
  };

  const ungroupSelection = (): void => {
    const groups = liveSelection.filter((id) => page.objects[id]?.type === 'group');
    if (groups.length === 0) return;
    const children = groups.flatMap((id) => page.objects[id]!.children ?? []);
    if (edit((current) => composeTransactions(current, groups.map((id) => (next: DesignDocument) => ungroupShape(next, page.id, id))))) setSelectedIds(children);
  };

  /** 시스템 클립보드를 못 쓸 때(이벤트 없이 메뉴에서 부를 때) 쓰는 마지막 복사 내용. */
  const clipboardRef = useRef<ClipboardData | null>(null);

  /**
   * 붙여 넣기. 프레임 하나를 고른 채 붙이면 그 안 가운데에, 아니면 원래 부모(이 페이지에 있으면)의 같은 자리에 넣는다.
   * 새 도형을 선택한다. 반환값은 성공 여부.
   */
  const pasteData = (data: ClipboardData): boolean => {
    const target = selected && isContainer(selected) && !selected.boolOp && !data.roots.includes(selected.id) && selected.type === 'frame' ? selected : null;
    const firstParent = data.nodes.find((node) => node.id === data.roots[0])?.parentId ?? null;
    const parentId = target ? target.id : firstParent && page.objects[firstParent] ? firstParent : null;
    const rootNodes = data.nodes.filter((node) => data.roots.includes(node.id));
    const bounds = boundsOf(rootNodes.flatMap(worldCorners));
    const dx = target ? Math.round(target.x + (target.width - bounds.width) / 2 - bounds.x) : 0;
    const dy = target ? Math.round(target.y + (target.height - bounds.height) / 2 - bounds.y) : 0;
    let rootIds: string[] = [];
    const done = edit((current) => { const pasted = pasteNodes(current, page.id, data, { parentId, dx, dy, newId: () => crypto.randomUUID() }); rootIds = pasted.rootIds; return pasted.tx; });
    if (done) { setSelectedIds(rootIds); setTool('select'); }
    return done;
  };

  /** 복제(Ctrl+D). 같은 부모의 원본 바로 위에 넣는다. 최상위 프레임은 겹치지 않게 오른쪽 빈자리로 옮긴다(Penpot과 같음). */
  const duplicateSelection = (): void => {
    const data = copyNodes(page, liveSelection);
    if (!data) return;
    const roots = data.nodes.filter((node) => data.roots.includes(node.id));
    const parentId = roots[0]!.parentId;
    const sameParent = roots.every((node) => node.parentId === parentId);
    const siblings = childrenOf(page, sameParent ? parentId : null);
    const index = sameParent ? Math.max(...data.roots.map((id) => siblings.indexOf(id))) + 1 : undefined;
    const bounds = boundsOf(roots.flatMap(worldCorners));
    const dx = parentId === null && roots.every((node) => node.type === 'frame') ? Math.round(bounds.width + 40) : 0;
    let rootIds: string[] = [];
    if (edit((current) => { const pasted = pasteNodes(current, page.id, data, { parentId: sameParent ? parentId : null, index, dx, dy: 0, newId: () => crypto.randomUUID() }); rootIds = pasted.rootIds; return pasted.tx; })) setSelectedIds(rootIds);
  };

  /** 클립보드의 그림 파일을 같은 크기의 이미지 사각형으로 넣는다(화면 가운데, 그 아래 프레임이 있으면 그 안). */
  const pasteImageFile = async (file: File): Promise<void> => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniffImageMime(bytes);
      if (!mime) { setNotice('[pasteImageFile] 붙여 넣은 그림 형식을 알 수 없습니다.'); return; }
      // 크기를 먼저 읽는다. 해석에 실패한 그림이 저장소에 남지 않게 하기 위해서다.
      const raw = await readImageSize(bytes, mime);
      const size = { width: Math.round(raw.width * 100) / 100, height: Math.round(raw.height * 100) / 100 };
      const id = await contentId(bytes);
      await storeAssets([{ id, mime, bytes }]);
      const viewport = viewportRef.current?.getBoundingClientRect();
      const center = viewport ? toWorld(viewport.left + viewport.width / 2, viewport.top + viewport.height / 2) : { x: 0, y: 0 };
      const frame = frameAt(page, center, new Set());
      const nodeId = crypto.randomUUID();
      const input: NodeInput = { id: nodeId, type: 'rectangle', name: file.name || 'Image', parentId: frame?.id ?? null, x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2), width: size.width, height: size.height, fills: [{ type: 'image', assetId: id, fit: 'fill' }] };
      if (edit((current) => addShape(current, page.id, input))) { setSelectedIds([nodeId]); setTool('select'); }
    } catch (error) { setNotice(`[pasteImageFile] 그림 붙여 넣기 실패: ${message(error)}`); }
  };

  /** 글을 붙여 넣으면 텍스트 레이어를 만든다(Figma와 같음). */
  const pasteText = (text: string): void => {
    const viewport = viewportRef.current?.getBoundingClientRect();
    const center = viewport ? toWorld(viewport.left + viewport.width / 2, viewport.top + viewport.height / 2) : { x: 0, y: 0 };
    const frame = frameAt(page, center, new Set());
    const nodeId = crypto.randomUUID();
    const content = text.slice(0, 10_000);
    const lines = content.split('\n');
    const width = Math.min(600, Math.max(40, Math.max(...lines.map((line) => line.length)) * 11));
    const input: NodeInput = { id: nodeId, type: 'text', name: content.slice(0, 40).trim() || 'Text', parentId: frame?.id ?? null, x: Math.round(center.x - width / 2), y: Math.round(center.y), width, height: Math.max(26, lines.length * 26), fills: solid('#17223a'), text: content, fontSize: 18 };
    if (edit((current) => addShape(current, page.id, input))) { setSelectedIds([nodeId]); setTool('select'); }
  };

  const alignSelection = (mode: AlignMode): void => { edit((current) => alignNodes(current, page.id, topLevelIds(page, liveSelection), mode)); };
  const distributeSelection = (axis: DistributeAxis): void => { edit((current) => distributeNodes(current, page.id, topLevelIds(page, liveSelection), axis)); };

  /** 고른 요소를 그림 파일로 내려받는다. 여럿이면 합친 영역 하나로. */
  const exportSelection = (choice: ExportChoice): void => {
    const ids = topLevelIds(page, liveSelection);
    if (ids.length === 0) { setNotice('내보낼 요소를 고르세요.'); return; }
    const base = safeFileName(ids.length === 1 ? page.objects[ids[0]!]!.name : `${page.name} 선택`);
    setNotice('그림을 만드는 중…');
    exportImage(page, ids, choice.format, choice.scale)
      .then((blob) => { downloadBlob(`${base}${choice.format === 'png' && choice.scale !== 1 ? `@${choice.scale}x` : ''}.${choice.format}`, blob); setNotice(`${base}을(를) ${choice.format.toUpperCase()}로 내보냈습니다.`); })
      .catch((error: unknown) => setNotice(message(error)));
  };

  /** 좌우·상하 뒤집기. 잠긴 도형은 건너뛴다(방향키 이동과 같음). */
  const flipSelection = (axis: FlipAxis): void => {
    const ids = topLevelIds(page, liveSelection).filter((id) => !page.objects[id]?.locked);
    edit((current) => flipShapes(current, page.id, ids, axis));
  };

  const reorderSelection = (mode: ReorderMode): void => { edit((current) => reorderNodes(current, page.id, liveSelection, mode)); };

  /**
   * 방향키로 옮기기(Shift면 10px). 연달아 누르면 undo 한 번으로 되돌아가게 합친다.
   * 오토 레이아웃이 위치를 정하는 요소는 옮기는 대신 배치 방향을 따라 순서를 바꾼다(Figma와 같음).
   */
  const nudgeSelection = (arrow: string, step: number): void => {
    const [dx, dy] = ARROWS[arrow]!;
    const ids = topLevelIds(page, liveSelection).filter((id) => !page.objects[id]?.locked);
    const laidOut = (id: string): boolean => { const parent = page.objects[page.objects[id]!.parentId ?? '']; return Boolean(parent?.layout && !page.objects[id]!.item?.absolute); };
    const free = ids.filter((id) => !laidOut(id));
    if (free.length) { edit((current) => moveMany(current, page.id, free, dx * step, dy * step), `nudge:${free.join(',')}`); return; }
    const parent = ids[0] ? page.objects[page.objects[ids[0]]!.parentId ?? ''] : undefined;
    if (!parent?.layout) return;
    // Grid는 칸을 행 순서로 채우므로 오른쪽·아래는 뒤로, 왼쪽·위는 앞으로 보낸다.
    const along = parent.layout.type === 'grid' ? dx + dy : parent.layout.direction === 'row' ? dx : dy;
    if (along !== 0) reorderSelection(along > 0 ? 'forward' : 'backward');
  };

  const renameLayer = useStable((id: string, name: string): void => {
    const clean = name.trim().slice(0, 200);
    if (clean && clean !== page.objects[id]?.name) edit((current) => updateShape(current, page.id, id, { name: clean }));
  });

  const deleteSelection = (): void => {
    const ids = topLevelIds(page, liveSelection);
    if (ids.length === 0) return;
    edit((current) => deleteShapes(current, page.id, ids));
    setSelectedIds([]);
  };

  // 복사·잘라내기·붙여 넣기는 브라우저 클립보드 이벤트로 받는다. 권한 창 없이 시스템 클립보드를 쓰고, 다른 프로그램과도 글·그림을 주고받는다.
  useEffect(() => {
    const typing = (event: ClipboardEvent): boolean => event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || Boolean(viewerStart);
    const onCopy = (event: ClipboardEvent): void => {
      if (typing(event)) return;
      const data = copyNodes(page, liveSelection);
      if (!data) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', JSON.stringify(data));
      clipboardRef.current = data;
      if (event.type === 'cut') deleteSelection();
      else setNotice(`${data.roots.length}개 요소를 복사했습니다.`);
    };
    const onPaste = (event: ClipboardEvent): void => {
      if (typing(event)) return;
      const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
      if (image) { event.preventDefault(); void pasteImageFile(image); return; }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      try {
        const data = parseClipboard(text);
        if (data) { event.preventDefault(); pasteData(data); return; }
      } catch (error) { setNotice(message(error)); return; }
      if (text.trim()) { event.preventDefault(); pasteText(text); }
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('paste', onPaste);
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCopy); document.removeEventListener('paste', onPaste); };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 보기 모드에서는 보기 모드가 키를 처리한다. 편집 단축키(Delete 등)가 문서를 바꾸지 않게 막는다.
      if (viewerStart) return;
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key === 'Enter') { event.preventDefault(); present(); return; }
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (event.code === 'Space' && !event.repeat) { setSpaceHeld(true); if (!editing) event.preventDefault(); }
      if (editing) return;
      const mod = event.ctrlKey || event.metaKey;
      // Alt를 누르는 순간에도 거리가 보이게 마지막 마우스 위치로 바로 잰다. 브라우저 메뉴로 초점이 가지 않게 막는다.
      if (event.key === 'Alt') { event.preventDefault(); const hover = lastHover.current; if (hover && tool === 'select' && !drag.current) setMeasureId(measureTargetAt(hover.element, hover.point)); return; }
      const key = event.key.toLowerCase();
      if (pen && onPenKey(event)) return;
      if (pathEdit && onPathEditKey(event)) return;
      if (mod && event.altKey && BOOL_KEYS[key]) { event.preventDefault(); applyBoolean(BOOL_KEYS[key]!); return; }
      if (mod && key === 'e') { event.preventDefault(); flattenSelection(); return; }
      if (event.key === 'Enter' && selected && !mod) { event.preventDefault(); if (selected.type === 'text') setEditingId(selected.id); else startPathEdit(selected); return; }
      if (mod && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (mod && key === 'y') { event.preventDefault(); redo(); return; }
      if (mod && event.altKey && key === 'k') { event.preventDefault(); makeComponent(); return; }
      if (mod && key === 'a') { event.preventDefault(); setTool('select'); setSelectedIds(selectAllIds(page, liveSelection)); return; }
      if (mod && key === 'd') { event.preventDefault(); duplicateSelection(); return; }
      if (mod && event.shiftKey && key === 'e') { event.preventDefault(); exportSelection({ format: 'png', scale: 2 }); return; }
      if (event.altKey && !mod && liveSelection.length) {
        if (event.shiftKey && (key === 'h' || key === 'v')) { event.preventDefault(); distributeSelection(key === 'h' ? 'horizontal' : 'vertical'); return; }
        if (!event.shiftKey && ALIGN_KEYS[key]) { event.preventDefault(); alignSelection(ALIGN_KEYS[key]!); return; }
      }
      if (mod && event.altKey && key === 'm') { event.preventDefault(); maskSelection(); return; }
      if (mod && key === 'g') { event.preventDefault(); if (event.shiftKey) ungroupSelection(); else groupSelection(); return; }
      // 물리 키(code)를 먼저 보고, code가 비어 있는 입력(일부 자동화·키보드 배열)은 글자(key)로 알아본다.
      const bracketUp = event.code === 'BracketRight' || event.key === ']' || event.key === '}';
      const bracketDown = event.code === 'BracketLeft' || event.key === '[' || event.key === '{';
      if (mod && (bracketUp || bracketDown)) {
        event.preventDefault();
        const up = bracketUp;
        reorderSelection(event.shiftKey ? (up ? 'front' : 'back') : (up ? 'forward' : 'backward'));
        return;
      }
      if (mod && !event.shiftKey && (key === '0' || event.code === 'Digit0')) { event.preventDefault(); zoomAtCenter(() => 1); return; }
      if (mod && (key === '=' || key === '+')) { event.preventDefault(); zoomAtCenter((value) => value * 1.25); return; }
      if (mod && key === '-') { event.preventDefault(); zoomAtCenter((value) => value / 1.25); return; }
      if (event.shiftKey && !mod && !event.altKey && (event.code === 'Digit1' || event.key === '!')) { event.preventDefault(); fitCanvas(page); return; }
      if (event.shiftKey && !mod && !event.altKey && (event.code === 'Digit2' || event.key === '@') && liveSelection.length) { event.preventDefault(); zoomToRect(boundsOfIds(page, liveSelection), 4); return; }
      // Shift+H는 손 도구(H)보다 먼저 본다. 고른 것이 없으면 아래 도구 단축키로 넘어가지 않고 끝낸다.
      if (event.shiftKey && !mod && !event.altKey && (key === 'h' || key === 'v')) { event.preventDefault(); if (liveSelection.length) flipSelection(key === 'h' ? 'horizontal' : 'vertical'); return; }
      if (ARROWS[event.key] && !mod && !event.altKey && liveSelection.length) { event.preventDefault(); nudgeSelection(event.key, event.shiftKey ? 10 : 1); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
      if (event.key === 'Escape') { setTool('select'); setSelectedIds([]); return; }
      if (mod || event.altKey) return;
      const match = TOOLS.find((item) => item.shortcut.toLowerCase() === key);
      if (match) setTool(match.id);
    };
    const onKeyUp = (event: KeyboardEvent): void => { if (event.code === 'Space') setSpaceHeld(false); if (event.key === 'Alt') setMeasureId(null); };
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
      x: Math.round(point.x), y: Math.round(point.y), width: base.width, height: base.height, fills: solid(base.fill),
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

  /** 누른 도형 id. DOM 렌더러는 요소에서, Canvas 렌더러는 도형 모양으로 찾는다. 프레임 이름표 같은 DOM 위층이 먼저다. */
  const hitAt = (element: HTMLElement, point: Point): string | undefined =>
    element.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? (useCanvas ? frameTitleAt(page, point, 1 / zoom, TITLE_HEIGHT) ?? hitTest(page, point) ?? undefined : undefined);

  /**
   * 거리를 잴 대상. 고른 도형(과 그 하위) 위에서는 부모 프레임까지 재고(Figma와 같음), 그 밖에서는 마우스 아래 도형까지 잰다.
   * 고른 것이 없거나 아무것도 없는 곳이면 null.
   */
  const measureTargetAt = (element: HTMLElement, point: Point): string | null => {
    const roots = topLevelIds(page, liveSelection);
    // 선택 상자의 크기 핸들 위도 고른 도형 위로 본다.
    const hit = !roots.length ? undefined : element.closest('[data-handle]') ? roots[0] : hitAt(element, point);
    if (!hit || !page.objects[hit]) return null;
    if (!subtreeIds(page, roots).has(hit)) return hit;
    return page.objects[roots[0]!]?.parentId ?? null;
  };

  const onViewportMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const world = toWorld(event.clientX, event.clientY);
    if (pen && !drag.current) setPenCursor(world);
    collab.session.current?.cursor(page.id, world.x, world.y);
    lastHover.current = { element: event.target as HTMLElement, point: world };
    const next = event.altKey && tool === 'select' && !drag.current ? measureTargetAt(event.target as HTMLElement, world) : null;
    if (next !== measureId) setMeasureId(next);
  };

  const measure = (() => {
    const target = measureId ? page.objects[measureId] : undefined;
    if (!target || liveSelection.length === 0) return null;
    const box = boundsOf(worldCorners(target));
    return { target: box, lines: measureBetween(boundsOfIds(page, liveSelection), box) };
  })();

  const onCanvasDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button === 1 || tool === 'hand' || spaceHeldRef.current) { startPan(event); return; }
    if (event.button !== 0) return;
    const element = event.target as HTMLElement;
    const point = toWorld(event.clientX, event.clientY);
    const pin = element.closest<HTMLElement>('[data-comment-id]')?.dataset.commentId;
    if (pin) { setActiveComment(pin); setLeftTab('comments'); return; }
    if (tool === 'pen') { onPenDown(point); return; }
    if (tool === 'comment') { placeComment(point); return; }
    if (tool !== 'select') { createAt(tool, point); return; }
    if (pathEdit) { if (onPathEditDown(element, point, event.detail)) return; setPathEdit(null); }
    const handle = element.closest<HTMLElement>('[data-handle]')?.dataset.handle;
    if (handle && selected) { startTransform(handle, selected, event, point); return; }
    const hitId = hitAt(element, point);
    if (hitId && page.objects[hitId]) { startMove(hitId, event); return; }
    if (!event.shiftKey) setSelectedIds([]);
    drag.current = { kind: 'marquee', pageId: page.id, start: point, base: event.shiftKey ? liveSelection : [] };
  };

  /** 더블클릭은 그룹 안쪽 도형을 직접 고르고, 텍스트면 캔버스에서 바로 편집한다. */
  const onCanvasDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const hitId = hitAt(event.target as HTMLElement, toWorld(event.clientX, event.clientY));
    const node = hitId ? page.objects[hitId] : undefined;
    if (pathEdit || tool === 'pen') return;
    if (!node || node.locked) return;
    setSelectedIds([node.id]);
    if (node.type === 'text') setEditingId(node.id);
    if (node.type === 'vector') startPathEdit(node);
  };

  /** 펜: 클릭은 모서리 점, 끌기는 곡선 점. 첫 점을 다시 누르면 닫고, 마지막 점을 다시 누르면(더블클릭) 열린 채 끝낸다. */
  const onPenDown = (point: Point): void => {
    const reach = 8 / zoomRef.current;
    const first = pen?.points[0];
    const last = pen?.points[pen.points.length - 1];
    if (pen && first && pen.points.length >= 2 && Math.hypot(point.x - first.x, point.y - first.y) <= reach) { finishPen(pen, true); return; }
    if (pen && last && Math.hypot(point.x - last.x, point.y - last.y) <= 3 / zoomRef.current) { finishPen(pen, false); return; }
    setPen(penAddPoint(pen && pen.pageId === page.id ? pen : { pageId: page.id, points: [] }, point));
    drag.current = { kind: 'pen-handle' };
  };

  const finishPen = (draft: PenDraft, closed: boolean): void => {
    setPen(null); setPenCursor(null); setTool('select');
    if (draft.pageId !== page.id) return;
    const first = draft.points[0];
    const frame = first ? frameAt(page, first, new Set()) : null;
    const input = penNodeInput(draft, closed, crypto.randomUUID(), frame?.id ?? null);
    if (!input) return;
    if (edit((current) => addShape(current, page.id, input))) { setSelectedIds([input.id]); setNotice('벡터를 만들었습니다. 더블클릭하면 점을 고칠 수 있습니다.'); }
  };

  // 다른 도구로 바꾸면 그리던 펜 경로는 열린 채 끝내고, 경로 편집도 끝낸다(Figma와 같음).
  useEffect(() => {
    if (tool !== 'pen' && pen) finishPen(pen, false);
    if (tool !== 'select') setPathEdit(null);
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPenKey = (event: KeyboardEvent): boolean => {
    if (!pen) return false;
    if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finishPen(pen, false); return true; }
    if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); setPen({ ...pen, points: pen.points.slice(0, -1) }); return true; }
    return false;
  };

  /** 경로 편집을 시작한다. 편집 경로가 없는 도형(사각형·타원·가져온 벡터)은 먼저 같은 모양의 경로로 바꾼다. */
  const startPathEdit = (node: DesignNode): void => {
    if (node.locked || (node.type !== 'vector' && node.type !== 'rectangle' && node.type !== 'ellipse')) return;
    if (!node.path && !edit((current) => flattenToPath(current, page.id, node.id))) return;
    setSelectedIds([node.id]); setPathEdit({ id: node.id, point: null });
    setNotice('경로 편집: 점을 끌어 옮기고, 선 위를 눌러 점을 넣고, Delete로 지웁니다. Esc로 끝냅니다.');
  };

  /** 경로 편집 중 누르기. 점·핸들은 끌기 시작, 경로 위는 점 넣기, 도형 안쪽은 유지. 그 밖이면 false를 돌려 편집을 끝낸다. */
  const onPathEditDown = (element: HTMLElement, point: Point, clicks: number): boolean => {
    const node = pathEdit ? page.objects[pathEdit.id] : undefined;
    if (!node?.path) return false;
    const toLocal = invert(worldMatrix(node));
    const target = parseTarget(element.closest<SVGElement>('[data-path-part]')?.dataset.pathPart);
    if (target) {
      if (clicks >= 2 && target.part === 'anchor') { commitPath(docRef.current, page.id, node.id, toggleSmooth(node.path, target.sub, target.index)); return true; }
      setPathEdit({ id: node.id, point: { sub: target.sub, index: target.index } });
      drag.current = { kind: 'path', before: docRef.current, pageId: page.id, id: node.id, target, toLocal, base: node.path, path: node.path };
      return true;
    }
    if (element.closest('[data-path-segment]')) {
      const near = nearestSegment(node.path, applyPoint(toLocal, point));
      if (!near) return true;
      const base = insertPoint(node.path, near.sub, near.index, near.t);
      const inserted = { sub: near.sub, index: near.index + 1 };
      setPathEdit({ id: node.id, point: inserted });
      setDoc(applyChanges(docRef.current, updateShape(docRef.current, page.id, node.id, { path: base }).redo));
      drag.current = { kind: 'path', before: docRef.current, pageId: page.id, id: node.id, target: { ...inserted, part: 'anchor' }, toLocal, base, path: base };
      return true;
    }
    return hitAt(element, point) === node.id;
  };

  const onPathEditKey = (event: KeyboardEvent): boolean => {
    if (!pathEdit) return false;
    if (event.key === 'Escape' || event.key === 'Enter') { event.preventDefault(); setPathEdit(null); setNotice('경로 편집을 마쳤습니다.'); return true; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && pathEdit.point) {
      event.preventDefault();
      deletePathPoint(pathEdit.id, pathEdit.point);
      return true;
    }
    return false;
  };

  /** 고른 점을 지운다. 점이 모두 사라지면 도형을 지우고 편집을 끝낸다. */
  const deletePathPoint = (id: string, point: { sub: number; index: number }): void => {
    const node = page.objects[id];
    if (!node?.path) return;
    const path = removePathPoint(node.path, point.sub, point.index);
    setPathEdit(path.length ? { id, point: null } : null);
    if (path.length) { commitPath(docRef.current, page.id, id, path); return; }
    edit((current) => deleteShapes(current, page.id, [id])); setSelectedIds([]);
  };

  const applyBoolean = (op: BoolOp): void => {
    const ids = topLevelIds(page, liveSelection);
    if (ids.length < 2) { setNotice('불리언 연산에는 요소가 두 개 이상 필요합니다.'); return; }
    const id = crypto.randomUUID();
    if (edit((current) => createBoolean(current, page.id, ids, op, id))) setSelectedIds([id]);
  };

  /** 선택한 요소를 편집 경로 벡터로 바꾼다(Ctrl+E). 불리언 그룹은 결과 모양만 남는다. */
  const flattenSelection = (): void => {
    if (!selected) return;
    if (edit((current) => flattenToPath(current, page.id, selected.id))) setNotice(`${selected.name}을(를) 경로로 바꿨습니다.`);
  };

  /**
   * 컴포넌트 속성에 연결된 글자를 고치면 도형 대신 속성을 바꾼다(Figma와 같음). 인스턴스 안이면 그 인스턴스의 값, 메인 안이면 기본값이다.
   * 속성에 연결되지 않은 글자면 false를 돌려 평소처럼 고치게 한다.
   */
  const editPropText = (node: DesignNode, text: string): boolean => {
    const propId = node.propRefs?.text;
    const owner = propId ? propOwner(page, node) : undefined;
    const prop = owner?.componentId ? doc.components[owner.componentId]?.props?.find((item) => item.id === propId) : undefined;
    if (!owner || !prop) return false;
    edit((current) => (owner.mainInstance ? updateComponentProp(current, owner.componentId!, prop.id, { defaultValue: text }) : setInstanceProp(current, page.id, owner.id, prop.id, text)));
    return true;
  };

  const finishText = (id: string, text: string | null): void => {
    setEditingId(null);
    const node = page.objects[id];
    if (text === null || !node || text === node.text || editPropText(node, text)) return;
    // 구간 스타일은 글자 위치에 묶여 있어 내용이 바뀌면 어긋난다. 내용을 고치면 구간 스타일을 지운다.
    edit((current) => updateShape(current, page.id, id, { text, ...(node.spans?.length ? { spans: [] } : {}) }));
  };

  /** 컴포넌트 속성 편집. 오류(이름 없음, 메인 밖 도형 등)는 알림으로 보여 준다. */
  const runProp = (work: (current: DesignDocument) => Transaction): void => {
    try { edit(work); } catch (error) { setNotice(error instanceof Error ? error.message : '[componentProps] 속성 편집 실패'); }
  };
  const propActions: PropActions = {
    add: (nodeId, field, name) => runProp((current) => addComponentProp(current, page.id, nodeId, field, name, `prop-${crypto.randomUUID()}`)),
    link: (nodeId, field, propId) => runProp((current) => {
      const node = current.pages.find((item) => item.id === page.id)?.objects[nodeId];
      const refs = { ...node?.propRefs, [field]: propId ?? undefined };
      const clean = Object.fromEntries(Object.entries(refs).filter(([, value]) => value));
      return updateShape(current, page.id, nodeId, { propRefs: Object.keys(clean).length ? clean : undefined });
    }),
    update: (componentId, propId, patch) => runProp((current) => updateComponentProp(current, componentId, propId, patch)),
    remove: (componentId, propId) => runProp((current) => removeComponentProp(current, componentId, propId)),
    setValue: (rootId, propId, value) => runProp((current) => setInstanceProp(current, page.id, rootId, propId, value))
  };

  /** 속성 패널 편집. 프레임은 위치를 바꾸면 자식도 같이 옮기고, 그룹은 크기를 바꾸면 자식을 같은 비율로 늘린다. */
  const setProperty = (node: DesignNode, patch: Partial<DesignNode>): void => {
    // 속성에 연결된 글자는 속성 값으로 고친다(캔버스에서 고칠 때와 같은 규칙).
    if (patch.text !== undefined && Object.keys(patch).length === 1 && editPropText(node, patch.text)) return;
    const { x, y, width, height, ...changed } = patch;
    const rest = changed.text !== undefined && node.spans?.length ? { ...changed, spans: [] } : changed;
    const box = { x: x ?? node.x, y: y ?? node.y, width: width ?? node.width, height: height ?? node.height };
    // 같은 도형의 같은 속성을 연달아 고치면 undo 한 번에 되돌아가도록 합칠 키를 붙인다.
    edit((current) => composeTransactions(current, [
      (next) => resizeShape(next, page.id, node.id, box),
      (next) => fixSizingOnResize(next, page.id, node, box),
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


  /** 이미지 바이트를 IndexedDB에 넣고 화면에 쓸 object URL을 만든다. 저장에 실패해도 이번 세션 화면에는 보이게 한다. */
  const storeAssets = useCallback(async (records: readonly AssetRecord[]): Promise<void> => {
    if (records.length === 0) return;
    try { await putAssets(records); }
    catch (error) { setNotice(`이미지 저장 실패: ${message(error)}. 새로고침하면 이미지가 사라질 수 있습니다.`); }
    for (const record of records) requestedAssets.current.add(record.id);
    setAssetUrls((current) => ({ ...current, ...Object.fromEntries(records.map((record) => [record.id, URL.createObjectURL(new Blob([record.bytes as unknown as ArrayBuffer], { type: record.mime }))])) }));
  }, []);

  useEffect(() => {
    // 문서가 참조하지만 아직 화면용 URL이 없는 이미지를 IndexedDB에서 읽는다. 같은 id는 한 번만 요청한다.
    const missing = referencedAssets(doc).filter((id) => !requestedAssets.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requestedAssets.current.add(id));
    getAssets(missing)
      .then((records) => setAssetUrls((current) => ({ ...current, ...Object.fromEntries(records.map((record) => [record.id, URL.createObjectURL(new Blob([record.bytes as unknown as ArrayBuffer], { type: record.mime }))])) })))
      .catch((error: unknown) => setNotice(`이미지 불러오기 실패: ${message(error)}`));
  }, [doc]);

  /** JSON 저장 파일에는 이미지 바이트를 base64로 넣는다. 다른 브라우저에서 열어도 이미지가 보이게 하기 위해서다. */
  const saveJson = async (): Promise<void> => {
    const current = docRef.current;
    let records: AssetRecord[] = [];
    try { records = await getAssets(referencedAssets(current)); }
    catch (error) { setNotice(`이미지 읽기 실패: ${message(error)}. 이미지 없이 저장합니다.`); }
    const assets = Object.fromEntries(records.map((record) => [record.id, { mime: record.mime, base64: bytesToBase64(record.bytes) }]));
    download(`${current.name || 'design'}.json`, JSON.stringify({ ...current, ...(records.length ? { assets } : {}) }, null, 2), 'application/json');
  };

  const pickImage = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    const target = imageTarget.current;
    event.target.value = '';
    if (!file || !target) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniffImageMime(bytes);
      if (!mime) { setNotice(`[pickImage] 이미지 형식을 알 수 없음 - ${file.name}`); return; }
      const id = await contentId(bytes);
      await storeAssets([{ id, mime, bytes }]);
      const node = pageOf(docRef.current, pageId).objects[target.nodeId];
      if (!node) return;
      const fills: Paint[] = node.fills.map((paint, index) => (index === target.index && paint.type === 'image' ? { ...paint, assetId: id } : paint));
      edit((current) => updateShape(current, pageId, node.id, { fills }));
    } catch (error) { setNotice(`이미지 열기 실패: ${message(error)}`); }
  };

  const makeComponent = (): void => {
    if (!selected) return;
    if (edit((current) => createComponent(current, page.id, selected.id, crypto.randomUUID()))) setNotice(`${selected.name}을(를) 컴포넌트로 만들었습니다.`);
  };

  /** 화면 가운데(그 아래 프레임이 있으면 그 안)에 인스턴스를 넣고 선택한다. */
  const insertInstance = (componentId: string): void => {
    const viewport = viewportRef.current?.getBoundingClientRect();
    const point = viewport ? toWorld(viewport.left + viewport.width / 2, viewport.top + viewport.height / 2) : { x: 0, y: 0 };
    const frame = frameAt(page, point, new Set());
    let rootId = '';
    const done = edit((current) => { const created = createInstance(current, page.id, componentId, { parentId: frame?.id ?? null, x: Math.round(point.x), y: Math.round(point.y) }, () => crypto.randomUUID()); rootId = created.rootId; return created.tx; });
    if (done) { setSelectedIds([rootId]); setTool('select'); }
  };

  const switchInstanceVariant = (rootId: string, componentId: string): void => {
    let next = '';
    if (edit((current) => { const switched = switchVariant(current, page.id, rootId, componentId, () => crypto.randomUUID()); next = switched.rootId; return switched.tx; })) setSelectedIds([next]);
  };

  const combineSelection = (): void => {
    const setId = crypto.randomUUID();
    if (edit((current) => combineAsVariants(current, page.id, liveSelection, setId, 'Component set'))) setSelectedIds([setId]);
  };

  const goToMain = (node: DesignNode): void => {
    const component = node.componentId ? doc.components[node.componentId] : undefined;
    if (!component) return;
    setPageId(component.pageId); setSelectedIds([component.mainId]);
    fitCanvas(pageOf(docRef.current, component.pageId));
  };

  /** 코멘트 도구로 누른 자리에 새 코멘트 입력을 연다. 코멘트는 공유 파일에서만 쓸 수 있다. */
  const placeComment = (point: Point): void => {
    if (!collab.file) { setNotice('코멘트는 공유 파일에서 쓸 수 있습니다. 위쪽 공유 버튼으로 파일을 여세요.'); return; }
    setCommentDraft({ x: Math.round(point.x), y: Math.round(point.y) }); setActiveComment(null); setLeftTab('comments');
  };

  /** 코멘트 스레드를 누르면 그 페이지로 가서 핀을 화면 가운데에 둔다. */
  const focusComment = (thread: CommentThread): void => {
    setActiveComment(thread.id);
    if (thread.pageId !== page.id) setPageId(thread.pageId);
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (bounds) setPan({ x: bounds.width / 2 - thread.x * zoom, y: bounds.height / 2 - thread.y * zoom });
  };

  /** 보기 모드를 연다. 선택한 요소가 있는 화면에서 시작하고, 화면(최상위 프레임)이 없으면 알린다. */
  const present = (): void => {
    const start = startScreen(page, liveSelection);
    if (!start) { setNotice('보기 모드에는 페이지 최상위 프레임(화면)이 필요합니다.'); return; }
    setPen(null); setPathEdit(null); setEditingId(null);
    setViewerStart(start);
  };

  const switchPage = (id: string): void => {
    setPageId(id); setSelectedIds([]); setEditingId(null);
    fitCanvas(pageOf(docRef.current, id));
  };

  const addNewPage = (): void => {
    const id = crypto.randomUUID();
    if (edit((current) => addPage(current, emptyPage(id, `Page ${current.pages.length + 1}`)))) { setPageId(id); setSelectedIds([]); }
  };

  /** 페이지를 지우고, 보던 페이지였으면 바로 옆 페이지로 옮겨 간다. */
  const removePage = (id: string): void => {
    const pages = docRef.current.pages;
    const index = pages.findIndex((item) => item.id === id);
    const neighbor = pages[index + 1] ?? pages[index - 1];
    if (!edit((current) => deletePage(current, id))) return;
    setNotice(`'${pages[index]?.name ?? ''}' 페이지를 지웠습니다. Ctrl+Z로 되돌릴 수 있습니다.`);
    if (id === page.id && neighbor) switchPage(neighbor.id);
  };

  const openFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]; if (!file) return;
    // 공유 파일 위에 다른 파일을 열면 모든 참여자의 문서가 바뀐다. 공유 파일을 닫고 로컬 문서로 연다.
    if (collab.file) { collab.disconnect(); setNotice('공유 파일을 닫고 로컬 문서로 엽니다.'); }
    try {
      if (file.name.toLowerCase().endsWith('.fig')) {
        const fig = readFigFile(new Uint8Array(await file.arrayBuffer()));
        const frames = listFigFrames(fig);
        // 맨 위가 도형·벡터뿐인 파일은 프레임 목록이 빈다. 그 도형들을 후보로 보여 주고 창에서 안내한다.
        const entries = frames.length ? frames : listFigTopNodes(fig);
        figDocRef.current = fig;
        setFigFrames(entries);
        setFigListIsNodes(!frames.length);
        setPendingFig(file);
        // 후보가 하나뿐이면 바로 고른다.
        setFigInput(entries.length === 1 ? entries[0]!.id : '');
      } else {
        const raw = await file.text();
        const loaded = parseDocument(raw);
        await storeAssets(embeddedAssets(raw));
        edit((current) => replaceDocument(current, loaded)); setPageId(loaded.pages[0]!.id); setSelectedIds([]); fitCanvas(loaded.pages[0]!);
        setNotice(`${file.name}을(를) 열었습니다.`);
      }
    } catch (error) { setNotice(`열기 실패: ${message(error)}`); }
    finally { event.target.value = ''; }
  };

  /** 가져오기 창을 닫고 열어 둔 .fig 해석 결과를 버린다(메모리에 큰 파일을 붙잡지 않게). */
  const closeFigImport = (): void => { setPendingFig(null); setFigFrames([]); setFigListIsNodes(false); figDocRef.current = null; };

  const importPendingFig = async (): Promise<void> => {
    if (!pendingFig) return;
    const id = figmaNodeId(figInput);
    if (!id) { setNotice('Figma 링크의 node-id 또는 779:23219 형식의 ID를 입력하세요.'); return; }
    setImporting(true);
    try {
      const imported = figDocRef.current ? importFigNode(figDocRef.current, id) : importFigFile(new Uint8Array(await pendingFig.arrayBuffer()), id);
      const first = imported.document.pages[0]!;
      await storeAssets(imported.assets);
      setImportReport(imported.report);
      edit((current) => replaceDocument(current, imported.document)); setPageId(first.id); setSelectedIds([id]); fitCanvas(first);
      setNotice(`${imported.report.imported}개 요소 · 인스턴스 ${imported.report.expandedInstances}개 · override ${imported.report.appliedOverrides}개 적용/${imported.report.unappliedOverrides}개 미적용 · 도형 ${imported.report.approximatedShapes}개 근사`);
      closeFigImport();
    } catch (error) { setNotice(`가져오기 실패: ${message(error)}`); }
    finally { setImporting(false); }
  };

  const shapeCount = useMemo(() => walkPage(page).length, [page]);
  const visibleCount = useMemo(() => walkPage(page).filter((node) => !node.hidden).length, [page]);
  // 보이는 도형이 측정한 기준보다 많으면 Canvas로 그린다(S9-01). 사용자가 상태 표시줄에서 고정할 수도 있다.
  const useCanvas = rendererPref === 'canvas' || (rendererPref === 'auto' && visibleCount > CANVAS_THRESHOLD);
  const cycleRenderer = (): void => {
    const next: RendererPreference = rendererPref === 'auto' ? 'dom' : rendererPref === 'dom' ? 'canvas' : 'auto';
    setRendererPref(next);
    try { localStorage.setItem('canvas-studio-renderer', next); } catch { /* 이 탭에서만 유지 */ }
  };
  const onLayerSelect = useStable((id: string, additive: boolean): void => { setTool('select'); setSelectedIds(additive ? (liveSelection.includes(id) ? liveSelection.filter((item) => item !== id) : [...liveSelection, id]) : [id]); });
  const onLayerToggle = useStable((id: string, key: 'hidden' | 'locked'): void => { edit((current) => updateShape(current, page.id, id, { [key]: !page.objects[id]?.[key] })); });
  const onLayerDropStable = useStable(onLayerDrop);
  // 플러그인에 내주는 기능. 호출 시점의 문서·페이지·선택을 쓰고, 쓰기는 edit를 거쳐 undo·공동 편집에 들어간다(S9-02).
  const pluginHost: PluginHost = {
    doc: useStable(() => docRef.current),
    pageId: useStable(() => page.id),
    selection: useStable(() => liveSelection),
    edit: useStable((build: (current: DesignDocument) => Transaction) => edit(build)),
    select: useStable((ids: string[]) => { setTool('select'); setSelectedIds(ids); }),
    notify: useStable((text: string) => setNotice(text)),
    newId: useStable(() => crypto.randomUUID())
  };
  const closePlugin = useStable(() => setRunningPlugin(null));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◆</span><span>Canvas Studio</span></div>
        <div className="file-info"><input aria-label="문서 이름" value={collab.file ? collab.file.name : doc.name} disabled={Boolean(collab.file)} title={collab.file ? '공유 파일 이름은 서버에서 정합니다' : undefined} onChange={(event) => setDoc({ ...docRef.current, name: event.target.value })} /><span className={`saved-dot ${saveFailed ? 'failed' : ''}`} /> <span>{saveFailed ? '저장 실패' : '자동 저장됨'}</span></div>
        <div className="top-actions">
          <PresenceBar collab={collab} onOpen={() => setShareOpen(true)} />
          <button onClick={() => setPluginsOpen(true)}>플러그인</button>
          <button onClick={() => fileRef.current?.click()}>열기</button>
          <button onClick={() => { void saveJson(); }}>JSON 저장</button>
          <button title="보기 모드 (Ctrl+Alt+Enter)" onClick={present}>▶ 보기</button>
          <button className="primary" disabled={!selected} onClick={() => setCodeOpen(true)}>React 코드</button>
          <input ref={fileRef} type="file" accept=".json,.fig,application/json" hidden onChange={(event) => { void openFile(event); }} />
          <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={(event) => { void pickImage(event); }} />
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
          <PagesPanel pages={doc.pages} currentId={page.id} onSwitch={switchPage} onAdd={addNewPage} onRename={(id, name) => edit((current) => renamePage(current, id, name))} onDelete={removePage} />
          <div className="panel-heading panel-tabs">
            <button className={leftTab === 'layers' ? 'active' : ''} onClick={() => setLeftTab('layers')}>레이어 <span>{shapeCount}</span></button>
            <button className={leftTab === 'assets' ? 'active' : ''} onClick={() => setLeftTab('assets')}>에셋 <span>{Object.keys(doc.components).length}</span></button>
            {collab.file ? <button className={leftTab === 'comments' ? 'active' : ''} onClick={() => setLeftTab('comments')}>코멘트 <span>{collab.comments.filter((thread) => !thread.resolved).length}</span></button> : null}
          </div>
          {leftTab === 'comments' && collab.file ? <CommentsPanel collab={collab} page={page} draft={commentDraft} activeId={activeComment} onCancelDraft={() => setCommentDraft(null)} onFocus={focusComment} />
          : leftTab !== 'assets' ? <LayersPanel page={page} selectedIds={liveSelection} onSelect={onLayerSelect} onToggle={onLayerToggle} onDrop={onLayerDropStable} onRename={renameLayer} />
            : <AssetsPanel doc={doc} onInsert={insertInstance}
              onAddToken={(type) => { const id = crypto.randomUUID(); edit((current) => setToken(current, { id, type, name: `${type === 'color' ? 'Color' : 'Number'} ${Object.keys(current.tokens).length + 1}`, value: type === 'color' ? '#5369f8' : 8 })); }}
              onChangeToken={(token) => edit((current) => setToken(current, token), `token:${token.id}`)}
              onDeleteToken={(id) => edit((current) => removeToken(current, id))} />}
        </aside>

        <main className="canvas-area">
          <Rulers pan={pan} zoom={zoom} width={viewportSize.width} height={viewportSize.height} selection={liveSelection.length ? boundsOfIds(page, liveSelection) : null} />
          <div className="canvas-viewport" ref={viewportRef} onPointerDown={onCanvasDown} onDoubleClick={onCanvasDoubleClick} onPointerMove={onViewportMove} style={{ cursor: tool === 'hand' || spaceHeld ? 'grab' : tool === 'select' ? 'default' : 'crosshair' }}>
            {useCanvas ? <CanvasView page={page} pan={pan} zoom={zoom} editingId={editingId} resolveAsset={resolveAsset} /> : null}
            <div className="canvas-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, '--unit': 1 / zoom } as CSSProperties}>
              {useCanvas
                ? (editingId && page.objects[editingId] ? <TextEditOverlay node={page.objects[editingId]!} onDone={finishText} /> : null)
                : <CanvasNodes page={page} editingId={editingId} onTextDone={finishText} resolveAsset={resolveAsset} />}
              <SelectionOverlay page={page} selectedIds={liveSelection} editingId={pathEdit?.id ?? editingId} zoom={zoom} guides={guides} marquee={marquee} measure={measure} titles={!useCanvas} visible={{ x: -pan.x / zoom, y: -pan.y / zoom, width: viewportSize.width / zoom, height: viewportSize.height / zoom }} />
              {pathEdit && page.objects[pathEdit.id] ? <PathEditOverlay node={page.objects[pathEdit.id]!} unit={1 / zoom} active={pathEdit.point} /> : null}
              {pen && pen.pageId === page.id ? <PenOverlay draft={pen} cursor={penCursor} unit={1 / zoom} /> : null}
              {rightTab === 'prototype' && selected ? <PrototypeLinks page={page} node={selected} unit={1 / zoom} /> : null}
              {collab.file ? <CommentPins comments={collab.comments} page={page} draft={commentDraft} activeId={activeComment} unit={1 / zoom} /> : null}
              {collab.file ? <RemoteCursors cursors={collab.cursors} peers={collab.peers} pageId={page.id} unit={1 / zoom} /> : null}
            </div>
          </div>
          <div className="zoom-controls"><button title="축소 (Ctrl+-)" onClick={() => zoomAtCenter((value) => value / 1.25)}>−</button><button className="zoom-value" title="100%로 (Ctrl+0)" onClick={() => zoomAtCenter(() => 1)}>{Math.round(zoom * 100)}%</button><button title="확대 (Ctrl+=)" onClick={() => zoomAtCenter((value) => value * 1.25)}>+</button><button title="전체 맞춤 (Shift+1)" onClick={() => fitCanvas(page)}>맞춤</button></div>
        </main>

        <aside className="right-panel">
          <div className="panel-heading panel-tabs">
            <button className={rightTab === 'design' ? 'active' : ''} onClick={() => setRightTab('design')}>디자인</button>
            <button className={rightTab === 'prototype' ? 'active' : ''} onClick={() => setRightTab('prototype')}>프로토타입</button>
            <button className={rightTab === 'code' ? 'active' : ''} onClick={() => setRightTab('code')}>코드</button>
          </div>
          {rightTab === 'design' && liveSelection.length > 0 ? <AlignBar count={topLevelIds(page, liveSelection).length} onAlign={alignSelection} onDistribute={distributeSelection} onFlip={flipSelection} /> : null}
          {rightTab === 'code' ? (selected
            ? <InspectPanel key={selected.id} doc={doc} page={page} node={selected} onOpenCode={() => setCodeOpen(true)} onCopy={(text, label) => void navigator.clipboard.writeText(text).then(() => setNotice(`${label}를 복사했습니다.`)).catch(() => setNotice('[InspectPanel] 복사 실패 - 클립보드 권한 없음'))} />
            : <div className="nothing-selected"><span>{'</>'}</span><strong>코드 검사</strong><p>요소를 선택하면 그 요소의 CSS를 px 또는 rem으로 보여 줍니다.</p></div>)
          : rightTab === 'prototype' ? (selected
            ? <PrototypePanel key={selected.id} page={page} node={selected}
              onChange={(interactions) => edit((current) => updateShape(current, page.id, selected.id, { interactions: interactions.length ? interactions : undefined }), `${selected.id}:interactions`)}
              onFixedScroll={(fixed) => edit((current) => updateShape(current, page.id, selected.id, { fixedScroll: fixed || undefined }))}
              onPresent={present} />
            : <div className="nothing-selected"><span>▶</span><strong>프로토타입</strong><p>요소를 선택해 클릭·마우스·지연 트리거를 연결하고, 보기 모드로 실행합니다.</p><button className="wide-action" onClick={present}>▶ 보기 모드로 실행</button></div>)
          : selected ? <PropertiesPanel key={selected.id} node={selected} parent={selected.parentId ? page.objects[selected.parentId] : undefined}
            header={<ComponentSection doc={doc} page={page} node={selected} onCreate={makeComponent} onSwitchVariant={(componentId) => switchInstanceVariant(selected.id, componentId)} onGoToMain={() => goToMain(selected)} onReset={() => edit((current) => resetOverrides(current, page.id, selected.id))} onDetach={() => edit((current) => detachInstance(current, page.id, selected.id))} props={propActions} />}
            path={<><PathSection node={selected} onOp={(op) => edit((current) => updateShape(current, page.id, selected.id, { boolOp: op, name: op[0]!.toUpperCase() + op.slice(1) }))} onFlatten={flattenSelection} onEditPath={() => startPathEdit(selected)} />{selected.mask ? <button className="wide-action" title="Ctrl+Alt+M" onClick={maskSelection}>◐ 마스크 해제</button> : null}</>}
            tokens={<TokenSection doc={doc} node={selected} onApply={(slot, tokenId) => edit((current) => applyToken(current, page.id, selected.id, slot, tokenId))} />}
            onPickImage={(index) => { imageTarget.current = { nodeId: selected.id, index }; imageRef.current?.click(); }}
            onChange={(patch) => setProperty(selected, patch)}
            onRotate={(degrees) => edit((current) => rotateShape(current, page.id, selected.id, degrees - rotationDegrees(selected.transform)), `${selected.id}:rotation`)}
            onOpenCode={() => setCodeOpen(true)}
            onDelete={deleteSelection}
            exportRow={<ExportImageRow onExport={exportSelection} />} />
            : liveSelection.length > 1 ? <div className="nothing-selected"><span>⧉</span><strong>{liveSelection.length}개 선택됨</strong><p>Ctrl+G로 묶거나 Delete로 지울 수 있습니다.</p><button className="wide-action" onClick={groupSelection}>그룹으로 묶기</button><button className="wide-action" title="맨 아래 요소가 위 요소들을 자릅니다 (Ctrl+Alt+M)" onClick={maskSelection}>◐ 마스크로 쓰기</button><BooleanButtons onApply={applyBoolean} /><ExportImageRow onExport={exportSelection} />{liveSelection.every((id) => page.objects[id]?.mainInstance) ? <button className="wide-action" onClick={combineSelection}>⬖ variant로 묶기</button> : null}</div>
            : <div className="nothing-selected"><span>◈</span><strong>선택된 요소가 없습니다</strong><p>캔버스나 레이어에서 요소를 선택하면 속성이 표시됩니다.</p></div>}
        </aside>
      </div>

      {pluginsOpen ? <PluginManager onRun={setRunningPlugin} onClose={() => setPluginsOpen(false)} /> : null}
      {runningPlugin ? <PluginPanel key={runningPlugin.id} plugin={runningPlugin} host={pluginHost} doc={doc} selection={liveSelection} onClose={closePlugin} /> : null}
      {shareOpen ? <ShareModal collab={collab} documentName={doc.name} onUpload={(name) => collab.upload(name, docRef.current)} onClose={() => setShareOpen(false)} /> : null}
      {viewerStart ? <Viewer page={page} start={viewerStart} resolveAsset={(assetId) => assetUrls[assetId] ?? null} onClose={() => setViewerStart(null)} /> : null}

      <footer className="statusbar"><span>{notice}{recovery ? <button className="recovery-link" onClick={() => download('canvas-studio-recovery.json', recovery, 'application/json')}>복구본 다운로드</button> : null}</span><button className="renderer-toggle" title="렌더러 바꾸기: 자동(보이는 도형 3,000개 초과 시 Canvas) → DOM → Canvas" onClick={cycleRenderer}>{useCanvas ? 'Canvas' : 'DOM'}{rendererPref === 'auto' ? ' (자동)' : ''}</button> <span>{shapeCount} layers · {selected ? selected.name : liveSelection.length > 1 ? `${liveSelection.length}개 선택` : '선택 없음'}</span></footer>

      {pendingFig ? <div className="modal-backdrop"><section className="import-modal"><header><strong>Figma 프레임 가져오기</strong><button aria-label="닫기" onClick={closeFigImport}>×</button></header><p>{pendingFig.name}</p>{figListIsNodes ? <p className="import-notice" role="status">이 파일의 페이지 맨 위에는 프레임이 없습니다. {figFrames.length ? '아래 목록에서 맨 위 도형을 고르거나 ' : ''}가져올 노드의 Figma 링크나 node-id(예: 1:2)를 입력하세요.</p> : null}{figFrames.length ? <label className="field full"><span>{figListIsNodes ? `페이지 맨 위 도형 (${figFrames.length}개)` : `파일 안의 프레임 (${figFrames.length}개)`}</span><select value={figFrames.some((frame) => frame.id === figmaNodeId(figInput)) ? figmaNodeId(figInput)! : ''} onChange={(event) => setFigInput(event.target.value)}><option value="">{figListIsNodes ? '도형 고르기' : '프레임 고르기'}</option>{[...new Set(figFrames.map((frame) => frame.page))].map((pageName) => <optgroup key={pageName} label={pageName}>{figFrames.filter((frame) => frame.page === pageName).map((frame) => <option key={frame.id} value={frame.id}>{frame.name} · {figListIsNodes ? `${frame.type} · ` : ''}{frame.width}×{frame.height}{figListIsNodes ? ` · ${frame.id}` : ''}</option>)}</optgroup>)}</select></label> : null}<label className="field full"><span>또는 Figma 링크·node-id</span><input autoFocus placeholder="https://www.figma.com/design/...?node-id=779-23219" value={figInput} onChange={(event) => setFigInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void importPendingFig(); }} /></label><small>현재 프레임의 노드와 참조 컴포넌트를 로컬에서 읽습니다. 이미지·그라디언트·일부 벡터와 override의 표현은 아직 근사치입니다.</small><footer><button onClick={closeFigImport}>취소</button><button className="primary" disabled={importing} onClick={() => void importPendingFig()}>{importing ? '가져오는 중…' : '가져오기'}</button></footer></section></div> : null}

      {importReport ? <ImportReportModal report={importReport} onClose={() => setImportReport(null)} onDownload={() => download('import-report.json', JSON.stringify(importReport, null, 2), 'application/json')} /> : null}

      {codeOpen && exported ? <div className="modal-backdrop" onPointerDown={() => setCodeOpen(false)}><section className="code-modal" onPointerDown={(event) => event.stopPropagation()}><header><div><strong>{exported.name}.tsx · {exported.cssFile}</strong><span>선택한 요소의 React/TypeScript 초안과 CSS. 태그는 레이어 이름으로, 토큰은 CSS 변수로 나옵니다.</span></div><button aria-label="닫기" onClick={() => setCodeOpen(false)}>×</button></header>
        <div className="code-tabs" role="tablist">{(['tsx', 'css'] as const).map((tab) => <button key={tab} role="tab" aria-selected={codeTab === tab} className={codeTab === tab ? 'active' : ''} onClick={() => setCodeTab(tab)}>{tab === 'tsx' ? `${exported.name}.tsx` : exported.cssFile}</button>)}</div>
        <pre><code>{codeTab === 'tsx' ? exported.code : exported.css}</code></pre><footer><button onClick={() => void navigator.clipboard.writeText(codeTab === 'tsx' ? exported.code : exported.css).then(() => setNotice(`${codeTab === 'tsx' ? 'TSX' : 'CSS'}를 복사했습니다.`))}>{codeTab === 'tsx' ? 'TSX' : 'CSS'} 복사</button><button onClick={() => { download(`${exported.name}.tsx`, exported.code, 'text/plain'); download(exported.cssFile, exported.css, 'text/css'); }}>TSX·CSS 다운로드</button><button className="primary" onClick={downloadCodeZip}>zip 받기{exported.assets.length ? ` (그림 ${exported.assets.length}개 포함)` : ''}</button></footer></section></div> : null}
    </div>
  );
}

/** JSON 파일에 함께 저장된 이미지(assets: { id: { mime, base64 } })를 꺼낸다. 형식이 어긋난 항목은 건너뛴다. */
function embeddedAssets(raw: string): AssetRecord[] {
  const value = JSON.parse(raw) as { assets?: Record<string, { mime?: unknown; base64?: unknown }> };
  if (!value.assets || typeof value.assets !== 'object') return [];
  return Object.entries(value.assets).flatMap(([id, item]) => typeof item?.mime === 'string' && typeof item.base64 === 'string' ? [{ id, mime: item.mime, bytes: base64ToBytes(item.base64) }] : []);
}
