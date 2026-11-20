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
- 2026-11-20 없는 글꼴의 글리프 윤곽·로컬 파일 프레임 목록: `.fig` 텍스트의 글꼴이 이 PC에 없으면(글자 폭 비교로 판단) Figma가 저장한 글리프 윤곽(derivedTextData)을 글자 상자 지역 좌표의 경로 하나로 만들어 `glyphs`(key: 글자·글꼴·크기·굵기, d: 경로)로 저장하고, DOM·Canvas·SVG 렌더러가 글자 색으로 그 경로를 그린다. 글자를 고치거나(key 불일치) 글꼴이 생기면 실제 글자로 그린다. 구간 스타일이 있는 텍스트와 글꼴이 있는 텍스트는 윤곽을 저장하지 않는다(문서 크기). React 내보내기는 글자를 그대로 둔다. `.fig`를 열면 페이지별 최상위 프레임과 섹션 안 프레임 목록을 보여 주고, 하나뿐이면 미리 고른다. 링크·node-id 입력도 그대로 된다.
- 2026-11-20 React 내보내기 운영 코드 구조: (1) 클래스 이름은 레이어 이름에 뜻이 있을 때만 쓰고, 기본 이름(Frame 12, Group, Rectangle 3, 긴 숫자)과 문장인 글자 레이어 이름은 역할 이름(title, text, row, stack, icon, image 등)으로 바꾼다. 화면 루트가 기본 이름이면 Screen이다. (2) 구조(태그·클래스·글자·prop 연결)가 같은 variant는 함수 하나로 합친다. 루트가 variant 값을 data 속성(data-size)으로 갖고, 첫 variant 규칙이 기본, 나머지는 다른 선언만 `.블록:where([data-…])` 아래에 낸다(:where라 인스턴스 위치 클래스가 계속 이김). variant끼리 다른 상태 속성(disabled, readOnly, defaultChecked, aria-invalid)은 variant 조건식이 된다. 구조가 다른 variant는 구조별 함수와 그것을 고르는 함수로 나온다(속성 값 목록 조건식). (3) Props 타입은 `Omit<HTMLAttributes<HTMLElement>, …>`를 이어받고, 함수는 props를 구조 분해해 나머지(rest: onClick, aria-*, id 등)를 루트에 넘긴다. 루트 기본 속성(type, aria-label)은 rest 앞에 두어 쓰는 쪽이 바꿀 수 있다. 글자 없는 variant 버튼 이름은 아이콘 이름이다. (4) 같은 컴포넌트 인스턴스만 셋 이상 든 div는 role="list", 항목은 role="listitem"(항목 루트가 div일 때만). 이름이 제목이 아니어도 24px 이상·굵게·한 줄 80자 이하 글자는 제목(h1~h3)이다. (5) 묶어 받기는 프로젝트에 넣을 파일로 나눈다: 화면 이름.tsx·이름.css, components/컴포넌트.tsx·컴포넌트.css, components/index.ts, tokens.css(글꼴 안내와 :root 변수). 각 TSX는 쓰는 컴포넌트를 먼저, 자기 CSS를 마지막에 import해 한 파일일 때와 CSS 순서가 같다. 파일이 나뉘면 컴포넌트의 좁은 화면 높이 풀기 규칙이 뒤 파일의 위치 규칙에 지므로, 인스턴스 위치 클래스에도 같은 규칙을 둔다. 미리보기 창은 한 파일 형태 그대로다. (6) 한 컴포넌트 안에 같은 이름 글자가 여럿이면 순번으로 prop을 나눈다(같은 이름 속성이 두 번 나오던 JSX 오류).
- 2026-11-20 변수 토큰·컴포넌트 속성: `.fig`의 Figma 변수(색·숫자)를 토큰으로 가져온다. 값은 그 자리에 적용되는 변수 모드(라이트·다크)로 별칭을 끝까지 풀어 정하고, 노드의 실제 값과 같을 때만 연결한다(채우기·선·반경·간격·글자 크기). 변수에 연결된 칠 색은 저장된 계산 값 대신 현재 모드 값으로 그린다(라이트 화면이 어둡게 나오던 문제). cornerRadius가 없으면 네 모서리 반경을 쓴다. 컴포넌트 속성(텍스트·불리언)은 컴포넌트에 정의(`props`), 메인 안 도형에 참조(`propRefs`), 인스턴스 루트에 값(`propValues`)으로 저장한다. 속성 패널에서 메인은 속성 이름·기본값을 고치고 지우며, 메인 안 도형은 글자·보이기를 속성에 잇거나 새로 만들고, 인스턴스는 값을 고치거나 기본값으로 되돌린다. 속성에 연결된 글자를 직접 고치면 속성 값이 바뀐다. 인스턴스 동기화는 속성이 정하는 글자·보이기를 메인 값으로 덮지 않고, 속성 값으로 바꾼 것은 override로 기록하지 않는다. `.fig`의 속성 정의 id는 파일 안에서 겹치므로(복제한 컴포넌트) 정의·참조·값을 노드가 속한 컴포넌트(세트) 범위에서 풀고 문서 id에 범위를 붙인다(`p-<컴포넌트>-<정의>`). React 내보내기는 텍스트 속성을 문자열 prop, 불리언 속성을 조건부 렌더로 내고 인스턴스 값을 prop으로 넘긴다. 인스턴스 교체 속성은 아직 없다(가져오기 보고만).
- 2026-11-19 `.fig` 호환성(커뮤니티 템플릿 시험에서 발견): Figma가 "제한 없음"·"자동"으로 저장한 Infinity·NaN 크기·간격은 받지 않는다(저장 뒤 다시 열기 실패 방지). override 경로는 overrideKey와 노드 guid 둘 다로 찾는다. 컴포넌트 속성(TEXT·BOOL)을 참조하는 노드에 인스턴스의 속성 값을 적용한다(인스턴스 교체 속성은 보고만). 자식 순서는 parentIndex.position을 문자 코드 순으로 다시 정렬한다(파서의 localeCompare 정렬은 공백이 든 순서 문자열에서 틀린다).
- 2026-11-19 마스크·Grid: 도형의 `mask`(Figma Use as mask, Ctrl+Alt+M로 맨 아래 도형을 마스크로 묶기, 위 형제를 다음 마스크 전까지 자기 윤곽으로 자름)와 Grid 레이아웃(`layout.type: 'grid'`, 트랙 고정 px·비율 fr·내용에 맞춤 auto, 칸 지정 또는 행 순서 자동 배치, 모자란 행은 내용에 맞춤으로 늘어남). DOM(mask-image)·Canvas(clip)·SVG(clipPath)·React(mask-image, `display: grid`)가 같은 윤곽·배치 규칙을 쓴다. `.fig`의 마스크와 Grid(트랙 FLEX·HUG·FIXED, 자동 재배치면 자식 순서, 아니면 칸 기준)를 가져온다.
- 2026-11-18 조작 보강: 방향키 이동(Shift 10px, 오토 레이아웃 안에서는 순서 바꾸기), 레이어 순서 단축키(Ctrl+]·[ 한 칸, Ctrl+Shift+]·[ 맨 위·아래), 확대 단축키(Ctrl+0 100%, Shift+1 전체, Shift+2 선택, Ctrl+=·-), 확대 범위 2~800%, 레이어 이름 더블클릭 바꾸기, 화면 이동·확대를 따라가는 위·왼쪽 눈금자(선택 구간 강조).
- 2026-11-19 편집 보강: 좌우·상하 뒤집기(Shift+H·Shift+V, 정렬 줄 버튼, 여럿이면 선택 영역 가운데 기준, React 출력은 `scaleX(-1)`), Alt를 누른 채 다른 도형에 올리면 고른 영역과의 거리 표시(고른 도형 위에서는 부모 프레임 네 변까지), 페이지 이름 더블클릭 바꾸기와 지우기(되돌리기 가능, 마지막 페이지와 컴포넌트 원본이 있는 페이지는 지우지 않음, 새 변경 `modPage`).

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
| [app/src/layout.ts](app/src/layout.ts), [gridLayout.ts](app/src/gridLayout.ts), [layoutEdits.ts](app/src/layoutEdits.ts), [layoutPanels.tsx](app/src/layoutPanels.tsx), [figLayout.ts](app/src/figLayout.ts) | Flex·Grid 레이아웃 엔진(트랙 글자 읽고 쓰기 포함)과 제약, 편집 후 재배치·끌어 놓기 순서, 레이아웃 패널(세로·가로·그리드, 트랙·칸 입력), Figma Auto Layout·Grid 변환 |
| [app/src/glyphs.ts](app/src/glyphs.ts) | `.fig` 글리프 윤곽을 텍스트 경로로, 글꼴 있음 판단, 윤곽으로 그릴지 판단(key) |
| [app/src/componentProps.ts](app/src/componentProps.ts), [figProps.ts](app/src/figProps.ts), [figVariables.ts](app/src/figVariables.ts) | 컴포넌트 속성 만들기·고치기·지우기·인스턴스 값 적용, `.fig` 속성 정의·참조·값 가져오기(컴포넌트 범위), Figma 변수 풀기(모드·별칭)와 토큰 연결 |
| [app/src/mask.ts](app/src/mask.ts) | 마스크 윤곽(도형 종류별 SVG 경로), 자식의 마스크 구간 나누기, 부모 좌표의 mask-image SVG |
| [app/src/path.ts](app/src/path.ts), [boolean.ts](app/src/boolean.ts), [pathTools.tsx](app/src/pathTools.tsx) | 경로 수학(SVG 변환·곡선 분할·상자), 불리언 연산(polygon-clipping), 펜·경로 편집 도우미와 오버레이, 불리언·경로 패널 |
| [app/src/prototype.ts](app/src/prototype.ts), [viewer.tsx](app/src/viewer.tsx), [prototypePanels.tsx](app/src/prototypePanels.tsx) | 보기 모드 상태 전이(화면 이동·오버레이·뒤로)와 클릭 대상 찾기, 보기 모드 화면, 프로토타입 패널과 연결선 |
| [app/server](app/server) | 협업 서버: 설정(.env)·로그(마스킹, 30일 보관)·계정(scrypt)·파일 방(변경 순서·검증·코멘트·버전)·HTTP API·WebSocket |
| [app/src/collab.ts](app/src/collab.ts), [useCollab.ts](app/src/useCollab.ts), [collabPanels.tsx](app/src/collabPanels.tsx), [collabTypes.ts](app/src/collabTypes.ts) | 협업 클라이언트(확정 문서 + 대기 변경 다시 얹기, 재연결), 공유 대화상자·참여자·코멘트·커서 화면, 서버와 공유하는 메시지 타입 |
| [app/src/canvasRenderer.ts](app/src/canvasRenderer.ts), [canvasView.tsx](app/src/canvasView.tsx), [hitTest.ts](app/src/hitTest.ts), [largeDoc.ts](app/src/largeDoc.ts) | Canvas 2D 렌더러(보이는 영역만, 프레임 그림 보관, 작은 글자 막대 표시), 자동 전환 기준, 모양 기준 클릭 판정, 성능 측정용 큰 문서 |
| [app/src/pluginApi.ts](app/src/pluginApi.ts), [pluginRuntime.ts](app/src/pluginRuntime.ts), [pluginPanels.tsx](app/src/pluginPanels.tsx), [app/plugins](app/plugins) | 플러그인 호출 검사·실행, 격리 iframe 문서, 플러그인 목록·권한·실행 창, 예제와 API 문서 |
| [app/src/clipboard.ts](app/src/clipboard.ts), [align.ts](app/src/align.ts), [alignBar.tsx](app/src/alignBar.tsx), [svgExport.ts](app/src/svgExport.ts), [imageExport.ts](app/src/imageExport.ts) | 복사·붙여 넣기(새 id, 메인→인스턴스, 외부 입력 검사), 정렬·간격, 정렬·내보내기 버튼, SVG 쓰기, PNG·SVG 파일 만들기 |
| [app/src/arrange.ts](app/src/arrange.ts), [rulers.tsx](app/src/rulers.tsx) | 레이어 순서 바꾸기, 눈금 간격·위치와 눈금자 |
| [app/src/measure.ts](app/src/measure.ts) | Alt 거리 표시선 계산 |
| [app/src/exportCss.ts](app/src/exportCss.ts), [exportMarkup.ts](app/src/exportMarkup.ts) | 출력 CSS 파일(클래스 이름, 토큰·글자 스타일 CSS 변수, 같은 규칙 합치기, rem 변환)과 레이어 이름·variant로 고르는 HTML 요소(폼 필드, radio·checkbox, 아이콘) |
| [app/src/zip.ts](app/src/zip.ts), [inspectPanel.tsx](app/src/inspectPanel.tsx) | TSX·CSS·그림을 묶는 zip(저장 방식), 선택 요소의 CSS 검사 창(오른쪽 패널 "코드" 탭: CSS px/rem, 부모 가장자리까지 거리, 연결된 토큰) |
| [app/src/styleCss.ts](app/src/styleCss.ts) | 채우기·선·효과·텍스트 스타일을 CSS로 (캔버스와 React 출력 공용) |
| [app/src/stylePanels.tsx](app/src/stylePanels.tsx) | 채우기·선·효과·텍스트 편집 패널 |
| [app/src/assets.ts](app/src/assets.ts) | 이미지 바이트 IndexedDB 저장, 형식 판별, base64 |
| [app/src/figStyles.ts](app/src/figStyles.ts), [vectorNetwork.ts](app/src/vectorNetwork.ts), [report.tsx](app/src/report.tsx) | Figma 스타일 변환, 벡터 네트워크 경로 복원, 가져오기 보고서 |
| [app/src/model.ts](app/src/model.ts) | 문서 스키마와 순수 변경 명령 |
| [app/src/figmaImport.ts](app/src/figmaImport.ts) | `.fig` 파싱 결과의 선택 노드·컴포넌트·override 변환과 보고 |
| [app/src/export.ts](app/src/export.ts) | 선택 노드 → TSX와 CSS 파일 |
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

