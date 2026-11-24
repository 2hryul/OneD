import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/app';
import { AuthStore } from '../server/auth';
import { loadConfig } from '../server/config';
import { createLogger, maskName, pruneLogs } from '../server/log';
import { sampleDocument, solid } from '../src/model';
import { addShape, updateShape } from '../src/changes';
import type { ServerMessage } from '../src/collabTypes';

const ORIGIN = 'http://127.0.0.1:5173';
let root = '';
let base = '';
let close: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'canvas-collab-'));
  const config = { ...loadConfig({ COLLAB_PORT: '1' }), port: 0, dataDir: join(root, 'data'), logDir: join(root, 'logs') };
  const server = await startServer(config, createLogger(config.logDir, false));
  base = `http://127.0.0.1:${server.port}`;
  close = server.close;
});

afterAll(async () => { await close(); rmSync(root, { recursive: true, force: true }); });

async function api(path: string, body?: unknown, token?: string, origin = ORIGIN): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

/** 소켓을 열고 받은 메시지를 모아 둔다. next(type)은 그 종류의 다음 메시지를 기다린다. */
async function connect(token: string, fileId: string, origin = ORIGIN) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { origin });
  const inbox: ServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (data) => { inbox.push(JSON.parse(data.toString()) as ServerMessage); waiters.splice(0).forEach((wake) => wake()); });
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'hello', token, fileId }));
  const next = async <T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> => {
    for (;;) {
      const index = inbox.findIndex((message) => message.type === type);
      if (index >= 0) return inbox.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((resolve, reject) => { waiters.push(resolve); setTimeout(() => reject(new Error(`timeout waiting ${type}`)), 3000); });
    }
  };
  return { ws, next, send: (message: unknown) => ws.send(JSON.stringify(message)) };
}

describe('collaboration server', () => {
  it('registers, logs in, and refuses bad credentials without saying which part was wrong', async () => {
    expect((await api('/api/register', { name: 'alice', password: 'correct horse' })).status).toBe(200);
    expect((await api('/api/register', { name: 'Alice', password: 'another pass' })).json.error).toBe('이미 있는 이름입니다.');
    expect((await api('/api/register', { name: 'b', password: 'short' })).status).toBe(400);
    const wrong = await api('/api/login', { name: 'alice', password: 'wrong password' });
    const unknown = await api('/api/login', { name: 'nobody', password: 'wrong password' });
    expect(wrong.json.error).toBe(unknown.json.error);
    expect((await api('/api/files')).status).toBe(401);
    expect((await api('/api/files', undefined, undefined, 'https://evil.example')).status).toBe(403);
    const users = readFileSync(join(root, 'data', 'users.json'), 'utf8');
    expect(users).not.toContain('correct horse');
  });

  it('orders changes from two users, rejects a conflicting one, and shares comments and versions', async () => {
    const alice = (await api('/api/login', { name: 'alice', password: 'correct horse' })).json.token as string;
    const bob = (await api('/api/register', { name: 'bob', password: 'bob password' })).json.token as string;
    const doc = sampleDocument();
    const created = await api('/api/files', { name: 'Team file', doc }, alice);
    const fileId = (created.json.file as { id: string }).id;
    const a = await connect(alice, fileId);
    const snapshotA = await a.next('snapshot');
    expect(snapshotA).toMatchObject({ revision: 0, fileName: 'Team file' });
    const b = await connect(bob, fileId);
    expect((await b.next('snapshot')).peers).toHaveLength(2);
    expect((await a.next('peers')).peers.map((peer) => peer.name)).toEqual(['alice', 'bob']);

    const add = addShape(doc, 'page-1', { id: 'shared', type: 'rectangle', name: 'Shared', parentId: null, x: 0, y: 0, width: 10, height: 10, fills: solid('#ff0000') });
    a.send({ type: 'change', clientSeq: 1, redo: add.redo });
    const seenByB = await b.next('changes');
    expect(seenByB).toMatchObject({ revision: 1, author: snapshotA.you.sessionId, clientSeq: 1 });
    expect((await a.next('changes')).revision).toBe(1);

    b.send({ type: 'change', clientSeq: 7, redo: [{ type: 'modObj', pageId: 'page-1', id: 'missing', set: { name: 'x' } }] });
    expect(await b.next('reject')).toMatchObject({ clientSeq: 7 });
    b.send({ type: 'change', clientSeq: 8, redo: [{ type: 'modObj', pageId: 'page-1', id: 'shared', set: { width: -5 } }] });
    expect((await b.next('reject')).clientSeq).toBe(8);
    b.send({ type: 'change', clientSeq: 9, redo: updateShape({ ...doc, pages: [{ ...doc.pages[0]!, objects: { ...doc.pages[0]!.objects, shared: { id: 'shared', type: 'rectangle', name: 'Shared', parentId: null, x: 0, y: 0, width: 10, height: 10, fills: [], transform: [1, 0, 0, 1, 0, 0] } }, children: [...doc.pages[0]!.children, 'shared'] }] }, 'page-1', 'shared', { name: 'Renamed' }).redo });
    expect((await a.next('changes')).revision).toBe(2);

    a.send({ type: 'comment-add', pageId: 'page-1', x: 40, y: 50, text: '  여기 간격 확인  ' });
    const comments = (await b.next('comments')).comments;
    expect(comments[0]).toMatchObject({ text: '여기 간격 확인', authorName: 'alice', resolved: false });
    b.send({ type: 'comment-reply', threadId: comments[0]!.id, text: '확인했습니다' });
    b.send({ type: 'comment-resolve', threadId: comments[0]!.id, resolved: true });
    b.send({ type: 'comment-delete', threadId: comments[0]!.id });
    // Alice는 자기 코멘트 추가·답글·해결 세 번을 받는다. 삭제는 쓴 사람이 아니라 무시된다.
    await a.next('comments'); await a.next('comments');
    expect((await a.next('comments')).comments[0]).toMatchObject({ resolved: true, replies: [{ authorName: 'bob', text: '확인했습니다' }] });

    a.send({ type: 'version-save', label: 'Before cleanup' });
    const versions = (await b.next('versions')).versions;
    expect(versions[0]).toMatchObject({ label: 'Before cleanup', revision: 2 });
    b.send({ type: 'version-restore', versionId: versions[0]!.id });
    expect(await a.next('changes')).toMatchObject({ revision: 3, author: 'server' });

    a.ws.close(); b.ws.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const saved = JSON.parse(readFileSync(join(root, 'data', 'files', `${fileId}.json`), 'utf8')) as { revision: number; comments: unknown[] };
    expect(saved).toMatchObject({ revision: 3 });
    expect(saved.comments).toHaveLength(1);
  });

  it('refuses sockets from other sites and sockets without a valid token', async () => {
    const other = new WebSocket(`${base.replace('http', 'ws')}/ws`, { origin: 'https://evil.example' });
    await expect(new Promise((resolve, reject) => { other.once('open', resolve); other.once('error', reject); })).rejects.toThrow();
    const anonymous = await connect('not-a-token', 'whatever');
    expect((await anonymous.next('error')).message).toBe('로그인이 필요합니다.');
  });
});

