import { hasMask } from './mask';
import type { DesignNode, FlexAlign, FlexDirection, Page } from './model';

/**
 * 흐름 안 요소의 바깥 여백. gap 하나로 나타낼 수 없는 간격 차이(main)와 교차축 들여쓰기(cross)를 CSS margin으로 낸다.
 * axis는 부모 흐름의 방향이다(column이면 main은 위, cross는 왼쪽).
 */
export interface FlowMargin { axis: FlexDirection; main: number; cross: number }

/**
 * 내보내기용 흐름 배치 결과. page는 원본을 바꾸지 않은 사본이다. inferred는 레이아웃을 새로 붙인 컨테이너, wrappers는 새로 만든 묶음 프레임이다.
 * zIndex는 흐름에서 뺀 절대 위치 자식이 있는 컨테이너 안 원래 도형들의 원래 쌓임 순서다(묶음에는 없다).
 * gutters는 좁은 화면에서 좌우 16px 여백을 줄 컨테이너다(디자인에서 가로 들여쓰기가 있던 원래 프레임).
 */
export interface FlowPlan { page: Page; margins: Map<string, FlowMargin>; inferred: Set<string>; wrappers: Set<string>; zIndex: Map<string, number>; gutters: Set<string> }

interface Box { id: string; x: number; y: number; w: number; h: number }

/** XY-cut 결과. flow는 한 축으로 나눈 묶음, stack은 더 나눌 수 없는 겹침, backgrounds는 나머지를 모두 감싸 배경으로 깔리는 상자다. */
type Cut = { kind: 'leaf'; box: Box } | { kind: 'flow'; axis: FlexDirection; parts: Cut[]; backgrounds: Box[] } | { kind: 'stack'; boxes: Box[] };

const EPS = 1;
const CENTER_EPS = 1.5;

const boundsOf = (boxes: readonly Box[]): Box => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { id: '', x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};
const boxesOf = (cut: Cut): Box[] => (cut.kind === 'leaf' ? [cut.box] : cut.kind === 'stack' ? cut.boxes : [...cut.backgrounds, ...cut.parts.flatMap(boxesOf)]);
const contains = (outer: Box, inner: Box): boolean => inner.x >= outer.x - EPS && inner.y >= outer.y - EPS && inner.x + inner.w <= outer.x + outer.w + EPS && inner.y + inner.h <= outer.y + outer.h + EPS;

/**
 * 빈 틈으로 나눈다. 세로(위아래로 쌓기)를 먼저, 안 되면 가로로 나눈다. 겹치면 가장 큰 상자를 배경으로 빼고 다시 시도한다.
 * 가장 큰 상자가 나머지를 다 감싸거나, 감싸지 않아도 원래 쌓임 순서(order)에서 가장 아래면 배경이다(옆으로 삐져나온 사이드바 등).
 * 위에 있는 상자는 덮개일 수 있어 배경으로 내리지 않는다.
 */
export function xyCut(boxes: readonly Box[], order?: ReadonlyMap<string, number>): Cut {
  if (boxes.length === 1) return { kind: 'leaf', box: boxes[0]! };
  for (const [key, size, axis] of [['y', 'h', 'column'], ['x', 'w', 'row']] as const) {
    const sorted = [...boxes].sort((a, b) => a[key] - b[key]);
    const groups: Box[][] = [];
    let end = -Infinity;
    for (const box of sorted) {
      if (box[key] >= end - EPS) groups.push([box]);
      else groups[groups.length - 1]!.push(box);
      end = Math.max(end, box[key] + box[size]);
    }
    if (groups.length > 1) return { kind: 'flow', axis, parts: groups.map((group) => xyCut(group, order)), backgrounds: [] };
  }
  const biggest = boxes.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
  const rest = boxes.filter((box) => box !== biggest);
  const lowest = order !== undefined && rest.every((box) => (order.get(box.id) ?? 0) > (order.get(biggest.id) ?? 0));
  if (rest.every((box) => contains(biggest, box)) || lowest) {
    const inner = xyCut(rest, order);
    if (inner.kind === 'flow') return { ...inner, backgrounds: [biggest, ...inner.backgrounds] };
    return { kind: 'flow', axis: 'column', parts: [inner], backgrounds: [biggest] };
  }
  return { kind: 'stack', boxes: [...boxes] };
}

