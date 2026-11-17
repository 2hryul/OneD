# Canvas Studio

Figma 편집 워크플로를 관찰해 React 컴포넌트 생성까지 연결하는 독립 실험 저장소입니다. 첫 편집기 단위와 로컬 `.fig` 가져오기가 구현됐습니다. 제공된 파일의 보기 화면과 구조를 관찰했고, 편집 동작 비교는 편집 가능한 테스트 파일이 필요합니다.

## 실행

```powershell
cd app
npm install
npm run dev
```

`npm run typecheck`, `npm test`, `npm run build`로 검증할 수 있습니다. 브라우저의 로컬 저장소에 자동 저장하며, JSON 파일 열기·저장과 선택 요소의 TSX 다운로드를 지원합니다.

**Figma 파일 가져오기:** 원본 Figma에서 `파일 → 로컬 복사본 저장`으로 `.fig` 파일을 받은 뒤 앱의 **열기**를 누르고 `.fig`를 선택합니다. 이어서 가져올 프레임의 Figma 링크 또는 `779:23219` 형식의 노드 ID를 입력합니다. 변환은 로컬 브라우저에서 실행됩니다. 현재 솔리드 색상, 텍스트, 크기, 계층, 컴포넌트 정의와 일부 override·벡터 경로를 읽습니다. 이미지·그라디언트, 나머지 override·벡터와 정확한 Auto Layout 렌더링은 남아 있으며 코드 출력도 고정 크기 초안입니다.

Node 24 이상에서는 CLI로 구조만 빠르게 확인할 수 있습니다: `node --experimental-strip-types scripts/import-fig.mjs <file.fig> <figma-link-or-node-id> [output.json]`.

## 목표

- 디자인 캔버스에서 프레임, 도형, 텍스트를 만들고 편집합니다. 현재 선택·이동·크기 변경·pan/zoom, 레이어·속성 편집, undo/redo가 구현됐습니다.
- 레이어, 속성, 컴포넌트 및 variant를 한 문서 모델에서 관리합니다. 컴포넌트와 variant는 다음 단계입니다.
- 선택한 프레임 또는 요소를 React/TypeScript 코드로 내보냅니다. 현재 텍스트를 props로 노출하는 고정 크기 초안이며, 반응형 레이아웃과 variant 변환은 다음 단계입니다.
- 관찰한 화면과 동작을 근거로 구현하고, 결과를 화면 비교와 기능 검증으로 확인합니다.

실행 순서와 완료 기준은 [구현 계획](docs/implementation-plan.md)에 있습니다. 다른 세션으로 넘길 때는 [아이데이션](아이데이션.md)과 [SPEC](SPEC.MD)부터 읽으세요.

## 사용 도구

- [Craft Anything](https://github.com/storytold/craft-anything) v0.6.1 Windows x64 portable. 공식 릴리스에서 받아 SHA-256을 확인했고 `.tools/`에만 압축을 풀었습니다. `craft-anything-cli doctor`는 정상 종료했습니다.
- `REA 2.0`은 별도 패키지 버전이 아니라 이 프로젝트에서 말하는 조사·구현·검증 접근법으로 취급합니다.

`.tools/`는 Git에 포함하지 않습니다. Craft Anything은 현재 early alpha이며, 웹사이트의 화면 비교는 지원하지만 데스크톱 앱의 동작 비교는 부분 지원입니다. [공식 상태](https://github.com/storytold/craft-anything#status)

## 현재 필요한 입력

[VNPL 디자인 공유 파일](https://www.figma.com/design/REDACTED)을 보기 권한으로 조사했습니다. 편집 동작 비교에는 편집 가능한 테스트 파일이 필요합니다. [관찰 기록](docs/figma-observation.md)에 선택 노드 구조와 가져오기 제약을 적었습니다. 로그인 정보와 내려받은 `.fig` 원본은 이 저장소에 저장하지 않습니다.
