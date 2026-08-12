/**
 * Intake submission acceptance criteria (docs/07-ACCEPTANCE-CRITERIA.md §4):
 * AC-IF-06 .. AC-IF-15, plus the in-portal entry point (03 §3.5).
 *
 * The fixture provides one universal category covering all 12 question types
 * and every MAPPED_QUESTION_KEY relevant to column projection (03 §3.4).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QuestionType } from '@sdb/contracts';
import {
  assignRole,
  insertClient,
  insertClientMember,
  insertQuestion,
  insertQuestionCategory,
  insertQuestionOption,
  insertTaxonomyChain,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

let db: TestDb;
let harness: TestApp;
let superAdmin: string;
let roleCategoryId: string;
let chain: Awaited<ReturnType<typeof insertTaxonomyChain>>;
const questionIdByKey = new Map<string, string>();

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.3.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

interface AnswerInput {
  questionKey: string;
  valueText?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueDate?: string;
  valueJson?: unknown;
}

async function submit(answers: AnswerInput[], hash = 'sha256:stale-but-accepted') {
  return harness.app.inject({
    method: 'POST',
    url: '/api/v1/intake-submissions',
    remoteAddress: nextIp(),
    payload: { formVersionHash: hash, roleCategoryId, answers },
  });
}

/** Required answers only — the base every negative case builds on. */
function requiredAnswers(): AnswerInput[] {
  return [
    { questionKey: 'company_name', valueText: 'Acme Legal' },
    { questionKey: 'contact_email', valueText: 'jordan@acme.example' },
  ];
}

function fullMappedAnswers(): AnswerInput[] {
  return [
    { questionKey: 'company_name', valueText: 'Acme Legal' },
    { questionKey: 'contact_name', valueText: 'Jordan Pike' },
    { questionKey: 'contact_email', valueText: 'jordan@acme.example' },
    { questionKey: 'engine', valueText: 'operations' },
    { questionKey: 'department', valueText: chain.departmentKey },
    { questionKey: 'role_category', valueText: chain.roleCategoryKey },
    {
      questionKey: 'budget_range',
      valueJson: { min: 1500, max: 2500, unit: 'monthly', currency: 'USD' },
    },
    { questionKey: 'engagement_type', valueText: 'full_time' },
    { questionKey: 'hours_per_week', valueNumber: 40 },
    { questionKey: 'overlap_window', valueText: '09:00-14:00 America/Chicago' },
    { questionKey: 'target_start_date', valueDate: '2026-09-15' },
    { questionKey: 'english_spoken_required', valueText: 'professional' },
    { questionKey: 'english_written_required', valueText: 'professional' },
    { questionKey: 'max_accent_strength', valueText: 'light' },
    { questionKey: 'region_preference', valueText: 'LATAM' },
    { questionKey: 'headcount', valueNumber: 2 },
    { questionKey: 'notes', valueText: 'Founder support role with travel booking.' },
    { questionKey: 'contact_phone', valueText: '+1-555-0100' },
    { questionKey: 'industry_required', valueBoolean: true },
    { questionKey: 'industry_detail', valueText: 'Legal services' },
    { questionKey: 'urgency', valueNumber: 4 },
    { questionKey: 'tools', valueJson: ['clickup', 'asana'] },
  ];
}

async function tableCounts(): Promise<Record<string, number>> {
  const [row] = await db.sql<
    {
      clients: string;
      requisitions: string;
      answers: string;
      answer_options: string;
      events: string;
      notifications: string;
    }[]
  >`
    select
      (select count(*) from clients)                    as clients,
      (select count(*) from requisitions)               as requisitions,
      (select count(*) from requisition_answers)        as answers,
      (select count(*) from requisition_answer_options) as answer_options,
      (select count(*) from events)                     as events,
      (select count(*) from notification_log)           as notifications
  `;
  return Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]),
  );
}

