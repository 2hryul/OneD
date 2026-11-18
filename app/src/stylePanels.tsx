import { primaryColor, type DesignNode, type Effect, type ImageFit, type Paint, type Stroke, type StrokeAlign, type TextAlign, type VerticalAlign } from './model';
import { NumberField } from './panels';

type Change = (patch: Partial<DesignNode>) => void;

const PAINT_LABEL: Record<Paint['type'], string> = { solid: '단색', linear: '선형', radial: '원형', image: '이미지' };
const FIT_LABEL: Record<ImageFit, string> = { fill: '채우기', fit: '맞추기', tile: '바둑판', stretch: '늘이기' };
const ALIGN_LABEL: Record<StrokeAlign, string> = { inside: '안쪽', center: '가운데', outside: '바깥쪽' };
const EFFECT_LABEL: Record<Effect['type'], string> = { 'drop-shadow': '드롭 섀도', 'inner-shadow': '이너 섀도', 'layer-blur': '레이어 블러', 'background-blur': '배경 블러' };

/** #rrggbb(aa) 값을 색상 선택기와 텍스트 칸으로 편집한다. 선택기는 알파를 다루지 못하므로 기존 알파를 유지한다. */
function ColorField({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  return (
    <div className="color-field">
      <input type="color" value={match ? `#${match[1]}` : '#000000'} onChange={(event) => onChange(`${event.target.value}${match?.[2] ?? ''}`)} />
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function updateAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, position) => (position === index ? value : item));
}

/** 선형 그라디언트 방향(도). CSS와 같이 0이면 아래에서 위, 180이면 위에서 아래로 칠한다. */
function linearAngle(paint: Extract<Paint, { type: 'linear' }>): number {
  return Math.round((Math.atan2(paint.to.x - paint.from.x, -(paint.to.y - paint.from.y)) * 180) / Math.PI);
}

function withAngle(paint: Extract<Paint, { type: 'linear' }>, degrees: number): Paint {
  const radians = (degrees * Math.PI) / 180;
  const dx = Math.sin(radians) / 2;
  const dy = -Math.cos(radians) / 2;
  return { ...paint, from: { x: 0.5 - dx, y: 0.5 - dy }, to: { x: 0.5 + dx, y: 0.5 + dy } };
}

/** 채우기 종류를 바꿀 때 지금 대표 색을 이어받는다. */
function convertPaint(paint: Paint, type: Paint['type']): Paint {
  const color = primaryColor({ fills: [paint] }, '#c4c4c4');
  const stops = [{ offset: 0, color }, { offset: 1, color: '#ffffff' }];
  if (type === 'solid') return { type, color, opacity: paint.opacity };
  if (type === 'linear') return { type, from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, stops, opacity: paint.opacity };
  if (type === 'radial') return { type, center: { x: 0.5, y: 0.5 }, radius: { x: 0.5, y: 0.5 }, stops, opacity: paint.opacity };
  return { type, assetId: paint.type === 'image' ? paint.assetId : '', fit: 'fill', opacity: paint.opacity };
}

interface FillsProps { node: DesignNode; title: string; onChange: Change; onPickImage: (index: number) => void }

/** 채우기 목록. 위에 그려지는 채우기를 위에 보여준다. */
export function FillsSection({ node, title, onChange, onPickImage }: FillsProps): JSX.Element {
  const fills = node.fills;
  const set = (index: number, paint: Paint): void => onChange({ fills: updateAt(fills, index, paint) });
  return (
    <section className="style-section">
      <div className="style-heading"><span>{title}</span><button aria-label={`${title} 추가`} title={`${title} 추가`} onClick={() => onChange({ fills: [...fills, { type: 'solid', color: '#c4c4c4' }] })}>+</button></div>
      {fills.map((paint, index) => ({ paint, index })).reverse().map(({ paint, index }) => (
        <div className="style-row" key={index}>
          <div className="style-line">
            <select aria-label="채우기 종류" value={paint.type} onChange={(event) => set(index, convertPaint(paint, event.target.value as Paint['type']))}>
              {(Object.keys(PAINT_LABEL) as Paint['type'][]).map((type) => <option key={type} value={type}>{PAINT_LABEL[type]}</option>)}
            </select>
            <label className="mini"><span>%</span><NumberField value={Math.round((paint.opacity ?? 1) * 100)} min={0} onCommit={(next) => set(index, { ...paint, opacity: Math.min(100, next) / 100 })} /></label>
            <button className="icon-button" aria-label="채우기 삭제" title="채우기 삭제" onClick={() => onChange({ fills: fills.filter((_, position) => position !== index) })}>−</button>
          </div>
          <PaintEditor paint={paint} onChange={(next) => set(index, next)} onPickImage={() => onPickImage(index)} />
        </div>
      ))}
    </section>
  );
}

