import { walkPage, type DesignNode, type Page } from './model';
import { boundsOf, containsPoint, intersects, worldCorners, type Point, type Rect } from './geometry';

/** 부모부터 위쪽으로 올라가는 조상 id 목록. */
export function ancestors(page: Page, id: string): string[] {
  const result: string[] = [];
  for (let parent = page.objects[id]?.parentId ?? null; parent !== null; parent = page.objects[parent]?.parentId ?? null) result.push(parent);
  return result;
}

/** 숨긴 조상이 있으면 화면에 보이지 않는다. */
export function isEffectivelyHidden(page: Page, id: string): boolean {
  return [id, ...ancestors(page, id)].some((item) => page.objects[item]?.hidden);
}

/**
 * 캔버스에서 클릭한 도형 대신 실제로 선택할 도형을 정한다.
 * 그룹 안의 도형을 클릭하면 바깥 그룹을 고르고(Figma와 같음), 안쪽 도형은 더블클릭으로 고른다.
 * 이미 선택된 도형이나 그 조상을 클릭하면 선택을 유지해 바로 끌 수 있게 한다.
 */
export function selectionTarget(page: Page, id: string, selectedIds: readonly string[]): string {
  const chain = [id, ...ancestors(page, id)];
  const selected = chain.find((item) => selectedIds.includes(item));
  if (selected) return selected;
  let target = id;
  for (const parent of chain.slice(1)) {
    if (page.objects[parent]?.type !== 'group') break;
    target = parent;
  }
  return target;
}

export function subtreeIds(page: Page, ids: readonly string[]): Set<string> {
  return new Set(walkPage(page, ids).map((node) => node.id));
}

/** point 아래에 있는 가장 위쪽 프레임. excluded에 든 도형(옮기는 중인 도형과 그 하위)은 건너뛴다. */
export function frameAt(page: Page, point: Point, excluded: ReadonlySet<string>): DesignNode | null {
  const candidates = walkPage(page).reverse();
  return candidates.find((node) => node.type === 'frame' && !excluded.has(node.id) && !isEffectivelyHidden(page, node.id) && containsPoint(node, point)) ?? null;
}

/** 그룹을 건너뛰고 가장 가까운 프레임 조상. 놓은 위치의 프레임과 비교해 부모를 바꿀지 정한다. */
export function nearestFrameId(page: Page, id: string): string | null {
  return ancestors(page, id).find((item) => page.objects[item]?.type === 'frame') ?? null;
}

export function boundsOfIds(page: Page, ids: readonly string[]): Rect {
  return boundsOf(ids.flatMap((id) => (page.objects[id] ? worldCorners(page.objects[id]!) : [])));
}

/** 스냅 대상. 보이는 도형 중 옮기는 도형과 그 하위를 뺀 영역. */
export function snapTargets(page: Page, excluded: ReadonlySet<string>): Rect[] {
  return walkPage(page)
    .filter((node) => !excluded.has(node.id) && !isEffectivelyHidden(page, node.id))
    .map((node) => boundsOf(worldCorners(node)));
}

/** 사각형 선택. 최상위 도형 중 영역이 겹치는 것을 고른다. */
export function marqueeHits(page: Page, rect: Rect): string[] {
  return page.children.filter((id) => {
    const node = page.objects[id];
    return node && !node.hidden && !node.locked && intersects(rect, boundsOf(worldCorners(node)));
  });
}

export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** 레이어 패널 순서. Figma처럼 위에 그려지는 도형을 먼저 보여준다. */
/**
 * 레이어 패널의 행. expanded가 주어지면 그 안의 컨테이너만 펼친다(큰 문서에서 행 수를 줄이기 위해, Figma처럼 기본은 접힘).
 * 없으면 모두 펼친다.
 */
export function layerRows(page: Page, expanded?: ReadonlySet<string>): Array<{ node: DesignNode; depth: number }> {
  const rows: Array<{ node: DesignNode; depth: number }> = [];
  const visit = (id: string, depth: number): void => {
    const node = page.objects[id];
    if (!node) return;
    rows.push({ node, depth });
    if (expanded && !expanded.has(id)) return;
    [...(node.children ?? [])].reverse().forEach((child) => visit(child, depth + 1));
  };
  [...page.children].reverse().forEach((id) => visit(id, 0));
  return rows;
}
