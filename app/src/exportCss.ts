import type { DesignDocument, DesignNode } from './model';

/** React 스타일 객체와 같은 모양. 숫자는 px로 쓴다(단위 없는 속성 제외). */
export type Style = Record<string, string | number>;
/**
 * CSS 규칙 하나. keepOrder는 같은 요소에 다른 클래스 규칙이 함께 걸려 순서가 중요한 규칙이다
 * (컴포넌트 루트와 인스턴스 위치 클래스). 이런 규칙은 선언이 같아도 다른 규칙과 합치지 않는다.
 */
export interface CssRule { selector: string; style: Style; keepOrder?: boolean; media?: string }

/** CSS에서 px를 붙이지 않는 속성. React 인라인 스타일과 같은 규칙이라 출력 모양이 바뀌지 않는다. */
const UNITLESS = new Set(['opacity', 'fontWeight', 'flexGrow', 'flexShrink', 'zIndex', 'order', 'lineHeight']);

/** 이름을 CSS 클래스·변수용 소문자-하이픈 형태로. 글자가 없거나 숫자로 시작하면 앞에 접두어를 붙인다. */
export function kebab(name: string, fallback = 'el'): string {
  const base = name.normalize('NFKD').replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  if (!base) return fallback;
  return /^[a-z]/.test(base) ? base : `${fallback}-${base}`;
}

/** 파일 안에서 겹치지 않는 이름. 겹치면 -2, -3을 붙인다. */
export function uniqueIn(taken: Set<string>, base: string): string {
  let name = base;
  for (let index = 2; taken.has(name); index++) name = `${base}-${index}`;
  taken.add(name);
  return name;
}

/**
 * 토큰을 CSS 변수로 쓰기 위한 표. byId는 토큰 id → var(), byColor는 색 값(소문자) → var().
 * fonts는 렌더하면서 모으는 글자 스타일 변수(font 줄임 값 → 변수 이름), families는 쓰인 글꼴 → 굵기 목록이다.
 */
export interface TokenVars { byId: Map<string, string>; byColor: Map<string, string>; declarations: string[]; fonts: Map<string, string>; families: Map<string, Set<number>>; taken: Set<string> }

/**
 * 문서의 모든 토큰을 :root CSS 변수로 만든다. 숫자 토큰은 길이(반경·글자 크기·간격)에만 연결되므로 px를 붙인다.
 * 같은 색 값의 토큰이 여럿이면 먼저 나온 토큰을 쓴다.
 */
export function tokenVars(doc: DesignDocument): TokenVars {
  const taken = new Set<string>();
  const vars: TokenVars = { byId: new Map(), byColor: new Map(), declarations: [], fonts: new Map(), families: new Map(), taken };
  for (const token of Object.values(doc.tokens)) {
    const name = uniqueIn(taken, kebab(token.name, 'token'));
    const value = token.type === 'color' ? String(token.value) : `${token.value}px`;
    vars.declarations.push(`  --${name}: ${value};`);
    vars.byId.set(token.id, `var(--${name})`);
    const color = String(token.value).toLowerCase();
    if (token.type === 'color' && !vars.byColor.has(color)) vars.byColor.set(color, `var(--${name})`);
  }
  return vars;
}

const HEX = /#[0-9a-f]{6}(?:[0-9a-f]{2})?\b|#[0-9a-f]{3}\b/gi;

/**
 * 스타일 값을 토큰 변수로 바꾼다. 토큰에 연결된 반경·글자 크기·간격은 변수로, 색은 토큰 값과 같으면 변수로 쓴다.
 * 숫자는 값이 같아도 우연일 수 있어 연결된 경우만 바꾼다.
 */
export function withTokens(style: Style, node: DesignNode, vars: TokenVars): Style {
  if (vars.byId.size === 0) return style;
  const next: Style = { ...style };
  const bound = (slot: keyof NonNullable<DesignNode['tokens']>): string | undefined => {
    const id = node.tokens?.[slot];
    return id ? vars.byId.get(id) : undefined;
  };
  const radius = bound('radius');
  if (radius && next.borderRadius !== undefined) next.borderRadius = radius;
  const fontSize = bound('fontSize');
  if (fontSize && next.fontSize !== undefined) next.fontSize = fontSize;
  const gap = bound('gap');
  for (const key of ['columnGap', 'rowGap']) if (gap && node.layout && next[key] === node.layout.gap) next[key] = gap;
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'string') next[key] = value.replace(HEX, (hex) => vars.byColor.get(hex.toLowerCase()) ?? hex);
  }
  return next;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** 글자 스타일 묶음. family가 있는 텍스트만 변수로 만든다(font 줄임 속성은 글꼴 이름이 꼭 있어야 한다). */
