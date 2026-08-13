/**
 * Phase P2 — clients and access (docs/07-ACCEPTANCE-CRITERIA.md §5):
 *
 * AC-CL-01 — grant-access with payment unconfirmed → 422 PAYMENT_NOT_CONFIRMED
 * AC-CL-02 — grant creates user + member + role + event + queued notification,
 *            all in one transaction (atomicity proven by a forced late failure)
 * AC-CL-03 — a failed notification enqueue still commits the grant
 * AC-CL-04 — (API-level slice of the E2E) invited user accepts, sets a
 *            password, and can read only their own client
 * AC-CL-05 — unaccepted invitations older than 14 days are invalidated by the
 *            job (clock controlled via the cutoff parameter)
 * AC-CL-06 — revoke-access prevents further logins for the client's members
 *
 * Plus: member management behaviours from 04 §6 (one-principal 422, member
 * PATCH/DELETE) and AC-AUTH-05 tenant isolation for every client-scoped
 * endpoint added in P2.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireStaleInvitations } from '../../src/jobs/expire-stale-invitations.js';
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

let db: TestDb;
let harness: TestApp;
let superAdmin: string;
let admin: string;
let clientA: string;
let clientB: string;
let clientAdminA: string;
let clientAdminB: string;

beforeAll(async () => {
  db = await freshDb();
  superAdmin = await insertUser(db.sql);
  await assignRole(db.sql, superAdmin, 'super_admin');
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  clientA = await insertClient(db.sql, { companyName: 'Tenant A GmbH' });
  clientB = await insertClient(db.sql, { companyName: 'Tenant B LLC' });
  clientAdminA = await insertUser(db.sql);
  await assignRole(db.sql, clientAdminA, 'client_admin', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientAdminA });
  clientAdminB = await insertUser(db.sql);
  await assignRole(db.sql, clientAdminB, 'client_admin', clientB);
  await insertClientMember(db.sql, { clientId: clientB, userId: clientAdminB });

  harness = await buildTestApp(db);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

async function grantBody(email?: string) {
  return {
    primaryContactEmail: email ?? `contact-${randomUUID().slice(0, 8)}@example.com`,
    primaryContactName: 'Primary Contact',
    isPrincipal: true,
  };
}

describe('AC-CL-01 — grant-access before payment confirmation is rejected', () => {
  it('returns 422 PAYMENT_NOT_CONFIRMED and writes nothing', async () => {
    const unpaid = await insertClient(db.sql, { paymentConfirmed: false });
    const body = await grantBody();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${unpaid}/grant-access`,
      headers: await harness.bearer(admin),
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'PAYMENT_NOT_CONFIRMED',
    );
    const members = await db.sql`
      select id from client_members where client_id = ${unpaid}
    `;
    expect(members).toHaveLength(0);
    const clients = await db.sql<{ portal_access_enabled_at: Date | null }[]>`
      select portal_access_enabled_at from clients where id = ${unpaid}
    `;
    expect(clients[0]?.portal_access_enabled_at).toBeNull();
  });
});

describe('AC-CL-02 — grant-access writes user, member, role, event, and queued notification in one transaction', () => {
  it('creates every row of the grant', async () => {
    const client = await insertClient(db.sql, { companyName: 'Granted Co' });
    const body = await grantBody();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/grant-access`,
      headers: await harness.bearer(superAdmin),
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const payload = res.json<{ data: { portalAccessEnabledAt: string | null } }>();
    expect(payload.data.portalAccessEnabledAt).not.toBeNull();

    const users = await db.sql<{ id: string; full_name: string }[]>`
      select id, full_name from users where email = ${body.primaryContactEmail}
    `;
    expect(users).toHaveLength(1);
    const userId = users[0]!.id;
    expect(users[0]!.full_name).toBe(body.primaryContactName);
    // The auth user was created through the admin port.
    expect(
      harness.supabaseAdmin.calls.createUser.map((call) => call.email),
    ).toContain(body.primaryContactEmail);

    const members = await db.sql<
      {
        is_primary_contact: boolean;
        is_principal: boolean;
        invited_at: Date | null;
        accepted_at: Date | null;
      }[]
    >`
      select is_primary_contact, is_principal, invited_at, accepted_at
      from client_members where client_id = ${client} and user_id = ${userId}
    `;
    expect(members).toHaveLength(1);
    expect(members[0]!.is_primary_contact).toBe(true);
    expect(members[0]!.is_principal).toBe(true);
    expect(members[0]!.invited_at).not.toBeNull();
    expect(members[0]!.accepted_at).toBeNull();

    const roles = await db.sql<{ key: string }[]>`
      select r.key from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = ${userId} and ur.scope_type = 'client' and ur.scope_id = ${client}
    `;
    expect(roles.map((row) => row.key)).toEqual(['client_admin']);

    const events = await db.sql<{ actor_id: string | null }[]>`
      select actor_id from events
      where entity_type = 'client' and entity_id = ${client}
        and event_type = 'access_granted'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]!.actor_id).toBe(superAdmin);

    // Force the P7 post-commit drain so the status below is deterministic:
    // this harness configures no GHL_WEBHOOK_URL_*, so the enqueued row is
    // dispatched-and-failed with a clear error rather than staying 'queued'.
    await harness.app.notificationDispatch.drainQueued();
    const notifications = await db.sql<
      {
        status: string;
        last_error: string | null;
        recipient_email: string;
        payload: { context: { actionUrl?: string } };
      }[]
    >`
      select status, last_error, recipient_email, payload from notification_log
      where event = 'portal_invitation' and entity_id = ${client}
    `;
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.status).toBe('failed');
    expect(notifications[0]!.last_error).toBe('webhook url not configured');
    expect(notifications[0]!.recipient_email).toBe(body.primaryContactEmail);
    expect(notifications[0]!.payload.context.actionUrl).toContain('token=');

    const clients = await db.sql<{ portal_access_enabled_by: string | null }[]>`
      select portal_access_enabled_by from clients where id = ${client}
    `;
    expect(clients[0]!.portal_access_enabled_by).toBe(superAdmin);
  });

  it('is atomic: a late in-transaction failure rolls back the user row too', async () => {
    const client = await insertClient(db.sql, { companyName: 'Atomic Co' });
    // Pre-existing primary contact → the membership insert violates
    // idx_one_primary_contact_per_client AFTER the users row was written.
    const existing = await insertUser(db.sql);
    await insertClientMember(db.sql, {
      clientId: client,
      userId: existing,
      isPrimaryContact: true,
    });
    const body = await grantBody();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/grant-access`,
      headers: await harness.bearer(admin),
      payload: body,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
    // Everything rolled back — no users row, no portal access, no event.
    const users = await db.sql`
      select id from users where email = ${body.primaryContactEmail}
    `;
    expect(users).toHaveLength(0);
    const clients = await db.sql<{ portal_access_enabled_at: Date | null }[]>`
      select portal_access_enabled_at from clients where id = ${client}
    `;
    expect(clients[0]!.portal_access_enabled_at).toBeNull();
    const events = await db.sql`
      select id from events
      where entity_type = 'client' and entity_id = ${client} and event_type = 'access_granted'
    `;
    expect(events).toHaveLength(0);
  });
});

describe('AC-CL-03 — a failed notification enqueue still commits the grant', () => {
  it('commits the access grant when notification_log is unavailable', async () => {
    const client = await insertClient(db.sql, { companyName: 'Resilient Co' });
    const body = await grantBody();
    // Force the enqueue sub-step to fail: the table is briefly renamed away.
    await db.sql`alter table notification_log rename to notification_log_hidden`;
    try {
      const res = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/clients/${client}/grant-access`,
        headers: await harness.bearer(admin),
        payload: body,
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await db.sql`alter table notification_log_hidden rename to notification_log`;
    }
    // The grant committed…
    const users = await db.sql<{ id: string }[]>`
      select id from users where email = ${body.primaryContactEmail}
    `;
    expect(users).toHaveLength(1);
    const members = await db.sql`
      select id from client_members
      where client_id = ${client} and user_id = ${users[0]!.id} and archived_at is null
    `;
    expect(members).toHaveLength(1);
    const clients = await db.sql<{ portal_access_enabled_at: Date | null }[]>`
      select portal_access_enabled_at from clients where id = ${client}
    `;
    expect(clients[0]!.portal_access_enabled_at).not.toBeNull();
    const events = await db.sql`
      select id from events
      where entity_type = 'client' and entity_id = ${client} and event_type = 'access_granted'
    `;
    expect(events).toHaveLength(1);
    // …and no notification row exists for it.
    const notifications = await db.sql`
      select id from notification_log
      where event = 'portal_invitation' and entity_id = ${client}
    `;
    expect(notifications).toHaveLength(0);
  });
});

describe('AC-CL-04 (API slice) — invited user accepts and reads only their own client', () => {
  it('accepts the invitation from the queued actionUrl token and is tenant-scoped', async () => {
    const client = await insertClient(db.sql, { companyName: 'Accepting Co' });
    const body = await grantBody();
    const grant = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/grant-access`,
      headers: await harness.bearer(admin),
      payload: body,
    });
    expect(grant.statusCode).toBe(200);

    const notifications = await db.sql<
      { payload: { context: { actionUrl: string } } }[]
    >`
      select payload from notification_log
      where event = 'portal_invitation' and entity_id = ${client}
    `;
    const actionUrl = notifications[0]!.payload.context.actionUrl;
    const token = new URL(actionUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    const accept = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invitation',
      payload: {
        token,
        password: 'a-long-enough-password',
        fullName: 'Accepted Contact',
        timezone: 'America/Chicago',
      },
    });
    expect(accept.statusCode).toBe(200);

    const users = await db.sql<{ id: string }[]>`
      select id from users where email = ${body.primaryContactEmail}
    `;
    const userId = users[0]!.id;
    // Password was set via the admin port inside the acceptance transaction.
    expect(
      harness.supabaseAdmin.calls.updateUserPassword.map(([id]) => id),
    ).toContain(userId);

    const own = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/clients/${client}`,
      headers: await harness.bearer(userId),
    });
    expect(own.statusCode).toBe(200);
    expect(own.json<{ data: { id: string } }>().data.id).toBe(client);

    const foreign = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientB}`,
      headers: await harness.bearer(userId),
    });
    expect(foreign.statusCode).toBe(404);

    // Replaying the token fails — acceptance is single-use in the database.
    const replay = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invitation',
      payload: {
        token,
        password: 'another-long-password',
        fullName: 'Replay',
        timezone: 'UTC',
      },
    });
    expect(replay.statusCode).toBe(422);
  });
});

describe('AC-CL-05 — stale invitations are invalidated by the scheduled job', () => {
  it('invalidates unaccepted invitations older than 14 days (clock via cutoff)', async () => {
    const client = await insertClient(db.sql, { companyName: 'Stale Co' });
    const body = await grantBody();
    const grant = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/grant-access`,
      headers: await harness.bearer(admin),
      payload: body,
    });
    expect(grant.statusCode).toBe(200);

    const notifications = await db.sql<
      { payload: { context: { actionUrl: string } } }[]
    >`
      select payload from notification_log
      where event = 'portal_invitation' and entity_id = ${client}
    `;
    const token = new URL(
      notifications[0]!.payload.context.actionUrl,
    ).searchParams.get('token')!;

    // Not yet stale: a cutoff in the past invalidates nothing.
    const early = await expireStaleInvitations(db.sql, {
      cutoff: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    });
    expect(early).toBe(0);

    // Clock control: a cutoff 1 minute in the future makes the invitation
    // "older than 14 days" relative to the controlled clock. Earlier tests in
    // this file leave their own unaccepted invitations behind, so the total
    // is >= 1; the per-client assertions below pin down THIS invitation.
    const affected = await expireStaleInvitations(db.sql, {
      cutoff: new Date(Date.now() + 60_000),
    });
    expect(affected).toBeGreaterThanOrEqual(1);

    // Idempotent: a second run affects nothing.
    expect(
      await expireStaleInvitations(db.sql, {
        cutoff: new Date(Date.now() + 60_000),
      }),
    ).toBe(0);

    const members = await db.sql<{ archived_at: Date | null }[]>`
      select cm.archived_at from client_members cm
      join users u on u.id = cm.user_id
      where cm.client_id = ${client} and u.email = ${body.primaryContactEmail}
    `;
    expect(members[0]!.archived_at).not.toBeNull();

    const events = await db.sql`
      select id from events
      where entity_type = 'client' and entity_id = ${client}
        and event_type = 'invitation_expired'
    `;
    expect(events).toHaveLength(1);

    // The still-unexpired TOKEN no longer works — the DB acceptance path
    // (accepted_at is null AND archived_at is null) matches zero rows.
    const accept = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invitation',
      payload: {
        token,
        password: 'a-long-enough-password',
        fullName: 'Too Late',
        timezone: 'UTC',
      },
    });
    expect(accept.statusCode).toBe(422);
  });
});

describe('AC-CL-06 — revoke-access prevents further logins for the client', () => {
  it('clears portal access, deactivates member users, revokes sessions', async () => {
    const client = await insertClient(db.sql, { companyName: 'Revoked Co' });
    const memberUser = await insertUser(db.sql);
    await assignRole(db.sql, memberUser, 'client_admin', client);
    await insertClientMember(db.sql, { clientId: client, userId: memberUser });
    await db.sql`update clients set portal_access_enabled_at = now() where id = ${client}`;

    // Sanity: the member can call the API before revocation.
    const before = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: await harness.bearer(memberUser),
    });
    expect(before.statusCode).toBe(200);

    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/revoke-access`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { deactivatedUserIds: string[] } }>();
    expect(data.deactivatedUserIds).toContain(memberUser);

    const clients = await db.sql<{ portal_access_enabled_at: Date | null }[]>`
      select portal_access_enabled_at from clients where id = ${client}
    `;
    expect(clients[0]!.portal_access_enabled_at).toBeNull();

    const users = await db.sql<{ is_active: boolean }[]>`
      select is_active from users where id = ${memberUser}
    `;
    expect(users[0]!.is_active).toBe(false);

    // Sessions revoked through the admin port.
    expect(harness.supabaseAdmin.calls.revokeUserSessions).toContain(memberUser);

    // Even a still-valid JWT is now rejected — the context loader refuses
    // inactive users, and the cache was invalidated by the revoke.
    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: await harness.bearer(memberUser),
    });
    expect(after.statusCode).toBe(401);

    const events = await db.sql`
      select id from events
      where entity_type = 'client' and entity_id = ${client} and event_type = 'access_revoked'
    `;
    expect(events).toHaveLength(1);
  });
});

describe('04 §6 — member management behaviours', () => {
  it('inviting a second principal surfaces the partial unique index as 422', async () => {
    const client = await insertClient(db.sql);
    const principal = await insertUser(db.sql);
    await insertClientMember(db.sql, {
      clientId: client,
      userId: principal,
      isPrincipal: true,
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/members/invite`,
      headers: await harness.bearer(admin),
      payload: {
        email: `second-principal-${randomUUID().slice(0, 6)}@example.com`,
        fullName: 'Second Principal',
        role: 'client_user',
        isPrincipal: true,
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toContain('principal');
  });

  it('invite → accept-expire cycle can re-invite the same user (archived row revived)', async () => {
    const client = await insertClient(db.sql);
    const email = `revive-${randomUUID().slice(0, 6)}@example.com`;
    const first = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/members/invite`,
      headers: await harness.bearer(admin),
      payload: { email, fullName: 'Revived Member', role: 'client_user' },
    });
    expect(first.statusCode).toBe(201);
    await expireStaleInvitations(db.sql, { cutoff: new Date(Date.now() + 60_000) });
    const second = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/members/invite`,
      headers: await harness.bearer(admin),
      payload: { email, fullName: 'Revived Member', role: 'client_user' },
    });
    expect(second.statusCode).toBe(201);
    const members = await db.sql<{ archived_at: Date | null; accepted_at: Date | null }[]>`
      select cm.archived_at, cm.accepted_at from client_members cm
      join users u on u.id = cm.user_id
      where cm.client_id = ${client} and u.email = ${email}
    `;
    expect(members).toHaveLength(1);
    expect(members[0]!.archived_at).toBeNull();
    expect(members[0]!.accepted_at).toBeNull();
  });

  it('re-inviting an active member is a clean 422', async () => {
    const client = await insertClient(db.sql);
    const email = `dup-${randomUUID().slice(0, 6)}@example.com`;
    const first = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/members/invite`,
      headers: await harness.bearer(admin),
      payload: { email, fullName: 'Dup Member', role: 'client_user' },
    });
    expect(first.statusCode).toBe(201);
    const second = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${client}/members/invite`,
      headers: await harness.bearer(admin),
      payload: { email, fullName: 'Dup Member', role: 'client_user' },
    });
    expect(second.statusCode).toBe(422);
  });

  it('PATCH member changes role and principal flag, and writes an event', async () => {
    const client = await insertClient(db.sql);
    const adminUser = await insertUser(db.sql);
    await assignRole(db.sql, adminUser, 'client_admin', client);
    await insertClientMember(db.sql, { clientId: client, userId: adminUser });
    const member = await insertUser(db.sql);
    await assignRole(db.sql, member, 'client_user', client);
    await insertClientMember(db.sql, { clientId: client, userId: member });

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/clients/${client}/members/${member}`,
      headers: await harness.bearer(admin),
      payload: { role: 'client_admin', isPrincipal: true },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { role: string; isPrincipal: boolean } }>();
    expect(data.role).toBe('client_admin');
    expect(data.isPrincipal).toBe(true);

    const roles = await db.sql<{ key: string }[]>`
      select r.key from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = ${member} and ur.scope_type = 'client' and ur.scope_id = ${client}
    `;
    expect(roles.map((row) => row.key)).toEqual(['client_admin']);

    const events = await db.sql`
      select id from events
      where entity_type = 'client' and entity_id = ${client} and event_type = 'member_updated'
    `;
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE member soft-removes: archived row, roles dropped, event written', async () => {
    const client = await insertClient(db.sql);
    const adminUser = await insertUser(db.sql);
    await assignRole(db.sql, adminUser, 'client_admin', client);
    await insertClientMember(db.sql, { clientId: client, userId: adminUser });
    const member = await insertUser(db.sql);
    await assignRole(db.sql, member, 'client_user', client);
    await insertClientMember(db.sql, { clientId: client, userId: member });

    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/clients/${client}/members/${member}`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(204);

    const rows = await db.sql<{ archived_at: Date | null }[]>`
      select archived_at from client_members
      where client_id = ${client} and user_id = ${member}
    `;
    expect(rows).toHaveLength(1); // soft removal — the row remains
    expect(rows[0]!.archived_at).not.toBeNull();

    const roles = await db.sql`
      select ur.id from user_roles ur
      where ur.user_id = ${member} and ur.scope_type = 'client' and ur.scope_id = ${client}
    `;
    expect(roles).toHaveLength(0);

    const listed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/clients/${client}/members`,
      headers: await harness.bearer(admin),
    });
    const memberIds = listed
      .json<{ data: { userId: string }[] }>()
      .data.map((row) => row.userId);
    expect(memberIds).not.toContain(member);

    const events = await db.sql`
      select id from events
      where entity_type = 'client' and entity_id = ${client} and event_type = 'member_removed'
    `;
    expect(events).toHaveLength(1);
  });
});

describe('UX 2.9 — GET /clients meta.total', () => {
  it('an admin first page totals the full filtered set; the scoped list totals 1', async () => {
    const dbCount = await db.sql<{ count: string }[]>`
      select count(*) as count from clients where archived_at is null
    `;
    const asAdmin = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/clients?limit=1',
      headers: await harness.bearer(admin),
    });
    expect(asAdmin.statusCode).toBe(200);
    const meta = asAdmin.json<{
      meta: { count: number; nextCursor: string | null; total?: number };
    }>().meta;
    expect(meta.count).toBe(1);
    expect(meta.total).toBe(Number(dbCount[0]!.count));

    // Cursored pages omit total.
    if (meta.nextCursor !== null) {
      const second = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/clients?limit=1&cursor=${encodeURIComponent(meta.nextCursor)}`,
        headers: await harness.bearer(admin),
      });
      expect(
        second.json<{ meta: { total?: number } }>().meta.total,
      ).toBeUndefined();
    }

    // A client-scoped caller's "list" is their own client — total 1.
    const asClient = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/clients',
      headers: await harness.bearer(clientAdminA),
    });
    expect(asClient.json<{ meta: { total?: number } }>().meta.total).toBe(1);
  });
});

describe('AC-AUTH-05 — tenant isolation across the P2 client endpoints', () => {
  it("client A admin listing clients sees only client A, never B", async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/clients',
      headers: await harness.bearer(clientAdminA),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { id: string }[] }>();
    expect(data.map((row) => row.id)).toEqual([clientA]);
  });

  it('admin-only note fields are ABSENT (not null) for client-scoped reads', async () => {
    await db.sql`
      update clients set internal_notes = 'secret', onboarding_readiness_note = 'note'
      where id = ${clientA}
    `;
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown> }>();
    expect('internalNotes' in data).toBe(false);
    expect('onboardingReadinessNote' in data).toBe(false);
    // …and present for admins.
    const adminRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/clients/${clientA}`,
      headers: await harness.bearer(admin),
    });
    expect(
      adminRes.json<{ data: Record<string, unknown> }>().data['internalNotes'],
    ).toBe('secret');
  });

  it.each(['GET', 'PATCH'] as const)(
    '%s /clients/:idB from client A → never data',
    async (method) => {
      await expectTenantIsolated(harness.app, {
        method,
        url: `/api/v1/clients/${clientB}`,
        headers: await harness.bearer(clientAdminA),
      });
    },
  );

  it('GET /clients/:idB/members from client A → never data', async () => {
    await expectTenantIsolated(harness.app, {
      url: `/api/v1/clients/${clientB}/members`,
      headers: await harness.bearer(clientAdminA),
    });
  });

  it('DELETE /clients/:idB/members/:userId from client A → never data', async () => {
    await expectTenantIsolated(harness.app, {
      method: 'DELETE',
      url: `/api/v1/clients/${clientB}/members/${clientAdminB}`,
      headers: await harness.bearer(clientAdminA),
    });
  });

  it("PATCH /clients/:idB/members/:userId from client A → never data", async () => {
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/clients/${clientB}/members/${clientAdminB}`,
      headers: await harness.bearer(clientAdminA),
      payload: { isPrincipal: true },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.json<{ data?: unknown }>().data).toBeUndefined();
    // No write happened on tenant B.
    const rows = await db.sql<{ is_principal: boolean }[]>`
      select is_principal from client_members
      where client_id = ${clientB} and user_id = ${clientAdminB}
    `;
    expect(rows[0]!.is_principal).toBe(false);
  });
});
