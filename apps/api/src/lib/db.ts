/**
 * postgres.js connection pool and transaction helper (docs/06-BACKEND.md §2.1).
 *
 * No `transform: postgres.camel` — repositories map snake_case columns to
 * camelCase domain objects explicitly, so the mapping is visible and reviewable.
 */
import postgres from 'postgres';

export type Db = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Either the pool or an open transaction — what repositories accept. */
export type Queryable = Db | Tx;

export function createDb(databaseUrl: string): Db {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Notices (e.g. from triggers) go nowhere; real errors still throw.
    onnotice: () => {},
  });
}

/**
 * Run `fn` inside an explicit transaction. Every multi-write operation goes
 * through here (06 §2.1); `emitEvent` is always called with the `tx` handle so
 * the event row commits or rolls back with the state change it records.
 */
export async function withTransaction<T>(
  db: Db,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const result = await db.begin((tx) => fn(tx));
  return result as T;
}
