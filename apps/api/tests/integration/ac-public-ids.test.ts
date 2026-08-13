/**
 * Short public ids (migration 0015_public_ids.sql).
 *
 * - Candidates, clients, and requisitions are created with a DB-generated
 *   12-char base62 `public_id` (the INSERT never sets it — the column
 *   default owns it), returned as `publicId` in API payloads. Covers
 *   API-created, fixture-created, and webhook-created rows.
 * - Two creates never collide (unique constraint + 62^12 keyspace).
 * - Every single-resource lookup for the three entities accepts EITHER the
 *   internal uuid or the public id and returns the same resource: candidate
 *   GET/PATCH + child collections + files, client GET/PATCH + members,
 *   requisition GET/PATCH + answers/transition/assignments/events.
 * - Tenant isolation is form-independent: a foreign public id behaves
 *   exactly like a foreign uuid (404 read / 403 WRONG_TENANT write).
 * - List surfaces carry publicId (candidates, clients, requisitions,
 *   admin assignment rows' candidate summary, client dashboard
 *   requisitions) and the attention queue adds requisitionPublicId while
 *   requisitionId stays a uuid.
 */
import { PUBLIC_ID_REGEX } from '@sdb/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assignRole,
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

let db: TestDb;
let harness: TestApp;
let admin: string;
let clientA: string;
let clientB: string;
let clientUserA: string;

interface PublicIdRow {
  id: string;
  public_id: string;
}

