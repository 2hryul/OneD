import type { Rect } from './geometry';

/** 눈금 사이 최소 간격(화면 픽셀). 이보다 촘촘하면 숫자가 겹친다. */
const MIN_TICK_PIXELS = 60;
export const RULER_SIZE = { top: 23, left: 20 };

/** 화면에서 60px 이상 벌어지는 가장 작은 1·2·5×10ⁿ 간격(페이지 단위). */
export function rulerStep(zoom: number): number {
  const minimum = MIN_TICK_PIXELS / zoom;
  const power = 10 ** Math.floor(Math.log10(minimum));
  for (const factor of [1, 2, 5, 10]) if (factor * power >= minimum) return factor * power;
  return 10 * power;
}

/**
 * 눈금 위치. pan은 화면 이동량(px), length는 눈금자 길이(px). 화면 위치 = 값 × zoom + pan.
 * 큰 눈금(숫자 있음) 사이에 작은 눈금 4개를 둔다.
 */
export function rulerTicks(pan: number, length: number, zoom: number): Array<{ at: number; value: number; major: boolean }> {
  const step = rulerStep(zoom);
  const minor = step / 5;
  const first = Math.floor(-pan / zoom / minor) * minor;
  const ticks: Array<{ at: number; value: number; major: boolean }> = [];
  for (let value = first; value * zoom + pan <= length; value += minor) {
    const rounded = Math.round(value / minor) * minor;
    ticks.push({ at: rounded * zoom + pan, value: Math.round(rounded * 1000) / 1000, major: Math.abs(rounded / step - Math.round(rounded / step)) < 1e-6 });
    if (ticks.length > 400) break;
  }
  return ticks;
}

interface RulersProps { pan: { x: number; y: number }; zoom: number; width: number; height: number; selection: Rect | null }

/** 위·왼쪽 눈금자. 화면 이동·확대를 따라가고, 고른 도형이 차지하는 구간을 강조한다(Figma와 같음). */
export function Rulers({ pan, zoom, width, height, selection }: RulersProps): JSX.Element {
  const top = rulerTicks(pan.x, width, zoom);
  const left = rulerTicks(pan.y, height, zoom);
  return (
    <>
      <div className="ruler ruler-top" aria-hidden="true">
        {selection ? <span className="ruler-band" style={{ left: selection.x * zoom + pan.x, width: selection.width * zoom }} /> : null}
        {top.map((tick) => <span key={tick.value} className={tick.major ? 'tick major' : 'tick'} style={{ left: tick.at }}>{tick.major ? <em>{tick.value}</em> : null}</span>)}
      </div>
      <div className="ruler ruler-left" aria-hidden="true">
        {selection ? <span className="ruler-band" style={{ top: selection.y * zoom + pan.y, height: selection.height * zoom }} /> : null}
        {left.map((tick) => <span key={tick.value} className={tick.major ? 'tick major' : 'tick'} style={{ top: tick.at }}>{tick.major ? <em>{tick.value}</em> : null}</span>)}
      </div>
      <div className="ruler-corner" aria-hidden="true" />
    </>
  );
}
