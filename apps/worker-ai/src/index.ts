import 'dotenv/config';
import { createDatabase } from '@ai-xiutu/db';
import { createAiService } from '@ai-xiutu/ai';
import { setTimeout } from 'node:timers/promises';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const db = createDatabase(process.env.DATABASE_URL);
const service = createAiService(db);
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
console.log(
  service.configured
    ? 'AI worker dispatch enabled; lifecycle recovery is active.'
    : 'AI worker dispatch disabled; lifecycle recovery remains active.',
);
try {
  while (!stopped) {
    try {
      // Disabled providers stop new dispatch, never lease recovery/hold safety.
      await service.runOnce();
    } catch {
      console.error(
        'AI worker paused: database/journal consistency check failed. Inspect recovery evidence before restart.',
      );
      break;
    }
    await setTimeout(2000);
  }
} finally {
  await db.end();
}
