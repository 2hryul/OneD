# React 코드 zip 내보내기

사용자가 요소를 고르고 **React 코드**를 누르면 TSX·CSS 초안이 코드 창에 나오고, **zip 받기**로 프로젝트에 넣을 파일 묶음(화면 TSX·CSS, 필요하면 components/, tokens.css, assets/ 그림)을 받는다.

## Sub-features

- `code-open` 요소를 고르면 React 코드 버튼이 켜지고 코드 창이 열린다(제목 `<이름>.tsx · <이름>.css`).
- `code-tabs` TSX·CSS 탭 전환, 복사, TSX·CSS 따로 받기.
- `code-zip` zip 받기가 나눈 파일 묶음을 내려주고 상태 표시줄에 `zip을 받았습니다(파일 N개).`를 보여 준다.
- `code-zip-assets` 그림이 든 요소는 zip에 `assets/` 그림이 들어간다(샘플 문서에는 그림이 없어 여정에서 다루지 않음).

## How to get to it (user POV)

- 왼쪽 레이어 목록이나 캔버스에서 요소 선택 → 위쪽 **React 코드** → 코드 창 아래 **zip 받기**.
- 오른쪽 패널 **코드** 탭은 선택 요소의 CSS 검사 창이다(zip과 다름).

## Driving it with run.mjs

Preconditions:

- `doctor.mjs`가 `FAIL` 없이 끝난다.
- 첫 화면이 샘플 문서다(새 컨텍스트라 항상 그렇다).

- **실행.** `node .claude/skills/verify-canvas-studio/harness/run.mjs code-zip`.
- **선택.** 레이어 목록의 `Landing page` 행을 누른다. React 코드 버튼이 켜진다.
- **코드 창.** React 코드를 누르면 `.code-modal`이 열리고 제목이 `LandingPage.tsx · LandingPage.css`. 스크린샷 `01-code-modal.png`.
- **zip 받기.** zip 받기를 누르면 `LandingPage.zip`이 내려온다. 항목에 `.tsx`와 `.css`가 있고, TSX에 `Design starts here`가 있다. 상태 표시줄 파일 수가 zip 항목 수와 같다.
- **증거.** `download-LandingPage.zip`, `zip-entries.json`, `02-after-zip.png`, `summary.json`.

## Gotchas

- 아무것도 고르지 않으면 React 코드 버튼이 꺼져 있다. 선택 상태를 먼저 확인한다.
- 코드 창 바깥을 누르면 창이 닫힌다. zip 받기 전에 다른 곳을 누르지 않는다.
- 컴포넌트·variant가 있는 문서는 zip에 `components/`·`tokens.css`·`index.ts`가 더 생긴다. 샘플 문서에서는 두 파일뿐이다.
- 앱의 zip은 무압축(저장 방식)이라 `zipEntries`로 바로 글자를 읽을 수 있다. 압축 방식이 바뀌면 `text`가 `null`이 되어 글자 확인이 실패한다. `text`는 그림 바이트도 UTF-8 글자로 바꾸므로, zip을 풀어 빌드해 보려면 그림은 바이트 그대로 꺼내야 한다.
- 디자인이 쓰는 그림이 저장소(IndexedDB)에 없으면(예: ZIP 없는 예전 형식 .fig) 코드는 그 그림을 import하지 않는다. `img` 대신 `role="img"` 상자를 내고 배경을 체크무늬로 채우며, 상태 표시줄에 `그림 N개는 저장소에 없어 빈 자리로 냈습니다.`가 붙는다. 2026-11-24 `test/web-urban-riders.fig`의 Search 두 화면(`1:95`, `1:117`)으로 받은 zip이 strict `tsc`와 esbuild 빌드를 통과하는 것을 확인했다.
