import { applyChanges, type Change } from './changes';
import type { DesignDocument } from './model';
import type { ClientMessage, CommentThread, Peer, ServerMessage, VersionInfo } from './collabTypes';

/** 서버가 아직 확인하지 않은 내 변경. */
export interface PendingChange { seq: number; redo: Change[] }

/**
 * 서버가 확정한 문서 위에 확인 대기 중인 내 변경을 순서대로 다시 얹는다.
 * 다른 사람이 먼저 지운 도형을 고친 변경처럼 더는 얹을 수 없는 것은 버린다(서버도 거절할 변경이다).
 */
export function rebase(confirmed: DesignDocument, pending: readonly PendingChange[]): { doc: DesignDocument; kept: PendingChange[]; dropped: number } {
  let doc = confirmed;
  const kept: PendingChange[] = [];
  for (const change of pending) {
    try { doc = applyChanges(doc, change.redo); kept.push(change); }
    catch { /* 얹을 수 없는 변경은 버린다 */ }
  }
  return { doc, kept, dropped: pending.length - kept.length };
}

/** 서버 주소는 http·https만 받는다. 끝의 /를 떼어 돌려준다. */
export function cleanServerUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch { return null; }
}

/** 서버 HTTP API 호출. 실패하면 서버가 준 문장(없으면 상태 코드)을 담은 오류를 던진다. */
export async function collabApi<T>(serverUrl: string, path: string, options: { body?: unknown; token?: string } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      method: options.body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    throw new Error(`서버에 연결하지 못했습니다 - ${serverUrl}`);
  }
  const json = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(json.error ?? `서버 오류 (${response.status})`);
  return json as T;
}

export type CollabStatus = 'connecting' | 'online' | 'offline';

export interface CollabEvents {
  /** first는 처음 연결해 받은 문서다(이때 기록·선택을 초기화한다). */
  onDocument: (doc: DesignDocument, first: boolean) => void;
  onComments: (comments: CommentThread[]) => void;
  onVersions: (versions: VersionInfo[]) => void;
  onPeers: (peers: Peer[], you: Peer | null) => void;
  onCursor: (cursor: { sessionId: string; pageId: string; x: number; y: number }) => void;
  onStatus: (status: CollabStatus, detail?: string) => void;
  /** 서버가 거절했거나 다시 얹을 수 없어 버린 내 변경 수. */
  onDropped: (count: number, reason: string) => void;
}

/**
 * 공유 파일 하나에 대한 연결. 화면에 보이는 문서는 항상 "서버 확정 문서 + 확인 대기 변경"이다.
 * 내 변경은 바로 화면에 반영하고(낙관적 반영) 서버로 보낸다. 서버가 정한 순서의 변경이 오면 확정 문서에 적용하고
 * 대기 변경을 다시 얹는다. 연결이 끊기면 다시 연결하고, 대기 변경을 다시 보낸다.
 */
export class CollabSession {
  private socket: WebSocket | null = null;
  private confirmed: DesignDocument | null = null;
  private pending: PendingChange[] = [];
  private seq = 0;
  private you: Peer | null = null;
  private closed = false;
  private retry = 0;
  private lastCursor = 0;

  private readonly serverUrl: string;
  private readonly token: string;
  readonly fileId: string;
  private readonly events: CollabEvents;

  constructor(serverUrl: string, token: string, fileId: string, events: CollabEvents) {
    this.serverUrl = serverUrl; this.token = token; this.fileId = fileId; this.events = events;
  }