beforeAll(async () => {
  db = await freshDb();
  harness = await buildTestApp(db);

  superAdmin = await insertUser(db.sql);
  await assignRole(db.sql, superAdmin, 'super_admin');
  const admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');

  chain = await insertTaxonomyChain(db.sql);
  roleCategoryId = chain.roleCategoryId;

  const categoryId = await insertQuestionCategory(db.sql, { key: 'submission_cat' });
  const add = async (
    key: string,
    questionType: QuestionType,
    opts: {
      isRequired?: boolean;
      validation?: Record<string, unknown>;
      options?: { value: string; isActive?: boolean }[];
    } = {},
  ) => {
    const id = await insertQuestion(db.sql, {
      categoryId,
      questionType,
      key,
      label: `Label for ${key}`,
      ...(opts.isRequired !== undefined ? { isRequired: opts.isRequired } : {}),
      ...(opts.validation !== undefined ? { validation: opts.validation } : {}),
    });
    for (const [index, option] of (opts.options ?? []).entries()) {
      await insertQuestionOption(db.sql, {
        questionId: id,
        value: option.value,
        label: option.value,
        sortOrder: index + 1,
        ...(option.isActive !== undefined ? { isActive: option.isActive } : {}),
      });
    }
    questionIdByKey.set(key, id);
    return id;
  };

  await add('company_name', 'short_text', {
    isRequired: true,
    validation: { maxLength: 200 },
  });
  await add('contact_name', 'short_text');
  await add('contact_email', 'email', { isRequired: true });
  await add('engine', 'single_select', { options: [{ value: 'operations' }] });
  await add('department', 'single_select', {
    options: [{ value: chain.departmentKey }],
  });
  await add('role_category', 'single_select', {
    options: [{ value: chain.roleCategoryKey }],
  });
  await add('budget_range', 'currency_range', {
    validation: { allowedUnits: ['hourly', 'monthly'] },
  });
  await add('engagement_type', 'single_select', {
    options: [{ value: 'full_time' }, { value: 'part_time' }],
  });
  await add('hours_per_week', 'number', { validation: { min: 5, max: 60 } });
  await add('overlap_window', 'short_text');
  await add('target_start_date', 'date');
  await add('english_spoken_required', 'single_select', {
    options: [{ value: 'conversational' }, { value: 'professional' }],
  });
  await add('english_written_required', 'single_select', {
    options: [{ value: 'professional' }],
  });
  await add('max_accent_strength', 'single_select', {
    options: [{ value: 'light' }, { value: 'moderate' }],
  });
  await add('region_preference', 'short_text');
  await add('headcount', 'number');
  await add('notes', 'long_text', { validation: { maxLength: 5000 } });
  await add('contact_phone', 'phone');
  await add('industry_required', 'yes_no');
  await add('urgency', 'scale', { validation: { scaleMin: 1, scaleMax: 5 } });
  await add('tools', 'multi_select', {
    options: [
      { value: 'clickup' },
      { value: 'asana' },
      { value: 'legacy_tool', isActive: false },
    ],
  });
  await add('portfolio', 'file_upload');
  await add('team_size', 'single_select', {
    options: [{ value: 'small' }, { value: 'legacy_band', isActive: false }],
  });

  // Conditional: industry_detail is shown only when industry_required is true.
  const detailId = await add('industry_detail', 'short_text');
  const controllerId = questionIdByKey.get('industry_required');
  await db.sql`
    update questions
    set conditional_on_question_id = ${controllerId ?? null},
        conditional_operator = 'is_true',
        conditional_value = null
    where id = ${detailId}
  `;
  harness.app.clearIntakeFormCache();
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

describe('AC-IF-06 — missing required answers → 422 REQUIRED_ANSWER_MISSING listing every missing key', () => {
  it('lists all missing keys', async () => {
    const res = await submit([{ questionKey: 'notes', valueText: 'hello' }]);
    expect(res.statusCode).toBe(422);
    const body = res.json<{
      error: { code: string; details: { missingKeys: string[] } };
    }>();
    expect(body.error.code).toBe('REQUIRED_ANSWER_MISSING');
    expect(body.error.details.missingKeys.sort()).toEqual([
      'company_name',
      'contact_email',
    ]);
  });

  it('an empty-string answer counts as missing', async () => {
    const res = await submit([
      { questionKey: 'company_name', valueText: '' },
      { questionKey: 'contact_email', valueText: 'a@b.example' },
    ]);
    expect(res.statusCode).toBe(422);
    const body = res.json<{
      error: { code: string; details: { missingKeys: string[] } };
    }>();
    expect(body.error.code).toBe('REQUIRED_ANSWER_MISSING');
    expect(body.error.details.missingKeys).toEqual(['company_name']);
  });
});

describe('AC-IF-07 — wrong value field for the question type → 422 VALUE_TYPE_MISMATCH (all 12 types)', () => {
  const cases: { type: QuestionType; answer: AnswerInput }[] = [
    { type: 'short_text', answer: { questionKey: 'company_name', valueNumber: 5 } },
    { type: 'long_text', answer: { questionKey: 'notes', valueNumber: 5 } },
    { type: 'email', answer: { questionKey: 'contact_email', valueNumber: 5 } },
    { type: 'phone', answer: { questionKey: 'contact_phone', valueBoolean: true } },
    { type: 'number', answer: { questionKey: 'hours_per_week', valueText: 'forty' } },
    {
      type: 'currency_range',
      answer: { questionKey: 'budget_range', valueText: '1500-2500' },
    },
    {
      type: 'single_select',
      answer: { questionKey: 'engagement_type', valueNumber: 1 },
    },
    { type: 'multi_select', answer: { questionKey: 'tools', valueText: 'clickup' } },
    {
      type: 'yes_no',
      answer: { questionKey: 'industry_required', valueText: 'yes' },
    },
    {
      type: 'date',
      answer: { questionKey: 'target_start_date', valueText: '2026-09-15' },
    },
    { type: 'scale', answer: { questionKey: 'urgency', valueBoolean: true } },
    { type: 'file_upload', answer: { questionKey: 'portfolio', valueText: 'cv.pdf' } },
  ];

  it.each(cases)('$type', async ({ answer }) => {
    const base = requiredAnswers().filter(
      (entry) => entry.questionKey !== answer.questionKey,
    );
    const res = await submit([...base, answer]);
    expect(res.statusCode).toBe(422);
    const body = res.json<{
      error: { code: string; details: { fields: Record<string, string> } };
    }>();
    expect(body.error.code).toBe('VALUE_TYPE_MISMATCH');
    expect(body.error.details.fields[answer.questionKey]).toBeDefined();
  });

  it('a mis-shaped valueJson for currency_range is also a type mismatch', async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'budget_range', valueJson: { min: 'low', max: 'high' } },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'VALUE_TYPE_MISMATCH',
    );
  });
});

