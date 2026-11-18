// 협업 서버 실행: cd app; npm run server
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadEnvFile } from './config.ts';
import { createLogger } from './log.ts';
import { startServer } from './app.ts';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');

try {
  loadEnvFile(appDir);
  const config = loadConfig();
  const log = createLogger(config.logDir);
  log.info(`[main] 데이터 ${config.dataDir}, 로그 ${config.logDir}, 허용 origin ${config.allowedOrigins.join(' ')}`);
  const server = await startServer(config, log);
  // Ctrl+C로 끌 때 아직 저장하지 않은 파일을 먼저 쓴다.
  const stop = (): void => { void server.close().then(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
