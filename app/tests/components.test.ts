import { describe, expect, it } from 'vitest';
import { parseDocument, sampleDocument, solid, walkPage, type DesignDocument } from '../src/model';
import { addShape, applyChanges, deleteShape, moveShapes, resizeShape, setToken, updateShape, type Transaction } from '../src/changes';
import { applyToken, combineAsVariants, createComponent, createInstance, detachInstance, resetOverrides, switchVariant } from '../src/components';
import { normalizeAfterEdit } from '../src/normalize';

const PAGE = 'page-1';
const page = (doc: DesignDocument) => doc.pages[0]!;
const node = (doc: DesignDocument, id: string) => page(doc).objects[id]!;

function apply(doc: DesignDocument, tx: Transaction): DesignDocument {
  return applyChanges(doc, normalizeAfterEdit(doc, tx).redo);
}

/** sample의 Landing page를 컴포넌트로 만들고 x 1000에 인스턴스 하나를 둔다. */
function withInstance(): DesignDocument {
  const base = sampleDocument();
  const component = apply(base, createComponent(base, PAGE, 'frame-1', 'card'));
  const { tx } = createInstance(component, PAGE, 'card', { parentId: null, x: 1000, y: 95 }, () => 'inst');
  return apply(component, tx);
}

describe('components', () => {
  it('copies the main into an instance with shape references', () => {
    const doc = withInstance();
    expect(doc.components.card).toMatchObject({ mainId: 'frame-1', pageId: PAGE });
    expect(node(doc, 'inst')).toMatchObject({ componentId: 'card', shapeRef: 'frame-1', x: 1000 });
    expect(node(doc, 'inst/text-1')).toMatchObject({ shapeRef: 'text-1', text: 'Design starts here', x: 1090 });
    expect(node(doc, 'inst').mainInstance).toBeUndefined();
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });

  it('propagates main edits but keeps the overridden group', () => {
    const doc = withInstance();
    const overridden = apply(doc, updateShape(doc, PAGE, 'inst/text-1', { text: 'Custom' }));
    expect(node(overridden, 'inst/text-1').touched).toEqual(['content']);
    const edited = apply(overridden, updateShape(overridden, PAGE, 'text-1', { text: 'New main', fills: solid('#ff0000') }));
    expect(node(edited, 'inst/text-1')).toMatchObject({ text: 'Custom', fills: solid('#ff0000') });
    expect(node(edited, 'inst/text-2').text).toBe('Shape ideas into reusable interfaces.');
  });

  it('does not treat moving the whole instance as an override', () => {
    const doc = withInstance();
    const moved = apply(doc, moveShapes(doc, PAGE, 'inst', 50, 20));
    expect(walkPage(page(moved), ['inst']).some((item) => item.touched?.length)).toBe(false);
    const mainMoved = apply(moved, moveShapes(moved, PAGE, 'rect-2', 10, 0));
    expect(node(mainMoved, 'inst/rect-2').x).toBe(node(mainMoved, 'rect-2').x + 930);
  });

  it('adds and removes shapes when the main structure changes', () => {
    const doc = withInstance();
    const added = apply(doc, addShape(doc, PAGE, { id: 'badge', type: 'ellipse', name: 'Badge', parentId: 'frame-1', x: 800, y: 100, width: 20, height: 20, fills: solid('#00ff00') }));
    expect(node(added, 'inst/badge')).toMatchObject({ shapeRef: 'badge', x: 1680, y: 100 });
    const removed = apply(added, deleteShape(added, PAGE, 'text-2'));
    expect(page(removed).objects['inst/text-2']).toBeUndefined();
  });

  it('keeps a resized instance at its size and re-applies constraints after a main change', () => {
    const doc = withInstance();
    const pinned = apply(doc, updateShape(doc, PAGE, 'rect-2', { constraints: { h: 'right', v: 'top' } }));
    const resized = apply(pinned, resizeShape(pinned, PAGE, 'inst', { x: 1000, y: 95, width: 820, height: 520 }));
    expect(node(resized, 'inst').touched).toEqual(['geometry']);
    expect(node(resized, 'inst/rect-2').x).toBe(1000 + 90 + 100);
    const changed = apply(resized, moveShapes(resized, PAGE, 'rect-2', 0, 5));
    expect(node(changed, 'inst')).toMatchObject({ width: 820 });
    expect(node(changed, 'inst/rect-2')).toMatchObject({ x: 1190, y: node(changed, 'rect-2').y });
  });

  it('resets overrides and detaches', () => {
    const doc = withInstance();
    const overridden = apply(doc, updateShape(doc, PAGE, 'inst/text-1', { text: 'Custom' }));
    const reset = apply(overridden, resetOverrides(overridden, PAGE, 'inst'));
    expect(node(reset, 'inst/text-1')).toMatchObject({ text: 'Design starts here' });
    expect(node(reset, 'inst/text-1').touched).toBeUndefined();
    const detached = apply(reset, detachInstance(reset, PAGE, 'inst'));
    expect(walkPage(page(detached), ['inst']).every((item) => !item.shapeRef && !item.componentId)).toBe(true);
    const later = apply(detached, updateShape(detached, PAGE, 'text-1', { text: 'Main only' }));
    expect(node(later, 'inst/text-1').text).toBe('Design starts here');
  });

  it('undoes a main edit together with its propagation', () => {
    const doc = withInstance();
    const full = normalizeAfterEdit(doc, updateShape(doc, PAGE, 'text-1', { text: 'Changed' }));
    const after = applyChanges(doc, full.redo);
    expect(node(after, 'inst/text-1').text).toBe('Changed');
    expect(applyChanges(after, full.undo)).toEqual(doc);
  });

  it('rejects documents whose instances point to unknown components', () => {
    const broken = JSON.parse(JSON.stringify(withInstance())) as DesignDocument;
    delete (broken.components as Record<string, unknown>).card;
    expect(() => parseDocument(JSON.stringify(broken))).toThrow();
  });
});

