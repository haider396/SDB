/**
 * AC-AUTH-01 — no Authorization header → 401 UNAUTHENTICATED on every
 *              non-public route (route-table-driven).
 * AC-AUTH-02 — expired JWT → 401.
 * AC-AUTH-03 — /auth/me returns roles + fully-resolved permission keys per
 *              role, seeded by migration 0011.
 * AC-AUTH-04 — generated permission matrix over every route declaring a
 *              permission, for all 4 roles, with a 100%-coverage assertion.
 * AC-AUTH-05 — cross-tenant access is 403/404, never data (guard-level in P0;
 *              the endpoint matrix grows in P2).
 * AC-AUTH-07 — deferred to P2 (last-client_admin removal is P2 API behaviour).
 *
 * Everything runs against the real app wired to a real migrated Postgres:
 * JWTs are signed with a local keypair and resolve through users/user_roles/
 * role_permissions exactly as in production.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PermissionKey, UserRoleKey } from '@sdb/contracts';
import { PERMISSION_KEYS } from '@sdb/contracts';
import { ApiError } from '../../src/lib/errors.js';
import {
  getRequiredPermission,
  requireClientScope,
  requirePermission,
} from '../../src/middleware/require-permission.js';
import {
  assignRole,
  insertClient,
  insertClientMember,
  insertUser,
} from './fixtures.js';
import {
  buildTestApp,
  expectTenantIsolated,
  freshDb,
  type TestApp,
  type TestDb,
} from './harness.js';

// --- expected permission sets (docs/02-DATABASE.md §3) -----------------------
const ALL_PERMISSIONS = [...PERMISSION_KEYS];
const ADMIN_EXCLUDED: PermissionKey[] = ['settings.manage', 'user.manage', 'question.manage'];
const CLIENT_ADMIN_PERMISSIONS: PermissionKey[] = [
  'client.view', 'client.invite_user', 'requisition.view', 'requisition.create',
  'requisition.approve_as_principal', 'candidate.view', 'assignment.view',
  'assignment.reject', 'interview.view',
];
const EXPECTED_PERMISSIONS: Record<UserRoleKey, PermissionKey[]> = {
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((key) => !ADMIN_EXCLUDED.includes(key)),
  client_admin: CLIENT_ADMIN_PERMISSIONS,
  client_user: CLIENT_ADMIN_PERMISSIONS.filter(
    (key) => key !== 'client.invite_user' && key !== 'requisition.approve_as_principal',
  ),
};

const ROLES: UserRoleKey[] = ['super_admin', 'admin', 'client_admin', 'client_user'];

// Public surface (docs/04-API.md): everything else must 401 without a token.
const PUBLIC_URLS = new Set([
  '/health',
  '/health/ready',
  '/api/v1/health',
  '/api/v1/health/ready',
  '/api/v1/openapi.json',
  '/api/v1/auth/accept-invitation',
  // Public intake surface (04 §3) — rate-limited, never authenticated.
  '/api/v1/intake-form',
  '/api/v1/taxonomy/public',
  '/api/v1/intake-submissions',
]);
function isPublic(url: string): boolean {
  return PUBLIC_URLS.has(url) || url.startsWith('/api/v1/docs');
}

/** Make a route-table URL requestable: params → UUIDs, wildcards → a segment. */
function requestableUrl(url: string): string {
  return url.replaceAll(/:[^/]+/g, randomUUID()).replaceAll('*', 'x');
}

let db: TestDb;
let harness: TestApp;
let clientA: string;
let clientB: string;
const userByRole = new Map<UserRoleKey, string>();

