---
name: verify-canvas-studio
description: Canvas Studio 웹 편집기(app/, Vite + React)를 설치된 Edge/Chrome으로 사용자처럼 몰아 동작을 증명한다. JSON 열기, 저장 뒤 새로 고침, React 코드 zip 내보내기, .fig 가져오기를 바꿨거나 "실제 앱에서 되는지" 보여야 할 때 쓴다. 스크린샷·내려받은 파일·localStorage 값을 .verify-evidence/에 남긴다.
---

# verify-canvas-studio

Canvas Studio는 브라우저 하나에서 도는 디자인 편집기다. 사용자가 만지는 표면은 **웹 UI**(`app/`, `npm run dev`)뿐이다. 협업 서버(`npm run server`)와 CLI(`app/scripts/import-fig.mjs`)도 있지만 이 스킬은 웹 UI만 몬다.

하네스는 `harness/`의 Node 스크립트다. [playwright-core](https://www.npmjs.com/package/playwright-core)로 **이미 설치된 Edge 또는 Chrome**을 띄운다(브라우저를 내려받지 않는다). 기능별 조작법과 통과 기준은 [features/README.md](features/README.md)에 있다. 고친 기능이 지도에 있으면 그 파일을 먼저 읽는다.

모든 명령은 저장소 루트(`D:\source\figma-clone`) 기준이다. 경로에 `harness/`라고 쓰면 `.claude/skills/verify-canvas-studio/harness/`다.

## Launch

처음 한 번만 의존성을 설치한다.

```bash
cd app && npm ci
cd .claude/skills/verify-canvas-studio/harness && npm ci
```

검증은 `run.mjs`가 시작부터 정리까지 한다. 따로 서버를 띄울 필요가 없다.

```bash
node .claude/skills/verify-canvas-studio/harness/run.mjs <journey>
```

- `journey`: `json-open`, `reload-persist`, `code-zip`, `fig-import`, `export-quality`, `all`(`fig-import`는 `VERIFY_FIG_FILE`이 있을 때만 포함하고, `export-quality`는 `test/`의 샘플이 필요하고 30초쯤 걸려 넣지 않는다).
- 서버: `app/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5179 --strictPort`를 직접 띄운다. 사용자가 쓰는 5173과 겹치지 않는다. 다른 포트가 필요하면 `--port <n>`.
- **준비 기준:** HTML 제목이 `Canvas Studio`이고 `/src/main.tsx`가 200으로 변환되어 나온 뒤, 페이지에서 `문서 이름` 입력란이 보일 때. 30초 안에 안 되면 vite 로그와 함께 실패한다.
- 저장 상태: 여정마다 **새 브라우저 컨텍스트**(빈 localStorage·IndexedDB)라 첫 화면은 항상 앱의 샘플 문서(`Landing page` 프레임, 글자 `Design starts here`)다. 사용자의 브라우저 프로필과 작업을 건드리지 않는다.
- 끝나면 브라우저를 닫고 자기가 띄운 vite PID(와 자식)만 끈다.
- `--headed`: 브라우저 창을 보이게 띄운다. 디버깅용.
- `--url http://127.0.0.1:5173/`: 이미 떠 있는 Canvas Studio를 몬다. 그 서버는 띄우지도 끄지도 않는다. 사용자가 그렇게 하라고 했을 때만 쓴다.

## Doctor

뭔가 이상하면 먼저 실행한다. 읽기 전용이며 아무것도 띄우거나 끄지 않는다.

```bash
node .claude/skills/verify-canvas-studio/harness/doctor.mjs [--port 5179]
```

Node 20 이상, `app/node_modules/vite`, 하네스의 `playwright-core`, Edge/Chrome 경로, `app/package.json`이 `canvas-studio`인지, 포트 5179가 비었는지, 이전 실행이 남긴 서버 기록(`.verify-evidence/server.pid.json`)이 있는지 본다. 5173에 사용자 개발 서버가 있으면 알려만 준다. `FAIL`이 하나라도 있으면 종료 코드 1이다.

브라우저를 못 찾으면 `VERIFY_BROWSER`에 실행 파일 경로를 준다.

## Drive

`run.mjs`의 여정은 사용자 경로만 쓴다.

- 파일 열기는 위쪽 **열기** 버튼을 누르고 뜨는 파일 선택 창에 파일을 넣는다(`filechooser` 이벤트). 숨은 `<input type=file>`에 직접 넣지 않는다.
- 내려받기는 **JSON 저장**·**zip 받기**를 눌러 생기는 실제 다운로드를 저장한다.
- 선택은 왼쪽 레이어 목록의 행을 누른다.

안정적인 손잡이(앱 코드에서 확인한 것):

| 대상 | 선택자 |
|---|---|
| 문서 이름 입력란 | `getByLabel('문서 이름')` |
| 열기 / JSON 저장 / React 코드 | `getByRole('button', { name: '열기', exact: true })`, `{ name: 'JSON 저장' }`, `{ name: 'React 코드' }` |
| 레이어 행 | `.layer-row` 중 `.layer-name` 글자가 정확히 같은 것. 자식은 접혀 있으니 부모 행의 `getByRole('button', { name: '펼치기' })`를 먼저 누른다 |
| 상태 표시줄(알림·레이어 수·선택) | `footer.statusbar` |
| 코드 창 | `.code-modal`, 제목 `header strong`(`<이름>.tsx · <이름>.css`), `getByRole('button', { name: /^zip 받기/ })` |
| .fig 가져오기 창 | `.import-modal`(글자 `Figma 프레임 가져오기`), 프레임 `select`, node-id `input`, `getByRole('button', { name: '가져오기', exact: true })` |
| 가져오기 보고서 | `.report-modal` |
| 자동 저장본 | `localStorage['canvas-studio-v1']`(문서 JSON). 이미지는 IndexedDB |

새 여정이 필요하면 `harness/run.mjs`의 `journeys` 객체에 함수를 하나 더하고, 같은 내용으로 `features/`에 파일을 만든다. 손으로 확인만 할 때는 Claude 앱의 브라우저 창으로 같은 선택자를 따라가도 되지만, 증거는 스크립트 실행으로 남긴다.

## Evidence

증거 폴더: **`.verify-evidence/<UTC시각>-<journey>/`**(저장소 루트, Git 제외).

- `NN-<단계>.png`: 1440×900 스크린샷. 행동 전후를 모두 찍는다.
- `download-<파일 이름>`: 앱이 실제로 내려준 파일(JSON, zip).
- `zip-entries.json`: zip 안의 파일 목록(code-zip).
- `summary.json`: 여정 이름, URL, `PASS`/`FAIL`, 단계별 확인 결과·스크린샷·다운로드 목록.

증명 기준:

- 실제 사용자 경로만 쓴다. 앱 상태를 `page.evaluate`로 바꾸지 않는다. `evaluate`는 저장된 값을 **읽을 때만** 쓴다(자동 저장본 확인).
- 화면만 보지 않는다. 부수 효과도 함께 확인한다: 내려받은 파일의 내용, zip 항목과 TSX 글자, localStorage 자동 저장본, 새로 고침 뒤 다시 읽은 값.
- 페이지 콘솔 오류와 4xx/5xx 응답이 있으면 실패다. 예외는 앱에 favicon이 없어 생기는 `/favicon.ico` 404 한 건뿐이다.
- 목(mock)은 쓰지 않는다. 앱은 네트워크 없이 로컬에서 돈다.
- 결과를 보고할 때 `summary.json`의 `result`와 스크린샷 경로를 함께 적는다. 다른 여정이 통과했다고 건너뛴 여정을 통과로 보고하지 않는다.

## Cleanup

`run.mjs`는 정상·예외 종료 모두에서 자기가 띄운 서버를 끈다. 프로세스가 강제로 끊겨 서버가 남았으면:

```bash
node .claude/skills/verify-canvas-studio/harness/cleanup.mjs
```

`.verify-evidence/server.pid.json`에 적힌 PID와 그 자식만 끈다(Windows `taskkill /PID <pid> /T /F`). **프로세스 이름으로 죽이지 않는다.** 증거 폴더는 지우지 않고, 남아 있는 폴더 목록을 출력한다. 브라우저 컨텍스트는 매번 새로 만들고 닫으므로 지울 저장 상태가 없다.

## Helpers

| 파일 | 실행 | 하는 일 |
|---|---|---|
| `harness/run.mjs` | `node harness/run.mjs <journey> [--port n] [--headed] [--url u]` | 서버 시작 → 여정 → 증거 → 정리. 실패 시 종료 코드 1 |
| `harness/doctor.mjs` | `node harness/doctor.mjs [--port n]` | 읽기 전용 점검 |
| `harness/cleanup.mjs` | `node harness/cleanup.mjs` | 남은 서버만 끄고 증거 목록 출력 |
| `harness/lib.mjs` | (모듈) | 경로, 서버 시작·종료, 브라우저 찾기, zip 목록 읽기 |
| `harness/export-quality.mjs` | `node harness/run.mjs export-quality` (`VERIFY_FIG_DIR`, `VERIFY_FIG_ONLY`) | `test/`의 프레임마다 zip 받기 → 빌드 → 폭별 측정 → 목표 판정 |
| `harness/quality-metrics.mjs` | `node --test harness/export-quality.test.mjs` | zip 풀기, 픽셀 차이, 목표 표와 판정(순수 함수) |
| `fixtures/verify-doc.json` | (데이터) | 앱의 JSON 저장으로 만든 version 5 문서. 이름 `VERIFY 문서`, 페이지 `Verify page`, 레이어 `VERIFY Card`, 글자 `Verify text 검증` |

모델·문서 형식이 바뀌어 고정 문서가 열리지 않으면, `reload-persist`가 내려받은 JSON을 바탕으로 위 네 값만 바꿔 다시 만든다.
