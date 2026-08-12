import { describe, expect, it } from 'vitest';
import {
  CreateQuestionBodySchema,
  ListQuestionsQuerySchema,
  QuestionKeySchema,
  QuestionSchema,
  ReorderQuestionsBodySchema,
  UpdateQuestionBodySchema,
  UpdateQuestionOptionBodySchema,
} from './questions.js';

const UUID = '6f1f4e9a-3f6a-4a3e-9a3e-1c2d3e4f5a6b';

describe('QuestionKeySchema', () => {
  it('accepts snake_case slugs', () => {
    expect(QuestionKeySchema.safeParse('company_name').success).toBe(true);
    expect(QuestionKeySchema.safeParse('q2_follow_up').success).toBe(true);
  });

  it('rejects non-slug keys', () => {
    expect(QuestionKeySchema.safeParse('Company Name').success).toBe(false);
    expect(QuestionKeySchema.safeParse('2starts_with_digit').success).toBe(false);
    expect(QuestionKeySchema.safeParse('').success).toBe(false);
  });
});

describe('CreateQuestionBodySchema', () => {
  it('accepts the documented create body from 04 §4', () => {
    const result = CreateQuestionBodySchema.safeParse({
      categoryId: UUID,
      label: 'Spoken English requirement',
      questionType: 'single_select',
      audience: 'client',
      isRequired: true,
      validation: {},
      options: [
        { value: 'basic', label: 'Basic' },
        { value: 'professional', label: 'Professional', sortOrder: 2 },
      ],
      roleCategoryIds: [UUID],
      conditional: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an explicit key at creation only (immutability is API behaviour)', () => {
    expect(
      CreateQuestionBodySchema.safeParse({
        categoryId: UUID,
        key: 'english_spoken_required',
        label: 'Spoken English requirement',
        questionType: 'single_select',
        audience: 'client',
        isRequired: true,
      }).success,
    ).toBe(true);
  });

  it('rejects a missing audience', () => {
    expect(
      CreateQuestionBodySchema.safeParse({
        categoryId: UUID,
        label: 'X',
        questionType: 'short_text',
        isRequired: false,
      }).success,
    ).toBe(false);
  });

  it('leaves validation-bag strictness to the API (INVALID_VALIDATION_RULE, not 400)', () => {
    // The body schema accepts any record so the API can answer with the
    // documented 422 INVALID_VALIDATION_RULE instead of a generic 400.
    expect(
      CreateQuestionBodySchema.safeParse({
        categoryId: UUID,
        label: 'X',
        questionType: 'short_text',
        audience: 'client',
        isRequired: false,
        validation: { bogus: 1 },
      }).success,
    ).toBe(true);
  });
});

describe('UpdateQuestionBodySchema', () => {
  it('rejects an empty patch', () => {
    expect(UpdateQuestionBodySchema.safeParse({}).success).toBe(false);
  });

  it('accepts a conditional clear (null)', () => {
    expect(
      UpdateQuestionBodySchema.safeParse({ conditional: null }).success,
    ).toBe(true);
  });
});

describe('UpdateQuestionOptionBodySchema', () => {
  it('rejects an empty patch', () => {
    expect(UpdateQuestionOptionBodySchema.safeParse({}).success).toBe(false);
  });
  it('accepts label and sortOrder', () => {
    expect(
      UpdateQuestionOptionBodySchema.safeParse({ label: 'New', sortOrder: 3 })
        .success,
    ).toBe(true);
  });
});

describe('ReorderQuestionsBodySchema', () => {
  it('requires at least one id', () => {
    expect(
      ReorderQuestionsBodySchema.safeParse({
        categoryId: UUID,
        orderedQuestionIds: [],
      }).success,
    ).toBe(false);
  });
});

describe('ListQuestionsQuerySchema', () => {
  it('parses query-string booleans', () => {
    const result = ListQuestionsQuerySchema.parse({
      isActive: 'false',
      includeAnswerCounts: 'true',
    });
    expect(result.isActive).toBe(false);
    expect(result.includeAnswerCounts).toBe(true);
  });

  it('rejects a non-boolean flag', () => {
    expect(ListQuestionsQuerySchema.safeParse({ isActive: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('QuestionSchema', () => {
  it('accepts a full admin question row', () => {
    const result = QuestionSchema.safeParse({
      id: UUID,
      categoryId: UUID,
      key: 'company_name',
      label: 'Company name',
      helpText: null,
      placeholder: 'Acme Inc.',
      questionType: 'short_text',
      audience: 'client',
      isRequired: true,
      isActive: true,
      sortOrder: 1,
      validation: { maxLength: 200 },
      conditional: null,
      options: [],
      roleCategoryIds: [],
      answerCount: 0,
      createdAt: '2026-08-12T09:00:00Z',
      updatedAt: '2026-08-12T09:00:00Z',
      archivedAt: null,
    });
    expect(result.success).toBe(true);
  });
});