describe('AC-IF-08 — inactive or foreign options → 422 INVALID_OPTION', () => {
  it('inactive option', async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'team_size', valueText: 'legacy_band' },
    ]);
    expect(res.statusCode).toBe(422);
    const body = res.json<{
      error: { code: string; details: { fields: Record<string, string> } };
    }>();
    expect(body.error.code).toBe('INVALID_OPTION');
    expect(body.error.details.fields['team_size']).toBeDefined();
  });

  it("foreign option (another question's value)", async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'team_size', valueText: 'clickup' }, // belongs to `tools`
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'INVALID_OPTION',
    );
  });

  it('inactive option inside a multi_select', async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'tools', valueJson: ['clickup', 'legacy_tool'] },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'INVALID_OPTION',
    );
  });
});

describe('AC-IF-09 — answering a hidden conditional question → 422 CONDITION_NOT_MET', () => {
  it('rejects when the controller is answered false', async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'industry_required', valueBoolean: false },
      { questionKey: 'industry_detail', valueText: 'Legal' },
    ]);
    expect(res.statusCode).toBe(422);
    const body = res.json<{
      error: { code: string; details: { fields: Record<string, string> } };
    }>();
    expect(body.error.code).toBe('CONDITION_NOT_MET');
    expect(body.error.details.fields['industry_detail']).toBeDefined();
  });

  it('rejects when the controller is unanswered (unanswered satisfies no operator)', async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'industry_detail', valueText: 'Legal' },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'CONDITION_NOT_MET',
    );
  });

  it('accepts when the condition is satisfied', async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'industry_required', valueBoolean: true },
      { questionKey: 'industry_detail', valueText: 'Legal' },
    ]);
    expect(res.statusCode).toBe(201);
  });
});

