import type { DesignNode, Interaction, InteractionAction, OverlayPosition, Page } from './model.ts';

/** 열린 오버레이 하나. 같은 화면 위에 쌓이고 마지막 것이 맨 위다. */
export interface OverlayEntry { id: string; position: OverlayPosition; closeOnOutside: boolean; background: boolean }

/** 보기 모드 상태. history는 '뒤로'로 돌아갈 이전 화면들이다. */
export interface ViewerState { screen: string; overlays: OverlayEntry[]; history: string[] }

/** 화면 = 페이지 최상위의 보이는 프레임. 읽는 순서(위→아래, 왼쪽→오른쪽)로 정렬해 화살표 키 이동 순서로 쓴다. */
export function screensOf(page: Page): DesignNode[] {
  return page.children
    .map((id) => page.objects[id])
    .filter((node): node is DesignNode => node?.type === 'frame' && !node.hidden)
    .sort((a, b) => (Math.abs(a.y - b.y) < 1 ? a.x - b.x : a.y - b.y));
}

/** 도형이 속한 화면 id. 최상위 프레임 아래가 아니면 null. */
export function screenOf(page: Page, id: string): string | null {
  let node = page.objects[id];
  while (node?.parentId) node = page.objects[node.parentId];
  return node?.type === 'frame' ? node.id : null;
}

/** 보기 모드 시작 화면. 선택한 요소가 있는 화면을 먼저, 없으면 읽는 순서의 첫 화면. */
export function startScreen(page: Page, selectedIds: readonly string[]): string | null {
  const screens = new Set(screensOf(page).map((node) => node.id));
  for (const id of selectedIds) {
    const screen = screenOf(page, id);
    if (screen && screens.has(screen)) return screen;
  }
  return screensOf(page)[0]?.id ?? null;
}

/**
 * 포인터 아래 도형들(hits: 그려진 순서, 위가 먼저, 조상 프레임 포함)에서 클릭 상호작용을 찾는다.
 * 버튼 위에 형제로 얹힌 글자를 눌러도 아래 버튼이 반응하도록 맨 위 도형의 조상만 보지 않고 아래 도형까지 본다.
 * 그룹은 포인터를 받지 않아 hits에 없으므로 각 도형에서 그룹 조상만 따라 올라간다.
 */
export function clickInteraction(page: Page, hits: readonly string[], layer: string): Interaction | null {
  for (const id of hits) {
    for (let node: DesignNode | undefined = page.objects[id]; node; node = node.parentId ? page.objects[node.parentId] : undefined) {
      const interaction = node.interactions?.find((item) => item.trigger === 'click');
      if (interaction) return interaction;
      if (node.id === layer || (node.parentId ? page.objects[node.parentId]?.type : undefined) !== 'group') break;
    }
  }
  return null;
}

/** id부터 stopAt까지 조상 id 목록(자신 포함). 마우스가 들어가고 나간 도형을 계산할 때 쓴다. */
export function ancestorIds(page: Page, id: string, stopAt: string): string[] {
  const result: string[] = [];
  let node: DesignNode | undefined = page.objects[id];
  for (let guard = 0; node && guard < 200; guard++) {
    result.push(node.id);
    if (node.id === stopAt) break;
    node = node.parentId ? page.objects[node.parentId] : undefined;
  }
  return result;
}

function isScreen(page: Page, id: string): boolean {
  const node = page.objects[id];
  return node?.type === 'frame' && node.parentId === null;
}

/**
 * 동작 하나를 실행한 다음 상태. 목적지 화면이 지워졌으면 아무것도 하지 않는다.
 * URL 열기는 상태를 바꾸지 않으므로 호출한 쪽이 safeUrl로 검사해 연다.
 * source는 동작을 일으킨 오버레이 id다(목적지 없는 오버레이 닫기는 그 오버레이를 닫는다).
 */
export function runAction(state: ViewerState, action: InteractionAction, page: Page, source?: string): ViewerState {
  switch (action.type) {
    case 'navigate':
      if (!isScreen(page, action.destination) || action.destination === state.screen) return state;
      return { screen: action.destination, overlays: [], history: [...state.history, state.screen] };
    case 'open-overlay':
    case 'toggle-overlay': {
      if (!isScreen(page, action.destination) || action.destination === state.screen) return state;
      const open = state.overlays.some((overlay) => overlay.id === action.destination);
      if (open) return action.type === 'toggle-overlay' ? { ...state, overlays: state.overlays.filter((overlay) => overlay.id !== action.destination) } : state;
      const { destination, position, closeOnOutside, background } = action;
      return { ...state, overlays: [...state.overlays, { id: destination, position, closeOnOutside, background }] };
    }
    case 'close-overlay': {
      const target = action.destination ?? source ?? state.overlays[state.overlays.length - 1]?.id;
      return { ...state, overlays: state.overlays.filter((overlay) => overlay.id !== target) };
    }
    case 'back': {
      const previous = state.history[state.history.length - 1];
      if (!previous || !isScreen(page, previous)) return state;
      return { screen: previous, overlays: [], history: state.history.slice(0, -1) };
    }
    case 'open-url': return state;
  }
}

/** 오버레이 왼쪽 위 위치(화면 좌표). 보이는 영역(view) 기준으로 가운데·모서리·변 가운데에 놓는다. */
export function overlayPlacement(position: OverlayPosition, overlay: { width: number; height: number }, view: { width: number; height: number }): { x: number; y: number } {
  const [vertical, horizontal] = position === 'center' ? ['center', 'center'] : position.split('-') as [string, string];
  const x = horizontal === 'left' ? 0 : horizontal === 'right' ? view.width - overlay.width : (view.width - overlay.width) / 2;
  const y = vertical === 'top' ? 0 : vertical === 'bottom' ? view.height - overlay.height : (view.height - overlay.height) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

/** 열어도 안전한 URL만 돌려준다. 파일에서 온 값이므로 javascript: 같은 스킴은 막고 http·https만 허용한다. */
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

/** 화면 바로 아래에서 스크롤해도 제자리에 남는 자식 id. */
export function fixedChildren(page: Page, screenId: string): Set<string> {
  return new Set((page.objects[screenId]?.children ?? []).filter((id) => page.objects[id]?.fixedScroll && !page.objects[id]?.hidden));
}

/** 패널과 연결선에 쓰는 동작 이름. */
export function describeAction(action: InteractionAction, page: Page): string {
  const name = (id?: string): string => (id ? page.objects[id]?.name ?? '(지워진 화면)' : '맨 위 오버레이');
  switch (action.type) {
    case 'navigate': return `→ ${name(action.destination)}`;
    case 'open-overlay': return `오버레이 열기: ${name(action.destination)}`;
    case 'toggle-overlay': return `오버레이 토글: ${name(action.destination)}`;
    case 'close-overlay': return `오버레이 닫기: ${name(action.destination)}`;
    case 'back': return '뒤로';
    case 'open-url': return `URL: ${action.url}`;
  }
}
