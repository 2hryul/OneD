# Canvas Studio 검증 지도

Canvas Studio 웹 편집기의 사용자 동작을 검증하는 기준 문서다. 앱을 몰기 전에 이 목록을 읽고, 해당 기능 파일을 조작법으로 쓴다.

## 기본 전제

- `node .claude/skills/verify-canvas-studio/harness/run.mjs <journey>`가 `http://127.0.0.1:5179/`에 자기 서버를 띄운다.
- 여정마다 새 브라우저 컨텍스트라 localStorage·IndexedDB가 비어 있고, 첫 화면은 샘플 문서다: 페이지 `Page 1`, 최상위 프레임 `Landing page`, 글자 `Design starts here`, 레이어 6개.
- 고정 문서는 `fixtures/verify-doc.json`이다(`VERIFY 문서`, `Verify page`, `VERIFY Card`, `Verify text 검증`).
- 시작 전에 `doctor.mjs`가 `FAIL` 없이 끝나야 한다.
- 이 실행이 띄우지 않은 서버(사용자의 5173 등)는 사용자가 `--url`로 지시하지 않는 한 몰지 않는다.

## 조작 규칙

- 버튼·입력란은 접근 가능한 이름(`열기`, `JSON 저장`, `React 코드`, `문서 이름`)으로 찾는다.
- 파일은 열기 버튼 → 파일 선택 창으로 넣는다. 내려받기는 실제 다운로드를 저장한다.
- 앱 상태는 UI로만 바꾼다. 저장된 값을 읽을 때만 `page.evaluate`를 쓴다.

## 증명과 건너뜀 보고

- 행동 전후 스크린샷과, 화면 밖의 결과(내려받은 파일 내용, localStorage 자동 저장본, 새로 고침 뒤 값)를 함께 남긴다.
- 증거는 `.verify-evidence/<시각>-<journey>/`에 있고, `summary.json`에 확인 항목별 결과가 있다.
- 전제가 없어 못 돈 여정(예: `.fig` 없음)은 그 이유와 함께 `FAIL`로 보고한다. 다른 경로가 통과했다고 통과로 적지 않는다.

## 기능 파일 형식

각 파일은 H1 제목과 사용자 관점 한 문단으로 시작하고, 다음 H2 네 개를 이 순서로 둔다: `Sub-features`, `How to get to it (user POV)`, `Driving it with run.mjs`, `Gotchas`.

## 기능

- [JSON 열기](./json-open.md): 열기 버튼으로 JSON 문서를 열면 이름·페이지·레이어·캔버스·자동 저장본이 바뀐다. 여정 `json-open`.
- [저장 뒤 새로 고침](./reload-persist.md): 이름을 바꾸고 JSON 저장 → 새로 고침해도 남고, 내려받은 JSON을 다시 열 수 있다. 여정 `reload-persist`.
- [React 코드 zip 내보내기](./code-zip.md): 프레임을 골라 코드 창에서 zip을 받으면 TSX·CSS가 들어 있다. 여정 `code-zip`.
- [.fig 가져오기](./fig-import.md): Figma 로컬 복사본에서 프레임을 골라 가져온다. 저장소 밖의 `.fig`가 필요하다. 여정 `fig-import`.
- [내보낸 코드 품질 측정](./export-quality.md): `test/`의 프레임마다 앱에서 zip을 받아 빌드하고 반응형·태그·픽셀 차이를 재서 목표와 비교한다. 여정 `export-quality`(`all`에는 들지 않는다).
