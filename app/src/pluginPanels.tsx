import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { DesignDocument } from './model';
import { PluginError, handlePluginCall, readManifest, type PluginHost, type PluginInfo, type PluginPermission } from './pluginApi';
import { pluginDocument } from './pluginRuntime';
import renameLayers from '../plugins/rename-layers.js?raw';
import colorPalette from '../plugins/color-palette.js?raw';

const STORE_KEY = 'canvas-studio-plugins';
const MAX_MESSAGE = 1_000_000;
const CALLS_PER_SECOND = 200;
const EXAMPLES = [{ file: 'rename-layers.js', code: renameLayers }, { file: 'color-palette.js', code: colorPalette }];
const PERMISSION_LABEL: Record<PluginPermission, string> = { read: '문서와 선택 읽기', write: '도형 만들기·고치기·지우기, 선택 바꾸기' };

/** 설치한 플러그인과 허용 여부. 코드가 바뀌면 다시 허용받는다. */
interface StoredPlugin extends PluginInfo { approved: boolean }

export function loadPlugins(): StoredPlugin[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as StoredPlugin[];
    return Array.isArray(value) ? value.filter((item) => typeof item.code === 'string' && typeof item.id === 'string') : [];
  } catch { return []; }
}

function savePlugins(plugins: StoredPlugin[]): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(plugins)); } catch { /* 저장 공간이 없으면 이번 탭에서만 유지 */ }
}

