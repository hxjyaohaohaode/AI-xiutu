import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase } from '@ai-xiutu/db';
import { createAiService } from '@ai-xiutu/ai';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
export { buildApp } from './app.js';

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.databaseUrl);
  const app = await buildApp({ config, db, aiService: createAiService(db) });
  try {
    await app.listen({ port: config.port, host: config.host });
    process.stdout.write(`API listening on ${config.host}:${config.port}\n`);
  } catch (error) {
    await app.close();
    await db.end();
    throw error;
  }
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close();
    await db.end();
  }
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
