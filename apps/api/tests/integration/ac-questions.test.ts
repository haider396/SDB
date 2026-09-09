/**
 * Question management acceptance criteria (docs/07-ACCEPTANCE-CRITERIA.md §3):
 * AC-Q-01 .. AC-Q-13. AC-Q-14 is web-side (Playwright) and lives in apps/web.
 *
 * Runs against the real app on a migrated Postgres. The intake-form cache
 * clock is injected (`nowMs`) so the TTL behaviour is tested deterministically
 * (AC-Q-01 "with clock control") without mocking global timers.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IntakeFormResponse, QuestionDetail } from '@sdb/contracts';
import {
  assignRole,
  insertAnswer,
  insertClient,
  insertQuestion,
  insertQuestionCategory,
  insertQuestionOption,
  insertRequisition,
  insertTaxonomyChain,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

let db: TestDb;
let harness: TestApp;
let superAdmin: string;
let admin: string;
let clientUser: string;
let nowMs = Date.now();

/** Unique source IP per call so public GETs never trip the 60/min limiter. */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function getIntakeForm(query = ''): Promise<IntakeFormResponse> {
  const res = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/intake-form${query}`,
    remoteAddress: nextIp(),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: IntakeFormResponse }>().data;
}

function formQuestionKeys(form: IntakeFormResponse): string[] {
  return form.categories.flatMap((category) =>
    category.questions.map((question) => question.key),
  );
}

beforeAll(async () => {
  db = await freshDb();
  superAdmin = await insertUser(db.sql);
  await assignRole(db.sql, superAdmin, 'super_admin');
  admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');
  clientUser = await insertUser(db.sql);
  await assignRole(db.sql, clientUser, 'client_user');
  harness = await buildTestApp(db, undefined, { now: () => nowMs });
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

describe('AC-Q-01 — super_admin creates a question with options; visible in GET /intake-form within the cache TTL', () => {
  it('appears after creation (write invalidates the cache) and the TTL is honoured under clock control', async () => {
    const categoryId = await insertQuestionCategory(db.sql);

    // Warm the cache with the pre-creation payload.
    const before = await getIntakeForm();
    expect(formQuestionKeys(before)).not.toContain('preferred_crm');

    const create = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers: await harness.bearer(superAdmin),
      payload: {
        categoryId,
        key: 'preferred_crm',
        label: 'Preferred CRM',
        questionType: 'single_select',
        audience: 'client',
        isRequired: false,
        options: [
          { value: 'hubspot', label: 'HubSpot' },
          { value: 'gohighlevel', label: 'GoHighLevel' },
        ],
      },
    });
    expect(create.statusCode).toBe(201);

    // The write invalidated the cache → the new question appears immediately,
    // well within the TTL.
    const after = await getIntakeForm();
    expect(formQuestionKeys(after)).toContain('preferred_crm');
    const question = after.categories
      .flatMap((category) => category.questions)
      .find((entry) => entry.key === 'preferred_crm');
    expect(question?.options).toEqual([
      { value: 'hubspot', label: 'HubSpot' },
      { value: 'gohighlevel', label: 'GoHighLevel' },
    ]);

    // Clock control: a direct DB change (no API write, no invalidation) stays
    // invisible until the TTL elapses, then shows on the next rebuild.
    await db.sql`update questions set is_active = false where key = 'preferred_crm'`;
    const cached = await getIntakeForm();
    expect(formQuestionKeys(cached)).toContain('preferred_crm');

    nowMs += 61_000; // past intake.form_cache_ttl_seconds = 60
    const rebuilt = await getIntakeForm();
    expect(formQuestionKeys(rebuilt)).not.toContain('preferred_crm');
  });
});

describe('AC-Q-02 (revised by migration 0027) — admin manages questions; client roles never do', () => {
  // Originally: "an admin (non-super) receives 403 on every /questions write
  // endpoint". 0011 seeded question.manage to super_admin alone, which stopped
  // being tenable once the candidate form builder was put behind the same key —
  // an admin could open /admin/forms and 403 on every save. 0027 grants
  // question.manage to admin (client-approved). The client roles are the half
  // of this criterion that has NOT changed, so they are asserted just as hard.
  const manageRoutes = () =>
    harness.app.routeTable.filter(
      (route) =>
        route.method !== 'HEAD' &&
        route.method !== 'OPTIONS' &&
        route.config['permission'] === 'question.manage',
    );

  it('route-table-driven: every question.manage route ADMITS the admin role', async () => {
    const writeRoutes = manageRoutes();
    // POST/PATCH/DELETE questions + options + categories endpoints.
    expect(writeRoutes.length).toBeGreaterThanOrEqual(13);
    for (const route of writeRoutes) {
      const url = route.url.replaceAll(/:[^/]+/g, randomUUID());
      const res = await harness.app.inject({
        method: route.method as 'POST',
        url,
        headers: await harness.bearer(admin),
      });
      // Reaching the handler is the assertion. A bodyless request to a real
      // handler legitimately 400s or 404s; what it must never be is 401/403.
      expect([401, 403], `${route.method} ${route.url} should admit admin`)
        .not.toContain(res.statusCode);
      expect(res.statusCode, `${route.method} ${route.url}`).toBeLessThan(500);
    }
  });

  it('route-table-driven: every question.manage route still REJECTS client_user', async () => {
    const writeRoutes = manageRoutes();
    expect(writeRoutes.length).toBeGreaterThanOrEqual(13);
    for (const route of writeRoutes) {
      const url = route.url.replaceAll(/:[^/]+/g, randomUUID());
      const res = await harness.app.inject({
        method: route.method as 'POST',
        url,
        headers: await harness.bearer(clientUser),
      });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(403);
      const body = res.json<{
        error: { code: string; details?: { requiredPermission?: string } };
      }>();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.details?.requiredPermission).toBe('question.manage');
    }
  });

  it('the grant is exactly two roles wide — the seed itself, not just the routes', async () => {
    const rows = await db.sql<{ key: string }[]>`
      select r.key
      from roles r
      join role_permissions rp on rp.role_id = r.id
      join permissions p on p.id = rp.permission_id
      where p.key = 'question.manage'
      order by r.key
    `;
    expect(rows.map((row) => row.key)).toEqual(['admin', 'super_admin']);
  });
});

describe('AC-Q-03 — deactivating a question removes it from the form and leaves answers intact', () => {
  it('answers survive and stay readable', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ac_q03',
    });
    const clientId = await insertClient(db.sql);
    const requisitionId = await insertRequisition(db.sql, { clientId });
    await insertAnswer(db.sql, {
      requisitionId,
      questionId,
      questionKey: 'q_ac_q03',
      valueText: 'answered before deactivation',
    });
    harness.app.clearIntakeFormCache(); // fixture wrote the question directly

    expect(formQuestionKeys(await getIntakeForm())).toContain('q_ac_q03');
    const countBefore = await db.sql<{ count: string }[]>`
      select count(*) from requisition_answers where question_id = ${questionId}
    `;

    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/questions/${questionId}/deactivate`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(200);

    expect(formQuestionKeys(await getIntakeForm())).not.toContain('q_ac_q03');

    const countAfter = await db.sql<{ count: string }[]>`
      select count(*) from requisition_answers where question_id = ${questionId}
    `;
    expect(countAfter[0]?.count).toBe(countBefore[0]?.count);
    const answers = await db.sql<{ value_text: string }[]>`
      select value_text from requisition_answers where question_id = ${questionId}
    `;
    expect(answers[0]?.value_text).toBe('answered before deactivation');
  });
});