beforeAll(async () => {
  db = await freshDb();

  clientA = await insertClient(db.sql);
  clientB = await insertClient(db.sql);
  for (const role of ROLES) {
    const userId = await insertUser(db.sql);
    const scoped = role === 'client_admin' || role === 'client_user';
    await assignRole(db.sql, userId, role, scoped ? clientA : undefined);
    if (scoped) {
      await insertClientMember(db.sql, { clientId: clientA, userId });
    }
    userByRole.set(role, userId);
  }

  harness = await buildTestApp(db, (app) => {
    // Stub routes exercising the guard chain exactly as production routes do.
    // Two permissions so the AC-AUTH-04 matrix exercises both the allowed and
    // the denied branch for every role:
    //   question.manage → super_admin only
    //   assignment.view → all four roles
    app.get(
      '/api/v1/_test/perm/question-manage',
      {
        config: { permission: 'question.manage' },
        onRequest: [app.authenticate],
        preHandler: [app.loadContext, requirePermission('question.manage')],
      },
      async () => ({ data: { ok: true } }),
    );
    app.get(
      '/api/v1/_test/perm/assignment-view',
      {
        config: { permission: 'assignment.view' },
        onRequest: [app.authenticate],
        preHandler: [app.loadContext, requirePermission('assignment.view')],
      },
      async () => ({ data: { ok: true } }),
    );
    // Tenant-scoped resource stub (AC-AUTH-05): the caller's clientId comes
    // from their membership via requireClientScope — never from the request —
    // and a mismatch is a 404, the P2+ pattern for cross-tenant addressing.
    app.get(
      '/api/v1/_test/clients/:clientId/summary',
      {
        onRequest: [app.authenticate],
        preHandler: [app.loadContext, requireClientScope()],
      },
      async (request) => {
        const { clientId } = request.params as { clientId: string };
        if (request.clientId !== clientId) {
          throw new ApiError('NOT_FOUND', 'Resource not found.');
        }
        return { data: { clientId } };
      },
    );
  });
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

describe('AC-AUTH-01 — every non-public route 401s without an Authorization header', () => {
  it('route-table-driven: all registered non-public routes return the UNAUTHENTICATED envelope', async () => {
    const routes = harness.app.routeTable.filter(
      (route) =>
        route.method !== 'HEAD' &&
        route.method !== 'OPTIONS' &&
        !isPublic(route.url),
    );
    // The table must actually contain the known protected routes — an empty
    // filter result must fail, not silently pass.
    const urls = routes.map((r) => `${r.method} ${r.url}`);
    expect(urls).toContain('GET /api/v1/auth/me');
    expect(urls).toContain('POST /api/v1/auth/logout');
    expect(routes.length).toBeGreaterThanOrEqual(5);

    for (const route of routes) {
      const res = await harness.app.inject({
        method: route.method as 'GET',
        url: requestableUrl(route.url),
      });
      expect(
        res.statusCode,
        `${route.method} ${route.url} must 401 without a token`,
      ).toBe(401);
      const body = res.json<{ error: { code: string; requestId: string } }>();
      expect(body.error.code, `${route.method} ${route.url}`).toBe('UNAUTHENTICATED');
      expect(body.error.requestId).toBeTruthy();
    }
  });
});

describe('AC-AUTH-02 — expired JWT → 401', () => {
  it('rejects an expired token for a real database user', async () => {
    const userId = userByRole.get('admin')!;
    const expired = await harness.auth.signToken(userId, {
      exp: Math.floor(Date.now() / 1000) - 3600,
    });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UNAUTHENTICATED');
  });
});

describe('AC-AUTH-03 — /auth/me resolves the exact permission set per role', () => {
  it.each(ROLES)('%s', async (role) => {
    const userId = userByRole.get(role)!;
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: await harness.bearer(userId),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{
      data: { roles: UserRoleKey[]; permissions: PermissionKey[]; clientId: string | null };
    }>();
    expect(data.roles).toEqual([role]);
    expect([...data.permissions].sort()).toEqual([...EXPECTED_PERMISSIONS[role]].sort());
    if (role === 'client_admin' || role === 'client_user') {
      expect(data.clientId).toBe(clientA);
    } else {
      expect(data.clientId).toBeNull();
    }
  });

  it('permission set sizes match docs/02-DATABASE.md §3 (29 / 26 / 9 / 7)', () => {
    expect(EXPECTED_PERMISSIONS.super_admin).toHaveLength(29);
    expect(EXPECTED_PERMISSIONS.admin).toHaveLength(26);
    expect(EXPECTED_PERMISSIONS.client_admin).toHaveLength(9);
    expect(EXPECTED_PERMISSIONS.client_user).toHaveLength(7);
  });
});

describe('AC-AUTH-04 — generated permission matrix', () => {
  it('covers 100% of permission-guarded routes (declaration ⇔ guard)', () => {
    let guardedRoutes = 0;
    for (const route of harness.app.routeTable) {
      if (route.method === 'HEAD' || route.method === 'OPTIONS') continue;
      const guardKeys = route.preHandlers
        .map(getRequiredPermission)
        .filter((key): key is PermissionKey => key !== null);
      const declared = route.config['permission'];
      if (guardKeys.length > 0) {
        guardedRoutes += 1;
        expect(
          declared,
          `${route.method} ${route.url} attaches requirePermission but declares no config.permission — the matrix cannot cover it`,
        ).toBe(guardKeys[0]);
      }
      if (declared !== undefined) {
        expect(
          guardKeys,
          `${route.method} ${route.url} declares config.permission but attaches no matching guard`,
        ).toContain(declared);
      }
    }
    expect(guardedRoutes).toBeGreaterThanOrEqual(2);
  });

  it('every declaring route × every role: 2xx/404 when allowed, 403 FORBIDDEN when not', async () => {
    // Ground truth from the database, not from the contracts constant, so a
    // drifted 0011 seed fails here.
    const dbPermissions = new Map<UserRoleKey, Set<string>>();
    for (const role of ROLES) {
      const rows = await db.sql<{ key: string }[]>`
        select p.key
        from roles r
        join role_permissions rp on rp.role_id = r.id
        join permissions p on p.id = rp.permission_id
        where r.key = ${role}
      `;
      dbPermissions.set(role, new Set(rows.map((r) => r.key)));
    }

    const declaringRoutes = harness.app.routeTable.filter(
      (route) =>
        route.method !== 'HEAD' &&
        route.method !== 'OPTIONS' &&
        route.config['permission'] !== undefined,
    );
    expect(declaringRoutes.length).toBeGreaterThanOrEqual(2);

    let allowedCases = 0;
    let deniedCases = 0;
    for (const route of declaringRoutes) {
      const permission = route.config['permission'] as string;
      for (const role of ROLES) {
        const res = await harness.app.inject({
          method: route.method as 'GET',
          url: requestableUrl(route.url),
          headers: await harness.bearer(userByRole.get(role)!),
        });
        const allowed = dbPermissions.get(role)!.has(permission);
        const label = `${role} → ${route.method} ${route.url} (${permission})`;
        if (allowed) {
          allowedCases += 1;
          expect([401, 403], `${label} should be allowed`).not.toContain(res.statusCode);
          expect(res.statusCode, label).toBeLessThan(500);
        } else {
          deniedCases += 1;
          expect(res.statusCode, `${label} should be denied`).toBe(403);
          const body = res.json<{ error: { code: string; details?: { requiredPermission?: string } } }>();
          expect(body.error.code, label).toBe('FORBIDDEN');
          expect(body.error.details?.requiredPermission, label).toBe(permission);
        }
      }
    }
    // Both branches of the matrix must have been exercised.
    expect(allowedCases).toBeGreaterThanOrEqual(5); // assignment.view ×4 + question.manage ×1
    expect(deniedCases).toBeGreaterThanOrEqual(3); //  question.manage for admin/client_admin/client_user
  });
});

describe('AC-AUTH-05 — cross-tenant requests never return data', () => {
  it('client A user reading their own client succeeds', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/_test/clients/${clientA}/summary`,
      headers: await harness.bearer(userByRole.get('client_user')!),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { clientId: string } }>().data.clientId).toBe(clientA);
  });

  it.each(['client_user', 'client_admin'] as const)(
    "%s of client A requesting client B's resource → 403/404, never data",
    async (role) => {
      await expectTenantIsolated(harness.app, {
        url: `/api/v1/_test/clients/${clientB}/summary`,
        headers: await harness.bearer(userByRole.get(role)!),
      });
    },
  );

  it('a user with no client membership is rejected by requireClientScope', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/_test/clients/${clientA}/summary`,
      headers: await harness.bearer(userByRole.get('admin')!),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });
});

describe('AC-AUTH-06 — a client_admin invites only into their own client', () => {
  it('inviting into the OWN client succeeds', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientA}/members/invite`,
      headers: await harness.bearer(userByRole.get('client_admin')!),
      payload: {
        email: `own-invite-${randomUUID().slice(0, 8)}@example.com`,
        fullName: 'Invited Colleague',
        role: 'client_user',
      },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json<{ data: { clientId: string; role: string } }>();
    expect(data.clientId).toBe(clientA);
    expect(data.role).toBe('client_user');
  });

  it("inviting into ANOTHER client is 403 and writes nothing", async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientB}/members/invite`,
      headers: await harness.bearer(userByRole.get('client_admin')!),
      payload: {
        email: `cross-invite-${randomUUID().slice(0, 8)}@example.com`,
        fullName: 'Cross Tenant',
        role: 'client_user',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('WRONG_TENANT');
    const members = await db.sql`
      select id from client_members where client_id = ${clientB}
    `;
    expect(members).toHaveLength(0);
  });

  it('a client_user lacks client.invite_user entirely', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientA}/members/invite`,
      headers: await harness.bearer(userByRole.get('client_user')!),
      payload: {
        email: 'nope@example.com',
        fullName: 'No Permission',
        role: 'client_user',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });
});

describe('AC-AUTH-07 — last client_admin cannot be removed', () => {
  it('rejects removing — or demoting — the last client_admin, allows it once another exists', async () => {
    const firstAdmin = userByRole.get('client_admin')!;
    const superAdminHeaders = await harness.bearer(userByRole.get('super_admin')!);

    // clientA currently has exactly one client_admin → removal is rejected.
    const removeLast = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/clients/${clientA}/members/${firstAdmin}`,
      headers: superAdminHeaders,
    });
    expect(removeLast.statusCode).toBe(422);
    expect(removeLast.json<{ error: { code: string } }>().error.code).toBe(
      'VALIDATION_FAILED',
    );

    // Demotion is removal in disguise — also rejected.
    const demoteLast = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/clients/${clientA}/members/${firstAdmin}`,
      headers: superAdminHeaders,
      payload: { role: 'client_user' },
    });
    expect(demoteLast.statusCode).toBe(422);

    // The membership is untouched.
    const stillThere = await db.sql<{ archived_at: Date | null }[]>`
      select archived_at from client_members
      where client_id = ${clientA} and user_id = ${firstAdmin}
    `;
    expect(stillThere[0]!.archived_at).toBeNull();

    // Add a second client_admin — now removing the first is legal…
    const secondAdmin = await insertUser(db.sql);
    await assignRole(db.sql, secondAdmin, 'client_admin', clientA);
    await insertClientMember(db.sql, { clientId: clientA, userId: secondAdmin });

    const removeFirst = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/clients/${clientA}/members/${firstAdmin}`,
      headers: superAdminHeaders,
    });
    expect(removeFirst.statusCode).toBe(204);

    // …and the second is now the last one again.
    const removeSecond = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/clients/${clientA}/members/${secondAdmin}`,
      headers: superAdminHeaders,
    });
    expect(removeSecond.statusCode).toBe(422);
  });
});
