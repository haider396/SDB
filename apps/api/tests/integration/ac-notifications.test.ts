/**
 * Phase P7 — GoHighLevel notification dispatch
 * (docs/07-ACCEPTANCE-CRITERIA.md §9, docs/06-BACKEND.md §4):
 *
 * AC-NT-01 — each of the seven events dispatches to ITS configured
 *            GHL_WEBHOOK_URL_<EVENT> with the full documented payload shape,
 *            driven through the real trigger flows (mock GHL via injected fetch)
 * AC-NT-02 — the notification_log row is written (committed, status 'queued')
 *            before the outbound call, and updated to sent/failed after
 * AC-NT-03 — a GHL 500 neither fails nor rolls back the triggering request
 * AC-NT-04 — the retry job honours the 1 min / 5 min backoff windows with a
 *            controlled clock and stops at 3 attempts
 * AC-NT-05 — payloads to client recipients never contain gated candidate PII
 *
 * Plus: the post-commit onResponse drain (no explicit drain call), the admin
 * log view (filters, pagination, authorization), the manual resend action,
 * and the unset-webhook-URL failure path.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationPayloadSchema, type NotificationLogRow } from '@sdb/contracts';
import type { GhlFetch } from '../../src/integrations/gohighlevel.js';
import { retryFailedNotifications } from '../../src/jobs/retry-failed-notifications.js';
import {
  assignRole,
  insertAssignment,
  insertCandidate,
  insertClient,
  insertClientMember,
  insertQuestion,
  insertQuestionCategory,
  insertRequisition,
  insertTaxonomyChain,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

// ---------------------------------------------------------------------------
// Mock GHL server: a recording fetch with a programmable responder and an
// optional onCall probe (AC-NT-02 inspects DB state at call time).
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: {
    event: string;
    notificationLogId: string;
    [key: string]: unknown;
  };
}

interface GhlMock {
  calls: RecordedCall[];
  fetchImpl: GhlFetch;
  respond(fn: (call: RecordedCall) => { status: number; body?: string }): void;
  onCall(fn: ((call: RecordedCall) => Promise<void>) | null): void;
  reset(): void;
}

function createGhlMock(): GhlMock {
  const calls: RecordedCall[] = [];
  const ok = () => ({ status: 200, body: '{"delivered":true}' });
  let responder: (call: RecordedCall) => { status: number; body?: string } = ok;
  let probe: ((call: RecordedCall) => Promise<void>) | null = null;
  return {
    calls,
    fetchImpl: async (url, init) => {
      const call: RecordedCall = {
        url,
        headers: init.headers,
        body: JSON.parse(init.body) as RecordedCall['body'],
      };
      calls.push(call);
      if (probe !== null) await probe(call);
      const res = responder(call);
      return { status: res.status, text: async () => res.body ?? '' };
    },
    respond(fn) {
      responder = fn;
    },
    onCall(fn) {
      probe = fn;
    },
    reset() {
      calls.length = 0;
      responder = ok;
      probe = null;
    },
  };
}

const URLS = {
  intake_submitted: 'https://ghl.test/hooks/intake-submitted',
  portal_invitation: 'https://ghl.test/hooks/portal-invitation',
  principal_approval_requested: 'https://ghl.test/hooks/principal-approval',
  candidates_presented: 'https://ghl.test/hooks/candidates-presented',
  client_decision_recorded: 'https://ghl.test/hooks/client-decision',
  interview_scheduled: 'https://ghl.test/hooks/interview-scheduled',
  requisition_status_changed: 'https://ghl.test/hooks/requisition-status',
} as const;

const ENV_OVERRIDES: Record<string, string> = {
  GHL_WEBHOOK_URL_INTAKE_SUBMITTED: URLS.intake_submitted,
  GHL_WEBHOOK_URL_PORTAL_INVITATION: URLS.portal_invitation,
  GHL_WEBHOOK_URL_PRINCIPAL_APPROVAL_REQUESTED: URLS.principal_approval_requested,
  GHL_WEBHOOK_URL_CANDIDATES_PRESENTED: URLS.candidates_presented,
  GHL_WEBHOOK_URL_CLIENT_DECISION_RECORDED: URLS.client_decision_recorded,
  GHL_WEBHOOK_URL_INTERVIEW_SCHEDULED: URLS.interview_scheduled,
  GHL_WEBHOOK_URL_REQUISITION_STATUS_CHANGED: URLS.requisition_status_changed,
};

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let db: TestDb;
let harness: TestApp;
let mock: GhlMock;
let superAdmin: string;
let admin: string;
let clientA: string;
let clientAdminA: string;
let clientUserA: string;
let roleCategoryId: string;

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.7.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function notifRow(id: string): Promise<{
  status: string;
  attempts: number;
  last_error: string | null;
  provider_response: { attemptedAt?: string; httpStatus?: number | null; body?: unknown } | null;
  payload: Record<string, unknown>;
  sent_at: Date | null;
}> {
  const rows = await db.sql<
    {
      status: string;
      attempts: number;
      last_error: string | null;
      provider_response: {
        attemptedAt?: string;
        httpStatus?: number | null;
        body?: unknown;
      } | null;
      payload: Record<string, unknown>;
      sent_at: Date | null;
    }[]
  >`
    select status, attempts, last_error, provider_response, payload, sent_at
    from notification_log where id = ${id}
  `;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function notifRowsFor(
  event: string,
  entityId: string,
): Promise<{ id: string; recipient_user_id: string | null; status: string }[]> {
  return db.sql<{ id: string; recipient_user_id: string | null; status: string }[]>`
    select id, recipient_user_id, status from notification_log
    where event = ${event}::notification_event and entity_id = ${entityId}
    order by created_at asc
  `;
}

function callsFor(url: string): RecordedCall[] {
  return mock.calls.filter((call) => call.url === url);
}

async function drain(): Promise<void> {
  await harness.app.notificationDispatch.drainQueued();
}

/** Grant portal access to a fresh paid client; returns its notification row. */
async function grantAccessRow(): Promise<{ clientId: string; row: NotificationLogRow['id'] }> {
  const clientId = await insertClient(db.sql, {
    companyName: `Grant Co ${randomUUID().slice(0, 8)}`,
  });
  const res = await harness.app.inject({
    method: 'POST',
    url: `/api/v1/clients/${clientId}/grant-access`,
    headers: await harness.bearer(admin),
    payload: {
      primaryContactEmail: `contact-${randomUUID().slice(0, 8)}@example.com`,
      primaryContactName: 'Primary Contact',
      isPrincipal: true,
    },
  });
  expect(res.statusCode).toBe(200);
  const rows = await notifRowsFor('portal_invitation', clientId);
  expect(rows).toHaveLength(1);
  return { clientId, row: rows[0]!.id };
}

