import type { Database, PoolClient } from '../src/index.js';

/** Test-only faults around real PostgreSQL queries; no simulated successful SQL. */
export interface DatabaseFaults {
  afterCommitMatching?: string;
  beforeStatementMatching?: string;
  failPublicationCheck?: boolean;
  commitFailures?: number;
}
export function withDatabaseFaults(db: Database, faults: DatabaseFaults): Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'connect')
        return async (): Promise<PoolClient> => {
          const client = await target.connect();
          let marked = false;
          return new Proxy(client, {
            get(connection, method) {
              if (method === 'query')
                return async (...args: unknown[]) => {
                  const sql =
                    typeof args[0] === 'string'
                      ? args[0]
                      : ((args[0] as { text?: string })?.text ?? '');
                  if (
                    faults.beforeStatementMatching &&
                    sql.includes(faults.beforeStatementMatching)
                  ) {
                    faults.beforeStatementMatching = undefined;
                    throw new Error('TEST_SQL_BEFORE_PUBLICATION');
                  }
                  if (
                    faults.failPublicationCheck &&
                    sql.startsWith('SELECT storage_key FROM assets WHERE storage_key=')
                  )
                    throw new Error('TEST_AUTHORITATIVE_QUERY_UNAVAILABLE');
                  if (faults.afterCommitMatching && sql.includes(faults.afterCommitMatching))
                    marked = true;
                  const result = await Reflect.apply(connection.query, connection, args);
                  if (sql === 'COMMIT' && marked && faults.afterCommitMatching) {
                    faults.afterCommitMatching = undefined;
                    faults.commitFailures = (faults.commitFailures ?? 0) + 1;
                    throw new Error('TEST_COMMIT_ACK_LOST_AFTER_SUCCESS');
                  }
                  return result;
                };
              const value = Reflect.get(connection, method, connection);
              return typeof value === 'function' ? value.bind(connection) : value;
            },
          });
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
