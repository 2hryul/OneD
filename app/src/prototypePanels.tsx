import { OVERLAY_POSITIONS, TRIGGERS, type DesignNode, type Interaction, type InteractionAction, type InteractionTrigger, type OverlayPosition, type Page } from './model';
import { boundsOf, worldCorners } from './geometry';
import { describeAction, screenOf, screensOf } from './prototype';

const TRIGGER_LABELS: Record<InteractionTrigger, string> = { click: '클릭', 'mouse-enter': '마우스 들어옴', 'mouse-leave': '마우스 나감', 'after-delay': '지연 후' };
const ACTION_LABELS: Record<InteractionAction['type'], string> = { navigate: '화면 이동', 'open-overlay': '오버레이 열기', 'toggle-overlay': '오버레이 토글', 'close-overlay': '오버레이 닫기', back: '뒤로', 'open-url': 'URL 열기' };
const POSITION_LABELS: Record<OverlayPosition, string> = { center: '가운데', 'top-left': '왼쪽 위', 'top-center': '위 가운데', 'top-right': '오른쪽 위', 'bottom-left': '왼쪽 아래', 'bottom-center': '아래 가운데', 'bottom-right': '오른쪽 아래' };

function destinationOf(action: InteractionAction): string | undefined {
  return 'destination' in action ? action.destination : undefined;
}

/** 동작 종류를 바꿀 때 기본값을 채운 새 동작. 고른 목적지는 가능한 한 유지한다. */
export function actionOfType(type: InteractionAction['type'], previous: InteractionAction, fallback: string): InteractionAction {
  const destination = destinationOf(previous) || fallback;
  switch (type) {
    case 'navigate': return { type, destination };
    case 'open-overlay':
    case 'toggle-overlay': return { type, destination, position: 'center', closeOnOutside: true, background: false };
    case 'close-overlay': return { type };
    case 'back': return { type };
    case 'open-url': return { type, url: 'https://' };
  }
}

interface PrototypePanelProps { page: Page; node: DesignNode; onChange: (interactions: Interaction[]) => void; onFixedScroll: (fixed: boolean) => void; onPresent: () => void }

/** 오른쪽 패널의 프로토타입 탭. 선택한 요소의 상호작용 목록을 고치고, 화면 바로 아래 자식이면 스크롤 고정을 켠다. */
export function PrototypePanel({ page, node, onChange, onFixedScroll, onPresent }: PrototypePanelProps): JSX.Element {
  const interactions = node.interactions ?? [];
  const ownScreen = screenOf(page, node.id);
  const targets = screensOf(page).filter((screen) => screen.id !== ownScreen);
  const parent = node.parentId ? page.objects[node.parentId] : undefined;
  const screenChild = parent?.type === 'frame' && parent.parentId === null;
  const replace = (index: number, next: Interaction): void => onChange(interactions.map((item, at) => (at === index ? next : item)));
  const add = (): void => onChange([...interactions, { trigger: 'click', action: { type: 'navigate', destination: targets[0]?.id ?? '' } }]);
  return (
    <div className="properties prototype-panel">
      <div className="section-title">상호작용 <button className="section-add" title="상호작용 추가" onClick={add}>+</button></div>
      {interactions.length === 0 ? <p className="hint">+를 눌러 클릭·마우스·지연 트리거를 추가합니다.</p> : null}
      {interactions.map((interaction, index) => (
        <InteractionRow key={index} page={page} interaction={interaction} targets={targets} isScreen={node.parentId === null && node.type === 'frame'}
          onChange={(next) => replace(index, next)} onRemove={() => onChange(interactions.filter((_, at) => at !== index))} />
      ))}
      {screenChild ? (
        <label className="check-field"><input type="checkbox" checked={Boolean(node.fixedScroll)} onChange={(event) => onFixedScroll(event.target.checked)} /> 스크롤할 때 위치 고정</label>
      ) : null}
      <button className="wide-action present-action" title="Ctrl+Alt+Enter" onClick={onPresent}>▶ 보기 모드로 실행</button>
    </div>
  );
}

interface RowProps { page: Page; interaction: Interaction; targets: DesignNode[]; isScreen: boolean; onChange: (next: Interaction) => void; onRemove: () => void }

