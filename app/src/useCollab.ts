import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignDocument } from './model';
import type { ClientMessage, CommentThread, FileInfo, Peer, VersionInfo } from './collabTypes';
import { CollabSession, cleanServerUrl, collabApi, type CollabStatus } from './collab';

/** 로그인 정보. 토큰은 탭을 닫으면 사라지도록 sessionStorage에만 둔다. 비밀번호는 저장하지 않는다. */
export interface CollabAccount { serverUrl: string; token: string; name: string }

const ACCOUNT_KEY = 'canvas-studio-collab';
export const DEFAULT_SERVER = (import.meta.env.VITE_COLLAB_URL as string | undefined) ?? 'http://127.0.0.1:8787';

function readAccount(): CollabAccount | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(ACCOUNT_KEY) ?? 'null') as CollabAccount | null;
    return value && typeof value.token === 'string' && cleanServerUrl(value.serverUrl) ? value : null;
  } catch { return null; }
}

function writeAccount(account: CollabAccount | null): void {
  try { if (account) sessionStorage.setItem(ACCOUNT_KEY, JSON.stringify(account)); else sessionStorage.removeItem(ACCOUNT_KEY); }
  catch { /* 저장소를 못 쓰면 이 탭에서만 로그인 상태를 유지한다 */ }
}

interface Params {
  /** 서버 문서가 바뀌었을 때 화면 문서를 바꾼다. first면 처음 받은 문서(기록·선택 초기화). */
  applyDocument: (doc: DesignDocument, first: boolean) => void;
  setNotice: (message: string) => void;
}

export interface RemoteCursor { sessionId: string; pageId: string; x: number; y: number }

/** 협업 상태(계정, 파일 목록, 연결, 참여자, 코멘트, 버전, 커서)와 동작을 묶은 훅. */
export function useCollab({ applyDocument, setNotice }: Params) {
  const [account, setAccount] = useState<CollabAccount | null>(readAccount);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [status, setStatus] = useState<CollabStatus>('offline');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [you, setYou] = useState<Peer | null>(null);
  const [comments, setComments] = useState<CommentThread[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const session = useRef<CollabSession | null>(null);
  const handlers = useRef({ applyDocument, setNotice });
  handlers.current = { applyDocument, setNotice };

  useEffect(() => () => session.current?.disconnect(), []);

  const login = useCallback(async (serverInput: string, name: string, password: string, mode: 'login' | 'register'): Promise<void> => {
    const serverUrl = cleanServerUrl(serverInput);
    if (!serverUrl) throw new Error('서버 주소는 http:// 또는 https://로 시작해야 합니다.');
    const result = await collabApi<{ token: string; user: { name: string } }>(serverUrl, `/api/${mode}`, { body: { name, password } });
    const next = { serverUrl, token: result.token, name: result.user.name };
    writeAccount(next); setAccount(next);
  }, []);

  const refreshFiles = useCallback(async (): Promise<void> => {
    if (!account) return;
    try { setFiles((await collabApi<{ files: FileInfo[] }>(account.serverUrl, '/api/files', { token: account.token })).files); }
    catch (error) { handlers.current.setNotice(error instanceof Error ? error.message : String(error)); }
  }, [account]);

  const disconnect = useCallback((): void => {
    session.current?.disconnect();
    session.current = null;
    setFile(null); setPeers([]); setYou(null); setComments([]); setVersions([]); setCursors({}); setStatus('offline');
  }, []);

  const logout = useCallback((): void => {
    if (account) void collabApi(account.serverUrl, '/api/logout', { body: {}, token: account.token }).catch(() => undefined);
    disconnect(); writeAccount(null); setAccount(null); setFiles([]);
  }, [account, disconnect]);

  const open = useCallback((target: { id: string; name: string }): void => {
    if (!account) return;
    session.current?.disconnect();
    setFile(target);
    const next = new CollabSession(account.serverUrl, account.token, target.id, {
      onDocument: (doc, first) => handlers.current.applyDocument(doc, first),
      onComments: setComments,
      onVersions: setVersions,
      onPeers: (list, me) => { setPeers(list); setYou(me); setCursors((current) => Object.fromEntries(Object.entries(current).filter(([id]) => list.some((peer) => peer.sessionId === id)))); },
      onCursor: (cursor) => setCursors((current) => ({ ...current, [cursor.sessionId]: cursor })),
      onStatus: (value, detail) => { setStatus(value); if (detail) handlers.current.setNotice(detail); },
      onDropped: (count, reason) => handlers.current.setNotice(`내 변경 ${count}개를 적용하지 못했습니다: ${reason}`)
    });
    session.current = next;
    next.connect();
  }, [account]);

  /** 지금 문서를 서버에 새 파일로 올리고 바로 연다. */
  const upload = useCallback(async (name: string, doc: DesignDocument): Promise<void> => {
    if (!account) return;
    const result = await collabApi<{ file: FileInfo }>(account.serverUrl, '/api/files', { body: { name, doc }, token: account.token });
    open(result.file);
    void refreshFiles();
  }, [account, open, refreshFiles]);

  const send = useCallback((message: Exclude<ClientMessage, { type: 'hello' | 'change' | 'cursor' }>): void => session.current?.send(message), []);

  return { account, login, logout, files, refreshFiles, file, open, upload, disconnect, status, peers, you, comments, versions, cursors, send, session };
}
