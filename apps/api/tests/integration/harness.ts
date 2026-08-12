/**
 * Integration-test harness.
 *
 * - freshDb(): per-test-file database cloned from the migrated template
 *   (created by global-setup.ts), optionally with supabase/seed/dev_seed.sql
 *   applied. Files are isolated from each other and parallel-safe.
 * - buildTestApp(): the real buildApp() wired to the fresh database with a
 *   locally-generated JWKS (mintToken signs against it) and the real DB
 *   context loader — JWT subs resolve through users/user_roles/permissions
 *   exactly as in production.
 * - fixtures for users/roles/memberships so tokens map to DB users.
 * - expectPgError(): asserts a promise rejects with a given SQLSTATE.
 * - expectTenantIsolated(): reusable AC-AUTH-05 assertion — grows with the
 *   endpoint matrix in P2+.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { expect, inject } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { GhlFetch } from '../../src/integrations/gohighlevel.js';
import type { Db } from '../../src/lib/db.js';
import type { CvFetcher } from '../../src/services/candidate-webhook.service.js';
import {
  createTestAuth,
  stubStorage,
  stubSupabaseAdmin,
  testEnv,
  type StorageStub,
  type TestAuth,
} from '../helpers.js';
import { applyDevSeed } from './sql-files.js';

export function adminUrl(): string {
  return inject('sdbAdminUrl');
}

export function templateDb(): string {
  return inject('sdbTemplateDb');
}

export function urlForDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/** postgres.js handle for an arbitrary database URL, notices silenced. */
export function sqlFor(url: string, max = 5): Db {
  return postgres(url, { max, onnotice: () => {} });
}

export interface TestDb {
  name: string;
  url: string;
  sql: Db;
  close(): Promise<void>;
}

/**
 * Clone the migrated template into a uniquely-named database. `CREATE
 * DATABASE ... TEMPLATE` is serialised with an advisory lock because two
 * parallel workers cloning the same template can race on template access.
 * Databases are dropped in bulk by the global teardown (`sdb_it_*`).
 */
export async function freshDb(
  opts: { seed?: boolean } = {},
): Promise<TestDb> {
  const name = `sdb_it_${randomUUID().replaceAll('-', '')}`;
  const adminSql = sqlFor(adminUrl(), 1);
  try {
    await adminSql`select pg_advisory_lock(727001)`;
    try {
      await adminSql.unsafe(
        `create database "${name}" template "${templateDb()}"`,
      );
    } finally {
      await adminSql`select pg_advisory_unlock(727001)`;
    }
  } finally {
    await adminSql.end({ timeout: 5 });
  }

  const url = urlForDatabase(adminUrl(), name);
  const sql = sqlFor(url);
  if (opts.seed === true) {
    // dev_seed.sql wraps itself in begin/commit; postgres.js only allows
    // explicit transaction statements on a single-connection handle.
    const seedSql = sqlFor(url, 1);
    try {
      await applyDevSeed(seedSql);
    } finally {
      await seedSql.end({ timeout: 5 });
    }
  }
  return {
    name,
    url,
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export interface TestApp {
  app: FastifyInstance;
  auth: TestAuth;
  /** The stubbed Supabase Admin port, exposed for call assertions. */
  supabaseAdmin: ReturnType<typeof stubSupabaseAdmin>;
  /** The in-memory Storage stub (P3 files), exposed for call assertions. */
  storage: StorageStub;
  /** Bearer header for a user id. */
  bearer(userId: string): Promise<Record<string, string>>;
}

/**
 * The real application against the given database. `registerExtra` runs
 * before app.ready() so tests can add stub routes exercising the guard
 * chain exactly as production routes do.
 */
export async function buildTestApp(
  db: TestDb,
  registerExtra?: (app: FastifyInstance) => void | Promise<void>,
  opts: {
    /** Injectable clock for the intake-form cache TTL (AC-Q-01). */
    now?: () => number;
    /** Storage stub override (defaults to a fresh in-memory stub). */
    storage?: StorageStub;
    /** Webhook cvUrl fetcher override (P3 webhook tests). */
    cvFetcher?: CvFetcher;
    /** GoHighLevel outbound fetch override (P7 notification tests). */
    ghlFetch?: GhlFetch;
    /** Extra env vars (e.g. GHL_WEBHOOK_URL_* for the P7 dispatcher). */
    envOverrides?: Record<string, string>;
  } = {},
): Promise<TestApp> {
  const auth = await createTestAuth();
  const supabaseAdmin = stubSupabaseAdmin();
  const storage = opts.storage ?? stubStorage();
  const app = await buildApp({
    // DATABASE_URL is unused when `db` is injected; the rest are dummy values
    // (GHL etc.) that nothing in P0 dials out to.
    env: testEnv({ DATABASE_URL: db.url, ...(opts.envOverrides ?? {}) }),
    db: db.sql,
    jwtKeySource: auth.jwks,
    supabaseAdmin,
    storage,
    ...(opts.cvFetcher !== undefined ? { cvFetcher: opts.cvFetcher } : {}),
    ...(opts.ghlFetch !== undefined ? { ghlFetch: opts.ghlFetch } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  });
  if (registerExtra !== undefined) {
    await registerExtra(app);
  }
  await app.ready();
  return {
    app,
    auth,
    supabaseAdmin,
    storage,
    async bearer(userId: string) {
      return { authorization: `Bearer ${await auth.signToken(userId)}` };
    },
  };
}

/** Assert `promise` rejects with the given SQLSTATE (e.g. '23514'). */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
): Promise<Error & { code?: string }> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected SQLSTATE ${code}, but the query succeeded`).not.toBeNull();
  const err = caught as Error & { code?: string };
  expect(err.code, `expected SQLSTATE ${code}, got ${err.code ?? 'none'} (${err.message})`).toBe(code);
  return err;
}

/**
 * AC-AUTH-05 reusable assertion: a token scoped to client A requesting a
 * resource of client B must receive 403 WRONG_TENANT or 404 — never data.
 * P2+ endpoint suites feed every client-scoped route through this.
 */
export async function expectTenantIsolated(
  app: FastifyInstance,
  opts: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    /** URL addressing a resource that belongs to the OTHER tenant. */
    url: string;
    headers: Record<string, string>;
  },
): Promise<void> {
  const res = await app.inject({
    method: opts.method ?? 'GET',
    url: opts.url,
    headers: opts.headers,
  });
  expect(
    [403, 404],
    `expected 403/404 for cross-tenant access to ${opts.url}, got ${res.statusCode}`,
  ).toContain(res.statusCode);
  const body = res.json<{ error?: { code?: string }; data?: unknown }>();
  expect(body.data, 'cross-tenant response must never carry data').toBeUndefined();
  if (res.statusCode === 403) {
    expect(['WRONG_TENANT', 'FORBIDDEN']).toContain(body.error?.code);
  } else {
    expect(body.error?.code).toBe('NOT_FOUND');
  }
}
