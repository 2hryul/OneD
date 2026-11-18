import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { applyChanges, type Change } from '../src/changes.ts';
import { parseDocument, type DesignDocument } from '../src/model.ts';
import { COMMENT_MAX, LABEL_MAX, type CommentThread, type FileInfo, type VersionInfo } from '../src/collabTypes.ts';
import { readJson, writeJsonAtomic } from './jsonFile.ts';
import type { SessionUser } from './auth.ts';

export interface StoredFile {
  id: string; name: string; revision: number; updatedAt: number; createdBy: string;
  doc: DesignDocument; comments: CommentThread[]; versions: Array<VersionInfo & { doc: DesignDocument }>;
}

const CHANGE_TYPES = new Set(['addObj', 'modObj', 'delObj', 'movObjects', 'addPage', 'delPage', 'setComponent', 'delComponent', 'setToken', 'delToken', 'setDocument']);
const MAX_CHANGES = 50_000;
const MAX_VERSIONS = 30;

export type ApplyResult = { ok: true; redo: Change[]; revision: number } | { ok: false; reason: string };

function isChangeList(value: unknown): value is Change[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_CHANGES &&
    value.every((item) => typeof item === 'object' && item !== null && CHANGE_TYPES.has((item as { type?: unknown }).type as string));
}

/** 사용자가 쓴 글. 앞뒤 공백을 지우고 길이를 검사한다. 어긋나면 null. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length === 0 || text.length > max ? null : text;
}

/**
 * 파일 하나의 협업 상태. 서버가 받은 순서대로 변경을 적용해 revision을 하나씩 올린다(Penpot의 서버 순서와 같음).
 * 변경은 신뢰하지 않는 입력이므로 적용 결과 문서를 파일 열기와 같은 검사(parseDocument)로 확인하고, 실패하면 거절한다.
 */
export class Room {
  file: StoredFile;
  private readonly onDirty: (room: Room) => void;

  constructor(file: StoredFile, onDirty: (room: Room) => void) { this.file = file; this.onDirty = onDirty; }

  applyChange(redo: unknown): ApplyResult {
    if (!isChangeList(redo)) return { ok: false, reason: '변경 형식이 올바르지 않습니다.' };
    let next: DesignDocument;
    try {
      next = parseDocument(JSON.stringify(applyChanges(this.file.doc, redo)));
    } catch (error) {
      // 다른 사람이 먼저 지운 도형을 고치는 등 순서가 엇갈린 변경이다. 보낸 쪽이 서버 상태로 다시 맞춘다.
      return { ok: false, reason: error instanceof Error ? error.message.slice(0, 200) : '적용 실패' };
    }
    this.file = { ...this.file, doc: next, revision: this.file.revision + 1, updatedAt: Date.now() };
    this.onDirty(this);
    return { ok: true, redo, revision: this.file.revision };
  }

