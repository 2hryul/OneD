# 디자이너 가이드: 레이어 이름과 Auto Layout

Figma에서 만든 화면을 Canvas Studio로 가져와 React 코드로 내보낼 때, 레이어 이름과 Auto Layout이 코드의 태그와 배치를 정한다. 이 가이드를 따르면 퍼블리셔가 역할을 하나하나 고르지 않아도 쓸 만한 HTML이 나온다.

## 역할이 정해지는 순서

1. 퍼블리셔가 속성 패널의 **웹 역할**에서 고른 값. 고르면 레이어 이름은 보지 않는다.
2. 레이어 이름에 든 단어(아래 표).
3. 모양. 24px 이상 굵은 한 줄 글자는 제목이고, 도형만 20개 넘게 든 큰 묶음은 그림 파일 하나가 된다.

**웹 역할**을 **자동(레이어 이름으로)**으로 되돌리면 2와 3으로 돌아간다.

## 레이어 이름 단어

영문은 단어 단위로 본다. `PrimaryButton`, `btn-primary`, `Button/Primary` 모두 `button`이다. 한글은 이름에 들어 있으면 된다.

| 역할 | 내보내는 태그 | 영문 단어 | 한글 |
|---|---|---|---|
| 버튼 | `button` | button, btn, cta | 버튼 |
| 링크 | `a href="#"` | link, hyperlink | 링크 |
| 입력란 | `input`(안의 첫 글자가 placeholder) | input, textfield, textbox, textarea, "text field" | 입력 |
| 비밀번호 | `input type="password"` | password, pw | 비밀번호 |
| 체크박스 | `label` 안의 `input type="checkbox"` | checkbox, check | 체크 |
| 내비게이션 | `nav` | nav, navigation, gnb, lnb, navbar, breadcrumb | 내비 |
| 헤더·푸터·섹션 | `header`, `footer`, `section` | header, footer, section | 헤더, 푸터, 섹션 |
| 제목 | `h1`~`h4` | heading, headline, title, tit, h1, h2, h3 | 제목, 타이틀 |
| 라벨 | `label` | label | 라벨, 레이블 |

- 입력란은 상자(프레임) 이름을 `Email input`처럼 짓고 안에 placeholder 글자를 둔다. 상자 없이 글자와 밑줄만 있으면 글자 레이어에 **웹 역할 → 입력란**을 고른다.
- 버튼은 배경 사각형과 글자를 프레임 하나로 묶고 그 프레임 이름에 `Button`을 넣는다. 글자만 버튼이면 누를 수 있는 영역이 글자 크기로 줄어든다.
- `Rectangle 12`, `Frame 3`, `Group 7` 같은 기본 이름은 아무 역할도 주지 않는다. 그림이면 `Hero photo`처럼 내용을 적는다. 이 이름이 `alt`가 된다.
- 글 내용을 그대로 이름으로 둔 글자(Figma 기본)는 클래스 이름이 역할 이름(`title`, `text`)이 된다. 클래스 이름을 원하면 `Hero title`처럼 짓는다.

## 제목 단계

- 화면마다 `h1`은 하나다. 가장 큰 제목(크기가 같으면 레이어 순서상 앞의 것)이 `h1`이다.
- 나머지 제목은 글자 크기 순서로 `h2`, `h3`, `h4`가 된다. 다섯 번째 크기부터는 모두 `h4`다.
- 컴포넌트 안의 제목은 화면 안에 놓이므로 `h2`부터 쓴다.
- 버튼·링크·입력란 안의 글자는 제목이 되지 않는다.
- 크기가 커도 제목이 아닌 글자(큰 숫자, 장식 문구)는 **웹 역할**에서 다른 역할을 고르거나 **장식(읽지 않음)**을 고른다.

## 그림과 장식

- 도형만 20개 이상 들고 짧은 변이 48px 이상인 묶음은 `assets/<이름>.svg` 하나와 `img`로 나간다. 글자, 그림 채우기, 인스턴스, 인터랙션, Auto Layout이 들어 있거나 회전한 묶음은 나뉘어 나간다.
- 도형이 적은 로고도 그림 파일로 내려면 묶음에 **웹 역할 → 그림**을 고른다.
- **장식(읽지 않음)**은 스크린 리더가 읽지 않게 한다(`aria-hidden`, 그림이면 `alt=""`). 배경 무늬, 구분선 묶음에 쓴다.