function PaintEditor({ paint, onChange, onPickImage }: { paint: Paint; onChange: (paint: Paint) => void; onPickImage: () => void }): JSX.Element {
  if (paint.type === 'solid') return <ColorField value={paint.color} onChange={(color) => onChange({ ...paint, color })} />;
  if (paint.type === 'image') {
    return (
      <div className="style-line">
        <button className="small-action" onClick={onPickImage}>{paint.assetId ? '이미지 바꾸기' : '이미지 선택'}</button>
        <select aria-label="이미지 맞춤" value={paint.fit} onChange={(event) => onChange({ ...paint, fit: event.target.value as ImageFit })}>
          {(Object.keys(FIT_LABEL) as ImageFit[]).map((fit) => <option key={fit} value={fit}>{FIT_LABEL[fit]}</option>)}
        </select>
      </div>
    );
  }
  const first = paint.stops[0]?.color ?? '#000000';
  const last = paint.stops[paint.stops.length - 1]?.color ?? '#ffffff';
  const setStop = (position: 'first' | 'last', color: string): void => {
    const stops = paint.stops.length ? [...paint.stops] : [{ offset: 0, color: first }, { offset: 1, color: last }];
    const index = position === 'first' ? 0 : stops.length - 1;
    stops[index] = { ...stops[index]!, color };
    onChange({ ...paint, stops });
  };
  return (
    <>
      <ColorField value={first} onChange={(color) => setStop('first', color)} />
      <ColorField value={last} onChange={(color) => setStop('last', color)} />
      {paint.type === 'linear' ? <label className="mini wide"><span>각도</span><NumberField value={linearAngle(paint)} onCommit={(next) => onChange(withAngle(paint, next))} /></label> : null}
    </>
  );
}

