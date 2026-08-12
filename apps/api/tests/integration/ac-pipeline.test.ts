/**
 * Phase P4 — assignments, stage machine, present, and the gated PII view
 * (docs/07-ACCEPTANCE-CRITERIA.md §8):
 *
 * AC-PL-01 — every valid stage transition succeeds and writes an event;
 *            every invalid one returns 409 (parameterised over the machine)
 * AC-PL-02 — the same candidate sits at different stages on two requisitions
 * AC-PL-03 — repeat assignment → 409 DUPLICATE_ASSIGNMENT
 * AC-PL-04 — do_not_present_to_client_ids blocks assignment to that client
 * AC-PL-05 — present without consent → 422 CONSENT_MISSING, presents NONE
 * AC-PL-06 — present sets presented_at, moves the requisition, queues one
 *            notification per client user
 * AC-PL-07 — a client listing never contains the five hidden stages
 *            (all 13 seeded)
 * AC-PL-08 — the six gated fields are null at presented and real at
 *            interview_scheduled — and nothing else changes
 *
 * Plus: PATCH /assignments/:id semantics, admin/client response shapes, and
 * AC-AUTH-05 tenant isolation for every client-facing pipeline endpoint.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssignmentStage } from '@sdb/contracts';
import {
  AssignmentStageSchema,
  CLIENT_VISIBLE_STAGES,
  GATED_PII_FIELDS,
} from '@sdb/contracts';
import { ASSIGNMENT_TRANSITIONS } from '../../src/services/state-machines.js';
import {
  assignRole,
  insertAssignment,
  insertCandidate,
  insertClient,
  insertClientMember,
  insertRequisition,
  insertUser,
} from './fixtures.js';
import {
  buildTestApp,
  expectTenantIsolated,
  freshDb,
  type TestApp,
  type TestDb,
} from './harness.js';

const ALL_STAGES = AssignmentStageSchema.options;

const VALID_PAIRS: [AssignmentStage, AssignmentStage][] = (
  Object.keys(ASSIGNMENT_TRANSITIONS) as AssignmentStage[]
).flatMap((from) =>
  ASSIGNMENT_TRANSITIONS[from].map(
    (to) => [from, to] as [AssignmentStage, AssignmentStage],
  ),
);

const INVALID_PAIRS: [AssignmentStage, AssignmentStage][] = (
  Object.keys(ASSIGNMENT_TRANSITIONS) as AssignmentStage[]
).flatMap((from) =>
  ALL_STAGES.filter((to) => !ASSIGNMENT_TRANSITIONS[from].includes(to)).map(
    (to) => [from, to] as [AssignmentStage, AssignmentStage],
  ),
);

let db: TestDb;
let harness: TestApp;
let admin: string;
let clientA: string;
let clientB: string;
let clientAdminA: string;
let clientUserA: string;
let clientAdminB: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  clientA = await insertClient(db.sql, { companyName: 'Pipeline Tenant A' });
  clientB = await insertClient(db.sql, { companyName: 'Pipeline Tenant B' });

  clientAdminA = await insertUser(db.sql);
  await assignRole(db.sql, clientAdminA, 'client_admin', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientAdminA });

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

/** requisition (sourcing, client A unless told otherwise) + consented candidate + assignment. */
async function seedAssignment(opts: {
  stage?: AssignmentStage;
  clientId?: string;
  hasConsent?: boolean;
  status?: string;
} = {}): Promise<{ requisitionId: string; candidateId: string; assignmentId: string }> {
  const requisitionId = await insertRequisition(db.sql, {
    clientId: opts.clientId ?? clientA,
    status: opts.status ?? 'sourcing',
  });
  const candidateId = await insertCandidate(db.sql, {
    hasConsent: opts.hasConsent ?? true,
  });
  const assignmentId = await insertAssignment(db.sql, {
    requisitionId,
    candidateId,
    assignedBy: admin,
    stage: opts.stage ?? 'sourced',
  });
  return { requisitionId, candidateId, assignmentId };
}

async function assignmentStage(assignmentId: string): Promise<string> {
  const rows = await db.sql<{ stage: string }[]>`
    select stage::text as stage from assignments where id = ${assignmentId}
  `;
  return rows[0]?.stage ?? 'MISSING';
}