beforeAll(async () => {
  db = await freshDb();
  mock = createGhlMock();
  harness = await buildTestApp(db, undefined, {
    ghlFetch: mock.fetchImpl,
    envOverrides: ENV_OVERRIDES,
  });

  superAdmin = await insertUser(db.sql, { fullName: 'Sam Super' });
  await assignRole(db.sql, superAdmin, 'super_admin');
  admin = await insertUser(db.sql, { fullName: 'Rebecca Kallaus' });
  await assignRole(db.sql, admin, 'admin');

  clientA = await insertClient(db.sql, { companyName: 'Notifications Tenant A' });
  clientAdminA = await insertUser(db.sql, { fullName: 'Cleo ClientAdmin' });
  await assignRole(db.sql, clientAdminA, 'client_admin', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientAdminA });
  clientUserA = await insertUser(db.sql, { fullName: 'Uma ClientUser' });
  await assignRole(db.sql, clientUserA, 'client_user', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientUserA });

  // Minimal public intake form: the two required mapped questions.
  const chain = await insertTaxonomyChain(db.sql);
  roleCategoryId = chain.roleCategoryId;
  const categoryId = await insertQuestionCategory(db.sql, { key: 'nt_cat' });
  await insertQuestion(db.sql, {
    categoryId,
    questionType: 'short_text',
    key: 'company_name',
    isRequired: true,
  });
  await insertQuestion(db.sql, {
    categoryId,
    questionType: 'email',
    key: 'contact_email',
    isRequired: true,
  });
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

beforeEach(async () => {
  // Settle any hook-triggered drain from the previous test, flush leftover
  // queued rows, then start with a clean recorder and a 200 responder.
  await harness.app.notificationDispatch.idle();
  await drain();
  mock.reset();
});

