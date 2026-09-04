/**
 * Guards on candidate questions.
 *
 * The candidate mapped keys — `email`, `first_name`, `country` and the rest of
 * CANDIDATE_MAPPED_QUESTION_KEYS — project onto real `candidates` columns, but
 * only the CLIENT list was ever enforced. `DELETE /questions/<the email
 * question>` archived it and returned 204.
 *
 * That was survivable only because the Questions admin page kept its own
 * client-side guard rails. Candidate questions are now managed from the form
 * builder instead, so the protection has to live on the server. These tests are
 * the proof; they were written against the old code first and failed.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QuestionDetail } from '@sdb/contracts';
import {
  assignRole,
  insertQuestion,
  insertQuestionCategory,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

let db: TestDb;
let harness: TestApp;
let superAdmin: string;
let categoryId: string;

beforeAll(async () => {
  db = await freshDb();
  superAdmin = await insertUser(db.sql);
  await assignRole(db.sql, superAdmin, 'super_admin');
  harness = await buildTestApp(db);
  categoryId = await insertQuestionCategory(db.sql);
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

async function candidateQuestion(key: string): Promise<string> {
  return insertQuestion(db.sql, {
    categoryId,
    questionType: 'short_text',
    audience: 'candidate',
    key,
  });
}

function errorCode(res: { json: <T>() => T }): string {
  return res.json<{ error: { code: string } }>().error.code;
}

describe('candidate mapped questions are protected like client ones', () => {
  it('refuses to archive the email question', async () => {
    const id = await candidateQuestion('email');
    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/questions/${id}`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('MAPPED_QUESTION_PROTECTED');
  });

  it('refuses to archive any other candidate mapped question', async () => {
    const id = await candidateQuestion('first_name');
    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/questions/${id}`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(409);
  });

  it('refuses to re-key a candidate mapped question', async () => {
    const id = await candidateQuestion('country');
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${id}`,
      headers: await harness.bearer(superAdmin),
      payload: { key: 'country_renamed' },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('MAPPED_QUESTION_PROTECTED');
  });

  it('still archives an ordinary candidate question', async () => {
    // The guard must be about mapped keys, not about being a candidate
    // question — otherwise nothing built in the form builder could be retired.
    const id = await candidateQuestion(`q_ordinary_${randomUUID().slice(0, 8)}`);
    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/questions/${id}`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('the identity question cannot be switched off', () => {
  it('refuses to deactivate email', async () => {
    const id = await candidateQuestion('email');
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/questions/${id}/deactivate`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('MAPPED_QUESTION_PROTECTED');
  });

  it('allows deactivating another mapped question, but warns what it costs', async () => {
    const id = await candidateQuestion('city');
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/questions/${id}/deactivate`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { warnings: { code: string }[] } }>();
    expect(body.data.warnings.some((w) => w.code === 'MAPPED_QUESTION')).toBe(true);
  });
});

describe('a question in use cannot leave the candidate audience', () => {
  /** A minimal live form with one block pointing at `questionId`. */
  async function formUsing(questionId: string, label: string): Promise<void> {
    const formId = randomUUID();
    const versionId = randomUUID();
    await db.sql`
      insert into candidate_forms (id, key, label, status, is_default)
      values (${formId}, ${`f_${formId.slice(0, 8)}`}, ${label}, 'active', false)
    `;
    await db.sql`
      insert into candidate_form_versions (id, form_id, version_number, pages, theme)
      values (${versionId}, ${formId}, 1, '[]'::jsonb, '{}'::jsonb)
    `;
    await db.sql`
      insert into candidate_form_blocks
        (id, form_version_id, block_type, question_id, page_index, sort_order, layout)
      values (${randomUUID()}, ${versionId}, 'question', ${questionId}, 0, 0, '{}'::jsonb)
    `;
  }

  it('refuses, and names the forms that would silently lose the question', async () => {
    const id = await candidateQuestion(`q_inuse_${randomUUID().slice(0, 8)}`);
    await formUsing(id, 'Video Editor');

    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${id}`,
      headers: await harness.bearer(superAdmin),
      payload: { audience: 'client' },
    });

    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('MAPPED_QUESTION_PROTECTED');
    // The message has to say WHICH form, or an admin cannot act on it.
    expect(res.json<{ error: { message: string } }>().error.message).toContain(
      'Video Editor',
    );
  });

  it('allows the change once no form uses it', async () => {
    const id = await candidateQuestion(`q_free_${randomUUID().slice(0, 8)}`);
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${id}`,
      headers: await harness.bearer(superAdmin),
      payload: { audience: 'client' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /questions/:id reports which forms use the question', () => {
  it('lists them, so the builder can warn before a library edit', async () => {
    const id = await candidateQuestion(`q_used_${randomUUID().slice(0, 8)}`);
    const formId = randomUUID();
    const versionId = randomUUID();
    await db.sql`
      insert into candidate_forms (id, key, label, status, is_default)
      values (${formId}, ${`f_${formId.slice(0, 8)}`}, 'Executive Assistant', 'active', false)
    `;
    await db.sql`
      insert into candidate_form_versions (id, form_id, version_number, pages, theme)
      values (${versionId}, ${formId}, 1, '[]'::jsonb, '{}'::jsonb)
    `;
    await db.sql`
      insert into candidate_form_blocks
        (id, form_version_id, block_type, question_id, page_index, sort_order, layout)
      values (${randomUUID()}, ${versionId}, 'question', ${id}, 0, 0, '{}'::jsonb)
    `;

    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/questions/${id}`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json<{ data: QuestionDetail }>().data;
    expect(detail.usedByForms.map((form) => form.label)).toEqual([
      'Executive Assistant',
    ]);
  });

  it('is empty for a question no form has picked up', async () => {
    const id = await candidateQuestion(`q_unused_${randomUUID().slice(0, 8)}`);
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/questions/${id}`,
      headers: await harness.bearer(superAdmin),
    });
    expect(res.json<{ data: QuestionDetail }>().data.usedByForms).toEqual([]);
  });
});
