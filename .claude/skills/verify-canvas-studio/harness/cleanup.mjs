// 사용법: node cleanup.mjs
// run.mjs가 띄우고 (비정상 종료로) 남긴 개발 서버만 끈다: server.pid.json에 적힌 PID와 그 자식.
// 증거 폴더(.verify-evidence/<시각>-<여정>/)는 지우지 않는다.
import { existsSync, readdirSync } from 'node:fs';
import { EVIDENCE_ROOT, stopRecordedServer, probe } from './lib.mjs';

const record = stopRecordedServer();
if (record) {
  const still = await probe(`http://127.0.0.1:${record.port}/`);
  console.log(`서버 pid ${record.pid} (port ${record.port}) 종료${still.ok ? ' 시도했으나 포트가 아직 응답함 — 직접 확인 필요' : ''}`);
} else console.log('정리할 서버 기록 없음');
const kept = existsSync(EVIDENCE_ROOT) ? readdirSync(EVIDENCE_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
console.log(`보존된 증거 폴더 ${kept.length}개: ${EVIDENCE_ROOT}`);
for (const name of kept.slice(-10)) console.log(`  ${name}`);