export function StrokesSection({ node, onChange }: { node: DesignNode; onChange: Change }): JSX.Element {
  const strokes = node.strokes ?? [];
  const set = (index: number, stroke: Stroke): void => onChange({ strokes: updateAt(strokes, index, stroke) });
  return (
    <section className="style-section">
      <div className="style-heading"><span>선</span><button aria-label="선 추가" title="선 추가" onClick={() => onChange({ strokes: [...strokes, { color: '#000000', width: 1, align: 'inside' }] })}>+</button></div>
      {strokes.map((stroke, index) => ({ stroke, index })).reverse().map(({ stroke, index }) => (
        <div className="style-row" key={index}>
          <ColorField value={stroke.color} onChange={(color) => set(index, { ...stroke, color })} />
          <div className="style-line">
            <label className="mini"><span>굵기</span><NumberField value={stroke.width} min={0} onCommit={(width) => set(index, { ...stroke, width })} /></label>
            <select aria-label="선 위치" value={stroke.align} onChange={(event) => set(index, { ...stroke, align: event.target.value as StrokeAlign })}>
              {(Object.keys(ALIGN_LABEL) as StrokeAlign[]).map((align) => <option key={align} value={align}>{ALIGN_LABEL[align]}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={Boolean(stroke.dash?.length)} onChange={(event) => set(index, event.target.checked ? { ...stroke, dash: [4, 4] } : { color: stroke.color, width: stroke.width, align: stroke.align })} />점선</label>
            <button className="icon-button" aria-label="선 삭제" title="선 삭제" onClick={() => onChange({ strokes: strokes.filter((_, position) => position !== index) })}>−</button>
          </div>
        </div>
      ))}
    </section>
  );
}

function convertEffect(effect: Effect, type: Effect['type']): Effect {
  if (type === 'layer-blur' || type === 'background-blur') return { type, radius: 'radius' in effect ? effect.radius : 8 };
  return 'x' in effect ? { ...effect, type } : { type, x: 0, y: 4, blur: 12, spread: 0, color: '#00000040' };
}

export function EffectsSection({ node, onChange }: { node: DesignNode; onChange: Change }): JSX.Element {
  const effects = node.effects ?? [];
  const set = (index: number, effect: Effect): void => onChange({ effects: updateAt(effects, index, effect) });
  return (
    <section className="style-section">
      <div className="style-heading"><span>효과</span><button aria-label="효과 추가" title="효과 추가" onClick={() => onChange({ effects: [...effects, { type: 'drop-shadow', x: 0, y: 4, blur: 12, spread: 0, color: '#00000040' }] })}>+</button></div>
      {effects.map((effect, index) => (
        <div className="style-row" key={index}>
          <div className="style-line">
            <select aria-label="효과 종류" value={effect.type} onChange={(event) => set(index, convertEffect(effect, event.target.value as Effect['type']))}>
              {(Object.keys(EFFECT_LABEL) as Effect['type'][]).map((type) => <option key={type} value={type}>{EFFECT_LABEL[type]}</option>)}
            </select>
            <button className="icon-button" aria-label="효과 삭제" title="효과 삭제" onClick={() => onChange({ effects: effects.filter((_, position) => position !== index) })}>−</button>
          </div>
          {'x' in effect ? (
            <>
              <div className="fields-grid four">
                {(['x', 'y', 'blur', 'spread'] as const).map((key) => <label className="mini" key={key}><span>{key === 'blur' ? '흐림' : key === 'spread' ? '확산' : key.toUpperCase()}</span><NumberField value={effect[key]} min={key === 'blur' ? 0 : undefined} onCommit={(next) => set(index, { ...effect, [key]: next })} /></label>)}
              </div>
              <ColorField value={effect.color} onChange={(color) => set(index, { ...effect, color })} />
            </>
          ) : <label className="mini wide"><span>반경</span><NumberField value={effect.radius} min={0} onCommit={(radius) => set(index, { ...effect, radius })} /></label>}
        </div>
      ))}
    </section>
  );
}

const TEXT_ALIGN_LABEL: Record<TextAlign, string> = { left: '왼쪽', center: '가운데', right: '오른쪽', justify: '양쪽' };
const VERTICAL_LABEL: Record<VerticalAlign, string> = { top: '위', middle: '가운데', bottom: '아래' };

export function TextSection({ node, onChange }: { node: DesignNode; onChange: Change }): JSX.Element {
  const fontSize = node.fontSize ?? 18;
  return (
    <section className="style-section">
      <div className="style-heading"><span>텍스트</span></div>
      <label className="field full"><span>내용</span><textarea rows={3} value={node.text ?? ''} onChange={(event) => onChange({ text: event.target.value })} /></label>
      <div className="fields-grid">
        <label className="field"><span>글자 크기</span><NumberField value={fontSize} min={1} onCommit={(next) => onChange({ fontSize: next })} /></label>
        <label className="field"><span>굵기</span><select value={node.fontWeight ?? 400} onChange={(event) => onChange({ fontWeight: Number(event.target.value) })}>{[300, 400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}</select></label>
        <label className="field"><span>줄 높이</span><NumberField value={node.lineHeight ?? Math.round(fontSize * 1.15 * 100) / 100} min={1} onCommit={(next) => onChange({ lineHeight: next })} /></label>
        <label className="field"><span>자간</span><NumberField value={node.letterSpacing ?? 0} onCommit={(next) => onChange({ letterSpacing: next })} /></label>
        <label className="field"><span>가로 정렬</span><select value={node.textAlign ?? 'left'} onChange={(event) => onChange({ textAlign: event.target.value as TextAlign })}>{(Object.keys(TEXT_ALIGN_LABEL) as TextAlign[]).map((align) => <option key={align} value={align}>{TEXT_ALIGN_LABEL[align]}</option>)}</select></label>
        <label className="field"><span>세로 정렬</span><select value={node.verticalAlign ?? 'top'} onChange={(event) => onChange({ verticalAlign: event.target.value as VerticalAlign })}>{(Object.keys(VERTICAL_LABEL) as VerticalAlign[]).map((align) => <option key={align} value={align}>{VERTICAL_LABEL[align]}</option>)}</select></label>
      </div>
      {node.spans?.length ? <p className="style-note">이 텍스트에는 구간별 스타일 {node.spans.length}개가 있습니다. 내용을 고치면 구간 스타일은 지워집니다.</p> : null}
    </section>
  );
}