describe('AC-Q-04 — category deactivation hides questions without touching their is_active', () => {
  it('reactivating restores the prior per-question state exactly', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const activeQ = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ac_q04_active',
      isActive: true,
    });
    const inactiveQ = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ac_q04_inactive',
      isActive: false,
    });
    harness.app.clearIntakeFormCache();

    expect(formQuestionKeys(await getIntakeForm())).toContain('q_ac_q04_active');

    const deactivate = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/question-categories/${categoryId}/deactivate`,
      headers: await harness.bearer(superAdmin),
    });
    expect(deactivate.statusCode).toBe(200);

    const hidden = await getIntakeForm();
    expect(formQuestionKeys(hidden)).not.toContain('q_ac_q04_active');
    expect(formQuestionKeys(hidden)).not.toContain('q_ac_q04_inactive');

    // Per-question is_active untouched.
    const states = await db.sql<{ id: string; is_active: boolean }[]>`
      select id, is_active from questions where id in ${db.sql([activeQ, inactiveQ])}
    `;
    const byId = new Map(states.map((row) => [row.id, row.is_active]));
    expect(byId.get(activeQ)).toBe(true);
    expect(byId.get(inactiveQ)).toBe(false);

    const activate = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/question-categories/${categoryId}/activate`,
      headers: await harness.bearer(superAdmin),
    });
    expect(activate.statusCode).toBe(200);

    const restored = await getIntakeForm();
    expect(formQuestionKeys(restored)).toContain('q_ac_q04_active');
    expect(formQuestionKeys(restored)).not.toContain('q_ac_q04_inactive');
  });
});

