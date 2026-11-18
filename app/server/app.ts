import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, Peer, ServerMessage } from '../src/collabTypes.ts';
import { AuthError, AuthStore, type SessionUser } from './auth.ts';
import { FileStore, type Room } from './room.ts';
import { maskName, type Logger } from './log.ts';
import type { ServerConfig } from './config.ts';

const MAX_BODY = 25 * 1024 * 1024;
const HELLO_TIMEOUT_MS = 10_000;
const MESSAGES_PER_SECOND = 120;
const COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5c7cfa'];

interface Client { ws: WebSocket; peer: Peer; user: SessionUser; room: Room; window: { start: number; count: number } }

interface Context { config: ServerConfig; auth: AuthStore; files: FileStore; log: Logger; clients: Map<string, Set<Client>> }

/** 협업 서버를 시작한다. 테스트에서는 port 0(빈 포트)으로 띄우고 close로 끈다. */
export async function startServer(config: ServerConfig, log: Logger): Promise<{ port: number; close: () => Promise<void> }> {
  const context: Context = {
    config, log, clients: new Map(),
    auth: new AuthStore(join(config.dataDir, 'users.json'), config.sessionHours * 3_600_000),
    files: new FileStore(config.dataDir)
  };
  const server = createServer((request, response) => { void handleHttp(context, request, response); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== '/ws' || !originAllowed(config, request.headers.origin, true)) {
      log.warn(`[upgrade] 연결 거부 - 경로 ${path}, origin ${request.headers.origin ?? '(없음)'}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => acceptSocket(context, ws));
  });
  // 끊긴 연결(브라우저 절전 등)을 30초마다 정리한다.
  const heartbeat = setInterval(() => sockets.clients.forEach((ws) => { if ((ws as WebSocket & { alive?: boolean }).alive === false) ws.terminate(); else { (ws as WebSocket & { alive?: boolean }).alive = false; ws.ping(); } }), 30_000);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  const port = (server.address() as { port: number }).port;
  log.info(`[startServer] 협업 서버 시작 - http://${config.host}:${port}`);
  return { port, close: () => closeServer(context, server, sockets, heartbeat) };
}

async function closeServer(context: Context, server: Server, sockets: WebSocketServer, heartbeat: ReturnType<typeof setInterval>): Promise<void> {
  clearInterval(heartbeat);
  sockets.clients.forEach((ws) => ws.terminate());
  context.files.flushAll();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  context.log.info('[closeServer] 협업 서버 종료');
}

/** Origin이 허용 목록에 있는지. HTTP는 Origin 없는 요청(명령줄 도구)을 허용하고, WebSocket은 반드시 있어야 한다. */
function originAllowed(config: ServerConfig, origin: string | undefined, required: boolean): boolean {
  if (!origin) return !required;
  return config.allowedOrigins.includes(origin);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new RequestError(413, '요청이 너무 큽니다.');
    chunks.push(chunk as Buffer);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw new RequestError(400, 'JSON 형식이 아닙니다.'); }
}

class RequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/**
 * HTTP API. 응답 오류에는 사용자에게 보여도 되는 문장만 담고, 내부 오류는 로그에만 남긴다.
 * POST /api/register·/api/login·/api/logout, GET·POST /api/files
 */
async function handleHttp(context: Context, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const origin = request.headers.origin;
  if (!originAllowed(context.config, origin, false)) { send(response, 403, { error: '허용되지 않은 출처입니다.' }); return; }
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  try {
    send(response, 200, await route(context, request));
  } catch (error) {
    if (error instanceof AuthError) { send(response, 400, { error: error.message }); return; }
    if (error instanceof RequestError) { send(response, error.status, { error: error.message }); return; }
    context.log.error(`[handleHttp] ${request.method} ${request.url} 처리 실패 - ${error instanceof Error ? error.message : String(error)}`);
    send(response, 500, { error: '서버에서 요청을 처리하지 못했습니다.' });
  }
}

async function route(context: Context, request: IncomingMessage): Promise<unknown> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const key = request.socket.remoteAddress ?? 'unknown';
  if (request.method === 'POST' && (path === '/api/register' || path === '/api/login')) {
    const body = await readBody(request) as { name?: unknown; password?: unknown };
    const result = path === '/api/register' ? await context.auth.register(body.name, body.password) : await context.auth.login(body.name, body.password, key);
    context.log.info(`[route] ${path === '/api/register' ? '계정 생성' : '로그인'} - ${maskName(result.user.name)}`);
    return result;
  }
  const token = (request.headers.authorization ?? '').replace(/^Bearer /, '');
  const user = context.auth.verify(token);
  if (!user) throw new RequestError(401, '로그인이 필요합니다.');
  if (request.method === 'POST' && path === '/api/logout') { context.auth.logout(token); return { ok: true }; }
  if (request.method === 'GET' && path === '/api/files') return { files: context.files.list() };
  if (request.method === 'POST' && path === '/api/files') {
    const body = await readBody(request) as { name?: unknown; doc?: unknown };
    try { return { file: context.files.create(user, body.name, body.doc) }; }
    catch (error) { throw new RequestError(400, error instanceof Error && error.message.length < 120 ? error.message : '문서 형식이 올바르지 않습니다.'); }
  }
  throw new RequestError(404, '없는 경로입니다.');
}

function post(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function broadcast(context: Context, room: Room, message: ServerMessage, except?: Client): void {
  for (const client of context.clients.get(room.file.id) ?? []) if (client !== except) post(client.ws, message);
}

function peersOf(context: Context, room: Room): Peer[] {
  return [...(context.clients.get(room.file.id) ?? [])].map((client) => client.peer);
}

/** 새 연결. 첫 메시지 hello에서 토큰과 파일을 확인하기 전에는 아무것도 보내지 않는다. */
function acceptSocket(context: Context, ws: WebSocket): void {
  let client: Client | null = null;
  const timer = setTimeout(() => ws.close(4001, 'hello timeout'), HELLO_TIMEOUT_MS);
  (ws as WebSocket & { alive?: boolean }).alive = true;
  ws.on('pong', () => { (ws as WebSocket & { alive?: boolean }).alive = true; });
  ws.on('message', (data) => {
    let message: ClientMessage;
    try { message = JSON.parse(data.toString()) as ClientMessage; }
    catch { post(ws, { type: 'error', message: '메시지 형식이 올바르지 않습니다.' }); return; }
    if (!client) { client = joinRoom(context, ws, message); if (client) clearTimeout(timer); return; }
    if (overLimit(client)) return;
    handleMessage(context, client, message);
  });
  ws.on('close', () => { clearTimeout(timer); if (client) leave(context, client); });
}

function joinRoom(context: Context, ws: WebSocket, message: ClientMessage): Client | null {
  const user = message.type === 'hello' ? context.auth.verify(message.token) : null;
  const room = user && message.type === 'hello' ? context.files.open(message.fileId) : null;
  if (!user || !room) { post(ws, { type: 'error', message: user ? '파일을 찾을 수 없습니다.' : '로그인이 필요합니다.' }); ws.close(4003, 'unauthorized'); return null; }
  const members = context.clients.get(room.file.id) ?? new Set<Client>();
  const peer: Peer = { sessionId: randomUUID(), userId: user.id, name: user.name, color: COLORS[members.size % COLORS.length]! };
  const client: Client = { ws, peer, user, room, window: { start: Date.now(), count: 0 } };
  members.add(client);
  context.clients.set(room.file.id, members);
  const { doc, comments, revision, name } = room.file;
  post(ws, { type: 'snapshot', revision, doc, comments, versions: room.versions(), peers: peersOf(context, room), you: peer, fileName: name });
  broadcast(context, room, { type: 'peers', peers: peersOf(context, room) }, client);
  context.log.info(`[join] 파일 ${room.file.id} 입장 - ${maskName(user.name)} (${members.size}명)`);
  return client;
}

function leave(context: Context, client: Client): void {
  const members = context.clients.get(client.room.file.id);
  members?.delete(client);
  if (!members || members.size === 0) { context.clients.delete(client.room.file.id); context.files.close(client.room.file.id); return; }
  broadcast(context, client.room, { type: 'peers', peers: peersOf(context, client.room) });
}

/** 연결 하나가 1초에 보낼 수 있는 메시지 수를 제한한다. 넘친 메시지는 버린다(커서 폭주 방지). */
function overLimit(client: Client, now = Date.now()): boolean {
  if (now - client.window.start >= 1000) client.window = { start: now, count: 0 };
  client.window.count++;
  return client.window.count > MESSAGES_PER_SECOND;
}

function handleMessage(context: Context, client: Client, message: ClientMessage): void {
  const { room } = client;
  switch (message.type) {
    case 'change': {
      const result = room.applyChange(message.redo);
      if (result.ok) broadcast(context, room, { type: 'changes', revision: result.revision, redo: result.redo, author: client.peer.sessionId, clientSeq: message.clientSeq });
      else { post(client.ws, { type: 'reject', clientSeq: Number(message.clientSeq) || 0, reason: result.reason }); context.log.warn(`[handleMessage] 변경 거절 - 파일 ${room.file.id}: ${result.reason}`); }
      return;
    }
    case 'cursor':
      if (typeof message.pageId === 'string' && Number.isFinite(message.x) && Number.isFinite(message.y)) broadcast(context, room, { type: 'cursor', sessionId: client.peer.sessionId, pageId: message.pageId.slice(0, 100), x: message.x, y: message.y }, client);
      return;
    case 'comment-add': if (room.addComment(client.user, message)) broadcast(context, room, { type: 'comments', comments: room.file.comments }); return;
    case 'comment-reply': if (room.reply(client.user, message.threadId, message.text)) broadcast(context, room, { type: 'comments', comments: room.file.comments }); return;
    case 'comment-resolve': if (room.resolve(message.threadId, message.resolved)) broadcast(context, room, { type: 'comments', comments: room.file.comments }); return;
    case 'comment-delete': if (room.deleteComment(client.user, message.threadId)) broadcast(context, room, { type: 'comments', comments: room.file.comments }); return;
    case 'version-save': if (room.saveVersion(client.user, message.label)) broadcast(context, room, { type: 'versions', versions: room.versions() }); return;
    case 'version-restore': {
      const result = room.restoreVersion(message.versionId);
      if (result.ok) broadcast(context, room, { type: 'changes', revision: result.revision, redo: result.redo, author: 'server' });
      else post(client.ws, { type: 'error', message: result.reason });
      return;
    }
    default: post(client.ws, { type: 'error', message: '알 수 없는 메시지입니다.' });
  }
}
