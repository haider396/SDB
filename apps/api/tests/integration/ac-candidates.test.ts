/**
 * AC-CA-01 — candidate creatable with only firstName + lastName.
 * AC-CA-02 — display_name generated `<first or preferred> <last initial>.`,
 *            not writable.
 * AC-CA-14 — search filters combine correctly over the 25-candidate dev seed.
 *
 * Plus the §8 CRUD surface: child collections, consent, archive, completeness
 * recomputation, the flag-incomplete-candidates job, event emission, and the
 * pool-is-admin-only rule (a client-scoped caller never sees internal
 * candidates — CLAUDE.md rule 3).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flagIncompleteCandidates } from '../../src/jobs/flag-incomplete-candidates.js';
import {
  assignRole,
  insertClient,
  insertClientMember,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

// Fixed dev-seed ids (supabase/seed/dev_seed.sql).
const ROLE_EA = '00000000-0000-4000-8000-000000000311';
const TOOL_CLICKUP = '00000000-0000-4000-8000-000000000903';
const TOOL_SLACK = '00000000-0000-4000-8000-000000000905';
const SKILL_1 = '00000000-0000-4000-8000-000000000921';

let db: TestDb;
let harness: TestApp;
let admin: string;
let adminHeaders: Record<string, string>;
let clientUserHeaders: Record<string, string>;

beforeAll(async () => {
  db = await freshDb({ seed: true });
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');
  const clientId = await insertClient(db.sql);
  const clientUser = await insertUser(db.sql);
  await assignRole(db.sql, clientUser, 'client_user', clientId);
  await insertClientMember(db.sql, { clientId, userId: clientUser });

  harness = await buildTestApp(db);
  adminHeaders = await harness.bearer(admin);
  clientUserHeaders = await harness.bearer(clientUser);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

interface CandidatePayload {
  id: string;
  reference: string;
  displayName: string;
  firstName: string;
  source: string;
  submittedVia: string;
  dataCompleteness: string;
  poolStatus: string;
  consentCapturedAt: string | null;
  hasConsentToShareProfile: boolean;
  archivedAt: string | null;
  country: string | null;
  accentStrength: string | null;
  englishSpokenLevel: string | null;
  expectedRateAmount: number | null;
  expectedRateUnit: string | null;
  primaryRoleCategoryId: string | null;
}

async function createCandidate(
  body: Record<string, unknown>,
): Promise<CandidatePayload> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/api/v1/candidates',
    headers: adminHeaders,
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ data: CandidatePayload }>().data;
}

describe('AC-CA-01 — a candidate is creatable with only firstName and lastName', () => {
  it('creates with the minimal body; source is explicit, never the column default', async () => {
    const data = await createCandidate({ firstName: 'Zoe', lastName: 'Quill' });
    expect(data.reference).toMatch(/^CAN-\d{6}$/);
    expect(data.firstName).toBe('Zoe');
    expect(data.source).toBe('other');
    expect(data.submittedVia).toBe('manual');
    expect(data.poolStatus).toBe('active');
    // Only name fields present → completeness is computed as incomplete.
    expect(data.dataCompleteness).toBe('incomplete');

    const rows = await db.sql<{ source: string }[]>`
      select source from candidates where id = ${data.id}
    `;
    expect(rows[0]!.source).toBe('other');

    const events = await db.sql<{ event_type: string }[]>`
      select event_type from events
      where entity_type = 'candidate' and entity_id = ${data.id}
    `;
    expect(events.map((e) => e.event_type)).toContain('candidate_created');
  });

  it('rejects a body without lastName', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/candidates',
      headers: adminHeaders,
      payload: { firstName: 'Solo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'MALFORMED_REQUEST',
    );
  });

  it('references are sequential and unique across creations', async () => {
    const first = await createCandidate({ firstName: 'Seq', lastName: 'One' });
    const second = await createCandidate({ firstName: 'Seq', lastName: 'Two' });
    const n1 = Number(first.reference.slice(4));
    const n2 = Number(second.reference.slice(4));
    expect(n2).toBe(n1 + 1);
  });
});

describe('AC-CA-02 — display_name is generated and not writable', () => {
  it('generates `<first> <last initial>.` and prefers preferredName', async () => {
    const plain = await createCandidate({ firstName: 'Robert', lastName: 'Smith' });
    expect(plain.displayName).toBe('Robert S.');

    const preferred = await createCandidate({
      firstName: 'Robert',
      lastName: 'Smith',
      preferredName: 'Bob',
    });
    expect(preferred.displayName).toBe('Bob S.');
  });

  it('displayName in a write body is not accepted', async () => {
    const candidate = await createCandidate({ firstName: 'Gen', lastName: 'Erated' });
    // displayName is not a writable key: stripped by the schema, leaving an
    // empty patch, which the contract rejects.
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${candidate.id}`,
      headers: adminHeaders,
      payload: { displayName: 'Hacked H.' },
    });
    expect(res.statusCode).toBe(400);

    // And a mixed body updates the real field while ignoring displayName.
    const mixed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${candidate.id}`,
      headers: adminHeaders,
      payload: { displayName: 'Hacked H.', preferredName: 'Genny' },
    });
    expect(mixed.statusCode).toBe(200);
    expect(mixed.json<{ data: CandidatePayload }>().data.displayName).toBe(
      'Genny E.',
    );
  });

  it('the column is generated in SQL — a direct write fails', async () => {
    let failed = false;
    try {
      await db.sql`update candidates set display_name = 'X' where true`;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});

describe('candidate CRUD, consent, archive, completeness', () => {
  it('GET /candidates/:id returns the full record with child collections', async () => {
    const candidate = await createCandidate({ firstName: 'Full', lastName: 'Record' });
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/candidates/${candidate.id}`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{
      data: Record<string, unknown> & { languages: unknown[]; files: unknown[] };
    }>();
    for (const key of [
      'languages',
      'tools',
      'skills',
      'employmentHistory',
      'education',
      'certifications',
      'references',
      'notes',
      'disqualifierChecks',
      'assessments',
      'files',
    ]) {
      expect(Array.isArray(data[key]), key).toBe(true);
    }
  });

  it('PATCH updates fields, recomputes completeness, and writes events', async () => {
    const candidate = await createCandidate({ firstName: 'Patch', lastName: 'Me' });
    expect(candidate.dataCompleteness).toBe('incomplete');

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${candidate.id}`,
      headers: adminHeaders,
      payload: {
        email: 'patch.me@example.com',
        phone: '+52-555-0101',
        country: 'Mexico',
        englishSpokenLevel: 'professional',
        yearsExperienceTotal: 4,
        expectedRateAmount: 1500,
        expectedRateUnit: 'monthly',
        primaryRoleCategoryId: ROLE_EA,
        vettingStatus: 'in_progress',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json<{ data: CandidatePayload }>().data;
    expect(updated.dataCompleteness).toBe('complete');

    const events = await db.sql<{ event_type: string }[]>`
      select event_type from events
      where entity_type = 'candidate' and entity_id = ${candidate.id}
    `;
    const types = events.map((e) => e.event_type);
    expect(types).toContain('candidate_updated');
    expect(types).toContain('vetting_status_changed');
    expect(types).toContain('data_completeness_changed');
  });

  it('POST /candidates/:id/consent sets consent_captured_at and writes an event', async () => {
    const candidate = await createCandidate({ firstName: 'Con', lastName: 'Sent' });
    expect(candidate.consentCapturedAt).toBeNull();

    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidate.id}/consent`,
      headers: adminHeaders,
      payload: { hasConsentToShareProfile: true, consentSource: 'Signed form' },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: CandidatePayload }>().data;
    expect(data.hasConsentToShareProfile).toBe(true);
    expect(data.consentCapturedAt).not.toBeNull();

    const events = await db.sql<{ event_type: string }[]>`
      select event_type from events
      where entity_type = 'candidate' and entity_id = ${candidate.id}
        and event_type = 'consent_captured'
    `;
    expect(events).toHaveLength(1);
  });

  it('POST /candidates/:id/archive soft-deletes; the candidate then 404s', async () => {
    const candidate = await createCandidate({ firstName: 'Arch', lastName: 'Ive' });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidate.id}/archive`,
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: CandidatePayload }>().data.archivedAt).not.toBeNull();

    const gone = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/candidates/${candidate.id}`,
      headers: adminHeaders,
    });
    expect(gone.statusCode).toBe(404);

    const row = await db.sql<{ archived_at: Date | null }[]>`
      select archived_at from candidates where id = ${candidate.id}
    `;
    expect(row[0]!.archived_at).not.toBeNull();
  });

  it('flag-incomplete-candidates recomputes completeness and writes events', async () => {
    const candidate = await createCandidate({ firstName: 'Job', lastName: 'Flags' });
    // Force a wrong value directly, as if history predated the rule.
    await db.sql`
      update candidates set data_completeness = 'complete' where id = ${candidate.id}
    `;
    const changed = await flagIncompleteCandidates(db.sql);
    expect(changed).toBeGreaterThanOrEqual(1);

    const row = await db.sql<{ data_completeness: string }[]>`
      select data_completeness from candidates where id = ${candidate.id}
    `;
    expect(row[0]!.data_completeness).toBe('incomplete');

    const events = await db.sql<{ from_value: string; to_value: string }[]>`
      select from_value, to_value from events
      where entity_type = 'candidate' and entity_id = ${candidate.id}
        and event_type = 'data_completeness_changed'
      order by occurred_at desc
    `;
    expect(events[0]).toMatchObject({
      from_value: 'complete',
      to_value: 'incomplete',
    });

    // Idempotent: a second run changes nothing for this candidate.
    await db.sql`select 1`;
    const again = await flagIncompleteCandidates(db.sql);
    const after = await db.sql<{ data_completeness: string }[]>`
      select data_completeness from candidates where id = ${candidate.id}
    `;
    expect(after[0]!.data_completeness).toBe('incomplete');
    expect(again).toBeGreaterThanOrEqual(0);
  });
});

describe('child collections', () => {
  let candidateId: string;

  beforeAll(async () => {
    const candidate = await createCandidate({ firstName: 'Child', lastName: 'Rows' });
    candidateId = candidate.id;
  });

  it('languages: POST, PATCH, DELETE with events', async () => {
    const added = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/languages`,
      headers: adminHeaders,
      payload: { language: 'Spanish', spokenLevel: 'native_equivalent', isNative: true },
    });
    expect(added.statusCode, added.body).toBe(201);
    const list = added.json<{ data: { id: string; language: string }[] }>().data;
    expect(list).toHaveLength(1);

    // Duplicate language → 422, not 500 (unique candidate_id+language).
    const dup = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/languages`,
      headers: adminHeaders,
      payload: { language: 'Spanish' },
    });
    expect(dup.statusCode).toBe(422);

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${candidateId}/languages/${list[0]!.id}`,
      headers: adminHeaders,
      payload: { writtenLevel: 'professional' },
    });
    expect(patched.statusCode).toBe(200);

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/candidates/${candidateId}/languages/${list[0]!.id}`,
      headers: adminHeaders,
    });
    expect(deleted.statusCode).toBe(204);

    const events = await db.sql<{ event_type: string }[]>`
      select event_type from events
      where entity_type = 'candidate' and entity_id = ${candidateId}
        and event_type like 'language_%'
    `;
    expect(events.map((e) => e.event_type).sort()).toEqual([
      'language_added',
      'language_removed',
      'language_updated',
    ]);
  });

  it('tools: PUT replaces the full set', async () => {
    const first = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/candidates/${candidateId}/tools`,
      headers: adminHeaders,
      payload: {
        tools: [
          { toolId: TOOL_CLICKUP, proficiency: 'expert', yearsUsed: 3 },
          { toolId: TOOL_SLACK, proficiency: 'proficient' },
        ],
      },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ data: unknown[] }>().data).toHaveLength(2);

    const replaced = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/candidates/${candidateId}/tools`,
      headers: adminHeaders,
      payload: { tools: [{ toolId: TOOL_SLACK, proficiency: 'expert' }] },
    });
    expect(replaced.statusCode).toBe(200);
    const tools = replaced.json<{ data: { toolId: string }[] }>().data;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.toolId).toBe(TOOL_SLACK);

    // Unknown tool id → 422, not 500.
    const badTool = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/candidates/${candidateId}/tools`,
      headers: adminHeaders,
      payload: { tools: [{ toolId: randomUUID(), proficiency: 'expert' }] },
    });
    expect(badTool.statusCode).toBe(422);
  });

  it('skills: PUT replaces the set', async () => {
    const res = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/candidates/${candidateId}/skills`,
      headers: adminHeaders,
      payload: { skills: [{ skillId: SKILL_1, proficiency: 'working' }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(1);
  });

  it('employment-history: POST/PATCH/DELETE round-trip', async () => {
    const added = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/employment-history`,
      headers: adminHeaders,
      payload: {
        employer: 'Acme Remote',
        title: 'Executive Assistant',
        startDate: '2021-02-01',
        isCurrent: true,
        reasonForLeaving: null,
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    const entry = added.json<{ data: { id: string }[] }>().data[0]!;

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/candidates/${candidateId}/employment-history/${entry.id}`,
      headers: adminHeaders,
      payload: { endDate: '2024-06-30', isCurrent: false },
    });
    expect(patched.statusCode).toBe(200);

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/candidates/${candidateId}/employment-history/${entry.id}`,
      headers: adminHeaders,
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('education, certifications, references: create round-trips', async () => {
    const education = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/education`,
      headers: adminHeaders,
      payload: { institution: 'UNAM', degree: 'BA', endYear: 2019 },
    });
    expect(education.statusCode, education.body).toBe(201);

    const certification = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/certifications`,
      headers: adminHeaders,
      payload: { name: 'PMP', issuer: 'PMI', issuedDate: '2023-01-15' },
    });
    expect(certification.statusCode, certification.body).toBe(201);

    const reference = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/references`,
      headers: adminHeaders,
      payload: { refereeName: 'Jane Boss', outcome: 'positive' },
    });
    expect(reference.statusCode, reference.body).toBe(201);
    const referenceRow = reference.json<{
      data: { checkedBy: string | null; checkedAt: string | null }[];
    }>().data[0]!;
    // Recording an outcome stamps the checking admin.
    expect(referenceRow.checkedBy).toBe(admin);
    expect(referenceRow.checkedAt).not.toBeNull();
  });

  it('notes: POST + GET under candidate.view', async () => {
    const added = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/notes`,
      headers: adminHeaders,
      payload: { body: 'Strong screening call.', isClientVisible: false },
    });
    expect(added.statusCode, added.body).toBe(201);
    const note = added.json<{ data: { authorId: string }[] }>().data[0]!;
    expect(note.authorId).toBe(admin);
  });

  it('disqualifier-checks: PUT upserts against the disqualifiers table', async () => {
    const disqualifierId = randomUUID();
    await db.sql`
      insert into disqualifiers (id, key, label)
      values (${disqualifierId}, ${`dq_${disqualifierId.slice(0, 8)}`}, 'No backup internet')
    `;
    const put = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/candidates/${candidateId}/disqualifier-checks`,
      headers: adminHeaders,
      payload: { checks: [{ disqualifierId, result: 'pass', notes: 'Verified' }] },
    });
    expect(put.statusCode, put.body).toBe(200);
    const checks = put.json<{
      data: { disqualifierId: string; result: string; checkedBy: string | null }[];
    }>().data;
    expect(checks[0]).toMatchObject({ disqualifierId, result: 'pass' });
    expect(checks[0]!.checkedBy).toBe(admin);

    // Upsert: same disqualifier, new result — still one row.
    const flip = await harness.app.inject({
      method: 'PUT',
      url: `/api/v1/candidates/${candidateId}/disqualifier-checks`,
      headers: adminHeaders,
      payload: { checks: [{ disqualifierId, result: 'fail' }] },
    });
    expect(flip.statusCode).toBe(200);
    const flipped = flip.json<{ data: { result: string }[] }>().data;
    expect(flipped).toHaveLength(1);
    expect(flipped[0]!.result).toBe('fail');
  });

  it('assessments: POST stores without scoring logic', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/candidates/${candidateId}/assessments`,
      headers: adminHeaders,
      payload: {
        provider: 'harrison',
        assessmentType: 'behavioural',
        scoreSummary: { overall: 82 },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const assessment = res.json<{
      data: { provider: string; scoreSummary: { overall: number } | null }[];
    }>().data[0]!;
    expect(assessment.provider).toBe('harrison');
    expect(assessment.scoreSummary).toEqual({ overall: 82 });
  });
});

describe('the internal pool is admin-only (rule 3)', () => {
  it('a client_user with candidate.view lists an EMPTY page, never pool data', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/candidates',
      headers: clientUserHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data).toEqual([]);
  });

  it('a client_user reading a real seeded candidate gets 404, never data', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/candidates/00000000-0000-4000-8000-000000000701',
      headers: clientUserHeaders,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ data?: unknown }>().data).toBeUndefined();
  });
});

describe('AC-CA-14 — filters combine correctly over the 25-candidate seed', () => {
  interface ListedCandidate {
    reference: string;
    country: string | null;
    englishSpokenLevel: string | null;
    accentStrength: string | null;
    expectedRateAmount: number | null;
    expectedRateUnit: string | null;
    primaryRoleCategoryId: string | null;
  }

  async function list(query: string): Promise<ListedCandidate[]> {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/candidates?${query}`,
      headers: adminHeaders,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ data: ListedCandidate[] }>().data;
  }

  it('role category + country + English level + max accent + rate ceiling → exactly the matching candidate', async () => {
    const data = await list(
      `roleCategoryId=${ROLE_EA}&country=Mexico&englishSpokenLevel=professional` +
        `&maxAccentStrength=light&rateMax=2500&rateUnit=monthly&limit=100`,
    );
    // Dev seed: only Valentina García (CAN-000001) satisfies all five.
    expect(data.map((c) => c.reference)).toEqual(['CAN-000001']);
    for (const candidate of data) {
      expect(candidate.primaryRoleCategoryId).toBe(ROLE_EA);
      expect(candidate.country).toBe('Mexico');
      expect(candidate.englishSpokenLevel).toBe('professional');
      expect(['none', 'light']).toContain(candidate.accentStrength);
      expect(candidate.expectedRateUnit).toBe('monthly');
      expect(candidate.expectedRateAmount!).toBeLessThanOrEqual(2500);
    }
  });

  it('maxAccentStrength is an inclusive ceiling on none<light<moderate<heavy', async () => {
    const light = await list('country=Mexico&maxAccentStrength=light&limit=100');
    const seedRefs = light
      .map((c) => c.reference)
      .filter((ref) => /^CAN-0000\d\d$/.test(ref))
      .sort();
    // Seed Mexicans: 701 light, 704 moderate, 711 light, 715 none, 719 light.
    expect(seedRefs).toEqual([
      'CAN-000001',
      'CAN-000011',
      'CAN-000015',
      'CAN-000019',
    ]);
  });

  it('rate ceiling never mixes hourly and monthly', async () => {
    const hourly = await list('rateMax=13&rateUnit=hourly&limit=100');
    for (const candidate of hourly) {
      expect(candidate.expectedRateUnit).toBe('hourly');
      expect(candidate.expectedRateAmount!).toBeLessThanOrEqual(13);
    }
    // Monthly candidates with amounts ≤ 13 do not leak in.
    expect(hourly.some((c) => c.expectedRateUnit === 'monthly')).toBe(false);
  });

  it('rateMax without rateUnit is rejected', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/candidates?rateMax=1000',
      headers: adminHeaders,
    });
    expect(res.statusCode).toBe(400);
  });

  it('toolIds requires ALL listed tools', async () => {
    const both = await list(`toolIds=${TOOL_CLICKUP},${TOOL_SLACK}&limit=100`);
    // Seed: only Valentina has BOTH ClickUp and Slack (plus the test candidate
    // from the tools PUT test would need both — it has only Slack).
    expect(both.map((c) => c.reference)).toContain('CAN-000001');
    for (const candidate of both) {
      const rows = await db.sql<{ tool_id: string }[]>`
        select tool_id from candidate_tools ct
        join candidates c on c.id = ct.candidate_id
        where c.reference = ${candidate.reference}
      `;
      const ids = rows.map((r) => r.tool_id);
      expect(ids).toContain(TOOL_CLICKUP);
      expect(ids).toContain(TOOL_SLACK);
    }
  });

  it('search hits the name trigram index', async () => {
    const data = await list('search=Valentina&limit=100');
    expect(data.map((c) => c.reference)).toContain('CAN-000001');
  });

  it('poolStatus, vettingStatus and dataCompleteness filters apply', async () => {
    const failed = await list('vettingStatus=failed&limit=100');
    expect(failed.map((c) => c.reference)).toEqual(['CAN-000018']);

    const doNotUse = await list('poolStatus=do_not_use&limit=100');
    expect(doNotUse.map((c) => c.reference)).toEqual(['CAN-000018']);

    // The completeness job ran earlier in this file, so cross-check the
    // filter against the database rather than fixed seed rows.
    const incomplete = await list('dataCompleteness=incomplete&limit=100');
    expect(incomplete.length).toBeGreaterThan(0);
    const dbCount = await db.sql<{ count: string }[]>`
      select count(*) as count from candidates
      where data_completeness = 'incomplete' and archived_at is null
    `;
    expect(incomplete).toHaveLength(Number(dbCount[0]!.count));
  });

  it('cursor pagination walks the full pool without overlap', async () => {
    const first = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/candidates?limit=10',
      headers: adminHeaders,
    });
    const page1 = first.json<{
      data: { id: string }[];
      meta: { nextCursor: string | null };
    }>();
    expect(page1.data).toHaveLength(10);
    expect(page1.meta.nextCursor).not.toBeNull();

    const second = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/candidates?limit=10&cursor=${encodeURIComponent(page1.meta.nextCursor!)}`,
      headers: adminHeaders,
    });
    const page2 = second.json<{ data: { id: string }[] }>();
    const ids1 = new Set(page1.data.map((c) => c.id));
    for (const candidate of page2.data) {
      expect(ids1.has(candidate.id)).toBe(false);
    }
  });
});