describe('UX 2.7 — category deactivation warns about cross-category conditional dependents', () => {
  it('lists ACTIVE questions in OTHER categories whose controller lives in this category', async () => {
    const controllerCategory = await insertQuestionCategory(db.sql);
    const otherCategory = await insertQuestionCategory(db.sql);
    const controllerId = await insertQuestion(db.sql, {
      categoryId: controllerCategory,
      questionType: 'yes_no',
      key: 'q_ux27_controller',
      label: 'Controller question',
    });
    // Cross-category ACTIVE dependent — must be warned about.
    const crossDependent = await insertQuestion(db.sql, {
      categoryId: otherCategory,
      questionType: 'short_text',
      key: 'q_ux27_cross_dep',
      label: 'Cross dependent',
    });
    // Cross-category INACTIVE dependent — not warned (already hidden).
    const inactiveDependent = await insertQuestion(db.sql, {
      categoryId: otherCategory,
      questionType: 'short_text',
      key: 'q_ux27_inactive_dep',
      isActive: false,
    });
    // SAME-category dependent — not warned (it disappears with the category).
    const sameCategoryDependent = await insertQuestion(db.sql, {
      categoryId: controllerCategory,
      questionType: 'short_text',
      key: 'q_ux27_same_dep',
    });
    await db.sql`
      update questions
      set conditional_on_question_id = ${controllerId},
          conditional_operator = 'is_true'
      where id in ${db.sql([crossDependent, inactiveDependent, sameCategoryDependent])}
    `;

    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/question-categories/${controllerCategory}/deactivate`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: { id: string; isActive: boolean };
      warnings: {
        code: string;
        message: string;
        dependent: { id: string; key: string; label: string; isActive: boolean };
      }[];
    }>();
    expect(body.data.isActive).toBe(false);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]!.code).toBe('CONDITIONAL_DEPENDENT');
    expect(body.warnings[0]!.dependent).toMatchObject({
      id: crossDependent,
      key: 'q_ux27_cross_dep',
      isActive: true,
    });
    expect(body.warnings[0]!.message).toContain('q_ux27_cross_dep');
    expect(body.warnings[0]!.message).toContain('q_ux27_controller');

    // Reactivation carries no warnings and the plain envelope.
    const activate = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/question-categories/${controllerCategory}/activate`,
      headers: await harness.bearer(superAdmin),
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json<Record<string, unknown>>()).not.toHaveProperty(
      'warnings',
    );
  });

  it('a category with no cross-category dependents deactivates with warnings: []', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ux27_lone',
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/question-categories/${categoryId}/deactivate`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ warnings: unknown[] }>().warnings).toEqual([]);
  });
});

describe('AC-Q-05 — questionType change on an answered question → 409 QUESTION_TYPE_LOCKED', () => {
  it('rejects the change and leaves the type intact', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ac_q05',
    });
    const clientId = await insertClient(db.sql);
    const requisitionId = await insertRequisition(db.sql, { clientId });
    await insertAnswer(db.sql, {
      requisitionId,
      questionId,
      questionKey: 'q_ac_q05',
      valueText: 'x',
    });

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${questionId}`,
      headers: await harness.bearer(superAdmin),
      payload: { questionType: 'long_text' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'QUESTION_TYPE_LOCKED',
    );

    const rows = await db.sql<{ question_type: string }[]>`
      select question_type from questions where id = ${questionId}
    `;
    expect(rows[0]?.question_type).toBe('short_text');
  });
});