describe('AC-PL-01 — assignment stage machine, full adjacency', () => {
  it.each(VALID_PAIRS)('%s → %s succeeds and writes an event', async (from, to) => {
    const { assignmentId, candidateId, requisitionId } = await seedAssignment({
      stage: from,
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/advance`,
      headers: await harness.bearer(admin),
      payload: { toStage: to, note: 'machine sweep' },
    });
    expect(res.statusCode, `${from} → ${to}`).toBe(200);
    const { data } = res.json<{ data: { stage: string; candidateId: string } }>();
    expect(data.stage).toBe(to);
    expect(data.candidateId).toBe(candidateId);
    expect(await assignmentStage(assignmentId)).toBe(to);

    // The app-sourced event (with actor) — the trigger backstop may add one.
    const events = await db.sql<{ actor_id: string | null }[]>`
      select actor_id from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'stage_changed'
        and from_value = ${from} and to_value = ${to}
        and actor_id is not null
    `;
    expect(events.length, `event for ${from} → ${to}`).toBe(1);
    expect(events[0]?.actor_id).toBe(admin);
    void requisitionId;
  });

  // Invalid pairs share one assignment per from-stage: a rejected transition
  // must not change state, so the fixture can absorb every bad target.
  const fromStages = [...new Set(INVALID_PAIRS.map(([from]) => from))];
  it.each(fromStages)('every invalid transition out of %s → 409 with details', async (from) => {
    const { assignmentId } = await seedAssignment({ stage: from });
    const targets = INVALID_PAIRS.filter(([f]) => f === from).map(([, to]) => to);
    for (const to of targets) {
      const res = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/assignments/${assignmentId}/advance`,
        headers: await harness.bearer(admin),
        payload: { toStage: to },
      });
      expect(res.statusCode, `${from} → ${to} must be rejected`).toBe(409);
      const body = res.json<{
        error: { code: string; details: { from: string; to: string } };
      }>();
      expect(body.error.code).toBe('INVALID_TRANSITION');
      expect(body.error.details).toMatchObject({ from, to });
      expect(await assignmentStage(assignmentId)).toBe(from);
    }
  });

  it('advance into presented without consent → 422 CONSENT_MISSING (the gate holds on every path)', async () => {
    const { assignmentId } = await seedAssignment({
      stage: 'vetted',
      hasConsent: false,
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/advance`,
      headers: await harness.bearer(admin),
      payload: { toStage: 'presented' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('CONSENT_MISSING');
    expect(await assignmentStage(assignmentId)).toBe('vetted');
  });
});

describe('AC-PL-02 — one candidate, two requisitions, two stages', () => {
  it('the same candidate sits at different stages simultaneously', async () => {
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const reqOne = await insertRequisition(db.sql, { clientId: clientA, status: 'sourcing' });
    const reqTwo = await insertRequisition(db.sql, { clientId: clientB, status: 'sourcing' });
    for (const requisitionId of [reqOne, reqTwo]) {
      const res = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/requisitions/${requisitionId}/assignments`,
        headers: await harness.bearer(admin),
        payload: { candidateIds: [candidateId] },
      });
      expect(res.statusCode).toBe(201);
    }
    const rows = await db.sql<{ id: string; requisition_id: string }[]>`
      select id, requisition_id from assignments where candidate_id = ${candidateId}
    `;
    expect(rows).toHaveLength(2);
    const onReqOne = rows.find((row) => row.requisition_id === reqOne);
    expect(onReqOne).toBeDefined();

    const advance = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${onReqOne!.id}/advance`,
      headers: await harness.bearer(admin),
      payload: { toStage: 'screened' },
    });
    expect(advance.statusCode).toBe(200);

    const stages = await db.sql<{ requisition_id: string; stage: string }[]>`
      select requisition_id, stage::text as stage
      from assignments where candidate_id = ${candidateId}
    `;
    const byReq = new Map(stages.map((row) => [row.requisition_id, row.stage]));
    expect(byReq.get(reqOne)).toBe('screened');
    expect(byReq.get(reqTwo)).toBe('sourced');
  });
});

describe('AC-PL-03 — duplicate assignment', () => {
  it('assigning the same candidate twice to one requisition → 409 DUPLICATE_ASSIGNMENT', async () => {
    const { requisitionId, candidateId } = await seedAssignment();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers: await harness.bearer(admin),
      payload: { candidateIds: [candidateId] },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: { code: string; details?: { candidateIds?: string[] } } }>();
    expect(body.error.code).toBe('DUPLICATE_ASSIGNMENT');
    expect(body.error.details?.candidateIds).toContain(candidateId);
  });

  it('a batch containing one duplicate creates nothing (all-or-nothing)', async () => {
    const { requisitionId, candidateId } = await seedAssignment();
    const freshCandidate = await insertCandidate(db.sql, { hasConsent: true });
    const before = await db.sql<{ n: string }[]>`
      select count(*)::text as n from assignments where requisition_id = ${requisitionId}
    `;
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers: await harness.bearer(admin),
      payload: { candidateIds: [freshCandidate, candidateId] },
    });
    expect(res.statusCode).toBe(409);
    const after = await db.sql<{ n: string }[]>`
      select count(*)::text as n from assignments where requisition_id = ${requisitionId}
    `;
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('AC-PL-04 — do_not_present_to_client_ids', () => {
  it('blocks assignment to the listed client with per-candidate detail, allows others', async () => {
    const blockedCandidate = await insertCandidate(db.sql, {
      hasConsent: true,
      doNotPresentToClientIds: [clientA],
    });
    const reqA = await insertRequisition(db.sql, { clientId: clientA, status: 'sourcing' });
    const denied = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${reqA}/assignments`,
      headers: await harness.bearer(admin),
      payload: { candidateIds: [blockedCandidate] },
    });
    expect(denied.statusCode).toBe(422);
    const body = denied.json<{
      error: {
        code: string;
        details: { blockedCandidates: { candidateId: string; reason: string }[] };
      };
    }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.blockedCandidates).toEqual([
      { candidateId: blockedCandidate, reason: 'do_not_present_to_client' },
    ]);

    const reqB = await insertRequisition(db.sql, { clientId: clientB, status: 'sourcing' });
    const allowed = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${reqB}/assignments`,
      headers: await harness.bearer(admin),
      payload: { candidateIds: [blockedCandidate] },
    });
    expect(allowed.statusCode).toBe(201);
  });
});

describe('POST /requisitions/:id/assignments — creation semantics', () => {
  it('creates at sourced, writes an assigned event, returns the admin row shape', async () => {
    const requisitionId = await insertRequisition(db.sql, { clientId: clientA, status: 'sourcing' });
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers: await harness.bearer(admin),
      payload: { candidateIds: [candidateId], adminNote: 'sourced via referral' },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json<{
      data: {
        id: string;
        stage: string;
        adminNote: string | null;
        assignedBy: string;
        candidate: { id: string; firstName: string; hasConsentToShareProfile: boolean };
      }[];
    }>();
    expect(data).toHaveLength(1);
    expect(data[0]?.stage).toBe('sourced');
    expect(data[0]?.adminNote).toBe('sourced via referral');
    expect(data[0]?.assignedBy).toBe(admin);
    expect(data[0]?.candidate.id).toBe(candidateId);

    const events = await db.sql<{ to_value: string | null }[]>`
      select to_value from events
      where entity_type = 'assignment' and entity_id = ${data[0]!.id}
        and event_type = 'assigned'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]?.to_value).toBe('sourced');
  });

  it('a nonexistent candidate → 404 with the missing ids', async () => {
    const requisitionId = await insertRequisition(db.sql, { clientId: clientA, status: 'sourcing' });
    const ghost = randomUUID();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers: await harness.bearer(admin),
      payload: { candidateIds: [ghost] },
    });
    expect(res.statusCode).toBe(404);
    expect(
      res.json<{ error: { details?: { candidateIds?: string[] } } }>().error.details
        ?.candidateIds,
    ).toContain(ghost);
  });

  it('client-scoped callers cannot assign (candidate.assign denied → 403)', async () => {
    const requisitionId = await insertRequisition(db.sql, { clientId: clientA, status: 'sourcing' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers: await harness.bearer(clientAdminA),
      payload: { candidateIds: [randomUUID()] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('AC-PL-05 — present is all-or-nothing on consent', () => {
  it('one candidate without consent → 422 CONSENT_MISSING listing offenders, NONE presented', async () => {
    const requisitionId = await insertRequisition(db.sql, { clientId: clientA, status: 'sourcing' });
    const consented = await insertCandidate(db.sql, { hasConsent: true });
    const unconsented = await insertCandidate(db.sql, { hasConsent: false });
    const okAssignment = await insertAssignment(db.sql, {
      requisitionId, candidateId: consented, assignedBy: admin, stage: 'vetted',
    });
    const badAssignment = await insertAssignment(db.sql, {
      requisitionId, candidateId: unconsented, assignedBy: admin, stage: 'vetted',
    });

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assignments/present',
      headers: await harness.bearer(admin),
      payload: { assignmentIds: [okAssignment, badAssignment] },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{
      error: { code: string; details: { candidateIds: string[] } };
    }>();
    expect(body.error.code).toBe('CONSENT_MISSING');
    expect(body.error.details.candidateIds).toEqual([unconsented]);

    // Atomicity: NOTHING moved.
    expect(await assignmentStage(okAssignment)).toBe('vetted');
    expect(await assignmentStage(badAssignment)).toBe('vetted');
    const req = await db.sql<{ status: string }[]>`
      select status::text as status from requisitions where id = ${requisitionId}
    `;
    expect(req[0]?.status).toBe('sourcing');
    const notifications = await db.sql<{ n: string }[]>`
      select count(*)::text as n from notification_log
      where event = 'candidates_presented' and entity_id = ${requisitionId}
    `;
    expect(notifications[0]?.n).toBe('0');
  });

  it('present from a non-vetted stage → 409 INVALID_TRANSITION', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'sourced' });
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assignments/present',
      headers: await harness.bearer(admin),
      payload: { assignmentIds: [assignmentId] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INVALID_TRANSITION');
  });

  it('present while the requisition is submitted → 409 INVALID_TRANSITION', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'vetted', status: 'submitted' });
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assignments/present',
      headers: await harness.bearer(admin),
      payload: { assignmentIds: [assignmentId] },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: { details: { from: string; to: string } } }>();
    expect(body.error.details).toMatchObject({
      from: 'submitted',
      to: 'candidates_presented',
    });
  });
});

