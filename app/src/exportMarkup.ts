import type { DesignNode, LayerRole, Page } from './model';
import type { Style } from './exportCss';
import { adjustedImageFill } from './styleCss';

/**
 * 도형 하나를 어떤 HTML 요소로 낼지. phrasing은 자식이 문장 요소(span)만 와야 하는지다
 * (button·a·label 안에는 div·p가 올 수 없다).
 */
export interface Element { tag: string; attrs: string[]; reset: Style; phrasing: boolean; assetId?: string }

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
  label: { words: ['label'], ko: ['라벨', '레이블'] },
  radio: { words: ['radio'], ko: ['라디오'] },
  checkbox: { words: ['checkbox', 'check'], ko: ['체크'] }
} as const;
type Role = keyof typeof ROLES;

/** 퍼블리셔가 정한 역할이 뜻하는 이름 역할. 정한 역할이 있으면 이름은 보지 않는다(비밀번호는 입력이기도 하다). */
const EXPLICIT: Record<LayerRole, readonly Role[]> = {
  button: ['button'], link: ['link'], input: ['input'], password: ['input', 'password'], checkbox: ['checkbox'],
  nav: ['nav'], header: ['header'], footer: ['footer'], section: ['section'], heading: ['heading'], image: [], decoration: []
};

function nameWords(name: string): Set<string> {
  return new Set(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

export function hasRole(node: Pick<DesignNode, 'name'> & Partial<Pick<DesignNode, 'role'>>, role: Role): boolean {
  if (node.role) return EXPLICIT[node.role].includes(role);
  const words = nameWords(node.name);
  const lower = node.name.toLowerCase();
  return ROLES[role].words.some((word) => words.has(word)) || ROLES[role].ko.some((word) => node.name.includes(word)) || (role === 'input' && lower.includes('text field'));
}

// 브라우저 기본 스타일을 지워 디자인과 같은 모양을 유지한다. 도형 스타일이 뒤에 덮어쓴다.
const TEXT_RESET: Style = { margin: 0 };
const BUTTON_RESET: Style = { appearance: 'none', margin: 0, padding: 0, border: 0, background: 'none', font: 'inherit', color: 'inherit', textAlign: 'inherit', cursor: 'pointer' };
const LINK_RESET: Style = { color: 'inherit', textDecoration: 'none' };
const INPUT_RESET: Style = { appearance: 'none', margin: 0, padding: 0, border: 0, background: 'transparent', font: 'inherit', color: 'inherit', minWidth: 0 };
const TEXTAREA_RESET: Style = { ...INPUT_RESET, resize: 'none', overflow: 'hidden' };
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

/**
 * 이름이 제목이 아니어도 제목처럼 보이는 글자(24px 이상, 굵게, 한 줄 80자 이하).
 * 디자이너는 제목 레이어 이름을 글 내용 그대로 두는 경우가 많아, 이름만 보면 화면 제목이 모두 p가 된다.
 */
function looksLikeHeading(node: DesignNode): boolean {
  const text = node.text ?? '';
  return (node.fontSize ?? 18) >= 24 && (node.fontWeight ?? 400) >= 600 && text.length > 0 && text.length <= 80 && !text.includes('\n');
}

/** 제목 글자인지. 역할을 정했으면 역할만 본다. */
function isHeadingText(node: DesignNode): boolean {
  return node.role ? node.role === 'heading' : hasRole(node, 'heading') || looksLikeHeading(node);
}

export type HeadingLevel = 1 | 2 | 3 | 4;

/**
 * 렌더 범위 안 제목의 단계. 가장 큰 제목 하나가 top(화면은 1, 컴포넌트는 2)이고, 나머지는 글자 크기 순서로 한 단계씩 내려가 h4에서 멈춘다.
 * 버튼·링크·입력 안의 글자(문장 요소가 됨)와 아래 인스턴스(컴포넌트가 따로 냄), skip(폼 필드 글자)은 세지 않는다.
 * 역할이 heading인 컨테이너는 안의 가장 큰 글자 크기로 세고, 안의 글자는 따로 세지 않는다.
 */
export function headingLevels(page: Page, rootId: string, hidden: ReadonlySet<string>, top: 1 | 2, options: { rootName?: string; skip?: ReadonlySet<string> } = {}): Map<string, HeadingLevel> {
  const found: Array<{ id: string; size: number }> = [];
  const largest = (node: DesignNode): number => Math.max(0, ...(node.type === 'text' ? [node.fontSize ?? 18] : []), ...(node.children ?? []).map((id) => page.objects[id]).filter((child): child is DesignNode => Boolean(child && !hidden.has(child.id))).map(largest));
  const visit = (id: string): void => {
    let node = page.objects[id];
    if (!node || hidden.has(id) || options.skip?.has(id)) return;
    if (id !== rootId && node.componentId && !node.mainInstance) return;
    if (id === rootId && options.rootName) node = { ...node, name: `${options.rootName} ${node.name}` };
    if (hasRole(node, 'button') || hasRole(node, 'link') || hasRole(node, 'input') || node.role === 'checkbox' || node.role === 'decoration') return;
    if (node.type === 'text') { if (isHeadingText(node)) found.push({ id, size: node.fontSize ?? 18 }); return; }
    if (node.role === 'heading') { found.push({ id, size: largest(node) }); return; }
    node.children?.forEach(visit);
  };
  visit(rootId);
  const levels = new Map<string, HeadingLevel>();
  if (found.length === 0) return levels;
  const first = found.reduce((best, item) => (item.size > best.size ? item : best));
  levels.set(first.id, top);
  const sizes = [...new Set(found.filter((item) => item !== first).map((item) => item.size))].sort((a, b) => b - a);
  for (const item of found) if (item !== first) levels.set(item.id, Math.min(4, top + 1 + sizes.indexOf(item.size)) as HeadingLevel);
  return levels;
}

/** 제목 요소. 컨테이너 제목이면 안의 글자가 span이 된다. */
export function headingElement(level: HeadingLevel): Element {
  return { tag: `h${level}`, attrs: [], reset: TEXT_RESET, phrasing: true };
}

/**
 * 텍스트 요소. 제목 단계는 headingLevels가 정한다(단계가 없는 제목은 h2·h3).
 * 역할을 정한 글자는 그 역할의 요소가 된다(입력·비밀번호는 부르는 쪽이 input으로 바꾼다).
 */
export function textElement(node: DesignNode, phrasing: boolean, level?: HeadingLevel): Element {
  if (phrasing) return { tag: 'span', attrs: [], reset: {}, phrasing: true };
  if (node.role === 'decoration') return { tag: 'p', attrs: ['aria-hidden="true"'], reset: TEXT_RESET, phrasing: true };
  if (node.role === 'button') return { tag: 'button', attrs: ['type="button"'], reset: BUTTON_RESET, phrasing: true };
  if (level) return headingElement(level);
  if (isHeadingText(node)) return headingElement((node.fontSize ?? 18) >= 24 ? 2 : 3);
  // 'Button label'처럼 다른 요소의 글자를 뜻하는 이름은 폼 라벨이 아니다.
  if (hasRole(node, 'label') && !hasRole(node, 'button') && !hasRole(node, 'link')) return { tag: 'label', attrs: [], reset: TEXT_RESET, phrasing: true };
  if (hasRole(node, 'link')) return { tag: 'a', attrs: ['href="#"'], reset: { ...TEXT_RESET, ...LINK_RESET }, phrasing: true };
  return { tag: 'p', attrs: [], reset: TEXT_RESET, phrasing: true };
}

/** 입력창. 비밀번호 이름이 붙은 컨테이너 안이면 type="password". */
export function inputElement(password: boolean): Element {
  return { tag: 'input', attrs: [`type="${password ? 'password' : 'text'}"`], reset: INPUT_RESET, phrasing: true };
}

/** 폼 필드의 입력 컨트롤(글자 자리). id는 컴포넌트 안의 useId 값이라 제목 label의 htmlFor와 이어진다. */
export function fieldControl(kind: FieldKind, state: ControlState): Element {
  const common = ['id={fieldId}', ...stateAttrs(state, kind.control)];
  if (kind.control === 'textarea') return { tag: 'textarea', attrs: common, reset: TEXTAREA_RESET, phrasing: true };
  return { tag: 'input', attrs: [...common.slice(0, 1), `type="${kind.type}"`, ...common.slice(1)], reset: INPUT_RESET, phrasing: true };
}

/** 선택 필드의 상자. 실제 목록은 개발 단계에서 붙이므로 열림을 알리는 버튼으로 둔다. */
export function selectBox(state: ControlState): Element {
  return { tag: 'button', attrs: ['type="button"', 'id={fieldId}', 'aria-haspopup="listbox"', ...stateAttrs(state, 'select')], reset: BUTTON_RESET, phrasing: true };
}

/**
 * 그림 하나만 채운 사각형은 alt가 있는 img로 낸다. 바둑판(tile) 채우기는 배경으로 둔다.
 * 색 보정한 그림도 img로 내지 않는다. img에 filter를 걸면 선·그림자까지 보정되므로 ::before 겹에 그린다(addRule).
 */
function imageOnly(node: DesignNode): Extract<DesignNode['fills'][number], { type: 'image' }> | null {
  const paint = node.fills.length === 1 ? node.fills[0]! : null;
  return node.type === 'rectangle' && !node.children?.length && paint?.type === 'image' && paint.fit !== 'tile' && !adjustedImageFill(node) ? paint : null;
}

/**
 * 컨테이너(프레임·그룹·사각형·타원) 요소. 이름으로 역할을 고르고, 문장 요소만 와야 하는 자리면 span으로 둔다.
 * text.any는 안에 보이는 글자가 있는지(없는 버튼은 aria-label이 필요), text.input은 input 이름 컨테이너가 입력창으로 바꿀 글자를 찾았는지,
 * text.label은 글자 없는 버튼의 이름(없으면 레이어 이름)이다.
 */
export function boxElement(node: DesignNode, phrasing: boolean, text: { any: boolean; input: boolean; label?: string }): Element {
  const image = imageOnly(node);
  const decoration = node.role === 'decoration';
  if (image) return { tag: 'img', attrs: [`alt=${JSON.stringify(decoration ? '' : altText(node.name))}`], reset: { display: 'block', objectFit: FIT[image.fit] ?? 'cover' }, phrasing: true, assetId: image.assetId };
  if (node.type === 'rectangle' && adjustedImageFill(node)) {
    // img 대신 낸 색 보정 그림. 설명이 있는 이름이면 그림 역할과 이름을 붙인다(빈 alt와 같은 장식 그림이면 붙이지 않음).
    const alt = decoration ? '' : altText(node.name);
    const attrs = alt ? ['role="img"', `aria-label=${JSON.stringify(alt)}`] : [];
    return phrasing ? { tag: 'span', attrs, reset: { display: 'block' }, phrasing: true } : { tag: 'div', attrs, reset: {}, phrasing: false };
  }
  const marked = decoration ? ['aria-hidden="true"'] : node.role === 'image' ? ['role="img"', `aria-label=${JSON.stringify(cleanName(node.name))}`] : [];
  if (phrasing) return { tag: 'span', attrs: marked, reset: { display: 'block' }, phrasing: true };
  if (marked.length) return { tag: 'div', attrs: marked, reset: {}, phrasing: false };
  if (node.role === 'checkbox') return { tag: 'label', attrs: [], reset: { display: 'block', cursor: 'pointer' }, phrasing: true };
  if (hasRole(node, 'button')) return { tag: 'button', attrs: ['type="button"', ...(text.any ? [] : [`aria-label=${JSON.stringify(text.label ?? cleanName(node.name))}`])], reset: BUTTON_RESET, phrasing: true };
  if (hasRole(node, 'input') && text.input) return { tag: 'label', attrs: [], reset: { display: 'block', cursor: 'text' }, phrasing: true };
  if (hasRole(node, 'link')) return { tag: 'a', attrs: ['href="#"'], reset: { display: 'block', ...LINK_RESET }, phrasing: true };
  if (node.type === 'frame' || node.type === 'group') {
    for (const role of ['nav', 'header', 'footer', 'section'] as const) if (hasRole(node, role)) return { tag: role, attrs: [], reset: {}, phrasing: false };
  }
  return { tag: 'div', attrs: [], reset: {}, phrasing: false };
}

/** 그림 alt. 'Rectangle 12', 'image 3'처럼 도구가 붙인 기본 이름은 내용을 설명하지 않으므로 장식 그림(alt="")으로 본다. */
export function altText(name: string): string {
  return /^(rectangle|image|img|frame|group|ellipse|vector|photo|picture|bitmap|mask)[\s_-]*\d*$/i.test(name.trim()) ? '' : cleanName(name);
}

/** 'Button/Primary', '24/Arrow forward' 같은 경로 이름에서 사람이 읽을 이름만 남긴다(마지막 조각, 앞의 크기 숫자 제거). */
export function cleanName(name: string): string {
  const last = name.split('/').map((part) => part.trim()).filter(Boolean).at(-1) ?? name;
  return last.replace(/^\d+\s*/, '') || last;
}

/** 폼 필드 종류. 디자인 시스템의 Form 세트는 variant Type 값(txt, area, select 등)으로 입력 종류를 나눈다. */
export interface FieldKind { control: 'input' | 'textarea' | 'select'; type: string; value: string }

const FIELD_VALUES: Record<string, Omit<FieldKind, 'value'>> = {
  txt: { control: 'input', type: 'text' }, text: { control: 'input', type: 'text' }, input: { control: 'input', type: 'text' },
  number: { control: 'input', type: 'number' }, email: { control: 'input', type: 'email' }, password: { control: 'input', type: 'password' },
  phone: { control: 'input', type: 'tel' }, phonenumber: { control: 'input', type: 'tel' }, tel: { control: 'input', type: 'tel' },
  search: { control: 'input', type: 'search' },
  // 디자인의 달력 필드는 DD-MM-YYYY 같은 직접 입력 모양이라 브라우저 날짜 선택기(type=date) 대신 글자 입력으로 둔다.
  calendar: { control: 'input', type: 'text' }, date: { control: 'input', type: 'text' },
  area: { control: 'textarea', type: '' }, textarea: { control: 'textarea', type: '' },
  select: { control: 'select', type: '' }, dropdown: { control: 'select', type: '' }, combobox: { control: 'select', type: '' }
};

/** variant 값에서 필드 종류를 찾는다. Type·Kind 같은 속성 값이 위 표에 있으면 필드다. */
export function fieldKind(variant: Record<string, string> | undefined): FieldKind | null {
  for (const [key, raw] of Object.entries(variant ?? {})) {
    if (!/^(type|kind|input)$/i.test(key.trim())) continue;
    const value = raw.trim().toLowerCase();
    const kind = FIELD_VALUES[value.replace(/[\s_-]+/g, '')];
    if (kind) return { ...kind, value };
  }
  return null;
}

/** variant 값에서 읽는 상태. 컨트롤 속성(disabled, readOnly, aria-invalid, defaultChecked)이 된다. */
export interface ControlState { disabled: boolean; readOnly: boolean; invalid: boolean; checked: boolean; filled: boolean }

export function controlState(variant: Record<string, string> | undefined): ControlState {
  const state: ControlState = { disabled: false, readOnly: false, invalid: false, checked: false, filled: false };
  for (const [key, raw] of Object.entries(variant ?? {})) {
    const value = raw.trim().toLowerCase();
    const flag = /^(true|on|yes)$/.test(value);
    if (value === 'disabled' || (/^disabled?$/i.test(key) && flag)) state.disabled = true;
    if (value === 'readonly' || value === 'read only') state.readOnly = true;
    if (value === 'error' || value === 'invalid') state.invalid = true;
    // 값이 채워진 상태의 글자는 placeholder가 아니라 입력된 값이다.
    if (value === 'filled' || value === 'readonly' || value === 'read only') state.filled = true;
    if (value === 'checked' || value === 'selected' || (/^(on|checked|selected|value)$/i.test(key) && flag) || (/^(state|status)$/i.test(key) && value === 'on')) state.checked = true;
  }
  return state;
}

/** 컨트롤 속성 문자열들. */
export function stateAttrs(state: ControlState, control: string): string[] {
  const attrs: string[] = [];
  if (state.disabled) attrs.push('disabled');
  if (state.readOnly && (control === 'input' || control === 'textarea')) attrs.push('readOnly');
  if (state.invalid) attrs.push('aria-invalid="true"');
  return attrs;
}


/** 화면에는 안 보이고 보조 기술에는 읽히는 요소(radio·checkbox의 실제 input). */
export const VISUALLY_HIDDEN: Style = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, border: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

/**
 * 글자·그림 없이 벡터·도형만 든 작은 묶음(아이콘, 라디오 동그라미 등). 장식이므로 span aria-hidden으로 낸다.
 * 버튼·label 안에서도 올바른 HTML이 되고, 의미는 버튼 이름이나 실제 input이 맡는다.
 */
export function isIcon(page: Page, node: DesignNode): boolean {
  if ((node.type !== 'frame' && node.type !== 'group') || node.width > 64 || node.height > 64) return false;
  let shape = false;
  const visit = (current: DesignNode): boolean => {
    for (const id of current.children ?? []) {
      const child = page.objects[id];
      if (!child) continue;
      if (child.type === 'text' || child.fills.some((paint) => paint.type === 'image')) return false;
      if (child.type !== 'frame' && child.type !== 'group') shape = true;
      if (!visit(child)) return false;
    }
    return true;
  };
  return visit(node) && shape;
}
