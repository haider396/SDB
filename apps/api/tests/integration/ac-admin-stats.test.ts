/**
 * Phase P6 — GET /admin/stats (docs/04-API.md §12): open requisitions,
 * candidates by stage across active requisitions, average days-to-present
 * over the last 90 days, active placements. Runs on its own fresh database
 * so the counts are exact by construction.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminStats } from '@sdb/contracts';
import {
  assignRole,
  insertAssignment,
  insertCandidate,
  insertClient,
  insertClientMember,
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

beforeAll(async () => {
  db = await freshDb();
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  const tenant = await insertClient(db.sql, { portalAccessEnabled: true });
  clientUser = await insertUser(db.sql);
  await assignRole(db.sql, clientUser, 'client_user', tenant);
  await insertClientMember(db.sql, { clientId: tenant, userId: clientUser });

  // Requisitions: two open, two terminal → openRequisitions = 2.
  const sourcingReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'sourcing',
  });
  const presentedReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'candidates_presented',
  });
  const placedReq = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'placed',
  });
  await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'closed_unfilled',
  });

  // Assignments on ACTIVE requisitions: sourced ×2, presented ×1.
  const c1 = await insertCandidate(db.sql, { hasConsent: true });
  const c2 = await insertCandidate(db.sql, { hasConsent: true });
  const c3 = await insertCandidate(db.sql, { hasConsent: true });
  const c4 = await insertCandidate(db.sql, { hasConsent: true });
  await insertAssignment(db.sql, {
    requisitionId: sourcingReq,
    candidateId: c1,
    assignedBy: admin,
    stage: 'sourced',
  });
  await insertAssignment(db.sql, {
    requisitionId: sourcingReq,
    candidateId: c2,
    assignedBy: admin,
    stage: 'sourced',
  });
  const presentedAssignment = await insertAssignment(db.sql, {
    requisitionId: presentedReq,
    candidateId: c3,
    assignedBy: admin,
    stage: 'presented',
  });
  // Created 3 days ago, presented 1 day ago → 2.0 days to present.
  await db.sql`
    update assignments
    set created_at = ${daysAgo(3)}, presented_at = ${daysAgo(1)}
    where id = ${presentedAssignment}
  `;

  // A placed assignment on the TERMINAL requisition — excluded from the
  // by-stage counts, but its placement is active.
  const placedAssignment = await insertAssignment(db.sql, {
    requisitionId: placedReq,
    candidateId: c4,
    assignedBy: admin,
    stage: 'placed',
  });
  await db.sql`
    insert into placements (id, assignment_id, candidate_id, client_id,
                            requisition_id, start_date, status)
    values (${randomUUID()}, ${placedAssignment}, ${c4}, ${tenant},
            ${placedReq}, current_date, 'active')
  `;

  harness = await buildTestApp(db);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

describe('GET /admin/stats', () => {
  it('returns exact counts for the engineered fixture', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    const stats = res.json<{ data: AdminStats }>().data;

    expect(stats.openRequisitions).toBe(2);
    // The placed assignment sits on a terminal requisition → absent.
    expect(stats.candidatesByStage).toEqual({ sourced: 2, presented: 1 });
    expect(stats.averageDaysToPresent).not.toBeNull();
    expect(stats.averageDaysToPresent!).toBeGreaterThan(1.9);
    expect(stats.averageDaysToPresent!).toBeLessThan(2.1);
    expect(stats.activePlacements).toBe(1);
  });

  it('the admin surface is 404 for a client-scoped caller', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: await harness.bearer(clientUser),
    });
    expect(res.statusCode).toBe(404);
  });
});
