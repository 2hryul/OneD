import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Interaction, Page } from './model';
import { NodeTree } from './canvas';
import type { AssetResolver } from './styleCss';
import { ancestorIds, clickInteraction, fixedChildren, overlayPlacement, runAction, safeUrl, screensOf, type ViewerState } from './prototype';

const BAR_HEIGHT = 44;
const MARGIN = 24;

interface ViewerProps { page: Page; start: string; resolveAsset: AssetResolver; onClose: () => void }

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

/** 이벤트가 일어난 도형 id와 그 도형이 든 층(화면 또는 오버레이)의 루트 id. */
function hitOf(target: EventTarget): { id: string; layer: string } | null {
  const element = target as HTMLElement;
  const id = element.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
  const layer = element.closest<HTMLElement>('[data-layer]')?.dataset.layer;
  return id && layer ? { id, layer } : null;
}

/**
 * 보기 모드(Figma 프레젠테이션, Penpot viewer). 화면 하나를 너비에 맞춰 그리고, 길면 세로로 스크롤한다.
 * 클릭·마우스 들어옴/나감·지연 트리거를 받아 화면 이동·오버레이·뒤로·URL 열기를 실행한다.
 * 상호작용이 없는 곳을 누르면 누를 수 있는 곳(핫스팟)을 잠깐 표시한다.
 */
