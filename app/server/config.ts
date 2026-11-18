import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 서버 설정. 값은 모두 app\.env(또는 환경변수)에서 읽고, 없으면 Windows 기본 경로를 쓴다. */
export interface ServerConfig {
  host: string;
  port: number;
  /** 계정·파일 저장 위치. 기본 %APPDATA%\CanvasStudio\server */
  dataDir: string;
  /** 로그 위치. 기본 %LOCALAPPDATA%\CanvasStudio\logs */
  logDir: string;
  /** 브라우저 Origin 허용 목록. 다른 사이트의 페이지가 이 서버에 붙지 못하게 한다. */
  allowedOrigins: string[];
  sessionHours: number;
}

const APP_NAME = 'CanvasStudio';

/** app\.env가 있으면 환경변수로 읽는다(이미 설정된 값이 우선). */
export function loadEnvFile(appDir: string): void {
  const file = join(appDir, '.env');
  if (!existsSync(file)) return;
  try { process.loadEnvFile(file); }
  catch (error) { throw new Error(`[loadEnvFile] .env 읽기 실패 - ${file}: ${error instanceof Error ? error.message : String(error)}`); }
}

/**
 * 환경변수에서 설정을 만든다. 포트·시간은 범위를 검사하고, 어긋나면 어떤 값이 왜 틀렸는지 담아 던진다.
 * @param env 환경변수 표(테스트에서 바꿔 넣는다)
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.COLLAB_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`[loadConfig] COLLAB_PORT 값이 잘못됨 - ${env.COLLAB_PORT}`);
  const sessionHours = Number(env.COLLAB_SESSION_HOURS ?? 168);
  if (!Number.isFinite(sessionHours) || sessionHours <= 0) throw new Error(`[loadConfig] COLLAB_SESSION_HOURS 값이 잘못됨 - ${env.COLLAB_SESSION_HOURS}`);
  const appData = env.APPDATA ?? join(env.USERPROFILE ?? '.', 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? '.', 'AppData', 'Local');
  return {
    host: env.COLLAB_HOST || '127.0.0.1',
    port,
    dataDir: resolve(env.COLLAB_DATA_DIR || join(appData, APP_NAME, 'server')),
    logDir: resolve(env.COLLAB_LOG_DIR || join(localAppData, APP_NAME, 'logs')),
    allowedOrigins: (env.COLLAB_ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map((item) => item.trim()).filter(Boolean),
    sessionHours
  };
}
