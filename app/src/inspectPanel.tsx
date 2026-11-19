import { useState } from 'react';
import type { DesignDocument, DesignNode, Page } from './model';
import { inspectCss, inspectSpacing } from './export';
import { toRem } from './exportCss';

interface InspectPanelProps {
  doc: DesignDocument;
  page: Page;
  node: DesignNode;
  onCopy: (text: string, label: string) => void;
  onOpenCode: () => void;
}

/** 토큰 자리 이름(검사 창 표시용). */
const SLOT_LABEL: Record<string, string> = { fill: '채우기', stroke: '선', radius: '반경', fontSize: '글자 크기', gap: '간격' };

/**
 * 선택한 요소의 CSS를 보여 주는 개발자 검사 창(Figma Dev Mode의 Inspect에 해당).
 * 코드 내보내기와 같은 규칙으로 만든 선언, 부모 가장자리까지의 거리, 연결된 토큰을 보여 주고 px/rem 단위를 바꾸어 복사할 수 있다.
 */
export function InspectPanel({ doc, page, node, onCopy, onOpenCode }: InspectPanelProps) {
  const [unit, setUnit] = useState<'px' | 'rem'>('px');
  const css = inspectCss(doc, page.id, node.id);
  const shown = unit === 'rem' ? toRem(css) : css;
  const text = node.type === 'text' ? node.text ?? '' : null;
  const spacing = inspectSpacing(doc, page.id, node.id);
  const length = (value: number): string => (unit === 'rem' ? toRem(`${value}px`) : `${value}px`);
  const tokens = Object.entries(node.tokens ?? {}).map(([slot, id]) => ({ slot, token: id ? doc.tokens[id] : undefined })).filter((item) => item.token);
  return (
    <div className="properties inspect-panel">
      <div className="selection-header"><span className="selection-icon">{'</>'}</span><div><strong>{node.name}</strong><small>{Math.round(node.width)} × {Math.round(node.height)} · {node.type}</small></div></div>
      <div className="inspect-units" role="group" aria-label="단위">
        {(['px', 'rem'] as const).map((item) => <button key={item} className={unit === item ? 'active' : ''} aria-pressed={unit === item} onClick={() => setUnit(item)}>{item}</button>)}
      </div>
      {spacing ? (
        <div className="inspect-spacing" aria-label="부모 가장자리까지 거리">
          <span className="top">{length(spacing.top)}</span><span className="left">{length(spacing.left)}</span>
          <span className="box">{Math.round(node.width)}×{Math.round(node.height)}</span>
          <span className="right">{length(spacing.right)}</span><span className="bottom">{length(spacing.bottom)}</span>
        </div>
      ) : null}
      <pre className="inspect-css"><code>{shown}</code></pre>
      <button className="wide-action" onClick={() => onCopy(shown, 'CSS')}>CSS 복사</button>
      {tokens.length ? <><div className="section-title">토큰</div><ul className="inspect-tokens">{tokens.map(({ slot, token }) => <li key={slot}><span>{SLOT_LABEL[slot] ?? slot}</span><strong>{token!.name}</strong><code>{String(token!.value)}{token!.type === 'number' ? 'px' : ''}</code></li>)}</ul></> : null}
      {text !== null ? <><div className="section-title">글자</div><pre className="inspect-css"><code>{text}</code></pre><button className="wide-action" onClick={() => onCopy(text, '글자')}>글자 복사</button></> : null}
      <div className="section-title">코드</div>
      <button className="wide-action" onClick={onOpenCode}>React 코드 · CSS · zip 보기</button>
    </div>
  );
}