describe('AC-Q-06 — question.key cannot be changed after creation', () => {
  it('rejects a re-key attempt and leaves the key intact', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ac_q06_original',
    });

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${questionId}`,
      headers: await harness.bearer(superAdmin),
      payload: { key: 'q_ac_q06_new' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'VALIDATION_FAILED',
    );

    const rows = await db.sql<{ key: string }[]>`
      select key from questions where id = ${questionId}
    `;
    expect(rows[0]?.key).toBe('q_ac_q06_original');
  });

  it('sending the unchanged key is a no-op, not an error', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ac_q06_stable',
    });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${questionId}`,
      headers: await harness.bearer(superAdmin),
      payload: { key: 'q_ac_q06_stable', label: 'Renamed label' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('AC-Q-07 — mapped questions cannot be deleted or re-keyed → 409 MAPPED_QUESTION_PROTECTED', () => {
  let mappedId: string;

  beforeAll(async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    mappedId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'company_name', // in MAPPED_QUESTION_KEYS
    });
  });

  it('DELETE → 409', async () => {
    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/questions/${mappedId}`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'MAPPED_QUESTION_PROTECTED',
    );
  });

  it('re-key → 409', async () => {
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${mappedId}`,
      headers: await harness.bearer(superAdmin),
      payload: { key: 'company_name_renamed' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'MAPPED_QUESTION_PROTECTED',
    );
    const rows = await db.sql<{ key: string }[]>`
      select key from questions where id = ${mappedId}
    `;
    expect(rows[0]?.key).toBe('company_name');
  });
});

describe('AC-Q-08 — a conditional cycle is rejected with 422 CIRCULAR_CONDITION', () => {
  it('detects a 3-question cycle', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const headers = await harness.bearer(superAdmin);

    const post = async (key: string, conditionalOn?: string) => {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/questions',
        headers,
        payload: {
          categoryId,
          key,
          label: key,
          questionType: 'short_text',
          audience: 'client',
          isRequired: false,
          ...(conditionalOn !== undefined
            ? {
                conditional: {
                  questionKey: conditionalOn,
                  operator: 'equals',
                  value: 'yes',
                },
              }
            : {}),
        },
      });
      expect(res.statusCode).toBe(201);
      return res.json<{ data: QuestionDetail }>().data;
    };

    const a = await post('cycle_a');
    await post('cycle_b', 'cycle_a');
    await post('cycle_c', 'cycle_b');

    // Closing the loop: A depends on C → A→C→B→A.
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${a.id}`,
      headers,
      payload: {
        conditional: { questionKey: 'cycle_c', operator: 'equals', value: 'x' },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'CIRCULAR_CONDITION',
    );
  });

  it('rejects a direct self-condition', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'self_loop',
    });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${questionId}`,
      headers: await harness.bearer(superAdmin),
      payload: {
        conditional: { questionKey: 'self_loop', operator: 'equals', value: 'x' },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'CIRCULAR_CONDITION',
    );
  });
});

