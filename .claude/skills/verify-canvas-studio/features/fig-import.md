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
- **고르기.** `VERIFY_FIG_NODE`가 있으면 입력란에 넣고(이때는 목록이 비어도 된다), 없으면 첫 프레임을 고른다. 스크린샷 `01-fig-modal.png`.
- **가져오기.** 가져오기를 누르면 창이 닫히고 상태 표시줄에 요약(`개 요소 · 인스턴스 … override`)이 뜨며, 레이어 수와 `문서 이름`(`<노드 이름> (<node-id>)`)이 바뀐다. 보고서 창이 뜨면 `02-import-report.png`.
- **저장된 값.** 자동 저장본의 `name`이 가져온 문서 이름과 같다(그림은 IndexedDB로 가므로 저장본 길이로는 판단하지 않는다).
- **증거.** 스크린샷, `summary.json`.

## Gotchas

- **원본 `.fig`는 저장소에 없다**(`.gitignore`가 `*.fig` 제외, 사용자 디자인 데이터). `VERIFY_FIG_FILE`이 없으면 이 여정은 이유와 함께 `FAIL`이고, `all`은 이 여정을 빼고 돈다.
- 공개 샘플은 파서 저장소 `OpenFig-org/openfig-core`의 `test-fixtures/`에 있다(라이선스 파일 없음, 저장소 밖에 받아 로컬 시험에만 쓴다). 2026-11-24 확인: `OpenFigs.fig`(48KB, 프레임 1개) PASS. `vector-network/coloradjusted.fig`(2.2MB)는 페이지 맨 위가 프레임이 아닌 `ROUNDED_RECTANGLE`(id `1:2`, 색 보정한 그림 채우기)뿐이다. 브랜치 `fix/fig-import-frameless-paintfilter` 이후로는 `VERIFY_FIG_NODE` 없이도(후보 목록의 `1:2`를 고름), `VERIFY_FIG_NODE=1:2`로도 PASS이고 보고서에 `근사한 그림 색 보정 (1)`이 뜬다. 그 전 코드에서는 node-id 없이 `FAIL`이 맞다.
- 로컬 샘플 모음은 저장소의 `test/` 폴더다(`*.fig`는 Git 제외라 각자 받아 둔다). 위 두 파일 말고 웹 디자인 세 개를 둔다(모두 라이선스 파일 없음, 로컬 시험용): `web-burger-landing.fig`(devyani1430/burger_buzz_figma, 프레임 1개), `web-developer-portfolio.fig`(ProgrammingHero1/portfolio-resources, 1600×4256 프레임), `web-urban-riders.fig`(ProgrammingHero1/urban-riders, ZIP 없는 예전 형식, 프레임 5개). 2026-11-24 다섯 파일 모두 PASS. 같은 이름의 GitHub 웹 페이지(HTML)를 `.fig`로 저장한 가짜 파일이 흔하니 받은 뒤 첫 바이트가 `PK` 또는 `fig-kiwi`인지 본다.
- 예전 로컬 복사본은 ZIP 없이 canvas 데이터(첫 8바이트 `fig-kiwi`)만 있다. `readFigFile`이 형식을 보고 `parseFigBinary`로 연다. 이 형식에는 그림이 없어 그림 채우기는 `이미지 없음`으로 보고된다.
- 목록은 페이지 맨 위(또는 SECTION 안)의 FRAME·COMPONENT·INSTANCE·GROUP 등을 보여 준다. 맨 위에 프레임이 하나도 없으면 노란 안내 문구(`.import-notice`, "페이지 맨 위에는 프레임이 없습니다")가 뜨고, 목록은 `페이지 맨 위 도형 (N개)`로 바뀌어 도형·벡터·텍스트를 `이름 · 종류 · 크기 · id`로 보여 준다(하나뿐이면 미리 골라짐). 그래서 "목록 1개 이상" 확인은 프레임이 아니라 도형 후보로 통과할 수 있다.
- 그림 채우기의 색 보정(`paintFilter`)은 근사다. 값을 -1..1로 자른 뒤 노출·밝기→`brightness(2^노출 × (1+밝기))`, 대비→`contrast(1+값)`, 채도(스키마의 `vibrance`)→`saturate(1+값)`로 바꿔 그림 채우기의 `adjust`에 담고, 보고서에 `image-adjust-approximated`(표현 못 한 색온도·틴트·하이라이트·그림자·디테일·비네트 수치를 함께 적음)를 남긴다. 근사할 항목이 없으면 `image-adjust-unsupported`. 원본 Figma와 색이 똑같지는 않다.
- 보정은 그림에만 걸린다. DOM 렌더러는 그림을 `.fill-layer` span에, React 내보내기는 `::before` 겹(요소는 `isolation: isolate`, 보정한 그림은 `img` 대신 `role="img"`)에 그리고 그 겹에만 `filter`를 건다. Canvas 렌더러·PNG·SVG는 그 그림 겹에만 건다(Canvas는 레이어 흐림 뒤에 이어 붙임). 그래서 선·그림자·자식은 어느 렌더러에서도 보정되지 않는다. 채우기가 여러 겹인 도형 속 그림은 DOM·React에서 보정이 빠지고, 보고서에 그렇게 적힌다.
- "이미지 바꾸기"로 그림을 바꿔도 원래 그림의 `adjust`가 남는다(패널에서 보거나 끌 수 없음). 의도된 동작인지 정하지 않았다.
- 가져오기 보고서 창도 `class="import-modal report-modal"`이다. 가져오기 창을 기다릴 때는 `.import-modal`만으로 찾지 말고 `hasText: 'Figma 프레임 가져오기'`로 좁힌다(안 그러면 보고서 창을 가져오기 창으로 착각해 닫힘 대기가 끝나지 않는다).
- `.fig`와 그 스크린샷은 사용자 디자인이다. 증거 폴더(`.verify-evidence/`, Git 제외) 밖으로 복사하거나 커밋하지 않는다.
- 큰 파일(50MB, 2만 노드)은 해석에 수십 초 걸릴 수 있다. 창 대기 60초, 가져오기 대기 120초다.
- 가져온 문서가 크면 localStorage 한도를 넘어 `자동 저장 공간이 부족합니다…`가 뜰 수 있다. 그때 `fig-autosave` 확인은 실패해야 맞다.
- 가져오기 뒤 글꼴이 PC에 없으면 글리프 윤곽으로 그려진다. 화면 비교 시 글꼴 차이를 버그로 보기 전에 이 동작을 고려한다.
- 글리프 윤곽 blob은 2차 곡선(명령 3)을 쓰고 윤곽마다 닫기(0)로 시작한다. openfig-core 0.4.1의 `geometryBlobToSVGPath`는 2차 곡선을 몰라 `Z M…`만 남기므로 `glyphs.ts`의 `glyphBlobToPath`가 직접 읽는다. 콘솔에 `<path> attribute d: Expected moveto path command ("Z M…")`가 보이면 이 경로가 깨진 것이다(이전 버전이 저장한 윤곽은 그리지 않고 대체 글꼴로 그린다).
