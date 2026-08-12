/**
 * AC-CA-07 — missing/wrong bearer → 401.
 * AC-CA-08 — same externalId twice → one candidate, updated on the second call.
 * AC-CA-09 — payload missing optional fields → 200 + data_completeness 'incomplete'.
 * AC-CA-10 — missing firstName/lastName → 422, no candidate created.
 * AC-CA-11 — unknown enum values dropped, listed in droppedFields, recorded in
 *            webhook_ingest_log.error_detail.
 * AC-CA-12 — every webhook request writes exactly one webhook_ingest_log row
 *            (success, partial, rejection).
 * AC-CA-13 — a webhook can never create an assignment or set a stage.
 *
 * Plus: primaryRoleCategoryKey resolution, server-side cvUrl fetch (canned
 * fetcher — success and failure), and the Idempotency-Key replay.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractCvText } from '../../src/jobs/extract-cv-text.js';
import type { CvFetcher } from '../../src/services/candidate-webhook.service.js';
import { TEST_ENV_VARS } from '../helpers.js';
import { insertTaxonomyChain } from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

const FIXTURE_PDF = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sample-cv.pdf'),
);

const TOKEN = TEST_ENV_VARS['WEBHOOK_INBOUND_TOKEN']!;
const GOOD = { authorization: `Bearer ${TOKEN}` };

let db: TestDb;
let harness: TestApp;
let roleCategoryKey: string;
let roleCategoryId: string;
const fetchedUrls: string[] = [];

const cvFetcher: CvFetcher = async (url) => {
  fetchedUrls.push(url);
  if (url.includes('unreachable')) {
    throw new Error('connect ECONNREFUSED');
  }
  return { bytes: new Uint8Array(FIXTURE_PDF), mimeType: 'application/pdf' };
};

interface WebhookReply {
  candidateReference: string;
  result: 'created' | 'updated';
  dataCompleteness: 'complete' | 'incomplete';
  droppedFields: string[];
}

async function post(
  payload: unknown,
  headers: Record<string, string> = GOOD,
): Promise<{ statusCode: number; body: WebhookReply & { error?: { code: string } } }> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/candidates/webhook',
    headers,
    payload: payload as Record<string, unknown>,
  });
  return { statusCode: res.statusCode, body: res.json() };
}

async function ingestLogCount(): Promise<number> {
  const rows = await db.sql<{ count: string }[]>`
    select count(*) as count from webhook_ingest_log
  `;
  return Number(rows[0]!.count);
}

beforeAll(async () => {
  db = await freshDb();
  const taxonomy = await insertTaxonomyChain(db.sql);
  roleCategoryKey = taxonomy.roleCategoryKey;
  roleCategoryId = taxonomy.roleCategoryId;
  harness = await buildTestApp(db, undefined, { cvFetcher });
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

describe('AC-CA-07 — bearer token', () => {
  it('rejects a missing token with 401', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/candidates/webhook',
      payload: { firstName: 'No', lastName: 'Token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('rejects a wrong token with 401', async () => {
    const { statusCode, body } = await post(
      { firstName: 'Wrong', lastName: 'Token' },
      { authorization: 'Bearer not-the-token' },
    );
    expect(statusCode).toBe(401);
    expect(body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('a user JWT is not a webhook token', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/candidates/webhook',
      headers: { authorization: `Bearer ${await harness.auth.signToken('x')}` },
      payload: { firstName: 'Jwt', lastName: 'User' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('unauthenticated requests wrote no candidates and no log rows', async () => {
    const rows = await db.sql`select id from candidates`;
    expect(rows).toHaveLength(0);
    expect(await ingestLogCount()).toBe(0);
  });
});

describe('AC-CA-09 — lenient minimum: names only → incomplete, 200', () => {
  it('creates the candidate with data_completeness incomplete', async () => {
    const { statusCode, body } = await post({ firstName: 'Lena', lastName: 'Bare' });
    expect(statusCode).toBe(200);
    expect(body.result).toBe('created');
    expect(body.dataCompleteness).toBe('incomplete');
    expect(body.candidateReference).toMatch(/^CAN-\d{6}$/);
    expect(body.droppedFields).toEqual([]);

    const rows = await db.sql<
      {
        data_completeness: string;
        pool_status: string;
        submitted_via: string;
        source: string;
      }[]
    >`
      select data_completeness, pool_status, submitted_via, source
      from candidates where reference = ${body.candidateReference}
    `;
    expect(rows[0]).toEqual({
      data_completeness: 'incomplete',
      pool_status: 'active',
      submitted_via: 'webhook',
      source: 'webhook',
    });
  });
});

describe('AC-CA-10 — missing firstName/lastName → 422, nothing created', () => {
  it('rejects and creates no candidate, but logs the rejection', async () => {
    const before = await ingestLogCount();
    const { statusCode, body } = await post({
      externalId: 'rej_1',
      firstName: 'OnlyFirst',
    });
    expect(statusCode).toBe(422);
    expect(body.error?.code).toBe('VALIDATION_FAILED');

    const rows = await db.sql`
      select id from candidates where first_name = 'OnlyFirst'
    `;
    expect(rows).toHaveLength(0);

    expect(await ingestLogCount()).toBe(before + 1);
    const log = await db.sql<{ result: string; error_detail: string | null }[]>`
      select result, error_detail from webhook_ingest_log
      where external_id = 'rej_1'
    `;
    expect(log[0]!.result).toBe('rejected');
    expect(log[0]!.error_detail).toContain('required');
  });
});

describe('AC-CA-08 — upsert on externalId', () => {
  it('the same externalId creates once and updates on the second call', async () => {
    const first = await post({
      externalId: 'src_9931',
      source: 'linkedin',
      firstName: 'Maria',
      lastName: 'Gomez',
      email: 'maria@example.com',
      phone: '+52-55-1234',
      country: 'Mexico',
      englishSpokenLevel: 'professional',
      accentStrength: 'light',
      yearsExperienceTotal: 6,
      expectedRateAmount: 2200,
      expectedRateUnit: 'monthly',
      primaryRoleCategoryKey: roleCategoryKey,
    });
    expect(first.statusCode).toBe(200);
    expect(first.body.result).toBe('created');
    expect(first.body.dataCompleteness).toBe('complete');

    const second = await post({
      externalId: 'src_9931',
      source: 'linkedin',
      firstName: 'Maria',
      lastName: 'Gomez',
      email: 'maria@example.com',
      phone: '+52-55-9999',
      country: 'Mexico',
      englishSpokenLevel: 'professional',
      yearsExperienceTotal: 6,
      expectedRateAmount: 2400,
      expectedRateUnit: 'monthly',
      primaryRoleCategoryKey: roleCategoryKey,
    });
    expect(second.statusCode).toBe(200);
    expect(second.body.result).toBe('updated');
    expect(second.body.candidateReference).toBe(first.body.candidateReference);

    const rows = await db.sql<
      { phone: string; expected_rate_amount: string; primary_role_category_id: string }[]
    >`
      select phone, expected_rate_amount, primary_role_category_id
      from candidates where external_id = 'src_9931'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phone).toBe('+52-55-9999');
    expect(Number(rows[0]!.expected_rate_amount)).toBe(2400);
    expect(rows[0]!.primary_role_category_id).toBe(roleCategoryId);
  });
});

describe('AC-CA-11 — unknown enum values are dropped and recorded', () => {
  it('drops bad enums, lists them in droppedFields, and records error_detail', async () => {
    const { statusCode, body } = await post({
      externalId: 'src_enum',
      firstName: 'Enny',
      lastName: 'Umms',
      email: 'enny@example.com',
      englishSpokenLevel: 'super-fluent',
      accentStrength: 'thick',
      expectedRateUnit: 'weekly',
      source: 'carrier_pigeon',
    });
    expect(statusCode).toBe(200);
    expect(body.result).toBe('created');
    expect(body.dataCompleteness).toBe('incomplete');
    expect(body.droppedFields.sort()).toEqual([
      'accentStrength',
      'englishSpokenLevel',
      'expectedRateUnit',
      'source',
    ]);

    const rows = await db.sql<
      {
        english_spoken_level: string | null;
        accent_strength: string | null;
        expected_rate_unit: string | null;
        source: string;
        email: string;
      }[]
    >`
      select english_spoken_level, accent_strength, expected_rate_unit,
             source, email::text as email
      from candidates where external_id = 'src_enum'
    `;
    // Dropped, never coerced — while valid fields were kept.
    expect(rows[0]).toEqual({
      english_spoken_level: null,
      accent_strength: null,
      expected_rate_unit: null,
      source: 'webhook',
      email: 'enny@example.com',
    });

    const log = await db.sql<{ error_detail: string | null }[]>`
      select error_detail from webhook_ingest_log where external_id = 'src_enum'
    `;
    for (const field of ['accentStrength', 'englishSpokenLevel', 'expectedRateUnit', 'source']) {
      expect(log[0]!.error_detail).toContain(field);
    }
  });

  it('an unresolvable primaryRoleCategoryKey is left null and flagged', async () => {
    const { statusCode, body } = await post({
      externalId: 'src_role',
      firstName: 'Role',
      lastName: 'Less',
      primaryRoleCategoryKey: 'does_not_exist',
    });
    expect(statusCode).toBe(200);
    expect(body.droppedFields).toContain('primaryRoleCategoryKey');

    const rows = await db.sql<{ primary_role_category_id: string | null }[]>`
      select primary_role_category_id from candidates where external_id = 'src_role'
    `;
    expect(rows[0]!.primary_role_category_id).toBeNull();
  });
});

describe('cvUrl handling (behaviour 5)', () => {
  it('fetches the CV server-side, stores it, links it, and queues extraction', async () => {
    const { statusCode, body } = await post({
      externalId: 'src_cv',
      firstName: 'Curri',
      lastName: 'Culum',
      cvUrl: 'https://files.example.com/cv-9931.pdf',
    });
    expect(statusCode).toBe(200);
    expect(fetchedUrls).toContain('https://files.example.com/cv-9931.pdf');

    const candidate = await db.sql<{ id: string; cv_primary_file_id: string | null }[]>`
      select id, cv_primary_file_id from candidates where external_id = 'src_cv'
    `;
    expect(candidate[0]!.cv_primary_file_id).not.toBeNull();

    const files = await db.sql<
      { file_type: string; mime_type: string; virus_scan_status: string; size_bytes: string }[]
    >`
      select file_type, mime_type, virus_scan_status, size_bytes::text as size_bytes
      from candidate_files where candidate_id = ${candidate[0]!.id}
    `;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      file_type: 'cv',
      mime_type: 'application/pdf',
      virus_scan_status: 'complete',
    });
    expect(Number(files[0]!.size_bytes)).toBe(FIXTURE_PDF.byteLength);
    expect(harness.storage.calls.uploadObject.length).toBeGreaterThan(0);

    // The queued extraction is picked up by the job and lands in cv_search.
    const processed = await extractCvText(db.sql, harness.storage);
    expect(processed).toBe(1);
    const searchable = await db.sql<{ ok: boolean }[]>`
      select cv_search @@ plainto_tsquery('english', 'Xochimilco') as ok
      from candidates where id = ${candidate[0]!.id}
    `;
    expect(searchable[0]!.ok).toBe(true);
    expect(body.result).toBe('created');
  });

  it('a failing cvUrl fetch does NOT fail the request', async () => {
    const { statusCode, body } = await post({
      externalId: 'src_cv_fail',
      firstName: 'Fetch',
      lastName: 'Fails',
      cvUrl: 'https://unreachable.example.com/cv.pdf',
    });
    expect(statusCode).toBe(200);
    expect(body.result).toBe('created');

    const candidate = await db.sql<{ id: string }[]>`
      select id from candidates where external_id = 'src_cv_fail'
    `;
    const files = await db.sql`
      select id from candidate_files where candidate_id = ${candidate[0]!.id}
    `;
    expect(files).toHaveLength(0);

    const log = await db.sql<{ result: string; error_detail: string | null }[]>`
      select result, error_detail from webhook_ingest_log
      where external_id = 'src_cv_fail'
    `;
    expect(log[0]!.result).toBe('created');
    expect(log[0]!.error_detail).toContain('cv fetch failed');
  });
});

describe('Idempotency-Key header is honoured (04 §1)', () => {
  it('a replayed key does not re-apply the payload', async () => {
    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/candidates/webhook',
      headers: { ...GOOD, 'idempotency-key': 'idem-001' },
      payload: { externalId: 'src_idem', firstName: 'Ida', lastName: 'Once' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<WebhookReply>().result).toBe('created');

    const replay = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/candidates/webhook',
      headers: { ...GOOD, 'idempotency-key': 'idem-001' },
      payload: { externalId: 'src_idem', firstName: 'CHANGED', lastName: 'Name' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<WebhookReply>().result).toBe('created');
    expect(replay.json<WebhookReply>().candidateReference).toBe(
      first.json<WebhookReply>().candidateReference,
    );

    // The replayed payload was NOT applied.
    const rows = await db.sql<{ first_name: string }[]>`
      select first_name from candidates where external_id = 'src_idem'
    `;
    expect(rows[0]!.first_name).toBe('Ida');
  });
});

describe('AC-CA-12 — exactly one ingest-log row per request', () => {
  it('success, partial (dropped fields), and rejection each wrote one row', async () => {
    const before = await ingestLogCount();

    // Success.
    await post({ externalId: 'log_ok', firstName: 'Log', lastName: 'Ok' });
    expect(await ingestLogCount()).toBe(before + 1);

    // Partial: dropped enum.
    await post({
      externalId: 'log_partial',
      firstName: 'Log',
      lastName: 'Partial',
      accentStrength: 'nope',
    });
    expect(await ingestLogCount()).toBe(before + 2);

    // Rejection.
    await post({ externalId: 'log_reject', lastName: 'NoFirst' });
    expect(await ingestLogCount()).toBe(before + 3);

    const results = await db.sql<{ external_id: string; result: string }[]>`
      select external_id, result from webhook_ingest_log
      where external_id in ('log_ok', 'log_partial', 'log_reject')
      order by external_id
    `;
    expect(results).toEqual([
      { external_id: 'log_ok', result: 'created' },
      { external_id: 'log_partial', result: 'created' },
      { external_id: 'log_reject', result: 'rejected' },
    ]);
  });
});

describe('AC-CA-13 — a webhook can never create an assignment', () => {
  it('zero assignment rows exist after every webhook in this suite', async () => {
    const assignments = await db.sql<{ count: string }[]>`
      select count(*) as count from assignments
    `;
    expect(Number(assignments[0]!.count)).toBe(0);

    const candidates = await db.sql<{ count: string }[]>`
      select count(*) as count from candidates
    `;
    // Every successful webhook above created a pool candidate…
    expect(Number(candidates[0]!.count)).toBeGreaterThanOrEqual(7);
    // …and none of them is visible to any client.
    const visible = await db.sql<{ count: string }[]>`
      select count(*) as count from client_visible_assignments
    `;
    expect(Number(visible[0]!.count)).toBe(0);
  });
});