function InteractionRow({ page, interaction, targets, isScreen, onChange, onRemove }: RowProps): JSX.Element {
  const { action } = interaction;
  const setAction = (next: InteractionAction): void => onChange({ ...interaction, action: next });
  const destination = destinationOf(action);
  return (
    <div className="interaction-row">
      <div className="interaction-head"><span>{describeAction(action, page)}</span><button aria-label="상호작용 삭제" onClick={onRemove}>×</button></div>
      <label className="field full"><span>트리거</span>
        <select value={interaction.trigger} onChange={(event) => { const trigger = event.target.value as InteractionTrigger; onChange({ ...interaction, trigger, ...(trigger === 'after-delay' ? { delay: interaction.delay ?? 800 } : { delay: undefined }) }); }}>
          {TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{TRIGGER_LABELS[trigger]}</option>)}
        </select>
      </label>
      {interaction.trigger === 'after-delay' ? (
        <label className="field full"><span>지연(ms){isScreen ? '' : ' · 화면 프레임에서만 동작'}</span>
          <input type="number" min={0} step={100} value={interaction.delay ?? 0} onChange={(event) => onChange({ ...interaction, delay: Math.max(0, Number(event.target.value) || 0) })} />
        </label>
      ) : null}
      <label className="field full"><span>동작</span>
        <select value={action.type} onChange={(event) => setAction(actionOfType(event.target.value as InteractionAction['type'], action, targets[0]?.id ?? ''))}>
          {(Object.keys(ACTION_LABELS) as InteractionAction['type'][]).map((type) => <option key={type} value={type}>{ACTION_LABELS[type]}</option>)}
        </select>
      </label>
      {action.type === 'navigate' || action.type === 'open-overlay' || action.type === 'toggle-overlay' || action.type === 'close-overlay' ? (
        <label className="field full"><span>{action.type === 'close-overlay' ? '닫을 오버레이' : '목적지 화면'}</span>
          <select value={destination ?? ''} onChange={(event) => setAction({ ...action, destination: event.target.value || undefined } as InteractionAction)}>
            {action.type === 'close-overlay' ? <option value="">이 오버레이(또는 맨 위)</option> : null}
            {destination && !targets.some((screen) => screen.id === destination) ? <option value={destination}>{page.objects[destination]?.name ?? '(지워진 화면)'}</option> : null}
            {action.type !== 'close-overlay' && !destination ? <option value="">화면 선택</option> : null}
            {targets.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
          </select>
        </label>
      ) : null}
      {action.type === 'open-overlay' || action.type === 'toggle-overlay' ? (
        <>
          <label className="field full"><span>위치</span>
            <select value={action.position} onChange={(event) => setAction({ ...action, position: event.target.value as OverlayPosition })}>
              {OVERLAY_POSITIONS.map((position) => <option key={position} value={position}>{POSITION_LABELS[position]}</option>)}
            </select>
          </label>
          <label className="check-field"><input type="checkbox" checked={action.closeOnOutside} onChange={(event) => setAction({ ...action, closeOnOutside: event.target.checked })} /> 바깥을 누르면 닫기</label>
          <label className="check-field"><input type="checkbox" checked={action.background} onChange={(event) => setAction({ ...action, background: event.target.checked })} /> 배경 어둡게</label>
        </>
      ) : null}
      {action.type === 'open-url' ? (
        <label className="field full"><span>URL (http·https만 열림)</span>
          <input value={action.url} onChange={(event) => setAction({ ...action, url: event.target.value })} />
        </label>
      ) : null}
    </div>
  );
}

/**
 * 프로토타입 탭에서 선택한 요소의 상호작용을 목적지 화면까지 곡선으로 잇는다(Figma 연결선).
 * 페이지 좌표로 그리고 굵기는 확대율과 상관없이 화면 기준으로 맞춘다.
 */
export function PrototypeLinks({ page, node, unit }: { page: Page; node: DesignNode; unit: number }): JSX.Element | null {
  const from = boundsOf(worldCorners(node));
  const links = (node.interactions ?? []).map((item) => destinationOf(item.action)).filter((id): id is string => Boolean(id && page.objects[id] && !page.objects[id]!.hidden));
  if (links.length === 0) return null;
  const start = { x: from.x + from.width, y: from.y + from.height / 2 };
  return (
    <svg className="path-overlay" width="1" height="1" overflow="visible">
      {links.map((id, index) => {
        const to = boundsOf(worldCorners(page.objects[id]!));
        const end = { x: to.x, y: to.y + Math.min(to.height / 2, 40 * unit) };
        const bend = Math.max(40 * unit, Math.abs(end.x - start.x) / 2);
        return (
          <g key={`${id}:${index}`}>
            <path d={`M${start.x} ${start.y} C${start.x + bend} ${start.y} ${end.x - bend} ${end.y} ${end.x} ${end.y}`} fill="none" stroke="#3fa9f5" strokeWidth={2 * unit} />
            <circle cx={start.x} cy={start.y} r={4 * unit} fill="#3fa9f5" />
            <path d={`M${end.x} ${end.y} l${-8 * unit} ${-5 * unit} l0 ${10 * unit} z`} fill="#3fa9f5" />
          </g>
        );
      })}
    </svg>
  );
}