describe('AC-Q-09 — deactivating a question with conditional dependents returns 200 + warnings[]', () => {
  it('names the dependents', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const headers = await harness.bearer(superAdmin);

    const controller = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers,
      payload: {
        categoryId,
        key: 'controller_q',
        label: 'Controller',
        questionType: 'yes_no',
        audience: 'client',
        isRequired: false,
      },
    });
    expect(controller.statusCode).toBe(201);
    const controllerId = controller.json<{ data: QuestionDetail }>().data.id;

    const dependent = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers,
      payload: {
        categoryId,
        key: 'dependent_q',
        label: 'Dependent',
        questionType: 'short_text',
        audience: 'client',
        isRequired: false,
        conditional: { questionKey: 'controller_q', operator: 'is_true', value: null },
      },
    });
    expect(dependent.statusCode).toBe(201);

    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/questions/${controllerId}/deactivate`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      warnings: { code: string; message: string; dependent: { key: string } }[];
    }>();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]?.code).toBe('CONDITIONAL_DEPENDENT');
    expect(body.warnings[0]?.dependent.key).toBe('dependent_q');
    expect(body.warnings[0]?.message).toContain('dependent_q');
  });
});

describe('AC-Q-10 — PATCH /questions/reorder persists the exact order and the form reflects it', () => {
  it('reorders within a category', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const q1 = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'order_a',
      sortOrder: 1,
    });
    const q2 = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'order_b',
      sortOrder: 2,
    });
    const q3 = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'order_c',
      sortOrder: 3,
    });
    harness.app.clearIntakeFormCache();

    const res = await harness.app.inject({
      method: 'PATCH',
      url: '/api/v1/questions/reorder',
      headers: await harness.bearer(superAdmin),
      payload: { categoryId, orderedQuestionIds: [q3, q1, q2] },
    });
    expect(res.statusCode).toBe(200);

    const rows = await db.sql<{ key: string; sort_order: number }[]>`
      select key, sort_order from questions
      where category_id = ${categoryId}
      order by sort_order
    `;
    expect(rows.map((row) => row.key)).toEqual(['order_c', 'order_a', 'order_b']);

    const form = await getIntakeForm();
    const category = form.categories.find((entry) => entry.id === categoryId);
    expect(category?.questions.map((question) => question.key)).toEqual([
      'order_c',
      'order_a',
      'order_b',
    ]);
  });
});

describe('AC-Q-11 — unrecognised validation keys → 422 INVALID_VALIDATION_RULE', () => {
  it('on create', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers: await harness.bearer(superAdmin),
      payload: {
        categoryId,
        label: 'Bad validation',
        questionType: 'short_text',
        audience: 'client',
        isRequired: false,
        validation: { bogusRule: 5 },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'INVALID_VALIDATION_RULE',
    );
  });

  it('on update', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ac_q11',
    });
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${questionId}`,
      headers: await harness.bearer(superAdmin),
      payload: { validation: { maxLength: 10, sneaky: true } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      'INVALID_VALIDATION_RULE',
    );
  });
});

describe('AC-Q-12 — every create, update, activate, deactivate writes an events row', () => {
  it("entity_type = 'question' with correct from/to values", async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const headers = await harness.bearer(superAdmin);

    const create = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers,
      payload: {
        categoryId,
        key: 'q_ac_q12',
        label: 'Event trail',
        questionType: 'short_text',
        audience: 'client',
        isRequired: false,
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json<{ data: QuestionDetail }>().data.id;

    const update = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${id}`,
      headers,
      payload: { label: 'Event trail (renamed)' },
    });
    expect(update.statusCode).toBe(200);

    const deactivate = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/questions/${id}/deactivate`,
      headers,
    });
    expect(deactivate.statusCode).toBe(200);

    const activate = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/questions/${id}/activate`,
      headers,
    });
    expect(activate.statusCode).toBe(200);

    const events = await db.sql<
      {
        event_type: string;
        from_value: string | null;
        to_value: string | null;
        actor_id: string;
        metadata: { changes?: Record<string, { from: unknown; to: unknown }> };
      }[]
    >`
      select event_type, from_value, to_value, actor_id, metadata
      from events
      where entity_type = 'question' and entity_id = ${id}
      order by occurred_at
    `;
    expect(events.map((event) => event.event_type)).toEqual([
      'question_created',
      'question_updated',
      'question_deactivated',
      'question_activated',
    ]);
    expect(events[0]).toMatchObject({ from_value: null, to_value: 'active' });
    expect(events[1]?.metadata.changes?.['label']).toEqual({
      from: 'Event trail',
      to: 'Event trail (renamed)',
    });
    expect(events[2]).toMatchObject({ from_value: 'active', to_value: 'inactive' });
    expect(events[3]).toMatchObject({ from_value: 'inactive', to_value: 'active' });
    for (const event of events) {
      expect(event.actor_id).toBe(superAdmin);
    }
  });
});

describe('AC-Q-13 — GET /questions/:id returns accurate answerCount and lastAnsweredAt', () => {
  it('counts answers across requisitions', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'q_ac_q13',
    });
    const clientId = await insertClient(db.sql);
    const req1 = await insertRequisition(db.sql, { clientId });
    const req2 = await insertRequisition(db.sql, { clientId });
    await insertAnswer(db.sql, {
      requisitionId: req1,
      questionId,
      questionKey: 'q_ac_q13',
      valueText: 'first',
    });
    await insertAnswer(db.sql, {
      requisitionId: req2,
      questionId,
      questionKey: 'q_ac_q13',
      valueText: 'second',
    });

    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/questions/${questionId}`,
      headers: await harness.bearer(admin), // question.view is enough for reads
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: QuestionDetail }>();
    expect(data.answerCount).toBe(2);
    expect(data.lastAnsweredAt).not.toBeNull();

    const maxRows = await db.sql<{ max: Date }[]>`
      select max(created_at) as max from requisition_answers
      where question_id = ${questionId}
    `;
    expect(new Date(data.lastAnsweredAt ?? 0).getTime()).toBe(
      maxRows[0]?.max.getTime(),
    );
  });
});

