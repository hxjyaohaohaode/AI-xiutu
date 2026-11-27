import 'dotenv/config';
import { createDatabase } from '@ai-xiutu/db';
import { createAiService } from '@ai-xiutu/ai';
import { createDeploymentGate } from '@ai-xiutu/storage';
import { setTimeout as delay } from 'node:timers/promises';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const db = createDatabase(process.env.DATABASE_URL);
const service = createAiService(db);
const deploymentHeld = createDeploymentGate(process.env.STORAGE_DIR ?? '.data/private');
const shutdown = new AbortController();
process.once('SIGINT', () => shutdown.abort());
process.once('SIGTERM', () => shutdown.abort());
console.log(
  service.configured
    ? 'AI worker dispatch enabled; lifecycle recovery is active.'
    : 'AI worker dispatch disabled; lifecycle recovery remains active.',
);
try {
  while (!shutdown.signal.aborted) {
    // Each iteration rechecks leases and durable dispatch evidence before claiming.
    // Drain queued work immediately. An idle worker sleeps until the next poll.
    if ((deploymentHeld() || !(await service.runOnce())) && !shutdown.signal.aborted) {
      await delay(2000, undefined, { signal: shutdown.signal });
    }
  }
} catch (error) {
  if (!(shutdown.signal.aborted && error instanceof Error && error.name === 'AbortError')) {
    console.error('AI worker stopped: database or dispatch consistency check failed.');
    // Supervisors using restart: on-failure must distinguish this from SIGTERM.
    process.exitCode = 1;
  }
} finally {
  await db.end();
}
