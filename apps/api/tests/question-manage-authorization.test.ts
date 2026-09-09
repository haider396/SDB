/**
 * `question.manage` authorization for the form builder and the question
 * manager, after migration 0027 granted the key to the `admin` role.
 *
 * Unit level, matching tests/auth-middleware.test.ts: real routes, real guard
 * chain, fastify.inject, a locally-generated JWKS and a stubbed context loader.
 * No database, no Docker — the integration suite cannot run on this machine.
 *
 * What each half proves, and what it does not:
 *
 *  - "route guards" hits the PRODUCTION /candidate-forms and /questions routes.
 *    `requirePermission` runs at preValidation, i.e. BEFORE body validation, so
 *    a bodyless POST separates the two outcomes cleanly and without a DB round
 *    trip: a caller who lacks the key is stopped at 403 by the guard, and a
 *    caller who holds it falls through to schema validation (4xx, never 403).
 *    This proves the routes honour the permission — not that the seed grants it.
 *
 *  - "the seed behind it" is a static check over supabase/migrations, so
 *    deleting 0027 or revoking the grant fails here rather than silently
 *    reintroducing the 403.
 *
 *  - The two halves are joined against a real migrated Postgres in
 *    tests/integration/ac-questions.test.ts (AC-Q-02) and ac-auth.test.ts
 *    (AC-AUTH-04), which need Docker or TEST_DATABASE_URL and are NOT run here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PermissionKey } from '@sdb/contracts';
import { buildApp } from '../src/app.js';
import type { RequestContext } from '../src/middleware/load-context.js';
import {
  createTestAuth,
  freshUserId,
  makeCtx,
  stubSupabaseAdmin,
  testEnv,
  type TestAuth,
} from './helpers.js';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);

// The permission sets these roles carry after 0011 + 0027. Mirrored here only
// as far as these two screens reach; the DB is the source of truth and the
// "seed behind it" block below pins the one grant this file turns on.
const ADMIN_PERMISSIONS: PermissionKey[] = ['question.view', 'question.manage'];
const CLIENT_USER_PERMISSIONS: PermissionKey[] = [
  'client.view',
  'requisition.view',
  'requisition.create',
  'candidate.view',
  'assignment.view',
  'assignment.reject',
  'interview.view',
];

/** Every write the form builder and question manager make on first save. */
const MANAGE_ROUTES = [
  { method: 'POST' as const, url: '/api/v1/candidate-forms', label: 'create a form' },
  { method: 'POST' as const, url: '/api/v1/questions', label: 'create a question' },
  { method: 'POST' as const, url: '/api/v1/question-categories', label: 'create a category' },
];

describe('question.manage on the form-builder and question routes (migration 0027)', () => {
  let app: FastifyInstance;
  let auth: TestAuth;
  const contexts = new Map<string, RequestContext>();

  const actor = (permissions: PermissionKey[], roles: RequestContext['roles']) => {
    const userId = freshUserId();
    contexts.set(userId, makeCtx(userId, { roles, permissions }));
    return userId;
  };

  beforeAll(async () => {
    auth = await createTestAuth();
    app = await buildApp({
      env: testEnv(),
      jwtKeySource: auth.jwks,
      supabaseAdmin: stubSupabaseAdmin(),
      contextLoader: async (userId) => contexts.get(userId) ?? null,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = async (userId: string) => ({
    authorization: `Bearer ${await auth.signToken(userId)}`,
  });

  describe('route guards', () => {
    it.each(MANAGE_ROUTES)(
      'admin reaches $method $url ($label) — no longer 403',
      async ({ method, url }) => {
        const admin = actor(ADMIN_PERMISSIONS, ['admin']);
        const res = await app.inject({
          method,
          url,
          headers: await bearer(admin),
          payload: {},
        });
        // Past the guard is the assertion. An empty body is legitimately
        // rejected by the schema; it must not be rejected by authorization.
        expect([401, 403], `${method} ${url}`).not.toContain(res.statusCode);
        expect(res.statusCode, `${method} ${url}`).toBeLessThan(500);
        expect(res.json<{ error?: { code: string } }>().error?.code).not.toBe(
          'FORBIDDEN',
        );
      },
    );

    it.each(MANAGE_ROUTES)(
      'client_user is still refused $method $url ($label)',
      async ({ method, url }) => {
        const clientUser = actor(CLIENT_USER_PERMISSIONS, ['client_user']);
        const res = await app.inject({
          method,
          url,
          headers: await bearer(clientUser),
          payload: {},
        });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        const body = res.json<{
          error: { code: string; details?: { requiredPermission?: string } };
        }>();
        expect(body.error.code).toBe('FORBIDDEN');
        expect(body.error.details?.requiredPermission).toBe('question.manage');
      },
    );

    it('an admin who somehow lost question.manage is still refused', async () => {
      // Guards the grant itself, not the role name: nothing in the chain may
      // start trusting `roles` instead of the resolved permission set.
      const stripped = actor(['question.view'], ['admin']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/candidate-forms',
        headers: await bearer(stripped),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    });

    it('reads were never the problem — admin could always list forms', async () => {
      const admin = actor(ADMIN_PERMISSIONS, ['admin']);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/candidate-forms',
        headers: await bearer(admin),
      });
      expect([401, 403]).not.toContain(res.statusCode);
    });
  });

  describe('the seed behind it', () => {
    const migrations = readdirSync(MIGRATIONS_DIR).filter((name) =>
      /^\d{4}_.+\.sql$/.test(name),
    );
    const read = (name: string) =>
      readFileSync(join(MIGRATIONS_DIR, name), 'utf8');

    it('0027 grants question.manage to admin, idempotently', () => {
      const [file, ...extra] = migrations.filter((name) =>
        name.startsWith('0027_'),
      );
      expect(file, 'migration 0027 is missing').toBeDefined();
      expect(extra, 'two migrations claim number 0027').toHaveLength(0);

      const sql = read(file!);
      expect(sql).toMatch(/insert\s+into\s+role_permissions/i);
      expect(sql).toMatch(/r\.key\s*=\s*'admin'/);
      expect(sql).toMatch(/p\.key\s*=\s*'question\.manage'/);
      // Re-running the file must be a no-op: a fresh database replays every
      // migration, and this one is also replayed by the idempotency check.
      expect(sql).toMatch(/on\s+conflict\s+do\s+nothing/i);
      // Scoped to the one grant — no sweeping recompute of the matrix.
      expect(sql).not.toMatch(/delete\s+from\s+role_permissions/i);
    });

    it('no later migration revokes it', () => {
      const revoking = migrations
        .filter((name) => name > '0027')
        .filter((name) => /delete\s+from\s+role_permissions/i.test(read(name)));
      expect(revoking).toEqual([]);
    });

    it('0011 is still the file that withholds it, so the order matters', () => {
      // If 0011 ever stops excluding question.manage, 0027 becomes dead weight
      // rather than a correction, and this pair should be revisited together.
      const seed = read('0011_seed_reference_data.sql');
      expect(seed).toMatch(
        /not in \('settings\.manage', 'user\.manage', 'question\.manage'\)/,
      );
    });
  });
});
