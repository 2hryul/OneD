# 저장 뒤 새로 고침

사용자가 문서를 고치면 브라우저에 자동 저장되어 새로 고침해도 그대로 열리고, **JSON 저장**으로 받은 파일은 다시 열 수 있다.

## Sub-features

- `persist-autosave` 편집이 localStorage `canvas-studio-v1`에 저장되고 새로 고침 뒤 다시 읽힌다.
- `persist-json-save` JSON 저장이 `<문서 이름>.json`을 내려준다(version·pages가 있는 문서).
- `persist-reopen` 내려받은 JSON을 열기로 다시 열 수 있다.
- `persist-recovery` 자동 저장본을 못 읽으면 복구본을 남기고 샘플로 시작한다(여정 없음, `app/tests/storage.test.ts`가 다룸).

## How to get to it (user POV)

- 위쪽 `문서 이름` 입력란이나 캔버스에서 편집 → 자동 저장(상단 점이 "자동 저장됨").
- 위쪽 **JSON 저장** 버튼.
- 브라우저 새로 고침.

## Driving it with run.mjs

Preconditions:

- `doctor.mjs`가 `FAIL` 없이 끝난다.

- **실행.** `node .claude/skills/verify-canvas-studio/harness/run.mjs reload-persist`.
- **편집.** `문서 이름`을 `persist-<시각>`으로 바꾼다. 스크린샷 `01-renamed.png`.
- **JSON 저장.** JSON 저장을 누르면 `persist-<시각>.json`이 내려온다. 파일의 `name`이 바꾼 이름이고 `version`(숫자)과 `pages`(배열)가 있다.
- **새로 고침.** 자동 저장본에 바꾼 이름이 들어간 뒤 페이지를 새로 고친다. `문서 이름`이 그대로이고 `Landing page` 행이 있다. 스크린샷 `02-after-reload.png`.
- **다시 열기.** 이름을 `reset-before-reopen`으로 바꾼 뒤 내려받은 JSON을 열기로 연다. `문서 이름`이 `persist-<시각>`으로 돌아온다. 스크린샷 `03-reopened-download.png`.
- **증거.** `download-persist-<시각>.json`, 스크린샷 3장, `summary.json`.

## Gotchas

- 드래그 중에는 자동 저장을 미룬다(드래그가 끝날 때 한 번). 드래그로 편집했으면 포인터를 놓은 뒤 저장본을 확인한다.
- 자동 저장본은 localStorage라 약 5MB를 넘으면 저장이 실패하고 `자동 저장 공간이 부족합니다…` 알림이 뜬다. 큰 문서(.fig 여러 페이지)로 이 기능을 검증할 때는 그 알림이 없는지도 확인한다.
- 새 컨텍스트는 저장소가 비어 있으므로 이 여정 안에서만 새로 고침을 검증할 수 있다. 다른 여정의 저장본에 기대지 않는다.
