import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { sampleDocument, solid, type DesignDocument, type NodeInput } from '../src/model';
import { addShape, applyChanges, setToken, updateShape, type Transaction } from '../src/changes';
import { createComponent } from '../src/components';
import { exportTsx } from '../src/export';

const PAGE = 'page-1';
const apply = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, tx.redo);
const add = (doc: DesignDocument, shape: NodeInput): DesignDocument => apply(doc, addShape(doc, PAGE, shape));
const compiles = (code: string): void => { transformSync(code, { loader: 'tsx', jsx: 'automatic' }); };
const rule = (css: string, className: string): string => new RegExp(`\\.${className} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

/** 로그인 폼: 제목, 아이디 입력창(라벨 텍스트 + 입력 상자), 비밀번호 입력창, 로그인 버튼. */
function loginForm(): DesignDocument {
  let doc: DesignDocument = { version: 5, name: 'Login', components: {}, tokens: {}, pages: [{ id: PAGE, name: 'Page 1', children: [], objects: {} }] };
  doc = add(doc, { id: 'form', type: 'frame', name: 'Login form', parentId: null, x: 0, y: 0, width: 400, height: 320, fills: solid('#ffffff') });
  doc = add(doc, { id: 'title', type: 'text', name: 'Title', parentId: 'form', x: 20, y: 20, width: 200, height: 40, fills: solid('#111827'), text: 'Login', fontSize: 32, fontWeight: 700 });
  doc = add(doc, { id: 'id-label', type: 'text', name: 'Label', parentId: 'form', x: 20, y: 70, width: 200, height: 20, fills: solid('#374151'), text: 'Login ID', fontSize: 14 });
  doc = add(doc, { id: 'id-input', type: 'frame', name: 'Input', parentId: 'form', x: 20, y: 95, width: 360, height: 48, fills: solid('#f4f5f8') });
  doc = add(doc, { id: 'id-hint', type: 'text', name: 'Placeholder', parentId: 'id-input', x: 36, y: 108, width: 300, height: 22, fills: solid('#808892'), text: 'Enter email', fontSize: 16 });
  doc = add(doc, { id: 'pw-input', type: 'frame', name: 'Password Input', parentId: 'form', x: 20, y: 160, width: 360, height: 48, fills: solid('#f4f5f8') });
  doc = add(doc, { id: 'pw-hint', type: 'text', name: 'Placeholder', parentId: 'pw-input', x: 36, y: 173, width: 300, height: 22, fills: solid('#808892'), text: 'Enter password', fontSize: 16 });
  doc = add(doc, { id: 'submit', type: 'frame', name: 'Button/Primary', parentId: 'form', x: 20, y: 240, width: 360, height: 54, fills: solid('#1e6fff'), radius: 2 });
  doc = add(doc, { id: 'submit-text', type: 'text', name: 'Button label', parentId: 'submit', x: 160, y: 255, width: 80, height: 24, fills: solid('#ffffff'), text: 'Login', fontSize: 16 });
  return doc;
}

describe('CSS file output', () => {
  it('moves every style into BEM classes in a CSS file the TSX imports', () => {
    const { code, css, cssFile } = exportTsx(sampleDocument(), PAGE, 'frame-1');
    expect(cssFile).toBe('LandingPage.css');
    expect(code).toContain("import './LandingPage.css';");
    expect(code).not.toMatch(/style=\{\{/);
    expect(code).toContain('className={["landing-page", props.className].filter(Boolean).join(\' \')} style={props.style}');
    expect(code).toContain('className="landing-page__hero-panel"');
    expect(rule(css, 'landing-page__hero-panel')).toContain('left: 44px;');
    compiles(code);
  });

  it('writes a solid fill as background-color and gradients above it as background-image', () => {
    const base = sampleDocument();
    const layered = apply(base, updateShape(base, PAGE, 'rect-1', { fills: [...solid('#ffffff'), { type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }] }));
    const { css } = exportTsx(layered, PAGE, 'frame-1');
    expect(rule(css, 'landing-page')).toContain('background-color: #ffffff;');
    expect(css).not.toContain('linear-gradient(#ffffff, #ffffff)');
    expect(rule(css, 'landing-page__hero-panel')).toMatch(/background-color: #ffffff;\n {2}background-image: linear-gradient\(\d+deg/);
  });

  it('keeps class names unique when layers share a name', () => {
    let doc = sampleDocument();
    doc = add(doc, { id: 'twin', type: 'rectangle', name: 'Hero panel', parentId: 'frame-1', x: 0, y: 0, width: 10, height: 10, fills: solid('#000000') });
    const { code } = exportTsx(doc, PAGE, 'frame-1');
    expect(code).toContain('className="landing-page__hero-panel"');
    expect(code).toContain('className="landing-page__hero-panel-2"');
  });
});

describe('semantic tags', () => {
  it('picks heading, paragraph, button, label and input elements from layer names', () => {
    const { code, css } = exportTsx(loginForm(), PAGE, 'form');
    expect(code).toContain('<h1 className="login-form__title">');
    expect(code).toContain('<label className="login-form__label">');
    expect(code).toMatch(/<label className="login-form__input">\s*<input className="login-form__placeholder" type="text" placeholder=\{props\.placeholder\d+ \?\? "Enter email"\} \/>\s*<\/label>/);
    expect(code).toContain('type="password" placeholder={props.placeholder');
    expect(code).toMatch(/<button className="login-form__button-primary" type="button">\s*<span className="login-form__button-label">/);
    expect(rule(css, 'login-form__title')).toContain('margin: 0;');
    expect(rule(css, 'login-form__button-primary')).toContain('border: 0;');
    expect(rule(css, 'login-form__button-primary')).toContain('background-color: #1e6fff;');
    expect(css).toMatch(/\.login-form__placeholder::placeholder \{\s*color: #808892;\s*opacity: 1;/);
    compiles(code);
  });

  it('keeps normal weight on headings and uses p for plain text', () => {
    const { code, css } = exportTsx(sampleDocument(), PAGE, 'frame-1');
    expect(code).toContain('<h1 className="landing-page__heading">');
    expect(code).toContain('<p className="landing-page__description">');
    expect(code).toContain('<button className="landing-page__button" type="button" />');
    expect(code).toContain('<p className="landing-page__button-label">');
    expect(rule(css, 'landing-page__heading')).toContain('font-weight: 400;');
  });

  it('exports a component named Button as a button element', () => {
    const doc = loginForm();
    const withComponent = apply(doc, createComponent(doc, PAGE, 'submit', 'cta'));
    const { code } = exportTsx(withComponent, PAGE, 'submit');
    expect(code).toMatch(/<button className=\{\["button-primary", props\.className\]\.filter\(Boolean\)\.join\(' '\)\} style=\{props\.style\} type="button">/);
    compiles(code);
  });

  it('exports an image-only rectangle as img with alt text', () => {
    const doc = add(sampleDocument(), { id: 'photo', type: 'rectangle', name: 'Hero photo', parentId: 'frame-1', x: 0, y: 0, width: 100, height: 80, fills: [{ type: 'image', assetId: 'abc123', fit: 'fill' }] });
    const { code, css } = exportTsx(doc, PAGE, 'frame-1');
    expect(code).toContain('<img className="landing-page__hero-photo" src="./assets/abc123" alt="Hero photo" />');
    expect(rule(css, 'landing-page__hero-photo')).toContain('object-fit: cover;');
    expect(rule(css, 'landing-page__hero-photo')).not.toContain('background');
  });
});

describe('tokens as CSS variables', () => {
  it('declares every token in :root and uses var() for bound and matching values', () => {
    let doc = sampleDocument();
    doc = apply(doc, setToken(doc, { id: 't-brand', type: 'color', name: 'Brand/Primary', value: '#5369f8' }));
    doc = apply(doc, setToken(doc, { id: 't-radius', type: 'number', name: 'Radius MD', value: 12 }));
    doc = apply(doc, setToken(doc, { id: 't-unused', type: 'color', name: '100', value: '#000000' }));
    doc = apply(doc, updateShape(doc, PAGE, 'rect-2', { tokens: { fill: 't-brand', radius: 't-radius' } }));
    const { css } = exportTsx(doc, PAGE, 'frame-1');
    expect(css).toMatch(/^:root \{\n {2}--brand-primary: #5369f8;\n {2}--radius-md: 12px;\n {2}--token-100: #000000;\n\}/);
    expect(rule(css, 'landing-page__button')).toContain('background-color: var(--brand-primary);');
    expect(rule(css, 'landing-page__button')).toContain('border-radius: var(--radius-md);');
    // 연결되지 않은 숫자는 값이 같아도 바꾸지 않는다.
    expect(rule(css, 'landing-page__hero-panel')).toContain('border-radius: 24px;');
  });
});
