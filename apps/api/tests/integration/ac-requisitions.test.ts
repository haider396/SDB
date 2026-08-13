/**
 * Phase P2 — requisitions and principal approval
 * (docs/07-ACCEPTANCE-CRITERIA.md §6):
 *
 * AC-RQ-01 — every valid transition in REQUISITION_TRANSITIONS succeeds and
 *            writes an event (parameterised over the full adjacency map)
 * AC-RQ-02 — every invalid transition → 409 INVALID_TRANSITION with
 *            { from, to } details (parameterised over the complement)
 * AC-RQ-03 — placed and closed_unfilled accept no outbound transitions
 * AC-RQ-04 — only principalUserId may principal-approve; 403 otherwise even
 *            with the permission
 * AC-RQ-05 — principal-request-changes requires a comment and moves to
 *            changes_requested
 * AC-RQ-06 — commercial fields are ABSENT (not null) without
 *            requisition.view_commercials
 * AC-RQ-07 — REQ-NNNNNN references stay unique and well-formed under 50
 *            concurrent creations
 *
 * Plus: PATCH semantics (budget-unit rule, principal membership), answers
 * upsert through the intake pipeline, the de-duplicated event log (06 §2.3),
 * status-change notifications (06 §4.4), and AC-AUTH-05 tenant isolation for
 * every new requisition endpoint.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisitionStatus } from '@sdb/contracts';
import { RequisitionStatusSchema } from '@sdb/contracts';
import { REQUISITION_TRANSITIONS } from '../../src/services/state-machines.js';
import {
  assignRole,
  insertClient,
  insertClientMember,
  insertQuestion,
  insertQuestionCategory,
  insertRequisition,
  insertTaxonomyChain,
  insertUser,
} from './fixtures.js';
import {
  buildTestApp,
  expectTenantIsolated,
  freshDb,
  type TestApp,
  type TestDb,
} from './harness.js';

const ALL_STATUSES = RequisitionStatusSchema.options;

const VALID_PAIRS: [RequisitionStatus, RequisitionStatus][] = (
  Object.keys(REQUISITION_TRANSITIONS) as RequisitionStatus[]
).flatMap((from) => REQUISITION_TRANSITIONS[from].map((to) => [from, to] as [RequisitionStatus, RequisitionStatus]));

const INVALID_PAIRS: [RequisitionStatus, RequisitionStatus][] = (
  Object.keys(REQUISITION_TRANSITIONS) as RequisitionStatus[]
).flatMap((from) =>
  ALL_STATUSES.filter((to) => !REQUISITION_TRANSITIONS[from].includes(to)).map(
    (to) => [from, to] as [RequisitionStatus, RequisitionStatus],
  ),
);

let db: TestDb;
let harness: TestApp;
let superAdmin: string;
let admin: string;
let clientA: string;
let clientB: string;
let principalA: string; // client_admin of A, designated principal
let otherClientAdminA: string; // client_admin of A, NOT the principal
let clientUserA: string;
let clientAdminB: string;

beforeAll(async () => {
  db = await freshDb();
  superAdmin = await insertUser(db.sql);
  await assignRole(db.sql, superAdmin, 'super_admin');
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  clientA = await insertClient(db.sql, { companyName: 'Requisition Tenant A' });
  clientB = await insertClient(db.sql, { companyName: 'Requisition Tenant B' });

  principalA = await insertUser(db.sql);
  await assignRole(db.sql, principalA, 'client_admin', clientA);
  await insertClientMember(db.sql, {
    clientId: clientA,
    userId: principalA,
    isPrincipal: true,
  });
  otherClientAdminA = await insertUser(db.sql);
  await assignRole(db.sql, otherClientAdminA, 'client_admin', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: otherClientAdminA });
  clientUserA = await insertUser(db.sql);
  await assignRole(db.sql, clientUserA, 'client_user', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientUserA });

  clientAdminB = await insertUser(db.sql);
  await assignRole(db.sql, clientAdminB, 'client_admin', clientB);
  await insertClientMember(db.sql, { clientId: clientB, userId: clientAdminB });

  harness = await buildTestApp(db);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

describe('AC-RQ-01 — every valid transition succeeds and writes an event', () => {
  it.each(VALID_PAIRS)('%s → %s', async (from, to) => {
    const requisition = await insertRequisition(db.sql, {
      clientId: clientA,
      status: from,
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/transition`,
      headers: await harness.bearer(admin),
      payload: { toStatus: to, note: `move ${from} → ${to}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { status: string } }>().data.status).toBe(to);

    const rows = await db.sql<{ status: string }[]>`
      select status from requisitions where id = ${requisition}
    `;
    expect(rows[0]!.status).toBe(to);

    // App-emitted event with the actor; the trigger backstop may add another.
    const events = await db.sql<{ actor_id: string | null }[]>`
      select actor_id from events
      where entity_type = 'requisition' and entity_id = ${requisition}
        and event_type = 'status_changed'
        and from_value = ${from} and to_value = ${to}
    `;
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((event) => event.actor_id === admin)).toBe(true);
  });
});

describe('AC-RQ-02 — every invalid transition is a 409 with from/to details', () => {
  it.each(INVALID_PAIRS)('%s → %s is rejected', async (from, to) => {
    const requisition = await insertRequisition(db.sql, {
      clientId: clientA,
      status: from,
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/transition`,
      headers: await harness.bearer(admin),
      payload: { toStatus: to },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{
      error: { code: string; details: { from: string; to: string } };
    }>();
    expect(body.error.code).toBe('INVALID_TRANSITION');
    expect(body.error.details).toEqual({ from, to });

    const rows = await db.sql<{ status: string }[]>`
      select status from requisitions where id = ${requisition}
    `;
    expect(rows[0]!.status).toBe(from);
  });
});

describe('AC-RQ-03 — terminal states accept no outbound transitions', () => {
  it.each(['placed', 'closed_unfilled'] as const)(
    '%s has an empty adjacency and rejects every target',
    async (terminal) => {
      expect(REQUISITION_TRANSITIONS[terminal]).toEqual([]);
      const requisition = await insertRequisition(db.sql, {
        clientId: clientA,
        status: terminal,
      });
      for (const to of ALL_STATUSES.filter((status) => status !== terminal)) {
        const res = await harness.app.inject({
          method: 'POST',
          url: `/api/v1/requisitions/${requisition}/transition`,
          headers: await harness.bearer(superAdmin),
          payload: { toStatus: to },
        });
        expect(res.statusCode, `${terminal} → ${to}`).toBe(409);
      }
    },
  );
});

describe('AC-RQ-04 — principal identity is enforced beyond the permission', () => {
  async function pendingRequisition(): Promise<string> {
    return insertRequisition(db.sql, {
      clientId: clientA,
      status: 'pending_principal_approval',
      principalUserId: principalA,
    });
  }

  it('the designated principal approves: → sourcing with timestamps set', async () => {
    const requisition = await pendingRequisition();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/principal-approve`,
      headers: await harness.bearer(principalA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { status: string } }>().data.status).toBe('sourcing');

    const rows = await db.sql<
      { status: string; principal_approved_at: Date | null; sourcing_started_at: Date | null }[]
    >`
      select status, principal_approved_at, sourcing_started_at
      from requisitions where id = ${requisition}
    `;
    expect(rows[0]!.status).toBe('sourcing');
    expect(rows[0]!.principal_approved_at).not.toBeNull();
    expect(rows[0]!.sourcing_started_at).not.toBeNull();
  });

  it.each([
    ['another client_admin of the same client', () => otherClientAdminA],
    ['a super_admin holding the permission', () => superAdmin],
  ])('%s receives 403', async (_label, pick) => {
    const requisition = await pendingRequisition();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/principal-approve`,
      headers: await harness.bearer(pick()),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    const rows = await db.sql<{ status: string }[]>`
      select status from requisitions where id = ${requisition}
    `;
    expect(rows[0]!.status).toBe('pending_principal_approval');
  });

  it('a client_user without the permission receives 403 before the handler', async () => {
    const requisition = await pendingRequisition();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/principal-approve`,
      headers: await harness.bearer(clientUserA),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('AC-RQ-05 — principal-request-changes requires a comment', () => {
  it('moves to changes_requested and stores the comment', async () => {
    const requisition = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'pending_principal_approval',
      principalUserId: principalA,
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/principal-request-changes`,
      headers: await harness.bearer(principalA),
      payload: { comment: 'The brief is missing the timezone overlap.' },
    });
    expect(res.statusCode).toBe(200);
    const rows = await db.sql<
      { status: string; principal_change_request: string | null }[]
    >`
      select status, principal_change_request from requisitions where id = ${requisition}
    `;
    expect(rows[0]!.status).toBe('changes_requested');
    expect(rows[0]!.principal_change_request).toBe(
      'The brief is missing the timezone overlap.',
    );
  });

  it('a missing or empty comment is rejected and nothing changes', async () => {
    const requisition = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'pending_principal_approval',
      principalUserId: principalA,
    });
    for (const payload of [{}, { comment: '' }]) {
      const res = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/requisitions/${requisition}/principal-request-changes`,
        headers: await harness.bearer(principalA),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    const rows = await db.sql<{ status: string }[]>`
      select status from requisitions where id = ${requisition}
    `;
    expect(rows[0]!.status).toBe('pending_principal_approval');
  });
});

describe('AC-RQ-06 — commercial fields are omitted, not nulled, without the permission', () => {
  const COMMERCIAL_KEYS = [
    'budgetMin',
    'budgetMax',
    'budgetUnit',
    'budgetCurrency',
    'budgetIsFlexible',
    'serviceTier',
  ];

  it('detail and list: keys absent for a client caller, present for an admin', async () => {
    const requisition = await insertRequisition(db.sql, {
      clientId: clientA,
      budget: { min: 2000, max: 3000, unit: 'monthly' },
      serviceTier: 'standard_placement',
    });

    const clientDetail = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(principalA),
    });
    expect(clientDetail.statusCode).toBe(200);
    const clientData = clientDetail.json<{ data: Record<string, unknown> }>().data;
    for (const key of COMMERCIAL_KEYS) {
      expect(key in clientData, `${key} must be ABSENT for a client caller`).toBe(false);
    }

    const adminDetail = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(admin),
    });
    const adminData = adminDetail.json<{ data: Record<string, unknown> }>().data;
    expect(adminData['budgetMin']).toBe(2000);
    expect(adminData['budgetMax']).toBe(3000);
    expect(adminData['budgetUnit']).toBe('monthly');
    expect(adminData['serviceTier']).toBe('standard_placement');

    const clientList = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/requisitions',
      headers: await harness.bearer(principalA),
    });
    const listRow = clientList
      .json<{ data: Record<string, unknown>[] }>()
      .data.find((row) => row['id'] === requisition);
    expect(listRow).toBeDefined();
    for (const key of COMMERCIAL_KEYS) {
      expect(key in listRow!, `${key} must be ABSENT in the client list`).toBe(false);
    }
  });
});

describe('UX 2.9 — GET /requisitions meta.total', () => {
  it('first pages total the full filtered set; cursored pages omit total', async () => {
    const dbCount = await db.sql<{ count: string }[]>`
      select count(*) as count from requisitions where archived_at is null
    `;
    const first = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/requisitions?limit=1',
      headers: await harness.bearer(admin),
    });
    expect(first.statusCode).toBe(200);
    const meta = first.json<{
      meta: { count: number; nextCursor: string | null; total?: number };
    }>().meta;
    expect(meta.total).toBe(Number(dbCount[0]!.count));

    if (meta.nextCursor !== null) {
      const second = await harness.app.inject({
        method: 'GET',
        url: `/api/v1/requisitions?limit=1&cursor=${encodeURIComponent(meta.nextCursor)}`,
        headers: await harness.bearer(admin),
      });
      expect(
        second.json<{ meta: { total?: number } }>().meta.total,
      ).toBeUndefined();
    }

    // A client-scoped caller's total covers only their own tenant.
    const tenantCount = await db.sql<{ count: string }[]>`
      select count(*) as count from requisitions
      where archived_at is null and client_id = ${clientA}
    `;
    const scoped = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/requisitions',
      headers: await harness.bearer(principalA),
    });
    expect(scoped.json<{ meta: { total?: number } }>().meta.total).toBe(
      Number(tenantCount[0]!.count),
    );
  });
});

describe('AC-RQ-07 — REQ-NNNNNN uniqueness under 50 concurrent creations', () => {
  it('creates 50 requisitions concurrently with unique, well-formed references', async () => {
    const taxonomy = await insertTaxonomyChain(db.sql);
    const categoryId = await insertQuestionCategory(db.sql);
    const questionKey = `notes_${randomUUID().slice(0, 8)}`;
    await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: questionKey,
    });

    const headers = await harness.bearer(admin);
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        harness.app.inject({
          method: 'POST',
          url: '/api/v1/requisitions',
          headers,
          payload: {
            clientId: clientA,
            roleCategoryId: taxonomy.roleCategoryId,
            formVersionHash: 'concurrency-test',
            answers: [{ questionKey, valueText: `submission ${index}` }],
          },
        }),
      ),
    );
    const references = responses.map((res) => {
      expect(res.statusCode).toBe(201);
      return res.json<{ data: { requisitionReference: string } }>().data
        .requisitionReference;
    });
    expect(references).toHaveLength(50);
    expect(new Set(references).size).toBe(50);
    for (const reference of references) {
      expect(reference).toMatch(/^REQ-\d{6}$/);
    }
  });
});

describe('04 §7 — PATCH /requisitions/:id admin fields', () => {
  it('updates briefMarkdown, budget, headcount, and principalUserId', async () => {
    const requisition = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(admin),
      payload: {
        briefMarkdown: '# The brief',
        headcount: 2,
        budgetMin: 2500,
        budgetMax: 3500,
        budgetUnit: 'monthly',
        principalUserId: principalA,
      },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown> }>();
    expect(data['briefMarkdown']).toBe('# The brief');
    expect(data['headcount']).toBe(2);
    expect(data['budgetMin']).toBe(2500);
    expect(data['principalUserId']).toBe(principalA);

    const events = await db.sql`
      select id from events
      where entity_type = 'requisition' and entity_id = ${requisition}
        and event_type = 'requisition_updated'
    `;
    expect(events).toHaveLength(1);
  });

  it('updates the overlap window (overlapStart/overlapEnd/overlapTimezone) and round-trips it', async () => {
    const requisition = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(admin),
      payload: {
        overlapStart: '09:00',
        overlapEnd: '14:30',
        overlapTimezone: 'America/Chicago',
      },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown> }>();
    // Postgres renders `time` as HH:MM:SS.
    expect(data['overlapStart']).toBe('09:00:00');
    expect(data['overlapEnd']).toBe('14:30:00');
    expect(data['overlapTimezone']).toBe('America/Chicago');

    // Round-trips on the detail read and clears back to null.
    const detail = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(admin),
    });
    expect(detail.statusCode).toBe(200);
    expect(
      detail.json<{ data: Record<string, unknown> }>().data['overlapStart'],
    ).toBe('09:00:00');

    const cleared = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(admin),
      payload: { overlapStart: null, overlapEnd: null, overlapTimezone: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(
      cleared.json<{ data: Record<string, unknown> }>().data['overlapStart'],
    ).toBeNull();

    // Every state change writes an event row (CLAUDE.md rule 6).
    const events = await db.sql`
      select id from events
      where entity_type = 'requisition' and entity_id = ${requisition}
        and event_type = 'requisition_updated'
    `;
    expect(events).toHaveLength(2);
  });

  it('rejects a malformed overlap time', async () => {
    const requisition = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(admin),
      payload: { overlapStart: '9am' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'MALFORMED_REQUEST',
    );
  });

  it('rejects a budget amount without a unit (02 §7)', async () => {
    const requisition = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(admin),
      payload: { budgetMin: 1000, budgetMax: 2000 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a principal who is not a member of the requisition’s client', async () => {
    const requisition = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}`,
      headers: await harness.bearer(admin),
      payload: { principalUserId: clientAdminB },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('04 §7 — PATCH /requisitions/:id/answers reuses the intake pipeline', () => {
  it('upserts through validation, refreshes the snapshot, keeps other answers', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const keyA = `upsert_a_${randomUUID().slice(0, 6)}`;
    const keyB = `upsert_b_${randomUUID().slice(0, 6)}`;
    await insertQuestion(db.sql, { categoryId, questionType: 'short_text', key: keyA });
    await insertQuestion(db.sql, { categoryId, questionType: 'number', key: keyB });
    const requisition = await insertRequisition(db.sql, { clientId: clientA });

    const first = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}/answers`,
      headers: await harness.bearer(admin),
      payload: {
        answers: [
          { questionKey: keyA, valueText: 'first value' },
          { questionKey: keyB, valueNumber: 7 },
        ],
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}/answers`,
      headers: await harness.bearer(admin),
      payload: { answers: [{ questionKey: keyA, valueText: 'updated value' }] },
    });
    expect(second.statusCode).toBe(200);
    const answers = second.json<{
      data: { answers: { questionKey: string; valueText: string | null; valueNumber: number | null }[] };
    }>().data.answers;
    expect(answers).toHaveLength(2); // keyB untouched
    expect(answers.find((a) => a.questionKey === keyA)?.valueText).toBe('updated value');
    expect(answers.find((a) => a.questionKey === keyB)?.valueNumber).toBe(7);

    const rows = await db.sql<{ question_key: string; question_snapshot: Record<string, unknown> }[]>`
      select question_key, question_snapshot from requisition_answers
      where requisition_id = ${requisition}
    `;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.question_snapshot['label']).toBeTruthy();
    }

    const events = await db.sql`
      select id from events
      where entity_type = 'requisition' and entity_id = ${requisition}
        and event_type = 'answers_updated'
    `;
    expect(events).toHaveLength(2);
  });

  it('a mismatched value field fails with 422 VALUE_TYPE_MISMATCH through the same pipeline', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const key = `mismatch_${randomUUID().slice(0, 6)}`;
    await insertQuestion(db.sql, { categoryId, questionType: 'number', key });
    const requisition = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}/answers`,
      headers: await harness.bearer(admin),
      payload: { answers: [{ questionKey: key, valueText: 'not a number' }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALUE_TYPE_MISMATCH');
  });

  it('an unknown question key fails with 422 UNKNOWN_QUESTION', async () => {
    const requisition = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${requisition}/answers`,
      headers: await harness.bearer(admin),
      payload: { answers: [{ questionKey: 'no_such_question', valueText: 'x' }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('UNKNOWN_QUESTION');
  });
});

describe('J3 — request-principal-approval fires the principal notification', () => {
  it('moves to pending_principal_approval and queues both notifications', async () => {
    const requisition = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'submitted',
      principalUserId: principalA,
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/request-principal-approval`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { status: string } }>().data.status).toBe(
      'pending_principal_approval',
    );

    const principalNotifications = await db.sql<{ recipient_user_id: string | null }[]>`
      select recipient_user_id from notification_log
      where event = 'principal_approval_requested' and entity_id = ${requisition}
    `;
    expect(principalNotifications).toHaveLength(1);
    expect(principalNotifications[0]!.recipient_user_id).toBe(principalA);

    // 06 §4.4: any status transition also notifies all users of that client.
    const statusNotifications = await db.sql<{ recipient_user_id: string | null }[]>`
      select recipient_user_id from notification_log
      where event = 'requisition_status_changed' and entity_id = ${requisition}
    `;
    const recipients = statusNotifications.map((row) => row.recipient_user_id);
    expect(recipients).toEqual(
      expect.arrayContaining([principalA, otherClientAdminA, clientUserA]),
    );
  });

  it('is rejected with 422 when no principal is designated', async () => {
    const requisition = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'submitted',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/request-principal-approval`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('06 §2.3 — the event log read de-duplicates app+trigger pairs', () => {
  it('one status change appears once, with the actor, though the DB holds two rows', async () => {
    const requisition = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'submitted',
      principalUserId: principalA,
    });
    const transition = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisition}/transition`,
      headers: await harness.bearer(admin),
      payload: { toStatus: 'on_hold' },
    });
    expect(transition.statusCode).toBe(200);

    // The database holds BOTH the app event and the trigger backstop.
    const raw = await db.sql`
      select id from events
      where entity_type = 'requisition' and entity_id = ${requisition}
        and event_type = 'status_changed'
        and from_value = 'submitted' and to_value = 'on_hold'
    `;
    expect(raw).toHaveLength(2);

    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisition}/events`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{
      data: { eventType: string; fromValue: string | null; toValue: string | null; actorId: string | null; actorName: string | null; occurredAt: string }[];
    }>();
    const statusEvents = data.filter(
      (event) =>
        event.eventType === 'status_changed' &&
        event.fromValue === 'submitted' &&
        event.toValue === 'on_hold',
    );
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]!.actorId).toBe(admin); // the app event won
    // UX 2.10: the actor's full name is joined onto the read model.
    const adminName = (
      await db.sql<{ full_name: string }[]>`
        select full_name from users where id = ${admin}
      `
    )[0]!.full_name;
    expect(statusEvents[0]!.actorName).toBe(adminName);

    // Chronological ordering.
    const times = data.map((event) => new Date(event.occurredAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('event.view is denied to client roles', async () => {
    const requisition = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisition}/events`,
      headers: await harness.bearer(principalA),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('AC-AUTH-05 — tenant isolation across the P2 requisition endpoints', () => {
  let requisitionB: string;

  beforeAll(async () => {
    requisitionB = await insertRequisition(db.sql, {
      clientId: clientB,
      status: 'pending_principal_approval',
      principalUserId: clientAdminB,
    });
  });

  it('client A list is implicitly scoped — a clientId=B filter cannot escape it', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions?clientId=${clientB}`,
      headers: await harness.bearer(principalA),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { clientId: string }[] }>();
    expect(data.length).toBeGreaterThan(0);
    for (const row of data) {
      expect(row.clientId).toBe(clientA);
    }
  });

  it("GET /requisitions/:idB from client A → never data", async () => {
    await expectTenantIsolated(harness.app, {
      url: `/api/v1/requisitions/${requisitionB}`,
      headers: await harness.bearer(principalA),
    });
  });

  it("POST /requisitions/:idB/principal-approve from client A → never data", async () => {
    await expectTenantIsolated(harness.app, {
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionB}/principal-approve`,
      headers: await harness.bearer(principalA),
    });
  });

  it("POST /requisitions/:idB/principal-request-changes from client A → never data", async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionB}/principal-request-changes`,
      headers: await harness.bearer(principalA),
      payload: { comment: 'cross-tenant attempt' },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.json<{ data?: unknown }>().data).toBeUndefined();
    const rows = await db.sql<{ status: string }[]>`
      select status from requisitions where id = ${requisitionB}
    `;
    expect(rows[0]!.status).toBe('pending_principal_approval');
  });
});