  addComment(user: SessionUser, input: { pageId?: unknown; x?: unknown; y?: unknown; text?: unknown }): boolean {
    const text = cleanText(input.text, COMMENT_MAX);
    const { pageId, x, y } = input;
    if (!text || typeof pageId !== 'string' || !this.file.doc.pages.some((page) => page.id === pageId) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const thread: CommentThread = { id: randomUUID(), pageId, x: Number(x), y: Number(y), authorId: user.id, authorName: user.name, text, createdAt: Date.now(), resolved: false, replies: [] };
    return this.setComments([...this.file.comments, thread]);
  }

  reply(user: SessionUser, threadId: unknown, input: unknown): boolean {
    const text = cleanText(input, COMMENT_MAX);
    if (!text || !this.file.comments.some((thread) => thread.id === threadId)) return false;
    const reply = { id: randomUUID(), authorId: user.id, authorName: user.name, text, createdAt: Date.now() };
    return this.setComments(this.file.comments.map((thread) => thread.id === threadId ? { ...thread, replies: [...thread.replies, reply] } : thread));
  }

  resolve(threadId: unknown, resolved: unknown): boolean {
    if (typeof resolved !== 'boolean' || !this.file.comments.some((thread) => thread.id === threadId)) return false;
    return this.setComments(this.file.comments.map((thread) => thread.id === threadId ? { ...thread, resolved } : thread));
  }

  /** 스레드는 쓴 사람만 지울 수 있다. */
  deleteComment(user: SessionUser, threadId: unknown): boolean {
    const thread = this.file.comments.find((item) => item.id === threadId);
    if (!thread || thread.authorId !== user.id) return false;
    return this.setComments(this.file.comments.filter((item) => item.id !== threadId));
  }

  saveVersion(user: SessionUser, labelInput: unknown): boolean {
    const label = cleanText(labelInput, LABEL_MAX) ?? `버전 ${this.file.versions.length + 1}`;
    const version = { id: randomUUID(), label, revision: this.file.revision, createdAt: Date.now(), authorName: user.name, doc: this.file.doc };
    this.file = { ...this.file, versions: [...this.file.versions, version].slice(-MAX_VERSIONS) };
    this.onDirty(this);
    return true;
  }

  /** 버전 복원은 문서 전체를 바꾸는 변경 하나로 처리해 다른 변경과 같은 순서·undo 흐름을 탄다. */
  restoreVersion(versionId: unknown): ApplyResult {
    const version = this.file.versions.find((item) => item.id === versionId);
    if (!version) return { ok: false, reason: '버전을 찾을 수 없습니다.' };
    return this.applyChange([{ type: 'setDocument', document: version.doc }]);
  }

  versions(): VersionInfo[] {
    return this.file.versions.map(({ doc: _doc, ...info }) => info);
  }

  info(): FileInfo {
    return { id: this.file.id, name: this.file.name, updatedAt: this.file.updatedAt, revision: this.file.revision };
  }

  private setComments(comments: CommentThread[]): boolean {
    this.file = { ...this.file, comments };
    this.onDirty(this);
    return true;
  }
}

/**
 * 파일 저장소. 파일마다 files\{id}.json 하나, 목록은 index.json이다.
 * 열린 파일(Room)은 메모리에 두고, 바뀌면 1초 뒤에 한 번 저장한다(변경마다 큰 JSON을 쓰지 않기 위해).
 */
export class FileStore {
  private index: FileInfo[];
  private readonly rooms = new Map<string, Room>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly dir: string;
  private readonly saveDelay: number;

  constructor(dir: string, saveDelay = 1000) {
    this.dir = dir;
    this.saveDelay = saveDelay;
    this.index = readJson<FileInfo[]>(join(dir, 'index.json'), []);
  }

  list(): FileInfo[] {
    return [...this.index].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 새 파일. 문서는 외부 입력이므로 열기와 같은 검사를 거친다. */
  create(user: SessionUser, nameInput: unknown, docInput: unknown): FileInfo {
    const name = cleanText(nameInput, LABEL_MAX);
    if (!name) throw new Error('파일 이름은 1~80자여야 합니다.');
    const doc = parseDocument(JSON.stringify(docInput));
    const file: StoredFile = { id: randomUUID(), name, revision: 0, updatedAt: Date.now(), createdBy: user.id, doc, comments: [], versions: [] };
    writeJsonAtomic(this.pathOf(file.id), file);
    this.index = [...this.index, { id: file.id, name, updatedAt: file.updatedAt, revision: 0 }];
    writeJsonAtomic(join(this.dir, 'index.json'), this.index);
    return { id: file.id, name, updatedAt: file.updatedAt, revision: 0 };
  }

  open(id: unknown): Room | null {
    if (typeof id !== 'string' || !this.index.some((item) => item.id === id)) return null;
    const existing = this.rooms.get(id);
    if (existing) return existing;
    const room = new Room(readJson<StoredFile>(this.pathOf(id), null as unknown as StoredFile), (changed) => this.schedule(changed));
    this.rooms.set(id, room);
    return room;
  }

  /** 마지막 연결이 끊긴 방은 저장하고 메모리에서 내린다. */
  close(id: string): void {
    this.flush(id);
    this.rooms.delete(id);
  }

  flushAll(): void {
    for (const id of [...this.timers.keys()]) this.flush(id);
  }

  private schedule(room: Room): void {
    if (this.timers.has(room.file.id)) return;
    this.timers.set(room.file.id, setTimeout(() => this.flush(room.file.id), this.saveDelay));
  }

  private flush(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(id);
    const room = this.rooms.get(id);
    if (!room) return;
    writeJsonAtomic(this.pathOf(id), room.file);
    this.index = this.index.map((item) => item.id === id ? room.info() : item);
    writeJsonAtomic(join(this.dir, 'index.json'), this.index);
  }

  private pathOf(id: string): string {
    // id는 index에 있는 UUID만 쓰므로 경로 밖으로 나갈 수 없다(open에서 목록 대조).
    return join(this.dir, 'files', `${id}.json`);
  }
}