describe('server helpers', () => {
  it('locks login after five failures and unlocks after ten minutes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-auth-'));
    const auth = new AuthStore(join(dir, 'users.json'), 60_000);
    await auth.register('carol', 'carol password');
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) await expect(auth.login('carol', 'nope nope', 'ip', now)).rejects.toThrow('맞지 않습니다');
    await expect(auth.login('carol', 'carol password', 'ip', now + 1000)).rejects.toThrow('너무 많습니다');
    await expect(auth.login('carol', 'carol password', 'other-ip', now + 1000)).resolves.toBeTruthy();
    await expect(auth.login('carol', 'carol password', 'ip', now + 11 * 60_000)).resolves.toBeTruthy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('masks names in logs and removes logs older than 30 days', async () => {
    expect(maskName('minsoo')).toBe('mi****');
    expect(maskName('ab')).toBe('a*');
    const dir = mkdtempSync(join(tmpdir(), 'canvas-log-'));
    createLogger(dir, false).info('hello');
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    expect(existsSync(join(dir, `server-${today}.log`))).toBe(true);
    expect(pruneLogs(dir, Date.now() + 31 * 86_400_000)).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads settings with APPDATA defaults and rejects bad values', () => {
    // 경로는 실행 OS의 규칙으로 해석되므로, 그 OS에서 절대 경로인 기준을 쓴다(Linux CI에서 C:\는 상대 경로가 된다).
    const base = process.platform === 'win32' ? 'C:\\Users\\u\\AppData' : '/home/u/AppData';
    const config = loadConfig({ APPDATA: join(base, 'Roaming'), LOCALAPPDATA: join(base, 'Local') });
    expect(config).toMatchObject({ host: '127.0.0.1', port: 8787, dataDir: join(base, 'Roaming', 'CanvasStudio', 'server'), logDir: join(base, 'Local', 'CanvasStudio', 'logs') });
    expect(() => loadConfig({ COLLAB_PORT: '70000' })).toThrow('COLLAB_PORT');
  });
});
