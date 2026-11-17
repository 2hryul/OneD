# Canvas Studio

Figma 편집 워크플로를 관찰해 React 컴포넌트 생성까지 연결하는 독립 실험 저장소입니다. 현재 첫 편집기 단위가 구현됐으며, 실제 Figma 편집기와의 화면·동작 비교는 테스트 파일을 기다리고 있습니다.

## 실행

```powershell
cd app
npm install
npm run dev
```

`npm run typecheck`, `npm test`, `npm run build`로 검증할 수 있습니다. 브라우저의 로컬 저장소에 자동 저장하며, JSON 파일 열기·저장과 선택 요소의 TSX 다운로드를 지원합니다.

## 목표

- 디자인 캔버스에서 프레임, 도형, 텍스트를 만들고 편집합니다. 현재 선택·이동·크기 변경·pan/zoom, 레이어·속성 편집, undo/redo가 구현됐습니다.
- 레이어, 속성, 컴포넌트 및 variant를 한 문서 모델에서 관리합니다. 컴포넌트와 variant는 다음 단계입니다.
- 선택한 프레임 또는 요소를 React/TypeScript 코드로 내보냅니다. 현재 텍스트를 props로 노출하는 고정 크기 초안이며, 반응형 레이아웃과 variant 변환은 다음 단계입니다.
- 관찰한 화면과 동작을 근거로 구현하고, 결과를 화면 비교와 기능 검증으로 확인합니다.

실행 순서와 완료 기준은 [구현 계획](docs/implementation-plan.md)에 있습니다.

## 사용 도구

- [Craft Anything](https://github.com/storytold/craft-anything) v0.6.1 Windows x64 portable. 공식 릴리스에서 받아 SHA-256을 확인했고 `.tools/`에만 압축을 풀었습니다. `craft-anything-cli doctor`는 정상 종료했습니다.
- `REA 2.0`은 별도 패키지 버전이 아니라 이 프로젝트에서 말하는 조사·구현·검증 접근법으로 취급합니다.

`.tools/`는 Git에 포함하지 않습니다. Craft Anything은 현재 early alpha이며, 웹사이트의 화면 비교는 지원하지만 데스크톱 앱의 동작 비교는 부분 지원입니다. [공식 상태](https://github.com/storytold/craft-anything#status)

## 현재 필요한 입력

실제 편집기 조사를 위해 사용자가 열 수 있는 테스트용 Figma 파일 또는 편집기 세션이 필요합니다. 로그인 정보는 이 저장소에 저장하지 않습니다.