describe('AC-PL-06 — present side effects', () => {
  it('sets presented_at/by, moves the requisition, queues ONE notification per client user, in one action', async () => {
    const requisitionId = await insertRequisition(db.sql, { clientId: clientA, status: 'sourcing' });
    const one = await insertCandidate(db.sql, { hasConsent: true });
    const two = await insertCandidate(db.sql, { hasConsent: true });
    const assignmentOne = await insertAssignment(db.sql, {
      requisitionId, candidateId: one, assignedBy: admin, stage: 'vetted',
    });
    const assignmentTwo = await insertAssignment(db.sql, {
      requisitionId, candidateId: two, assignedBy: admin, stage: 'vetted',
    });

    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assignments/present',
      headers: await harness.bearer(admin),
      payload: { assignmentIds: [assignmentOne, assignmentTwo], clientNote: 'Two strong profiles' },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{
      data: { id: string; stage: string; presentedAt: string | null; presentedBy: string | null; clientNote: string | null }[];
    }>();
    expect(data).toHaveLength(2);
    for (const row of data) {
      expect(row.stage).toBe('presented');
      expect(row.presentedAt).not.toBeNull();
      expect(row.presentedBy).toBe(admin);
      expect(row.clientNote).toBe('Two strong profiles');
    }

    const req = await db.sql<{ status: string }[]>`
      select status::text as status from requisitions where id = ${requisitionId}
    `;
    expect(req[0]?.status).toBe('candidates_presented');

    // One `candidates_presented` per active client user of A (two seeded).
    const notifications = await db.sql<{ recipient_user_id: string | null }[]>`
      select recipient_user_id from notification_log
      where event = 'candidates_presented' and entity_id = ${requisitionId}
    `;
    expect(notifications.map((row) => row.recipient_user_id).sort()).toEqual(
      [clientAdminA, clientUserA].sort(),
    );

    // One stage event per assignment (app-sourced, with actor).
    for (const assignmentId of [assignmentOne, assignmentTwo]) {
      const events = await db.sql<{ n: string }[]>`
        select count(*)::text as n from events
        where entity_type = 'assignment' and entity_id = ${assignmentId}
          and event_type = 'stage_changed' and to_value = 'presented'
          and actor_id = ${admin}
      `;
      expect(events[0]?.n).toBe('1');
    }
  });

  it('a second batch while already candidates_presented is a status no-op that still presents', async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'candidates_presented',
    });
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const assignmentId = await insertAssignment(db.sql, {
      requisitionId, candidateId, assignedBy: admin, stage: 'vetted',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/assignments/present',
      headers: await harness.bearer(admin),
      payload: { assignmentIds: [assignmentId] },
    });
    expect(res.statusCode).toBe(200);
    expect(await assignmentStage(assignmentId)).toBe('presented');
    const req = await db.sql<{ status: string }[]>`
      select status::text as status from requisitions where id = ${requisitionId}
    `;
    expect(req[0]?.status).toBe('candidates_presented');
  });
});