export interface Typography { family: string; stack: string; size: number; weight: number; lineHeight?: number }

/**
 * 글자 스타일을 :root 변수(font 줄임 값)로 등록하고 var()를 돌려준다. 같은 스타일은 같은 변수를 쓴다.
 * 이름은 글꼴-크기-굵기이고 줄 높이만 다르면 -2, -3이 붙는다.
 */
export function typographyVar(vars: TokenVars, type: Typography): string {
  const value = `${type.weight} ${round(type.size)}px/${type.lineHeight === undefined ? 'normal' : `${round(type.lineHeight)}px`} ${type.stack}`;
  const weights = vars.families.get(type.family) ?? new Set<number>();
  weights.add(type.weight);
  vars.families.set(type.family, weights);
  const existing = vars.fonts.get(value);
  if (existing) return existing;
  const name = uniqueIn(vars.taken, `font-${kebab(type.family, 'font')}-${String(round(type.size)).replace('.', '_')}-${type.weight}`);
  vars.declarations.push(`  --${name}: ${value};`);
  vars.fonts.set(value, `var(--${name})`);
  return `var(--${name})`;
}

function declaration(key: string, value: string | number): string {
  const property = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const text = typeof value === 'number' && !UNITLESS.has(key) && value !== 0 ? `${round(value)}px` : String(value);
  return `  ${property}: ${text};`;
}

/** 스타일 객체를 CSS 선언 줄들로. */
export function declarations(style: Style): string[] {
  return Object.entries(style).map(([key, value]) => declaration(key, value));
}

/** 쓰인 글꼴 안내 주석. 웹 글꼴은 프로젝트가 따로 불러와야 디자인과 같은 글자 폭이 나온다. */
function fontNote(vars: TokenVars): string[] {
  if (vars.families.size === 0) return [];
  const list = [...vars.families].map(([family, weights]) => `${family} ${[...weights].sort((a, b) => a - b).join('·')}`).join(', ');
  return [`/* 글꼴: ${list}. 이 글꼴(@font-face 또는 웹 글꼴 서비스)을 프로젝트에서 불러와야 디자인과 같게 보입니다. */`];
}

/**
 * CSS 파일 내용. 글꼴 안내와 토큰 변수(:root)를 맨 앞에 두고, 규칙은 받은 순서대로 쓴다(뒤 규칙이 같은 우선순위에서 이긴다).
 * 선언이 똑같은 규칙은 처음 나온 자리에서 선택자 목록으로 합친다. 합치는 규칙은 한 요소에 하나뿐이라 자리를 옮겨도 결과가 같다.
 */
export function cssText(rules: readonly CssRule[], vars: TokenVars): string {
  const blocks: Array<{ selectors: string[]; body: string }> = [];
  const shared = new Map<string, { selectors: string[]; body: string }>();
  const media = new Map<string, string[]>();
  for (const rule of rules) {
    const body = declarations(rule.style).join('\n');
    // 미디어 쿼리 규칙은 같은 조건끼리 파일 끝에 모아 쓴다(기본 규칙보다 뒤에 있어야 이긴다).
    if (rule.media) { media.set(rule.media, [...(media.get(rule.media) ?? []), `  ${rule.selector} {\n${body.replace(/^/gm, '  ')}\n  }`]); continue; }
    const same = rule.keepOrder ? undefined : shared.get(body);
    if (same) { same.selectors.push(rule.selector); continue; }
    const block = { selectors: [rule.selector], body };
    blocks.push(block);
    if (!rule.keepOrder) shared.set(body, block);
  }
  const root = vars.declarations.length ? [`:root {\n${vars.declarations.join('\n')}\n}`] : [];
  const queries = [...media].map(([query, list]) => `@media ${query} {\n${list.join('\n\n')}\n}`);
  return `${[...fontNote(vars), ...root, ...blocks.map((block) => `${block.selectors.join(',\n')} {\n${block.body}\n}`), ...queries].join('\n\n')}\n`;
}

/** px 값을 rem(16px 기준)으로 바꾼 CSS. 검사 창의 단위 전환에 쓴다. */
export function toRem(css: string): string {
  return css.replace(/(-?\d*\.?\d+)px/g, (_, value: string) => `${round(Number(value) / 16)}rem`);
}