/** 이 컨테이너를 흐름으로 바꿔도 되는가. 레이아웃이 이미 있거나, 인스턴스·마스크·불리언이거나, 회전한 컨테이너는 그대로 둔다. */
function eligible(page: Page, node: DesignNode): boolean {
  if (node.layout || node.boolOp || node.componentId || node.componentSet || (node.type !== 'frame' && node.type !== 'group')) return false;
  return !hasMask(page, node) && straight(node);
}

/**
 * 흐름에 넣을 수 있는 자식. 회전·반전했거나 컨테이너 밖으로 나간 자식은 절대 위치로 남긴다(장식이 많다).
 * 이미 흐름 밖(item.absolute)인 자식과, 프레임 안에서 오른쪽·가운데·양쪽 늘이기 제약을 정한 자식도 남긴다(디자이너가 크기 변화에 따른 자리를 정했다).
 * scale(비율 이동)은 흐름의 % margin과 같은 뜻이라 흐름에 넣는다. 가져온 파일에 흔하고(Urban Login 20개) 빼면 모바일 배치가 망가진다.
 * 그룹 안의 제약은 Figma에서도 쓰이지 않으므로 보지 않는다.
 */
const PINNED_H = new Set(['right', 'center', 'left-right']);
const PINNED_V = new Set(['bottom', 'center', 'top-bottom']);
const flowable = (node: DesignNode, kid: DesignNode): boolean =>
  straight(kid) && !kid.item?.absolute && kid.x >= node.x - EPS && kid.y >= node.y - EPS && kid.x + kid.width <= node.x + node.width + EPS && kid.y + kid.height <= node.y + node.height + EPS &&
  !(node.type === 'frame' && kid.constraints && (PINNED_H.has(kid.constraints.h) || PINNED_V.has(kid.constraints.v)));
const straight = (node: DesignNode): boolean => Math.abs(node.transform[1]) < 1e-6 && Math.abs(node.transform[2]) < 1e-6 && node.transform[0] > 0 && node.transform[3] > 0;

/**
 * 오토 레이아웃이 없는 프레임·그룹을 XY-cut으로 흐름(flex) 레이아웃으로 바꾼 사본을 만든다. 내보내기만 쓴다(문서는 그대로).
 * 디자인 폭에서는 원래 자리와 같게 padding·gap·margin을 고르고, 좁은 화면 규칙은 내보내기(stackOnNarrow)가 붙인다.
 * hidden은 그리지 않는 도형이다. skip이 참인 도형(인스턴스 안 등)의 하위는 건드리지 않는다.
 */
