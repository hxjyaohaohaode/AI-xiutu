import pg from 'pg';
import { schemaSql, schemaV2Sql } from './schema.js';
import { schemaV3Sql } from './schema-v3.js';
import { schemaV4Sql } from './schema-v4.js';
import { schemaV5Sql } from './schema-v5.js';
import { schemaV6Sql } from './schema-v6.js';
import { schemaV7Sql } from './schema-v7.js';
import { schemaV8Sql } from './schema-v8.js';
import { schemaV9Sql } from './schema-v9.js';
import { schemaV10Sql } from './schema-v10.js';
import { schemaV11Sql } from './schema-v11.js';
import { schemaV12Sql } from './schema-v12.js';
import { schemaV13Sql } from './schema-v13.js';
import { schemaV14Sql } from './schema-v14.js';
import { schemaV15Sql } from './schema-v15.js';
import { schemaV16Sql } from './schema-v16.js';
import { schemaV17Sql } from './schema-v17.js';

export type { PoolClient, QueryResultRow } from 'pg';
export type Database = pg.Pool;
export type Queryable = Pick<pg.PoolClient, 'query'>;

// This is the sole ordered migration registry. Readiness and migration execution
// derive their expected version from the same entries; published SQL stays intact.
const migrations = [
  { version: 1, sql: schemaSql },
  { version: 2, sql: schemaV2Sql },
  { version: 3, sql: schemaV3Sql },
  { version: 4, sql: schemaV4Sql },
  { version: 5, sql: schemaV5Sql },
  { version: 6, sql: schemaV6Sql },
  { version: 7, sql: schemaV7Sql },
  { version: 8, sql: schemaV8Sql },
  { version: 9, sql: schemaV9Sql },
  { version: 10, sql: schemaV10Sql },
  { version: 11, sql: schemaV11Sql },
  { version: 12, sql: schemaV12Sql },
  { version: 13, sql: schemaV13Sql },
  { version: 14, sql: schemaV14Sql },
  { version: 15, sql: schemaV15Sql },
  { version: 16, sql: schemaV16Sql },
  { version: 17, sql: schemaV17Sql },
] as const;
export const REQUIRED_SCHEMA_VERSIONS: readonly number[] = Object.freeze(
  migrations.map(({ version }) => version),
);
export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

/** A high maximum alone cannot prove that earlier migrations were applied. */
export async function getSchemaReadiness(db: Queryable) {
  const rows = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set<number>(rows.rows.map((row) => Number(row.version)));
  const currentVersion = Math.max(0, ...applied);
  const missingVersions = REQUIRED_SCHEMA_VERSIONS.filter((version) => !applied.has(version));
  const unexpectedVersions = [...applied].filter(
    (version) => !REQUIRED_SCHEMA_VERSIONS.includes(version),
  );
  return {
    ready: missingVersions.length === 0 && unexpectedVersions.length === 0,
    currentVersion,
    requiredVersion: LATEST_SCHEMA_VERSION,
    missingVersions,
    unexpectedVersions,
  };
}

export function createDatabase(connectionString: string): Database {
  return new pg.Pool({
    connectionString,
    max: Math.max(1, Math.min(50, Number(process.env.DB_POOL_MAX) || 10)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'ai-xiutu',
    statement_timeout: 15_000,
  });
}
export * from './quota.js';
export * from './assistant-grants.js';
export async function transaction<T>(
  db: Database,
  work: (tx: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('BEGIN');
    const value = await work(tx);
    await tx.query('COMMIT');
    return value;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}
/** Coordinate publication and cleanup even when a COMMIT acknowledgement is lost.
 * A fresh SELECT alone could run before the original transaction has ended. */
export async function lockAssetStorageKeys(tx: Queryable, keys: readonly string[]): Promise<void> {
  for (const key of [...new Set(keys)].sort())
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `ai-xiutu:asset-publication:${key}`,
    ]);
}
/** Caller must preserve private candidates if this authoritative check fails.
 * Deleted rows and completed copies still count as references; reclamation is
 * deliberately conservative and not a retention/garbage-collection policy. */
export async function discardUnreferencedStorageKeys(
  db: Database,
  keys: readonly string[],
  discard: (key: string) => Promise<void>,
): Promise<void> {
  const unique = [...new Set(keys)].sort();
  if (!unique.length) return;
  await transaction(db, async (tx) => {
    await lockAssetStorageKeys(tx, unique);
    const result = await tx.query(
      'SELECT storage_key FROM assets WHERE storage_key=ANY($1::text[])',
      [unique],
    );
    const referenced = new Set(result.rows.map((row) => row.storage_key));
    for (const key of unique) if (!referenced.has(key)) await discard(key);
  });
}
export async function migrate(db: Database): Promise<void> {
  await transaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ai-xiutu-schema'))");
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const migration of migrations) {
      if (
        !(
          await tx.query('SELECT version FROM schema_migrations WHERE version=$1', [
            migration.version,
          ])
        ).rowCount
      ) {
        await tx.query(migration.sql);
        await tx.query('INSERT INTO schema_migrations(version) VALUES($1)', [migration.version]);
      }
    }
  });
}
export async function audit(
  tx: Queryable,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await tx.query(
    'INSERT INTO audit_entries(actor_id,action,target_type,target_id,detail) VALUES($1,$2,$3,$4,$5)',
    [actorId, action, targetType, targetId, JSON.stringify(detail)],
  );
}
export async function emit(
  tx: Queryable,
  spaceId: string,
  projectId: string | null,
  type: string,
  entityId: string | null,
): Promise<void> {
  // Serialize sequence allocation until commit within a space, so a cursor cannot skip
  // a lower identity value whose transaction commits after a higher returned value.
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`events:${spaceId}`]);
  await tx.query('INSERT INTO events(space_id,project_id,type,entity_id) VALUES($1,$2,$3,$4)', [
    spaceId,
    projectId,
    type,
    entityId,
  ]);
}