describe('variants', () => {
  function buttonSet(): DesignDocument {
    let doc = sampleDocument();
    const add = (id: string, name: string, fill: string, x: number) => {
      doc = apply(doc, addShape(doc, PAGE, { id, type: 'frame', name, parentId: null, x, y: 700, width: 120, height: 40, fills: solid(fill) }));
      doc = apply(doc, addShape(doc, PAGE, { id: `${id}-label`, type: 'text', name: 'Label', parentId: id, x: x + 10, y: 710, width: 100, height: 20, fills: solid('#ffffff'), text: 'Button' }));
      doc = apply(doc, createComponent(doc, PAGE, id, `c-${id}`));
    };
    add('primary', 'State=Default', '#5369f8', 100);
    add('disabled', 'State=Disabled', '#cccccc', 300);
    return apply(doc, combineAsVariants(doc, PAGE, ['primary', 'disabled'], 'button-set', 'Button'));
  }

  it('groups mains into a set and reads their properties', () => {
    const doc = buttonSet();
    expect(node(doc, 'button-set')).toMatchObject({ componentSet: true, children: ['primary', 'disabled'] });
    expect(doc.components['c-primary']).toMatchObject({ name: 'Button', setId: 'button-set', variant: { State: 'Default' } });
  });

  it('switches variant and carries the text override over', () => {
    const doc = buttonSet();
    const created = createInstance(doc, PAGE, 'c-primary', { parentId: null, x: 600, y: 700 }, () => 'b1');
    let next = apply(doc, created.tx);
    next = apply(next, updateShape(next, PAGE, 'b1/primary-label', { text: 'Save' }));
    const switched = switchVariant(next, PAGE, 'b1', 'c-disabled', () => 'b2');
    next = apply(next, switched.tx);
    expect(page(next).objects.b1).toBeUndefined();
    expect(node(next, 'b2')).toMatchObject({ componentId: 'c-disabled', x: 600, fills: solid('#cccccc') });
    expect(node(next, 'b2/disabled-label')).toMatchObject({ text: 'Save', touched: ['content'] });
  });
});

describe('tokens', () => {
  it('updates every bound property when the token value changes, including instances', () => {
    const doc = withInstance();
    const tokened = apply(doc, setToken(doc, { id: 'brand', name: 'Brand/Primary', type: 'color', value: '#123456' }));
    const bound = apply(tokened, applyToken(tokened, PAGE, 'rect-2', 'fill', 'brand'));
    expect(node(bound, 'rect-2')).toMatchObject({ fills: solid('#123456'), tokens: { fill: 'brand' } });
    expect(node(bound, 'inst/rect-2').fills).toEqual(solid('#123456'));
    const changed = apply(bound, setToken(bound, { id: 'brand', name: 'Brand/Primary', type: 'color', value: '#ff8800' }));
    expect(node(changed, 'rect-2').fills).toEqual(solid('#ff8800'));
    expect(node(changed, 'inst/rect-2').fills).toEqual(solid('#ff8800'));
    expect(() => applyToken(changed, PAGE, 'rect-2', 'radius', 'brand')).toThrow();
    expect(parseDocument(JSON.stringify(changed))).toEqual(changed);
  });
});

