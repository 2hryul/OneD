/** iframe 안에서 플러그인에 `canvasStudio` 객체를 주는 코드. 모든 호출은 부모 창에 메시지로 보내고 답을 Promise로 받는다. */
const SHIM = `(() => {
  const pending = new Map();
  const listeners = {};
  let seq = 0;
  const post = (message) => parent.postMessage({ source: 'canvas-studio-plugin', ...message }, '*');
  const call = (method, ...args) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); post({ type: 'call', id, method, args }); });
  window.addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message || message.source !== 'canvas-studio-host') return;
    if (message.type === 'result') {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.ok) waiter.resolve(message.value); else waiter.reject(new Error(message.error));
    } else if (message.type === 'event') {
      for (const listener of listeners[message.name] || []) { try { listener(message.data); } catch (error) { console.error(error); } }
    }
  });
  window.canvasStudio = Object.freeze({
    getDocumentInfo: () => call('getDocumentInfo'),
    getPage: () => call('getPage'),
    getNode: (id) => call('getNode', id),
    getSelection: () => call('getSelection'),
    findNodes: (query) => call('findNodes', query || {}),
    createShape: (shape) => call('createShape', shape),
    updateShape: (id, patch) => call('updateShape', id, patch),
    deleteShapes: (ids) => call('deleteShapes', ids),
    select: (ids) => call('select', ids),
    notify: (text) => call('notify', text),
    on: (name, listener) => { (listeners[name] = listeners[name] || []).push(listener); },
    close: () => post({ type: 'close' })
  });
})();`;

/** 인라인 스크립트 안에서 태그가 끝나지 않도록 `</script`와 `<!--`를 바꾼다. */
export function escapeScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/**
 * 플러그인 iframe 문서. iframe은 sandbox="allow-scripts"(같은 출처 아님)로 띄워 편집기 페이지·저장소에 손대지 못하고,
 * CSP로 네트워크 요청(connect·img·script 외부)을 막아 문서 내용을 밖으로 보낼 수 없게 한다.
 */
export function pluginDocument(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<style>body{margin:0;padding:12px;font:12px system-ui,'Segoe UI',sans-serif;color:#e9ecf5;background:#20242e}button{font:inherit;margin:4px 4px 0 0;padding:5px 10px;border:1px solid #454b5a;border-radius:6px;background:#2a2e3a;color:#dbe0ec;cursor:pointer}</style>
</head><body><script>${SHIM}</script><script>${escapeScript(code)}</script></body></html>`;
}
