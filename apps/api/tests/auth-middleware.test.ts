/**
 * authenticate (401 paths, AC-AUTH-01/02), loadContext, requirePermission
 * (403 path), requireClientScope, and the auth routes — all via
 * fastify.inject with a locally-generated JWKS keypair. No network, no DB.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  requireClientScope,
  requirePermission,
} from '../src/middleware/require-permission.js';
import type { RequestContext } from '../src/middleware/load-context.js';
import {
  createTestAuth,
  freshUserId,
  makeCtx,
  stubSupabaseAdmin,
  testEnv,
  type TestAuth,
} from './helpers.js';

describe('auth middleware chain', () => {
  let app: FastifyInstance;
  let auth: TestAuth;
  let admin: ReturnType<typeof stubSupabaseAdmin>;
  // Per-user context configuration; the loader reads from here.
  const contexts = new Map<string, RequestContext | null>();

  beforeAll(async () => {
    auth = await createTestAuth();
    admin = stubSupabaseAdmin();
    app = await buildApp({
      env: testEnv(),
      jwtKeySource: auth.jwks,
      supabaseAdmin: admin,
      contextLoader: async (userId) =>
        contexts.has(userId) ? (contexts.get(userId) ?? null) : makeCtx(userId),
    });

    // Test-only routes exercising the guards exactly as real routes will.
    app.get(
      '/api/v1/_test/needs-perm',
      {
        onRequest: [app.authenticate],
        preHandler: [app.loadContext, requirePermission('question.manage')],
      },
      async () => ({ data: { ok: true } }),
    );
    app.get(
      '/api/v1/_test/client-scope',
      {
        onRequest: [app.authenticate],
        preHandler: [app.loadContext, requireClientScope()],
      },
      async (request) => ({ data: { clientId: request.clientId } }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  describe('authenticate → 401 UNAUTHENTICATED (AC-AUTH-01/02)', () => {
    it('rejects a request with no Authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('UNAUTHENTICATED');
      expect(body.error.requestId).toBeTruthy();
    });

    it('rejects a garbage token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer('not-a-jwt'),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects an expired token', async () => {
      const token = await auth.signToken(freshUserId(), {
        exp: Math.floor(Date.now() / 1000) - 300,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a token with the wrong audience', async () => {
      const token = await auth.signToken(freshUserId(), { audience: 'anon' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a valid token whose user is unknown/inactive', async () => {
      const userId = freshUserId();
      contexts.set(userId, null);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer(await auth.signToken(userId)),
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('GET /api/v1/auth/me (AC-AUTH-03 shape)', () => {
    it('returns user, roles, resolved permissions, and null clientId', async () => {
      const userId = freshUserId();
      contexts.set(
        userId,
        makeCtx(userId, {
          roles: ['admin'],
          permissions: ['question.view', 'candidate.view'],
        }),
      );
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer(await auth.signToken(userId)),
      });
      expect(res.statusCode).toBe(200);
      const { data } = res.json();
      expect(data.user.id).toBe(userId);
      expect(data.roles).toEqual(['admin']);
      expect(data.permissions.sort()).toEqual(
        ['candidate.view', 'question.view'].sort(),
      );
      expect(data.clientId).toBeNull();
    });

    it('returns the clientId for a client-scoped user', async () => {
      const userId = freshUserId();
      const clientId = freshUserId();
      contexts.set(
        userId,
        makeCtx(userId, { roles: ['client_admin'], clientIds: [clientId] }),
      );
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer(await auth.signToken(userId)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.clientId).toBe(clientId);
    });
  });

  describe('requirePermission → 403 FORBIDDEN', () => {
    it('rejects before the handler when the permission is missing', async () => {
      const userId = freshUserId();
      contexts.set(userId, makeCtx(userId, { permissions: ['question.view'] }));
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/_test/needs-perm',
        headers: bearer(await auth.signToken(userId)),
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.details.requiredPermission).toBe('question.manage');
    });

    it('passes when the permission is held', async () => {
      const userId = freshUserId();
      contexts.set(
        userId,
        makeCtx(userId, { permissions: ['question.manage'] }),
      );
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/_test/needs-perm',
        headers: bearer(await auth.signToken(userId)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.ok).toBe(true);
    });
  });

  describe('requireClientScope', () => {
    it('injects the caller-resolved clientId, never from the request', async () => {
      const userId = freshUserId();
      const clientId = freshUserId();
      contexts.set(userId, makeCtx(userId, { clientIds: [clientId] }));
      const res = await app.inject({
        method: 'GET',
        // A clientId query param must be ignored — scope comes from membership.
        url: `/api/v1/_test/client-scope?clientId=${freshUserId()}`,
        headers: bearer(await auth.signToken(userId)),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.clientId).toBe(clientId);
    });

    it('rejects users with no client membership', async () => {
      const userId = freshUserId();
      contexts.set(userId, makeCtx(userId, { clientIds: [] }));
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/_test/client-scope',
        headers: bearer(await auth.signToken(userId)),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes via the Supabase admin port and returns 204', async () => {
      const userId = freshUserId();
      const token = await auth.signToken(userId);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(204);
      expect(admin.calls.signOutUser).toContain(token);
    });

    it('requires authentication', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('loadContext caching', () => {
    it('serves repeat requests for the same user from the 60s cache', async () => {
      const userId = freshUserId();
      let loads = 0;
      // Count loads via a wrapper context: swap the map entry for a counter.
      contexts.set(userId, makeCtx(userId));
      const countingApp = await buildApp({
        env: testEnv(),
        jwtKeySource: auth.jwks,
        supabaseAdmin: stubSupabaseAdmin(),
        contextLoader: async (id) => {
          loads += 1;
          return makeCtx(id);
        },
      });
      const token = await auth.signToken(userId);
      await countingApp.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer(token),
      });
      await countingApp.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer(token),
      });
      expect(loads).toBe(1);

      // Invalidation hook forces a reload on the next request.
      countingApp.invalidateUserContext(userId);
      await countingApp.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: bearer(token),
      });
      expect(loads).toBe(2);
      await countingApp.close();
    });
  });
});
