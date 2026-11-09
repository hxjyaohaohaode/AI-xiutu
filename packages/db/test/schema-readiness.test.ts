import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  createDatabase,
  getSchemaReadiness,
  LATEST_SCHEMA_VERSION,
  REQUIRED_SCHEMA_VERSIONS,
  migrate,
  transaction,
} from '../src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'schema readiness uses the migration registry and rejects old, incomplete and newer databases',
  { skip: !databaseUrl },
  async (t) => {
    const db = createDatabase(databaseUrl!);
    await migrate(db);
    try {
      await t.test(
        'migrate and readiness agree on the actual highest registered migration',
        async () => {
          const schema = await getSchemaReadiness(db);
          assert.equal(schema.ready, true);
          assert.equal(schema.requiredVersion, LATEST_SCHEMA_VERSION);
          assert.equal(schema.currentVersion, REQUIRED_SCHEMA_VERSIONS.at(-1));
          assert.ok(schema.currentVersion >= 7);
          await migrate(db);
          assert.deepEqual(await getSchemaReadiness(db), schema);
        },
      );
      for (const [name, versions, expectedMissing, unexpected] of [
        ['old v2', [1, 2], REQUIRED_SCHEMA_VERSIONS.filter((version) => version > 2), []],
        [
          'missing intermediate',
          REQUIRED_SCHEMA_VERSIONS.filter((version) => version !== 4),
          [4],
          [],
        ],
        [
          'newer than this code',
          [...REQUIRED_SCHEMA_VERSIONS, LATEST_SCHEMA_VERSION + 1],
          [],
          [LATEST_SCHEMA_VERSION + 1],
        ],
        ['empty', [], [...REQUIRED_SCHEMA_VERSIONS], []],
      ] as const) {
        await t.test(name, async () => {
          await transaction(db, async (tx) => {
            // Session-local shadow of only the migration ledger; the actual fixture
            // schema and all published migration records stay unchanged.
            await tx.query(
              'CREATE TEMP TABLE schema_migrations(version integer PRIMARY KEY) ON COMMIT DROP',
            );
            for (const version of versions)
              await tx.query('INSERT INTO schema_migrations VALUES($1)', [version]);
            const schema = await getSchemaReadiness(tx);
            assert.equal(schema.ready, false);
            assert.equal(schema.requiredVersion, LATEST_SCHEMA_VERSION);
            assert.deepEqual(schema.missingVersions, expectedMissing);
            assert.deepEqual(schema.unexpectedVersions, unexpected);
          });
        });
      }
      await t.test(
        'doctor CLI reports the complete current schema without contacting vendors',
        async () => {
          const directory = await mkdtemp(join(tmpdir(), 'xiutu-doctor-'));
          const cli = fileURLToPath(new URL('../../../scripts/doctor.ts', import.meta.url));
          try {
            const result = await new Promise<{ code: number | null; out: string; err: string }>(
              (resolve, reject) => {
                const child = spawn(process.execPath, ['--import', 'tsx', cli], {
                  env: {
                    ...process.env,
                    DATABASE_URL: databaseUrl!,
                    DB_POOL_MAX: '1',
                    DOTENV_CONFIG_PATH: '/dev/null',
                    SESSION_SECRET: randomUUID() + randomUUID(),
                    APP_ORIGIN: 'http://localhost:5173',
                    STORAGE_DIR: directory,
                    AI_PLAN_ENABLED: 'false',
                    AI_IMAGE_ENABLED: 'false',
                    AI_TEXT_ENABLED: 'false',
                    AI_SPEECH_ENABLED: 'false',
                  },
                  stdio: ['ignore', 'pipe', 'pipe'],
                });
                let out = '',
                  err = '';
                child.stdout.on('data', (value: Buffer) => {
                  out += value.toString();
                });
                child.stderr.on('data', (value: Buffer) => {
                  err += value.toString();
                });
                child.on('error', reject);
                child.on('exit', (code) => resolve({ code, out, err }));
              },
            );
            assert.equal(result.code, 0, result.err + result.out);
            const report = JSON.parse(result.out) as {
              checks: { check: string; ok: boolean; detail: string }[];
            };
            const schema = report.checks.find((entry) => entry.check === 'database')!;
            assert.equal(schema.ok, true);
            assert.match(schema.detail, new RegExp(`required ${LATEST_SCHEMA_VERSION}`));
            assert.match(schema.detail, /missing \[\]/);
            assert.match(
              report.checks.find((entry) => entry.check === 'live-vendor-validation')!.detail,
              /NOT PERFORMED/,
            );
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        },
      );
    } finally {
      await db.end();
    }
  },
);
