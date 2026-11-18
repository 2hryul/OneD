import { TOKEN_SLOT_TYPE, type DesignDocument, type DesignNode, type Page, type TokenSlot } from './model';
import { topInstanceRoot, variantSiblings } from './components';

const SLOT_LABEL: Record<TokenSlot, string> = { fill: '채우기·글자색', stroke: '선 색', radius: '모서리 반경', fontSize: '글자 크기', gap: '레이아웃 간격' };

interface ComponentSectionProps {
  doc: DesignDocument;
  page: Page;
  node: DesignNode;
  onCreate: () => void;
  onSwitchVariant: (componentId: string) => void;
  onGoToMain: () => void;
  onReset: () => void;
  onDetach: () => void;
}

/**
 * 컴포넌트 관련 동작. 메인이면 표시만, 인스턴스 루트면 variant 바꾸기·메인으로 이동·override 초기화·분리, 인스턴스 안의 도형이면 override 목록,
 * 그 밖의 프레임·그룹이면 컴포넌트 만들기를 보여준다.
 */
export function ComponentSection({ doc, page, node, onCreate, onSwitchVariant, onGoToMain, onReset, onDetach }: ComponentSectionProps): JSX.Element | null {
  if (node.mainInstance && node.componentId) {
    const component = doc.components[node.componentId];
    return <section className="style-section component-box"><div className="style-heading"><span>◆ 메인 컴포넌트</span></div><p className="style-note">{component?.name}{component?.variant ? ` · ${Object.entries(component.variant).map(([key, value]) => `${key}=${value}`).join(', ')}` : ''}. 여기서 바꾼 내용은 모든 인스턴스에 반영됩니다.</p></section>;
  }
  if (node.componentId && topInstanceRoot(page, node.id)?.id === node.id) return <InstanceSection doc={doc} node={node} onSwitchVariant={onSwitchVariant} onGoToMain={onGoToMain} onReset={onReset} onDetach={onDetach} />;
  if (node.shapeRef) {
    return <section className="style-section component-box"><div className="style-heading"><span>◇ 인스턴스 안의 요소</span></div><p className="style-note">{node.touched?.length ? `메인과 다르게 바꾼 속성: ${node.touched.join(', ')}` : '메인 컴포넌트와 같습니다.'}</p></section>;
  }
  if (node.type === 'frame' || node.type === 'group') {
    return <section className="style-section"><button className="wide-action" onClick={onCreate}>◆ 컴포넌트 만들기 (Ctrl+Alt+K)</button></section>;
  }
  return null;
}

function InstanceSection({ doc, node, onSwitchVariant, onGoToMain, onReset, onDetach }: Omit<ComponentSectionProps, 'page' | 'onCreate'>): JSX.Element {
  const component = doc.components[node.componentId!];
  const siblings = component ? variantSiblings(doc, component.id) : [];
  const keys = [...new Set(siblings.flatMap((item) => Object.keys(item.variant ?? {})))];
  // 속성 하나를 바꾸면 나머지 속성 값은 그대로 두고 그 조합에 맞는 variant를 고른다. 정확한 조합이 없으면 바꾼 속성만 맞는 첫 variant로 간다.
  const pick = (key: string, value: string): void => {
    const wanted = { ...component?.variant, [key]: value };
    const exact = siblings.find((item) => Object.entries(wanted).every(([k, v]) => item.variant?.[k] === v));
    const target = exact ?? siblings.find((item) => item.variant?.[key] === value);
    if (target && target.id !== component?.id) onSwitchVariant(target.id);
  };
  return (
    <section className="style-section component-box">
      <div className="style-heading"><span>◇ 인스턴스 · {component?.name ?? '알 수 없음'}</span></div>
      {keys.map((key) => (
        <label className="field full" key={key}><span>{key}</span>
          <select value={component?.variant?.[key] ?? ''} onChange={(event) => pick(key, event.target.value)}>
            {[...new Set(siblings.map((item) => item.variant?.[key]).filter((value): value is string => value !== undefined))].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      ))}
      <div className="style-line wrap">
        <button className="small-action" onClick={onGoToMain}>메인으로 이동</button>
        <button className="small-action" onClick={onReset}>override 초기화</button>
        <button className="small-action" onClick={onDetach}>인스턴스 분리</button>
      </div>
    </section>
  );
}

/** 속성 자리별 토큰 연결. 자리 종류(색·숫자)에 맞는 토큰만 고를 수 있다. 텍스트·레이아웃처럼 해당 속성이 있는 자리만 보여준다. */
export function TokenSection({ doc, node, onApply }: { doc: DesignDocument; node: DesignNode; onApply: (slot: TokenSlot, tokenId: string | null) => void }): JSX.Element | null {
  const slots = (Object.keys(SLOT_LABEL) as TokenSlot[]).filter((slot) => (slot === 'fontSize' ? node.type === 'text' : slot === 'gap' ? Boolean(node.layout) : slot === 'radius' ? node.type === 'frame' || node.type === 'rectangle' : node.type !== 'group' && node.type !== 'vector'));
  const tokens = Object.values(doc.tokens);
  if (tokens.length === 0 || slots.length === 0) return null;
  return (
    <section className="style-section">
      <div className="style-heading"><span>토큰</span></div>
      {slots.map((slot) => (
        <label className="field full" key={slot}><span>{SLOT_LABEL[slot]}</span>
          <select value={node.tokens?.[slot] ?? ''} onChange={(event) => onApply(slot, event.target.value || null)}>
            <option value="">연결 안 함</option>
            {tokens.filter((token) => token.type === TOKEN_SLOT_TYPE[slot]).map((token) => <option key={token.id} value={token.id}>{token.name} ({String(token.value)})</option>)}
          </select>
        </label>
      ))}
    </section>
  );
}