## 상태 variant

- 버튼 같은 컴포넌트 세트에 `State` 속성을 두고 값을 `Default`, `Hover`, `Pressed`, `Focus`, `Disabled`로 지으면 상태가 CSS가 된다. `Hover`는 `:hover`, `Pressed`는 `:active`, `Focus`는 `:focus-visible`, `Disabled`는 `:disabled`(버튼이 아니면 `[data-disabled]`)다.
- 상태는 prop이 아니다. 마우스와 키보드가 정한다. `Disabled` 값이 있으면 `disabled` prop 하나가 생긴다.
- 같은 뜻의 값도 알아본다. `Normal`·`Rest`·`Enabled`는 기본, `Hovered`, `Press`·`Clicked`, `Focused`, `Inactive`다. `Active`는 탭의 선택됨으로도 써서 상태로 보지 않는다.
- 상태끼리는 색, 선, 그림자만 다르게 한다. 상태마다 레이어 구조(글자, 아이콘 수)가 다르면 합쳐지지 않아 hover 모양을 코드로 낼 수 없다.
- 화면의 인스턴스에 `Hover`를 골라 두어도 코드에서는 기본 모양이다. `Disabled`만 `disabled`로 넘어간다.

## 프로토타입 연결

클릭 연결은 코드의 prop과 링크가 된다. 다른 트리거(마우스 올리기, 시간 지남)는 코드로 나가지 않는다.

| 연결 | 코드 |
|---|---|
| 화면 이동 | `a`(이름이 버튼이면 `button`), 누르면 `onNavigate("<대상 프레임 이름>")` |
| URL 열기 | `a href="<URL>" target="_blank"`. http·https 주소만 쓴다 |
| 오버레이 열기·토글 | `button aria-haspopup="dialog"`, 누르면 `onOpenChange(true 또는 !open, "<오버레이 프레임 이름>")`. `open` prop이 열림 상태다 |
| 오버레이 닫기 | 누르면 `onOpenChange(false, …)` |
| 뒤로 | 누르면 `onBack()` |

- 대상 프레임 이름이 코드에 그대로 들어가므로 `Dashboard`, `Login`처럼 짓는다.
- 인스턴스에 건 연결은 컴포넌트에 `onClick`으로 넘어간다.
- 입력란(역할이나 이름이 input)은 `emailValue`와 `onEmailChange`처럼 값과 바뀜 콜백 prop을 받는다. 이름은 레이어 이름에서 짓고, 이름이 `Placeholder`처럼 일반 단어면 placeholder 글자로 짓는다.

## Auto Layout 사용 규칙

Auto Layout이 있는 프레임은 그대로 `display: flex`가 된다. 없는 프레임은 내보내기가 위치를 보고 줄과 열을 짐작한다. 짐작보다 Auto Layout이 정확하므로 다음 자리는 Auto Layout으로 만든다.

- **반복되는 목록**(카드 줄, 메뉴 항목). 같은 컴포넌트를 Auto Layout 안에 늘어놓으면 목록(`role="list"`)으로 나간다.
- **버튼 안**(아이콘 + 글자). 글자가 늘어도 버튼이 같이 늘어난다.
- **폼**(제목 + 입력란 + 도움말). 세로 Auto Layout으로 쌓는다.
- **화면 폭을 채우는 구역**. 가로 크기를 **채우기(Fill)**로 두면 화면 폭에 맞춰 줄어든다. 고정 폭이면 좁은 화면에서 잘린다.

Auto Layout이 없어도 되는 자리도 있다.

- 배경 그림 위에 글자를 얹는 히어로. 가장 아래 도형이 다른 도형을 다 덮으면 배경으로 본다.
- 겹쳐 놓은 장식. 프레임 밖으로 나간 도형, 회전한 도형, 오른쪽·가운데·늘이기 제약을 준 도형은 그 자리에 고정된다.

## 피할 것

- 한 레이어에 두 역할을 넣는 이름(`Button link`). 버튼이 먼저다. 의도와 다르면 **웹 역할**을 고른다.
- 화면 하나에 같은 크기의 큰 제목 여러 개. 하나만 `h1`이 되고 나머지는 `h2`다. 화면의 주제를 가장 크게 둔다.
- 글자를 윤곽선(Outline)으로 바꾼 레이어. 글자가 아니라 도형(`svg`)으로 나가서 검색·번역·스크린 리더가 읽지 못한다.
