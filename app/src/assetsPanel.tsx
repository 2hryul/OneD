import type { Component, DesignDocument, Token, TokenType } from './model';
import { NumberField } from './panels';

interface AssetsPanelProps {
  doc: DesignDocument;
  onInsert: (componentId: string) => void;
  onAddToken: (type: TokenType) => void;
  onChangeToken: (token: Token) => void;
  onDeleteToken: (id: string) => void;
}

/** 컴포넌트 목록(variant는 세트별로 묶음)과 디자인 토큰 목록. 컴포넌트를 누르면 인스턴스를 캔버스에 넣는다. */
export function AssetsPanel({ doc, onInsert, onAddToken, onChangeToken, onDeleteToken }: AssetsPanelProps): JSX.Element {
  const groups = new Map<string, Component[]>();
  for (const component of Object.values(doc.components)) groups.set(component.setId ?? component.id, [...(groups.get(component.setId ?? component.id) ?? []), component]);
  const tokens = Object.values(doc.tokens).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="layer-list assets">
      <div className="assets-heading"><strong>컴포넌트</strong><span>{groups.size}</span></div>
      {groups.size === 0 ? <p className="empty">프레임을 고르고 '컴포넌트 만들기'를 누르세요.</p> : [...groups.values()].map((members) => (
        <div className="asset-group" key={members[0]!.setId ?? members[0]!.id}>
          <div className="asset-name">{members[0]!.setId ? '⧉' : '◆'} {members[0]!.name}</div>
          {members.map((component) => (
            <button key={component.id} className="asset-item" title="인스턴스 넣기" onClick={() => onInsert(component.id)}>
              {component.variant ? Object.entries(component.variant).map(([key, value]) => `${key}=${value}`).join(', ') : '인스턴스 넣기'}
            </button>
          ))}
        </div>
      ))}
      <div className="assets-heading"><strong>토큰</strong>
        <span className="asset-actions"><button onClick={() => onAddToken('color')}>+ 색</button><button onClick={() => onAddToken('number')}>+ 숫자</button></span>
      </div>
      {tokens.length === 0 ? <p className="empty">색·숫자 토큰을 만들면 속성에 연결할 수 있습니다.</p> : tokens.map((token) => (
        <div className="token-row" key={token.id}>
          {token.type === 'color'
            ? <input type="color" aria-label={`${token.name} 값`} value={/^#[0-9a-f]{6}/i.test(String(token.value)) ? String(token.value).slice(0, 7) : '#000000'} onChange={(event) => onChangeToken({ ...token, value: `${event.target.value}${String(token.value).slice(7)}` })} />
            : <NumberField value={Number(token.value)} onCommit={(value) => onChangeToken({ ...token, value })} />}
          <input aria-label="토큰 이름" value={token.name} onChange={(event) => onChangeToken({ ...token, name: event.target.value })} />
          <button className="icon-button" aria-label={`${token.name} 삭제`} title="토큰 삭제" onClick={() => onDeleteToken(token.id)}>−</button>
        </div>
      ))}
    </div>
  );
}