describe('AC-PL-07 — the presented gate, all 13 stages seeded', () => {
  let requisitionId: string;
  const assignmentByStage = new Map<AssignmentStage, string>();

  beforeAll(async () => {
    requisitionId = await insertRequisition(db.sql, { clientId: clientA, status: 'sourcing' });
    for (const stage of ALL_STAGES) {
      const candidateId = await insertCandidate(db.sql, { hasConsent: true });
      const assignmentId = await insertAssignment(db.sql, {
        requisitionId, candidateId, assignedBy: admin, stage,
      });
      assignmentByStage.set(stage, assignmentId);
    }
  });

  it('a client listing returns exactly the eight client-visible stages', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { stage: string }[] }>();
    expect(data).toHaveLength(CLIENT_VISIBLE_STAGES.length);
    expect([...new Set(data.map((row) => row.stage))].sort()).toEqual(
      [...CLIENT_VISIBLE_STAGES].sort(),
    );
    for (const row of data) {
      expect(
        ['sourced', 'screened', 'vetted', 'rejected_by_admin', 'withdrawn'],
        `hidden stage leaked: ${row.stage}`,
      ).not.toContain(row.stage);
    }
  });

  it('client rows are the view shape — no adminNote, assignedBy, or internal candidate object', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers: await harness.bearer(clientUserA),
    });
    const { data } = res.json<{ data: Record<string, unknown>[] }>();
    for (const row of data) {
      expect(row).not.toHaveProperty('adminNote');
      expect(row).not.toHaveProperty('assignedBy');
      expect(row).not.toHaveProperty('presentedBy');
      expect(row).not.toHaveProperty('candidate');
      expect(row).toHaveProperty('displayName');
      expect(row).toHaveProperty('files');
    }
  });

  it('the admin listing returns all 13 with the internal candidate summary', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { stage: string; adminNote: unknown; candidate: { email: string | null } }[] }>();
    expect(data).toHaveLength(ALL_STAGES.length);
    expect(data[0]).toHaveProperty('adminNote');
    expect(data[0]?.candidate.email).not.toBeNull();
  });

  it('GET /assignments/:id at an internal stage → 404 for a client, 200 for an admin', async () => {
    const internalAssignment = assignmentByStage.get('vetted')!;
    const asClient = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${internalAssignment}`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(asClient.statusCode).toBe(404);

    const asAdmin = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${internalAssignment}`,
      headers: await harness.bearer(admin),
    });
    expect(asAdmin.statusCode).toBe(200);
    expect(asAdmin.json<{ data: { stage: string } }>().data.stage).toBe('vetted');
  });

  it('a rejected_by_admin card simply disappears for the client (404, not a rejection they made)', async () => {
    const rejected = assignmentByStage.get('rejected_by_admin')!;
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${rejected}`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('AC-PL-08 — gated PII unlocks at interview_scheduled, exactly', () => {
  it('six gated fields (plus firstName) are null at presented and real after the transition — nothing else changes', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });

    const before = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${assignmentId}`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(before.statusCode).toBe(200);
    const beforeRow = before.json<{ data: Record<string, unknown> }>().data;
    for (const field of GATED_PII_FIELDS) {
      expect(beforeRow[field], `${field} must be null at presented`).toBeNull();
    }
    expect(beforeRow['firstName'], 'firstName is gated by the view too').toBeNull();
    expect(beforeRow['displayName']).toBeTruthy();

    // Drive presented → client_reviewing → interview_scheduled via advance
    // (interview CREATION is P6; the stage machine is the unlock, 01 §5).
    for (const toStage of ['client_reviewing', 'interview_scheduled'] as const) {
      const res = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/assignments/${assignmentId}/advance`,
        headers: await harness.bearer(admin),
        payload: { toStage },
      });
      expect(res.statusCode).toBe(200);
    }

    const after = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${assignmentId}`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(after.statusCode).toBe(200);
    const afterRow = after.json<{ data: Record<string, unknown> }>().data;
    for (const field of GATED_PII_FIELDS) {
      expect(afterRow[field], `${field} must be real at interview_scheduled`).not.toBeNull();
    }
    expect(afterRow['firstName']).not.toBeNull();

    // The unlock changed EXACTLY the gated set (plus the stage itself):
    // every other field is identical before and after.
    const changed = Object.keys(afterRow)
      .filter((key) => JSON.stringify(afterRow[key]) !== JSON.stringify(beforeRow[key]))
      .sort();
    expect(changed).toEqual(
      [...GATED_PII_FIELDS, 'firstName', 'stage'].sort(),
    );
  });
});

