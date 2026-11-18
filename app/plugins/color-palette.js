// @name 색 팔레트
// @permissions read, write
// 현재 페이지에서 쓰는 단색 채우기를 모아 보여주고, 팔레트 프레임(색 견본 사각형 묶음)을 만든다.

const list = document.createElement('div');
list.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0';
const button = document.createElement('button');
button.textContent = '팔레트 프레임 만들기';
document.body.append(list, button);

let colors = [];

async function collect() {
  const nodes = await canvasStudio.findNodes({});
  const counts = new Map();
  for (const node of nodes) for (const paint of node.fills) if (paint.type === 'solid') counts.set(paint.color, (counts.get(paint.color) || 0) + 1);
  colors = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([color]) => color);
  list.replaceChildren(...colors.map((color) => {
    const swatch = document.createElement('div');
    swatch.title = color;
    swatch.style.cssText = `width:24px;height:24px;border-radius:5px;border:1px solid #fff3;background:${color}`;
    return swatch;
  }));
}

button.addEventListener('click', async () => {
  const size = 48;
  const frame = await canvasStudio.createShape({ type: 'frame', name: 'Palette', x: 0, y: -200, width: colors.length * (size + 8) + 8, height: size + 16, fills: [{ type: 'solid', color: '#ffffff' }], radius: 8 });
  for (const [index, color] of colors.entries()) {
    await canvasStudio.createShape({ type: 'rectangle', parentId: frame, name: color, x: 8 + index * (size + 8), y: -192, width: size, height: size, radius: 6, fills: [{ type: 'solid', color }] });
  }
  await canvasStudio.select([frame]);
  await canvasStudio.notify(`색 ${colors.length}개로 팔레트를 만들었습니다.`);
});

canvasStudio.on('documentchange', collect);
collect();
