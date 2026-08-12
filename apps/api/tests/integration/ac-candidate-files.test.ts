/**
 * AC-CA-03 — upload URL refused: 415 for a MIME outside NFR-5, 413 above NFR-4.
 * AC-CA-04 — a confirmed CV upload populates cv_search via the extract-cv-text
 *            job and becomes findable by a distinctive word from a REAL
 *            fixture PDF.
 * AC-CA-05 — download URLs expire in 300 seconds.
 * AC-CA-06 — a client user cannot obtain a download URL for a non-client-
 *            visible file, nor for a candidate without a client-visible
 *            assignment to their client (both cases).
 *
 * Storage is the in-memory stub from tests/helpers.ts: signed URLs are
 * recorded, "browser uploads" are simulated with putObject, and the
 * extraction job downloads the fixture bytes from it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractCvText } from '../../src/jobs/extract-cv-text.js';
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

const FIXTURE_PDF = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sample-cv.pdf'),
);

let db: TestDb;
let harness: TestApp;
let admin: string;
let adminHeaders: Record<string, string>;
let clientAUserHeaders: Record<string, string>;
let clientBUserHeaders: Record<string, string>;
let clientA: string;
let candidateId: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  clientA = await insertClient(db.sql);
  const clientB = await insertClient(db.sql);
  const clientAUser = await insertUser(db.sql);
  const clientBUser = await insertUser(db.sql);
  await assignRole(db.sql, clientAUser, 'client_user', clientA);
  await assignRole(db.sql, clientBUser, 'client_user', clientB);
  await insertClientMember(db.sql, { clientId: clientA, userId: clientAUser });
  await insertClientMember(db.sql, { clientId: clientB, userId: clientBUser });

  candidateId = await insertCandidate(db.sql, {
    firstName: 'Maria',
    lastName: 'Gomez',
  });
  // A client-visible assignment (stage 'presented') to client A only.
  const requisitionId = await insertRequisition(db.sql, {
    clientId: clientA,
    status: 'candidates_presented',
  });
  await insertAssignment(db.sql, {
    requisitionId,
    candidateId,
    assignedBy: admin,
    stage: 'presented',
  });

  harness = await buildTestApp(db);
  adminHeaders = await harness.bearer(admin);
  clientAUserHeaders = await harness.bearer(clientAUser);
  clientBUserHeaders = await harness.bearer(clientBUser);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

interface UploadUrlData {
  fileId: string;
  uploadUrl: string;
  token: string;
  storagePath: string;
}

async function requestUploadUrl(
  body: Record<string, unknown>,
): Promise<{ statusCode: number; data?: UploadUrlData; errorCode?: string }> {
  const res = await harness.app.inject({
    method: 'POST',
    url: `/api/v1/candidates/${candidateId}/files/upload-url`,
    headers: adminHeaders,
    payload: body,
  });
  if (res.statusCode === 201) {
    return { statusCode: 201, data: res.json<{ data: UploadUrlData }>().data };
  }
  return {
    statusCode: res.statusCode,
    errorCode: res.json<{ error: { code: string } }>().error.code,
  };
}

/** Full happy-path upload: URL → simulated browser PUT → confirm. */
async function uploadAndConfirm(
  fileType: string,
  bytes: Buffer,
  mimeType: string,
): Promise<UploadUrlData> {
  const issued = await requestUploadUrl({
    fileType,
    originalFilename: mimeType === 'application/pdf' ? 'cv resume.pdf' : 'file.bin',
    mimeType,
    sizeBytes: bytes.byteLength,
  });
  expect(issued.statusCode).toBe(201);
  const data = issued.data!;
  harness.storage.putObject(data.storagePath, new Uint8Array(bytes), mimeType);
  const confirm = await harness.app.inject({
    method: 'POST',
    url: `/api/v1/candidates/${candidateId}/files/${data.fileId}/confirm`,
    headers: adminHeaders,
  });
  expect(confirm.statusCode, confirm.body).toBe(200);
  expect(
    confirm.json<{ data: { virusScanStatus: string } }>().data.virusScanStatus,
  ).toBe('complete');
  return data;
}

