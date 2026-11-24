# 내보낸 코드 품질 측정

퍼블리셔와 개발자가 Figma 디자인을 Canvas Studio로 받아 웹 화면 코드로 쓸 때의 품질을 숫자로 잰다. `test/`(또는 `VERIFY_FIG_DIR`)의 `.fig` 프레임마다 실제 앱 흐름으로 React zip을 받아 빌드하고, 화면 폭별 배치와 태그, 편집기 대비 픽셀 차이를 재서 [역할별 만족도 개선 계획](../../../../doc/계획_역할별만족도_20261124.md)의 목표와 비교한다.

## Sub-features

- `eq-flow` 프레임마다 열기 → 가져오기(node-id) → React 코드 → zip 받기를 앱에서 그대로 한다. 가져오기 창 목록의 프레임을 모두 돈다.
- `eq-build` 받은 zip을 바이트 그대로 풀어 strict `tsc`(앱과 같은 설정)와 esbuild로 빌드한다. 패키지는 `app/node_modules`를 빌려 쓴다.
- `eq-layout` 1440·768·375px에서 화면 밖 요소 수와 비율, 글자 넘침 수, 가로 스크롤 폭, 태그 수(`h1`~`h3`, `input`, `textarea`, `button`, `a`, `img`, `nav`, `header`, `footer`)를 잰다.
- `eq-pixel` 디자인 폭으로 띄운 내보낸 화면과 편집기 100% 화면(DOM 렌더러)의 픽셀 차이(채널 차이 32 초과 비율)와 차이 이미지를 남긴다.
- `eq-targets` 목표 표로 달성·미달·측정 안 됨을 판정한다. 목표 미달은 여정 실패가 아니다. 측정을 끝내지 못한 프레임만 실패다.

## How to get to it (user POV)

- 퍼블리셔가 하는 일과 같다. 위쪽 **열기** → `.fig` → 가져오기 창에서 프레임 → **가져오기** → 보고서 **닫기** → **React 코드** → **zip 받기** → 압축을 풀어 프로젝트에서 빌드하고 화면 폭을 바꿔 본다.

## Driving it with run.mjs

Preconditions:

- `doctor.mjs`가 `FAIL` 없이 끝난다.
- `test/`에 `.fig`가 있다(`*.fig`는 Git 제외라 각자 둔다. 목록과 출처는 [fig-import.md](./fig-import.md)).
- `app/node_modules`가 설치되어 있다(typescript, esbuild, react를 빌려 쓴다).

- **실행.** `node .claude/skills/verify-canvas-studio/harness/run.mjs export-quality`. 일부만 재려면 `VERIFY_FIG_ONLY="urban-riders.fig#1:2"`처럼 프레임 키(`파일#node-id`) 일부를 준다. 폴더는 `VERIFY_FIG_DIR`로 바꾼다.
- **프레임마다.** `<증거>/<파일_node-id>/`에 zip, 푼 `src/`, `dist/`, `editor.png`, `export-1440.png`·`export-768.png`·`export-375.png`, `export-design.png`, `diff.png`, `metrics.json`이 생긴다.
- **전체.** `<증거>/metrics.json`(프레임별 지표)과 `<증거>/targets.json`(목표 판정), 콘솔 끝에 `결과: N/M 목표 달성`.

**목표** (계획 Appendix D와 같다. 코드는 `harness/quality-metrics.mjs`의 `TARGETS`)

| 목표 | 대상 프레임 | 기준 |
|---|---|---|
| 375px 화면 밖 요소 비율 | 포트폴리오, Urban Login·Create account·Search `1:95` | 5% 이하 |
| strict tsc와 빌드 | 모든 프레임 | 성공 |
| 편집기 대비 픽셀 차이 | 위 네 화면과 버거 | 3% 이하 |
| 1440px 글자 넘침 | 버거 | 0 |
| 화면당 `h1` | 모든 프레임 | 1 이하 |
| TSX 줄 수 | Urban MacBook Pro `1:364` | 300 이하 |

**2026-11-24 기준값** (`main` `7e6e77b`, 전체 실행). 375px 화면 밖은 버거 31/31, 포트폴리오 125/156, Login 49/55. 픽셀 차이 0~6.8%. 9개 프레임 모두 빌드 성공. 포트폴리오 `h1` 9개, MacBook TSX 4,944줄.

## Gotchas

- 내보낸 화면은 디자인 글꼴을 불러오지 않는다(지금의 zip이 그렇다). 픽셀 차이와 글자 넘침에는 대체 글꼴의 차이가 그대로 들어간다. PR-5 뒤에는 `fonts.css`를 불러온 값이 된다.
- 편집기 화면은 DOM 렌더러로 찍는다. 글꼴이 없으면 편집기는 글리프 윤곽으로 그리므로 Figma 모양에 가깝고, 내보낸 화면과의 차이는 대부분 글자다.
- 화면 밖 요소는 폭이 있는 요소 중 오른쪽이 화면 폭을 넘거나 왼쪽이 0보다 작은 것이다. 루트가 `overflow: hidden`이라 가로 스크롤이 없어도 잘린 요소가 많을 수 있다.
- 프레임 키의 node-id가 파일마다 겹친다(`#1:2`는 버거와 Urban 모두에 있다). `VERIFY_FIG_ONLY`에는 파일 이름을 함께 준다.
- 전체 실행(9개 프레임)은 2026-11-24 이 PC에서 중앙값 32초다. 가장 큰 프레임(요소 4,302개)이 그중 약 10초다. 일부만 잴 때 대상이 빠진 목표는 `측정 안 됨`이다.
- 같은 코드에서 세 번 돌린 지표는 모두 같았다. 기다림은 고정 시간이 아니라 조건(글꼴 준비, 두 프레임, 코드 창의 그림 확장자)으로 한다. 고정 대기를 다시 넣으면 실행 시간이 두 배가 된다(처음 버전 75초).
- 배경이 투명한 프레임(OpenFigs 아이콘)은 편집기 캔버스 색이 비쳐 픽셀 차이가 65%로 나왔다. 편집기 화면은 캔버스를 흰색으로 바꿔 찍는다.
