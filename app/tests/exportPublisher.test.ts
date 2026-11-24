import { describe, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { sampleDocument, solid, type DesignDocument, type FlexLayout, type NodeInput } from '../src/model';
import { addShape, applyChanges, setToken, updateShape, type Transaction } from '../src/changes';
import { combineAsVariants, createComponent, createInstance } from '../src/components';
import { exportTsx, inspectCss, inspectSpacing } from '../src/export';
import { toRem } from '../src/exportCss';
import { crc32, createZip } from '../src/zip';

const PAGE = 'page-1';
const apply = (doc: DesignDocument, tx: Transaction): DesignDocument => applyChanges(doc, tx.redo);
const add = (doc: DesignDocument, shape: NodeInput): DesignDocument => apply(doc, addShape(doc, PAGE, shape));
const compiles = (code: string): void => { transformSync(code, { loader: 'tsx', jsx: 'automatic' }); };
// 선언이 같은 규칙은 선택자 목록으로 합쳐지므로, 목록 안 어디에 있어도 찾는다.
const rule = (css: string, className: string): string => new RegExp(`(?:^|,\\n)\\.${className}(?:,\\n[^{]*)? \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';

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
    // 루트는 나머지 HTML 속성(onClick, aria-* 등)을 받고, 밖에서 준 className을 더한다.
    expect(code).toContain('{...rest} className={["landing-page", className].filter(Boolean).join(\' \')} style={style}');
    expect(code).toContain('export interface LandingPageProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "dangerouslySetInnerHTML"');
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
    expect(code).toMatch(/<label className="login-form__input">\s*<input className="login-form__placeholder" type="text" placeholder=\{placeholder\d+ \?\? "Enter email"\} \/>\s*<\/label>/);
    expect(code).toContain('type="password" placeholder={placeholder');
    expect(code).toMatch(/<button className="login-form__button-primary" type="button">\s*<span className="login-form__button-label">/);
    expect(rule(css, 'login-form__title')).toContain('margin: 0;');
    expect(rule(css, 'login-form__button-primary')).toContain('border: 0;');
    expect(rule(css, 'login-form__button-primary')).toContain('background-color: #1e6fff;');
    // 두 입력창의 placeholder 규칙은 선언이 같아 선택자 목록으로 합쳐진다.
    expect(css).toMatch(/\.login-form__placeholder::placeholder,\n\.login-form__placeholder-2::placeholder \{\s*color: #808892;\s*opacity: 1;/);
    compiles(code);
  });

  it('keeps normal weight on headings and uses p for plain text', () => {
    const { code, css } = exportTsx(sampleDocument(), PAGE, 'frame-1');
    expect(code).toContain('<h1 className="landing-page__heading">');
    expect(code).toContain('<p className="landing-page__description">');
    // 글자 없는 버튼은 보조 기술이 읽을 이름이 필요하다.
    expect(code).toContain('<button className="landing-page__button" type="button" aria-label="Button" />');
    expect(code).toContain('<p className="landing-page__button-label">');
    expect(rule(css, 'landing-page__heading')).toContain('font-weight: 400;');
  });

  it('exports a component named Button as a button element', () => {
    const doc = loginForm();
    const withComponent = apply(doc, createComponent(doc, PAGE, 'submit', 'cta'));
    const { code } = exportTsx(withComponent, PAGE, 'submit');
    // 기본 속성(type) 뒤에 rest를 펼쳐, 쓰는 쪽이 type·aria-label·onClick 등을 줄 수 있다.
    expect(code).toMatch(/<button type="button" \{\.\.\.rest\} className=\{\["button-primary", className\]\.filter\(Boolean\)\.join\(' '\)\} style=\{style\}>/);
    compiles(code);
  });

  it('exports an image-only rectangle as img with alt text', () => {
    const doc = add(sampleDocument(), { id: 'photo', type: 'rectangle', name: 'Hero photo', parentId: 'frame-1', x: 0, y: 0, width: 100, height: 80, fills: [{ type: 'image', assetId: 'abc123', fit: 'fill' }] });
    const { code, css } = exportTsx(doc, PAGE, 'frame-1');
    expect(code).toContain("import imageSrc1 from './assets/abc123';");
    expect(code).toContain('<img className="landing-page__hero-photo" src={imageSrc1} alt="Hero photo" />');
    expect(rule(css, 'landing-page__hero-photo')).toContain('object-fit: cover;');
    expect(rule(css, 'landing-page__hero-photo')).not.toContain('background');
  });

  it('leaves an empty placeholder instead of importing an image file that does not exist', () => {
    // 예전 형식 .fig처럼 그림 데이터가 없는 파일. 없는 파일을 import하면 받은 코드가 빌드되지 않는다.
    let doc = add(sampleDocument(), { id: 'photo', type: 'rectangle', name: 'Hero photo', parentId: 'frame-1', x: 0, y: 0, width: 100, height: 80, fills: [{ type: 'image', assetId: 'gone', fit: 'fill' }] });
    doc = add(doc, { id: 'banner', type: 'rectangle', name: 'Banner', parentId: 'frame-1', x: 0, y: 100, width: 100, height: 40, fills: [...solid('#ffffff'), { type: 'image', assetId: 'gone2', fit: 'tile' }] });
    doc = add(doc, { id: 'kept', type: 'rectangle', name: 'Logo', parentId: 'frame-1', x: 0, y: 150, width: 40, height: 40, fills: [{ type: 'image', assetId: 'here', fit: 'fill' }] });
    const result = exportTsx(doc, PAGE, 'frame-1', { hasAsset: (id) => id === 'here' });
    expect(result.missingAssets.sort()).toEqual(['gone', 'gone2']);
    expect(result.assets).toEqual(['here']);
    const files = result.files.map((file) => file.data).join('\n');
    expect(files).not.toMatch(/assets\/gone/);
    expect(files).toContain("from './assets/here';");
    // img 대신 그림 역할과 이름이 있는 빈 자리 상자, 배경은 편집기처럼 체크무늬다.
    expect(result.code).toContain('<div className="landing-page__hero-photo" role="img" aria-label="Hero photo" />');
    expect(rule(result.css, 'landing-page__hero-photo')).toContain('repeating-conic-gradient');
    compiles(result.code);
    // hasAsset을 주지 않으면 이전처럼 모두 있다고 본다.
    expect(exportTsx(doc, PAGE, 'frame-1').missingAssets).toEqual([]);
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

/** Form 세트: variant Type으로 입력 종류를 나눈 디자인 시스템 필드(제목 + 입력 상자 + 도움말). */
function fieldSet(variants: ReadonlyArray<readonly [string, string, string, number]> = [['txt', 'Type=txt, State=default', 'txt', 0], ['sel', 'Type=select, State=disabled', 'select', 400], ['area', 'Type=area, State=error', 'area', 800]]): DesignDocument {
  let doc: DesignDocument = { version: 5, name: 'Fields', components: {}, tokens: {}, pages: [{ id: PAGE, name: 'Page 1', children: [], objects: {} }] };
  const column: FlexLayout = { type: 'flex', direction: 'column', wrap: false, gap: 8, crossGap: 0, padding: [0, 0, 0, 0], justify: 'start', align: 'stretch' };
  const row: FlexLayout = { ...column, direction: 'row', padding: [12, 16, 12, 16], align: 'center' };
  const field = (id: string, variant: string, box: string, x: number): void => {
    doc = add(doc, { id, type: 'frame', name: variant, parentId: null, x, y: 0, width: 280, height: 90, fills: [], layout: column });
    doc = add(doc, { id: `${id}-tit`, type: 'frame', name: 'tit', parentId: id, x, y: 0, width: 280, height: 18, fills: [], layout: { ...row, padding: [0, 0, 0, 0] } });
    doc = add(doc, { id: `${id}-title`, type: 'text', name: 'Title', parentId: `${id}-tit`, x, y: 0, width: 40, height: 18, fills: solid('#111827'), text: 'Email', fontSize: 13, item: { h: 'auto', v: 'auto' } });
    doc = add(doc, { id: `${id}-box`, type: 'frame', name: box, parentId: id, x, y: 26, width: 280, height: 42, fills: solid('#ffffff'), strokes: [{ color: '#d1d5db', width: 1, align: 'inside' }], layout: row });
    doc = add(doc, { id: `${id}-text`, type: 'text', name: 'text', parentId: `${id}-box`, x: x + 16, y: 38, width: 24, height: 18, fills: solid('#9ca3af'), text: 'Enter', fontSize: 14, item: { h: 'auto', v: 'auto' } });
    doc = add(doc, { id: `${id}-hint`, type: 'text', name: 'Help Text', parentId: id, x, y: 76, width: 60, height: 14, fills: solid('#6b7280'), text: 'Help', fontSize: 12 });
    doc = apply(doc, createComponent(doc, PAGE, id, `c-${id}`));
  };
  for (const [id, variant, box, x] of variants) field(id, variant, box, x);
  return apply(doc, combineAsVariants(doc, PAGE, variants.map(([id]) => id), 'form-set', 'Form'));
}

describe('form fields and controls', () => {
  it('turns a Form variant set into label, input, textarea and select button tied by useId', () => {
    const { code, css } = exportTsx(fieldSet(), PAGE, 'form-set');
    expect(code.startsWith("import { useId, type HTMLAttributes } from 'react';")).toBe(true);
    expect(code.match(/const fieldId = useId\(\);/g)).toHaveLength(3);
    expect(code).toMatch(/<label className="form-type-txt-state-default__tit" htmlFor=\{fieldId\}>\s*<span className="form-type-txt-state-default__title">/);
    // 도움말 글자는 id를 받고, 입력은 aria-describedby로 그 글자를 가리킨다.
    expect(code).toMatch(/<input className="form-type-txt-state-default__input" id=\{fieldId\} type="text" aria-describedby=\{`\$\{fieldId\}-hint`\} placeholder=\{text \?\? "Enter"\} \/>/);
    expect(code).toMatch(/<button className="form-type-select-state-disabled__select" type="button" id=\{fieldId\} aria-haspopup="listbox" disabled aria-describedby=\{`\$\{fieldId\}-hint`\}>/);
    expect(code).toMatch(/<textarea className="form-type-area-state-error__input" id=\{fieldId\} aria-invalid="true" aria-describedby=/);
    expect(code).toContain('<p className="form-type-txt-state-default__help-text" id={`${fieldId}-hint`}>');
    // 입력창은 글자에 맞춘 24px 대신 상자의 남는 폭을 채운다.
    expect(rule(css, 'form-type-txt-state-default__input')).toContain('flex: 1 1 0;');
    expect(rule(css, 'form-type-txt-state-default__input')).toContain('min-width: 0;');
    // 고정 폭 상자는 좁은 화면에서 부모보다 넓어지지 않는다.
    expect(rule(css, 'form-type-txt-state-default__txt')).toMatch(/width: 280px;[\s\S]*max-width: 100%;/);
    compiles(code);
  });

  it('wraps a radio with text in a label holding a visually hidden real input', () => {
    let doc: DesignDocument = { version: 5, name: 'Radios', components: {}, tokens: {}, pages: [{ id: PAGE, name: 'Page 1', children: [], objects: {} }] };
    for (const [id, state, x] of [['on', 'state=on', 0], ['off', 'state=off', 200]] as const) {
      doc = add(doc, { id, type: 'frame', name: state, parentId: null, x, y: 0, width: 80, height: 20, fills: [] });
      doc = add(doc, { id: `${id}-dot`, type: 'frame', name: 'Dot', parentId: id, x, y: 2, width: 16, height: 16, fills: [] });
      doc = add(doc, { id: `${id}-circle`, type: 'ellipse', name: 'Ellipse 1', parentId: `${id}-dot`, x, y: 2, width: 16, height: 16, fills: solid('#2563eb') });
      doc = add(doc, { id: `${id}-text`, type: 'text', name: 'text', parentId: id, x: x + 24, y: 0, width: 50, height: 20, fills: solid('#111827'), text: 'Yes', fontSize: 14 });
      doc = apply(doc, createComponent(doc, PAGE, id, `c-${id}`));
    }
    doc = apply(doc, combineAsVariants(doc, PAGE, ['on', 'off'], 'radio-set', 'Radio'));
    const { code, css } = exportTsx(doc, PAGE, 'radio-set');
    // on·off는 구조가 같아 함수 하나로 합쳐지고, 선택 상태는 variant 조건식이 된다.
    expect(code).toMatch(/<label data-state=\{state \?\? "on"\} \{\.\.\.rest\} className=\{\["radio"[^\n]*>\s*<input defaultChecked=\{\(state \?\? "on"\) === "on"\} className="radio__control" type="radio" \/>/);
    expect(code.match(/^(export )?function /gm)).toHaveLength(1);
    expect(code).toContain('<span className="radio__dot" aria-hidden="true">');
    expect(css).toMatch(/clip: rect\(0 0 0 0\);/);
    compiles(code);
  });

  it('marks icons inside buttons as hidden spans, names text-less buttons and leaves default-named images decorative', () => {
    let doc = sampleDocument();
    doc = add(doc, { id: 'close', type: 'frame', name: 'Close button', parentId: 'frame-1', x: 600, y: 20, width: 40, height: 40, fills: solid('#eeeeee') });
    doc = add(doc, { id: 'icon', type: 'frame', name: '24/close', parentId: 'close', x: 608, y: 28, width: 24, height: 24, fills: [] });
    doc = add(doc, { id: 'x', type: 'vector', name: 'Vector', parentId: 'icon', x: 612, y: 32, width: 16, height: 16, fills: [], vectorPaths: [{ d: 'M0 0L16 16', fill: 'none', stroke: '#000000', strokeWidth: 2 }] });
    doc = add(doc, { id: 'deco', type: 'rectangle', name: 'Rectangle 7', parentId: 'frame-1', x: 0, y: 0, width: 50, height: 50, fills: [{ type: 'image', assetId: 'bg1', fit: 'fill' }] });
    const { code } = exportTsx(doc, PAGE, 'frame-1');
    expect(code).toMatch(/<button className="landing-page__close-button" type="button" aria-label="Close button">\s*<span className="landing-page__close" aria-hidden="true">\s*<svg/);
    expect(code).toContain('alt=""');
    compiles(code);
  });
});

describe('responsive layout', () => {
  it('lets the exported screen shrink and turns constraints into CSS', () => {
    let doc = sampleDocument();
    const box = (id: string, constraints: NonNullable<NodeInput['constraints']>): void => {
      // 흐름 밖(절대 위치) 도형의 제약 변환을 본다. 레이아웃 없는 프레임의 나머지 자식은 흐름 배치(inferFlow)로 나간다.
      doc = add(doc, { id, type: 'rectangle', name: id, parentId: 'frame-1', x: 220, y: 135, width: 100, height: 40, fills: solid('#000000'), constraints, item: { absolute: true } });
    };
    box('pin-right', { h: 'right', v: 'bottom' });
    box('stretch', { h: 'left-right', v: 'top' });
    box('middle', { h: 'center', v: 'center' });
    box('ratio', { h: 'scale', v: 'scale' });
    const { css } = exportTsx(doc, PAGE, 'frame-1');
    expect(rule(css, 'landing-page')).toMatch(/width: 100%;\n {2}max-width: 720px;\n {2}min-height: 520px;/);
    expect(rule(css, 'landing-page__pin-right')).toMatch(/right: 520px;\n {2}bottom: 440px;\n {2}width: 100px;\n {2}height: 40px;/);
    expect(rule(css, 'landing-page__stretch')).toMatch(/left: 100px;\n {2}top: 40px;\n {2}right: 520px;\n {2}height: 40px;/);
    expect(rule(css, 'landing-page__stretch')).not.toContain('width');
    expect(rule(css, 'landing-page__middle')).toContain('left: calc(50% - 260px);');
    expect(rule(css, 'landing-page__middle')).toContain('top: calc(50% - 220px);');
    expect(rule(css, 'landing-page__ratio')).toMatch(/left: 13\.89%;\n {2}top: 7\.69%;\n {2}width: 13\.89%;\n {2}height: 7\.69%;/);
  });

  it('stacks wide row layouts on narrow screens with a media query at the end of the file', () => {
    let doc = sampleDocument();
    const layout = { type: 'flex', direction: 'row', wrap: false, gap: 24, crossGap: 0, padding: [0, 0, 0, 0], justify: 'start', align: 'start' } as FlexLayout;
    doc = add(doc, { id: 'cols', type: 'frame', name: 'Columns', parentId: 'frame-1', x: 120, y: 95, width: 680, height: 100, fills: [], layout });
    doc = add(doc, { id: 'chips', type: 'frame', name: 'Chips', parentId: 'frame-1', x: 120, y: 300, width: 200, height: 40, fills: [], layout });
    const { css } = exportTsx(doc, PAGE, 'frame-1');
    // 디자인 폭에서는 높이 고정, 좁은 화면에서만 높이를 풀고 세로로 쌓는다.
    expect(rule(css, 'landing-page__columns')).toContain('height: 100px;');
    expect(css).toMatch(/@media \(max-width: 767px\) \{\n {2}\.landing-page__columns \{\n {4}height: auto;\n {4}min-height: 100px;\n {4}flex-direction: column;\n {4}align-items: stretch;\n {4}column-gap: 0;\n {4}row-gap: 24px;\n {2}\}/);
    // 좁은 가로 묶음(칩·버튼 줄)은 쌓지 않고 높이만 푼다.
    expect(css).toMatch(/@media \(max-width: 767px\) \{[\s\S]*? {2}\.landing-page__chips \{\n {4}height: auto;\n {4}min-height: 40px;\n {2}\}/);
    // 글자 상자는 처음부터 최소 높이라 줄이 늘면 함께 늘어난다.
    expect(rule(css, 'landing-page__heading')).toContain('min-height: 72px;');
  });
});

describe('typography and CSS reuse', () => {
  it('bundles text styles into font variables, lists fonts and keeps rich text spans', () => {
    let doc = sampleDocument();
    doc = add(doc, { id: 'rich', type: 'text', name: 'Rich', parentId: 'frame-1', x: 130, y: 30, width: 300, height: 24, fills: solid('#111111'), text: 'Hello world', fontSize: 16, fontWeight: 700, fontFamily: 'Roboto', lineHeight: 24, spans: [{ start: 6, end: 11, color: '#ff0000', fontWeight: 400 }] });
    doc = add(doc, { id: 'twin', type: 'text', name: 'Twin', parentId: 'frame-1', x: 130, y: 60, width: 300, height: 24, fills: solid('#111111'), text: 'Again', fontSize: 16, fontWeight: 700, fontFamily: 'Roboto', lineHeight: 24 });
    const { code, css } = exportTsx(doc, PAGE, 'frame-1');
    expect(css.startsWith('/* 글꼴: Roboto 700.')).toBe(true);
    expect(css).toContain("--font-roboto-16-700: 700 16px/24px 'Roboto', 'DM Sans', Inter, 'Segoe UI', sans-serif;");
    expect(rule(css, 'landing-page__rich')).toContain('font: var(--font-roboto-16-700);');
    expect(rule(css, 'landing-page__twin')).toContain('font: var(--font-roboto-16-700);');
    expect(rule(css, 'landing-page__rich')).not.toContain('font-size');
    expect(code).toMatch(/\{rich\d+ \?\? <>\{"Hello "\}<span className="landing-page__rich-run">\{"world"\}<\/span><\/>\}/);
    expect(rule(css, 'landing-page__rich-run')).toMatch(/font-weight: 400;\n {2}color: #ff0000;/);
    compiles(code);
  });

  it('merges identical rules into one selector list but keeps component root and placement rules apart', () => {
    let doc = sampleDocument();
    for (const id of ['dot-a', 'dot-b']) doc = add(doc, { id, type: 'rectangle', name: 'Dot', parentId: 'frame-1', x: 130, y: 30, width: 10, height: 10, fills: solid('#000000') });
    const { css } = exportTsx(doc, PAGE, 'frame-1');
    expect(css).toContain('.landing-page__dot,\n.landing-page__dot-2 {');
  });
});

describe('handoff helpers', () => {
  it('shows one element CSS for the inspect panel in px or rem', () => {
    const css = inspectCss(sampleDocument(), PAGE, 'rect-1');
    expect(css).toMatch(/^\.hero-panel \{\n {2}position: absolute;\n {2}left: 44px;/);
    expect(toRem(css)).toContain('left: 2.75rem;');
    expect(toRem('margin: -8px 0.5px')).toBe('margin: -0.5rem 0.03rem');
    // 부모(720×520) 안의 632×336 패널: 왼쪽 44, 위 55.
    expect(inspectSpacing(sampleDocument(), PAGE, 'rect-1')).toEqual({ top: 55, left: 44, right: 44, bottom: 129 });
    expect(inspectSpacing(sampleDocument(), PAGE, 'frame-1')).toBeNull();
  });

  it('writes a stored zip with UTF-8 names and correct checksums, and refuses paths outside the folder', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const zip = createZip([{ path: 'Card.tsx', data: 'hello' }, { path: 'assets/a.png', data: new Uint8Array([1, 2, 3]) }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(14, true)).toBe(0x3610a686);
    expect(new TextDecoder().decode(zip.slice(30, 38))).toBe('Card.tsx');
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    expect(view.getUint32(view.getUint32(end + 16, true), true)).toBe(0x02014b50);
    expect(() => createZip([{ path: '../evil.txt', data: 'x' }])).toThrow(/폴더 밖/);
    expect(() => createZip([{ path: 'C:\\evil.txt', data: 'x' }])).toThrow(/폴더 밖/);
  });
});

/**
 * 카드 목록 화면. 루트·줄은 기본 이름(Frame …)이고, 제목 글자 레이어 이름은 글 내용 그대로다.
 * Card 세트는 Tone=Primary·Secondary 두 variant(채우기 색만 다름)이고 같은 이름(Meta)의 글자가 둘 있다. 줄에는 Card 인스턴스 셋이 있다.
 */
function cardScreen(): DesignDocument {
  let doc: DesignDocument = { version: 5, name: 'Cards', components: {}, tokens: {}, pages: [{ id: PAGE, name: 'Page 1', children: [], objects: {} }] };
  const row: FlexLayout = { type: 'flex', direction: 'row', wrap: false, gap: 16, crossGap: 0, padding: [0, 0, 0, 0], justify: 'start', align: 'start' };
  for (const [id, name, fill, x] of [['card-a', 'Tone=Primary', '#5369f8', 0], ['card-b', 'Tone=Secondary', '#ffffff', 300]] as const) {
    doc = add(doc, { id, type: 'frame', name, parentId: null, x, y: 600, width: 200, height: 120, fills: solid(fill) });
    doc = add(doc, { id: `${id}-title`, type: 'text', name: 'Title', parentId: id, x: x + 10, y: 610, width: 180, height: 24, fills: solid('#111827'), text: 'Card', fontSize: 16 });
    doc = add(doc, { id: `${id}-meta`, type: 'text', name: 'Meta', parentId: id, x: x + 10, y: 640, width: 180, height: 20, fills: solid('#6b7280'), text: 'Author', fontSize: 12 });
    doc = add(doc, { id: `${id}-meta2`, type: 'text', name: 'Meta', parentId: id, x: x + 10, y: 670, width: 180, height: 20, fills: solid('#6b7280'), text: 'Date', fontSize: 12 });
    doc = apply(doc, createComponent(doc, PAGE, id, `c-${id}`));
  }
  doc = apply(doc, combineAsVariants(doc, PAGE, ['card-a', 'card-b'], 'card-set', 'Card'));
  doc = add(doc, { id: 'screen', type: 'frame', name: 'Frame 1707482846', parentId: null, x: 0, y: 0, width: 1000, height: 400, fills: [] });
  doc = add(doc, { id: 'headline', type: 'text', name: 'Build faster with cards', parentId: 'screen', x: 20, y: 20, width: 600, height: 48, fills: solid('#111827'), text: 'Build faster with cards', fontSize: 40, fontWeight: 700 });
  doc = add(doc, { id: 'list', type: 'frame', name: 'Frame 12', parentId: 'screen', x: 20, y: 100, width: 960, height: 120, fills: [], layout: row });
  ['c-card-a', 'c-card-b', 'c-card-a'].forEach((componentId, index) => {
    doc = apply(doc, createInstance(doc, PAGE, componentId, { parentId: 'list', x: 20 + index * 216, y: 100 }, () => `item-${index}`).tx);
  });
  return doc;
}

describe('production-ready structure', () => {
  it('names elements by role when layer names are tool defaults or sentences', () => {
    const { name, code, css } = exportTsx(cardScreen(), PAGE, 'screen');
    expect(name).toBe('Screen');
    // 내용이 이름인 큰 굵은 글자는 이름에 title이 없어도 제목이다.
    expect(code).toContain('<h1 className="screen__title">');
    expect(code).toContain('className="screen__row"');
    expect(css).not.toMatch(/frame-\d|build-faster/);
  });

  it('marks a row of the same component as a list', () => {
    const { code } = exportTsx(cardScreen(), PAGE, 'screen');
    expect(code).toMatch(/<div className="screen__row" role="list">/);
    expect(code.match(/<Card [^\n]*role="listitem"/g)).toHaveLength(3);
  });

  it('merges variants with the same structure into one component styled by data attributes', () => {
    const { code, css } = exportTsx(cardScreen(), PAGE, 'card-set');
    expect(code.match(/^(export )?function /gm)).toHaveLength(1);
    expect(code).toContain('data-tone={tone ?? "Primary"}');
    expect(rule(css, 'card')).toContain('background-color: #5369f8;');
    // 다른 variant는 다른 선언만, 우선순위를 올리지 않는 :where 아래에 낸다(인스턴스 위치 클래스가 계속 이긴다).
    expect(css).toMatch(/\.card:where\(\[data-tone="Secondary"\]\) \{\n {2}background-color: #ffffff;\n\}/);
    // 같은 이름의 글자 둘은 prop이 겹치지 않는다(같은 이름 속성이 두 번 나오면 JSX 오류).
    expect(code).toMatch(/meta\?: string;\n {2}meta2\?: string;/);
    expect(code).toContain('{meta ?? "Author"}');
    expect(code).toContain('{meta2 ?? "Date"}');
    compiles(code);
  });

  it('turns state differences into conditions when variants share a structure', () => {
    const { code } = exportTsx(fieldSet([['txt', 'Type=txt, State=default', 'txt', 0], ['off', 'Type=txt, State=disabled', 'txt', 400]]), PAGE, 'form-set');
    expect(code.match(/^(export )?function /gm)).toHaveLength(1);
    expect(code).toContain('<input disabled={(state ?? "default") === "disabled"} className=');
    compiles(code);
  });

  it('splits components into their own files with CSS imported after the components they use', () => {
    const { files } = exportTsx(cardScreen(), PAGE, 'screen');
    expect(files.map((file) => file.path).sort()).toEqual(['Screen.css', 'Screen.tsx', 'components/Card.css', 'components/Card.tsx', 'components/index.ts']);
    const screen = files.find((file) => file.path === 'Screen.tsx')!.data;
    expect(screen.indexOf("import { Card } from './components/Card';")).toBeLessThan(screen.indexOf("import './Screen.css';"));
    expect(screen).not.toContain('export function Card');
    expect(files.find((file) => file.path === 'components/Card.tsx')!.data).toContain("import './Card.css';");
    expect(files.find((file) => file.path === 'components/index.ts')!.data).toBe("export * from './Card';\n");
    for (const file of files.filter((item) => item.path.endsWith('.tsx'))) compiles(file.data);
  });

  it('puts tokens in one tokens.css every file imports and fixes asset paths in component folders', () => {
    let doc = cardScreen();
    doc = apply(doc, setToken(doc, { id: 't-brand', type: 'color', name: 'Brand', value: '#5369f8' }));
    doc = apply(doc, updateShape(doc, PAGE, 'card-a', { fills: [{ type: 'image', assetId: 'bg1', fit: 'tile' }] }));
    const { files } = exportTsx(doc, PAGE, 'screen');
    const file = (path: string): string => files.find((item) => item.path === path)?.data ?? '';
    expect(file('tokens.css')).toContain('--brand: #5369f8;');
    expect(file('Screen.tsx')).toContain("import './tokens.css';");
    expect(file('components/Card.tsx')).toContain("import '../tokens.css';");
    expect(file('components/Card.css')).toContain('url("../assets/bg1")');
    expect(file('components/Card.css')).not.toContain(':root');
  });
});
