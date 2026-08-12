/**
 * Phase P6 — interviews (docs/04-API.md §10, docs/01 §3 J7):
 *
 * AC-PL-12 — creating an interview moves the assignment to
 *            interview_scheduled and notifies the client users and the
 *            creating admin; gated PII unlocks — asserted through the client
 *            assignment read flipping from nulls to real values
 *
 * Plus: the stage rules on create (only client_reviewing transitions; later
 * rounds at PII-unlocked stages don't; everything else is 409), round
 * uniqueness (explicit collision → clean 422, raw insert → 23505), schedule
 * updates, outcome recording (advance to interviewed only when no other
 * round is pending; rescheduled never advances), cancel (no stage change),
 * and tenant isolation on the client-facing list.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssignmentStage, ClientVisibleAssignment, Interview } from '@sdb/contracts';
import {
  assignRole,
  insertAssignment,
  insertCandidate,
  insertClient,
  insertClientMember,
  insertInterview,
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

  clientA = await insertClient(db.sql, {
    companyName: 'Interviews Tenant A',
    portalAccessEnabled: true,
  });
  clientB = await insertClient(db.sql, {
    companyName: 'Interviews Tenant B',
    portalAccessEnabled: true,
  });

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

async function seedAssignment(
  opts: { stage?: AssignmentStage; clientId?: string } = {},
): Promise<{ requisitionId: string; candidateId: string; assignmentId: string }> {
  const requisitionId = await insertRequisition(db.sql, {
    clientId: opts.clientId ?? clientA,
    status: 'interviewing',
  });
  const candidateId = await insertCandidate(db.sql, { hasConsent: true });
  const assignmentId = await insertAssignment(db.sql, {
    requisitionId,
    candidateId,
    assignedBy: admin,
    stage: opts.stage ?? 'client_reviewing',
  });
  return { requisitionId, candidateId, assignmentId };
}

const soon = () => new Date(Date.now() + 86_400_000).toISOString();

async function createInterview(
  assignmentId: string,
  body: Record<string, unknown> = {},
) {
  return harness.app.inject({
    method: 'POST',
    url: `/api/v1/assignments/${assignmentId}/interviews`,
    headers: await harness.bearer(admin),
    payload: { scheduledAt: soon(), timezone: 'America/Mexico_City', ...body },
  });
}

async function stageOf(assignmentId: string): Promise<string> {
  const rows = await db.sql<{ stage: string }[]>`
    select stage::text as stage from assignments where id = ${assignmentId}
  `;
  return rows[0]!.stage;
}

describe('AC-PL-12 — interview creation moves the stage, notifies, unlocks PII', () => {
  it('client_reviewing → interview_scheduled with events, recipients, and the PII flip', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });

    // BEFORE: the client reads the assignment with every gated field null.
    const before = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${assignmentId}`,
      headers: await harness.bearer(clientUserA),
    });
    expect(before.statusCode).toBe(200);
    const gatedBefore = before.json<{ data: ClientVisibleAssignment }>().data;
    expect(gatedBefore.stage).toBe('client_reviewing');
    expect(gatedBefore.email).toBeNull();
    expect(gatedBefore.phone).toBeNull();
    expect(gatedBefore.lastName).toBeNull();

    const res = await createInterview(assignmentId, {
      durationMinutes: 45,
      meetingUrl: 'https://meet.example.com/round-1',
      interviewerNames: 'Rebecca K',
    });
    expect(res.statusCode).toBe(201);
    const interview = res.json<{ data: Interview }>().data;
    expect(interview.roundNumber).toBe(1);
    expect(interview.outcome).toBe('pending');
    expect(interview.createdBy).toBe(admin);

    // Stage moved through the machine, one transaction with the row.
    expect(await stageOf(assignmentId)).toBe('interview_scheduled');
    const stageEvents = await db.sql<{ actor_id: string | null }[]>`
      select actor_id from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'stage_changed'
        and from_value = 'client_reviewing' and to_value = 'interview_scheduled'
        and actor_id is not null
    `;
    expect(stageEvents).toHaveLength(1);
    const createdEvents = await db.sql<{ metadata: { interviewId?: string } }[]>`
      select metadata from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'interview_created'
    `;
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]!.metadata.interviewId).toBe(interview.id);

    // Recipients: ALL client users of the tenant + the creating admin,
    // exactly once each (06 §4.4).
    const recipients = await db.sql<{ recipient_user_id: string }[]>`
      select recipient_user_id from notification_log
      where event = 'interview_scheduled'
        and entity_type = 'assignment' and entity_id = ${assignmentId}
    `;
    expect(recipients.map((row) => row.recipient_user_id).sort()).toEqual(
      [clientAdminA, clientUserA, admin].sort(),
    );

    // AFTER: the same client read now returns the real gated values — the
    // fixture candidate carries known PII, and the view unlocked it in SQL.
    const after = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${assignmentId}`,
      headers: await harness.bearer(clientUserA),
    });
    const gatedAfter = after.json<{ data: ClientVisibleAssignment }>().data;
    expect(gatedAfter.stage).toBe('interview_scheduled');
    expect(gatedAfter.email).toMatch(/^candidate-.*@example\.com$/);
    expect(gatedAfter.phone).toBe('+1-555-0000');
    expect(gatedAfter.lastName).not.toBeNull();
    expect(gatedAfter.whatsapp).toBe('+1-555-0001');
    expect(gatedAfter.currentEmployer).toBe('Employer Inc');
  });

  it('presented → 409: the client must approve-for-interview first', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'presented' });
    const res = await createInterview(assignmentId);
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: { code: string; details: { from: string; to: string } } }>();
    expect(body.error.code).toBe('INVALID_TRANSITION');
    expect(body.error.details).toMatchObject({
      from: 'presented',
      to: 'interview_scheduled',
    });
    expect(await stageOf(assignmentId)).toBe('presented');
    // Nothing was written: no interview row, no notification.
    const interviews = await db.sql<{ id: string }[]>`
      select id from interviews where assignment_id = ${assignmentId}
    `;
    expect(interviews).toHaveLength(0);
  });

  it.each(['vetted', 'rejected_by_client'] as const)(
    '%s → 409 INVALID_TRANSITION',
    async (stage) => {
      const { assignmentId } = await seedAssignment({ stage });
      const res = await createInterview(assignmentId);
      expect(res.statusCode).toBe(409);
      expect(await stageOf(assignmentId)).toBe(stage);
    },
  );

  it('a later round at interview_scheduled creates without a stage change', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    expect((await createInterview(assignmentId)).statusCode).toBe(201);
    const res = await createInterview(assignmentId);
    expect(res.statusCode).toBe(201);
    expect(res.json<{ data: Interview }>().data.roundNumber).toBe(2);
    expect(await stageOf(assignmentId)).toBe('interview_scheduled');
    // Exactly ONE app-sourced stage event into interview_scheduled.
    const events = await db.sql<{ id: string }[]>`
      select id from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'stage_changed' and to_value = 'interview_scheduled'
        and actor_id is not null
    `;
    expect(events).toHaveLength(1);
  });
});

describe('round uniqueness — unique (assignment_id, round_number)', () => {
  it('an explicit duplicate round is a clean 422, not a 500', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    expect(
      (await createInterview(assignmentId, { roundNumber: 1 })).statusCode,
    ).toBe(201);
    const res = await createInterview(assignmentId, { roundNumber: 1 });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('the constraint itself: raw duplicate insert → SQLSTATE 23505', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    await insertInterview(db.sql, { assignmentId, createdBy: admin, roundNumber: 1 });
    await expectPgError(
      insertInterview(db.sql, { assignmentId, createdBy: admin, roundNumber: 1 }),
      '23505',
    );
  });
});

describe('GET /assignments/:id/interviews — admin and client reads', () => {
  it('admin lists rounds in order; the tenant client lists a visible assignment', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    await createInterview(assignmentId);
    await createInterview(assignmentId);

    const adminRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${assignmentId}/interviews`,
      headers: await harness.bearer(admin),
    });
    expect(adminRes.statusCode).toBe(200);
    const adminList = adminRes.json<{ data: Interview[] }>().data;
    expect(adminList.map((row) => row.roundNumber)).toEqual([1, 2]);

    const clientRes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${assignmentId}/interviews`,
      headers: await harness.bearer(clientUserA),
    });
    expect(clientRes.statusCode).toBe(200);
    expect(clientRes.json<{ data: Interview[] }>().data).toHaveLength(2);
  });

  it('cross-tenant: client B addressing an A assignment gets 403/404, never data', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    await createInterview(assignmentId);
    await expectTenantIsolated(harness.app, {
      url: `/api/v1/assignments/${assignmentId}/interviews`,
      headers: await harness.bearer(clientAdminB),
    });
  });

  it('an internal-stage assignment of the OWN tenant is 404 for the client', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'vetted' });
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/assignments/${assignmentId}/interviews`,
      headers: await harness.bearer(clientUserA),
    });
    expect(res.statusCode).toBe(404);
  });

  it('client roles cannot create: interview.create is not theirs → 403', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${assignmentId}/interviews`,
      headers: await harness.bearer(clientAdminA),
      payload: { scheduledAt: soon(), timezone: 'UTC' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });
});

describe('PATCH /interviews/:id — schedule updates', () => {
  it('updates schedule fields while pending and writes an event', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const created = (await createInterview(assignmentId)).json<{ data: Interview }>().data;
    const newTime = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/interviews/${created.id}`,
      headers: await harness.bearer(admin),
      payload: { scheduledAt: newTime, meetingUrl: 'https://meet.example.com/moved' },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<{ data: Interview }>().data;
    expect(new Date(updated.scheduledAt!).toISOString()).toBe(newTime);
    expect(updated.meetingUrl).toBe('https://meet.example.com/moved');
    const events = await db.sql<{ id: string }[]>`
      select id from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'interview_updated'
    `;
    expect(events).toHaveLength(1);
  });

  it('rejects rescheduling once the outcome is recorded → 422', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const created = (await createInterview(assignmentId)).json<{ data: Interview }>().data;
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/outcome`,
      headers: await harness.bearer(admin),
      payload: { outcome: 'passed' },
    });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/interviews/${created.id}`,
      headers: await harness.bearer(admin),
      payload: { timezone: 'UTC' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('POST /interviews/:id/outcome — recording and the stage rule', () => {
  it('records the outcome and advances interview_scheduled → interviewed', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const created = (await createInterview(assignmentId)).json<{ data: Interview }>().data;
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/outcome`,
      headers: await harness.bearer(admin),
      payload: { outcome: 'passed', outcomeNotes: 'Strong round' },
    });
    expect(res.statusCode).toBe(200);
    const recorded = res.json<{ data: Interview }>().data;
    expect(recorded.outcome).toBe('passed');
    expect(recorded.outcomeNotes).toBe('Strong round');
    expect(recorded.outcomeRecordedBy).toBe(admin);
    expect(recorded.outcomeRecordedAt).not.toBeNull();
    expect(await stageOf(assignmentId)).toBe('interviewed');
    const events = await db.sql<{ event_type: string }[]>`
      select event_type from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type in ('interview_outcome_recorded')
    `;
    expect(events).toHaveLength(1);
  });

  it('with another round still pending the stage waits; resolving it advances', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const first = (await createInterview(assignmentId)).json<{ data: Interview }>().data;
    const second = (await createInterview(assignmentId)).json<{ data: Interview }>().data;

    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${first.id}/outcome`,
      headers: await harness.bearer(admin),
      payload: { outcome: 'passed' },
    });
    expect(await stageOf(assignmentId)).toBe('interview_scheduled');

    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${second.id}/outcome`,
      headers: await harness.bearer(admin),
      payload: { outcome: 'failed' },
    });
    expect(await stageOf(assignmentId)).toBe('interviewed');
  });

  it("'rescheduled' records but never advances — the interview did not happen", async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const created = (await createInterview(assignmentId)).json<{ data: Interview }>().data;
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/outcome`,
      headers: await harness.bearer(admin),
      payload: { outcome: 'rescheduled' },
    });
    expect(res.statusCode).toBe(200);
    expect(await stageOf(assignmentId)).toBe('interview_scheduled');
  });

  it('recording twice → 422; pending/cancelled are not recordable bodies → 400', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const created = (await createInterview(assignmentId)).json<{ data: Interview }>().data;
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/outcome`,
      headers: await harness.bearer(admin),
      payload: { outcome: 'no_show' },
    });
    const again = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/outcome`,
      headers: await harness.bearer(admin),
      payload: { outcome: 'passed' },
    });
    expect(again.statusCode).toBe(422);

    const invalid = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/outcome`,
      headers: await harness.bearer(admin),
      payload: { outcome: 'cancelled' },
    });
    expect(invalid.statusCode).toBe(400);
  });
});

describe('POST /interviews/:id/cancel — no backward stage edge', () => {
  it('cancels a pending interview and deliberately leaves the stage', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const created = (await createInterview(assignmentId)).json<{ data: Interview }>().data;
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/cancel`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    const cancelled = res.json<{ data: Interview }>().data;
    expect(cancelled.outcome).toBe('cancelled');
    expect(cancelled.outcomeRecordedBy).toBe(admin);
    // No pending interview remains, and the stage still does NOT revert:
    // the machine has no backward edge and PII stays unlocked (01 §5).
    expect(await stageOf(assignmentId)).toBe('interview_scheduled');
    const events = await db.sql<{ id: string }[]>`
      select id from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
        and event_type = 'interview_cancelled'
    `;
    expect(events).toHaveLength(1);
  });

  it('cancelling a recorded interview → 422', async () => {
    const { assignmentId } = await seedAssignment({ stage: 'client_reviewing' });
    const created = (await createInterview(assignmentId)).json<{ data: Interview }>().data;
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/cancel`,
      headers: await harness.bearer(admin),
    });
    const again = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/interviews/${created.id}/cancel`,
      headers: await harness.bearer(admin),
    });
    expect(again.statusCode).toBe(422);
  });
});
