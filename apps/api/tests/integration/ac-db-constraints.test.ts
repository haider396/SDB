/**
 * AC-DB-03 — portal access without payment → check violation.
 * AC-DB-04 — two non-null answer value columns → check violation.
 * AC-DB-05 — answer value column must match the question type (all 12 types).
 * AC-DB-09 — question_type change with answer_count > 0 raises.
 * AC-DB-11 — one primary contact / one principal per client (partial unique).
 * AC-DB-12 — deleting an answered question_option is FK-blocked.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertAnswer,
  insertClient,
  insertClientMember,
  insertQuestion,
  insertQuestionCategory,
  insertQuestionOption,
  insertRequisition,
  insertUser,
  type AnswerValues,
} from './fixtures.js';
import { expectPgError, freshDb, type TestDb } from './harness.js';

// SQLSTATEs
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FK_VIOLATION = '23503';
const OBJECT_NOT_IN_PREREQUISITE_STATE = '55000';

let db: TestDb;
let clientId: string;
let requisitionId: string;
let categoryId: string;

beforeAll(async () => {
  db = await freshDb();
  clientId = await insertClient(db.sql);
  requisitionId = await insertRequisition(db.sql, { clientId });
  categoryId = await insertQuestionCategory(db.sql);
});

afterAll(async () => {
  await db.close();
});

describe('AC-DB-03 — portal access requires confirmed payment', () => {
  it('rejects portal_access_enabled_at with payment_confirmed_at null', async () => {
    const error = await expectPgError(
      insertClient(db.sql, { paymentConfirmed: false, portalAccessEnabled: true }),
      CHECK_VIOLATION,
    );
    expect(error.message).toContain('chk_access_requires_payment');
  });

  it('accepts portal access once payment is confirmed', async () => {
    await expect(
      insertClient(db.sql, { paymentConfirmed: true, portalAccessEnabled: true }),
    ).resolves.toBeTruthy();
  });
});

describe('AC-DB-04 — exactly one answer value column', () => {
  it('rejects an answer populating two value columns', async () => {
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
    });
    await expectPgError(
      insertAnswer(db.sql, {
        requisitionId,
        questionId,
        valueText: 'text',
        valueNumber: 42,
      }),
      CHECK_VIOLATION,
    );
  });
});

describe('AC-DB-05 — value column must match the question type (12 types)', () => {
  interface Case {
    type: string;
    ok: AnswerValues;
    bad: AnswerValues;
  }

  // `bad` populates exactly one column — the wrong one for the type.
  const cases: Case[] = [
    { type: 'short_text', ok: { valueText: 'x' }, bad: { valueNumber: 1 } },
    { type: 'long_text', ok: { valueText: 'x'.repeat(50) }, bad: { valueDate: '2026-01-01' } },
    { type: 'email', ok: { valueText: 'a@b.co' }, bad: { valueBoolean: true } },
    { type: 'phone', ok: { valueText: '+1-555-0100' }, bad: { valueJson: { n: 1 } } },
    { type: 'number', ok: { valueNumber: 42 }, bad: { valueText: '42' } },
    { type: 'scale', ok: { valueNumber: 3 }, bad: { valueBoolean: false } },
    { type: 'yes_no', ok: { valueBoolean: true }, bad: { valueText: 'yes' } },
    { type: 'date', ok: { valueDate: '2026-01-01' }, bad: { valueText: '2026-01-01' } },
    { type: 'single_select', ok: { valueText: 'opt_a' }, bad: { valueJson: ['opt_a'] } },
    { type: 'multi_select', ok: { valueJson: ['opt_a'] }, bad: { valueText: 'opt_a' } },
    {
      type: 'currency_range',
      ok: { valueJson: { min: 1000, max: 2000, unit: 'monthly', currency: 'USD' } },
      bad: { valueNumber: 1000 },
    },
    { type: 'file_upload', ok: { valueJson: { fileIds: [randomUUID()] } }, bad: { valueText: 'file.pdf' } },
  ];

  it.each(cases)(
    '$type: accepts the correct column, rejects the wrong one',
    async ({ type, ok, bad }) => {
      const okQuestion = await insertQuestion(db.sql, {
        categoryId,
        questionType: type,
      });
      await expect(
        insertAnswer(db.sql, { requisitionId, questionId: okQuestion, ...ok }),
      ).resolves.toBeTruthy();

      const badQuestion = await insertQuestion(db.sql, {
        categoryId,
        questionType: type,
      });
      await expectPgError(
        insertAnswer(db.sql, { requisitionId, questionId: badQuestion, ...bad }),
        CHECK_VIOLATION,
      );
    },
  );
});

describe('AC-DB-09 — question_type is frozen once answered', () => {
  it('raises when changing the type of a question with answer_count > 0', async () => {
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
    });
    await insertAnswer(db.sql, { requisitionId, questionId, valueText: 'answered' });

    const [row] = await db.sql<{ answer_count: number }[]>`
      select answer_count from questions where id = ${questionId}
    `;
    expect(row?.answer_count).toBe(1);

    await expectPgError(
      db.sql`update questions set question_type = 'long_text' where id = ${questionId}`,
      OBJECT_NOT_IN_PREREQUISITE_STATE,
    );
  });

  it('allows changing the type of an unanswered question', async () => {
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'short_text',
    });
    await expect(
      db.sql`update questions set question_type = 'long_text' where id = ${questionId}`,
    ).resolves.toBeTruthy();
  });
});

describe('AC-DB-11 — one primary contact and one principal per client', () => {
  it('rejects a second is_primary_contact = true for the same client', async () => {
    const client = await insertClient(db.sql);
    const userA = await insertUser(db.sql);
    const userB = await insertUser(db.sql);
    await insertClientMember(db.sql, {
      clientId: client,
      userId: userA,
      isPrimaryContact: true,
    });
    const error = await expectPgError(
      insertClientMember(db.sql, {
        clientId: client,
        userId: userB,
        isPrimaryContact: true,
      }),
      UNIQUE_VIOLATION,
    );
    expect(error.message).toContain('idx_one_primary_contact_per_client');
  });

  it('rejects a second is_principal = true for the same client', async () => {
    const client = await insertClient(db.sql);
    const userA = await insertUser(db.sql);
    const userB = await insertUser(db.sql);
    await insertClientMember(db.sql, {
      clientId: client,
      userId: userA,
      isPrincipal: true,
    });
    const error = await expectPgError(
      insertClientMember(db.sql, {
        clientId: client,
        userId: userB,
        isPrincipal: true,
      }),
      UNIQUE_VIOLATION,
    );
    expect(error.message).toContain('idx_one_principal_per_client');
  });

  it('allows primary contacts on different clients', async () => {
    const clientA = await insertClient(db.sql);
    const clientB = await insertClient(db.sql);
    const userA = await insertUser(db.sql);
    const userB = await insertUser(db.sql);
    await insertClientMember(db.sql, { clientId: clientA, userId: userA, isPrimaryContact: true });
    await expect(
      insertClientMember(db.sql, { clientId: clientB, userId: userB, isPrimaryContact: true }),
    ).resolves.toBeTruthy();
  });
});

describe('AC-DB-12 — answered options cannot be deleted', () => {
  it('blocks deleting a question_options row referenced by an answer', async () => {
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'single_select',
    });
    const optionId = await insertQuestionOption(db.sql, {
      questionId,
      value: 'opt_a',
    });
    const answerId = await insertAnswer(db.sql, {
      requisitionId,
      questionId,
      valueText: 'opt_a',
    });
    await db.sql`
      insert into requisition_answer_options (answer_id, option_id)
      values (${answerId}, ${optionId})
    `;

    await expectPgError(
      db.sql`delete from question_options where id = ${optionId}`,
      FK_VIOLATION,
    );
  });

  it('allows deleting an unanswered option', async () => {
    const questionId = await insertQuestion(db.sql, {
      categoryId,
      questionType: 'single_select',
    });
    const optionId = await insertQuestionOption(db.sql, { questionId });
    await expect(
      db.sql`delete from question_options where id = ${optionId}`,
    ).resolves.toBeTruthy();
  });
});
