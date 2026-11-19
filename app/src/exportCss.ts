import type { DesignDocument, DesignNode } from './model';

/** React 스타일 객체와 같은 모양. 숫자는 px로 쓴다(단위 없는 속성 제외). */
export type Style = Record<string, string | number>;
export interface CssRule { selector: string; style: Style }

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

/** 토큰을 CSS 변수로 쓰기 위한 표. byId는 토큰 id → var(), byColor는 색 값(소문자) → var(). */
export interface TokenVars { byId: Map<string, string>; byColor: Map<string, string>; declarations: string[] }

/**
 * 문서의 모든 토큰을 :root CSS 변수로 만든다. 숫자 토큰은 길이(반경·글자 크기·간격)에만 연결되므로 px를 붙인다.
 * 같은 색 값의 토큰이 여럿이면 먼저 나온 토큰을 쓴다.
 */
export function tokenVars(doc: DesignDocument): TokenVars {
  const vars: TokenVars = { byId: new Map(), byColor: new Map(), declarations: [] };
  const taken = new Set<string>();
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

function declaration(key: string, value: string | number): string {
  const property = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const text = typeof value === 'number' && !UNITLESS.has(key) && value !== 0 ? `${round(value)}px` : String(value);
  return `  ${property}: ${text};`;
}

/** CSS 파일 내용. 토큰 변수(:root)를 맨 앞에 두고, 규칙은 받은 순서대로 쓴다(뒤 규칙이 같은 우선순위에서 이긴다). */
export function cssText(rules: readonly CssRule[], vars: TokenVars): string {
  const blocks = vars.declarations.length ? [`:root {\n${vars.declarations.join('\n')}\n}`] : [];
  for (const rule of rules) blocks.push(`${rule.selector} {\n${Object.entries(rule.style).map(([key, value]) => declaration(key, value)).join('\n')}\n}`);
  return `${blocks.join('\n\n')}\n`;
}
