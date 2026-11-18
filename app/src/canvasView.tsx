import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Page } from './model';
import type { AssetResolver } from './styleCss';
import { FrameCache, drawPage, type DrawStats } from './canvasRenderer';

/** 이보다 보이는 도형이 많으면 자동으로 Canvas 렌더러를 쓴다. 측정: DOM은 2,400개에서 프레임 12.5ms, 4,800개에서 20.8ms(60fps 한계 16.7ms). */
export const CANVAS_THRESHOLD = 3000;

export type RendererPreference = 'auto' | 'dom' | 'canvas';

interface CanvasViewProps {
  page: Page;
  pan: { x: number; y: number };
  zoom: number;
  editingId: string | null;
  resolveAsset: AssetResolver;
  onStats?: (stats: DrawStats) => void;
}

/**
 * Canvas 렌더러 화면. 보이는 영역 크기의 캔버스 하나에 그리고, 화면 이동·확대·문서 변경마다 다시 그린다.
 * 그리기는 레이아웃 단계에서 동기로 해서 화면 이동과 같은 프레임에 반영된다.
 */
export function CanvasView({ page, pan, zoom, editingId, resolveAsset, onStats }: CanvasViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [imageVersion, setImageVersion] = useState(0);
  const images = useRef(new Map<string, HTMLImageElement>());
  const cache = useRef(new FrameCache());
  const lastZoom = useRef(zoom);
  const [sharpen, setSharpen] = useState(0);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  /** 이미지는 처음 요청할 때 읽기 시작하고, 다 읽히면 다시 그린다. 주소가 같으면 다시 읽지 않는다. */
  const imageFor = useCallback((assetId: string): HTMLImageElement | null => {
    const url = resolveAsset(assetId);
    if (!url) return null;
    let image = images.current.get(url);
    if (!image) {
      image = new Image();
      // 새 이미지는 보관한 프레임 그림에 아직 없으므로 모두 버리고 다시 그린다.
      image.onload = () => { cache.current.clear(); setImageVersion((value) => value + 1); };
      image.src = url;
      images.current.set(url, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  }, [resolveAsset]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || size.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.width * dpr)) canvas.width = Math.round(size.width * dpr);
    if (canvas.height !== Math.round(size.height * dpr)) canvas.height = Math.round(size.height * dpr);
    // 배율이 바뀌는 중에는 보관한 그림을 늘려 쓰고, 멈춘 뒤 한 번 선명하게 다시 그린다(Figma와 같은 방식).
    const zooming = lastZoom.current !== zoom;
    lastZoom.current = zoom;
    const stats = drawPage(ctx, page, { panX: pan.x, panY: pan.y, zoom, width: size.width, height: size.height, dpr }, imageFor, editingId, { store: cache.current, allowStale: zooming });
    onStats?.(stats);
    // 개발 서버에서만 마지막 그리기 통계를 남긴다(scripts\bench-render.js가 읽는다).
    if (import.meta.env.DEV) (window as unknown as { __canvasStats?: DrawStats }).__canvasStats = stats;
    if (stats.stale) { const timer = window.setTimeout(() => setSharpen((value) => value + 1), 150); return () => window.clearTimeout(timer); }
  }, [page, pan, zoom, size, editingId, imageFor, imageVersion, onStats, sharpen]);

  return <canvas ref={canvasRef} className="render-canvas" style={{ width: size.width, height: size.height }} />;
}
