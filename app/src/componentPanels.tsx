import { useEffect, useState } from 'react';
import { TOKEN_SLOT_TYPE, type ComponentProp, type DesignDocument, type DesignNode, type Page, type TokenSlot } from './model';
import { topInstanceRoot, variantSiblings } from './components';
import { propOwner, type PropField } from './componentProps';

/** 컴포넌트 속성 편집 동작. App이 Transaction으로 실행한다. */
export interface PropActions {
  /** 메인 안 도형의 자리(field)로 새 속성을 만든다. */
  add: (nodeId: string, field: PropField, name: string) => void;
  /** 메인 안 도형의 자리를 기존 속성에 잇거나(propId) 끊는다(null). */
  link: (nodeId: string, field: PropField, propId: string | null) => void;
  update: (componentId: string, propId: string, patch: { name?: string; defaultValue?: string | boolean }) => void;
  remove: (componentId: string, propId: string) => void;
  /** 인스턴스 값. undefined면 기본값으로 되돌린다. */
  setValue: (rootId: string, propId: string, value: string | boolean | undefined) => void;
}

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
  props: PropActions;
}

/**
 * 컴포넌트 관련 동작. 메인이면 표시만, 인스턴스 루트면 variant 바꾸기·메인으로 이동·override 초기화·분리, 인스턴스 안의 도형이면 override 목록,
 * 그 밖의 프레임·그룹이면 컴포넌트 만들기를 보여준다.
 */
export function ComponentSection({ doc, page, node, onCreate, onSwitchVariant, onGoToMain, onReset, onDetach, props }: ComponentSectionProps): JSX.Element | null {
  if (node.mainInstance && node.componentId) {
    const component = doc.components[node.componentId];
    return (
      <section className="style-section component-box"><div className="style-heading"><span>◆ 메인 컴포넌트</span></div>
        <p className="style-note">{component?.name}{component?.variant ? ` · ${Object.entries(component.variant).map(([key, value]) => `${key}=${value}`).join(', ')}` : ''}. 여기서 바꾼 내용은 모든 인스턴스에 반영됩니다.</p>
        {component ? <PropDefinitions componentId={component.id} propsList={component.props ?? []} actions={props} /> : null}
      </section>
    );
  }
  if (node.componentId && topInstanceRoot(page, node.id)?.id === node.id) return <InstanceSection doc={doc} node={node} onSwitchVariant={onSwitchVariant} onGoToMain={onGoToMain} onReset={onReset} onDetach={onDetach} props={props} />;
  const owner = propOwner(page, node);
  if (owner?.mainInstance && owner.componentId) return <PropLinks doc={doc} node={node} componentId={owner.componentId} actions={props} />;
  if (node.shapeRef) {
    const nestedProps = node.componentId ? doc.components[node.componentId]?.props : undefined;
    return (
      <section className="style-section component-box"><div className="style-heading"><span>◇ 인스턴스 안의 요소</span></div>
        <p className="style-note">{node.touched?.length ? `메인과 다르게 바꾼 속성: ${node.touched.join(', ')}` : '메인 컴포넌트와 같습니다.'}</p>
        {nestedProps?.length ? <PropValues node={node} propsList={nestedProps} actions={props} /> : null}
      </section>
    );
  }
  if (node.type === 'frame' || node.type === 'group') {
    return <section className="style-section"><button className="wide-action" onClick={onCreate}>◆ 컴포넌트 만들기 (Ctrl+Alt+K)</button></section>;
  }
  return null;
}

function InstanceSection({ doc, node, onSwitchVariant, onGoToMain, onReset, onDetach, props }: Omit<ComponentSectionProps, 'page' | 'onCreate'>): JSX.Element {
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
      {component?.props?.length ? <PropValues node={node} propsList={component.props} actions={props} /> : null}
      <div className="style-line wrap">
        <button className="small-action" onClick={onGoToMain}>메인으로 이동</button>
        <button className="small-action" onClick={onReset}>override 초기화</button>
        <button className="small-action" onClick={onDetach}>인스턴스 분리</button>
      </div>
    </section>
  );
}

/** 칸을 벗어나거나 Enter를 누를 때 반영하는 글자 입력. 한 글자마다 문서를 바꾸지 않기 위해서다. */
function CommitText({ value, onCommit, label }: { value: string; onCommit: (value: string) => void; label: string }): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input aria-label={label} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) onCommit(draft); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}

