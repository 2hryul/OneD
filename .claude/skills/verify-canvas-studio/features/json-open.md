# JSON 열기

사용자가 위쪽 **열기**로 Canvas Studio JSON 문서를 고르면, 지금 문서가 그 문서로 바뀌고(되돌리기 가능) 화면이 프레임에 맞춰지며 자동 저장본도 그 문서가 된다.

## Sub-features

- `open-json` JSON 파일을 열어 문서 이름·페이지·레이어·캔버스를 바꾼다.
- `open-notice` 상태 표시줄에 `<파일 이름>을(를) 열었습니다.`를 보여 준다.
- `open-autosave` 연 문서가 localStorage `canvas-studio-v1`에 저장된다.
- `open-error` 형식이 틀린 파일은 `열기 실패: …`를 보여 주고 지금 문서를 지킨다(여정 없음).

## How to get to it (user POV)

- 위쪽 도구 막대의 **열기** 버튼 → 파일 선택 창에서 `.json` 고르기.

## Driving it with run.mjs

Preconditions:

- `doctor.mjs`가 `FAIL` 없이 끝난다.
- `fixtures/verify-doc.json`이 있다.

- **실행.** `node .claude/skills/verify-canvas-studio/harness/run.mjs json-open`.
- **열기.** 열기 버튼을 누르고 파일 선택 창에 고정 문서를 넣는다. 상태 표시줄에 `verify-doc.json을(를) 열었습니다.`가 뜬다.
- **이름·페이지.** `문서 이름` 입력란이 `VERIFY 문서`, 페이지 목록에 `Verify page`.
- **레이어.** `Landing page` 행의 `펼치기`를 누르면 `VERIFY Card` 행이 보인다.
- **캔버스.** 캔버스에 `Verify text 검증` 글자가 보인다.
- **저장된 값.** `localStorage['canvas-studio-v1']`의 `name`이 `VERIFY 문서`.
- **증거.** `01-before-open.png`(샘플 문서), `02-after-open.png`(고정 문서), `summary.json`.

## Gotchas

- 연 직후 레이어 목록은 최상위 프레임만 보이고 자식은 접혀 있다. 자식 이름을 찾기 전에 펼친다.
- 상태 표시줄 알림은 다음 동작에서 바뀐다. 열자마자 읽는다.
- JSON 안의 `assets`(base64 그림)는 IndexedDB로 들어간다. 그림이 든 문서를 검증하면 캔버스의 `img`도 확인한다.
