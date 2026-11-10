import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl && process.env.REQUIRE_DB_TESTS === '1')
  throw new Error('TEST_DATABASE_URL is required');

test(
  'doctor runs against a real database and fails enabled but unavailable optional services',
  { skip: !databaseUrl },
  async () => {
    const fixture = await collaborationFixture(databaseUrl!);
    const catalogPrefix = `zz-doctor-${randomUUID()}-`;
    try {
      // More than two database pages, while deliberately keeping stdout's
      // original cap. The diagnostic must scan all models without dumping all.
      await fixture.db.query(
        `INSERT INTO model_configs(id,config)
        SELECT $1 || lpad(n::text,4,'0'), $2::jsonb
        FROM generate_series(1,450) n`,
        [catalogPrefix, JSON.stringify({ enabled: false, provider: 'qwen', operations: [] })],
      );
      const base = {
        ...process.env,
        DATABASE_URL: databaseUrl!,
        SESSION_SECRET: fixture.config.sessionSecret,
        APP_ORIGIN: fixture.origin,
        STORAGE_DIR: fixture.directory,
        AI_JOURNAL_DIR: join(fixture.directory, 'doctor-journal'),
        AI_ASSISTANT_ENABLED: 'false',
        AI_VOICE_ENABLED: 'false',
        MEDIA_ADVANCED_ENABLED: 'false',
        OPENAI_API_KEY: '',
        TENCENT_SECRET_ID: '',
        TENCENT_SECRET_KEY: '',
        MEDIA_PYTHON: '',
        ASSISTANT_EGRESS_PROXY: '',
        NODE_USE_ENV_PROXY: '0',
      };
      async function run(extra: Record<string, string> = {}) {
        return new Promise<{
          code: number;
          checks: { check: string; ok: boolean; detail: string }[];
        }>((yes, no) => {
          execFile(
            process.execPath,
            ['--import', 'tsx', 'scripts/doctor.ts'],
            {
              cwd: resolve(import.meta.dirname, '../../..'),
              env: { ...base, ...extra },
              timeout: 30_000,
              maxBuffer: 256_000,
            },
            (error, stdout) => {
              if (error && typeof error.code !== 'number') {
                no(error);
                return;
              }
              try {
                yes({
                  code: typeof error?.code === 'number' ? error.code : 0,
                  checks: JSON.parse(stdout).checks,
                });
              } catch (parseError) {
                no(parseError);
              }
            },
          );
        });
      }
      const disabled = await run();
      assert.equal(disabled.code, 0);
      assert.equal(
        disabled.checks.every((item) => item.ok),
        true,
      );
      assert.match(
        disabled.checks.find((item) => item.check === 'live-vendor-validation')!.detail,
        /NOT PERFORMED/,
      );
      const catalog = JSON.parse(disabled.checks.find((item) => item.check === 'adapters')!.detail);
      const count = Number(
        (await fixture.db.query('SELECT count(*) FROM model_configs')).rows[0]!.count,
      );
      assert.equal(catalog.modelCount, count);
      assert.equal(catalog.models.length, 40);
      assert.equal(catalog.modelsOmitted, count - 40);

      const voiceWithoutCredentials = await run({
        AI_ASSISTANT_ENABLED: 'true',
        AI_VOICE_ENABLED: 'true',
      });
      assert.equal(voiceWithoutCredentials.code, 1);
      assert.equal(
        voiceWithoutCredentials.checks.find(
          (item) => item.check === 'assistant-and-dispatch-journal',
        )!.ok,
        false,
      );
      const unavailableNative = await run({
        MEDIA_ADVANCED_ENABLED: 'true',
        MEDIA_PYTHON: join(fixture.directory, 'missing-python'),
      });
      assert.equal(unavailableNative.code, 1);
      assert.equal(
        unavailableNative.checks.find((item) => item.check === 'advanced-media')!.ok,
        false,
      );
      assert.equal(unavailableNative.checks.find((item) => item.check === 'database')!.ok, true);
      const invalidProxy = await run({ ASSISTANT_EGRESS_PROXY: 'socks5://127.0.0.1:9' });
      assert.equal(invalidProxy.code, 1);
      assert.equal(
        invalidProxy.checks.find((item) => item.check === 'egress-configuration')!.ok,
        false,
      );
      await fixture.db.query(
        `INSERT INTO assistant_model_configs(id,config)
        SELECT $1 || lpad(n::text,4,'0'), $2::jsonb
        FROM generate_series(1,450) n`,
        [
          catalogPrefix,
          JSON.stringify({
            enabled: false,
            provider: 'openai',
            operations: ['assistant-turn'],
            unitCost: 1,
          }),
        ],
      );
      await fixture.db.query('INSERT INTO assistant_model_configs(id,config) VALUES($1,$2)', [
        `${catalogPrefix}9999`,
        JSON.stringify({ enabled: true, operations: ['not-an-operation'] }),
      ]);
      const invalidLateCatalog = await run();
      assert.equal(invalidLateCatalog.code, 1);
      const lateCheck = invalidLateCatalog.checks.find(
        (item) => item.check === 'assistant-and-dispatch-journal',
      )!;
      assert.equal(
        lateCheck.ok,
        false,
        'invalid configurations beyond the printed sample cannot be hidden',
      );
      const late = JSON.parse(lateCheck.detail);
      assert.equal(late.invalidModelCount, 1);
      assert.equal(late.models.length, 40);
      assert.ok(late.modelCount > 450);
      assert.equal(
        late.models.some((model: { id: string }) => model.id === `${catalogPrefix}9999`),
        false,
      );
    } finally {
      await fixture.db.query('DELETE FROM assistant_model_configs WHERE starts_with(id,$1)', [
        catalogPrefix,
      ]);
      await fixture.db.query('DELETE FROM model_configs WHERE starts_with(id,$1)', [catalogPrefix]);
      await fixture.close();
    }
  },
);
