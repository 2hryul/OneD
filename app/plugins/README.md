# Canvas Studio 플러그인 API

플러그인은 `.js` 파일 하나다. 편집기 위쪽 **플러그인** 버튼 → **.js 파일에서 추가**로 설치하고, 처음 실행할 때 요청한 권한을 허용한다. 이 폴더의 `rename-layers.js`, `color-palette.js`가 예제다.

## 머리말

```js
// @name 레이어 이름 정리
// @permissions read, write
```

- `@name`: 목록에 보일 이름(60자까지). 없으면 파일 이름.
- `@permissions`: `read`(문서·선택 읽기), `write`(도형 만들기·고치기·지우기, 선택 바꾸기). 없으면 `read`만.

## 실행 환경

- 플러그인은 `sandbox="allow-scripts"` iframe에서 실행된다. 편집기 페이지, localStorage·IndexedDB, 쿠키에 접근할 수 없다.
- CSP가 네트워크 요청을 모두 막는다(`fetch`, 외부 스크립트·이미지 불가). 문서 내용을 밖으로 보낼 수 없다.
- 플러그인 창(300×360)의 `document.body`에 화면을 직접 만든다.
- 호출은 초당 200회, 인자는 1MB까지다.
- 쓰기는 하나하나가 편집기의 undo 한 단계이고, 공유 파일을 연 상태면 다른 참여자에게도 적용된다.

## API (`window.canvasStudio`, 모든 메서드는 Promise)

| 메서드 | 권한 | 설명 |
|---|---|---|
| `getDocumentInfo()` | read | `{ name, pageId, pages: [{ id, name }] }` |
| `getPage()` | read | 현재 페이지 `{ id, name, children }`(최상위 도형 id, 그리는 순서) |
| `getNode(id)` | read | 도형 하나(문서 저장 형식의 복사본) |
| `getSelection()` | read | 선택한 도형 목록 |
| `findNodes({ type?, name? })` | read | 현재 페이지에서 종류·이름(부분 일치, 대소문자 무시)으로 찾기, 5,000개까지 |
| `createShape(shape)` | write | 새 도형을 만들고 id를 돌려준다. `type`은 `frame`·`rectangle`·`ellipse`·`text`. `parentId`를 주면 그 컨테이너 안에 넣는다. 좌표는 페이지 절대 좌표다. |
| `updateShape(id, patch)` | write | 속성 고치기. 위치·크기는 크기 바꾸기 규칙(그룹·프레임 자식 따라감)을 따른다. |
| `deleteShapes(ids)` | write | 지운 개수를 돌려준다. 없는 id는 건너뛴다. |
| `select(ids)` | write | 선택 바꾸기 |
| `notify(text)` | - | 편집기 상태 표시줄에 글을 띄운다(200자까지). |
| `on(name, listener)` | - | `selectionchange`(선택 id 목록), `documentchange`(문서가 바뀌고 0.2초 뒤) |
| `close()` | - | 플러그인 창 닫기 |

`createShape`·`updateShape`에서 쓸 수 있는 속성: `name`, `x`, `y`, `width`, `height`, `fills`, `strokes`, `effects`, `opacity`, `radius`, `text`, `fontSize`, `fontWeight`, `fontFamily`, `textAlign`, `verticalAlign`, `lineHeight`, `letterSpacing`, `hidden`, `locked`. 값은 문서 파일을 열 때와 같은 검사를 거치고, 어긋나면 Promise가 오류로 끝난다. 계층·컴포넌트·토큰·레이아웃 속성은 바꿀 수 없다.

채우기 예: `[{ type: 'solid', color: '#5369f8' }]`, 선 예: `[{ color: '#000000', width: 1, align: 'inside' }]`.