describe('PATCH /assignments/:id — notes and sort order', () => {
  it('updates adminNote, clientNote, sortOrder and writes an event', async () => {
    const { assignmentId } = await seedAssignment();
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/assignments/${assignmentId}`,
      headers: await harness.bearer(admin),
      payload: { adminNote: 'strong CV', clientNote: 'Note for client', sortOrder: 5 },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{
      data: { adminNote: string | null; clientNote: string | null; sortOrder: number };
    }>();
    expect(data.adminNote).toBe('strong CV');
    expect(data.clientNote).toBe('Note for client');
    expect(data.sortOrder).toBe(5);

    const events = await db.sql<{ n: string }[]>`
      select count(*)::text as n from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'assignment_updated'
    `;
    expect(events[0]?.n).toBe('1');
  });

  it('an empty body → 400', async () => {
    const { assignmentId } = await seedAssignment();
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/assignments/${assignmentId}`,
      headers: await harness.bearer(admin),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('AC-AUTH-05 — tenant isolation on the pipeline read surface', () => {
  it('client B can address none of client A’s pipeline', async () => {
    const { requisitionId, assignmentId } = await seedAssignment({ stage: 'presented' });
    const headers = await harness.bearer(clientAdminB);
    await expectTenantIsolated(harness.app, {
      url: `/api/v1/requisitions/${requisitionId}/assignments`,
      headers,
    });
    await expectTenantIsolated(harness.app, {
      url: `/api/v1/assignments/${assignmentId}`,
      headers,
    });
    await expectTenantIsolated(harness.app, {
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/approve-for-interview`,
      headers,
    });
    await expectTenantIsolated(harness.app, {
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/request-interview`,
      headers,
    });
  });

  it('client tokens cannot reach admin pipeline actions (403 by permission)', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'vetted' });
    const headers = await harness.bearer(clientAdminA);
    for (const [method, url, payload] of [
      ['POST', `/api/v1/assignments/${assignmentId}/advance`, { toStage: 'presented' }],
      ['PATCH', `/api/v1/assignments/${assignmentId}`, { sortOrder: 1 }],
      ['POST', '/api/v1/assignments/present', { assignmentIds: [assignmentId] }],
      ['POST', `/api/v1/assignments/${assignmentId}/place`, { startDate: '2026-09-01' }],
      ['GET', `/api/v1/assignments/${assignmentId}/events`, undefined],
    ] as const) {
      const res = await harness.app.inject({
        method,
        url,
        headers,
        ...(payload !== undefined ? { payload } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});