describe('AC-CA-03 — upload URL is refused outside NFR-4/NFR-5', () => {
  it('415 UNSUPPORTED_MEDIA_TYPE for a MIME type outside NFR-5', async () => {
    const res = await requestUploadUrl({
      fileType: 'other',
      originalFilename: 'archive.zip',
      mimeType: 'application/zip',
      sizeBytes: 1024,
    });
    expect(res.statusCode).toBe(415);
    expect(res.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('413 FILE_TOO_LARGE above the 25MB NFR-4 cap', async () => {
    const res = await requestUploadUrl({
      fileType: 'cv',
      originalFilename: 'big.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 25 * 1024 * 1024 + 1,
    });
    expect(res.statusCode).toBe(413);
    expect(res.errorCode).toBe('FILE_TOO_LARGE');
  });

  it('neither refusal leaves a candidate_files row', async () => {
    const rows = await db.sql`
      select id from candidate_files where candidate_id = ${candidateId}
    `;
    expect(rows).toHaveLength(0);
  });

  it('exactly 25MB is accepted', async () => {
    const res = await requestUploadUrl({
      fileType: 'cv',
      originalFilename: 'exact.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 25 * 1024 * 1024,
    });
    expect(res.statusCode).toBe(201);
    // Clean up the pending row so later counts stay readable.
    await db.sql`delete from candidate_files where id = ${res.data!.fileId}`;
  });
});

describe('upload flow: signed URL → confirm', () => {
  it('issues a signed URL with a pending row, then confirm completes it', async () => {
    const issued = await requestUploadUrl({
      fileType: 'cv',
      originalFilename: 'cv resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: FIXTURE_PDF.byteLength,
    });
    expect(issued.statusCode).toBe(201);
    const data = issued.data!;
    expect(data.uploadUrl).toContain('upload');
    expect(data.token).not.toBe('');
    expect(data.storagePath).toContain(candidateId);
    expect(harness.storage.calls.createSignedUploadUrl).toContain(data.storagePath);

    const pending = await db.sql<{ virus_scan_status: string }[]>`
      select virus_scan_status from candidate_files where id = ${data.fileId}
    `;
    expect(pending[0]!.virus_scan_status).toBe('pending');

    // Confirm BEFORE the upload → 422, row stays pending.
    const early = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/files/${data.fileId}/confirm`,
      headers: adminHeaders,
    });
    expect(early.statusCode).toBe(422);

    // Simulated browser upload with the WRONG size → 422.
    harness.storage.putObject(
      data.storagePath,
      new Uint8Array(FIXTURE_PDF.subarray(0, 100)),
      'application/pdf',
    );
    const mismatch = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/files/${data.fileId}/confirm`,
      headers: adminHeaders,
    });
    expect(mismatch.statusCode).toBe(422);

    // Correct bytes → confirm completes, cv becomes primary, extraction queued.
    harness.storage.putObject(
      data.storagePath,
      new Uint8Array(FIXTURE_PDF),
      'application/pdf',
    );
    const confirm = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/files/${data.fileId}/confirm`,
      headers: adminHeaders,
    });
    expect(confirm.statusCode, confirm.body).toBe(200);

    const candidate = await db.sql<{ cv_primary_file_id: string | null }[]>`
      select cv_primary_file_id from candidates where id = ${candidateId}
    `;
    expect(candidate[0]!.cv_primary_file_id).toBe(data.fileId);

    const events = await db.sql<{ event_type: string }[]>`
      select event_type from events
      where entity_type = 'candidate' and entity_id = ${candidateId}
    `;
    const types = events.map((e) => e.event_type);
    expect(types).toContain('file_upload_requested');
    expect(types).toContain('file_uploaded');
    expect(types).toContain('cv_text_extraction_queued');
  });
});

describe('AC-CA-04 — a CV upload populates cv_search (real fixture PDF)', () => {
  it('the extraction job appends the PDF text and the candidate becomes searchable', async () => {
    // The previous describe confirmed the upload; run the job the cron would.
    const processed = await extractCvText(db.sql, harness.storage);
    expect(processed).toBe(1);

    // Distinctive word from the fixture PDF: 'Xochimilco'.
    const viaSearch = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/candidates?search=Xochimilco',
      headers: adminHeaders,
    });
    expect(viaSearch.statusCode).toBe(200);
    const found = viaSearch.json<{ data: { id: string }[] }>().data;
    expect(found.map((c) => c.id)).toContain(candidateId);

    // The trigger-built name weight survived the append.
    const viaName = await db.sql<{ ok: boolean }[]>`
      select cv_search @@ plainto_tsquery('english', 'Maria') as ok
      from candidates where id = ${candidateId}
    `;
    expect(viaName[0]!.ok).toBe(true);

    const extractedEvent = await db.sql<{ metadata: { characters: number } }[]>`
      select metadata from events
      where entity_type = 'candidate' and entity_id = ${candidateId}
        and event_type = 'cv_text_extracted'
    `;
    expect(extractedEvent).toHaveLength(1);
    expect(extractedEvent[0]!.metadata.characters).toBeGreaterThan(50);

    // Idempotent: nothing left to process.
    expect(await extractCvText(db.sql, harness.storage)).toBe(0);
  });

  it('a name change re-queues extraction so cv text survives the trigger rebuild', async () => {
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${candidateId}`,
      headers: adminHeaders,
      payload: { currentTitle: 'Senior Executive Assistant' },
    });
    expect(res.statusCode).toBe(200);

    // The trigger rebuilt cv_search without the CV text…
    const dropped = await db.sql<{ ok: boolean }[]>`
      select cv_search @@ plainto_tsquery('english', 'Xochimilco') as ok
      from candidates where id = ${candidateId}
    `;
    expect(dropped[0]!.ok).toBe(false);

    // …and the service re-queued extraction; the job restores it.
    expect(await extractCvText(db.sql, harness.storage)).toBe(1);
    const restored = await db.sql<{ ok: boolean }[]>`
      select cv_search @@ plainto_tsquery('english', 'Xochimilco') as ok
      from candidates where id = ${candidateId}
    `;
    expect(restored[0]!.ok).toBe(true);
  });
});

