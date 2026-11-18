import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleDocument, type DesignDocument } from '../src/model';
import { applyChanges, type Transaction } from '../src/changes';
import { normalizeAfterEdit } from '../src/normalize';
import { PluginError, handlePluginCall, readManifest, type PluginHost } from '../src/pluginApi';
import { escapeScript, pluginDocument } from '../src/pluginRuntime';

/** 편집기 대신 문서·선택·undo 기록을 들고 있는 가짜 호스트. */
function host() {
  const state = { doc: sampleDocument(), selection: ['rect-2'], history: [] as Transaction[], notices: [] as string[], seq: 0 };
  const api: PluginHost = {
    doc: () => state.doc,
    pageId: () => 'page-1',
    selection: () => state.selection,
    edit: (build) => {
      try { const full = normalizeAfterEdit(state.doc, build(state.doc)); state.doc = applyChanges(state.doc, full.redo); state.history.push(full); return true; }
      catch { return false; }
    },
    select: (ids) => { state.selection = ids; },
    notify: (text) => { state.notices.push(text); },
    newId: () => `new-${++state.seq}`
  };
  return { api, state };
}

const node = (doc: DesignDocument, id: string) => doc.pages[0]!.objects[id]!;

describe('plugin API', () => {
  it('reads the page, nodes and selection as plain copies', () => {
    const { api, state } = host();
    expect(handlePluginCall(api, 'getPage', [], ['read'])).toMatchObject({ id: 'page-1', children: ['frame-1'] });
    const selection = handlePluginCall(api, 'getSelection', [], ['read']) as Array<{ id: string; name: string }>;
    selection[0]!.name = 'tampered';
    expect(node(state.doc, 'rect-2').name).toBe('Button');
    expect((handlePluginCall(api, 'findNodes', [{ type: 'text', name: 'head' }], ['read']) as unknown[]).length).toBe(1);
  });

  it('creates, updates and deletes through undoable edits', () => {
    const { api, state } = host();
    const id = handlePluginCall(api, 'createShape', [{ type: 'rectangle', name: 'From plugin', parentId: 'frame-1', x: 130, y: 100, width: 40, height: 40, fills: [{ type: 'solid', color: '#ff0000' }] }], ['read', 'write']) as string;
    expect(node(state.doc, id)).toMatchObject({ parentId: 'frame-1', width: 40 });
    handlePluginCall(api, 'updateShape', [id, { name: 'Renamed', width: 80, opacity: 0.5 }], ['write']);
    expect(node(state.doc, id)).toMatchObject({ name: 'Renamed', width: 80, opacity: 0.5 });
    expect(handlePluginCall(api, 'deleteShapes', [[id, 'missing']], ['write'])).toBe(1);
    expect(state.doc.pages[0]!.objects[id]).toBeUndefined();
    expect(state.history).toHaveLength(3);
    handlePluginCall(api, 'select', [['text-1', 'nope']], ['write']);
    expect(state.selection).toEqual(['text-1']);
  });

  it('refuses calls outside the granted permissions and malformed values', () => {
    const { api, state } = host();
    const before = state.doc;
    expect(() => handlePluginCall(api, 'createShape', [{ type: 'rectangle' }], ['read'])).toThrow('쓰기 권한');
    expect(() => handlePluginCall(api, 'getPage', [], ['write'])).toThrow('읽기 권한');
    expect(() => handlePluginCall(api, 'eval', [], ['read', 'write'])).toThrow(PluginError);
    expect(() => handlePluginCall(api, 'updateShape', ['rect-2', { width: -10 }], ['write'])).toThrow('올바르지 않습니다');
    expect(() => handlePluginCall(api, 'updateShape', ['rect-2', { parentId: null }], ['write'])).toThrow('쓸 수 없는 속성');
    expect(() => handlePluginCall(api, 'updateShape', ['rect-2', { fills: [{ type: 'solid' }] }], ['write'])).toThrow('올바르지 않습니다');
    expect(() => handlePluginCall(api, 'createShape', [{ type: 'group' }], ['write'])).toThrow('만들 수 있는 종류');
    expect(() => handlePluginCall(api, 'createShape', [{ type: 'rectangle', parentId: 'text-1' }], ['write'])).toThrow('만들지 못했습니다');
    expect(() => handlePluginCall(api, 'deleteShapes', ['rect-2'], ['write'])).toThrow('id 목록');
    expect(state.doc).toBe(before);
  });

  it('reads name and permissions from the plugin header', () => {
    expect(readManifest('// @name Tidy\n// @permissions read, write\n', 'file')).toEqual({ name: 'Tidy', permissions: ['read', 'write'] });
    expect(readManifest('// @permissions admin\n', 'file')).toEqual({ name: 'file', permissions: ['read'] });
  });

  it('keeps plugin code inside its script tag and blocks network access', () => {
    expect(escapeScript('a</SCRIPT><img>')).toBe('a<\\/SCRIPT><img>');
    const html = pluginDocument('console.log("</script><script>alert(1)</script>")');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).toContain("default-src 'none'");
  });

  it('ships example plugins with headers the manager can read', () => {
    for (const file of ['rename-layers.js', 'color-palette.js']) {
      const code = readFileSync(join(__dirname, '..', 'plugins', file), 'utf8');
      expect(readManifest(code, file).permissions).toEqual(['read', 'write']);
    }
  });
});
