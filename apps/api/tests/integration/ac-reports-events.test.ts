/**
 * Phase P6 — reporting and the global audit trail (docs/04-API.md §12):
 *
 * AC-PL-15 — GET /reports/rejection-reasons returns correct grouped counts
 *            split by actor, honours the role-category filter and the
 *            from/to window, and lists free-text reasons under 'other'.
 *
 * Plus: GET /events filters (entityType/entityId/eventType/actorId/from/to),
 * cursor pagination, and app+trigger pair de-duplication (06 §2.3).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityEvent, RejectionReasonsReport } from '@sdb/contracts';
import {
  assignRole,
  insertAssignment,
  insertCandidate,
  insertClient,
  insertClientMember,
  insertEvent,
  insertRequisition,
  insertTaxonomyChain,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

const DAY = 86_400_000;
const iso = (msOffset: number) => new Date(Date.now() + msOffset).toISOString();

let db: TestDb;
let harness: TestApp;
let admin: string;
let clientAdmin: string;
let roleCategoryX: string;
let roleCategoryY: string;
let cultureFitId: string;
let cultureFitLabel: string;
let failedVettingId: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'super_admin');

  const tenant = await insertClient(db.sql, { portalAccessEnabled: true });
  clientAdmin = await insertUser(db.sql);
  await assignRole(db.sql, clientAdmin, 'client_admin', tenant);
  await insertClientMember(db.sql, { clientId: tenant, userId: clientAdmin });

  roleCategoryX = (await insertTaxonomyChain(db.sql)).roleCategoryId;
  roleCategoryY = (await insertTaxonomyChain(db.sql)).roleCategoryId;

  const reasons = await db.sql<
    { id: string; key: string; label: string }[]
  >`
    select id, key, label from rejection_reasons
    where key in ('culture_fit', 'failed_vetting')
  `;
  const cultureFit = reasons.find((row) => row.key === 'culture_fit')!;
  cultureFitId = cultureFit.id;
  cultureFitLabel = cultureFit.label;
  failedVettingId = reasons.find((row) => row.key === 'failed_vetting')!.id;

  const reqX = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'candidates_presented',
    roleCategoryId: roleCategoryX,
  });
  const reqY = await insertRequisition(db.sql, {
    clientId: tenant,
    status: 'candidates_presented',
    roleCategoryId: roleCategoryY,
  });

  async function rejectOn(
    requisitionId: string,
    actor: 'admin' | 'client',
    reasonId: string | null,
    reasonOther: string | null,
    createdAt?: Date,
  ): Promise<void> {
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const assignmentId = await insertAssignment(db.sql, {
      requisitionId,
      candidateId,
      assignedBy: admin,
      stage: actor === 'admin' ? 'rejected_by_admin' : 'rejected_by_client',
    });
    const id = randomUUID();
    await db.sql`
      insert into rejections (id, assignment_id, actor, rejected_by, reason_id, reason_other)
      values (${id}, ${assignmentId}, ${actor},
              ${actor === 'admin' ? admin : clientAdmin},
              ${reasonId}, ${reasonOther})
    `;
    if (createdAt !== undefined) {
      await db.sql`
        update rejections set created_at = ${createdAt} where id = ${id}
      `;
    }
  }

  // Role category X: client culture_fit ×2, client free-text ×1, admin ×1.
  await rejectOn(reqX, 'client', cultureFitId, null);
  await rejectOn(reqX, 'client', cultureFitId, null);
  await rejectOn(reqX, 'client', null, 'Too expensive');
  await rejectOn(reqX, 'admin', failedVettingId, null);
  // Role category Y: client culture_fit ×1, plus one OUTSIDE the window.
  await rejectOn(reqY, 'client', cultureFitId, null);
  await rejectOn(reqY, 'client', cultureFitId, null, new Date(Date.now() - 10 * DAY));

  harness = await buildTestApp(db);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

async function fetchReport(
  query: Record<string, string>,
): Promise<RejectionReasonsReport> {
  const params = new URLSearchParams({
    from: iso(-DAY),
    to: iso(DAY),
    ...query,
  });
  const res = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/reports/rejection-reasons?${params.toString()}`,
    headers: await harness.bearer(admin),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: RejectionReasonsReport }>().data;
}

describe('AC-PL-15 — grouped rejection counts split by actor', () => {
  it('groups by reason within actor, with free-text under other', async () => {
    const report = await fetchReport({});
    expect(report.totalCount).toBe(5);

    const clientRows = report.rows.filter((row) => row.actor === 'client');
    const adminRows = report.rows.filter((row) => row.actor === 'admin');

    expect(clientRows).toHaveLength(2);
    const cultureRow = clientRows.find((row) => row.reasonId === cultureFitId)!;
    expect(cultureRow).toMatchObject({
      reasonKey: 'culture_fit',
      label: cultureFitLabel,
      count: 3, // 2 on X + 1 on Y, the 10-day-old one windowed out
      otherTexts: [],
    });
    const otherRow = clientRows.find((row) => row.reasonId === null)!;
    expect(otherRow).toMatchObject({
      reasonKey: 'other',
      count: 1,
      otherTexts: ['Too expensive'],
    });

    expect(adminRows).toHaveLength(1);
    expect(adminRows[0]).toMatchObject({
      reasonId: failedVettingId,
      reasonKey: 'failed_vetting',
      count: 1,
    });
  });

  it('actor filter narrows to that side', async () => {
    const report = await fetchReport({ actor: 'admin' });
    expect(report.actor).toBe('admin');
    expect(report.totalCount).toBe(1);
    expect(report.rows.every((row) => row.actor === 'admin')).toBe(true);
  });

  it('roleCategoryId filter joins through assignments → requisitions', async () => {
    const reportX = await fetchReport({ roleCategoryId: roleCategoryX });
    expect(reportX.totalCount).toBe(4);
    expect(
      reportX.rows.find(
        (row) => row.actor === 'client' && row.reasonId === cultureFitId,
      )!.count,
    ).toBe(2);

    const reportY = await fetchReport({ roleCategoryId: roleCategoryY });
    expect(reportY.totalCount).toBe(1);
  });

  it('from/to windowing: widening the window pulls the old rejection in', async () => {
    const wide = await fetchReport({ from: iso(-30 * DAY) });
    expect(wide.totalCount).toBe(6);
    expect(
      wide.rows.find(
        (row) => row.actor === 'client' && row.reasonId === cultureFitId,
      )!.count,
    ).toBe(4);
  });

  it('from after to → 422; a client role lacks event.view → 403', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/reports/rejection-reasons?from=${iso(DAY)}&to=${iso(-DAY)}`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(422);

    const forbidden = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/reports/rejection-reasons?from=${iso(-DAY)}&to=${iso(DAY)}`,
      headers: await harness.bearer(clientAdmin),
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('GET /events — filters, pagination, dedupe', () => {
  const entityId = randomUUID();
  const otherEntityId = randomUUID();
  let actorForFilter: string;

  beforeAll(async () => {
    actorForFilter = admin;
    // Five spaced events on one entity for pagination, plus contrast rows.
    for (let index = 0; index < 5; index += 1) {
      await insertEvent(db.sql, {
        entityType: 'candidate',
        entityId,
        eventType: 'pool_status_changed',
        actorId: index === 0 ? actorForFilter : null,
        fromValue: `v${index}`,
        toValue: `v${index + 1}`,
        occurredAt: new Date(Date.now() - (5 - index) * 60_000),
      });
    }
    await insertEvent(db.sql, {
      entityType: 'question',
      entityId: otherEntityId,
      eventType: 'question_updated',
      occurredAt: new Date(Date.now() - 90_000),
    });
  });

  async function fetchEvents(
    query: Record<string, string>,
  ): Promise<{ data: EntityEvent[]; meta: { nextCursor: string | null } }> {
    const params = new URLSearchParams(query);
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/events?${params.toString()}`,
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('filters by entityType + entityId, newest first', async () => {
    const page = await fetchEvents({ entityType: 'candidate', entityId });
    expect(page.data).toHaveLength(5);
    expect(page.data.every((event) => event.entityId === entityId)).toBe(true);
    const times = page.data.map((event) => Date.parse(event.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters by eventType, actorId, and from/to windows', async () => {
    const byType = await fetchEvents({ eventType: 'question_updated' });
    expect(byType.data.some((event) => event.entityId === otherEntityId)).toBe(true);
    expect(byType.data.every((event) => event.eventType === 'question_updated')).toBe(true);

    const byActor = await fetchEvents({ entityId, actorId: actorForFilter });
    expect(byActor.data).toHaveLength(1);
    expect(byActor.data[0]!.fromValue).toBe('v0');

    // from/to window catching only the middle three of the five.
    const from = new Date(Date.now() - 3.5 * 60_000).toISOString();
    const to = new Date(Date.now() - 1.5 * 60_000).toISOString();
    const windowed = await fetchEvents({ entityId, from, to });
    expect(windowed.data).toHaveLength(2);
  });

  it('cursor pagination walks the full set without gaps or repeats', async () => {
    const collected: string[] = [];
    let cursor: string | null = null;
    let guard = 0;
    do {
      const page = await fetchEvents({
        entityType: 'candidate',
        entityId,
        limit: '2',
        ...(cursor === null ? {} : { cursor }),
      });
      collected.push(...page.data.map((event) => event.id));
      cursor = page.meta.nextCursor;
      guard += 1;
    } while (cursor !== null && guard < 10);
    expect(guard).toBeLessThan(10);
    expect(collected).toHaveLength(5);
    expect(new Set(collected).size).toBe(5);
  });

  it('a tampered cursor is 400 MALFORMED_REQUEST', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/events?cursor=not-a-cursor',
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'MALFORMED_REQUEST',
    );
  });

  it('de-duplicates app+trigger pairs, preferring the actor-bearing row', async () => {
    const pairedEntity = randomUUID();
    const occurredAt = new Date();
    await insertEvent(db.sql, {
      entityType: 'assignment',
      entityId: pairedEntity,
      eventType: 'stage_changed',
      actorId: admin,
      fromValue: 'vetted',
      toValue: 'presented',
      occurredAt,
    });
    await insertEvent(db.sql, {
      entityType: 'assignment',
      entityId: pairedEntity,
      eventType: 'stage_changed',
      actorId: null,
      fromValue: 'vetted',
      toValue: 'presented',
      occurredAt: new Date(occurredAt.getTime() + 500),
    });
    const page = await fetchEvents({ entityId: pairedEntity });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.actorId).toBe(admin);
  });

  it('client roles lack event.view → 403', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/events',
      headers: await harness.bearer(clientAdmin),
    });
    expect(res.statusCode).toBe(403);
  });
});
