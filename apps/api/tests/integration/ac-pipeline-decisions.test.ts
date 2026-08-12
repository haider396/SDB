/**
 * Phase P4 — client decisions, rejections, and the placement transaction
 * (docs/07-ACCEPTANCE-CRITERIA.md §8):
 *
 * AC-PL-09 — a client rejection writes actor = 'client' and rejected_by =
 *            the calling user, regardless of any actor value in the body
 *            (actor-spoof attempt)
 * AC-PL-10 — an admin rejection writes actor = 'admin'
 * AC-PL-11 — a rejection without reasonId or reasonOther is rejected by the
 *            DB constraint AND by the API (422)
 * AC-PL-13 — POST /assignments/:id/place creates the placement, moves the
 *            assignment and requisition to placed, sets siblings to
 *            closed_not_selected, and sets candidate pool_status = 'placed'
 *            — all or nothing, with a rollback case
 *
 * Plus: approve-for-interview, request-interview, the client_decision_recorded
 * notifications, placements list/get/patch, and tenant isolation.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssignmentStage } from '@sdb/contracts';
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
  expectPgError,
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
let clientUserA: string;
let clientAdminB: string;
let clientReasonId: string;
let adminReasonId: string;

beforeAll(async () => {
  db = await freshDb();
  superAdmin = await insertUser(db.sql);
  await assignRole(db.sql, superAdmin, 'super_admin');
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  clientA = await insertClient(db.sql, { companyName: 'Decisions Tenant A' });
  clientB = await insertClient(db.sql, { companyName: 'Decisions Tenant B' });

  clientAdminA = await insertUser(db.sql);
  await assignRole(db.sql, clientAdminA, 'client_admin', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientAdminA });

  clientUserA = await insertUser(db.sql);
  await assignRole(db.sql, clientUserA, 'client_user', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientUserA });

  clientAdminB = await insertUser(db.sql);
  await assignRole(db.sql, clientAdminB, 'client_admin', clientB);
  await insertClientMember(db.sql, { clientId: clientB, userId: clientAdminB });

  const reasons = await db.sql<{ id: string; actor: string }[]>`
    select id, actor::text as actor from rejection_reasons
    where key in ('culture_fit', 'failed_vetting')
  `;
  clientReasonId = reasons.find((row) => row.actor === 'client')!.id;
  adminReasonId = reasons.find((row) => row.actor === 'admin')!.id;

  harness = await buildTestApp(db);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

async function seedAssignment(opts: {
  stage?: AssignmentStage;
  clientId?: string;
  status?: string;
} = {}): Promise<{ requisitionId: string; candidateId: string; assignmentId: string }> {
  const requisitionId = await insertRequisition(db.sql, {
    clientId: opts.clientId ?? clientA,
    status: opts.status ?? 'candidates_presented',
  });
  const candidateId = await insertCandidate(db.sql, { hasConsent: true });
  const assignmentId = await insertAssignment(db.sql, {
    requisitionId,
    candidateId,
    assignedBy: admin,
    stage: opts.stage ?? 'presented',
  });
  return { requisitionId, candidateId, assignmentId };
}

async function fetchAssignment(assignmentId: string) {
  const rows = await db.sql<
    { stage: string; client_decision_at: Date | null }[]
  >`
    select stage::text as stage, client_decision_at
    from assignments where id = ${assignmentId}
  `;
  return rows[0]!;
}

describe('AC-PL-09 — client rejection: actor derived, spoof ignored', () => {
  it('writes actor = client and rejected_by = the caller despite a spoofed body', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/reject`,
      headers: await harness.bearer(clientUserA),
      payload: {
        reasonId: clientReasonId,
        detail: 'Not the right profile',
        // Spoof attempt — the schema strips these before the handler runs.
        actor: 'admin',
        rejectedBy: admin,
      },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { stage: string } }>();
    expect(data.stage).toBe('rejected_by_client');

    const rejections = await db.sql<
      { actor: string; rejected_by: string; reason_id: string | null }[]
    >`
      select actor::text as actor, rejected_by, reason_id
      from rejections where assignment_id = ${assignmentId}
    `;
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.actor).toBe('client');
    expect(rejections[0]?.rejected_by).toBe(clientUserA);
    expect(rejections[0]?.reason_id).toBe(clientReasonId);

    const row = await fetchAssignment(assignmentId);
    expect(row.stage).toBe('rejected_by_client');
    expect(row.client_decision_at).not.toBeNull();

    // client_decision_recorded queued for every active admin.
    const notifications = await db.sql<{ recipient_user_id: string | null }[]>`
      select recipient_user_id from notification_log
      where event = 'client_decision_recorded' and entity_id = ${assignmentId}
    `;
    expect(notifications.map((r) => r.recipient_user_id).sort()).toEqual(
      [superAdmin, admin].sort(),
    );
  });

  it('the response is the client-visible view shape (rejected_by_client is visible)', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/reject`,
      headers: await harness.bearer(clientAdminA),
      payload: { reasonOther: 'Went a different direction' },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown> }>();
    expect(data['stage']).toBe('rejected_by_client');
    expect(data).not.toHaveProperty('adminNote');
    expect(data).not.toHaveProperty('candidate');
    expect(data['lastName']).toBeNull(); // still PII-gated
  });

  it('a client cannot reject from a PII-locked late stage the machine forbids (interview_scheduled)', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'interview_scheduled' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/reject`,
      headers: await harness.bearer(clientAdminA),
      payload: { reasonId: clientReasonId },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INVALID_TRANSITION');
  });

  it('a client cannot reject an internal-stage assignment (404, invisible)', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'vetted' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/reject`,
      headers: await harness.bearer(clientAdminA),
      payload: { reasonId: clientReasonId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a client-side rejection may not use an admin-side reason', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/reject`,
      headers: await harness.bearer(clientAdminA),
      payload: { reasonId: adminReasonId },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('AC-PL-10 — admin rejection', () => {
  it('writes actor = admin and moves to rejected_by_admin, from an internal stage', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'screened' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/reject`,
      headers: await harness.bearer(admin),
      payload: { reasonId: adminReasonId, actor: 'client' },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { stage: string; adminNote: unknown } }>();
    expect(data.stage).toBe('rejected_by_admin');
    // Admin actor gets the admin row back.
    expect(data).toHaveProperty('adminNote');

    const rejections = await db.sql<{ actor: string; rejected_by: string }[]>`
      select actor::text as actor, rejected_by
      from rejections where assignment_id = ${assignmentId}
    `;
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.actor).toBe('admin');
    expect(rejections[0]?.rejected_by).toBe(admin);

    // Admin decisions do NOT fire client_decision_recorded.
    const notifications = await db.sql<{ n: string }[]>`
      select count(*)::text as n from notification_log
      where event = 'client_decision_recorded' and entity_id = ${assignmentId}
    `;
    expect(notifications[0]?.n).toBe('0');
  });
});

describe('AC-PL-11 — rejection requires a reason (API and DB constraint)', () => {
  it('API: neither reasonId nor reasonOther → 422 VALIDATION_FAILED, nothing written', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/reject`,
      headers: await harness.bearer(clientAdminA),
      payload: { detail: 'no reason given' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_FAILED');
    expect((await fetchAssignment(assignmentId)).stage).toBe('presented');
    const rejections = await db.sql<{ n: string }[]>`
      select count(*)::text as n from rejections where assignment_id = ${assignmentId}
    `;
    expect(rejections[0]?.n).toBe('0');
  });

  it('DB: chk_reason_present rejects a reasonless row (23514)', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    await expectPgError(
      db.sql`
        insert into rejections (assignment_id, actor, rejected_by)
        values (${assignmentId}, 'client', ${clientAdminA})
      `,
      '23514',
    );
  });
});

describe('approve-for-interview (J6)', () => {
  it('moves presented → client_reviewing, stamps client_decision_at, notifies admins', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/approve-for-interview`,
      headers: await harness.bearer(clientUserA),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: Record<string, unknown> }>();
    expect(data['stage']).toBe('client_reviewing');
    expect(data['lastName']).toBeNull(); // PII still locked at client_reviewing
    expect(data).not.toHaveProperty('adminNote');

    const row = await fetchAssignment(assignmentId);
    expect(row.stage).toBe('client_reviewing');
    expect(row.client_decision_at).not.toBeNull();

    const events = await db.sql<{ n: string }[]>`
      select count(*)::text as n from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'stage_changed' and to_value = 'client_reviewing'
        and actor_id = ${clientUserA}
    `;
    expect(events[0]?.n).toBe('1');

    const notifications = await db.sql<{ recipient_user_id: string | null }[]>`
      select recipient_user_id from notification_log
      where event = 'client_decision_recorded' and entity_id = ${assignmentId}
    `;
    expect(notifications.map((r) => r.recipient_user_id).sort()).toEqual(
      [superAdmin, admin].sort(),
    );
  });

  it('is a client-only surface: an admin caller gets 404', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/approve-for-interview`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(404);
  });

  it('approving twice → 409 INVALID_TRANSITION', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/approve-for-interview`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('request-interview (04 §9)', () => {
  it('notifies admins with decision = interview_requested; no stage change, no interview row', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/request-interview`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { stage: string } }>().data.stage).toBe('presented');
    expect((await fetchAssignment(assignmentId)).stage).toBe('presented');

    const interviews = await db.sql<{ n: string }[]>`
      select count(*)::text as n from interviews where assignment_id = ${assignmentId}
    `;
    expect(interviews[0]?.n).toBe('0');

    const notifications = await db.sql<{ payload: { context?: { decision?: string } } }[]>`
      select payload from notification_log
      where event = 'client_decision_recorded' and entity_id = ${assignmentId}
    `;
    expect(notifications).toHaveLength(2); // both active admins
    for (const row of notifications) {
      expect(row.payload.context?.decision).toBe('interview_requested');
    }

    const events = await db.sql<{ n: string }[]>`
      select count(*)::text as n from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'interview_requested'
    `;
    expect(events[0]?.n).toBe('1');
  });

  it('is a client-only surface: an admin caller gets 404', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/request-interview`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('AC-PL-13 — the placement transaction', () => {
  interface PlacementFixture {
    requisitionId: string;
    candidateId: string;
    assignmentId: string;
    siblingPresented: string;
    siblingVetted: string;
    siblingRejected: string;
  }

  /** offer_extended requisition, target at offer, three siblings. */
  async function seedPlacementScenario(): Promise<PlacementFixture> {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'offer_extended',
    });
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const assignmentId = await insertAssignment(db.sql, {
      requisitionId, candidateId, assignedBy: admin, stage: 'offer',
    });
    const siblingPresented = await insertAssignment(db.sql, {
      requisitionId,
      candidateId: await insertCandidate(db.sql, { hasConsent: true }),
      assignedBy: admin,
      stage: 'presented',
    });
    const siblingVetted = await insertAssignment(db.sql, {
      requisitionId,
      candidateId: await insertCandidate(db.sql, { hasConsent: true }),
      assignedBy: admin,
      stage: 'vetted',
    });
    const siblingRejected = await insertAssignment(db.sql, {
      requisitionId,
      candidateId: await insertCandidate(db.sql, { hasConsent: true }),
      assignedBy: admin,
      stage: 'rejected_by_client',
    });
    return {
      requisitionId, candidateId, assignmentId,
      siblingPresented, siblingVetted, siblingRejected,
    };
  }

  it('creates the placement and performs every documented write', async () => {
    const fx = await seedPlacementScenario();
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${fx.assignmentId}/place`,
      headers: await harness.bearer(admin),
      payload: {
        startDate: '2026-09-01',
        rateAmount: 2500,
        rateUnit: 'monthly',
        rateCurrency: 'USD',
        hoursPerWeek: 40,
        serviceTier: 'handheld_six_month',
        guaranteeEndDate: '2027-03-01',
      },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json<{
      data: {
        id: string; assignmentId: string; candidateId: string; clientId: string;
        requisitionId: string; startDate: string; rateAmount: number | null;
        rateUnit: string | null; rateCurrency: string | null; hoursPerWeek: number | null;
        serviceTier: string | null; guaranteeEndDate: string | null; status: string;
      };
    }>();
    expect(data.assignmentId).toBe(fx.assignmentId);
    expect(data.candidateId).toBe(fx.candidateId);
    expect(data.clientId).toBe(clientA);
    expect(data.requisitionId).toBe(fx.requisitionId);
    expect(data.startDate).toBe('2026-09-01');
    expect(data.rateAmount).toBe(2500);
    expect(data.rateUnit).toBe('monthly');
    expect(data.rateCurrency).toBe('USD');
    expect(data.hoursPerWeek).toBe(40);
    expect(data.serviceTier).toBe('handheld_six_month');
    expect(data.guaranteeEndDate).toBe('2027-03-01');
    expect(data.status).toBe('active');

    // assignment → placed
    const stages = await db.sql<{ id: string; stage: string }[]>`
      select id, stage::text as stage from assignments
      where requisition_id = ${fx.requisitionId}
    `;
    const stageById = new Map(stages.map((row) => [row.id, row.stage]));
    expect(stageById.get(fx.assignmentId)).toBe('placed');
    // non-terminal siblings → closed_not_selected
    expect(stageById.get(fx.siblingPresented)).toBe('closed_not_selected');
    expect(stageById.get(fx.siblingVetted)).toBe('closed_not_selected');
    // terminal sibling untouched
    expect(stageById.get(fx.siblingRejected)).toBe('rejected_by_client');

    // requisition → placed, closed_at stamped
    const req = await db.sql<{ status: string; closed_at: Date | null }[]>`
      select status::text as status, closed_at from requisitions where id = ${fx.requisitionId}
    `;
    expect(req[0]?.status).toBe('placed');
    expect(req[0]?.closed_at).not.toBeNull();

    // candidate pool_status → placed
    const pool = await db.sql<{ pool_status: string }[]>`
      select pool_status::text as pool_status from candidates where id = ${fx.candidateId}
    `;
    expect(pool[0]?.pool_status).toBe('placed');

    // events: stage change for target + each closed sibling, requisition
    // status change, placement_created, pool_status_changed
    const placedEvents = await db.sql<{ n: string }[]>`
      select count(*)::text as n from events
      where entity_type = 'assignment' and entity_id = ${fx.assignmentId}
        and event_type = 'stage_changed' and to_value = 'placed' and actor_id = ${admin}
    `;
    expect(placedEvents[0]?.n).toBe('1');
    for (const sibling of [fx.siblingPresented, fx.siblingVetted]) {
      const siblingEvents = await db.sql<{ n: string }[]>`
        select count(*)::text as n from events
        where entity_type = 'assignment' and entity_id = ${sibling}
          and event_type = 'stage_changed' and to_value = 'closed_not_selected'
          and actor_id = ${admin}
      `;
      expect(siblingEvents[0]?.n).toBe('1');
    }
    const reqEvents = await db.sql<{ n: string }[]>`
      select count(*)::text as n from events
      where entity_type = 'requisition' and entity_id = ${fx.requisitionId}
        and event_type = 'status_changed' and to_value = 'placed' and actor_id = ${admin}
    `;
    expect(reqEvents[0]?.n).toBe('1');
    const placementEvents = await db.sql<{ n: string }[]>`
      select count(*)::text as n from events
      where entity_type = 'assignment' and entity_id = ${fx.assignmentId}
        and event_type = 'placement_created'
    `;
    expect(placementEvents[0]?.n).toBe('1');
    const poolEvents = await db.sql<{ n: string }[]>`
      select count(*)::text as n from events
      where entity_type = 'candidate' and entity_id = ${fx.candidateId}
        and event_type = 'pool_status_changed' and to_value = 'placed'
    `;
    expect(poolEvents[0]?.n).toBe('1');
  });

  it('rolls back EVERY write when a mid-transaction step fails', async () => {
    const fx = await seedPlacementScenario();
    // Force the placement insert (a mid-transaction step, after the
    // assignment stage write) to fail: occupy the unique assignment_id slot.
    await db.sql`
      insert into placements (assignment_id, candidate_id, client_id, requisition_id, start_date)
      values (${fx.assignmentId}, ${fx.candidateId}, ${clientA}, ${fx.requisitionId}, '2026-01-01')
    `;
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${fx.assignmentId}/place`,
      headers: await harness.bearer(admin),
      payload: { startDate: '2026-09-01' },
    });
    expect(res.statusCode).toBe(500);

    // Nothing moved: the stage write that preceded the failure rolled back.
    const stages = await db.sql<{ id: string; stage: string }[]>`
      select id, stage::text as stage from assignments
      where requisition_id = ${fx.requisitionId}
    `;
    const stageById = new Map(stages.map((row) => [row.id, row.stage]));
    expect(stageById.get(fx.assignmentId)).toBe('offer');
    expect(stageById.get(fx.siblingPresented)).toBe('presented');
    expect(stageById.get(fx.siblingVetted)).toBe('vetted');
    const req = await db.sql<{ status: string }[]>`
      select status::text as status from requisitions where id = ${fx.requisitionId}
    `;
    expect(req[0]?.status).toBe('offer_extended');
    const pool = await db.sql<{ pool_status: string }[]>`
      select pool_status::text as pool_status from candidates where id = ${fx.candidateId}
    `;
    expect(pool[0]?.pool_status).toBe('active');
    const placements = await db.sql<{ n: string }[]>`
      select count(*)::text as n from placements
      where assignment_id = ${fx.assignmentId} and start_date = '2026-09-01'
    `;
    expect(placements[0]?.n).toBe('0');
  });

  it('placing from a non-offer stage → 409; requisition not offer_extended → 409', async () => {
    const wrongStage = await seedAssignment({ stage: 'presented', status: 'offer_extended' });
    const stageRes = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${wrongStage.assignmentId}/place`,
      headers: await harness.bearer(admin),
      payload: { startDate: '2026-09-01' },
    });
    expect(stageRes.statusCode).toBe(409);
    expect(stageRes.json<{ error: { details: { from: string; to: string } } }>().error.details)
      .toMatchObject({ from: 'presented', to: 'placed' });

    const wrongStatus = await seedAssignment({ stage: 'offer', status: 'sourcing' });
    const statusRes = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${wrongStatus.assignmentId}/place`,
      headers: await harness.bearer(admin),
      payload: { startDate: '2026-09-01' },
    });
    expect(statusRes.statusCode).toBe(409);
    expect(statusRes.json<{ error: { details: { from: string; to: string } } }>().error.details)
      .toMatchObject({ from: 'sourcing', to: 'placed' });
  });
});