describe('question management extras (03 §2.2)', () => {
  it('POST /questions/:id/duplicate creates an inactive copy with a new key', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const headers = await harness.bearer(superAdmin);
    const create = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers,
      payload: {
        categoryId,
        key: 'dup_source',
        label: 'Duplicate me',
        questionType: 'single_select',
        audience: 'client',
        isRequired: true,
        options: [{ value: 'a', label: 'A' }],
      },
    });
    const sourceId = create.json<{ data: QuestionDetail }>().data.id;

    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/questions/${sourceId}/duplicate`,
      headers,
    });
    expect(res.statusCode).toBe(201);
    const copy = res.json<{ data: QuestionDetail }>().data;
    expect(copy.key).toBe('dup_source_copy');
    expect(copy.isActive).toBe(false);
    expect(copy.options.map((option) => option.value)).toEqual(['a']);
    expect(copy.label).toBe('Duplicate me');
  });

  it('option value change is blocked once referenced by an answer; label stays editable', async () => {
    const categoryId = await insertQuestionCategory(db.sql);
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'single_select',
      key: 'opt_frozen',
    });
    const optionId = await insertQuestionOption(db.sql, {
      questionId,
      value: 'stable_value',
    });
    const clientId = await insertClient(db.sql);
    const requisitionId = await insertRequisition(db.sql, { clientId });
    const answerId = await insertAnswer(db.sql, {
      requisitionId,
      questionId,
      questionKey: 'opt_frozen',
      valueText: 'stable_value',
    });
    await db.sql`
      insert into requisition_answer_options (answer_id, option_id)
      values (${answerId}, ${optionId})
    `;

    const headers = await harness.bearer(superAdmin);
    const valueChange = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${questionId}/options/${optionId}`,
      headers,
      payload: { value: 'different_value' },
    });
    expect(valueChange.statusCode).toBe(422);

    const labelChange = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${questionId}/options/${optionId}`,
      headers,
      payload: { label: 'Nicer label' },
    });
    expect(labelChange.statusCode).toBe(200);
  });

  it('GET /questions/preview returns the exact public payload and requires question.view', async () => {
    const { roleCategoryId } = await insertTaxonomyChain(db.sql);
    harness.app.clearIntakeFormCache();
    const preview = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/questions/preview?roleCategoryId=${roleCategoryId}`,
      headers: await harness.bearer(admin),
    });
    expect(preview.statusCode).toBe(200);
    const publicForm = await getIntakeForm(`?roleCategoryId=${roleCategoryId}`);
    expect(preview.json<{ data: IntakeFormResponse }>().data.categories).toEqual(
      publicForm.categories,
    );
  });
});
