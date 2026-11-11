import 'dotenv/config';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDatabase, getSchemaReadiness, transaction, type Database } from '@ai-xiutu/db';
import { createAiService } from '@ai-xiutu/ai';
import {
  createTencentSms,
  createTencentTextModerator,
  createTencentImageModerator,
} from '@ai-xiutu/providers';
import { createPrivateStorage } from '@ai-xiutu/storage';
import { getMediaCapabilities } from '@ai-xiutu/media';
import { assistantModelConfigSchema, VOICE_MODELS } from '@ai-xiutu/assistant';
import { loadConfig } from '../apps/api/src/config.js';
import { LocalPrivateStorage } from '../apps/api/src/storage.js';
import { createAssistantService } from '../apps/api/src/assistant/service.js';

// Checks local readiness only. No SMS, moderation or model requests are sent.
const results: { check: string; ok: boolean; detail: string }[] = [];
let db: ReturnType<typeof createDatabase> | undefined;
/** Inspect every row in a stable snapshot, but keep a bounded diagnostic sample.
 * Repeated integration runs and large operator catalogs must not grow stdout
 * or retained capability trees without limit. This never calls a provider. */
async function catalogSummary<T>(
  database: Database,
  table: 'model_configs' | 'assistant_model_configs',
  inspect: (row: { id: string; config: unknown }) => { valid: boolean; value: T },
) {
  return transaction(database, async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const models: T[] = [];
    let after: string | null = null;
    let modelCount = 0;
    let invalidModelCount = 0;
    for (;;) {
      const page: { rows: { id: string; config: unknown }[] } = await tx.query(
        `SELECT id,config FROM ${table} WHERE ($1::text IS NULL OR id>$1) ORDER BY id LIMIT 200`,
        [after],
      );
      for (const row of page.rows) {
        const description = inspect(row);
        modelCount++;
        if (!description.valid) invalidModelCount++;
        if (models.length < 40) models.push(description.value);
        after = row.id;
      }
      if (page.rows.length < 200) break;
    }
    return {
      models,
      modelCount,
      invalidModelCount,
      modelsOmitted: modelCount - models.length,
      sampleLimit: 40,
    };
  });
}
try {
  const config = loadConfig();
  results.push({
    check: 'configuration',
    ok: true,
    detail: 'Required configuration and exact origin allowlist parsed; secret values are omitted.',
  });
  db = createDatabase(config.databaseUrl);
  await db.query('SELECT 1');
  const schema = await getSchemaReadiness(db);
  results.push({
    check: 'database',
    ok: schema.ready,
    detail: `Reachable. Schema version ${schema.currentVersion}; required ${schema.requiredVersion}; missing [${schema.missingVersions.join(',')}]; unexpected [${schema.unexpectedVersions.join(',')}]. Native/WASM provenance must be recorded separately.`,
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
  const catalog = await catalogSummary(db, 'model_configs', (model) => {
    const description = ai.describeModel(
      model.id,
      model.config as Parameters<typeof ai.describeModel>[1],
    );
    return {
      valid: true,
      value: {
        id: model.id.slice(0, 160),
        idTruncated: model.id.length > 160,
        runtimeAvailable: description.runtimeAvailable,
        runtimeOperations: description.runtimeOperations,
        runtimeReason: description.runtimeReason,
      },
    };
  });
  results.push({
    check: 'adapters',
    ok: true,
    detail: JSON.stringify({
      smsConfigured: createTencentSms().configured,
      textModerationConfigured: createTencentTextModerator().configured,
      imageModerationConfigured: createTencentImageModerator().configured,
      availableOperations: ai.availableOperations,
      ...catalog,
    }),
  });
  const assistant = createAssistantService(
    db,
    new LocalPrivateStorage(config),
    {},
    join(process.env.AI_JOURNAL_DIR ?? config.storageDir, 'assistant'),
  );
  await assistant.assertJournal();
  const assistantModels = await catalogSummary(db, 'assistant_model_configs', (row) => {
    const parsed = assistantModelConfigSchema.safeParse(row.config);
    return {
      valid: parsed.success,
      value: {
        id: row.id.slice(0, 160),
        idTruncated: row.id.length > 160,
        configValid: parsed.success,
        enabled: parsed.success && parsed.data.enabled,
        operations: parsed.success ? parsed.data.operations : [],
        voiceProfileKnown: VOICE_MODELS.some((model) => model.id === row.id),
      },
    };
  });
  results.push({
    check: 'assistant-and-dispatch-journal',
    ok:
      assistantModels.invalidModelCount === 0 &&
      (process.env.AI_ASSISTANT_ENABLED !== 'true' || assistant.ready) &&
      (process.env.AI_VOICE_ENABLED !== 'true' || assistant.voiceReady),
    detail: JSON.stringify({
      ready: assistant.ready,
      voiceReady: assistant.voiceReady,
      reason: assistant.reason,
      ...assistantModels,
      journalConsistent: true,
      liveAccountTested: false,
    }),
  });
  const media = await getMediaCapabilities({
    pythonExecutable: process.env.MEDIA_PYTHON || undefined,
    ultraHdrLibrary: process.env.MEDIA_UHDR_LIBRARY || undefined,
  });
  const mediaEnabled = process.env.MEDIA_ADVANCED_ENABLED === 'true';
  results.push({
    check: 'advanced-media',
    ok: !mediaEnabled || (
      media.available && (!process.env.MEDIA_PYTHON || media.nativeReady) &&
      (!process.env.MEDIA_UHDR_LIBRARY || media.ultraHdrJpeg.available)
    ),
    detail: JSON.stringify({ enabled: mediaEnabled, ...media }),
  });
  const proxy = process.env.ASSISTANT_EGRESS_PROXY;
  let voiceProxyValid = true;
  if (proxy) {
    try {
      const url = new URL(proxy);
      voiceProxyValid =
        ['http:', 'https:'].includes(url.protocol) &&
        !url.hash &&
        (!url.pathname || url.pathname === '/');
    } catch {
      voiceProxyValid = false;
    }
  }
  results.push({
    check: 'egress-configuration',
    ok: voiceProxyValid,
    detail: JSON.stringify({
      voiceProxyConfigured: Boolean(proxy),
      voiceProxyValid,
      httpProxyOptIn: process.env.NODE_USE_ENV_PROXY === '1',
      startupRequired: true,
      httpProxyConfigured: Boolean(process.env.HTTP_PROXY || process.env.HTTPS_PROXY),
      connectivityTested: false,
      mainlandReachabilityTested: false,
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