export function inferFlow(page: Page, rootId: string, hidden: ReadonlySet<string>, skip: (node: DesignNode) => boolean = () => false): FlowPlan {
  const objects: Record<string, DesignNode> = { ...page.objects };
  const plan: FlowPlan = { page: { ...page, objects }, margins: new Map(), inferred: new Set(), wrappers: new Set(), zIndex: new Map(), gutters: new Set() };
  let serial = 0;

  const visit = (id: string): void => {
    if (!objects[id] || hidden.has(id) || skip(objects[id]!)) return;
    // 원본 문서의 도형을 바꾸지 않도록 사본에서 고친다.
    const node = objects[id] = { ...objects[id]! };
    const kids = (node.children ?? []).map((child) => objects[child]!).filter((kid) => kid && !hidden.has(kid.id));
    const inFlow = kids.filter((kid) => flowable(node, kid));
    if (eligible(plan.page, node) && inFlow.length) {
      const stacking = new Map((node.children ?? []).map((child, index) => [child, index] as const));
      const cut = xyCut(inFlow.map((kid) => ({ id: kid.id, x: kid.x - node.x, y: kid.y - node.y, w: kid.width, h: kid.height })), stacking);
      if (cut.kind !== 'stack') {
        const order = node.children ?? [];
        const firstFlow = Math.min(...inFlow.map((kid) => order.indexOf(kid.id)));
        const loose = kids.filter((kid) => !inFlow.includes(kid)).map((kid) => {
          objects[kid.id] = { ...kid, item: { ...kid.item, absolute: true } };
          return kid.id;
        });
        apply(node, cut, { id: node.id, x: 0, y: 0, w: node.width, h: node.height });
        // 흐름에서 뺀 자식은 원래 쌓임 순서에 맞춰 흐름 앞(아래) 또는 뒤(위)에 둔다.
        const below = loose.filter((id) => order.indexOf(id) < firstFlow);
        const above = loose.filter((id) => order.indexOf(id) >= firstFlow);
        const rest = (node.children ?? []).filter((id) => !loose.includes(id));
        node.children = [...below, ...rest, ...above];
        // 흐름 묶음 사이에 끼어 있던 장식은 문서 순서만으로는 원래 높이에 못 놓는다. 원래 도형마다 원래 쌓임 순서를 z-index로 준다.
        // 묶음(wrapper)에는 주지 않는다. z-index가 없는 묶음은 쌓임 맥락을 만들지 않아 안의 도형이 장식과 원래 순서로 섞인다.
        // 모든 흐름 요소보다 아래나 위에 있던 장식만 있으면 위의 문서 순서로 충분하다.
        const lastFlow = Math.max(...inFlow.map((kid) => order.indexOf(kid.id)));
        if (loose.some((id) => order.indexOf(id) > firstFlow && order.indexOf(id) < lastFlow)) {
          const assign = (id: string): void => {
            if (hidden.has(id)) return;
            if (plan.wrappers.has(id)) (objects[id]!.children ?? []).forEach(assign);
            else plan.zIndex.set(id, order.indexOf(id) + 1);
          };
          node.children.forEach(assign);
        }
      }
    }
    for (const child of objects[id]!.children ?? []) visit(child);
  };

  /** container(실제 또는 새 묶음)에 cut을 적용한다. frame은 container의 상자(부모 원점 기준)다. */
  const apply = (container: DesignNode, cut: Cut, frame: Box): void => {
    if (cut.kind === 'stack') return;
    const hiddenKids = (container.children ?? []).filter((child) => hidden.has(child));
    const flow: Extract<Cut, { kind: 'flow' }> = cut.kind === 'leaf' ? { kind: 'flow', axis: 'column', parts: [cut], backgrounds: [] } : cut;
    const backgrounds: string[] = [];
    for (const background of flow.backgrounds) {
      const kid = objects[background.id] = { ...objects[background.id]!, parentId: container.id };
      kid.item = { ...kid.item, absolute: true };
      // 컨테이너를 꽉 채운 배경은 크기가 바뀌어도 따라가게 한다.
      if (Math.abs(background.x - frame.x) <= EPS && Math.abs(background.w - frame.w) <= EPS && Math.abs(background.y - frame.y) <= EPS && Math.abs(background.h - frame.h) <= EPS) kid.constraints = { h: 'left-right', v: 'top-bottom' };
      backgrounds.push(kid.id);
    }
    const partIds = flow.parts.map((part) => (part.kind === 'leaf' ? part.box.id : wrap(container, part)));
    for (const id of partIds) objects[id] = { ...objects[id]!, parentId: container.id };
    setLayout(container, flow.axis, flow.parts, partIds, frame, backgrounds.length > 0);
    // 배경을 먼저 두어 아래에 깔리게 한다(흐름 요소도 position: relative라 문서 순서대로 쌓인다).
    container.children = [...backgrounds, ...partIds, ...hiddenKids];
  };

  /** 여러 도형으로 된 묶음을 새 프레임으로 감싼다. 겹쳐서 나눌 수 없는 묶음은 안에서 절대 위치를 유지한다. */
  const wrap = (parent: DesignNode, part: Cut): string => {
    const boxes = boxesOf(part);
    const bounds = boundsOf(boxes);
    const id = `${parent.id}~flow${++serial}`;
    const wrapper: DesignNode = {
      id, type: 'frame', name: part.kind === 'flow' ? part.axis === 'row' ? 'Row' : 'Column' : 'Group', parentId: parent.id,
      x: parent.x + bounds.x, y: parent.y + bounds.y, width: bounds.w, height: bounds.h, transform: [1, 0, 0, 1, 0, 0], fills: [], clipContent: false,
      children: boxes.map((box) => box.id)
    };
    objects[id] = wrapper;
    plan.wrappers.add(id);
    for (const box of boxes) objects[box.id] = { ...objects[box.id]!, parentId: id };
    const local = (box: Box): Box => ({ ...box, x: box.x - bounds.x, y: box.y - bounds.y });
    const relocate = (cut: Cut): Cut => cut.kind === 'leaf' ? { kind: 'leaf', box: local(cut.box) } : cut.kind === 'stack' ? { kind: 'stack', boxes: cut.boxes.map(local) } : { ...cut, parts: cut.parts.map(relocate), backgrounds: cut.backgrounds.map(local) };
    if (part.kind === 'stack') {
      // 겹침 묶음: 원래 쌓임 순서를 지키고 안에서는 좌표 그대로 둔다.
      const order = (parent.children ?? []);
      wrapper.children = [...wrapper.children!].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    } else apply(wrapper, relocate(part), { id, x: 0, y: 0, w: bounds.w, h: bounds.h });
    return id;
  };

  /** padding·gap·정렬과 요소별 margin을 고른다. 디자인 폭에서 원래 자리와 같아야 한다. */
  const setLayout = (container: DesignNode, axis: FlexDirection, parts: readonly Cut[], ids: readonly string[], frame: Box, boxed: boolean): void => {
    const row = axis === 'row';
    const boxes = parts.map((part) => boundsOf(boxesOf(part)));
    const mainStart = (b: Box): number => (row ? b.x : b.y);
    const mainSize = (b: Box): number => (row ? b.w : b.h);
    const crossStart = (b: Box): number => (row ? b.y : b.x);
    const crossSize = (b: Box): number => (row ? b.h : b.w);
    const frameCross = row ? frame.h : frame.w;
    const gaps = boxes.slice(1).map((box, index) => mainStart(box) - (mainStart(boxes[index]!) + mainSize(boxes[index]!)));
    const gap = gaps.length ? Math.max(0, Math.min(...gaps)) : 0;
    const centered = boxes.map((box) => Math.abs(crossStart(box) + crossSize(box) / 2 - frameCross / 2) <= CENTER_EPS);
    const allCentered = centered.every(Boolean);
    const lead = Math.max(0, mainStart(boxes[0]!));
    // 가로 padding은 쓰지 않는다. px padding은 화면이 줄어도 그대로라 태블릿 폭에서 내용 폭을 잡아먹는다.
    // 가로 들여쓰기는 요소마다 margin으로 두고 내보내기가 부모 폭에 대한 %로 낸다. 세로 시작 여백(열의 위쪽)만 padding이다.
    const padding: [number, number, number, number] = row ? [0, 0, 0, 0] : [round(lead), 0, 0, 0];
    const align: FlexAlign = allCentered ? 'center' : 'start';
    container.layout = { type: 'flex', direction: axis, wrap: false, gap: round(gap), crossGap: round(gap), padding, justify: 'start', align };
    plan.inferred.add(container.id);
    // 원래 프레임이나 배경이 있는 묶음(카드처럼 보이는 상자)의 가로 들여쓰기가 16px 이상이면 좁은 화면에서 좌우 16px 여백을 준다(들여쓰기 margin은 그때 지운다).
    const horizontal = row ? [lead] : boxes.filter((_, index) => !centered[index]).map(crossStart);
    if ((!plan.wrappers.has(container.id) || boxed) && horizontal.length && Math.min(...horizontal) >= 16) plan.gutters.add(container.id);
    boxes.forEach((box, index) => {
      const id = ids[index]!;
      const kid = objects[id] = { ...objects[id]! };
      // 디자인 폭에서는 지금 크기 그대로다(글꼴이 달라 줄이 늘어도 아래 요소를 밀지 않는다). 좁은 화면에서 높이를 푸는 것은 내보내기(stackOnNarrow)가 한다.
      kid.item = { ...kid.item, h: 'fix', v: 'fix', ...(centered[index] && !allCentered ? { alignSelf: 'center' as const } : {}) };
      const main = index === 0 ? (row ? round(lead) : 0) : round(gaps[index - 1]! - gap);
      const cross = allCentered || centered[index] ? 0 : round(crossStart(box));
      if (main || cross) plan.margins.set(id, { axis, main, cross });
    });
  };

  visit(rootId);
  return plan;
}

const round = (value: number): number => Math.round(value * 100) / 100;
