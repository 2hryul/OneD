import { useState } from 'react';
import type { AlignMode, DistributeAxis } from './align';
import type { FlipAxis } from './changes';
import type { ImageFormat } from './imageExport';

const ALIGN_BUTTONS: Array<[AlignMode, string, string]> = [
  ['left', '⇤', '왼쪽 맞춤 (Alt+A)'], ['h-center', '↔', '가로 가운데 (Alt+H)'], ['right', '⇥', '오른쪽 맞춤 (Alt+D)'],
  ['top', '⤒', '위쪽 맞춤 (Alt+W)'], ['v-center', '↕', '세로 가운데 (Alt+V)'], ['bottom', '⤓', '아래쪽 맞춤 (Alt+S)']
];

/** 정렬·간격 버튼 줄. 하나만 골랐으면 부모 프레임 기준이고, 간격 맞추기는 셋 이상일 때만 켠다. */
export function AlignBar({ count, onAlign, onDistribute, onFlip }: { count: number; onAlign: (mode: AlignMode) => void; onDistribute: (axis: DistributeAxis) => void; onFlip: (axis: FlipAxis) => void }): JSX.Element {
  return (
    <div className="align-bar" role="toolbar" aria-label="정렬">
      {ALIGN_BUTTONS.map(([mode, icon, label]) => <button key={mode} title={label} aria-label={label} onClick={() => onAlign(mode)}>{icon}</button>)}
      <span className="align-divider" />
      <button title="가로 간격 맞추기 (Alt+Shift+H)" aria-label="가로 간격 맞추기" disabled={count < 3} onClick={() => onDistribute('horizontal')}>⋯</button>
      <button title="세로 간격 맞추기 (Alt+Shift+V)" aria-label="세로 간격 맞추기" disabled={count < 3} onClick={() => onDistribute('vertical')}>⋮</button>
      <span className="align-divider" />
      <button title="좌우 뒤집기 (Shift+H)" aria-label="좌우 뒤집기" onClick={() => onFlip('horizontal')}>⇋</button>
      <button title="상하 뒤집기 (Shift+V)" aria-label="상하 뒤집기" onClick={() => onFlip('vertical')}>⇵</button>
    </div>
  );
}

export type ExportChoice = { format: ImageFormat; scale: number };
const CHOICES: Array<[string, ExportChoice]> = [['PNG 1x', { format: 'png', scale: 1 }], ['PNG 2x', { format: 'png', scale: 2 }], ['PNG 3x', { format: 'png', scale: 3 }], ['SVG', { format: 'svg', scale: 1 }]];

/** 그림 내보내기. 형식을 고르고 버튼(또는 Ctrl+Shift+E)으로 파일을 받는다. */
export function ExportImageRow({ onExport }: { onExport: (choice: ExportChoice) => void }): JSX.Element {
  const [index, setIndex] = useState(1);
  return (
    <div className="share-row export-row">
      <select aria-label="내보내기 형식" value={index} onChange={(event) => setIndex(Number(event.target.value))}>
        {CHOICES.map(([label], at) => <option key={label} value={at}>{label}</option>)}
      </select>
      <button title="Ctrl+Shift+E (PNG 2x)" onClick={() => onExport(CHOICES[index]![1])}>그림 내보내기</button>
    </div>
  );
}
