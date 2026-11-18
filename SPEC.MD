# Canvas Studio SPEC

> 구현·검증 인계 문서. 기준일 2026-11-17. 제품 배경과 결정 이유는 [아이데이션.md](아이데이션.md), 실제 Figma 관찰값은 [docs/figma-observation.md](docs/figma-observation.md)를 참조한다.

## 1. 범위와 현재 상태

**목표:** Figma형 로컬 디자인 편집기에서 디자인을 만들거나 `.fig` 프레임을 가져와 편집하고, 선택한 결과를 재사용 가능한 React/TypeScript 컴포넌트로 내보낸다.

**저장소:** `D:\SOURCE\figma-clone`, 브랜치 `codex/figma-clone`. 이 문서 작성 전 기준 커밋 `ea6d203`; 시작 시 `git status`로 새 변경을 확인한다. 기존 `D:\SOURCE\aiBrowser`와 분리된 Git 저장소다.

**구현됨:** 캔버스 pan/zoom, 프레임·사각형·타원·텍스트 생성, 선택·이동·크기 변경, 레이어 목록, 속성 편집, undo/redo, localStorage 자동 저장, JSON 열기·저장, `.fig` 선택 노드 가져오기, 선택 요소의 TSX 출력. 가져온 벡터 일부는 SVG 경로로 표시한다.

**미완료:** Figma 편집기 전체 기능 동등성, 정확한 Auto Layout, 컴포넌트·variant 편집, 모든 override·에셋·도형 복원, 의미 있는 props와 반응형 코드 출력, 원본과의 정량 화면 비교.

### 1.1 첫 실제 입력

