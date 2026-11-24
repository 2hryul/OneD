import { describe, expect, it } from 'vitest';
import { inferFlow, xyCut } from '../src/flowInfer';
import { exportTsx } from '../src/export';
import type { DesignDocument, DesignNode, Page } from '../src/model';

/** 페이지 좌표의 도형. parent의 자식으로 붙인다. */
const node = (id: string, x: number, y: number, width: number, height: number, patch: Partial<DesignNode> = {}): DesignNode =>
  ({ id, type: 'rectangle', name: id, parentId: 'root', x, y, width, height, transform: [1, 0, 0, 1, 0, 0], fills: [{ type: 'solid', color: '#000000' }], ...patch });

function pageOf(kids: DesignNode[], root: Partial<DesignNode> = {}): Page {
  const frame = node('root', 0, 0, 1000, 800, { type: 'frame', name: 'Screen', parentId: null, children: kids.map((kid) => kid.id), fills: [], ...root });
  return { id: 'p', name: 'P', children: ['root'], objects: Object.fromEntries([frame, ...kids].map((item) => [item.id, item])) };
}

describe('XY-cut', () => {
  it('splits stacked boxes into a column and side-by-side boxes into a row', () => {
    const column = xyCut([{ id: 'a', x: 0, y: 0, w: 100, h: 20 }, { id: 'b', x: 0, y: 40, w: 100, h: 20 }]);
    expect(column).toMatchObject({ kind: 'flow', axis: 'column' });
    const row = xyCut([{ id: 'a', x: 0, y: 0, w: 40, h: 20 }, { id: 'b', x: 60, y: 0, w: 40, h: 20 }]);
    expect(row).toMatchObject({ kind: 'flow', axis: 'row' });
  });

  it('takes a box that contains all others as a background and gives up on other overlaps', () => {
    const card = xyCut([{ id: 'bg', x: 0, y: 0, w: 200, h: 100 }, { id: 't', x: 10, y: 10, w: 50, h: 20 }, { id: 'u', x: 10, y: 50, w: 50, h: 20 }]);
    expect(card).toMatchObject({ kind: 'flow', axis: 'column', backgrounds: [{ id: 'bg' }] });
    expect(xyCut([{ id: 'a', x: 0, y: 0, w: 60, h: 60 }, { id: 'b', x: 30, y: 30, w: 60, h: 60 }])).toMatchObject({ kind: 'stack' });
  });
});