async function publicIdOf(
  table: 'candidates' | 'clients' | 'requisitions',
  id: string,
): Promise<string> {
  const rows = await db.sql<PublicIdRow[]>`
    select id, public_id from ${db.sql(table)} where id = ${id}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error(`${table} row ${id} missing`);
  return row.public_id;
}

beforeAll(async () => {
  db = await freshDb();
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  clientA = await insertClient(db.sql, {
    companyName: 'Public Id Tenant A',
    portalAccessEnabled: true,
  });
  clientB = await insertClient(db.sql, {
    companyName: 'Public Id Tenant B',
    portalAccessEnabled: true,
  });
  clientUserA = await insertUser(db.sql);
  await assignRole(db.sql, clientUserA, 'client_admin', clientA);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientUserA });

  harness = await buildTestApp(db);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

describe('generation — DB default owns public_id on every insert path', () => {
  it('generate_public_id() honours the length argument and the alphabet', async () => {
    const rows = await db.sql<{ short: string; long: string }[]>`
      select generate_public_id(4) as short, generate_public_id(32) as long
    `;
    expect(rows[0]?.short).toMatch(/^[0-9A-Za-z]{4}$/);
    expect(rows[0]?.long).toMatch(/^[0-9A-Za-z]{32}$/);
  });

  it('API-created candidates return a 12-char base62 publicId; two creates differ', async () => {
    const create = async () => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/candidates',
        headers: await harness.bearer(admin),
        payload: { firstName: 'Pia', lastName: 'PublicId' },
      });
      expect(res.statusCode).toBe(201);
      return res.json<{ data: { id: string; publicId: string } }>().data;
    };
    const first = await create();
    const second = await create();
    expect(first.publicId).toMatch(PUBLIC_ID_REGEX);
    expect(second.publicId).toMatch(PUBLIC_ID_REGEX);
    expect(first.publicId).not.toBe(second.publicId);
    // The stored value is what the API returned — DB default, not app code.
    expect(await publicIdOf('candidates', first.id)).toBe(first.publicId);
  });

  it('API-created clients return a 12-char base62 publicId', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: await harness.bearer(admin),
      payload: { companyName: 'Fresh Publicid Co' },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json<{ data: { id: string; publicId: string } }>().data;
    expect(data.publicId).toMatch(PUBLIC_ID_REGEX);
    expect(await publicIdOf('clients', data.id)).toBe(data.publicId);
  });

  it('webhook-created candidates get a public_id too (insert never sets it)', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/candidates/webhook',
      headers: { authorization: 'Bearer webhook-inbound-token' },
      payload: {
        firstName: 'Web',
        lastName: 'Hook',
        externalId: 'public-id-webhook-1',
      },
    });
    expect(res.statusCode).toBe(200);
    const rows = await db.sql<PublicIdRow[]>`
      select id, public_id from candidates where external_id = 'public-id-webhook-1'
    `;
    expect(rows[0]?.public_id).toMatch(PUBLIC_ID_REGEX);
  });

  it('fixture-inserted rows (raw SQL, no public_id column) are backed by the default', async () => {
    const requisitionId = await insertRequisition(db.sql, { clientId: clientA });
    expect(await publicIdOf('requisitions', requisitionId)).toMatch(
      PUBLIC_ID_REGEX,
    );
    expect(await publicIdOf('clients', clientA)).toMatch(PUBLIC_ID_REGEX);
  });
});

describe('lookup — :id accepts the uuid OR the public id, same resource', () => {
  it('GET /candidates/:id by public id === by uuid; PATCH works by public id', async () => {
    const candidateId = await insertCandidate(db.sql);
    const publicId = await publicIdOf('candidates', candidateId);
    const [byUuid, byPublicId] = await Promise.all([
      harness.app.inject({
        method: 'GET',
        url: `/api/v1/candidates/${candidateId}`,
        headers: await harness.bearer(admin),
      }),
      harness.app.inject({
        method: 'GET',
        url: `/api/v1/candidates/${publicId}`,
        headers: await harness.bearer(admin),
      }),
    ]);
    expect(byUuid.statusCode).toBe(200);
    expect(byPublicId.statusCode).toBe(200);
    expect(byPublicId.json()).toEqual(byUuid.json());
    expect(
      byPublicId.json<{ data: { id: string; publicId: string } }>().data,
    ).toMatchObject({ id: candidateId, publicId });

    const patch = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${publicId}`,
      headers: await harness.bearer(admin),
      payload: { currentTitle: 'Patched Via Public Id' },
    });
    expect(patch.statusCode).toBe(200);
    expect(
      patch.json<{ data: { id: string; currentTitle: string } }>().data,
    ).toMatchObject({ id: candidateId, currentTitle: 'Patched Via Public Id' });
  });

  it('candidate child collections and files accept the public id', async () => {
    const candidateId = await insertCandidate(db.sql);
    const publicId = await publicIdOf('candidates', candidateId);

    const addLanguage = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${publicId}/languages`,
      headers: await harness.bearer(admin),
      payload: { language: 'Spanish', isNative: true },
    });
    expect(addLanguage.statusCode).toBe(201);

    const listByUuid = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/candidates/${candidateId}/languages`,
      headers: await harness.bearer(admin),
    });
    expect(listByUuid.statusCode).toBe(200);
    expect(
      listByUuid.json<{ data: { language: string }[] }>().data,
    ).toMatchObject([{ language: 'Spanish' }]);

    const notes = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/candidates/${publicId}/notes`,
      headers: await harness.bearer(admin),
    });
    expect(notes.statusCode).toBe(200);

    const uploadUrl = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${publicId}/files/upload-url`,
      headers: await harness.bearer(admin),
      payload: {
        fileType: 'cv',
        originalFilename: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
      },
    });
    expect(uploadUrl.statusCode).toBe(201);
    // The storage path embeds the resolved internal uuid, never the public id.
    expect(
      uploadUrl.json<{ data: { storagePath: string } }>().data.storagePath,
    ).toContain(`candidates/${candidateId}/`);

    const files = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/candidates/${publicId}/files`,
      headers: await harness.bearer(admin),
    });
    expect(files.statusCode).toBe(200);
    expect(files.json<{ meta: { count: number } }>().meta.count).toBe(1);
  });

  it('GET/PATCH /clients/:id and members routes accept the public id', async () => {
    const publicId = await publicIdOf('clients', clientA);
    const [byUuid, byPublicId] = await Promise.all([
      harness.app.inject({
        method: 'GET',
        url: `/api/v1/clients/${clientA}`,
        headers: await harness.bearer(admin),
      }),
      harness.app.inject({
        method: 'GET',
        url: `/api/v1/clients/${publicId}`,
        headers: await harness.bearer(admin),
      }),
    ]);
    expect(byUuid.statusCode).toBe(200);
    expect(byPublicId.statusCode).toBe(200);
    expect(byPublicId.json()).toEqual(byUuid.json());

    const patch = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/clients/${publicId}`,
      headers: await harness.bearer(admin),
      payload: { industry: 'Patched Industry' },
    });
    expect(patch.statusCode).toBe(200);
    expect(
      patch.json<{ data: { id: string; industry: string } }>().data,
    ).toMatchObject({ id: clientA, industry: 'Patched Industry' });

    const members = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/clients/${publicId}/members`,
      headers: await harness.bearer(admin),
    });
    expect(members.statusCode).toBe(200);
    expect(
      members.json<{ data: { userId: string }[] }>().data,
    ).toMatchObject([{ userId: clientUserA }]);

    // A client-scoped caller can address their OWN client by public id.
    const own = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/clients/${publicId}`,
      headers: await harness.bearer(clientUserA),
    });
    expect(own.statusCode).toBe(200);
  });

  it('requisition GET/PATCH/answers/transition/assignments/events accept the public id', async () => {
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'pending_principal_approval',
    });
    const publicId = await publicIdOf('requisitions', requisitionId);

    const [byUuid, byPublicId] = await Promise.all([
      harness.app.inject({
        method: 'GET',
        url: `/api/v1/requisitions/${requisitionId}`,
        headers: await harness.bearer(admin),
      }),
      harness.app.inject({
        method: 'GET',
        url: `/api/v1/requisitions/${publicId}`,
        headers: await harness.bearer(admin),
      }),
    ]);
    expect(byUuid.statusCode).toBe(200);
    expect(byPublicId.statusCode).toBe(200);
    expect(byPublicId.json()).toEqual(byUuid.json());
    expect(
      byPublicId.json<{ data: { id: string; publicId: string } }>().data,
    ).toMatchObject({ id: requisitionId, publicId });

    const patch = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/requisitions/${publicId}`,
      headers: await harness.bearer(admin),
      payload: { advertisedTitle: 'Patched Title' },
    });
    expect(patch.statusCode).toBe(200);
    expect(
      patch.json<{ data: { advertisedTitle: string } }>().data.advertisedTitle,
    ).toBe('Patched Title');

    // Transition by public id — the event row carries the internal uuid.
    const transition = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${publicId}/transition`,
      headers: await harness.bearer(admin),
      payload: { toStatus: 'sourcing' },
    });
    expect(transition.statusCode).toBe(200);
    const statusEvents = await db.sql<{ entity_id: string }[]>`
      select entity_id from events
      where entity_type = 'requisition'
        and entity_id = ${requisitionId}
        and event_type = 'status_changed'
        and to_value = 'sourcing'
    `;
    expect(statusEvents.length).toBeGreaterThan(0);

    // Assign a consenting candidate via the public-id URL.
    const candidateId = await insertCandidate(db.sql, { hasConsent: true });
    const assign = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/requisitions/${publicId}/assignments`,
      headers: await harness.bearer(admin),
      payload: { candidateIds: [candidateId] },
    });
    expect(assign.statusCode).toBe(201);
    const assignRows = assign.json<{
      data: { requisitionId: string; candidate: { id: string; publicId: string } }[];
    }>().data;
    expect(assignRows).toHaveLength(1);
    expect(assignRows[0]?.requisitionId).toBe(requisitionId);
    expect(assignRows[0]?.candidate.publicId).toMatch(PUBLIC_ID_REGEX);

    const assignments = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${publicId}/assignments`,
      headers: await harness.bearer(admin),
    });
    expect(assignments.statusCode).toBe(200);
    expect(
      assignments.json<{ meta: { count: number } }>().meta.count,
    ).toBe(1);

    const events = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${publicId}/events`,
      headers: await harness.bearer(admin),
    });
    expect(events.statusCode).toBe(200);
    const eventsByUuid = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/requisitions/${requisitionId}/events`,
      headers: await harness.bearer(admin),
    });
    expect(events.json()).toEqual(eventsByUuid.json());
  });

  it('an unknown-but-well-formed public id is a 404; malformed ids are a 400', async () => {
    const missing = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/candidates/zzzzzzzzzzzz',
      headers: await harness.bearer(admin),
    });
    expect(missing.statusCode).toBe(404);
    const malformed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/candidates/not-a-valid-ref',
      headers: await harness.bearer(admin),
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('tenant isolation is form-independent: a foreign public id leaks nothing', async () => {
    const foreignRequisition = await insertRequisition(db.sql, {
      clientId: clientB,
    });
    await expectTenantIsolated(harness.app, {
      url: `/api/v1/requisitions/${await publicIdOf('requisitions', foreignRequisition)}`,
      headers: await harness.bearer(clientUserA),
    });
    await expectTenantIsolated(harness.app, {
      url: `/api/v1/clients/${await publicIdOf('clients', clientB)}`,
      headers: await harness.bearer(clientUserA),
    });
    // Foreign WRITE by public id → 403 WRONG_TENANT, same as by uuid
    // (AC-AUTH-06 — invite is a write a client_admin's role can attempt).
    const write = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/clients/${await publicIdOf('clients', clientB)}/members/invite`,
      headers: await harness.bearer(clientUserA),
      payload: {
        email: 'foreign-invitee@example.com',
        fullName: 'Foreign Invitee',
        role: 'client_user',
      },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json<{ error: { code: string } }>().error.code).toBe(
      'WRONG_TENANT',
    );
  });
});

describe('list payloads — publicId travels with every row', () => {
  it('candidates, clients, and requisitions lists carry publicId', async () => {
    const [candidates, clients, requisitions] = await Promise.all([
      harness.app.inject({
        method: 'GET',
        url: '/api/v1/candidates',
        headers: await harness.bearer(admin),
      }),
      harness.app.inject({
        method: 'GET',
        url: '/api/v1/clients',
        headers: await harness.bearer(admin),
      }),
      harness.app.inject({
        method: 'GET',
        url: '/api/v1/requisitions',
        headers: await harness.bearer(admin),
      }),
    ]);
    for (const res of [candidates, clients, requisitions]) {
      expect(res.statusCode).toBe(200);
      const rows = res.json<{ data: { publicId: string }[] }>().data;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.publicId).toMatch(PUBLIC_ID_REGEX);
      }
    }
  });

  it('the client dashboard requisitions carry publicId', async () => {
    const requisitionId = await insertRequisition(db.sql, { clientId: clientA });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/client/dashboard',
      headers: await harness.bearer(clientUserA),
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json<{
      data: { requisitions: { id: string; publicId: string }[] };
    }>().data.requisitions;
    const created = rows.find((row) => row.id === requisitionId);
    expect(created?.publicId).toBe(
      await publicIdOf('requisitions', requisitionId),
    );
  });

  it('attention-queue items add requisitionPublicId; requisitionId stays a uuid', async () => {
    // `submitted` requisitions land in the new_intake_submissions bucket,
    // whose items are requisition-shaped (entityId = requisition uuid).
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'submitted',
    });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/admin/attention-queue?refresh=true',
      headers: await harness.bearer(admin),
    });
    expect(res.statusCode).toBe(200);
    const buckets = res.json<{
      data: {
        buckets: {
          key: string;
          items: {
            entityId: string;
            requisitionId?: string;
            requisitionPublicId?: string;
          }[];
        }[];
      };
    }>().data.buckets;
    const bucket = buckets.find((b) => b.key === 'new_intake_submissions');
    const item = bucket?.items.find((i) => i.entityId === requisitionId);
    expect(item, 'submitted requisition must appear in the queue').toBeDefined();
    expect(item?.requisitionPublicId).toBe(
      await publicIdOf('requisitions', requisitionId),
    );
    // The uuid field keeps its old shape for compatibility.
    expect(item?.requisitionId ?? requisitionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
