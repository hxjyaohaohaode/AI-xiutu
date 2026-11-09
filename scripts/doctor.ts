import 'dotenv/config';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '@ai-xiutu/db';
import { createAiService } from '@ai-xiutu/ai';
import {
  createTencentSms,
  createTencentTextModerator,
  createTencentImageModerator,
} from '@ai-xiutu/providers';
import { createPrivateStorage } from '@ai-xiutu/storage';
import { loadConfig } from '../apps/api/src/config.js';

// Checks local readiness only. No SMS, moderation or model requests are sent.
const results: { check: string; ok: boolean; detail: string }[] = [];
let db: ReturnType<typeof createDatabase> | undefined;
try {
  const config = loadConfig();
  results.push({
    check: 'configuration',
    ok: true,
    detail: 'Required configuration and exact origin allowlist parsed; secret values are omitted.',
  });
  db = createDatabase(config.databaseUrl);
  await db.query('SELECT 1');
  const version = (await db.query('SELECT max(version) AS version FROM schema_migrations')).rows[0]
    ?.version;
  results.push({
    check: 'database',
    ok: Number(version) >= 2,
    detail: `Reachable. Schema version ${Number(version) || 0}; native/WASM provenance must be recorded separately.`,
  });
  const storage = createPrivateStorage();
  await storage.initialize();
  const temporary = await mkdtemp(join(resolve(config.storageDir), '.readiness-'));
  try {
    const file = await open(join(temporary, 'write-check'), 'wx', 0o600);
    try {
      await file.writeFile(randomBytes(32));
      await file.sync();
    } finally {
      await file.close();
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  results.push({
    check: 'private-storage',
    ok: true,
    detail: 'Private-directory create/write/fsync/remove succeeded; no user asset was changed.',
  });
  const ai = createAiService(db);
  const catalog = (await db.query('SELECT id,config FROM model_configs')).rows.map((model) => ({
    id: model.id,
    ...ai.describeModel(model.id, model.config),
  }));
  results.push({
    check: 'adapters',
    ok: true,
    detail: JSON.stringify({
      smsConfigured: createTencentSms().configured,
      textModerationConfigured: createTencentTextModerator().configured,
      imageModerationConfigured: createTencentImageModerator().configured,
      availableOperations: ai.availableOperations,
      models: catalog,
    }),
  });
  results.push({
    check: 'live-vendor-validation',
    ok: true,
    detail:
      'NOT PERFORMED. Configured means keys/settings exist, not that accounts, models, invoices or delivery were verified.',
  });
} catch (error) {
  const name =
    error instanceof Error && /^[a-zA-Z]{1,60}$/.test(error.name) ? error.name : 'ReadinessError';
  const code =
    typeof (error as { code?: unknown })?.code === 'string' &&
    /^[a-zA-Z0-9_]{1,60}$/.test((error as { code: string }).code)
      ? (error as { code: string }).code
      : 'UNAVAILABLE';
  results.push({
    check: 'readiness',
    ok: false,
    detail: `${name} (${code}). Check your private configuration and database readiness. Raw exception text is omitted because it may contain credentials.`,
  });
} finally {
  await db?.end();
}
process.stdout.write(
  JSON.stringify({ checkedAt: new Date().toISOString(), checks: results }, null, 2) + '\n',
);
if (results.some((result) => !result.ok)) process.exitCode = 1;
