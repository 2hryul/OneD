import { useEffect, useState, type FormEvent } from 'react';
import type { Page } from './model';
import type { CommentThread, Peer } from './collabTypes';
import { DEFAULT_SERVER, type useCollab, type RemoteCursor } from './useCollab';

type Collab = ReturnType<typeof useCollab>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function timeText(at: number): string {
  return new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 공유 대화상자. 로그인 전에는 로그인·계정 만들기, 로그인 뒤에는 파일 목록, 파일을 열면 참여자·버전 기록을 보여준다. */
export function ShareModal({ collab, documentName, onUpload, onClose }: { collab: Collab; documentName: string; onUpload: (name: string) => Promise<void>; onClose: () => void }): JSX.Element {
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <section className="import-modal share-modal" onPointerDown={(event) => event.stopPropagation()}>
        <header><strong>공유와 협업</strong><button aria-label="닫기" onClick={onClose}>×</button></header>
        {!collab.account ? <LoginForm collab={collab} />
          : collab.file ? <ConnectedView collab={collab} />
            : <FileList collab={collab} documentName={documentName} onUpload={onUpload} />}
      </section>
    </div>
  );
}

function LoginForm({ collab }: { collab: Collab }): JSX.Element {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (mode: 'login' | 'register', event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    setBusy(true); setError('');
    try { await collab.login(server, name, password, mode); }
    catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  };
  return (
    <form className="share-body" onSubmit={(event) => void submit('login', event)}>
      <label className="field full"><span>서버 주소</span><input value={server} onChange={(event) => setServer(event.target.value)} /></label>
      <label className="field full"><span>이름</span><input autoComplete="username" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field full"><span>비밀번호 (8자 이상)</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error ? <p className="form-error">{error}</p> : null}
      <footer><button type="button" disabled={busy} onClick={() => void submit('register')}>계정 만들기</button><button className="primary" type="submit" disabled={busy}>로그인</button></footer>
    </form>
  );
}

function FileList({ collab, documentName, onUpload }: { collab: Collab; documentName: string; onUpload: (name: string) => Promise<void> }): JSX.Element {
  const [name, setName] = useState(documentName);
  const [error, setError] = useState('');
  const { refreshFiles } = collab;
  useEffect(() => { void refreshFiles(); }, [refreshFiles]);
  const upload = async (): Promise<void> => {
    setError('');
    try { await onUpload(name); } catch (failure) { setError(message(failure)); }
  };
  return (
    <div className="share-body">
      <p className="share-who">{collab.account!.name} · {collab.account!.serverUrl} <button className="link-button" onClick={collab.logout}>로그아웃</button></p>
      <div className="section-title">서버의 파일</div>
      {collab.files.length === 0 ? <p className="hint">아직 파일이 없습니다. 지금 문서를 올려 시작하세요.</p> : null}
      <ul className="file-list">{collab.files.map((file) => <li key={file.id}><button onClick={() => collab.open(file)}><strong>{file.name}</strong><span>{timeText(file.updatedAt)} · rev {file.revision}</span></button></li>)}</ul>
      <div className="section-title">지금 문서를 새 공유 파일로</div>
      <div className="share-row"><input value={name} onChange={(event) => setName(event.target.value)} /><button className="primary" onClick={() => void upload()}>올리고 열기</button></div>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}

function ConnectedView({ collab }: { collab: Collab }): JSX.Element {
  const [label, setLabel] = useState('');
  return (
    <div className="share-body">
      <p className="share-who"><strong>{collab.file!.name}</strong> · {collab.status === 'online' ? '연결됨' : collab.status === 'connecting' ? '연결 중' : '끊김'}</p>
      <div className="section-title">참여자 {collab.peers.length}</div>
      <ul className="peer-list">{collab.peers.map((peer) => <li key={peer.sessionId}><Avatar peer={peer} /> {peer.name}{peer.sessionId === collab.you?.sessionId ? ' (나)' : ''}</li>)}</ul>
      <div className="section-title">버전 기록</div>
      <div className="share-row"><input placeholder="버전 이름" value={label} onChange={(event) => setLabel(event.target.value)} /><button onClick={() => { collab.send({ type: 'version-save', label }); setLabel(''); }}>현재 버전 저장</button></div>
      <ul className="version-list">{[...collab.versions].reverse().map((version) => (
        <li key={version.id} className="version-row"><span><strong>{version.label}</strong><small>{timeText(version.createdAt)} · {version.authorName} · rev {version.revision}</small></span>
          <button title="모든 참여자의 문서가 이 버전으로 바뀝니다" onClick={() => { if (window.confirm(`'${version.label}' 버전으로 되돌릴까요? 모든 참여자의 문서가 바뀌고 Ctrl+Z로는 취소되지 않습니다. 지금 상태가 필요하면 먼저 '현재 버전 저장'을 누르세요.`)) collab.send({ type: 'version-restore', versionId: version.id }); }}>복원</button></li>
      ))}</ul>
      <footer><button onClick={collab.disconnect}>파일 닫기(로컬로)</button><button onClick={collab.logout}>로그아웃</button></footer>
    </div>
  );
}

export function Avatar({ peer }: { peer: Peer }): JSX.Element {
  return <span className="avatar" title={peer.name} style={{ background: peer.color }}>{peer.name.slice(0, 1).toUpperCase()}</span>;
}

/** 상단 막대의 참여자 얼굴과 연결 상태. */
export function PresenceBar({ collab, onOpen }: { collab: Collab; onOpen: () => void }): JSX.Element {
  const dot = collab.status === 'online' ? 'online' : collab.status === 'connecting' ? 'connecting' : 'offline';
  return (
    <button className="presence" onClick={onOpen} title="공유와 협업">
      {collab.file ? <><span className={`presence-dot ${dot}`} />{collab.peers.slice(0, 5).map((peer) => <Avatar key={peer.sessionId} peer={peer} />)}</> : null}
      <span>{collab.file ? collab.file.name : '공유'}</span>
    </button>
  );
}

interface CommentsPanelProps {
  collab: Collab; page: Page; draft: { x: number; y: number } | null; activeId: string | null;
  onCancelDraft: () => void; onFocus: (thread: CommentThread) => void;
}

/** 왼쪽 코멘트 탭. 새 코멘트 입력(캔버스를 C 도구로 누른 자리), 현재 페이지의 스레드, 답글·해결·삭제. */
export function CommentsPanel({ collab, page, draft, activeId, onCancelDraft, onFocus }: CommentsPanelProps): JSX.Element {
  const [text, setText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const threads = collab.comments.filter((thread) => thread.pageId === page.id && (showResolved || !thread.resolved));
  const submitDraft = (): void => {
    if (!draft || !text.trim()) return;
    collab.send({ type: 'comment-add', pageId: page.id, x: draft.x, y: draft.y, text });
    setText(''); onCancelDraft();
  };
  return (
    <div className="comments-panel">
      {draft ? (
        <div className="comment-draft">
          <textarea autoFocus placeholder="코멘트 입력 (Ctrl+Enter로 보내기)" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.ctrlKey) submitDraft(); if (event.key === 'Escape') onCancelDraft(); }} />
          <div className="share-row"><button onClick={onCancelDraft}>취소</button><button className="primary" onClick={submitDraft}>보내기</button></div>
        </div>
      ) : <p className="hint">코멘트 도구(C)로 캔버스를 누르면 그 자리에 코멘트를 답니다.</p>}
      <label className="check-field"><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} /> 해결된 코멘트도 보기</label>
      {threads.map((thread) => <ThreadCard key={thread.id} collab={collab} thread={thread} number={collab.comments.indexOf(thread) + 1} active={thread.id === activeId} onFocus={() => onFocus(thread)} />)}
    </div>
  );
}