  connect(): void {
    this.closed = false;
    this.events.onStatus('connecting');
    const socket = new WebSocket(`${this.serverUrl.replace(/^http/, 'ws')}/ws`);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token: this.token, fileId: this.fileId } satisfies ClientMessage));
    socket.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage);
    socket.onclose = (event) => this.onClose(event.code);
  }

  disconnect(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  /** 지금 화면에 보일 문서. */
  local(): DesignDocument | null {
    return this.confirmed ? rebase(this.confirmed, this.pending).doc : null;
  }

  /** 내 변경을 대기열에 넣고 보낸다. 빈 변경이면 보내지 않는다. 화면에 보일 문서를 돌려준다. */
  submit(redo: Change[]): DesignDocument | null {
    if (redo.length > 0) {
      const change = { seq: ++this.seq, redo };
      this.pending.push(change);
      this.post({ type: 'change', clientSeq: change.seq, redo });
    }
    return this.local();
  }

  send(message: Exclude<ClientMessage, { type: 'hello' | 'change' | 'cursor' }>): void {
    this.post(message);
  }

  /** 커서 위치는 50ms에 한 번만 보낸다. */
  cursor(pageId: string, x: number, y: number): void {
    const now = Date.now();
    if (now - this.lastCursor < 50) return;
    this.lastCursor = now;
    this.post({ type: 'cursor', pageId, x: Math.round(x), y: Math.round(y) });
  }

  private post(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'snapshot': this.onSnapshot(message); return;
      case 'changes': this.onChanges(message); return;
      case 'reject': {
        this.pending = this.pending.filter((change) => change.seq !== message.clientSeq);
        this.events.onDropped(1, message.reason);
        this.publish(false);
        return;
      }
      case 'peers': this.events.onPeers(message.peers, this.you); return;
      case 'cursor': this.events.onCursor(message); return;
      case 'comments': this.events.onComments(message.comments); return;
      case 'versions': this.events.onVersions(message.versions); return;
      case 'error': this.events.onStatus(this.socket?.readyState === WebSocket.OPEN ? 'online' : 'offline', message.message); return;
    }
  }

  private onSnapshot(message: Extract<ServerMessage, { type: 'snapshot' }>): void {
    const first = this.confirmed === null;
    this.confirmed = message.doc;
    this.you = message.you;
    this.retry = 0;
    // 다시 연결한 경우: 확인받지 못한 변경을 다시 보낸다. 이미 적용됐던 것이면 서버가 거절하고 버려진다.
    for (const change of this.pending) this.post({ type: 'change', clientSeq: change.seq, redo: change.redo });
    this.events.onStatus('online');
    this.events.onPeers(message.peers, message.you);
    this.events.onComments(message.comments);
    this.events.onVersions(message.versions);
    this.publish(first);
  }

  private onChanges(message: Extract<ServerMessage, { type: 'changes' }>): void {
    if (!this.confirmed) return;
    try { this.confirmed = applyChanges(this.confirmed, message.redo); }
    catch {
      // 서버와 어긋났다. 다시 연결해 서버 문서를 새로 받는다.
      this.socket?.close();
      return;
    }
    if (message.author === this.you?.sessionId) this.pending = this.pending.filter((change) => change.seq !== message.clientSeq);
    this.publish(false);
  }

  private publish(first: boolean): void {
    if (!this.confirmed) return;
    const result = rebase(this.confirmed, this.pending);
    if (result.dropped) this.events.onDropped(result.dropped, '다른 사람의 변경과 겹쳐 적용할 수 없습니다.');
    this.pending = result.kept;
    this.events.onDocument(result.doc, first);
  }

  /** 4003(인증 실패)이면 다시 연결하지 않는다. 그 밖에는 1·2·4…최대 10초 간격으로 다시 연결한다. */
  private onClose(code: number): void {
    this.socket = null;
    if (this.closed) { this.events.onStatus('offline'); return; }
    if (code === 4003) { this.closed = true; this.events.onStatus('offline', '로그인이 만료되었거나 파일을 열 수 없습니다.'); return; }
    this.events.onStatus('offline', '연결이 끊겼습니다. 다시 연결하는 중…');
    const delay = Math.min(10_000, 1000 * 2 ** this.retry++);
    window.setTimeout(() => { if (!this.closed) this.connect(); }, delay);
  }
}
