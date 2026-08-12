/**
 * Vitest global setup for the integration suite.
 *
 * Database resolution, in order:
 *   1. TEST_DATABASE_URL — a superuser connection to any Postgres 15
 *      (locally: `bash scripts/test-db.sh` prints the export line).
 *   2. @testcontainers/postgresql postgres:15 container (CI, Docker present).
 *   3. Neither available → fail with instructions.
 *
 * It then builds ONE template database with migrations 0001–0011 applied
 * (this is itself the first half of AC-DB-01: all migrations must apply
 * cleanly to an empty database, or the whole suite refuses to start), and
 * provides the admin URL + template name to the workers. Each test file
 * clones the template via `create database ... template ...`, which is
 * milliseconds instead of re-running DDL per file.
 *
 * Teardown drops every `sdb_it_*` database and stops the container if one
 * was started.
 */
import postgres from 'postgres';
import type { GlobalSetupContext } from 'vitest/node';
import { applyMigrations } from './sql-files.js';

export const TEMPLATE_DB = 'sdb_it_template';

interface StartedContainerLike {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

declare module 'vitest' {
  export interface ProvidedContext {
    sdbAdminUrl: string;
    sdbTemplateDb: string;
  }
}

function admin(url: string): postgres.Sql {
  return postgres(url, { max: 1, onnotice: () => {} });
}

function withDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

export default async function setup({
  provide,
}: GlobalSetupContext): Promise<() => Promise<void>> {
  let container: StartedContainerLike | null = null;
  let adminUrl = process.env.TEST_DATABASE_URL;

  if (adminUrl === undefined || adminUrl === '') {
    try {
      const { PostgreSqlContainer } = await import(
        '@testcontainers/postgresql'
      );
      container = await new PostgreSqlContainer('postgres:15').start();
      adminUrl = container.getConnectionUri();
    } catch (error) {
      throw new Error(
        [
          'Integration tests need a Postgres 15 database and none is available.',
          'Either:',
          '  1. Start the local scratch cluster and export the URL it prints:',
          '       bash scripts/test-db.sh',
          '       export TEST_DATABASE_URL=postgres://sdb_it@127.0.0.1:54330/postgres',
          '  2. Or make Docker available so @testcontainers/postgresql can start postgres:15.',
          `Underlying error: ${String(error)}`,
        ].join('\n'),
        { cause: error },
      );
    }
  }

  // Build the template database from scratch every run.
  const adminSql = admin(adminUrl);
  try {
    await adminSql`select 1`;
  } catch (error) {
    throw new Error(
      `Cannot connect to TEST_DATABASE_URL (${adminUrl}): ${String(error)}\n` +
        'Is the scratch cluster running? Start it with: bash scripts/test-db.sh',
      { cause: error },
    );
  }

  // Drop leftovers from a previous run, then create an empty template.
  try {
    const stale = await adminSql<{ datname: string }[]>`
      select datname from pg_database where datname like 'sdb_it_%'
    `;
    for (const row of stale) {
      await adminSql.unsafe(`drop database "${row.datname}" with (force)`);
    }
    await adminSql.unsafe(`create database "${TEMPLATE_DB}"`);
  } finally {
    await adminSql.end({ timeout: 5 });
  }

  // AC-DB-01 (first half): all migrations apply cleanly to an empty DB.
  // The PRD's original set is 0001-0011; later forward-only fixes append.
  const templateSql = postgres(withDatabase(adminUrl, TEMPLATE_DB), {
    max: 1,
    onnotice: () => {},
  });
  try {
    const applied = await applyMigrations(templateSql);
    if (applied.length < 11) {
      throw new Error(
        `Expected at least the 11 PRD migrations, found ${applied.length}: ${applied.join(', ')}`,
      );
    }
  } finally {
    // The template must have zero connections for `create database ... template`.
    await templateSql.end({ timeout: 5 });
  }

  provide('sdbAdminUrl', adminUrl);
  provide('sdbTemplateDb', TEMPLATE_DB);

  return async () => {
    const cleanup = admin(adminUrl);
    try {
      const dbs = await cleanup<{ datname: string }[]>`
        select datname from pg_database where datname like 'sdb_it_%'
      `;
      for (const row of dbs) {
        await cleanup.unsafe(`drop database "${row.datname}" with (force)`);
      }
    } finally {
      await cleanup.end({ timeout: 5 });
    }
    if (container !== null) {
      await container.stop();
    }
  };
}