export function Viewer({ page, start, resolveAsset, onClose }: ViewerProps): JSX.Element | null {
  const [state, setState] = useState<ViewerState>({ screen: start, overlays: [], history: [] });
  const [flash, setFlash] = useState(false);
  const hovered = useRef<string[]>([]);
  const windowSize = useWindowSize();
  const screen = page.objects[state.screen];
  const screens = screensOf(page);

  const execute = (interaction: Interaction, layer: string): void => {
    const { action } = interaction;
    if (action.type === 'open-url') {
      const url = safeUrl(action.url);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    setState((current) => runAction(current, action, page, layer === current.screen ? undefined : layer));
  };

  const goTo = (screenId: string): void => setState((current) => screenId === current.screen ? current : { screen: screenId, overlays: [], history: [...current.history, current.screen] });

  useEffect(() => {
    hovered.current = [];
    // 지연 트리거는 화면 프레임 자신에 둔다(Penpot과 같음). 화면이 바뀌면 남은 타이머는 취소한다.
    const timers = (page.objects[state.screen]?.interactions ?? [])
      .filter((item) => item.trigger === 'after-delay')
      .map((item) => window.setTimeout(() => execute(item, state.screen), item.delay ?? 0));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [state.screen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const index = screens.findIndex((node) => node.id === state.screen);
      if (event.key === 'Escape') { event.preventDefault(); if (state.overlays.length) setState({ ...state, overlays: state.overlays.slice(0, -1) }); else onClose(); }
      else if (event.key === 'ArrowRight' && screens[index + 1]) goTo(screens[index + 1]!.id);
      else if (event.key === 'ArrowLeft' && index > 0) goTo(screens[index - 1]!.id);
      else if (event.key.toLowerCase() === 'r' && !event.ctrlKey) setState({ screen: start, overlays: [], history: [] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!screen) return <div className="viewer"><div className="viewer-empty">보여줄 화면이 없습니다. <button onClick={onClose}>닫기</button></div></div>;

  const availableWidth = windowSize.width - MARGIN * 2;
  const availableHeight = windowSize.height - BAR_HEIGHT - MARGIN * 2;
  const scale = Math.min(1, availableWidth / screen.width);
  const viewHeight = Math.min(screen.height * scale, availableHeight);
  const view = { width: screen.width, height: viewHeight / scale };

  /** 포인터 아래 같은 층의 도형 id(위가 먼저). */
  const clickTarget = (clientX: number, clientY: number, layer: string): Interaction | null => {
    const hits = document.elementsFromPoint(clientX, clientY).map(hitOf).filter((hit): hit is { id: string; layer: string } => hit?.layer === layer).map((hit) => hit.id);
    return clickInteraction(page, hits, layer);
  };

  /** 맨 위 오버레이가 바깥 클릭으로 닫히는 경우 그것을 먼저 처리한다. */
  const onClick = (event: ReactMouseEvent): void => {
    const hit = hitOf(event.target);
    const top = state.overlays[state.overlays.length - 1];
    if (top && hit?.layer !== top.id) {
      if (top.closeOnOutside) setState({ ...state, overlays: state.overlays.slice(0, -1) });
      return;
    }
    const found = hit ? clickTarget(event.clientX, event.clientY, hit.layer) : null;
    if (found && hit) { execute(found, hit.layer); return; }
    setFlash(true);
    window.setTimeout(() => setFlash(false), 500);
  };

  /** 포인터 아래 도형 목록이 바뀐 만큼 나감·들어옴 트리거를 실행한다. 각 도형 자신의 상호작용만 본다. */
  const updateHover = (target: EventTarget | null): void => {
    const hit = target ? hitOf(target) : null;
    const next = hit ? ancestorIds(page, hit.id, hit.layer) : [];
    const previous = hovered.current;
    hovered.current = next;
    const run = (ids: string[], trigger: 'mouse-enter' | 'mouse-leave'): void => ids.forEach((id) => {
      const interaction = page.objects[id]?.interactions?.find((item) => item.trigger === trigger);
      if (interaction) execute(interaction, hit?.layer ?? state.screen);
    });
    run(previous.filter((id) => !next.includes(id)), 'mouse-leave');
    run(next.filter((id) => !previous.includes(id)), 'mouse-enter');
  };

  const fixed = fixedChildren(page, screen.id);
  const index = screens.findIndex((node) => node.id === screen.id);
  return (
    <div className={`viewer ${flash ? 'flash' : ''}`}>
      <header className="viewer-bar">
        <strong>{screen.name}</strong>
        <span>{index >= 0 ? `${index + 1} / ${screens.length}` : ''}</span>
        <div className="viewer-actions">
          <button title="이전 화면 (←)" disabled={index <= 0} onClick={() => goTo(screens[index - 1]!.id)}>‹</button>
          <button title="다음 화면 (→)" disabled={index < 0 || index >= screens.length - 1} onClick={() => goTo(screens[index + 1]!.id)}>›</button>
          <button title="처음부터 (R)" onClick={() => setState({ screen: start, overlays: [], history: [] })}>처음으로</button>
          <button title="닫기 (Esc)" onClick={onClose}>닫기</button>
        </div>
      </header>
      <div className="viewer-stage">
        <div className="viewer-device" style={{ width: screen.width * scale, height: viewHeight }} onClick={onClick} onPointerOver={(event) => updateHover(event.target)} onPointerLeave={() => updateHover(null)}>
          <div key={screen.id} className="viewer-scroll" data-layer={screen.id} style={{ height: viewHeight, overflowY: screen.height * scale > viewHeight ? 'auto' : 'hidden' }}>
            <div style={{ width: screen.width * scale, height: screen.height * scale }}>
              <div className="viewer-layer" style={{ width: screen.width, height: screen.height, transform: `scale(${scale})` }}>
                <NodeTree page={page} id={screen.id} origin={screen} skip={fixed} resolveAsset={resolveAsset} />
              </div>
            </div>
          </div>
          {fixed.size ? (
            <div className="viewer-layer viewer-fixed" data-layer={screen.id} style={{ width: view.width, height: view.height, transform: `scale(${scale})` }}>
              {[...fixed].map((id) => <NodeTree key={id} page={page} id={id} origin={screen} resolveAsset={resolveAsset} />)}
            </div>
          ) : null}
          {state.overlays.map((overlay) => {
            const node = page.objects[overlay.id];
            if (!node) return null;
            const at = overlayPlacement(overlay.position, node, view);
            return (
              <div key={overlay.id} className={`viewer-overlay ${overlay.background ? 'dim' : ''}`}>
                <div className="viewer-layer" data-layer={overlay.id} style={{ width: node.width, height: node.height, transform: `translate(${at.x * scale}px, ${at.y * scale}px) scale(${scale})` }}>
                  <NodeTree page={page} id={overlay.id} origin={node} resolveAsset={resolveAsset} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