describe('validation rules (03 §3.3 step 4) → 422 VALIDATION_FAILED', () => {
  it('rejects a number outside min/max with per-key detail', async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'hours_per_week', valueNumber: 90 },
    ]);
    expect(res.statusCode).toBe(422);
    const body = res.json<{
      error: { code: string; details: { fields: Record<string, string> } };
    }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.fields['hours_per_week']).toContain('60');
  });

  it('rejects a disallowed currency-range unit', async () => {
    const res = await submit([
      ...requiredAnswers(),
      {
        questionKey: 'budget_range',
        valueJson: { min: 10, max: 20, unit: 'weekly', currency: 'USD' },
      },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('AC-IF-10/11/14/15 — a successful submission', () => {
  let before: Record<string, number>;
  let reference: string;
  let requisitionId: string;
  const answers = () => fullMappedAnswers();

  beforeAll(async () => {
    before = await tableCounts();
    const res = await submit(answers());
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { requisitionReference: string } }>();
    reference = body.data.requisitionReference;

    // AC-IF-14 — the response carries only { data: { requisitionReference } }.
    expect(Object.keys(res.json<Record<string, unknown>>())).toEqual(['data']);
    expect(Object.keys(body.data)).toEqual(['requisitionReference']);
    expect(reference).toMatch(/^REQ-\d{6}$/);

    const rows = await db.sql<{ id: string }[]>`
      select id from requisitions where reference = ${reference}
    `;
    requisitionId = rows[0]?.id ?? '';
    expect(requisitionId).not.toBe('');
  });

  it('AC-IF-10 — creates exactly one prospect client, one submitted requisition, one answer row per answer', async () => {
    const after = await tableCounts();
    expect(after['clients']).toBe((before['clients'] ?? 0) + 1);
    expect(after['requisitions']).toBe((before['requisitions'] ?? 0) + 1);
    expect(after['answers']).toBe((before['answers'] ?? 0) + answers().length);

    const [client] = await db.sql<{ status: string; company_name: string }[]>`
      select c.status, c.company_name
      from clients c join requisitions r on r.client_id = c.id
      where r.id = ${requisitionId}
    `;
    expect(client).toMatchObject({ status: 'prospect', company_name: 'Acme Legal' });

    const [requisition] = await db.sql<{ status: string }[]>`
      select status from requisitions where id = ${requisitionId}
    `;
    expect(requisition?.status).toBe('submitted');
  });

  it('writes the intake_submitted event and queues one notification per active admin', async () => {
    const events = await db.sql<{ event_type: string; to_value: string | null }[]>`
      select event_type, to_value from events
      where entity_type = 'requisition' and entity_id = ${requisitionId}
        and event_type = 'intake_submitted'
    `;
    expect(events).toHaveLength(1);
    expect(events[0]?.to_value).toBe('submitted');

    const admins = await db.sql<{ count: string }[]>`
      select count(distinct u.id) as count
      from users u
      join user_roles ur on ur.user_id = u.id
      join roles r on r.id = ur.role_id
      where r.key in ('super_admin', 'admin') and u.is_active and u.archived_at is null
    `;
    // Force the P7 post-commit drain so the status below is deterministic:
    // this harness configures no GHL_WEBHOOK_URL_*, so enqueued rows are
    // dispatched-and-failed with a clear error rather than staying 'queued'.
    await harness.app.notificationDispatch.drainQueued();
    const notifications = await db.sql<
      { status: string; event: string; last_error: string | null }[]
    >`
      select status, event, last_error from notification_log
      where entity_type = 'requisition' and entity_id = ${requisitionId}
    `;
    expect(notifications).toHaveLength(Number(admins[0]?.count ?? 0));
    for (const notification of notifications) {
      expect(notification.status).toBe('failed'); // unset webhook URL (P7)
      expect(notification.last_error).toBe('webhook url not configured');
      expect(notification.event).toBe('intake_submitted');
    }
  });

  it('AC-IF-11 — every answer row has a non-empty snapshot with label, type, and options', async () => {
    const rows = await db.sql<
      {
        question_key: string;
        question_snapshot: {
          label?: string;
          questionType?: string;
          categoryKey?: string;
          options?: { value: string; label: string }[];
          capturedAt?: string;
        };
      }[]
    >`
      select question_key, question_snapshot
      from requisition_answers where requisition_id = ${requisitionId}
    `;
    expect(rows).toHaveLength(answers().length);
    for (const row of rows) {
      expect(row.question_snapshot.label, row.question_key).toBe(
        `Label for ${row.question_key}`,
      );
      expect(row.question_snapshot.questionType, row.question_key).toBeTruthy();
      expect(row.question_snapshot.categoryKey).toBe('submission_cat');
      expect(row.question_snapshot.capturedAt).toBeTruthy();
    }
    const selectRow = rows.find((row) => row.question_key === 'engagement_type');
    expect(selectRow?.question_snapshot.options).toEqual([
      { value: 'full_time', label: 'full_time' },
      { value: 'part_time', label: 'part_time' },
    ]);
  });

  it('links select answers to their option rows', async () => {
    const rows = await db.sql<{ question_key: string; option_count: string }[]>`
      select ra.question_key, count(rao.option_id) as option_count
      from requisition_answers ra
      join requisition_answer_options rao on rao.answer_id = ra.id
      where ra.requisition_id = ${requisitionId}
      group by ra.question_key
    `;
    const byKey = new Map(rows.map((row) => [row.question_key, Number(row.option_count)]));
    expect(byKey.get('tools')).toBe(2);
    expect(byKey.get('engagement_type')).toBe(1);
    expect(byKey.get('english_spoken_required')).toBe(1);
  });

  it('AC-IF-15 — mapped answers populate their clients/requisitions columns', async () => {
    const [row] = await db.sql<
      {
        engine_id: string;
        department_id: string;
        role_category_id: string;
        primary_role_category_id: string;
        budget_min: string;
        budget_max: string;
        budget_unit: string;
        budget_currency: string;
        engagement_type: string;
        hours_per_week: number;
        overlap_start: string;
        overlap_end: string;
        overlap_timezone: string;
        target_start_date: string;
        english_spoken_required: string;
        english_written_required: string;
        max_accent_strength: string;
        region_preference: string;
        headcount: number;
        intake_contact_name: string;
        intake_contact_email: string;
      }[]
    >`
      select engine_id, department_id, role_category_id, primary_role_category_id,
             budget_min, budget_max, budget_unit, budget_currency,
             engagement_type, hours_per_week,
             overlap_start::text, overlap_end::text, overlap_timezone,
             target_start_date::text, english_spoken_required,
             english_written_required, max_accent_strength, region_preference,
             headcount, intake_contact_name, intake_contact_email::text
      from requisitions where id = ${requisitionId}
    `;
    expect(row).toMatchObject({
      engine_id: chain.engineId,
      department_id: chain.departmentId,
      role_category_id: chain.roleCategoryId,
      primary_role_category_id: chain.roleCategoryId,
      budget_unit: 'monthly',
      budget_currency: 'USD',
      engagement_type: 'full_time',
      hours_per_week: 40,
      overlap_start: '09:00:00',
      overlap_end: '14:00:00',
      overlap_timezone: 'America/Chicago',
      target_start_date: '2026-09-15',
      english_spoken_required: 'professional',
      english_written_required: 'professional',
      max_accent_strength: 'light',
      region_preference: 'LATAM',
      headcount: 2,
      intake_contact_name: 'Jordan Pike',
      intake_contact_email: 'jordan@acme.example',
    });
    expect(Number(row?.budget_min)).toBe(1500);
    expect(Number(row?.budget_max)).toBe(2500);
  });

  it('AC-IF-12 — editing the question label later leaves the stored snapshot unchanged', async () => {
    const companyNameId = questionIdByKey.get('company_name');
    const patch = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${companyNameId}`,
      headers: await harness.bearer(superAdmin),
      payload: { label: 'Company name (renamed after submission)' },
    });
    expect(patch.statusCode).toBe(200);

    const [snapshot] = await db.sql<{ question_snapshot: { label: string } }[]>`
      select question_snapshot from requisition_answers
      where requisition_id = ${requisitionId} and question_key = 'company_name'
    `;
    // The historical answer renders the ORIGINAL label from its snapshot.
    expect(snapshot?.question_snapshot.label).toBe('Label for company_name');

    const [live] = await db.sql<{ label: string }[]>`
      select label from questions where id = ${companyNameId ?? null}
    `;
    expect(live?.label).toBe('Company name (renamed after submission)');
  });

  it('references are sequence-backed and unique across submissions', async () => {
    const res = await submit(answers());
    expect(res.statusCode).toBe(201);
    const second = res.json<{ data: { requisitionReference: string } }>().data
      .requisitionReference;
    expect(second).not.toBe(reference);
    expect(second).toMatch(/^REQ-\d{6}$/);
  });
});

describe('AC-IF-13 — a failed submission creates no rows in any table', () => {
  it('leaves every table count unchanged after a 422', async () => {
    const before = await tableCounts();
    const res = await submit([
      { questionKey: 'notes', valueText: 'missing the required answers' },
    ]);
    expect(res.statusCode).toBe(422);
    const after = await tableCounts();
    expect(after).toEqual(before);
  });

  it('also for a failure in a later pipeline step (INVALID_OPTION)', async () => {
    const before = await tableCounts();
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'team_size', valueText: 'legacy_band' },
    ]);
    expect(res.statusCode).toBe(422);
    expect(await tableCounts()).toEqual(before);
  });
});

describe('step 1 — unknown or out-of-scope keys → 422 UNKNOWN_QUESTION', () => {
  it('rejects unknown keys with a field map', async () => {
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'not_a_real_question', valueText: 'x' },
    ]);
    expect(res.statusCode).toBe(422);
    const body = res.json<{
      error: { code: string; details: { fields: Record<string, string> } };
    }>();
    expect(body.error.code).toBe('UNKNOWN_QUESTION');
    expect(body.error.details.fields['not_a_real_question']).toBeDefined();
  });

  it('rejects an inactive question key', async () => {
    const categoryId = await insertQuestionCategory(db.sql, { key: 'inactive_q_cat' });
    await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'deactivated_question',
      isActive: false,
    });
    harness.app.clearIntakeFormCache();
    const res = await submit([
      ...requiredAnswers(),
      { questionKey: 'deactivated_question', valueText: 'x' },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'UNKNOWN_QUESTION',
    );
  });
});

describe('POST /api/v1/requisitions — in-portal entry point (03 §3.5)', () => {
  let clientA: string;
  let clientAdmin: string;
  let adminUser: string;

  beforeAll(async () => {
    clientA = await insertClient(db.sql);
    clientAdmin = await insertUser(db.sql);
    await assignRole(db.sql, clientAdmin, 'client_admin', clientA);
    await insertClientMember(db.sql, { clientId: clientA, userId: clientAdmin });
    adminUser = await insertUser(db.sql);
    await assignRole(db.sql, adminUser, 'admin');
  });

  it('a client_admin creates a requisition attached to their own client; no prospect client is created', async () => {
    const before = await tableCounts();
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/requisitions',
      headers: await harness.bearer(clientAdmin),
      payload: {
        formVersionHash: 'sha256:whatever',
        roleCategoryId,
        // Body clientId must be ignored for scoped callers (04 §1.3).
        clientId: '00000000-0000-4000-8000-00000000dead',
        answers: requiredAnswers(),
      },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json<{
      data: { id: string; requisitionReference: string };
    }>();
    expect(data.requisitionReference).toMatch(/^REQ-\d{6}$/);

    const after = await tableCounts();
    expect(after['clients']).toBe(before['clients']); // no new client

    const [row] = await db.sql<
      { client_id: string; intake_completed_by: string }[]
    >`
      select client_id, intake_completed_by from requisitions where id = ${data.id}
    `;
    expect(row?.client_id).toBe(clientA);
    expect(row?.intake_completed_by).toBe(clientAdmin);

    const answers = await db.sql<{ answered_by: string }[]>`
      select answered_by from requisition_answers where requisition_id = ${data.id}
    `;
    for (const answer of answers) {
      expect(answer.answered_by).toBe(clientAdmin);
    }
  });

  it('an admin may pass clientId', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/requisitions',
      headers: await harness.bearer(adminUser),
      payload: {
        formVersionHash: 'sha256:whatever',
        roleCategoryId,
        clientId: clientA,
        answers: requiredAnswers(),
      },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json<{ data: { id: string } }>();
    const [row] = await db.sql<{ client_id: string }[]>`
      select client_id from requisitions where id = ${data.id}
    `;
    expect(row?.client_id).toBe(clientA);
  });

  it('an admin without clientId is rejected', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/requisitions',
      headers: await harness.bearer(adminUser),
      payload: {
        formVersionHash: 'sha256:whatever',
        roleCategoryId,
        answers: requiredAnswers(),
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('runs the same validation pipeline (required answers still enforced)', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/requisitions',
      headers: await harness.bearer(clientAdmin),
      payload: {
        formVersionHash: 'sha256:whatever',
        roleCategoryId,
        answers: [{ questionKey: 'notes', valueText: 'no required answers' }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'REQUIRED_ANSWER_MISSING',
    );
  });
});
