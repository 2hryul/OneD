import type { DesignNode, Page } from './model';
import { invert, multiply, worldMatrix } from './geometry';
import { pathToD } from './path';

/**
 * 마스크 윤곽 한 조각. d는 도형 지역 좌표(왼쪽 위 0,0)의 SVG 경로이고, scale은 가져온 벡터의 viewBox → 도형 크기 배율이다.
 * DOM(mask-image), Canvas(clip), SVG 내보내기(clipPath), React 내보내기가 모두 이 윤곽을 쓴다.
 */
export interface MaskShape { d: string; evenodd: boolean; scale?: [number, number] }

const num = (value: number): string => String(Math.round(value * 1000) / 1000);

/** 둥근 모서리 사각형 경로. 반경은 짧은 변의 절반을 넘지 않는다. */
function roundRectD(width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0) return `M0 0H${num(width)}V${num(height)}H0Z`;
  const arc = `A${num(r)} ${num(r)} 0 0 1`;
  return `M${num(r)} 0H${num(width - r)}${arc} ${num(width)} ${num(r)}V${num(height - r)}${arc} ${num(width - r)} ${num(height)}H${num(r)}${arc} 0 ${num(height - r)}V${num(r)}${arc} ${num(r)} 0Z`;
}

/**
 * 도형이 마스크로 쓰일 때의 윤곽(채우기 모양). 편집 경로·가져온 벡터는 경로 그대로, 타원은 호 두 개, 나머지(사각형·프레임·텍스트·그룹)는 상자다.
 * Figma처럼 선은 윤곽에 넣지 않는다.
 */
export function maskShapes(node: DesignNode): MaskShape[] {
  if (node.path) return [{ d: pathToD(node.path), evenodd: node.fillRule === 'evenodd' }];
  if (node.type === 'vector' && node.vectorPaths?.length) {
    const view = node.viewBox ?? { width: node.width, height: node.height };
    const scale: [number, number] = [node.width / (view.width || 1), node.height / (view.height || 1)];
    return node.vectorPaths.map((path) => ({ d: path.d, evenodd: path.fillRule === 'evenodd', scale }));
  }
  if (node.type === 'ellipse') {
    const [rx, ry] = [num(node.width / 2), num(node.height / 2)];
    return [{ d: `M0 ${ry}A${rx} ${ry} 0 1 0 ${num(node.width)} ${ry}A${rx} ${ry} 0 1 0 0 ${ry}Z`, evenodd: false }];
  }
  return [{ d: roundRectD(node.width, node.height, node.type === 'text' || node.type === 'group' ? 0 : node.radius ?? 0), evenodd: false }];
}

/**
 * 부모의 자식을 그리는 순서대로 마스크 구간으로 나눈다. 마스크 앞의 자식은 mask 없이, 마스크 뒤의 자식은 다음 마스크 전까지 그 마스크 구간이다.
 * 숨긴 마스크는 마스크로 쓰지 않는다(Figma와 같음). 마스크 도형 자신은 어느 구간의 ids에도 들어가지 않는다.
 */
export function maskRuns(page: Page, parent: DesignNode): Array<{ mask?: DesignNode; ids: string[] }> {
  const runs: Array<{ mask?: DesignNode; ids: string[] }> = [{ ids: [] }];
  for (const id of parent.children ?? []) {
    const child = page.objects[id];
    if (child?.mask && !child.hidden) runs.push({ mask: child, ids: [] });
    else runs[runs.length - 1]!.ids.push(id);
  }
  return runs.filter((run) => run.mask || run.ids.length);
}

/** 부모에 보이는 마스크 자식이 있는지. 없으면 렌더러가 평소대로 그린다. */
export function hasMask(page: Page, parent: DesignNode): boolean {
  return (parent.children ?? []).some((id) => page.objects[id]?.mask && !page.objects[id]?.hidden);
}

/**
 * 윤곽 조각들을 SVG path 요소로. 채우기는 검정(불투명)이라 mask-image의 알파로 쓰인다.
 * base는 앞에 붙일 변환(예: 월드 행렬)이다. clipPath 안에는 g를 둘 수 없어 변환을 path마다 붙인다.
 */
export function maskPaths(shapes: readonly MaskShape[], attrs = ' fill="#000"', base = ''): string {
  return shapes.map((shape) => {
    const transform = [base, shape.scale ? `scale(${num(shape.scale[0])} ${num(shape.scale[1])})` : ''].filter(Boolean).join(' ');
    return `<path d="${shape.d.replace(/"/g, '')}"${shape.evenodd ? ' fill-rule="evenodd" clip-rule="evenodd"' : ''}${transform ? ` transform="${transform}"` : ''}${attrs}/>`;
  }).join('');
}

/**
 * 부모 지역 좌표(부모 상자 크기)의 마스크 그림 SVG. 마스크 도형의 지역 좌표를 (부모 월드의 역 × 마스크 월드)로 옮긴다.
 * 회전·뒤집힌 마스크도 행렬로 그대로 옮겨진다.
 */
export function maskSvg(parent: DesignNode, mask: DesignNode): string {
  const local = multiply(invert(worldMatrix(parent)), worldMatrix(mask));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(parent.width)}" height="${num(parent.height)}" viewBox="0 0 ${num(parent.width)} ${num(parent.height)}">`
    + `<g transform="matrix(${local.map(num).join(' ')})">${maskPaths(maskShapes(mask))}</g></svg>`;
}

/** CSS mask-image에 넣을 data URL. 따옴표·#·%가 깨지지 않게 인코딩한다. */
export function maskImageUrl(parent: DesignNode, mask: DesignNode): string {
  return `url("data:image/svg+xml,${encodeURIComponent(maskSvg(parent, mask))}")`;
}