describe('AC-CA-05 — download URLs expire in 300 seconds', () => {
  it('admin gets a signed URL created with a 300s TTL', async () => {
    const fileId = (
      await db.sql<{ id: string }[]>`
        select id from candidate_files
        where candidate_id = ${candidateId} and file_type = 'cv'
      `
    )[0]!.id;

    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/files/${fileId}/download-url`,
      headers: adminHeaders,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { data } = res.json<{
      data: { url: string; expiresInSeconds: number };
    }>();
    expect(data.expiresInSeconds).toBe(300);
    const call = harness.storage.calls.createSignedDownloadUrl.at(-1)!;
    expect(call.expiresInSeconds).toBe(300);
    expect(data.url).toContain('expires_in=300');
  });
});

describe('AC-CA-06 — client download rules (both refusal cases)', () => {
  let cvFileId: string;

  beforeAll(async () => {
    cvFileId = (
      await db.sql<{ id: string }[]>`
        select id from candidate_files
        where candidate_id = ${candidateId} and file_type = 'cv'
      `
    )[0]!.id;
  });

  it('case 1: the file is NOT isClientVisible → 404, even with a visible assignment', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/files/${cvFileId}/download-url`,
      headers: clientAUserHeaders,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ data?: unknown }>().data).toBeUndefined();
  });

  it('a client-visible file of a client-visibly assigned candidate IS downloadable', async () => {
    const patch = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${candidateId}/files/${cvFileId}`,
      headers: adminHeaders,
      payload: { isClientVisible: true },
    });
    expect(patch.statusCode).toBe(200);

    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/files/${cvFileId}/download-url`,
      headers: clientAUserHeaders,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(
      res.json<{ data: { expiresInSeconds: number } }>().data.expiresInSeconds,
    ).toBe(300);
  });

  it('case 2: no client-visible assignment to the CALLER → 404 (client B)', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/files/${cvFileId}/download-url`,
      headers: clientBUserHeaders,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ data?: unknown }>().data).toBeUndefined();
  });

  it('a pre-presented assignment does not unlock downloads', async () => {
    // Second candidate: client-visible FILE but the assignment is only 'sourced'.
    const hiddenCandidate = await insertCandidate(db.sql);
    const requisitionId = await insertRequisition(db.sql, {
      clientId: clientA,
      status: 'sourcing',
    });
    await insertAssignment(db.sql, {
      requisitionId,
      candidateId: hiddenCandidate,
      assignedBy: admin,
      stage: 'sourced',
    });
    const fileId = randomUUID();
    await db.sql`
      insert into candidate_files
        (id, candidate_id, file_type, storage_path, original_filename,
         mime_type, size_bytes, is_client_visible, virus_scan_status)
      values (${fileId}, ${hiddenCandidate}, 'cv', ${'candidates/x/' + fileId},
              'cv.pdf', 'application/pdf', 100, true, 'complete')
    `;
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/files/${fileId}/download-url`,
      headers: clientAUserHeaders,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('file PATCH and DELETE', () => {
  it('PATCH changes fileType; DELETE removes the object and the row', async () => {
    const uploaded = await uploadAndConfirm(
      'writing_sample',
      Buffer.from('sample text bytes'),
      'application/pdf',
    );

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${candidateId}/files/${uploaded.fileId}`,
      headers: adminHeaders,
      payload: { fileType: 'portfolio' },
    });
    expect(patched.statusCode).toBe(200);
    expect(
      patched.json<{ data: { fileType: string } }>().data.fileType,
    ).toBe('portfolio');

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/candidates/${candidateId}/files/${uploaded.fileId}`,
      headers: adminHeaders,
    });
    expect(deleted.statusCode).toBe(204);
    expect(harness.storage.calls.removeObject).toContain(uploaded.storagePath);
    expect(harness.storage.objects.has(uploaded.storagePath)).toBe(false);

    const rows = await db.sql`
      select id from candidate_files where id = ${uploaded.fileId}
    `;
    expect(rows).toHaveLength(0);

    const events = await db.sql<{ event_type: string }[]>`
      select event_type from events
      where entity_type = 'candidate' and entity_id = ${candidateId}
        and event_type in ('file_updated', 'file_deleted')
    `;
    const types = events.map((e) => e.event_type);
    expect(types).toContain('file_updated');
    expect(types).toContain('file_deleted');
  });

  it('deleting the primary CV clears cv_primary_file_id', async () => {
    const before = await db.sql<{ cv_primary_file_id: string | null }[]>`
      select cv_primary_file_id from candidates where id = ${candidateId}
    `;
    const primaryId = before[0]!.cv_primary_file_id!;
    expect(primaryId).not.toBeNull();

    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/candidates/${candidateId}/files/${primaryId}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(204);

    const after = await db.sql<{ cv_primary_file_id: string | null }[]>`
      select cv_primary_file_id from candidates where id = ${candidateId}
    `;
    expect(after[0]!.cv_primary_file_id).toBeNull();
  });

  it('a client-scoped caller cannot use the admin file surface', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/candidates/${candidateId}/files`,
      headers: clientAUserHeaders,
    });
    expect(res.statusCode).toBe(404);
  });
});