function ThreadCard({ collab, thread, number, active, onFocus }: { collab: Collab; thread: CommentThread; number: number; active: boolean; onFocus: () => void }): JSX.Element {
  const [reply, setReply] = useState('');
  const send = (): void => { if (reply.trim()) { collab.send({ type: 'comment-reply', threadId: thread.id, text: reply }); setReply(''); } };
  const mine = collab.you?.userId === thread.authorId;
  return (
    <div className={`thread-card ${active ? 'active' : ''} ${thread.resolved ? 'resolved' : ''}`} onClick={onFocus}>
      <div className="thread-head"><span className="pin-number">{number}</span><strong>{thread.authorName}</strong><small>{timeText(thread.createdAt)}</small></div>
      <p>{thread.text}</p>
      {thread.replies.map((item) => <p key={item.id} className="thread-reply"><strong>{item.authorName}</strong> {item.text}</p>)}
      <input placeholder="답글 (Enter)" value={reply} onClick={(event) => event.stopPropagation()} onChange={(event) => setReply(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') send(); }} />
      <div className="thread-actions">
        <button onClick={(event) => { event.stopPropagation(); collab.send({ type: 'comment-resolve', threadId: thread.id, resolved: !thread.resolved }); }}>{thread.resolved ? '다시 열기' : '해결'}</button>
        {mine ? <button onClick={(event) => { event.stopPropagation(); if (window.confirm('이 코멘트 스레드를 지울까요?')) collab.send({ type: 'comment-delete', threadId: thread.id }); }}>삭제</button> : null}
      </div>
    </div>
  );
}

/** 캔버스의 코멘트 핀. 번호는 파일 전체 코멘트 순서다. 크기는 확대율과 상관없이 일정하다. */
export function CommentPins({ comments, page, draft, activeId, unit }: { comments: CommentThread[]; page: Page; draft: { x: number; y: number } | null; activeId: string | null; unit: number }): JSX.Element {
  return (
    <>
      {comments.map((thread, index) => thread.pageId !== page.id || thread.resolved ? null : (
        <div key={thread.id} data-comment-id={thread.id} className={`comment-pin ${thread.id === activeId ? 'active' : ''}`} style={{ left: thread.x, top: thread.y, transform: `translate(0, -100%) scale(${unit})` }}>{index + 1}</div>
      ))}
      {draft ? <div className="comment-pin draft" style={{ left: draft.x, top: draft.y, transform: `translate(0, -100%) scale(${unit})` }}>+</div> : null}
    </>
  );
}

/** 같은 페이지에 있는 다른 사람의 커서와 이름표. */
export function RemoteCursors({ cursors, peers, pageId, unit }: { cursors: Record<string, RemoteCursor>; peers: Peer[]; pageId: string; unit: number }): JSX.Element {
  return (
    <>
      {Object.values(cursors).map((cursor) => {
        const peer = peers.find((item) => item.sessionId === cursor.sessionId);
        if (!peer || cursor.pageId !== pageId) return null;
        return (
          <div key={cursor.sessionId} className="remote-cursor" style={{ left: cursor.x, top: cursor.y, transform: `scale(${unit})` }}>
            <svg width="14" height="20" viewBox="0 0 14 20"><path d="M0 0 L0 16 L4 12 L7 19 L10 18 L7 11 L13 11 Z" fill={peer.color} stroke="#fff" strokeWidth="1" /></svg>
            <span style={{ background: peer.color }}>{peer.name}</span>
          </div>
        );
      })}
    </>
  );
}
