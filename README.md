# Canvas Studio

[![CI](https://github.com/2hryul/OneD/actions/workflows/ci.yml/badge.svg)](https://github.com/2hryul/OneD/actions/workflows/ci.yml)

Figma 편집 워크플로를 관찰해 React 컴포넌트 생성까지 연결하는 독립 실험 저장소입니다. 편집기(도형·벡터·Auto Layout·Grid·컴포넌트·프로토타입·협업·플러그인)와 로컬 `.fig` 가져오기, React 코드 내보내기가 구현됐습니다. 제공된 파일의 보기 화면과 구조를 관찰했고, 편집 동작 비교는 편집 가능한 테스트 파일이 필요합니다.

## 실행

```powershell
cd app
npm install
npm run dev
```

`npm run typecheck`, `npm test`, `npm run build`로 검증할 수 있습니다. 같은 검사가 GitHub Actions에서 push·PR마다 돕니다([ci.yml](.github/workflows/ci.yml)). 문서는 브라우저 localStorage에, 이미지는 IndexedDB에 자동 저장하며, JSON 파일 열기·저장, PNG·SVG 내보내기, 선택 요소의 TSX·CSS 파일 묶음(zip) 다운로드를 지원합니다. 협업 서버는 `npm run server`로 띄웁니다.

**Figma 파일 가져오기:** 원본 Figma에서 `파일 → 로컬 복사본 저장`으로 `.fig` 파일을 받은 뒤 앱의 **열기**를 누르고 `.fig`를 선택합니다. 페이지별 프레임 목록에서 고르거나, 프레임의 Figma 링크 또는 `779:23219` 형식의 노드 ID를 입력합니다. 변환은 로컬 브라우저에서 실행됩니다. 계층, 스타일·이미지·그라디언트, Auto Layout·Grid, 마스크, 컴포넌트·variant·override, 컴포넌트 속성, Figma 변수(토큰), 없는 글꼴의 글리프 윤곽을 읽습니다. 인스턴스 교체 속성, 모드별 변수 값, 그라디언트 선 등은 남아 있습니다. 자세한 상태는 [구현 현황](구현현황.md)에 있습니다.

Node 24 이상에서는 CLI로 구조만 빠르게 확인할 수 있습니다: `node --experimental-strip-types scripts/import-fig.mjs <file.fig> <figma-link-or-node-id> [output.json]`.

## 목표

- 디자인 캔버스에서 프레임, 도형, 텍스트, 벡터를 만들고 편집합니다. 현재 다중 선택·회전·스냅·그룹, 펜·불리언·마스크, 레이어·페이지·속성 편집, undo/redo가 구현됐습니다.
- 레이어, 속성, 컴포넌트, variant, 컴포넌트 속성, 토큰을 한 문서 모델에서 관리합니다. 인스턴스 교체 속성과 모드별 토큰 값은 다음 단계입니다.
- 선택한 프레임 또는 요소를 React/TypeScript 코드로 내보냅니다. 현재 flex·grid CSS와 좁은 화면 규칙, 의미 태그·폼 접근성, 텍스트·불리언 props, variant 합치기, 컴포넌트별 파일 분할을 지원합니다. 상태·이벤트 코드와 글꼴 파일 출력은 다음 단계입니다.
- 관찰한 화면과 동작을 근거로 구현하고, 결과를 화면 비교와 기능 검증으로 확인합니다. Figma 원본과의 화면 비교는 아직 하지 못했습니다.

실행 순서와 완료 기준은 [구현 계획](docs/implementation-plan.md)에 있습니다. 현재 동작과 부족한 점은 [구현 현황](구현현황.md)에 정리했습니다. 다른 세션으로 넘길 때는 [아이데이션](아이데이션.md)과 [SPEC](SPEC.MD)부터 읽으세요.

## 사용 도구

- [Craft Anything](https://github.com/storytold/craft-anything) v0.6.1 Windows x64 portable. 공식 릴리스에서 받아 SHA-256을 확인했고 `.tools/`에만 압축을 풀었습니다. `craft-anything-cli doctor`는 정상 종료했습니다.
- `REA 2.0`은 별도 패키지 버전이 아니라 이 프로젝트에서 말하는 조사·구현·검증 접근법으로 취급합니다.

`.tools/`는 Git에 포함하지 않습니다. Craft Anything은 현재 early alpha이며, 웹사이트의 화면 비교는 지원하지만 데스크톱 앱의 동작 비교는 부분 지원입니다. [공식 상태](https://github.com/storytold/craft-anything#status)

## 현재 필요한 입력

[VNPL 디자인 공유 파일](https://www.figma.com/design/REDACTED)을 보기 권한으로 조사했습니다. 편집 동작 비교에는 편집 가능한 테스트 파일이 필요합니다. [관찰 기록](docs/figma-observation.md)에 선택 노드 구조와 가져오기 제약을 적었습니다. 로그인 정보와 내려받은 `.fig` 원본은 이 저장소에 저장하지 않습니다.
