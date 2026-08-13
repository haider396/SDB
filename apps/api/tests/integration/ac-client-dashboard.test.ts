/**
 * Phase P5 — client dashboard (docs/04-API.md §12 GET /client/dashboard):
 * own requisitions with client-visible stage summaries, pending actions
 * (principal approvals for the caller, presented candidates awaiting
 * review), and recent requisition events — all implicitly tenant-scoped.
 *
 * Tenant isolation is asserted on content (nothing of tenant B leaks into
 * A's dashboard) and structurally: internal pipeline stages never appear in
 * stageCounts because they come from client_visible_assignments (AC-PL-07,
 * CLAUDE.md rule 3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClientDashboard } from '@sdb/contracts';
import {
  assignRole,
  insertAssignment,
  insertCandidate,
  insertClient,
  insertClientMember,
  insertEvent,
  insertRequisition,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

let db: TestDb;
let harness: TestApp;
let admin: string;
let clientA: string;
let clientAdminA: string;
let clientUserA: string;
let clientAdminB: string;

let presentedReqA: string;
let sourcingReqA: string;
let pendingApprovalReqA: string;
let presentedAssignmentA: string;
let reqB: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  clientA = await insertClient(db.sql, {
    companyName: 'Dashboard Tenant A',
    portalAccessEnabled: true,
  });
  const clientB = await insertClient(db.sql, {
    companyName: 'Dashboard Tenant B',
    portalAccessEnabled: true,
  });

  clientAdminA = await insertUser(db.sql);
  await assignRole(db.sql, clientAdminA, 'client_admin', clientA);
  await insertClientMember(db.sql, {
    clientId: clientA,
    userId: clientAdminA,
    isPrincipal: true,
  });
  clientUserA = await insertUser(db.sql);
  await assignRole(db.sql, clientUserA, 'client_user', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientUserA });

  clientAdminB = await insertUser(db.sql);
  await assignRole(db.sql, clientAdminB, 'client_admin', clientB);
  await insertClientMember(db.sql, { clientId: clientB, userId: clientAdminB });

  // A: one requisition with a mixed pipeline — internal stages must vanish.
  presentedReqA = await insertRequisition(db.sql, {
    clientId: clientA,
    status: 'candidates_presented',
  });
  const candidates = await Promise.all([
    insertCandidate(db.sql, { hasConsent: true }),
    insertCandidate(db.sql, { hasConsent: true }),
    insertCandidate(db.sql, { hasConsent: true }),
    insertCandidate(db.sql, { hasConsent: true }),
  ]);
  presentedAssignmentA = await insertAssignment(db.sql, {
    requisitionId: presentedReqA,
    candidateId: candidates[0],
    assignedBy: admin,
    stage: 'presented',
  });
  await db.sql`
    update assignments set presented_at = now() where id = ${presentedAssignmentA}
  `;
  await insertAssignment(db.sql, {
    requisitionId: presentedReqA,
    candidateId: candidates[1],
    assignedBy: admin,
    stage: 'client_reviewing',
  });
  await insertAssignment(db.sql, {
    requisitionId: presentedReqA,
    candidateId: candidates[2],
    assignedBy: admin,
    stage: 'vetted', // internal — must not appear anywhere
  });

  // A: a sourcing requisition whose pipeline is entirely internal.
  sourcingReqA = await insertRequisition(db.sql, {
    clientId: clientA,
    status: 'sourcing',
  });
  await insertAssignment(db.sql, {
    requisitionId: sourcingReqA,
    candidateId: candidates[3],
    assignedBy: admin,
    stage: 'sourced',
  });

  // A: a brief awaiting the principal (clientAdminA).
  pendingApprovalReqA = await insertRequisition(db.sql, {
    clientId: clientA,
    status: 'pending_principal_approval',
    principalUserId: clientAdminA,
  });

  // Requisition events for both tenants; only A's may surface. The app+
  // trigger pair on A must collapse to one row (06 §2.3).
  const occurredAt = new Date();
  await insertEvent(db.sql, {
    entityType: 'requisition',
    entityId: presentedReqA,
    eventType: 'status_changed',
    actorId: admin,
    fromValue: 'sourcing',
    toValue: 'candidates_presented',
    occurredAt,
  });
  await insertEvent(db.sql, {
    entityType: 'requisition',
    entityId: presentedReqA,
    eventType: 'status_changed',
    actorId: null, // trigger backstop twin
    fromValue: 'sourcing',
    toValue: 'candidates_presented',
    occurredAt,
  });

  reqB = await insertRequisition(db.sql, {
    clientId: clientB,
    status: 'sourcing',
  });
  await insertEvent(db.sql, {
    entityType: 'requisition',
    entityId: reqB,
    eventType: 'status_changed',
    fromValue: 'pending_principal_approval',
    toValue: 'sourcing',
  });

  harness = await buildTestApp(db);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

async function fetchDashboard(userId: string): Promise<ClientDashboard> {
  const res = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/client/dashboard',
    headers: await harness.bearer(userId),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: ClientDashboard }>().data;
}

describe('GET /client/dashboard — shape and scoping', () => {
  it('lists the tenant requisitions with client-visible stage counts only', async () => {
    const dashboard = await fetchDashboard(clientUserA);
    const ids = dashboard.requisitions.map((row) => row.id).sort();
    expect(ids).toEqual(
      [presentedReqA, sourcingReqA, pendingApprovalReqA].sort(),
    );

    const presented = dashboard.requisitions.find(
      (row) => row.id === presentedReqA,
    )!;
    expect(presented.status).toBe('candidates_presented');
    // The vetted assignment is structurally invisible — no key, not zero.
    expect(presented.stageCounts).toEqual({
      presented: 1,
      client_reviewing: 1,
    });

    const sourcing = dashboard.requisitions.find(
      (row) => row.id === sourcingReqA,
    )!;
    expect(sourcing.stageCounts).toEqual({});
  });

  it('pending principal approvals appear only for the designated principal', async () => {
    const principal = await fetchDashboard(clientAdminA);
    expect(
      principal.pendingActions.principalApprovals.map(
        (row) => row.requisitionId,
      ),
    ).toEqual([pendingApprovalReqA]);

    const nonPrincipal = await fetchDashboard(clientUserA);
    expect(nonPrincipal.pendingActions.principalApprovals).toEqual([]);
  });

  it('presented candidates awaiting review carry the display name, never PII', async () => {
    const dashboard = await fetchDashboard(clientUserA);
    const reviews = dashboard.pendingActions.candidatesAwaitingReview;
    expect(reviews).toHaveLength(1);
    const review = reviews[0]!;
    expect(review.assignmentId).toBe(presentedAssignmentA);
    expect(review.requisitionId).toBe(presentedReqA);
    expect(review.requisitionReference).toMatch(/^REQ-/);
    expect(review.displayName.length).toBeGreaterThan(0);
    expect(review.presentedAt).not.toBeNull();
    // The item shape has no email/phone/lastName keys at all.
    expect(Object.keys(review).sort()).toEqual(
      [
        'assignmentId',
        'requisitionId',
        'requisitionReference',
        'displayName',
        'presentedAt',
      ].sort(),
    );
  });

  it('recent events are own-tenant requisition events, deduped, newest first', async () => {
    const dashboard = await fetchDashboard(clientUserA);
    expect(dashboard.recentEvents.length).toBeGreaterThan(0);
    for (const event of dashboard.recentEvents) {
      expect(event.entityType).toBe('requisition');
      expect([presentedReqA, sourcingReqA, pendingApprovalReqA]).toContain(
        event.entityId,
      );
    }
    // The app+trigger twin collapsed to ONE row, preferring the actor-bearing
    // app event (06 §2.3).
    const presentedEvents = dashboard.recentEvents.filter(
      (event) =>
        event.entityId === presentedReqA &&
        event.eventType === 'status_changed' &&
        event.toValue === 'candidates_presented',
    );
    expect(presentedEvents).toHaveLength(1);
    expect(presentedEvents[0]!.actorId).toBe(admin);
    // UX 2.10 + 1.3: the actor's full name rides along for the feed sentence.
    const adminName = (
      await db.sql<{ full_name: string }[]>`
        select full_name from users where id = ${admin}
      `
    )[0]!.full_name;
    expect(presentedEvents[0]!.actorName).toBe(adminName);
    // Tenant B's event never crosses.
    expect(
      dashboard.recentEvents.some((event) => event.entityId === reqB),
    ).toBe(false);
  });

  it('feed entries carry requisition context for a human sentence (UX 1.3)', async () => {
    const dashboard = await fetchDashboard(clientUserA);
    const reference = (
      await db.sql<{ reference: string }[]>`
        select reference from requisitions where id = ${presentedReqA}
      `
    )[0]!.reference;
    const event = dashboard.recentEvents.find(
      (entry) => entry.entityId === presentedReqA,
    )!;
    expect(event.requisitionReference).toBe(reference);
    // advertised_title is unset in the fixture — nullable, never absent.
    expect(event.requisitionTitle).toBeNull();
    // Trigger-sourced events (no actor) carry a null actorName, not a crash.
    for (const entry of dashboard.recentEvents) {
      expect(entry).toHaveProperty('actorName');
      expect(entry.requisitionReference).toMatch(/^REQ-/);
      if (entry.actorId === null) expect(entry.actorName).toBeNull();
    }
  });

  it('tenant B sees only its own world', async () => {
    const dashboard = await fetchDashboard(clientAdminB);
    expect(dashboard.requisitions.map((row) => row.id)).toEqual([reqB]);
    expect(dashboard.pendingActions.candidatesAwaitingReview).toEqual([]);
    expect(
      dashboard.recentEvents.every((event) => event.entityId === reqB),
    ).toBe(true);
  });

  it('the surface does not exist for unscoped (admin) callers → 404', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/client/dashboard',
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});
