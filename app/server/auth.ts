import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readJson, writeJsonAtomic } from './jsonFile.ts';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

interface StoredUser { id: string; name: string; salt: string; hash: string; createdAt: number }
export interface SessionUser { id: string; name: string }

const NAME_PATTERN = /^[\p{L}\p{N}_.-]{2,32}$/u;
const KEY_LENGTH = 64;
const MAX_FAILURES = 5;
const LOCK_MS = 10 * 60_000;

/** 인증 실패. message는 사용자에게 그대로 보여도 되는 문장만 담는다(계정 존재 여부를 흘리지 않는다). */
export class AuthError extends Error {}

export function validateCredentials(name: unknown, password: unknown): { name: string; password: string } {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) throw new AuthError('이름은 2~32자의 글자·숫자·_.-만 쓸 수 있습니다.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AuthError('비밀번호는 8~128자여야 합니다.');
  return { name, password };
}

/**
 * 계정과 로그인 세션. 비밀번호는 scrypt(솔트 16바이트)로만 저장하고, 세션 토큰은 32바이트 난수다.
 * 세션은 메모리에만 두므로 서버를 다시 켜면 다시 로그인한다.
 * 같은 이름·주소로 5번 틀리면 10분 동안 로그인을 막는다(비밀번호 대입 방지).
 */
export class AuthStore {
  private users: StoredUser[];
  private readonly sessions = new Map<string, SessionUser & { expires: number }>();
  /** 이름·주소별 실패. first부터 10분 안의 실패만 센다. until은 잠금 해제 시각(0이면 잠기지 않음). */
  private readonly failures = new Map<string, { count: number; first: number; until: number }>();

  private readonly file: string;
  private readonly sessionMs: number;

  constructor(file: string, sessionMs: number) {
    this.file = file;
    this.sessionMs = sessionMs;
    this.users = readJson<StoredUser[]>(file, []);
  }

  async register(nameInput: unknown, passwordInput: unknown): Promise<{ token: string; user: SessionUser }> {
    const { name, password } = validateCredentials(nameInput, passwordInput);
    if (this.users.some((user) => user.name.toLowerCase() === name.toLowerCase())) throw new AuthError('이미 있는 이름입니다.');
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, KEY_LENGTH);
    const user: StoredUser = { id: randomUUID(), name, salt: salt.toString('base64'), hash: hash.toString('base64'), createdAt: Date.now() };
    this.users = [...this.users, user];
    writeJsonAtomic(this.file, this.users);
    return { token: this.openSession(user), user: { id: user.id, name: user.name } };
  }

  /** @param clientKey 요청한 주소. 실패 횟수를 이름과 주소 쌍으로 센다. */
  async login(nameInput: unknown, passwordInput: unknown, clientKey: string, now = Date.now()): Promise<{ token: string; user: SessionUser }> {
    const key = `${String(nameInput).toLowerCase()}|${clientKey}`;
    const failure = this.failures.get(key);
    if (failure && failure.until > now) throw new AuthError('로그인 시도가 너무 많습니다. 10분 뒤에 다시 시도하세요.');
    const user = this.users.find((item) => typeof nameInput === 'string' && item.name.toLowerCase() === nameInput.toLowerCase());
    // 계정이 없어도 같은 계산을 해 응답 시간으로 계정 존재를 알 수 없게 한다.
    const salt = user ? Buffer.from(user.salt, 'base64') : randomBytes(16);
    const hash = await scrypt(typeof passwordInput === 'string' ? passwordInput.slice(0, 128) : '', salt, KEY_LENGTH);
    if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'base64'))) {
      const fresh = !failure || failure.until !== 0 || now - failure.first > LOCK_MS;
      const count = fresh ? 1 : failure.count + 1;
      this.failures.set(key, { count, first: fresh ? now : failure.first, until: count >= MAX_FAILURES ? now + LOCK_MS : 0 });
      throw new AuthError('이름 또는 비밀번호가 맞지 않습니다.');
    }
    this.failures.delete(key);
    return { token: this.openSession(user), user: { id: user.id, name: user.name } };
  }

  verify(token: unknown, now = Date.now()): SessionUser | null {
    if (typeof token !== 'string') return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expires <= now) { this.sessions.delete(token); return null; }
    return { id: session.id, name: session.name };
  }

  logout(token: string): void {
    this.sessions.delete(token);
  }

  private openSession(user: StoredUser): string {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { id: user.id, name: user.name, expires: Date.now() + this.sessionMs });
    return token;
  }
}
