/**
 * 속성 패널의 숫자 입력값을 해석한다.
 * 입력칸을 비우는 순간 Number('')가 0이 되어 크기 0인 노드가 저장되던 문제를 막는다.
 *
 * Args:
 *   value: 입력칸의 원문
 *   fallback: 해석할 수 없을 때 유지할 현재 값
 *   min: 허용하는 최솟값. 생략하면 제한하지 않는다.
 */
export function parseNumberInput(value: string, fallback: number, min?: number): number {
  if (value.trim() === '') return fallback;
  const result = Number(value);
  if (!Number.isFinite(result)) return fallback;
  return min === undefined ? result : Math.max(min, result);
}
