/**
 * Phase P6 — admin needs-attention queue (docs/01-PRODUCT-OVERVIEW.md §6,
 * docs/04-API.md §12, docs/06-BACKEND.md §5):
 *
 * AC-PL-14 — GET /admin/attention-queue returns all seven buckets with
 *            correct counts against a fixture engineered to populate each,
 *            with threshold boundary cases driven through app_settings
 *            overrides read at query time.
 *
 * Plus: the in-process cache (endpoint serves the cached snapshot until the
 * refresh job — or ?refresh=true — recomputes) and the admin-only surface.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AttentionQueue } from '@sdb/contracts';
import { createLogger } from '../../src/lib/logger.js';
import { refreshAttentionQueueCache } from '../../src/jobs/refresh-attention-queue-cache.js';
import { testEnv } from '../helpers.js';
import {
  assignRole,
  insertAssignment,
  insertCandidate,
  insertClient,
  insertClientMember,
  insertEvent,
  insertInterview,
  insertRequisition,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

let db: TestDb;
let harness: TestApp;
let admin: string;
let clientUser: string;

// The engineered fixture ids, one per bucket.
let submittedReq: string;
let stalePendingReq: string;
let freshPendingReq: string;
let unGrantedClient: string;
let staleSourcingReq: string;
let staleAssignment: string;
let presentedReq: string;
let overdueInterview: string;
let interviewReq: string;
let incompleteCandidate: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'super_admin');

  // Tenant for requisitions — portal access GRANTED so it never pollutes the
  // payment_confirmed_access_not_granted bucket.
  const tenant = await insertClient(db.sql, {
    companyName: 'Queue Tenant',
    portalAccessEnabled: true,
  });
  clientUser = await insertUser(db.sql);
  await assignRole(db.sql, clientUser, 'client_user', tenant);
  await insertClientMember(db.sql, { clientId: tenant, userId: clientUser });

  // 1 — new_intake_submissions: status = submitted, no threshold.
  submittedReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'submitted',
  });

  // 2 — awaiting_principal_approval: entered > 3 days ago (via the
  // status_changed event the transition writes; the fixture inserts it
  // directly). A second one entered 2 days ago sits INSIDE the threshold.
  stalePendingReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'pending_principal_approval',
  });
  await insertEvent(db.sql, {
    entityType: 'requisition',
    entityId: stalePendingReq,
    eventType: 'status_changed',
    fromValue: 'submitted',
    toValue: 'pending_principal_approval',
    occurredAt: daysAgo(4),
  });
  freshPendingReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'pending_principal_approval',
  });
  await insertEvent(db.sql, {
    entityType: 'requisition',
    entityId: freshPendingReq,
    eventType: 'status_changed',
    fromValue: 'submitted',
    toValue: 'pending_principal_approval',
    occurredAt: daysAgo(2),
  });

  // 3 — payment_confirmed_access_not_granted.
  unGrantedClient = await insertClient(db.sql, {
    companyName: 'Paid But Waiting LLC',
    paymentConfirmed: true,
    portalAccessEnabled: false,
  });

  // 4 — no_candidates_presented: sourcing for > 5 days; a 1-day-old one not.
  staleSourcingReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'sourcing',
  });
  await db.sql`
    update requisitions set sourcing_started_at = ${daysAgo(6)}
    where id = ${staleSourcingReq}
  `;
  const freshSourcingReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'sourcing',
  });
  await db.sql`
    update requisitions set sourcing_started_at = ${daysAgo(1)}
    where id = ${freshSourcingReq}
  `;

  // 5 — awaiting_client_feedback: presented > 3 days; a 1-day-old one not.
  presentedReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'candidates_presented',
  });
  const staleCandidate = await insertCandidate(db.sql, { hasConsent: true });
  staleAssignment = await insertAssignment(db.sql, {
    requisitionId: presentedReq,
    candidateId: staleCandidate,
    assignedBy: admin,
    stage: 'presented',
  });
  await db.sql`
    update assignments
    set presented_at = ${daysAgo(4)}, created_at = ${daysAgo(5)}
    where id = ${staleAssignment}
  `;
  const freshCandidate = await insertCandidate(db.sql, { hasConsent: true });
  const freshAssignment = await insertAssignment(db.sql, {
    requisitionId: presentedReq,
    candidateId: freshCandidate,
    assignedBy: admin,
    stage: 'presented',
  });
  await db.sql`
    update assignments
    set presented_at = ${daysAgo(1)}, created_at = ${daysAgo(2)}
    where id = ${freshAssignment}
  `;

  // 6 — interview_without_outcome: scheduled in the past, outcome pending;
  // a FUTURE pending interview does not qualify.
  interviewReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'interviewing',
  });
  const interviewCandidate = await insertCandidate(db.sql, { hasConsent: true });
  const interviewAssignment = await insertAssignment(db.sql, {
    requisitionId: interviewReq,
    candidateId: interviewCandidate,
    assignedBy: admin,
    stage: 'interview_scheduled',
  });
  overdueInterview = await insertInterview(db.sql, {
    assignmentId: interviewAssignment,
    createdBy: admin,
    roundNumber: 1,
    scheduledAt: new Date(Date.now() - 3_600_000),
  });
  await insertInterview(db.sql, {
    assignmentId: interviewAssignment,
    createdBy: admin,
    roundNumber: 2,
    scheduledAt: new Date(Date.now() + 3_600_000),
  });

  // 7 — incomplete_webhook_candidates.
  incompleteCandidate = await insertCandidate(db.sql);
  await db.sql`
    update candidates set data_completeness = 'incomplete'
    where id = ${incompleteCandidate}
  `;

  harness = await buildTestApp(db);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

async function fetchQueue(refresh = true): Promise<AttentionQueue> {
  const res = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/admin/attention-queue${refresh ? '?refresh=true' : ''}`,
    headers: await harness.bearer(admin),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: AttentionQueue }>().data;
}

function bucket(queue: AttentionQueue, key: string) {
  const found = queue.buckets.find((candidate) => candidate.key === key);
  expect(found, `bucket ${key} must exist`).toBeDefined();
  return found!;
}

describe('AC-PL-14 — all seven buckets with correct counts', () => {
  it('returns the seven buckets in 01 §6 order with the engineered fixture counted', async () => {
    const queue = await fetchQueue();
    expect(queue.buckets.map((row) => row.key)).toEqual([
      'new_intake_submissions',
      'awaiting_principal_approval',
      'payment_confirmed_access_not_granted',
      'no_candidates_presented',
      'awaiting_client_feedback',
      'interview_without_outcome',
      'incomplete_webhook_candidates',
    ]);

    const submissions = bucket(queue, 'new_intake_submissions');
    expect(submissions.count).toBe(1);
    expect(submissions.items[0]).toMatchObject({
      entityType: 'requisition',
      entityId: submittedReq,
    });

    // Threshold 3 days: the 4-day-old requisition is in, the 2-day-old not.
    const approvals = bucket(queue, 'awaiting_principal_approval');
    expect(approvals.count).toBe(1);
    expect(approvals.items[0]).toMatchObject({
      entityType: 'requisition',
      entityId: stalePendingReq,
    });

    const unpaid = bucket(queue, 'payment_confirmed_access_not_granted');
    expect(unpaid.count).toBe(1);
    expect(unpaid.items[0]).toMatchObject({
      entityType: 'client',
      entityId: unGrantedClient,
      reference: 'Paid But Waiting LLC',
    });

    // Threshold 5 days: 6-day-old sourcing in, 1-day-old not.
    const sourcing = bucket(queue, 'no_candidates_presented');
    expect(sourcing.count).toBe(1);
    expect(sourcing.items[0]).toMatchObject({
      entityType: 'requisition',
      entityId: staleSourcingReq,
    });

    // Threshold 3 days: 4-day-old presented in, 1-day-old not. Assignment
    // items carry the owning requisition id for deep links (UX 1.7).
    const feedback = bucket(queue, 'awaiting_client_feedback');
    expect(feedback.count).toBe(1);
    expect(feedback.items[0]).toMatchObject({
      entityType: 'assignment',
      entityId: staleAssignment,
      requisitionId: presentedReq,
    });

    // Past pending interview in; the future round 2 not. Interview items
    // carry the owning requisition id for deep links (UX 1.7).
    const interviews = bucket(queue, 'interview_without_outcome');
    expect(interviews.count).toBe(1);
    expect(interviews.items[0]).toMatchObject({
      entityType: 'interview',
      entityId: overdueInterview,
      requisitionId: interviewReq,
    });

    const incomplete = bucket(queue, 'incomplete_webhook_candidates');
    expect(incomplete.count).toBe(1);
    expect(incomplete.items[0]).toMatchObject({
      entityType: 'candidate',
      entityId: incompleteCandidate,
    });

    // Every item carries a real reference/label and an ISO since; only the
    // assignment/interview buckets carry the deep-link requisitionId.
    for (const row of queue.buckets) {
      for (const item of row.items) {
        expect(item.reference.length).toBeGreaterThan(0);
        expect(item.label.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(item.since))).toBe(false);
        if (item.entityType === 'assignment' || item.entityType === 'interview') {
          expect(item.requisitionId).toBeDefined();
        } else {
          expect(item.requisitionId).toBeUndefined();
        }
      }
    }
  });

  it('thresholds come from app_settings at query time (boundary overrides)', async () => {
    // Raising awaiting_client_days above the fixture age empties the bucket…
    await db.sql`
      update app_settings set value = '10'::jsonb
      where key = 'queue.awaiting_client_days'
    `;
    let queue = await fetchQueue();
    expect(bucket(queue, 'awaiting_client_feedback').count).toBe(0);

    // …and lowering principal_approval_days pulls the 2-day-old one IN.
    await db.sql`
      update app_settings set value = '1'::jsonb
      where key = 'queue.principal_approval_days'
    `;
    queue = await fetchQueue();
    const approvals = bucket(queue, 'awaiting_principal_approval');
    expect(approvals.count).toBe(2);
    expect(approvals.items.map((item) => item.entityId).sort()).toEqual(
      [stalePendingReq, freshPendingReq].sort(),
    );

    // Restore the seeded defaults for the remaining tests.
    await db.sql`
      update app_settings set value = '3'::jsonb
      where key in ('queue.awaiting_client_days', 'queue.principal_approval_days')
    `;
    queue = await fetchQueue();
    expect(bucket(queue, 'awaiting_client_feedback').count).toBe(1);
    expect(bucket(queue, 'awaiting_principal_approval').count).toBe(1);
  });
});

describe('cache — precomputed by the refresh job, served by the endpoint', () => {
  it('serves the cached snapshot until the job (or ?refresh=true) recomputes', async () => {
    const warmed = await fetchQueue(true);

    // New data does NOT appear through the cache…
    const lateReq = await insertRequisition(db.sql, {
      clientId: (
        await db.sql<{ client_id: string }[]>`
          select client_id from requisitions where id = ${submittedReq}
        `
      )[0]!.client_id,
      status: 'submitted',
    });
    const cached = await fetchQueue(false);
    expect(cached.computedAt).toBe(warmed.computedAt);
    expect(bucket(cached, 'new_intake_submissions').count).toBe(1);

    // …until the cron job's entry point recomputes the SAME cache instance.
    const logger = createLogger(testEnv({ DATABASE_URL: db.url }));
    await refreshAttentionQueueCache(harness.app.attentionQueue, { logger });
    const afterJob = await fetchQueue(false);
    expect(afterJob.computedAt).not.toBe(warmed.computedAt);
    const submissions = bucket(afterJob, 'new_intake_submissions');
    expect(submissions.count).toBe(2);
    expect(submissions.items.map((item) => item.entityId)).toContain(lateReq);

    // Clean up so the earlier exact counts stay meaningful on reruns.
    await db.sql`delete from requisitions where id = ${lateReq}`;
    await fetchQueue(true);
  });
});

describe('cache — cleared on state change (UX 1.7 clear-on-write hook)', () => {
  it('a requisition status transition busts the cache without ?refresh', async () => {
    const warmed = await fetchQueue(true);
    expect(
      bucket(warmed, 'new_intake_submissions').items.map((i) => i.entityId),
    ).toContain(submittedReq);

    // submitted → on_hold through the API: the transition path invalidates
    // the in-process cache, so a plain cached read recomputes.
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${submittedReq}/transition`,
      headers: await harness.bearer(admin),
      payload: { toStatus: 'on_hold' },
    });
    expect(res.statusCode).toBe(200);

    const afterTransition = await fetchQueue(false);
    expect(afterTransition.computedAt).not.toBe(warmed.computedAt);
    expect(
      bucket(afterTransition, 'new_intake_submissions').items.map(
        (i) => i.entityId,
      ),
    ).not.toContain(submittedReq);
  });

  it('an assignment stage change busts the cache without ?refresh', async () => {
    const warmed = await fetchQueue(true);
    expect(
      bucket(warmed, 'awaiting_client_feedback').items.map((i) => i.entityId),
    ).toContain(staleAssignment);

    // presented → client_reviewing through the API advance path.
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/assignments/${staleAssignment}/advance`,
      headers: await harness.bearer(admin),
      payload: { toStage: 'client_reviewing' },
    });
    expect(res.statusCode).toBe(200);

    const afterAdvance = await fetchQueue(false);
    expect(afterAdvance.computedAt).not.toBe(warmed.computedAt);
    expect(
      bucket(afterAdvance, 'awaiting_client_feedback').items.map(
        (i) => i.entityId,
      ),
    ).not.toContain(staleAssignment);
  });
});

describe('surface — admin only', () => {
  it('a client-scoped caller holds requisition.view but the surface is 404', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/admin/attention-queue',
      headers: await harness.bearer(clientUser),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});