/** 플러그인 목록 대화상자. 파일·예제에서 추가, 권한 확인 후 실행, 삭제. */
export function PluginManager({ onRun, onClose }: { onRun: (plugin: PluginInfo) => void; onClose: () => void }): JSX.Element {
  const [plugins, setPlugins] = useState<StoredPlugin[]>(loadPlugins);
  const [asking, setAsking] = useState<StoredPlugin | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (next: StoredPlugin[]): void => { setPlugins(next); savePlugins(next); };
  const install = (file: string, code: string): void => {
    const manifest = readManifest(code, file.replace(/\.js$/, ''));
    const existing = plugins.find((item) => item.name === manifest.name);
    const plugin: StoredPlugin = { id: existing?.id ?? crypto.randomUUID(), code, ...manifest, approved: Boolean(existing?.approved && existing.code === code) };
    update([...plugins.filter((item) => item.id !== plugin.id), plugin]);
  };
  const pick = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 500_000) { setError('플러그인 파일은 500KB 이하여야 합니다.'); return; }
    install(file.name, await file.text());
  };
  const run = (plugin: StoredPlugin): void => {
    if (!plugin.approved) { setAsking(plugin); return; }
    onRun(plugin); onClose();
  };
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <section className="import-modal share-modal" onPointerDown={(event) => event.stopPropagation()}>
        <header><strong>플러그인</strong><button aria-label="닫기" onClick={onClose}>×</button></header>
        <div className="share-body">
          {asking ? (
            <div className="plugin-approve">
              <p><strong>{asking.name}</strong> 플러그인이 다음 권한을 요청합니다.</p>
              <ul>{asking.permissions.map((permission) => <li key={permission}>{PERMISSION_LABEL[permission]}</li>)}</ul>
              <p className="hint">플러그인은 격리된 창에서 실행되어 이 페이지·저장소·네트워크에 접근할 수 없습니다. 쓰기는 Ctrl+Z로 되돌릴 수 있습니다.</p>
              <footer><button onClick={() => setAsking(null)}>취소</button><button className="primary" onClick={() => { const approved = { ...asking, approved: true }; update(plugins.map((item) => item.id === asking.id ? approved : item)); setAsking(null); onRun(approved); onClose(); }}>허용하고 실행</button></footer>
            </div>
          ) : (
            <>
              {plugins.length === 0 ? <p className="hint">설치한 플러그인이 없습니다. 예제나 .js 파일을 추가하세요.</p> : null}
              <ul className="version-list">{plugins.map((plugin) => (
                <li key={plugin.id} className="version-row"><span><strong>{plugin.name}</strong><small>{plugin.permissions.map((permission) => (permission === 'read' ? '읽기' : '쓰기')).join(' · ')}</small></span>
                  <span className="plugin-actions"><button onClick={() => run(plugin)}>실행</button><button onClick={() => update(plugins.filter((item) => item.id !== plugin.id))}>삭제</button></span></li>
              ))}</ul>
              <div className="section-title">추가</div>
              <div className="share-row">{EXAMPLES.map((example) => <button key={example.file} onClick={() => install(example.file, example.code)}>예제: {readManifest(example.code, example.file).name}</button>)}</div>
              <div className="share-row"><button onClick={() => fileRef.current?.click()}>.js 파일에서 추가</button></div>
              <input ref={fileRef} type="file" accept=".js,text/javascript" hidden onChange={(event) => void pick(event)} />
              {error ? <p className="form-error">{error}</p> : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * 실행 중인 플러그인 창. iframe에서 온 메시지만 받고(출처 창 비교), 호출을 검사해 실행한 뒤 결과를 돌려준다.
 * 선택·문서가 바뀌면 selectionchange·documentchange 이벤트를 보낸다.
 */
export function PluginPanel({ plugin, host, doc, selection, onClose }: { plugin: PluginInfo; host: PluginHost; doc: DesignDocument; selection: string[]; onClose: () => void }): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const [source] = useState(() => pluginDocument(plugin.code));

  useEffect(() => {
    const window_ = { start: Date.now(), count: 0 };
    const onMessage = (event: MessageEvent): void => {
      const target = frameRef.current?.contentWindow;
      if (!target || event.source !== target) return;
      const message = event.data as { source?: string; type?: string; id?: number; method?: unknown; args?: unknown };
      if (!message || message.source !== 'canvas-studio-plugin') return;
      if (message.type === 'close') { onClose(); return; }
      if (message.type !== 'call' || typeof message.id !== 'number') return;
      const reply = (body: Record<string, unknown>): void => target.postMessage({ source: 'canvas-studio-host', type: 'result', id: message.id, ...body }, '*');
      const now = Date.now();
      if (now - window_.start > 1000) { window_.start = now; window_.count = 0; }
      if (++window_.count > CALLS_PER_SECOND) { reply({ ok: false, error: '호출이 너무 많습니다(초당 200회).' }); return; }
      if (JSON.stringify(message.args ?? null).length > MAX_MESSAGE) { reply({ ok: false, error: '인자가 너무 큽니다(1MB).' }); return; }
      try { reply({ ok: true, value: handlePluginCall(hostRef.current, message.method, message.args, plugin.permissions) }); }
      catch (error) { reply({ ok: false, error: error instanceof PluginError ? error.message : '플러그인 호출을 처리하지 못했습니다.' }); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [plugin, onClose]);

  // 선택 배열은 렌더마다 새로 만들어지므로 내용이 바뀔 때만 보낸다.
  const selectionKey = selection.join(',');
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ source: 'canvas-studio-host', type: 'event', name: 'selectionchange', data: selectionKey ? selectionKey.split(',') : [] }, '*');
  }, [selectionKey]);

  useEffect(() => {
    // 끌기처럼 문서가 연달아 바뀔 때 매번 보내지 않도록 멈춘 뒤 한 번 보낸다.
    const timer = window.setTimeout(() => frameRef.current?.contentWindow?.postMessage({ source: 'canvas-studio-host', type: 'event', name: 'documentchange', data: null }, '*'), 200);
    return () => window.clearTimeout(timer);
  }, [doc]);

  return (
    <aside className="plugin-panel">
      <header><strong>{plugin.name}</strong><button aria-label="플러그인 닫기" onClick={onClose}>×</button></header>
      <iframe ref={frameRef} title={plugin.name} sandbox="allow-scripts" srcDoc={source} />
    </aside>
  );
}
