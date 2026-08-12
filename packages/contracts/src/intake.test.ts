import { describe, expect, it } from 'vitest';
import {
  IntakeAnswerSchema,
  IntakeFormResponseSchema,
  IntakeSubmissionSchema,
} from './intake.js';

describe('IntakeAnswerSchema', () => {
  it('accepts exactly one value field', () => {
    expect(
      IntakeAnswerSchema.safeParse({
        questionKey: 'company_name',
        valueText: 'Acme Inc.',
      }).success,
    ).toBe(true);
    expect(
      IntakeAnswerSchema.safeParse({
        questionKey: 'budget_range',
        valueJson: { min: 1500, max: 2500, unit: 'monthly', currency: 'USD' },
      }).success,
    ).toBe(true);
    expect(
      IntakeAnswerSchema.safeParse({
        questionKey: 'target_start_date',
        valueDate: '2026-09-15',
      }).success,
    ).toBe(true);
  });

  it('rejects two value fields set', () => {
    const result = IntakeAnswerSchema.safeParse({
      questionKey: 'headcount',
      valueNumber: 2,
      valueText: 'two',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero value fields set', () => {
    expect(
      IntakeAnswerSchema.safeParse({ questionKey: 'company_name' }).success,
    ).toBe(false);
  });

  it('rejects a malformed valueDate', () => {
    expect(
      IntakeAnswerSchema.safeParse({
        questionKey: 'target_start_date',
        valueDate: '15/09/2026',
      }).success,
    ).toBe(false);
  });
});

describe('IntakeSubmissionSchema', () => {
  it('accepts the documented submission payload from 03 §3.3', () => {
    const result = IntakeSubmissionSchema.safeParse({
      formVersionHash: 'sha256:8f14e45f',
      roleCategoryId: '6f1f4e9a-3f6a-4a3e-9a3e-1c2d3e4f5a6b',
      answers: [
        { questionKey: 'company_name', valueText: 'Acme Inc.' },
        { questionKey: 'team_size_band', valueText: '6-15' },
        {
          questionKey: 'budget_range',
          valueJson: { min: 1500, max: 2500, unit: 'monthly', currency: 'USD' },
        },
        { questionKey: 'tools_required', valueJson: ['clickup', 'gohighlevel'] },
        { questionKey: 'portfolio_required', valueBoolean: true },
        { questionKey: 'target_start_date', valueDate: '2026-09-15' },
        { questionKey: 'years_experience_min', valueNumber: 3 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty answers array', () => {
    expect(
      IntakeSubmissionSchema.safeParse({
        formVersionHash: 'sha256:abc',
        roleCategoryId: '6f1f4e9a-3f6a-4a3e-9a3e-1c2d3e4f5a6b',
        answers: [],
      }).success,
    ).toBe(false);
  });
});

describe('IntakeFormResponseSchema', () => {
  it('accepts the documented form rendering response from 03 §3.2', () => {
    const result = IntakeFormResponseSchema.safeParse({
      formVersionHash: 'sha256:8f14e45f',
      generatedAt: '2026-08-12T09:00:00Z',
      categories: [
        {
          id: '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
          key: 'company_contact',
          label: 'Company & contact',
          description: 'Tell us who you are',
          sortOrder: 1,
          questions: [
            {
              id: '1a2b3c4d-5e6f-4a7b-9c8d-1e2f3a4b5c6d',
              key: 'company_name',
              label: 'Company name',
              helpText: null,
              placeholder: 'Acme Inc.',
              questionType: 'short_text',
              isRequired: true,
              sortOrder: 1,
              validation: { maxLength: 200 },
              options: [],
              conditional: null,
            },
            {
              id: '2b3c4d5e-6f7a-4b8c-9d0e-2f3a4b5c6d7e',
              key: 'industry_experience_detail',
              label: 'Which industry?',
              helpText: null,
              placeholder: null,
              questionType: 'short_text',
              isRequired: false,
              sortOrder: 9,
              validation: {},
              options: [],
              conditional: {
                questionKey: 'industry_experience_required',
                operator: 'is_true',
                value: null,
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown validation key inside a rendered question', () => {
    expect(
      IntakeFormResponseSchema.safeParse({
        formVersionHash: 'sha256:x',
        generatedAt: '2026-08-12T09:00:00Z',
        categories: [
          {
            id: '0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d',
            key: 'k',
            label: 'L',
            description: null,
            sortOrder: 1,
            questions: [
              {
                id: '1a2b3c4d-5e6f-4a7b-9c8d-1e2f3a4b5c6d',
                key: 'q',
                label: 'Q',
                helpText: null,
                placeholder: null,
                questionType: 'short_text',
                isRequired: false,
                sortOrder: 1,
                validation: { bogus: 1 },
                options: [],
                conditional: null,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
