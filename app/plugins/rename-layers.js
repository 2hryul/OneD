// @name 레이어 이름 정리
// @permissions read, write
// 선택한 레이어 이름을 "접두어 1, 2, 3…"으로 바꾼다. 위에서 아래(화면 y 순서)로 번호를 붙인다.

const status = document.createElement('p');
const prefix = document.createElement('input');
prefix.value = 'Item';
prefix.style.cssText = 'width:120px;padding:4px 6px;border:1px solid #454b5a;border-radius:5px;background:#2b303d;color:#eef1f8';
const button = document.createElement('button');
button.textContent = '이름 바꾸기';
document.body.append(status, prefix, button);

async function refresh() {
  const selection = await canvasStudio.getSelection();
  status.textContent = selection.length ? `선택 ${selection.length}개` : '레이어를 선택하세요.';
  button.disabled = selection.length === 0;
}

button.addEventListener('click', async () => {
  const selection = await canvasStudio.getSelection();
  const ordered = [...selection].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const [index, node] of ordered.entries()) await canvasStudio.updateShape(node.id, { name: `${prefix.value || 'Item'} ${index + 1}` });
  await canvasStudio.notify(`${ordered.length}개 레이어 이름을 바꿨습니다.`);
});

canvasStudio.on('selectionchange', refresh);
refresh();