describe('component export', () => {
  /** implementation-plan.md 첫 검증 시나리오: label·variant·disabled props를 가진 버튼. */
  function buttonScreen(): DesignDocument {
    let doc = sampleDocument();
    const variants: Array<[string, string, string]> = [['b-pf', 'Variant=Primary, Disabled=false', '#5369f8'], ['b-pt', 'Variant=Primary, Disabled=true', '#c7cbe0'], ['b-sf', 'Variant=Secondary, Disabled=false', '#ffffff']];
    variants.forEach(([id, name, fill], index) => {
      doc = apply(doc, addShape(doc, PAGE, { id, type: 'frame', name, parentId: null, x: 100 + index * 200, y: 700, width: 120, height: 40, fills: solid(fill) }));
      doc = apply(doc, addShape(doc, PAGE, { id: `${id}-label`, type: 'text', name: 'Label', parentId: id, x: 110 + index * 200, y: 710, width: 100, height: 20, fills: solid('#ffffff'), text: 'Button' }));
      doc = apply(doc, createComponent(doc, PAGE, id, `c-${id}`));
    });
    doc = apply(doc, combineAsVariants(doc, PAGE, ['b-pf', 'b-pt', 'b-sf'], 'button-set', 'Button'));
    const created = createInstance(doc, PAGE, 'c-b-pt', { parentId: 'frame-1', x: 500, y: 450 }, () => 'cta');
    doc = apply(doc, created.tx);
    return apply(doc, updateShape(doc, PAGE, 'cta/b-pt-label', { text: 'Save' }));
  }

  it('exports the set as one component with union, boolean and text props', async () => {
    const { transformSync } = await import('esbuild');
    const doc = buttonScreen();
    const { name, code } = (await import('../src/export')).exportTsx(doc, PAGE, 'button-set');
    expect(name).toBe('Button');
    expect(code).toContain('variant?: "Primary" | "Secondary";');
    expect(code).toContain('disabled?: boolean;');
    expect(code).toContain('label?: string;');
    expect(code).toContain('export function Button(props: ButtonProps)');
    // variant 메인의 레이어 이름은 속성뿐이어도 세트 이름(Button)으로 button 요소가 된다.
    expect(code.match(/<button className=\{\["button-/g)?.length).toBe(doc.pages[0]!.objects['button-set']!.children!.length);
    expect(() => transformSync(code, { loader: 'tsx', jsx: 'automatic' })).not.toThrow();
  });

  it('renders an instance as a component usage with its variant and overridden text', async () => {
    const { transformSync } = await import('esbuild');
    const doc = buttonScreen();
    const { code } = (await import('../src/export')).exportTsx(doc, PAGE, 'frame-1');
    expect(code).toMatch(/<Button className="[a-z0-9_-]+" variant="Primary" disabled=\{true\} label="Save" \/>/);
    expect(code).toContain('export interface ButtonProps');
    expect(code).not.toContain('"text":"Save"');
    expect(() => transformSync(code, { loader: 'tsx', jsx: 'automatic' })).not.toThrow();
  });
});

describe('real file components', () => {
  const file = process.env.FIGMA_TEST_FILE;
  (file ? it : it.skip)('links instances to imported mains without moving anything and exports compilable code', async () => {
    const { readFileSync } = await import('node:fs');
    const { transformSync } = await import('esbuild');
    const { parseFig } = await import('openfig-core');
    const { importFigNode } = await import('../src/figmaImport');
    const { exportTsx } = await import('../src/export');
    const { document, report } = importFigNode(parseFig(new Uint8Array(readFileSync(file!))), '779:23219');
    expect(report.components).toBeGreaterThan(0);
    expect(report.unappliedOverrides).toBe(0);
    expect(parseDocument(JSON.stringify(document))).toEqual(document);
    const frame = page(document);
    for (const componentId of new Set(Object.values(frame.objects).filter((item) => item.componentId && !item.mainInstance).map((item) => item.componentId!))) {
      const component = document.components[componentId]!;
      const main = document.pages.find((item) => item.id === component.pageId)!.objects[component.mainId]!;
      const after = apply(document, updateShape(document, component.pageId, main.id, { name: `${main.name}!` }));
      const moved = Object.values(frame.objects).filter((item) => { const next = page(after).objects[item.id]; return !next || Math.abs(next.x - item.x) > 0.5 || Math.abs(next.y - item.y) > 0.5 || Math.abs(next.width - item.width) > 0.5 || Math.abs(next.height - item.height) > 0.5; });
      expect(moved.length, component.name).toBe(0);
    }
    expect(() => transformSync(exportTsx(document, 'page-1', '779:23219').code, { loader: 'tsx', jsx: 'automatic' })).not.toThrow();
  });
});
