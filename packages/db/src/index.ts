import pg from 'pg';
import { schemaSql, schemaV2Sql } from './schema.js';

export type { PoolClient, QueryResultRow } from 'pg';
export type Database = pg.Pool;
export type Queryable = Pick<pg.PoolClient, 'query'>;

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
export async function migrate(db: Database): Promise<void> {
  await transaction(db, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('ai-xiutu-schema'))");
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rowCount } = await tx.query('SELECT version FROM schema_migrations WHERE version=1');
    if (!rowCount) {
      await tx.query(schemaSql);
      await tx.query('INSERT INTO schema_migrations(version) VALUES(1)');
    }
    if (!(await tx.query('SELECT version FROM schema_migrations WHERE version=2')).rowCount) {
      await tx.query(schemaV2Sql);
      await tx.query('INSERT INTO schema_migrations(version) VALUES(2)');
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