// ---------------------------------------------------------------------------
// AC-NT-01 — each event → its URL, full documented payload shape
// ---------------------------------------------------------------------------

describe('AC-NT-01 — each of the seven events dispatches to its configured URL with the documented payload', () => {
  function expectPayloadShape(call: RecordedCall): void {
    const payload = NotificationPayloadSchema.parse(call.body);
    // Private integration token + JSON content type on every outbound call.
    expect(call.headers['authorization']).toBe('Bearer ghl-private-token');
    expect(call.headers['content-type']).toBe('application/json');
    expect(payload.sentAt).not.toBeNull();
    // Every documented merge field is present (06 §4.1) — object keys, not
    // just parse success (catchall would mask a missing key otherwise).
    for (const key of [
      'clientName',
      'requisitionReference',
      'roleTitle',
      'candidateCount',
      'actionUrl',
      'actorName',
    ]) {
      expect(call.body['context'], `context.${key} missing`).toHaveProperty(key);
    }
  }

  async function expectSent(id: string): Promise<void> {
    const row = await notifRow(id);
    expect(row.status).toBe('sent');
    expect(row.sent_at).not.toBeNull();
    expect(row.provider_response?.httpStatus).toBe(200);
    expect(row.provider_response?.body).toEqual({ delivered: true });
  }

  it('intake_submitted → its URL, one call per active admin', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/intake-submissions',
      remoteAddress: nextIp(),
      payload: {
        formVersionHash: 'sha256:nt',
        roleCategoryId,
        answers: [
          { questionKey: 'company_name', valueText: 'Intake Notify Co' },
          { questionKey: 'contact_email', valueText: 'lead@intake-notify.example' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    await drain();

    const calls = callsFor(URLS.intake_submitted);
    expect(calls).toHaveLength(2); // superAdmin + admin
    for (const call of calls) {
      expectPayloadShape(call);
      expect(call.body['event']).toBe('intake_submitted');
      const context = call.body['context'] as Record<string, unknown>;
      // Enriched from the created requisition + prospect client.
      expect(context['clientName']).toBe('Intake Notify Co');
      expect(String(context['requisitionReference'])).toMatch(/^REQ-/u);
      expect(String(context['actionUrl'])).toContain('/requisitions/REQ-');
      await expectSent(call.body.notificationLogId);
    }
    expect(
      calls.map((call) => (call.body['recipient'] as { userId: string }).userId).sort(),
    ).toEqual([superAdmin, admin].sort());
  });

  it('portal_invitation → its URL, recipient split into first/last name, invitation actionUrl preserved', async () => {
    const { clientId } = await grantAccessRow();
    await drain();

    const calls = callsFor(URLS.portal_invitation);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expectPayloadShape(call);
    expect(call.body['event']).toBe('portal_invitation');
    const recipient = call.body['recipient'] as Record<string, unknown>;
    expect(recipient['firstName']).toBe('Primary');
    expect(recipient['lastName']).toBe('Contact');
    const context = call.body['context'] as Record<string, unknown>;
    expect(String(context['actionUrl'])).toContain('/accept-invitation?token=');
    expect(context['clientName']).toContain('Grant Co');
    void clientId;
    await expectSent(call.body.notificationLogId);
  });

  it('principal_approval_requested → its URL, to the principal, with actorName resolved', async () => {
    const principal = await insertUser(db.sql, { fullName: 'Pat Principal' });
    await assignRole(db.sql, principal, 'client_admin', clientA);
    await insertClientMember(db.sql, {
      clientId: clientA,
      userId: principal,
      isPrincipal: true,
    });
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'submitted',
      principalUserId: principal,
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/request-principal-approval`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    await drain();

    const calls = callsFor(URLS.principal_approval_requested).filter(
      (call) =>
        (call.body['recipient'] as { userId: string | null }).userId === principal,
    );
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expectPayloadShape(call);
    expect(call.body['event']).toBe('principal_approval_requested');
    const context = call.body['context'] as Record<string, unknown>;
    expect(context['clientName']).toBe('Notifications Tenant A');
    expect(context['actorName']).toBe('Rebecca Kallaus');
    await expectSent(call.body.notificationLogId);
  });

  it('candidates_presented → its URL, one call per client user, with candidateCount', async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'sourcing',
    });
    const one = await insertCandidate(db.sql, { hasConsent: true });
    const two = await insertCandidate(db.sql, { hasConsent: true });
    const assignments = [
      await insertAssignment(db.sql, {
        requisitionId,
        candidateId: one,
        assignedBy: admin,
        stage: 'vetted',
      }),
      await insertAssignment(db.sql, {
        requisitionId,
        candidateId: two,
        assignedBy: admin,
        stage: 'vetted',
      }),
    ];
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assignments/present',
      headers: await harness.bearer(admin),
      payload: { assignmentIds: assignments },
    });
    expect(res.statusCode).toBe(200);
    await drain();

    const calls = callsFor(URLS.candidates_presented).filter(
      (call) => call.body['context'] !== undefined,
    );
    const forThisReq = calls.filter((call) =>
      String((call.body['context'] as Record<string, unknown>)['requisitionReference']).startsWith('REQ-IT'),
    );
    expect(forThisReq.length).toBeGreaterThanOrEqual(2);
    const recipients = forThisReq.map(
      (call) => (call.body['recipient'] as { userId: string }).userId,
    );
    expect(recipients).toContain(clientAdminA);
    expect(recipients).toContain(clientUserA);
    for (const call of forThisReq) {
      expectPayloadShape(call);
      expect(call.body['event']).toBe('candidates_presented');
      const context = call.body['context'] as Record<string, unknown>;
      expect(context['candidateCount']).toBe(2);
      expect(context['clientName']).toBe('Notifications Tenant A');
      expect(context['actorName']).toBe('Rebecca Kallaus');
      await expectSent(call.body.notificationLogId);
    }
  });

  it('client_decision_recorded → its URL, to every active admin, decision in context', async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'candidates_presented',
    });
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const assignmentId = await insertAssignment(db.sql, {
      requisitionId,
      candidateId,
      assignedBy: admin,
      stage: 'presented',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/approve-for-interview`,
      headers: await harness.bearer(clientUserA),
    });
    expect(res.statusCode).toBe(200);
    await drain();

    const rows = await notifRowsFor('client_decision_recorded', assignmentId);
    expect(rows.map((row) => row.recipient_user_id).sort()).toEqual(
      [superAdmin, admin].sort(),
    );
    const ids = new Set(rows.map((row) => row.id));
    const calls = callsFor(URLS.client_decision_recorded).filter((call) =>
      ids.has(call.body.notificationLogId),
    );
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expectPayloadShape(call);
      expect(call.body['event']).toBe('client_decision_recorded');
      const context = call.body['context'] as Record<string, unknown>;
      expect(context['decision']).toBe('approved_for_interview');
      // Actor was the client user — resolved to a name for the template.
      expect(context['actorName']).toBe('Uma ClientUser');
      await expectSent(call.body.notificationLogId);
    }
  });

  it('interview_scheduled → its URL, to client users + the creating admin', async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'candidates_presented',
    });
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const assignmentId = await insertAssignment(db.sql, {
      requisitionId,
      candidateId,
      assignedBy: admin,
      stage: 'client_reviewing',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/interviews`,
      headers: await harness.bearer(admin),
      payload: {
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        timezone: 'America/Mexico_City',
      },
    });
    expect(res.statusCode).toBe(201);
    await drain();

    const rows = await notifRowsFor('interview_scheduled', assignmentId);
    const ids = new Set(rows.map((row) => row.id));
    const calls = callsFor(URLS.interview_scheduled).filter((call) =>
      ids.has(call.body.notificationLogId),
    );
    const recipients = calls.map(
      (call) => (call.body['recipient'] as { userId: string }).userId,
    );
    // Every active member of client A (earlier tests may have added more)
    // plus the creating admin (06 §4.4), de-duplicated.
    const members = await db.sql<{ user_id: string }[]>`
      select user_id from client_members
      where client_id = ${clientA} and archived_at is null
    `;
    const expected = [...new Set([...members.map((row) => row.user_id), admin])];
    expect(recipients.sort()).toEqual(expected.sort());
    expect(recipients).toContain(clientAdminA);
    expect(recipients).toContain(clientUserA);
    expect(recipients).toContain(admin);
    for (const call of calls) {
      expectPayloadShape(call);
      expect(call.body['event']).toBe('interview_scheduled');
      const context = call.body['context'] as Record<string, unknown>;
      expect(context['roundNumber']).toBe(1);
      expect(typeof context['scheduledAt']).toBe('string');
      await expectSent(call.body.notificationLogId);
    }
  });

  it('requisition_status_changed → its URL, one call per client user, from/to in context', async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'sourcing',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/transition`,
      headers: await harness.bearer(admin),
      payload: { toStatus: 'on_hold' },
    });
    expect(res.statusCode).toBe(200);
    await drain();

    const rows = await notifRowsFor('requisition_status_changed', requisitionId);
    const ids = new Set(rows.map((row) => row.id));
    const calls = callsFor(URLS.requisition_status_changed).filter((call) =>
      ids.has(call.body.notificationLogId),
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expectPayloadShape(call);
      expect(call.body['event']).toBe('requisition_status_changed');
      const context = call.body['context'] as Record<string, unknown>;
      expect(context['fromStatus']).toBe('sourcing');
      expect(context['toStatus']).toBe('on_hold');
      await expectSent(call.body.notificationLogId);
    }
  });
});

