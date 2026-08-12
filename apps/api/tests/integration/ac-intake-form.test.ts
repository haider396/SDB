/**
 * Public intake form rendering acceptance criteria
 * (docs/07-ACCEPTANCE-CRITERIA.md §4): AC-IF-01 .. AC-IF-05 and AC-IF-16.
 * Submission criteria (AC-IF-06..15) live in ac-intake-submission.test.ts;
 * AC-IF-17/18 are web-side.
 *
 * Mixed-state fixture: active/inactive categories, active/inactive/internal
 * questions, active/inactive options, and role-scoped questions for two
 * different role categories.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IntakeFormResponse } from '@sdb/contracts';
import {
  insertQuestion,
  insertQuestionCategory,
  insertQuestionOption,
  insertTaxonomyChain,
  scopeQuestionToRole,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

let db: TestDb;
let harness: TestApp;
let roleX: string;
let roleY: string;

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `10.2.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function getForm(query = ''): Promise<IntakeFormResponse> {
  const res = await harness.app.inject({
    method: 'GET',
    url: `/api/v1/intake-form${query}`,
    remoteAddress: nextIp(),
  });
  expect(res.statusCode).toBe(200);
  harness.app.clearIntakeFormCache(); // each assertion sees the live config
  return res.json<{ data: IntakeFormResponse }>().data;
}

function keys(form: IntakeFormResponse): string[] {
  return form.categories.flatMap((category) =>
    category.questions.map((question) => question.key),
  );
}

beforeAll(async () => {
  db = await freshDb();
  harness = await buildTestApp(db);

  const chainX = await insertTaxonomyChain(db.sql);
  roleX = chainX.roleCategoryId;
  const chainY = await insertTaxonomyChain(db.sql, { engineKey: 'brand' });
  roleY = chainY.roleCategoryId;

  const activeCategory = await insertQuestionCategory(db.sql, { key: 'cat_active' });
  const inactiveCategory = await insertQuestionCategory(db.sql, { key: 'cat_inactive' });
  await db.sql`update question_categories set is_active = false where id = ${inactiveCategory}`;
  const emptyCategory = await insertQuestionCategory(db.sql, { key: 'cat_empty' });

  // Active client question with mixed-state options.
  const selectQ = await insertQuestion(db.sql, {
    categoryId: activeCategory,
    questionType: 'single_select',
    key: 'if_select',
  });
  await insertQuestionOption(db.sql, { questionId: selectQ, value: 'opt_active', sortOrder: 1 });
  await insertQuestionOption(db.sql, {
    questionId: selectQ,
    value: 'opt_inactive',
    sortOrder: 2,
    isActive: false,
  });

  await insertQuestion(db.sql, {
    categoryId: activeCategory,
    questionType: 'short_text',
    key: 'if_inactive_question',
    isActive: false,
  });
  await insertQuestion(db.sql, {
    categoryId: activeCategory,
    questionType: 'short_text',
    key: 'if_internal_question',
    audience: 'internal',
  });
  await insertQuestion(db.sql, {
    categoryId: inactiveCategory,
    questionType: 'short_text',
    key: 'if_question_in_inactive_category',
  });
  // Only an inactive question → the category must be omitted (AC-IF-05).
  await insertQuestion(db.sql, {
    categoryId: emptyCategory,
    questionType: 'short_text',
    key: 'if_only_inactive_here',
    isActive: false,
  });

  const scopedX = await insertQuestion(db.sql, {
    categoryId: activeCategory,
    questionType: 'short_text',
    key: 'if_scoped_to_x',
  });
  await scopeQuestionToRole(db.sql, scopedX, roleX);
  const scopedY = await insertQuestion(db.sql, {
    categoryId: activeCategory,
    questionType: 'short_text',
    key: 'if_scoped_to_y',
  });
  await scopeQuestionToRole(db.sql, scopedY, roleY);
  harness.app.clearIntakeFormCache();
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

describe('AC-IF-01 — only active questions in active categories, only active options', () => {
  it('filters the mixed-state fixture correctly', async () => {
    const form = await getForm();
    const formKeys = keys(form);
    expect(formKeys).toContain('if_select');
    expect(formKeys).not.toContain('if_inactive_question');
    expect(formKeys).not.toContain('if_question_in_inactive_category');

    const select = form.categories
      .flatMap((category) => category.questions)
      .find((question) => question.key === 'if_select');
    expect(select?.options.map((option) => option.value)).toEqual(['opt_active']);
  });
});

describe('AC-IF-02 — internal questions are never exposed', () => {
  it.each([
    '',
    '?audience=client',
    '?audience=internal',
    '?audience=INTERNAL',
    '?audience=',
  ])('query "%s"', async (query) => {
    const form = await getForm(query);
    expect(keys(form)).not.toContain('if_internal_question');
  });

  it('with a roleCategoryId as well', async () => {
    const form = await getForm(`?roleCategoryId=${roleX}&audience=internal`);
    expect(keys(form)).not.toContain('if_internal_question');
  });
});

describe('AC-IF-03 — role scoping: scoped questions only for their role; unscoped always', () => {
  it('returns X-scoped for X and not for Y', async () => {
    const formX = await getForm(`?roleCategoryId=${roleX}`);
    expect(keys(formX)).toContain('if_scoped_to_x');
    expect(keys(formX)).not.toContain('if_scoped_to_y');
    expect(keys(formX)).toContain('if_select'); // unscoped

    const formY = await getForm(`?roleCategoryId=${roleY}`);
    expect(keys(formY)).toContain('if_scoped_to_y');
    expect(keys(formY)).not.toContain('if_scoped_to_x');
    expect(keys(formY)).toContain('if_select');
  });
});

describe('AC-IF-04 — omitting roleCategoryId returns only unscoped questions', () => {
  it('excludes every scoped question', async () => {
    const form = await getForm();
    expect(keys(form)).toContain('if_select');
    expect(keys(form)).not.toContain('if_scoped_to_x');
    expect(keys(form)).not.toContain('if_scoped_to_y');
  });
});

describe('AC-IF-05 — categories with no visible questions are omitted', () => {
  it('omits the inactive category and the category whose only question is inactive', async () => {
    const form = await getForm();
    const categoryKeys = form.categories.map((category) => category.key);
    expect(categoryKeys).toContain('cat_active');
    expect(categoryKeys).not.toContain('cat_inactive');
    expect(categoryKeys).not.toContain('cat_empty');
  });
});

describe('form payload contract (03 §3.2)', () => {
  it('carries a stable formVersionHash that changes when the config changes', async () => {
    const first = await getForm();
    const second = await getForm();
    expect(first.formVersionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second.formVersionHash).toBe(first.formVersionHash);

    const categoryId = await insertQuestionCategory(db.sql, { key: 'cat_hash' });
    await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
      key: 'if_hash_change',
    });
    harness.app.clearIntakeFormCache();
    const third = await getForm();
    expect(third.formVersionHash).not.toBe(first.formVersionHash);
  });
});

describe('GET /taxonomy/public — active staffed cascade in the web contract shape', () => {
  it('returns engines → departments → roleCategories, staffed + active only', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/taxonomy/public',
      remoteAddress: nextIp(),
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{
      data: {
        engines: {
          id: string;
          key: string;
          label: string;
          departments: {
            id: string;
            key: string;
            label: string;
            roleCategories: { id: string; key: string; label: string }[];
          }[];
        }[];
      };
    }>();
    const engineKeys = data.engines.map((engine) => engine.key);
    // Migration 0011 seeds 5 engines; staffed: brand, client_experience, operations.
    expect(engineKeys.sort()).toEqual(['brand', 'client_experience', 'operations']);

    const operations = data.engines.find((engine) => engine.key === 'operations');
    const allRoleCategoryIds = (operations?.departments ?? []).flatMap(
      (department) => department.roleCategories.map((role) => role.id),
    );
    expect(allRoleCategoryIds).toContain(roleX);
  });
});

describe('AC-IF-16 — public intake endpoints rate-limited to 60 req/IP/min with Retry-After', () => {
  it('returns 429 RATE_LIMITED on the 61st request from one IP', async () => {
    const ip = '10.99.99.1';
    for (let i = 0; i < 60; i += 1) {
      const res = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/intake-form',
        remoteAddress: ip,
      });
      expect(res.statusCode, `request ${i + 1} should pass`).toBe(200);
    }
    const blocked = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/intake-form',
      remoteAddress: ip,
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe(
      'RATE_LIMITED',
    );

    // The same window also covers POST /intake-submissions from that IP.
    // (A schema-valid body: request validation runs before the limiter hook.)
    const blockedPost = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/intake-submissions',
      remoteAddress: ip,
      payload: {
        formVersionHash: 'sha256:x',
        roleCategoryId: roleX,
        answers: [{ questionKey: 'if_select', valueText: 'opt_active' }],
      },
    });
    expect(blockedPost.statusCode).toBe(429);
  });
});