describe('flow inference for export', () => {
  it('keeps every box where it was at the design width (padding, gap and margins)', () => {
    // 왼쪽 100에서 시작하는 제목·본문·버튼 줄. 간격은 24와 40.
    const page = pageOf([node('title', 100, 80, 400, 40), node('body', 100, 144, 500, 60), node('a', 100, 244, 120, 40), node('b', 240, 244, 120, 40)]);
    const plan = inferFlow(page, 'root', new Set());
    const root = plan.page.objects.root!;
    // 위쪽 시작 여백만 padding이다. 가로 들여쓰기(100)는 요소마다 margin이고 내보내기가 %로 낸다.
    expect(root.layout).toMatchObject({ type: 'flex', direction: 'column', gap: 24, padding: [80, 0, 0, 0], align: 'start' });
    expect(plan.margins.get('body')).toEqual({ axis: 'column', main: 0, cross: 100 });
    // 두 번째 간격(40)은 gap(24)과의 차이만큼 margin으로 낸다. 버튼 둘은 새 묶음 Row로 들어간다.
    const row = root.children!.find((id) => plan.wrappers.has(id))!;
    expect(plan.page.objects[row]).toMatchObject({ name: 'Row', layout: { direction: 'row', gap: 20, padding: [0, 0, 0, 0] } });
    expect(plan.margins.get(row)).toEqual({ axis: 'column', main: 16, cross: 100 });
    // 가로 들여쓰기가 있던 원래 프레임은 좁은 화면에서 좌우 16px 여백을 받는다. 묶음은 받지 않는다.
    expect([...plan.gutters]).toEqual(['root']);
    // 원본 문서는 바뀌지 않는다.
    expect(page.objects.root!.layout).toBeUndefined();
    expect(page.objects.a!.parentId).toBe('root');
  });

  it('centres within the full width when centred and indented boxes are mixed', () => {
    // 오른쪽 메뉴(들여쓰기 700)와 가운데 카드. padding을 쓰면 가운데 정렬이 padding의 절반만큼 밀린다.
    const plan = inferFlow(pageOf([node('menu', 700, 20, 200, 40), node('card', 300, 120, 400, 300)]), 'root', new Set());
    expect(plan.page.objects.root!.layout).toMatchObject({ padding: [20, 0, 0, 0] });
    expect(plan.page.objects.card!.item?.alignSelf).toBe('center');
    expect(plan.margins.get('menu')).toEqual({ axis: 'column', main: 0, cross: 700 });
    expect(plan.margins.get('card')).toBeUndefined();
    expect(plan.page.objects.root!.layout).toMatchObject({ gap: 60 });
  });

  it('leaves decorations outside the frame absolute and keeps their stacking between flow boxes', () => {
    // 배경(0) 위에 프레임 밖으로 나간 장식(1), 그 위에 사진(2). 장식이 흐름 사이에 끼어 있어 z-index로 순서를 지킨다.
    const page = pageOf([node('bg', 0, 0, 1000, 400), node('circle', 600, 100, 600, 600), node('photo', 700, 50, 200, 300)]);
    const plan = inferFlow(page, 'root', new Set());
    expect(plan.page.objects.circle!.item?.absolute).toBe(true);
    expect([plan.zIndex.get('bg'), plan.zIndex.get('circle'), plan.zIndex.get('photo')]).toEqual([1, 2, 3]);
    // 흐름보다 위에만 있던 장식이면 z-index 없이 문서 순서로 충분하다.
    const above = inferFlow(pageOf([node('a', 100, 100, 100, 100), node('dot', 990, -20, 30, 30)]), 'root', new Set());
    expect(above.zIndex.size).toBe(0);
  });

  it('keeps designer constraints and takes a bottom-most sidebar as a background', () => {
    // 프레임 안에서 오른쪽 고정으로 정한 버튼은 흐름에 넣지 않는다(제약대로 움직인다).
    const pinned = inferFlow(pageOf([node('title', 100, 100, 300, 40), node('cta', 800, 100, 120, 40, { constraints: { h: 'right', v: 'top' } })]), 'root', new Set());
    expect(pinned.page.objects.cta!.item?.absolute).toBe(true);
    expect(pinned.page.objects.cta!.constraints).toEqual({ h: 'right', v: 'top' });
    // 맨 아래 사이드바는 로고와 그림을 다 감싸지 않아도(그림이 옆으로 삐져나옴) 배경이다. 위에 있는 덮개는 배경으로 내리지 않는다.
    const sidebar = [node('side', 0, 0, 300, 800), node('logo', 40, 40, 200, 40), node('hero', 60, 200, 500, 400)];
    expect(xyCut(sidebar.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.width, h: b.height })), new Map([['side', 0], ['logo', 1], ['hero', 2]]))).toMatchObject({ kind: 'flow', axis: 'column', backgrounds: [{ id: 'side' }] });
    expect(xyCut(sidebar.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.width, h: b.height })), new Map([['side', 2], ['logo', 0], ['hero', 1]]))).toMatchObject({ kind: 'stack' });
  });

  it('lets indented boxes shrink below the design width without overflowing', () => {
    const page = pageOf([node('title', 100, 80, 400, 40, { type: 'text', text: 'Title', fills: [{ type: 'solid', color: '#111111' }] }), node('photo', 100, 160, 600, 300, { fills: [{ type: 'image', assetId: 'a', fit: 'fill' }] })]);
    const doc = { version: 5, name: 'Doc', components: {}, tokens: {}, pages: [page] } as unknown as DesignDocument;
    const { css } = exportTsx(doc, 'p', 'root');
    // 들여쓰기 10%를 뺀 폭까지만 넓어진다. 좁은 화면에서는 들여쓰기와 함께 풀린다.
    const title = /\n\.screen__title \{([^}]*)\}/.exec(css)![1]!;
    expect(title).toContain('margin-left: 10%;');
    expect(title).toContain('max-width: 90%;');
    // 글자는 처음부터 최소 높이라 줄이 늘면 늘어난다.
    expect(title).toContain('min-height: 40px;');
    expect(css).toMatch(/@media \(max-width: 767px\) \{[\s\S]*\.screen__title \{\n {4}margin-left: 0;\n {4}max-width: 100%;/);
    // 디자인 폭(1000px)보다 좁으면 그림은 고정 높이 대신 비율을 지킨다. 디자인 폭에서는 그대로다.
    expect(css).toMatch(/@media \(max-width: 999px\) \{\n {2}\.screen__photo \{\n {4}height: auto;\n {4}aspect-ratio: 600 \/ 300;/);
  });

  it('does not touch frames that already have auto layout, instances or rotated children', () => {
    const page = pageOf([node('turned', 100, 100, 100, 40, { transform: [0, 1, -1, 0, 0, 0] }), node('kept', 100, 200, 100, 40)]);
    const plan = inferFlow(page, 'root', new Set());
    expect(plan.page.objects.turned!.item?.absolute).toBe(true);
    const instance = inferFlow(pageOf([node('a', 0, 0, 10, 10)], { componentId: 'c1' }), 'root', new Set());
    expect(instance.inferred.size).toBe(0);
  });

  it('exports the inferred layout with narrow-screen rules and leaves the saved document alone', () => {
    const page = pageOf([node('title', 100, 80, 400, 40, { type: 'text', text: 'Title', fills: [{ type: 'solid', color: '#111111' }] }), node('a', 100, 160, 150, 40), node('b', 290, 160, 150, 40)]);
    const doc = { version: 5, name: 'Doc', components: {}, tokens: {}, pages: [page] } as unknown as DesignDocument;
    const { css } = exportTsx(doc, 'p', 'root');
    expect(css).toMatch(/\.screen \{[^}]*display: flex;[^}]*flex-direction: column;/);
    // 가로 들여쓰기 100px은 부모 폭 1000px에 대한 10%다(디자인 폭에서 같은 자리, 화면이 줄면 함께 준다).
    expect(css).toMatch(/\.screen__title \{[^}]*margin-left: 10%;/);
    // 좁은 화면에서는 들여쓰기를 지우고 좌우 16px 여백을 준다. 600px보다 좁은 가로 줄(340px, 간격 40)은 줄바꿈하며 줄 사이 간격은 16px 이하다.
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.screen \{[^}]*padding: 80px 16px 0px 16px;/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*margin-left: 0;/);
    expect(css).toMatch(/flex-wrap: wrap;\s*row-gap: 16px;/);
    expect(page.objects.root!.layout).toBeUndefined();
  });
});
