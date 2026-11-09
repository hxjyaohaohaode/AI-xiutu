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
    ? 'AI adjustment-plan worker enabled.'
    : 'AI adjustment-plan worker disabled: external services require explicit configuration.',
);
try {
  while (!stopped) {
    try {
      if (service.configured) await service.runOnce();
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
