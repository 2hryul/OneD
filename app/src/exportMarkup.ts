import type { DesignNode, Page } from './model';
import type { Style } from './exportCss';

/**
 * 도형 하나를 어떤 HTML 요소로 낼지. phrasing은 자식이 문장 요소(span)만 와야 하는지다
 * (button·a·label 안에는 div·p가 올 수 없다).
 */
export interface Element { tag: string; attrs: string[]; reset: Style; phrasing: boolean }

/** 레이어 이름에서 찾을 단어. 영문은 단어 단위(camelCase도 나눔), 한글은 포함 여부로 본다. */
const ROLES = {
  button: { words: ['button', 'btn', 'cta'], ko: ['버튼'] },
  input: { words: ['input', 'textfield', 'textbox', 'textarea'], ko: ['입력'] },
  password: { words: ['password', 'pw'], ko: ['비밀번호'] },
  link: { words: ['link', 'hyperlink'], ko: ['링크'] },
  nav: { words: ['nav', 'navigation', 'gnb', 'lnb', 'navbar', 'breadcrumb', 'breadcrumbs'], ko: ['내비'] },
  header: { words: ['header'], ko: ['헤더'] },
  footer: { words: ['footer'], ko: ['푸터'] },
  section: { words: ['section'], ko: ['섹션'] },
  // tit는 국내 퍼블리싱에서 흔한 제목 약어다.
  heading: { words: ['heading', 'headline', 'title', 'tit', 'h1', 'h2', 'h3'], ko: ['제목', '타이틀'] },
  label: { words: ['label'], ko: ['라벨', '레이블'] }
} as const;
type Role = keyof typeof ROLES;

function nameWords(name: string): Set<string> {
  return new Set(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

export function hasRole(node: DesignNode, role: Role): boolean {
  const words = nameWords(node.name);
  const lower = node.name.toLowerCase();
  return ROLES[role].words.some((word) => words.has(word)) || ROLES[role].ko.some((word) => node.name.includes(word)) || (role === 'input' && lower.includes('text field'));
}

// 브라우저 기본 스타일을 지워 디자인과 같은 모양을 유지한다. 도형 스타일이 뒤에 덮어쓴다.
const TEXT_RESET: Style = { margin: 0 };
const BUTTON_RESET: Style = { appearance: 'none', margin: 0, padding: 0, border: 0, background: 'none', font: 'inherit', color: 'inherit', textAlign: 'inherit', cursor: 'pointer' };
const LINK_RESET: Style = { color: 'inherit', textDecoration: 'none' };
const INPUT_RESET: Style = { appearance: 'none', margin: 0, padding: 0, border: 0, background: 'transparent', font: 'inherit', color: 'inherit', minWidth: 0 };
const FIT: Record<string, string> = { fill: 'cover', fit: 'contain', stretch: 'fill' };

/** 첫 번째로 보이는 텍스트 하위 도형. input 이름 컨테이너에서 이 텍스트를 입력창의 placeholder로 쓴다. */
export function firstText(page: Page, node: DesignNode, hidden: ReadonlySet<string>): DesignNode | undefined {
  for (const id of node.children ?? []) {
    const child = page.objects[id];
    if (!child || hidden.has(child.id) || (child.componentId && !child.mainInstance)) continue;
    if (child.type === 'text') return child;
    const found = firstText(page, child, hidden);
    if (found) return found;
  }
  return undefined;
}

/** 텍스트 요소. 제목은 글자 크기로 단계를 정한다(32 이상 h1, 24 이상 h2, 나머지 h3). */
export function textElement(node: DesignNode, phrasing: boolean): Element {
  if (phrasing) return { tag: 'span', attrs: [], reset: {}, phrasing: true };
  if (hasRole(node, 'heading')) {
    const size = node.fontSize ?? 18;
    return { tag: size >= 32 ? 'h1' : size >= 24 ? 'h2' : 'h3', attrs: [], reset: TEXT_RESET, phrasing: true };
  }
  // 'Button label'처럼 다른 요소의 글자를 뜻하는 이름은 폼 라벨이 아니다.
  if (hasRole(node, 'label') && !hasRole(node, 'button') && !hasRole(node, 'link')) return { tag: 'label', attrs: [], reset: TEXT_RESET, phrasing: true };
  if (hasRole(node, 'link')) return { tag: 'a', attrs: ['href="#"'], reset: { ...TEXT_RESET, ...LINK_RESET }, phrasing: true };
  return { tag: 'p', attrs: [], reset: TEXT_RESET, phrasing: true };
}

/** 입력창. 비밀번호 이름이 붙은 컨테이너 안이면 type="password". */
export function inputElement(password: boolean): Element {
  return { tag: 'input', attrs: [`type="${password ? 'password' : 'text'}"`], reset: INPUT_RESET, phrasing: true };
}

/** 그림 하나만 채운 사각형은 alt가 있는 img로 낸다. 바둑판(tile) 채우기는 배경으로 둔다. */
function imageOnly(node: DesignNode): Extract<DesignNode['fills'][number], { type: 'image' }> | null {
  const paint = node.fills.length === 1 ? node.fills[0]! : null;
  return node.type === 'rectangle' && !node.children?.length && paint?.type === 'image' && paint.fit !== 'tile' ? paint : null;
}

/** 컨테이너(프레임·그룹·사각형·타원) 요소. 이름으로 역할을 고르고, 문장 요소만 와야 하는 자리면 span으로 둔다. */
export function boxElement(node: DesignNode, phrasing: boolean, hasText: boolean): Element {
  const image = imageOnly(node);
  if (image) return { tag: 'img', attrs: [`src="./assets/${image.assetId}"`, `alt=${JSON.stringify(node.name)}`], reset: { display: 'block', objectFit: FIT[image.fit] ?? 'cover' }, phrasing: true };
  if (phrasing) return { tag: 'span', attrs: [], reset: { display: 'block' }, phrasing: true };
  if (hasRole(node, 'button')) return { tag: 'button', attrs: ['type="button"'], reset: BUTTON_RESET, phrasing: true };
  if (hasRole(node, 'input') && hasText) return { tag: 'label', attrs: [], reset: { display: 'block', cursor: 'text' }, phrasing: true };
  if (hasRole(node, 'link')) return { tag: 'a', attrs: ['href="#"'], reset: { display: 'block', ...LINK_RESET }, phrasing: true };
  if (node.type === 'frame' || node.type === 'group') {
    for (const role of ['nav', 'header', 'footer', 'section'] as const) if (hasRole(node, role)) return { tag: role, attrs: [], reset: {}, phrasing: false };
  }
  return { tag: 'div', attrs: [], reset: {}, phrasing: false };
}
