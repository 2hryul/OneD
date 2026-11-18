import type { Change } from './changes.ts';
import type { DesignDocument } from './model.ts';

/** 코멘트 답글. */
export interface CommentReply { id: string; authorId: string; authorName: string; text: string; createdAt: number }

/** 캔버스 위치(페이지 좌표)에 단 코멘트 스레드. 해결하면 기본 목록에서 숨긴다. */
export interface CommentThread {
  id: string; pageId: string; x: number; y: number;
  authorId: string; authorName: string; text: string; createdAt: number;
  resolved: boolean; replies: CommentReply[];
}

/** 이름 붙인 버전 기록. 문서 본문은 서버에만 있고 목록에는 정보만 보낸다. */
export interface VersionInfo { id: string; label: string; revision: number; createdAt: number; authorName: string }

/** 같은 파일을 연 사람(연결 하나). 같은 계정으로 두 탭을 열면 둘이 된다. */
export interface Peer { sessionId: string; userId: string; name: string; color: string }

export interface FileInfo { id: string; name: string; updatedAt: number; revision: number }

export const COMMENT_MAX = 2000;
export const LABEL_MAX = 80;

/** 클라이언트 → 서버. 연결 직후 첫 메시지는 hello여야 한다(토큰을 URL에 싣지 않기 위해). */
export type ClientMessage =
  | { type: 'hello'; token: string; fileId: string }
  | { type: 'change'; clientSeq: number; redo: Change[] }
  | { type: 'cursor'; pageId: string; x: number; y: number }
  | { type: 'comment-add'; pageId: string; x: number; y: number; text: string }
  | { type: 'comment-reply'; threadId: string; text: string }
  | { type: 'comment-resolve'; threadId: string; resolved: boolean }
  | { type: 'comment-delete'; threadId: string }
  | { type: 'version-save'; label: string }
  | { type: 'version-restore'; versionId: string };

/**
 * 서버 → 클라이언트. changes는 서버가 정한 순서(revision)대로 모든 연결에 보낸다.
 * 보낸 사람에게도 같은 메시지가 가며, author·clientSeq로 자기 변경의 확인임을 안다.
 */
export type ServerMessage =
  | { type: 'snapshot'; revision: number; doc: DesignDocument; comments: CommentThread[]; versions: VersionInfo[]; peers: Peer[]; you: Peer; fileName: string }
  | { type: 'changes'; revision: number; redo: Change[]; author: string; clientSeq?: number }
  | { type: 'reject'; clientSeq: number; reason: string }
  | { type: 'peers'; peers: Peer[] }
  | { type: 'cursor'; sessionId: string; pageId: string; x: number; y: number }
  | { type: 'comments'; comments: CommentThread[] }
  | { type: 'versions'; versions: VersionInfo[] }
  | { type: 'error'; message: string };
