/**
 * Locating and applying the repo's SQL files (migrations + dev seed) with
 * postgres.js. Shared by the global setup (template build) and the tests that
 * re-apply 0011/dev_seed to prove idempotency (AC-DB-02).
 *
 * postgres.js executes parameterless `sql.file()` calls over the simple query
 * protocol, so multi-statement files (including `do $$ ... $$` blocks and the
 * seed's begin/commit) run as-is.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

export const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
export const DEV_SEED_PATH = join(REPO_ROOT, 'supabase', 'seed', 'dev_seed.sql');
export const WEB_APP_DIR = join(REPO_ROOT, 'apps', 'web');

/** Migration file names in apply order (numeric prefix = lexicographic). */
export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

export async function applySqlFile(
  sql: postgres.Sql,
  path: string,
): Promise<void> {
  await sql.file(path);
}

export async function applyMigrations(sql: postgres.Sql): Promise<string[]> {
  const files = listMigrationFiles();
  for (const file of files) {
    try {
      await applySqlFile(sql, join(MIGRATIONS_DIR, file));
    } catch (error) {
      throw new Error(
        `Migration ${file} failed to apply: ${String(error)}`,
        { cause: error },
      );
    }
  }
  return files;
}

export async function applyDevSeed(sql: postgres.Sql): Promise<void> {
  await applySqlFile(sql, DEV_SEED_PATH);
}