// ---------------------------------------------------------------------------
// Post-commit hook — dispatch happens with NO explicit drain call
// ---------------------------------------------------------------------------

describe('post-commit dispatch hook (06 §4.3: enqueue in the transaction, dispatch after commit)', () => {
  it('a mutating request alone triggers dispatch via the onResponse drain', async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'sourcing',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/transition`,
      headers: await harness.bearer(admin),
      payload: { toStatus: 'on_hold' },
    });
    expect(res.statusCode).toBe(200);

    // No drainQueued() here — poll for the hook-triggered dispatch.
    const rows = await notifRowsFor('requisition_status_changed', requisitionId);
    const ids = new Set(rows.map((row) => row.id));
    const deadline = Date.now() + 5_000;
    let seen: RecordedCall[] = [];
    while (Date.now() < deadline) {
      seen = callsFor(URLS.requisition_status_changed).filter((call) =>
        ids.has(call.body.notificationLogId),
      );
      if (seen.length >= rows.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(seen.length).toBe(rows.length);
    await harness.app.notificationDispatch.idle();
    for (const row of rows) {
      expect((await notifRow(row.id)).status).toBe('sent');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-NT-02 — row written before the outbound call, updated after
// ---------------------------------------------------------------------------

describe('AC-NT-02 — log row precedes the outbound call and is updated after', () => {
  it('at call time the row exists, committed, status queued, attempts 0; after: sent', async () => {
    const observed: { status: string; attempts: number }[] = [];
    mock.onCall(async (call) => {
      // Read through a SEPARATE connection pool — proves the row committed,
      // not merely visible inside an open transaction.
      const rows = await db.sql<{ status: string; attempts: number }[]>`
        select status, attempts from notification_log
        where id = ${call.body.notificationLogId}
      `;
      expect(rows).toHaveLength(1);
      observed.push(rows[0]!);
    });

    const { row } = await grantAccessRow();
    await drain();

    expect(observed.length).toBeGreaterThanOrEqual(1);
    expect(observed[0]).toEqual({ status: 'queued', attempts: 0 });
    const after = await notifRow(row);
    expect(after.status).toBe('sent');
    expect(after.attempts).toBe(1);
    expect(after.sent_at).not.toBeNull();
    expect(after.provider_response?.attemptedAt).toBeDefined();
  });

  it('on failure the row is updated to failed with attempts and last_error', async () => {
    mock.respond(() => ({ status: 500, body: '{"error":"boom"}' }));
    const { row } = await grantAccessRow();
    await drain();

    const after = await notifRow(row);
    expect(after.status).toBe('failed');
    expect(after.attempts).toBe(1);
    expect(after.last_error).toContain('500');
    expect(after.provider_response?.httpStatus).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// AC-NT-03 — a GHL failure never fails or rolls back the user request
// ---------------------------------------------------------------------------

describe('AC-NT-03 — GHL 500 leaves the triggering request successful and committed', () => {
  it('transition succeeds and persists although every dispatch fails', async () => {
    mock.respond(() => ({ status: 500, body: 'internal error' }));
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'sourcing',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/transition`,
      headers: await harness.bearer(admin),
      payload: { toStatus: 'candidates_presented' },
    });
    expect(res.statusCode).toBe(200);
    await drain();

    // The state change committed…
    const status = await db.sql<{ status: string }[]>`
      select status::text as status from requisitions where id = ${requisitionId}
    `;
    expect(status[0]?.status).toBe('candidates_presented');
    // …and the rows record the failure for the retry job.
    const rows = await notifRowsFor('requisition_status_changed', requisitionId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.status).toBe('failed');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-NT-04 — retry job: backoff windows, stops at 3 attempts
// ---------------------------------------------------------------------------

describe('AC-NT-04 — retry-failed-notifications honours backoff and the 3-attempt cap', () => {
  async function failedRowViaGrant(): Promise<string> {
    mock.respond((call) =>
      call.url === URLS.portal_invitation
        ? { status: 500, body: 'down' }
        : { status: 200, body: '{}' },
    );
    const { row } = await grantAccessRow();
    await drain();
    expect((await notifRow(row)).status).toBe('failed');
    return row;
  }

  async function attemptedAt(id: string): Promise<number> {
    const row = await notifRow(id);
    const raw = row.provider_response?.attemptedAt;
    expect(raw).toBeDefined();
    return Date.parse(raw!);
  }

  function retry(at: number): Promise<number> {
    return retryFailedNotifications(harness.app.notificationDispatch, {
      now: new Date(at),
    });
  }

  function callCount(id: string): number {
    return mock.calls.filter((call) => call.body.notificationLogId === id).length;
  }

  it('retries at 1 min then 5 min after the previous attempt, then stops at 3 attempts', async () => {
    const id = await failedRowViaGrant();
    const baseline = callCount(id); // the initial (1st) attempt
    const t0 = await attemptedAt(id);

    // 30 s after attempt 1 — inside the 1-minute window: no retry.
    await retry(t0 + 30_000);
    expect(callCount(id)).toBe(baseline);
    expect((await notifRow(id)).attempts).toBe(1);

    // 61 s after attempt 1 — eligible: attempt 2 (still failing).
    await retry(t0 + 61_000);
    expect(callCount(id)).toBe(baseline + 1);
    expect((await notifRow(id)).attempts).toBe(2);
    const t1 = await attemptedAt(id);

    // 4 min after attempt 2 — inside the 5-minute window: no retry.
    await retry(t1 + 240_000);
    expect(callCount(id)).toBe(baseline + 1);

    // 5 min + 1 s after attempt 2 — eligible: attempt 3 (still failing).
    await retry(t1 + 301_000);
    expect(callCount(id)).toBe(baseline + 2);
    const exhausted = await notifRow(id);
    expect(exhausted.attempts).toBe(3);
    expect(exhausted.status).toBe('failed');

    // Far in the future — the cap holds: no 4th attempt, ever.
    await retry(t1 + 301_000 + 864_000_000);
    expect(callCount(id)).toBe(baseline + 2);
    expect((await notifRow(id)).attempts).toBe(3);
  });

  it('a retry that gets a 2xx marks the row sent', async () => {
    const id = await failedRowViaGrant();
    const t0 = await attemptedAt(id);
    mock.respond(() => ({ status: 200, body: '{"delivered":true}' }));

    await retry(t0 + 61_000);
    const row = await notifRow(id);
    expect(row.status).toBe('sent');
    expect(row.attempts).toBe(2);
    expect(row.sent_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-NT-05 — no gated candidate PII in payloads to client recipients
// ---------------------------------------------------------------------------

describe('AC-NT-05 — payloads to client recipients carry no gated candidate PII', () => {
  it('candidates_presented and interview_scheduled payloads (stored + outbound) contain none of the gated fields', async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'sourcing',
    });
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const short = candidateId.slice(0, 8);
    // The fixture's gated PII values (docs/02 §gated view: last name, email,
    // phone, WhatsApp, LinkedIn, current employer).
    const gatedValues = [
      `Last${short}`,
      `candidate-${short}@example.com`,
      '+1-555-0000',
      '+1-555-0001',
      `https://linkedin.com/in/c${short}`,
      'Employer Inc',
    ];

    const assignmentId = await insertAssignment(db.sql, {
      requisitionId,
      candidateId,
      assignedBy: admin,
      stage: 'vetted',
    });
    const present = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assignments/present',
      headers: await harness.bearer(admin),
      payload: { assignmentIds: [assignmentId] },
    });
    expect(present.statusCode).toBe(200);

    // Move to a stage where interviews may be created, then create one —
    // interview_scheduled is the event whose stage UNLOCKS PII, so its
    // payload is the likeliest leak site.
    await db.sql`
      update assignments set stage = 'client_reviewing' where id = ${assignmentId}
    `;
    const interview = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/interviews`,
      headers: await harness.bearer(admin),
      payload: {
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        timezone: 'UTC',
      },
    });
    expect(interview.statusCode).toBe(201);
    await drain();

    // Stored payloads for both events…
    const stored = await db.sql<{ payload: unknown; recipient_user_id: string | null }[]>`
      select payload, recipient_user_id from notification_log
      where (event = 'candidates_presented' and entity_id = ${requisitionId})
         or (event = 'interview_scheduled' and entity_id = ${assignmentId})
    `;
    expect(stored.length).toBeGreaterThanOrEqual(4); // 2 client users + 3 interview recipients
    const clientRecipients = new Set([clientAdminA, clientUserA]);
    for (const row of stored) {
      const serialized = JSON.stringify(row.payload);
      for (const value of gatedValues) {
        expect(serialized, `stored payload leaks "${value}"`).not.toContain(value);
      }
      // Client recipients specifically: no candidate identity beyond display
      // name — the fixture's gated last name must never appear.
      if (row.recipient_user_id !== null && clientRecipients.has(row.recipient_user_id)) {
        expect(serialized).not.toContain(`Last${short}`);
      }
    }

    // …and the actual outbound bodies.
    const ids = new Set(
      (await db.sql<{ id: string }[]>`
        select id from notification_log
        where (event = 'candidates_presented' and entity_id = ${requisitionId})
           or (event = 'interview_scheduled' and entity_id = ${assignmentId})
      `).map((row) => row.id),
    );
    const outbound = mock.calls.filter((call) => ids.has(call.body.notificationLogId));
    expect(outbound.length).toBe(ids.size);
    for (const call of outbound) {
      const serialized = JSON.stringify(call.body);
      for (const value of gatedValues) {
        expect(serialized, `outbound payload leaks "${value}"`).not.toContain(value);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Unset webhook URL — failed with a clear error, request unaffected
// ---------------------------------------------------------------------------

describe('unset GHL_WEBHOOK_URL_<EVENT> — dispatch-time failure, never a boot failure', () => {
  let bareDb: TestDb;
  let bareHarness: TestApp;
  let bareMock: GhlMock;

  beforeAll(async () => {
    bareDb = await freshDb();
    bareMock = createGhlMock();
    // No GHL_WEBHOOK_URL_* overrides at all — the P0-era env.
    bareHarness = await buildTestApp(bareDb, undefined, {
      ghlFetch: bareMock.fetchImpl,
    });
  });

  afterAll(async () => {
    await bareHarness.app.close();
    await bareDb.close();
  });

  it('marks the row failed with last_error "webhook url not configured", no outbound call, request succeeds', async () => {
    const admin2 = await insertUser(bareDb.sql);
    await assignRole(bareDb.sql, admin2, 'admin');
    const clientId = await insertClient(bareDb.sql);
    const res = await bareHarness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${clientId}/grant-access`,
      headers: await bareHarness.bearer(admin2),
      payload: {
        primaryContactEmail: 'bare@example.com',
        primaryContactName: 'Bare Contact',
        isPrincipal: false,
      },
    });
    expect(res.statusCode).toBe(200);
    await bareHarness.app.notificationDispatch.drainQueued();

    const rows = await bareDb.sql<
      { status: string; attempts: number; last_error: string | null }[]
    >`
      select status, attempts, last_error from notification_log
      where event = 'portal_invitation' and entity_id = ${clientId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.last_error).toBe('webhook url not configured');
    expect(bareMock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Admin surface: GET /admin/notifications + POST :id/resend
// ---------------------------------------------------------------------------

describe('GET /api/v1/admin/notifications — log view with filters and cursor pagination', () => {
  it('returns rows in the contract shape, newest first', async () => {
    await grantAccessRow();
    await drain();
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications',
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    const { data, meta } = res.json<{
      data: NotificationLogRow[];
      meta: { count: number; nextCursor: string | null };
    }>();
    expect(data.length).toBeGreaterThan(0);
    expect(meta.count).toBe(data.length);
    for (let index = 1; index < data.length; index += 1) {
      expect(data[index - 1]!.createdAt >= data[index]!.createdAt).toBe(true);
    }
    const first = data[0]!;
    expect(first).toHaveProperty('event');
    expect(first).toHaveProperty('recipientEmail');
    expect(first).toHaveProperty('attempts');
    expect(first).toHaveProperty('payload');
  });

  it('filters by status and event', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications?status=sent&event=portal_invitation',
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: NotificationLogRow[] }>();
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(row.status).toBe('sent');
      expect(row.event).toBe('portal_invitation');
    }
  });

  it('paginates with an opaque cursor', async () => {
    const page1 = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications?limit=1',
      headers: await harness.bearer(admin),
    });
    const body1 = page1.json<{
      data: NotificationLogRow[];
      meta: { nextCursor: string | null };
    }>();
    expect(body1.data).toHaveLength(1);
    expect(body1.meta.nextCursor).not.toBeNull();

    const page2 = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/admin/notifications?limit=1&cursor=${encodeURIComponent(body1.meta.nextCursor!)}`,
      headers: await harness.bearer(admin),
    });
    const body2 = page2.json<{ data: NotificationLogRow[] }>();
    expect(body2.data).toHaveLength(1);
    expect(body2.data[0]!.id).not.toBe(body1.data[0]!.id);

    const garbled = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/admin/notifications?cursor=not-a-cursor',
      headers: await harness.bearer(admin),
    });
    expect(garbled.statusCode).toBe(400);
  });

  it('requires event.view: client-scoped callers get 403', async () => {
    for (const caller of [clientAdminA, clientUserA]) {
      const res = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications',
        headers: await harness.bearer(caller),
      });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('POST /api/v1/admin/notifications/:id/resend — manual resend', () => {
  async function failedPortalRow(): Promise<string> {
    mock.respond(() => ({ status: 500, body: 'down' }));
    const { row } = await grantAccessRow();
    await drain();
    mock.respond(() => ({ status: 200, body: '{"delivered":true}' }));
    return row;
  }

  it('re-queues with a fresh attempt budget, dispatches immediately, writes the audit event', async () => {
    const id = await failedPortalRow();
    const before = mock.calls.length;

    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${id}/resend`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: NotificationLogRow }>();
    expect(data.id).toBe(id);
    expect(data.status).toBe('sent');
    expect(data.attempts).toBe(1); // reset to 0, then the immediate attempt
    expect(data.lastError).toBeNull();
    expect(data.sentAt).not.toBeNull();
    expect(mock.calls.length).toBeGreaterThan(before);

    const events = await db.sql<{ actor_id: string | null; from_value: string | null }[]>`
      select actor_id, from_value from events
      where entity_type = 'notification' and entity_id = ${id}
        and event_type = 'notification_resent'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]?.actor_id).toBe(superAdmin);
    expect(events[0]?.from_value).toBe('failed');
  });

  it('a resend that fails again leaves a clean failed row (fresh budget)', async () => {
    const id = await failedPortalRow();
    mock.respond(() => ({ status: 502, body: 'bad gateway' }));
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${id}/resend`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: NotificationLogRow }>();
    expect(data.status).toBe('failed');
    expect(data.attempts).toBe(1);
    expect(data.lastError).toContain('502');
  });

  it('requires settings.manage: admin and client callers get 403; unknown id is 404', async () => {
    const id = await failedPortalRow();
    for (const caller of [admin, clientAdminA, clientUserA]) {
      const res = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/admin/notifications/${id}/resend`,
        headers: await harness.bearer(caller),
      });
      expect(res.statusCode).toBe(403);
    }
    const missing = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/admin/notifications/${randomUUID()}/resend`,
      headers: await harness.bearer(superAdmin),
    });
    expect(missing.statusCode).toBe(404);
  });
});
