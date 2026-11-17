# Figma형 디자인 편집기 구현 계획

작성일: 2026-11-17. 대상 저장소: `D:\SOURCE\figma-clone`.

## 구현 원칙

사용자가 접근 가능한 Figma 편집 화면의 공개된 동작을 Craft Anything의 clean-room 모드로 관찰한다. 관찰 자료는 화면, 메뉴, 사용자 동작과 결과에 한정한다. 자체 문서 모델과 UI/렌더러를 구현하고, Figma의 소스·브랜드 자산은 사용하지 않는다. Craft Anything의 공식 안내도 clean-room 모드에서 원본 내부 코드·파일·페이지 소스를 읽지 않는다고 설명한다. [Craft Anything 공식 README](https://github.com/storytold/craft-anything#clean-room-or-deep)

## 작업 흐름

1. **Study:** 테스트용 디자인 파일을 열고 화면별 캡처, 도구별 입력/출력, 단축키, 경계 동작을 기록한다. 첫 관찰 대상은 프레임, 사각형, 타원, 텍스트, 선택, 이동, 크기 변경, 레이어, 속성 편집이다.
2. **Build:** 새 저장소에 React + TypeScript 앱을 만든다. 앱은 자체 도메인 모델을 사용한다. Craft Anything의 자동 빌드는 Codex 계정에서 설정된 모델이 지원되지 않아 중단됐으므로 첫 편집 단위는 직접 구현했다. 원본 접근 후 Craft Anything의 관찰·비교 흐름을 다시 사용한다.
3. **Check:** 같은 작업 시퀀스를 원본과 구현물에서 실행한다. 화면 크기별 캡처와 저장된 문서 구조, 생성 TSX를 비교한다.
4. **Refine:** 차이를 결함으로 기록하고 핵심 작업이 끝까지 성공할 때까지 고친다.

Craft Anything은 Study → Build → Check → Ready 흐름과 웹사이트 3개 너비 화면 비교를 제공하지만 초기 알파다. 코드 에이전트의 실제 변경은 별도 검토한다. [공식 기능·상태](https://github.com/storytold/craft-anything#status)

## 단계별 범위

| 단계 | 구현 범위 | 완료 기준 |
|---|---|---|
| 0. 관찰 | 테스트 파일, 화면 캡처, 작업 시퀀스, 미확인 사항 | 각 핵심 동작에 원본 증거와 재현 단계가 있음 |
| 1. 로컬 편집기 | 무한 캔버스, pan/zoom, 프레임·기본 도형·텍스트, 선택·이동·크기 변경, 레이어 트리, 속성 패널 | 새 문서→요소 배치→수정→저장→재열기가 성공; undo/redo 작동 |
| 2. 레이아웃·재사용 | Auto Layout, 컴포넌트·인스턴스·variant, 디자인 토큰 | 컴포넌트 수정이 인스턴스에 반영되고 override가 유지됨 |
| 3. D2C | 선택한 컴포넌트의 React/TSX, props, 스타일·에셋 내보내기 | 생성물이 독립 프로젝트에서 typecheck/build 통과, variant가 props로 표현됨 |
| 4. 확장 | 벡터 편집, 프로토타입 연결, 협업/버전, 플러그인 | 각 기능별 관찰·성공 조건을 별도 명세로 확정 |

첫 구현 단위는 **로컬 편집기 + 저장/재열기 + React 코드 출력 한 경로**다. 전체 기능 동등성은 단계별로 검증한다. 기능 수가 많으므로 한 번의 생성 결과를 완료로 간주하지 않는다.

## 기술 구조 초안

```text
src/
  model/       문서·노드·컴포넌트·속성 스키마, 명령, undo/redo
  canvas/      좌표계, hit testing, 렌더, 선택 핸들, pan/zoom
  editor/      도구 상태기계와 사용자 입력
  panels/      레이어, 속성, 에셋, 컴포넌트
  export/      문서 모델 → React/TypeScript 코드
  persistence/ 파일 저장/열기와 버전 마이그레이션
```

UI는 React + TypeScript로, 문서 모델은 UI 컴포넌트와 분리한다. 생성 코드에는 디자인과 관련 없는 편집기 상태를 포함하지 않는다. 내보내기 전 타입 검사와 렌더링 비교를 수행한다.

## 필요한 입력과 제약

- **대상 접근:** 사용자가 제공하는 테스트용 Figma 파일 및 편집기 접근. 이 PC에서 현재 Figma 앱이나 로그인된 편집기 탭은 확인되지 않았다.
- **비교 기준:** 최소 프레임/도형/텍스트 작업 시퀀스 하나와 기대 화면, 3개 viewport 너비.
- **출력 정책:** 첫 결과는 독립된 React 컴포넌트 저장소에 내보낸다. 이 앱 자체는 Helm 저장소와 분리한다.
- **AI 실행:** Craft Anything에서 Claude Code는 설치됐지만 로그인되지 않았다. Codex CLI는 로그인돼 있으나 실행 시 계정에서 지원하지 않는 모델 설정(`gpt-6-sol`)로 `model_not_found`가 발생했다. 전역 설정은 수정하지 않았다. 원본 관찰 전 백엔드 연결을 다시 검증한다. [Craft Anything AI 지원 상태](https://github.com/storytold/craft-anything#ai)
- **도구 버전:** Craft Anything v0.6.1, Windows x64 portable. 내부 `.tools/`에 설치하고 Git에는 넣지 않는다.

## 첫 검증 시나리오

1. 1440×900 프레임을 만든다.
2. 프레임 안에 버튼 모양의 사각형과 텍스트를 배치한다.
3. 두 레이어를 선택해 컴포넌트로 만든다.
4. 색상과 텍스트를 바꾼 인스턴스를 만든다.
5. 저장 후 다시 열어 레이어·속성·인스턴스가 유지되는지 확인한다.
6. 버튼을 React 컴포넌트로 내보내고 `label`, `variant`, `disabled` props를 확인한다.

이 시나리오를 완료하기 전에는 실시간 협업과 벡터 네트워크를 구현 완료로 표시하지 않는다.