- 파일: [VNPL 디자인 공유](https://www.figma.com/design/REDACTED), 파일 키 `REDACTED`, 대상 노드 `779:23219` (`Contents`).
- Figma 파일은 **보기 권한**이다. 원본의 편집 동작은 아직 검증하지 못했다.
- 내려받은 로컬 `.fig`는 사용자의 Downloads 폴더에 있을 수 있다. 코드와 테스트는 그 경로에 의존하지 않으며 Git에도 포함하지 않는다.
- 실제 파일 파싱 기준: 전체 20,709노드/이미지 126개. 선택 노드의 원본 하위 103노드/인스턴스 27개. 현재 가져오기 결과는 227노드/펼친 인스턴스 45개/override 54개 적용·38개 미적용/도형 20개 근사.
- 2026-11-18 방안 A 3단계 이후 가져오기 결과: 227노드, 펼친 인스턴스 45개, override 91개 적용·1개 미적용(`textData`, 경로에 맞는 노드 없음), 근사 도형 0개. 미적용이던 37개는 컴포넌트 루트를 가리키는 override였고, 근사 도형 20개는 `vectorData`(벡터 네트워크)로 복원했다.
- 2026-11-18 방안 A 4단계: 가져온 Auto Layout 컨테이너를 레이아웃 엔진으로 다시 계산한 결과가 Figma가 파일에 저장한 위치·크기와 0.5px 안에서 모두 일치했다(Contents 103개 컨테이너·자식 186개, Mobile-Partners·Main·Switch 포함 자식 732개). 인스턴스 안쪽은 `derivedSymbolData`(Figma가 인스턴스 크기로 다시 계산해 저장한 값)를 적용해 맞췄다.
- 2026-11-18 방안 A 5단계: 숨긴 노드까지 가져오도록 바꾼 뒤 Contents 가져오기는 409개 요소, 인스턴스 76개, override 105개 적용·0개 미적용, 보고 항목 0개다. 쓰인 컴포넌트 137개(variant 포함)를 Components 페이지에 메인으로 만들고 인스턴스 198개를 연결했으며, 채우기 스타일 39개를 색 토큰으로 만들었다. 메인 34개를 각각 고쳐도 Page 1의 도형은 움직이지 않았다.
- 2026-11-18 방안 A 6단계: 펜 도구(P)로 벡터를 그리고, 벡터를 더블클릭(또는 Enter)해 점·핸들을 옮기고 넣고 지울 수 있다. 사각형·타원·가져온 벡터는 같은 모양의 경로로 바꿔 편집한다. 여러 요소를 합치기·빼기·교차·제외 불리언 그룹으로 묶으면 피연산자를 고칠 때마다 결과가 다시 계산되고, Ctrl+E로 경로 하나로 평탄화한다.
- 2026-11-18 방안 A 7단계: 오른쪽 패널 프로토타입 탭에서 요소에 클릭·마우스 들어옴·마우스 나감·지연 트리거와 화면 이동·오버레이 열기/토글/닫기·뒤로·URL 열기 동작을 연결하고, ▶ 보기(Ctrl+Alt+Enter)로 실행한다. 보기 모드는 화면을 너비에 맞춰 그리고 길면 스크롤하며, '스크롤할 때 위치 고정' 자식은 제자리에 남는다(Figma에서 가져온 GNB 포함).
- 2026-11-18 방안 A 8단계: 협업 서버(`npm run server`)에 계정을 만들고 문서를 공유 파일로 올리면, 같은 파일을 연 사람들의 변경이 서버가 정한 순서로 모두에게 적용된다. 참여자 얼굴·커서, 캔버스 위치 코멘트(답글·해결·삭제), 이름 붙인 버전 저장·복원이 있다.
- 2026-11-18 방안 A 9단계: 보이는 도형이 3,000개를 넘으면 Canvas 렌더러(보이는 영역만 그림, 최상위 프레임 그림 보관)로 자동 전환한다(상태 표시줄에서 DOM·Canvas 고정 가능). 도형 20,400개 문서에서 화면 이동 한 프레임이 DOM 63ms → Canvas 16ms다. 플러그인은 격리된 iframe에서 `canvasStudio` API로 문서를 읽고 고친다([app/plugins/README.md](app/plugins/README.md)).
- 2026-11-18 기본 편집 보강: 복사·잘라내기·붙여 넣기(시스템 클립보드, 다른 프로그램의 글·그림 붙여 넣기 포함), 복제(Ctrl+D), 전체 선택(Ctrl+A), 정렬 6종·간격 맞추기(Alt 단축키), 선택 영역 PNG(1·2·3배)·SVG 내보내기(Ctrl+Shift+E).

## 2. 사용자 흐름과 기능 계약

| ID | 기능 | 현재 | 완료 조건 |
|---|---|---|---|
| F-01 | 로컬 디자인 생성·편집 | 부분 구현 | 프레임→요소 추가→이동·크기·색·텍스트 변경→undo/redo가 끝까지 동작하고 재열기 후 유지된다. |
| F-02 | `.fig` 프레임 선택 가져오기 | 부분 구현 | `.fig`와 Figma 링크의 `node-id`로 대상 하위 트리를 읽는다. 지원·미지원 요소 수를 보여주고 임의의 다른 노드도 선택할 수 있다. |
| F-03 | 계층·페이지·레이어 | 부분 구현 | 중첩 계층, 표시/숨김, 순서, 그룹/프레임, 페이지 전환을 보존하고 캔버스와 동기화한다. |
| F-04 | 레이아웃 | 메타데이터만 일부 수집 | 방향, gap, padding, fixed/hug/fill, 정렬, 제약을 캔버스와 TSX/CSS에 일관되게 적용한다. |
| F-05 | 컴포넌트·인스턴스·variant | 가져오기 시 정의 펼치기만 지원 | 정의 수정이 인스턴스에 반영되고 override·variant가 편집·저장·코드 생성에서 유지된다. |
| F-06 | 스타일·에셋 | 솔리드 색상·텍스트·일부 SVG 지원 | 이미지, 그라디언트, 벡터, 폰트, stroke/effect와 토큰을 원본에 가깝게 표시하고 출력한다. |
| F-07 | 저장·재열기 | JSON·localStorage 구현 | 큰 파일도 실패 원인을 알 수 있고, 저장 후 계층·속성·컴포넌트 관계가 손실되지 않는다. |
| F-08 | React 코드 생성 | 고정 좌표 초안 | 독립 프로젝트에서 타입 검사·빌드가 통과하며 텍스트/상태/variant가 안정적인 props가 되고, 레이아웃과 에셋이 코드에 반영된다. |
| F-09 | 원본 대비 검증 | 구조 관찰만 수행 | 동일 작업 시퀀스와 viewport에서 Figma·Canvas Studio·생성 React 화면을 비교하고 차이를 기록한다. |

`F-02`의 URL은 노드를 지정하는 입력이다. 현재 구현은 URL만으로 Figma 서버에서 디자인 데이터를 가져오지 않는다. 사용자가 저장한 `.fig`가 필요하다.

## 3. 데이터 모델

현재 [model.ts](app/src/model.ts)의 `DesignDocument`는 `version: 5`, 이름, `pages[]`, `components`(메인 컴포넌트 등록), `tokens`(색·숫자 디자인 토큰)로 구성된다(2026-11-18 방안 A 1·3·4·5단계). 컴포넌트는 메인 루트(`componentId`·`mainInstance`)와 인스턴스(`componentId`, 하위 도형마다 `shapeRef`, 사용자가 바꾼 속성 묶음 `touched`)로 표현하고, 메인 변경은 touched가 아닌 묶음만 인스턴스에 동기화한다. variant는 세트 프레임(`componentSet`)과 컴포넌트별 속성 값으로 표현한다. 프레임은 `layout`(Flex: 방향·줄바꿈·간격·여백·정렬)을, 자식은 `item`(fix·fill·auto 크기, min·max, absolute)과 `constraints`(left·right·center·left-right·scale)를 가진다. 편집할 때마다 레이아웃이 다시 계산되고 같은 undo 단위에 들어간다. 노드 스타일은 `fills`(단색·선형·원형·이미지), `strokes`, `effects`, 텍스트 정렬·줄 높이·자간·구간 스타일(`spans`)이다. 이미지 바이트는 IndexedDB에 두고 문서에는 이미지 해시만 둔다. 벡터는 편집 경로 `path`(하위 경로마다 닫힘 여부와 점·베지어 핸들, 도형 지역 좌표)를 가질 수 있고, 가져온 벡터는 원래 경로 좌표계 `viewBox`를 둔다. 불리언 그룹은 `boolOp`(union·subtract·intersect·exclude)를 가진 그룹이며 결과 경로를 `path`에 계산해 둔다(짝홀 규칙 `fillRule: 'evenodd'`). 프로토타입은 노드의 `interactions`(트리거·지연·동작, 목적지는 같은 페이지의 최상위 프레임 id)와 `fixedScroll`로 표현하고, 컴포넌트 동기화 묶음 `prototype`에 든다. version 1·2 JSON은 읽을 때 변환한다. 페이지는 `objects`(id → 노드)와 최상위 순서 `children`을 갖고, 프레임 노드는 자식 순서 `children`을 갖는다. 노드는 `id`, `parentId`, 유형(`frame`, `rectangle`, `ellipse`, `text`, `vector`), 페이지 절대 좌표, 크기, 2×3 `transform`, 채우기와 유형별 속성을 가진다. 편집은 [changes.ts](app/src/changes.ts)의 변경 목록(`addObj`, `modObj`, `delObj`, `movObjects`, `setDocument`)과 역변경의 쌍으로 표현하고, undo 기록도 이 쌍을 저장한다. version 1 JSON은 읽을 때 version 2로 변환한다.

다음 모델 확장에서는 아래 개념을 구분한다.

| 개념 | 필요한 이유 |
|---|---|
| 문서/페이지 | 여러 페이지와 독립 캔버스 관리 |
| 노드/계층 | 위치·순서·가시성과 부모 관계의 단일 기준 |
| 레이아웃 규칙 | 좌표 대신 Auto Layout·hug/fill·정렬 표현 |
| 컴포넌트 정의/인스턴스 | 같은 디자인 재사용과 원본 변경 전파 |
| override/variant | 인스턴스별 내용·상태 차이 유지 |
| 스타일 토큰/에셋 | 일관된 색·글꼴·이미지와 React 출력 |

스키마 변경 시 문서 버전을 올리고 기존 JSON을 읽는 마이그레이션을 제공한다. 인스턴스를 단순히 복제한 프레임으로만 저장하면 원본과의 연결이 사라지므로 `F-05` 이전에 관계 모델을 정한다.

## 4. 처리 경계와 파일 위치

| 파일 | 현재 역할 |
|---|---|
| [app/src/App.tsx](app/src/App.tsx) | 편집기 상태, 포인터·키보드 조작, 히스토리, 파일 열기 |
| [app/src/canvas.tsx](app/src/canvas.tsx) | 트리 그대로 중첩한 캔버스 렌더, 선택 상자·핸들·정렬선·사각형 선택 |
| [app/src/panels.tsx](app/src/panels.tsx) | 페이지 목록, 레이어 트리(숨김·잠금·끌어서 순서 변경), 속성 패널 |
| [app/src/changes.ts](app/src/changes.ts) | 변경·역변경 쌍, 이동·크기·회전·그룹·페이지 편집, 그룹 상자 보정, undo 기록 병합 |
| [app/src/geometry.ts](app/src/geometry.ts), [selection.ts](app/src/selection.ts), [snapping.ts](app/src/snapping.ts) | 행렬·핸들 계산, 선택 대상·프레임 판정, 스냅 |
| [app/src/components.ts](app/src/components.ts), [normalize.ts](app/src/normalize.ts), [componentPanels.tsx](app/src/componentPanels.tsx), [assetsPanel.tsx](app/src/assetsPanel.tsx) | 컴포넌트·인스턴스·variant·토큰 편집과 동기화, 편집 뒤 보정 순서, 컴포넌트·토큰 패널 |
| [app/src/layout.ts](app/src/layout.ts), [layoutEdits.ts](app/src/layoutEdits.ts), [layoutPanels.tsx](app/src/layoutPanels.tsx), [figLayout.ts](app/src/figLayout.ts) | Flex 레이아웃 엔진과 제약, 편집 후 재배치·끌어 놓기 순서, 레이아웃 패널, Figma Auto Layout 변환 |
| [app/src/path.ts](app/src/path.ts), [boolean.ts](app/src/boolean.ts), [pathTools.tsx](app/src/pathTools.tsx) | 경로 수학(SVG 변환·곡선 분할·상자), 불리언 연산(polygon-clipping), 펜·경로 편집 도우미와 오버레이, 불리언·경로 패널 |
| [app/src/prototype.ts](app/src/prototype.ts), [viewer.tsx](app/src/viewer.tsx), [prototypePanels.tsx](app/src/prototypePanels.tsx) | 보기 모드 상태 전이(화면 이동·오버레이·뒤로)와 클릭 대상 찾기, 보기 모드 화면, 프로토타입 패널과 연결선 |
| [app/server](app/server) | 협업 서버: 설정(.env)·로그(마스킹, 30일 보관)·계정(scrypt)·파일 방(변경 순서·검증·코멘트·버전)·HTTP API·WebSocket |
| [app/src/collab.ts](app/src/collab.ts), [useCollab.ts](app/src/useCollab.ts), [collabPanels.tsx](app/src/collabPanels.tsx), [collabTypes.ts](app/src/collabTypes.ts) | 협업 클라이언트(확정 문서 + 대기 변경 다시 얹기, 재연결), 공유 대화상자·참여자·코멘트·커서 화면, 서버와 공유하는 메시지 타입 |
| [app/src/canvasRenderer.ts](app/src/canvasRenderer.ts), [canvasView.tsx](app/src/canvasView.tsx), [hitTest.ts](app/src/hitTest.ts), [largeDoc.ts](app/src/largeDoc.ts) | Canvas 2D 렌더러(보이는 영역만, 프레임 그림 보관, 작은 글자 막대 표시), 자동 전환 기준, 모양 기준 클릭 판정, 성능 측정용 큰 문서 |
| [app/src/pluginApi.ts](app/src/pluginApi.ts), [pluginRuntime.ts](app/src/pluginRuntime.ts), [pluginPanels.tsx](app/src/pluginPanels.tsx), [app/plugins](app/plugins) | 플러그인 호출 검사·실행, 격리 iframe 문서, 플러그인 목록·권한·실행 창, 예제와 API 문서 |
| [app/src/clipboard.ts](app/src/clipboard.ts), [align.ts](app/src/align.ts), [alignBar.tsx](app/src/alignBar.tsx), [svgExport.ts](app/src/svgExport.ts), [imageExport.ts](app/src/imageExport.ts) | 복사·붙여 넣기(새 id, 메인→인스턴스, 외부 입력 검사), 정렬·간격, 정렬·내보내기 버튼, SVG 쓰기, PNG·SVG 파일 만들기 |
| [app/src/styleCss.ts](app/src/styleCss.ts) | 채우기·선·효과·텍스트 스타일을 CSS로 (캔버스와 React 출력 공용) |
| [app/src/stylePanels.tsx](app/src/stylePanels.tsx) | 채우기·선·효과·텍스트 편집 패널 |
| [app/src/assets.ts](app/src/assets.ts) | 이미지 바이트 IndexedDB 저장, 형식 판별, base64 |
| [app/src/figStyles.ts](app/src/figStyles.ts), [vectorNetwork.ts](app/src/vectorNetwork.ts), [report.tsx](app/src/report.tsx) | Figma 스타일 변환, 벡터 네트워크 경로 복원, 가져오기 보고서 |
| [app/src/model.ts](app/src/model.ts) | 문서 스키마와 순수 변경 명령 |
| [app/src/figmaImport.ts](app/src/figmaImport.ts) | `.fig` 파싱 결과의 선택 노드·컴포넌트·override 변환과 보고 |
| [app/src/export.ts](app/src/export.ts) | 선택 노드 → TSX 문자열 |
| [app/scripts/import-fig.mjs](app/scripts/import-fig.mjs) | 로컬 파일 변환 통계 확인, 선택적 JSON 출력 |
| [app/tests](app/tests) | 모델·TSX 변환 및 선택적 실제 `.fig` 통합 검증 |

`App.tsx`에 현재 UI와 편집 상태가 모여 있다. 기능 확대 시 파일을 임의로 분할하기보다 문서 명령, 좌표/선택, 렌더, 가져오기, 출력의 책임을 분리한다. 가져온 원본 노드와 사용자 편집 노드는 동일한 문서 불변식을 만족해야 한다.

### 4.1 가져오기 규칙

1. 사용자가 `.fig` 파일과 `node-id`가 있는 링크 또는 `sessionID:localID`를 제공한다.
2. [openfig-core](https://github.com/OpenFig-org/openfig-core)로 로컬 파일을 읽고 대상 노드를 찾는다.
3. 원본의 상대 transform을 캔버스 좌표로 변환한다. 보이는 노드의 계층, 솔리드 색상, 텍스트·글꼴, 일부 벡터 경로를 보존한다.
4. 인스턴스의 원본 SYMBOL을 펼치고 `overrideKey`와 GUID 경로가 맞는 override를 적용한다. 순환 참조와 과도한 중첩은 중단하고 보고한다.
5. 처리 결과의 가져온 수, 펼친 인스턴스 수, 적용·미적용 override 수, 근사 도형 수를 보고한다. 완료 버전은 미지원 속성의 대상과 원인도 보고해야 한다. 현재 보고는 개수 수준이다.

현재 이미지·그라디언트·정확한 레이아웃은 변환되지 않는다. `.fig` 형식은 변경될 수 있으므로 원본 파일 버전과 파서 동작을 실제 파일 통합 테스트로 확인한다.

### 4.2 React 출력 규칙

현재 [export.ts](app/src/export.ts)는 선택 노드의 하위 요소를 고정 크기·절대 좌표 TSX로 내보내고 텍스트를 선택적 props로 만든다. SVG 경로는 inline SVG로 출력한다. 편집 경로 벡터와 불리언 그룹은 결과 경로 하나(`<path>`)로 내보내고 피연산자는 내보내지 않는다. 프로토타입 상호작용은 내보내지 않는다. 이 출력은 **초안**이다. 완료 버전은 컴포넌트 이름·props를 안정적으로 생성하고, Auto Layout을 CSS flex/grid로, 이미지·글꼴을 에셋으로 분리하며, 독립 React 프로젝트에서 검증한다.

## 5. 다음 마일스톤의 완료 기준

**M1: 제공된 `Contents` 프레임의 신뢰 가능한 가져오기·출력.**

1. 미적용 override 38개를 대상 부재, 지원하지 않는 속성, 경로 해석 오류로 분류한다. 지원 가능한 것은 적용하고 남은 것은 노드 ID·속성·원인을 보고한다.
2. 근사 처리된 도형 20개를 유형별로 분석한다. SVG 경로나 래스터 에셋으로 복원 가능한 경우 처리하고, 불가능한 경우 미지원 상태를 명시한다.
3. `Contents`의 세로 Auto Layout과 50/120px 패딩, 80px 간격을 캔버스와 생성 CSS에 반영한다.
4. Figma 원본, Canvas Studio, 생성 React 결과를 같은 선택 범위와 viewport에서 캡처한다. 눈에 띄는 차이를 목록으로 기록하고 수정 후 다시 비교한다. 비교용 캡처는 민감한 원본 데이터 취급 정책에 따라 Git 포함 여부를 결정한다.
5. 출력 TSX와 에셋을 별도 React 프로젝트에서 타입 검사·빌드한다. 텍스트 변경 등 최소 1개 prop 변형이 렌더 결과에 반영되는지 확인한다.
6. JSON 저장·재열기 후 노드 수, 계층, override 결과와 편집 값이 유지되는지 확인한다.

**M2: Figma 편집 동작 비교.** 편집 가능한 테스트 파일에서 새 프레임, 도형, 텍스트, 이동, 크기 변경, undo/redo, 컴포넌트 생성·인스턴스 변경을 원본과 같은 순서로 수행한다. 사용자가 제공한 VNPL 파일은 보기 권한이므로 이 검증의 입력으로 쓰지 않는다.

## 6. 비기능 요구

- **로컬 우선:** `.fig`와 변환 결과를 원격 서비스에 자동 업로드하지 않는다. 다운로드한 원본은 Git에 넣지 않는다. `.gitignore`가 `.fig`, `.deck`, `.jam`, `.tools`, Craft 프로젝트, 빌드 출력을 제외한다.
- **오류 회복:** 잘못된 JSON·`.fig`·노드 ID, 파서 실패, 저장 공간 부족에서 편집 중인 문서를 잃지 않고 원인을 표시한다.
- **성능:** 20,709노드 파일 전체를 기본 렌더링하지 않는다. 선택 프레임만 변환하고 파싱·렌더 시간을 측정한 뒤 기준을 정한다. 현재 CLI 파싱 검증은 완료됐지만 브라우저의 50MB 파일 UI 경로 성능은 검증되지 않았다.
- **코드 품질:** 모델 변환과 출력은 결정적이어야 한다. 생성 코드에 편집기 히스토리·선택 상태를 넣지 않는다. 저장된 문서는 다시 읽을 수 있어야 한다.
- **제품 구분:** 편집기 명칭·브랜드 자산은 자체적으로 유지하고 Figma의 상표/로고를 제품 UI에 사용하지 않는다.

## 7. 검증과 실행

```powershell
cd D:\SOURCE\figma-clone\app
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

브라우저에서 `http://127.0.0.1:5173/`을 열어 **열기 → `.fig` 선택 → Figma 링크 또는 `779:23219` 입력 → 가져오기**를 확인한다. 첫 화면은 기존 sample 문서이며, 브라우저 localStorage에 이전 작업이 남아 있을 수 있다.

실제 파일이 Downloads에 있을 때 선택적으로 통합 테스트와 CLI 통계를 실행한다. 파일명과 위치는 사용자 환경에 맞게 바꾼다.

```powershell
$figFile = Join-Path $env:USERPROFILE 'Downloads\🇻🇳 VNPL_Design 공유.fig'
$env:FIGMA_TEST_FILE = $figFile
npm test
node --experimental-strip-types scripts/import-fig.mjs "$figFile" '779:23219'
```

2026-11-17 마지막 검증: TypeScript 타입 검사 성공, Vitest **8개 통과**(실제 파일 환경변수 설정 시), Vite 빌드 성공. 브라우저에서는 가져오기 대화상자까지 확인했다. 컴퓨터 자동화의 파일 선택 단계가 과도하게 지연되어 50MB 원본을 UI에서 끝까지 여는 경로와 시각적 일치를 검증했다고 주장하지 않는다.

## 8. Craft Anything과 인계 주의사항

- Craft Anything v0.6.1 Windows portable은 저장소의 `.tools/`에 있고 Git에는 없다. `doctor`는 정상이다.
- Codex 백엔드 자동 빌드는 현재 사용자 전역 모델 설정 `gpt-6-sol`의 `model_not_found`로 중단됐다. Claude Code는 설치됐지만 로그인되지 않았다. `web-browser-connect`는 clean-room에서 Deep 전용으로 거부됐다. 전역 설정을 임의 변경하지 않고 지원되는 백엔드/명령을 검증한 뒤 Study → Build → Check를 다시 시도한다.
- Figma 편집 화면 관찰에는 clean-room 방식을 유지한다. 사용자 `.fig`의 로컬 파싱은 D2C 입력 처리이며 별도의 경로다.
- 원본 Figma 파일의 보기 권한을 편집 권한으로 간주하지 않는다. 원본 파일에 댓글·수정·공유 설정 변경을 하지 않는다.
- 다른 세션에서는 먼저 `git status`로 사용자 변경을 확인하고, [아이데이션.md](아이데이션.md)와 [기존 구현 계획](docs/implementation-plan.md)을 함께 읽는다.
