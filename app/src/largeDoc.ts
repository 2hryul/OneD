import { pageFromNodes, type DesignDocument, type NodeInput } from './model.ts';

/** 카드 하나에 든 도형 수. 렌더러 성능 측정에서 카드 수 × 이 값이 도형 수다. */
export const NODES_PER_CARD = 12;

/**
 * 성능 측정용 큰 문서. 실제 화면처럼 그라디언트·선·그림자·둥근 모서리·텍스트(여러 줄)·타원·벡터·회전·그룹·오토 레이아웃이 섞인
 * 카드를 격자로 늘어놓는다. 같은 입력이면 같은 문서가 나온다(측정을 되풀이할 수 있게).
 * @param cards 카드 수(도형 수 = cards × NODES_PER_CARD)
 */
export function makeLargeDocument(cards: number): DesignDocument {
  const nodes: NodeInput[] = [];
  const columns = Math.ceil(Math.sqrt(cards));
  for (let index = 0; index < cards; index++) nodes.push(...card(index, (index % columns) * 400, Math.floor(index / columns) * 280));
  return { version: 5, name: `Large ${cards * NODES_PER_CARD}`, components: {}, tokens: {}, pages: [pageFromNodes('page-1', 'Page 1', nodes)] };
}

function card(index: number, x: number, y: number): NodeInput[] {
  const id = (part: string): string => `c${index}-${part}`;
  const hue = (index * 37) % 360;
  const color = `hsl(${hue}, 70%, 55%)`;
  return [
    { id: id('frame'), type: 'frame', name: `Card ${index}`, parentId: null, x, y, width: 360, height: 240, fills: [{ type: 'solid', color: '#ffffff' }], radius: 16, effects: [{ type: 'drop-shadow', x: 0, y: 4, blur: 12, spread: 0, color: '#0000001f' }] },
    { id: id('hero'), type: 'rectangle', name: 'Hero', parentId: id('frame'), x: x + 16, y: y + 16, width: 328, height: 80, radius: 10, fills: [{ type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops: [{ offset: 0, color: '#5369f8' }, { offset: 1, color: '#ff8fb1' }] }] },
    { id: id('avatar'), type: 'ellipse', name: 'Avatar', parentId: id('frame'), x: x + 28, y: y + 108, width: 40, height: 40, fills: [{ type: 'solid', color }], strokes: [{ color: '#ffffff', width: 2, align: 'inside' }] },
    { id: id('title'), type: 'text', name: 'Title', parentId: id('frame'), x: x + 80, y: y + 108, width: 250, height: 22, fills: [{ type: 'solid', color: '#17223a' }], text: `Card number ${index}`, fontSize: 17, fontWeight: 700 },
    { id: id('body'), type: 'text', name: 'Body', parentId: id('frame'), x: x + 80, y: y + 132, width: 250, height: 36, fills: [{ type: 'solid', color: '#52618a' }], text: 'Two lines of body text that wrap inside the card box to test text layout.', fontSize: 12, lineHeight: 17 },
    { id: id('star'), type: 'vector', name: 'Star', parentId: id('frame'), x: x + 300, y: y + 30, width: 28, height: 28, fills: [{ type: 'solid', color: '#ffd43b' }], path: [{ closed: true, points: [{ x: 14, y: 0 }, { x: 18, y: 10 }, { x: 28, y: 10 }, { x: 20, y: 17 }, { x: 23, y: 28 }, { x: 14, y: 21 }, { x: 5, y: 28 }, { x: 8, y: 17 }, { x: 0, y: 10 }, { x: 10, y: 10 }] }] },
    { id: id('tag'), type: 'rectangle', name: 'Tag', parentId: id('frame'), x: x + 240, y: y + 60, width: 80, height: 20, radius: 10, fills: [{ type: 'solid', color: '#ffffffcc' }], transform: [Math.cos(0.2), Math.sin(0.2), -Math.sin(0.2), Math.cos(0.2), 0, 0] },
    { id: id('group'), type: 'group', name: 'Dots', parentId: id('frame'), x: x + 28, y: y + 190, width: 40, height: 12, fills: [] },
    { id: id('dot1'), type: 'ellipse', name: 'Dot', parentId: id('group'), x: x + 28, y: y + 190, width: 12, height: 12, fills: [{ type: 'solid', color: '#ced4da' }] },
    { id: id('dot2'), type: 'ellipse', name: 'Dot', parentId: id('group'), x: x + 56, y: y + 190, width: 12, height: 12, fills: [{ type: 'solid', color }] },
    { id: id('button'), type: 'frame', name: 'Button', parentId: id('frame'), x: x + 240, y: y + 184, width: 96, height: 32, radius: 8, fills: [{ type: 'solid', color: '#17223a' }], layout: { type: 'flex', direction: 'row', wrap: false, gap: 0, crossGap: 0, padding: [8, 16, 8, 16], justify: 'center', align: 'center' } },
    { id: id('label'), type: 'text', name: 'Label', parentId: id('button'), x: x + 256, y: y + 192, width: 64, height: 16, fills: [{ type: 'solid', color: '#ffffff' }], text: 'Open', fontSize: 13, textAlign: 'center' }
  ];
}