/** 메인 컴포넌트의 속성 목록. 이름·기본값을 고치고 지운다. */
function PropDefinitions({ componentId, propsList, actions }: { componentId: string; propsList: ComponentProp[]; actions: PropActions }): JSX.Element {
  return (
    <div className="prop-list">
      <div className="prop-title">속성 {propsList.length ? `(${propsList.length})` : ''}</div>
      {propsList.length === 0 ? <p className="style-note">메인 안의 텍스트나 도형을 골라 글자·보이기를 속성으로 만들 수 있습니다.</p> : null}
      {propsList.map((prop) => (
        <div className="prop-row" key={prop.id}>
          <span className="prop-kind" title={prop.type === 'text' ? '텍스트 속성' : '불리언(보이기) 속성'}>{prop.type === 'text' ? 'T' : '◐'}</span>
          <CommitText label="속성 이름" value={prop.name} onCommit={(name) => actions.update(componentId, prop.id, { name })} />
          {prop.type === 'text'
            ? <CommitText label="기본 글자" value={String(prop.defaultValue)} onCommit={(defaultValue) => actions.update(componentId, prop.id, { defaultValue })} />
            : <label className="check"><input type="checkbox" checked={prop.defaultValue === true} onChange={(event) => actions.update(componentId, prop.id, { defaultValue: event.target.checked })} />보임</label>}
          <button className="icon-action" aria-label={`${prop.name} 속성 지우기`} title="속성 지우기" onClick={() => actions.remove(componentId, prop.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

/** 인스턴스의 속성 값. 기본값과 다르면 되돌리기 버튼이 나온다. */
function PropValues({ node, propsList, actions }: { node: DesignNode; propsList: ComponentProp[]; actions: PropActions }): JSX.Element {
  return (
    <div className="prop-list">
      <div className="prop-title">속성</div>
      {propsList.map((prop) => {
        const own = node.propValues?.[prop.id];
        const value = own ?? prop.defaultValue;
        return (
          <div className="prop-row value" key={prop.id}>
            <span className="prop-name" title={prop.name}>{prop.name}</span>
            {prop.type === 'text'
              ? <CommitText label={prop.name} value={String(value)} onCommit={(text) => actions.setValue(node.id, prop.id, text)} />
              : <label className="check"><input type="checkbox" checked={value === true} onChange={(event) => actions.setValue(node.id, prop.id, event.target.checked)} />보임</label>}
            {own !== undefined ? <button className="icon-action" aria-label={`${prop.name} 기본값으로`} title="기본값으로" onClick={() => actions.setValue(node.id, prop.id, undefined)}>↺</button> : <span />}
          </div>
        );
      })}
    </div>
  );
}

/** 메인 안 도형의 속성 연결. 텍스트는 글자, 모든 도형은 보이기를 같은 종류 속성에 잇거나 새로 만든다. */
function PropLinks({ doc, node, componentId, actions }: { doc: DesignDocument; node: DesignNode; componentId: string; actions: PropActions }): JSX.Element {
  const component = doc.components[componentId];
  const fields: Array<{ field: PropField; label: string; type: ComponentProp['type'] }> = [
    ...(node.type === 'text' ? [{ field: 'text' as const, label: '글자', type: 'text' as const }] : []),
    { field: 'visible', label: '보이기', type: 'boolean' }
  ];
  return (
    <section className="style-section component-box">
      <div className="style-heading"><span>◆ 컴포넌트 속성 · {component?.name}</span></div>
      {fields.map(({ field, label, type }) => (
        <label className="field full" key={field}><span>{label}</span>
          <select value={node.propRefs?.[field] ?? ''} onChange={(event) => {
            const value = event.target.value;
            if (value === '__new') actions.add(node.id, field, field === 'text' ? node.name : `show ${node.name}`);
            else actions.link(node.id, field, value || null);
          }}>
            <option value="">연결 안 함</option>
            {(component?.props ?? []).filter((prop) => prop.type === type).map((prop) => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
            <option value="__new">+ 새 {type === 'text' ? '텍스트' : '불리언'} 속성</option>
          </select>
        </label>
      ))}
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
