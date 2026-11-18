import type { DesignNode, Page } from './model';
import { applyPoint, boundsOf, invert, worldCorners, worldMatrix, type Point } from './geometry';

/** 도형 지역 좌표에서 점이 모양 안에 있는지. 타원은 타원 식으로, 나머지는 상자로 본다(DOM 렌더러의 클릭 영역과 같게). */
function inside(node: DesignNode, world: Point): boolean {
  const p = applyPoint(invert(worldMatrix(node)), world);
  if (p.x < 0 || p.y < 0 || p.x > node.width || p.y > node.height) return false;
  if (node.type !== 'ellipse') return true;
  const dx = (p.x - node.width / 2) / (node.width / 2);
  const dy = (p.y - node.height / 2) / (node.height / 2);
  return dx * dx + dy * dy <= 1;
}

/**
 * 페이지 좌표의 점 아래 맨 위 도형 id(Canvas 렌더러에서 DOM 대신 쓰는 클릭 판정). DOM 규칙을 따른다:
 * 위에 그려진 도형이 먼저, 숨긴 도형과 잠긴 도형(그 아래까지)은 통과, 그룹 상자 자체는 클릭되지 않고 자식만,
 * 불리언 그룹은 결과 모양 전체로 하나, 내용을 자르는 프레임 밖의 자식은 클릭되지 않는다.
 */
export function hitTest(page: Page, point: Point): string | null {
  for (const id of [...page.children].reverse()) {
    const hit = hitNode(page, id, point);
    if (hit) return hit;
  }
  return null;
}

/**
 * 최상위 프레임 이름표 위의 점이면 그 프레임 id. Canvas 렌더러가 이름표를 캔버스에 그리므로 클릭 판정도 여기서 한다.
 * @param unit 화면 1픽셀의 페이지 길이(1 / 확대율)
 * @param titleHeight 이름표 높이(화면 픽셀)
 */
export function frameTitleAt(page: Page, point: Point, unit: number, titleHeight: number): string | null {
  for (const id of [...page.children].reverse()) {
    const frame = page.objects[id];
    if (frame?.type !== 'frame' || frame.hidden || frame.locked) continue;
    const bounds = boundsOf(worldCorners(frame));
    if (point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y <= bounds.y && point.y >= bounds.y - titleHeight * unit) return frame.id;
  }
  return null;
}

function hitNode(page: Page, id: string, point: Point): string | null {
  const node = page.objects[id];
  if (!node || node.hidden || node.locked) return null;
  if (node.boolOp) return inside(node, point) ? node.id : null;
  const clipsChildren = node.type === 'frame' && node.clipContent !== false;
  if (!clipsChildren || inside(node, point)) {
    for (const child of [...(node.children ?? [])].reverse()) {
      const hit = hitNode(page, child, point);
      if (hit) return hit;
    }
  }
  if (node.type === 'group') return null;
  return inside(node, point) ? node.id : null;
}