현재 [export.ts](app/src/export.ts)는 선택 노드의 하위 요소를 TSX와 같은 이름의 CSS 파일로 내보내고 텍스트를 선택적 props로 만든다. 오토 레이아웃은 CSS flex, Grid는 CSS grid(`grid-template-columns`·`rows`는 편집기 트랙 글자 그대로, 지정 칸은 `grid-row`·`grid-column`), 나머지는 부모 기준 절대 좌표다. 마스크는 첫 자식 마스크이고 부모에 채우기가 없으면 부모에, 아니면 부모를 덮는 감싸개에 `mask-image`(부모 좌표의 SVG data URL)로 걸고 마스크 도형 자신은 내보내지 않는다(오토 레이아웃 부모 안의 중간 마스크는 감싸개가 흐름을 바꿔 생략한다). 스타일은 BEM 클래스(`블록__요소`)로 CSS 파일에 모이고 TSX는 인라인 스타일 없이 그 파일을 import한다. 단색 배경은 `background-color`로 쓴다. 태그는 레이어 이름으로 고른다(제목류 이름 → h1~h3, button·btn → button, input 이름 컨테이너 → label과 input, link → a, nav·gnb·breadcrumb → nav, header·footer·section, 그림만 채운 사각형 → alt가 있는 img, 나머지 텍스트 → p). variant 메인은 세트 이름(예: Button)으로 판단한다. variant `Type` 값이 txt·area·select·calendar·phonenumber 등이면 폼 필드로 보고 제목은 `label htmlFor`, 입력 글자는 `input`·`textarea`(select는 `button aria-haspopup="listbox"`)로 내고 React `useId`로 잇는다. variant 값 disabled·readonly·error·filled는 `disabled`·`readOnly`·`aria-invalid`·`defaultValue`가 된다. radio·checkbox 이름의 글자 있는 컴포넌트는 `label` 안에 화면에서 숨긴 실제 `input`을 넣는다. 글자 없이 도형만 든 64px 이하 묶음은 `span aria-hidden`(아이콘), 글자 없는 버튼은 `aria-label`, 기본 이름(Rectangle 7 등)의 그림은 `alt=""`이다. 입력 요소는 hug 크기 대신 상자 폭을 채운다. 브라우저 기본 스타일은 클래스에서 초기화해 모양을 유지한다. 화면 루트는 `width: 100%; max-width: 원래 폭`이고, 레이아웃 없는 프레임의 자식은 제약(right·center·left-right·scale 등)을 CSS로 옮기며, 레이아웃 항목의 최소·최대 크기도 낸다. 오토 레이아웃 흐름의 고정 폭은 `max-width: 100%`, 행 방향 채우기 항목은 `min-width: 0`이라 부모가 줄면 함께 줄고 디자인보다 넓은 내용이 부모를 밀지 않는다. 글자 상자는 `min-height`라 줄이 늘면 함께 늘어난다. 767px 이하 미디어 쿼리에서 화면 출력의 넓은(600px 이상) 가로 오토 레이아웃은 세로로 쌓고, 고정 높이 오토 레이아웃 상자는 높이를 최소값으로 푼다(디자인 폭에서는 글꼴 차이로 커지지 않게 고정 유지). 폼 필드의 도움말·오류 글자(이름 hint·help·error 등)는 `id`를 받고 입력이 `aria-describedby`로 가리킨다. 선언이 같은 규칙은 선택자 목록으로 합친다(컴포넌트 루트와 인스턴스 위치 규칙은 순서 때문에 합치지 않는다). 문서 토큰은 모두 `:root` CSS 변수가 되고, 연결된 반경·글자 크기·간격과 토큰 값과 같은 색은 `var()`로 쓴다. 글자 스타일은 `--font-글꼴-크기-굵기` 변수(`font` 줄임 값)로 묶고, CSS 머리말에 불러와야 할 글꼴 목록을 적는다. 글자 구간 스타일은 `span`으로 낸다. 그림은 TSX에서 import하고, 코드 창의 zip 받기는 TSX·CSS·`assets\` 그림을 한 파일로 준다. SVG 경로는 inline SVG로 출력한다. 편집 경로 벡터와 불리언 그룹은 결과 경로 하나(`<path>`)로 내보내고 피연산자는 내보내지 않는다. 프로토타입 상호작용은 내보내지 않는다. 이 출력은 **초안**이다. 완료 버전은 컴포넌트 이름·props를 안정적으로 생성하고, 이미지·글꼴을 에셋으로 분리하며, 독립 React 프로젝트에서 검증한다.

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
