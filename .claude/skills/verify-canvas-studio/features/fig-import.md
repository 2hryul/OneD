# .fig 가져오기

사용자가 Figma에서 **파일 → 로컬 복사본 저장**으로 받은 `.fig`를 열기로 고르면, 가져오기 창에서 프레임을 고르거나 링크·node-id를 넣어 그 프레임과 참조 컴포넌트를 편집기 문서로 가져온다. 변환은 브라우저 안에서만 돈다.

## Sub-features

- `fig-parse` `.fig`를 열면 가져오기 창이 뜨고 페이지별 프레임 목록이 나온다(하나뿐이면 미리 골라짐).
- `fig-pick` 목록에서 고르거나 Figma 링크·`779:23219` 형식 node-id를 넣는다.
- `fig-import` 가져오기를 누르면 창이 닫히고 문서가 바뀌며, 상태 표시줄에 `N개 요소 · 인스턴스 … · override …` 요약이 뜬다.
- `fig-report` 미지원·근사 항목이 있으면 가져오기 보고서 창(`.report-modal`)이 뜨고 JSON으로 받을 수 있다.
- `fig-autosave` 가져온 문서가 자동 저장본이 된다.

## How to get to it (user POV)

- 위쪽 **열기** → 파일 선택 창에서 `.fig` → `Figma 프레임 가져오기` 창 → 프레임 고르기 또는 링크·node-id 입력 → **가져오기**.

## Driving it with run.mjs

Preconditions:

- `doctor.mjs`가 `FAIL` 없이 끝난다.
- 환경 변수 `VERIFY_FIG_FILE`에 저장소 **밖**의 `.fig` 경로가 있다. 선택적으로 `VERIFY_FIG_NODE`에 node-id나 링크(없으면 목록의 첫 프레임).

- **실행.** PowerShell: `$env:VERIFY_FIG_FILE = 'C:\path\file.fig'; node .claude/skills/verify-canvas-studio/harness/run.mjs fig-import`. bash: `VERIFY_FIG_FILE=/c/path/file.fig node .claude/skills/verify-canvas-studio/harness/run.mjs fig-import`.
- **열기.** 열기 버튼으로 `.fig`를 넣으면 `.import-modal`이 뜨고 프레임 목록이 1개 이상.
- **고르기.** `VERIFY_FIG_NODE`가 있으면 입력란에 넣고, 없으면 첫 프레임을 고른다. 스크린샷 `01-fig-modal.png`.
- **가져오기.** 가져오기를 누르면 창이 닫히고 상태 표시줄에 요약(`개 요소 · 인스턴스 … override`)이 뜨며 레이어 수가 바뀐다. 보고서 창이 뜨면 `02-import-report.png`.
- **저장된 값.** 자동 저장본이 1,000자를 넘는 문서로 바뀐다.
- **증거.** 스크린샷, `summary.json`.

## Gotchas

- **원본 `.fig`는 저장소에 없다**(`.gitignore`가 `*.fig` 제외, 사용자 디자인 데이터). `VERIFY_FIG_FILE`이 없으면 이 여정은 이유와 함께 `FAIL`이고, `all`은 이 여정을 빼고 돈다. 2026-11-24 스킬을 만들 때는 파일이 없어 이 여정을 끝까지 돌리지 못했다.
- `.fig`와 그 스크린샷은 사용자 디자인이다. 증거 폴더(`.verify-evidence/`, Git 제외) 밖으로 복사하거나 커밋하지 않는다.
- 큰 파일(50MB, 2만 노드)은 해석에 수십 초 걸릴 수 있다. 창 대기 60초, 가져오기 대기 120초다.
- 가져온 문서가 크면 localStorage 한도를 넘어 `자동 저장 공간이 부족합니다…`가 뜰 수 있다. 그때 `fig-autosave` 확인은 실패해야 맞다.
- 가져오기 뒤 글꼴이 PC에 없으면 글리프 윤곽으로 그려진다. 화면 비교 시 글꼴 차이를 버그로 보기 전에 이 동작을 고려한다.