describe('placements endpoints (04 §11)', () => {
  let placementA: string;

  beforeAll(async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA, status: 'offer_extended',
    });
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const assignmentId = await insertAssignment(db.sql, {
      requisitionId, candidateId, assignedBy: admin, stage: 'offer',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/place`,
      headers: await harness.bearer(admin),
      payload: { startDate: '2026-10-01', rateAmount: 3000, rateUnit: 'monthly' },
    });
    expect(res.statusCode).toBe(201);
    placementA = res.json<{ data: { id: string } }>().data.id;
  });

  it('GET /placements: admin sees all; a client sees only their own', async () => {
    const asAdmin = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/placements',
      headers: await harness.bearer(admin),
    });
    expect(asAdmin.statusCode).toBe(200);
    const adminRows = asAdmin.json<{ data: { id: string }[] }>().data;
    expect(adminRows.map((row) => row.id)).toContain(placementA);

    const asClientA = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/placements',
      headers: await harness.bearer(clientAdminA),
    });
    expect(asClientA.statusCode).toBe(200);
    const aRows = asClientA.json<{ data: { id: string; clientId: string }[] }>().data;
    expect(aRows.map((row) => row.id)).toContain(placementA);
    for (const row of aRows) expect(row.clientId).toBe(clientA);

    // The clientId filter is admin-only: B asking for A's rows still gets B's.
    const asClientB = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/placements?clientId=${clientA}`,
      headers: await harness.bearer(clientAdminB),
    });
    expect(asClientB.statusCode).toBe(200);
    expect(
      asClientB.json<{ data: { id: string }[] }>().data.map((row) => row.id),
    ).not.toContain(placementA);
  });

  it('GET /placements/:id: own client 200; cross-tenant isolated', async () => {
    const own = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/placements/${placementA}`,
      headers: await harness.bearer(clientAdminA),
    });
    expect(own.statusCode).toBe(200);

    await expectTenantIsolated(harness.app, {
      url: `/api/v1/placements/${placementA}`,
      headers: await harness.bearer(clientAdminB),
    });
  });

  it('PATCH /placements/:id: admin updates and an event is written; clients are denied', async () => {
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/placements/${placementA}`,
      headers: await harness.bearer(admin),
      payload: { status: 'completed', endDate: '2027-03-31' },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { status: string; endDate: string | null; assignmentId: string } }>();
    expect(data.status).toBe('completed');
    expect(data.endDate).toBe('2027-03-31');

    const events = await db.sql<{ n: string }[]>`
      select count(*)::text as n from events
      where entity_type = 'assignment' and entity_id = ${data.assignmentId}
        and event_type = 'placement_updated'
    `;
    expect(events[0]?.n).toBe('1');

    // client.update is not held by client roles → 403 by the guard.
    const asClient = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/placements/${placementA}`,
      headers: await harness.bearer(clientAdminA),
      payload: { status: 'active' },
    });
    expect(asClient.statusCode).toBe(403);
  });

  it('a ghost placement id → 404', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/placements/${randomUUID()}`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('tenant isolation — decision actions from the wrong tenant', () => {
  it('client B cannot reject client A’s presented assignment', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/reject`,
      headers: await harness.bearer(clientAdminB),
      payload: { reasonId: clientReasonId },
    });
    expect(res.statusCode).toBe(404);
    expect((await fetchAssignment(assignmentId)).stage).toBe('presented');
  });

  it('client B cannot approve client A’s assignment for interview', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    await expectTenantIsolated(harness.app, {
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/approve-for-interview`,
      headers: await harness.bearer(clientAdminB),
    });
    expect((await fetchAssignment(assignmentId)).stage).toBe('presented');
  });
});
