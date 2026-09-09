/**
 * How a repeating-group answer travels through the shared submission pipeline:
 * which 422 it earns, what reaches `details.fields`, what gets stored, and what
 * is frozen into `question_snapshot`.
 *
 * `validateSubmission` and `buildSnapshot` are both pure and both exported, so
 * the whole contract can be pinned here without Docker. All four submission
 * paths — /intake-submissions, /requisitions, the public candidate form and
 * /candidate-registrations — call these two functions, so this is the one place
 * the behaviour is decided.
 *
 * What this does NOT prove is anything below the service: that the answer-shape
 * trigger accepts value_json for the type (AC-FB-02), and that the row actually
 * lands. Those need a real migrated Postgres — tests/integration — which needs
 * Docker and was not run here.
 */
import { describe, expect, it } from 'vitest';
import type { IntakeAnswer, RepeatingGroupFieldError } from '@sdb/contracts';
import { ApiError } from '../src/lib/errors.js';
import {
  buildSnapshot,
  validateSubmission,
} from '../src/services/intake-submission.service.js';
import type { FormQuestionRecord } from '../src/repositories/intake.repo.js';

const CAPTURED_AT = '2026-09-09T10:00:00.000Z';

const REPEATING_GROUP_RULES = {
  repeatingGroup: {
    columns: [
      {
        key: 'skill',
        label: 'Skill',
        columnType: 'single_select',
        isRequired: true,
        widthWeight: 2,
        choices: { from: 'question_options' },
      },
      {
        key: 'proficiency',
        label: 'Proficiency',
        columnType: 'single_select',
        isRequired: true,
        widthWeight: 1,
        choices: {
          from: 'inline',
          options: [
            { value: 'aware', label: 'Aware' },
            { value: 'expert', label: 'Expert' },
          ],
        },
      },
      {
        key: 'notes',
        label: 'Notes',
        columnType: 'short_text',
        isRequired: false,
        widthWeight: 3,
        maxLength: 500,
      },
    ],
    minRows: 0,
    maxRows: 2,
    addRowLabel: 'Add another',
  },
};

function skillsQuestion(
  overrides: Partial<FormQuestionRecord> = {},
): FormQuestionRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key: 'skills_and_tools',
    label: 'Skills & tools',
    helpText: null,
    placeholder: null,
    questionType: 'repeating_group',
    isRequired: false,
    sortOrder: 1,
    validation: REPEATING_GROUP_RULES,
    conditionalKey: null,
    conditionalOperator: null,
    conditionalValue: null,
    categoryId: '00000000-0000-4000-8000-000000000002',
    categoryKey: 'skills',
    categoryLabel: 'Skills',
    categoryDescription: null,
    categorySortOrder: 1,
    options: [
      { id: 'opt-1', value: 'ClickUp', label: 'ClickUp' },
      { id: 'opt-2', value: 'Notion', label: 'Notion' },
      { id: 'opt-3', value: 'Figma', label: 'Figma' },
    ],
    ...overrides,
  };
}

const answer = (valueJson: unknown): IntakeAnswer =>
  ({ questionKey: 'skills_and_tools', valueJson } as IntakeAnswer);

function failure(
  scope: FormQuestionRecord[],
  answers: IntakeAnswer[],
): ApiError {
  try {
    validateSubmission(scope, answers);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected validateSubmission to throw.');
}

function rowsOf(error: ApiError): readonly RepeatingGroupFieldError[] {
  const fields = error['details']?.['fields'] as
    | Record<string, { rows?: readonly RepeatingGroupFieldError[] }>
    | undefined;
  return fields?.['skills_and_tools']?.rows ?? [];
}

describe('validateSubmission — repeating groups', () => {
  it('stores the NORMALISED rows, not what arrived on the wire', () => {
    const prepared = validateSubmission(
      [skillsQuestion()],
      [
        answer({
          rows: [
            {
              skill: 'ClickUp',
              proficiency: 'expert',
              notes: '  ran the migration  ',
              retired_column: 'x',
            },
            {},
          ],
        }),
      ],
    );
    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.valueJson).toEqual({
      rows: [
        { skill: 'ClickUp', proficiency: 'expert', notes: 'ran the migration' },
      ],
    });
    // No answer_options rows: the join table's PK is (answer_id, option_id) and
    // cannot say WHICH row picked the option.
    expect(prepared[0]?.optionIds).toEqual([]);
    // The scalar columns stay null — the shape trigger allows exactly one.
    expect(prepared[0]?.valueText).toBeNull();
    expect(prepared[0]?.valueNumber).toBeNull();
  });

  it('rejects a bare array at step 3 — the value is always { rows: [...] }', () => {
    const error = failure(
      [skillsQuestion()],
      [answer([{ skill: 'ClickUp', proficiency: 'expert' }])],
    );
    expect(error.code).toBe('VALUE_TYPE_MISMATCH');
  });

  it('AC-FB-03 — names EVERY offending row and column, not just the first', () => {
    const error = failure(
      [skillsQuestion()],
      [answer({ rows: [{ skill: 'ClickUp' }, { skill: 'Notion' }] })],
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(rowsOf(error)).toEqual([
      { rowIndex: 0, columnKey: 'proficiency', message: expect.any(String) as string },
      { rowIndex: 1, columnKey: 'proficiency', message: expect.any(String) as string },
    ]);
  });

  it('keeps a top-level message, so a client that knows nothing about rows still works', () => {
    const error = failure(
      [skillsQuestion()],
      [answer({ rows: [{ skill: 'ClickUp' }, { skill: 'Notion' }] })],
    );
    const fields = error['details']?.['fields'] as Record<
      string,
      { message?: unknown }
    >;
    expect(fields['skills_and_tools']?.message).toBe('2 rows have problems.');
  });

  it('AC-FB-04 — a row-count failure is a plain string; it has no cell to point at', () => {
    const three = Array.from({ length: 3 }, () => ({
      skill: 'ClickUp',
      proficiency: 'expert',
    }));
    const error = failure([skillsQuestion()], [answer({ rows: three })]);
    expect(error.code).toBe('VALIDATION_FAILED');
    const fields = error['details']?.['fields'] as Record<string, unknown>;
    expect(fields['skills_and_tools']).toMatch(/at most 2 rows/i);
  });

  it('AC-FB-06 — a value that is not an active option is INVALID_OPTION, naming the cell', () => {
    const error = failure(
      [skillsQuestion()],
      [answer({ rows: [{ skill: 'Airtable', proficiency: 'expert' }] })],
    );
    expect(error.code).toBe('INVALID_OPTION');
    expect(rowsOf(error)).toEqual([
      {
        rowIndex: 0,
        columnKey: 'skill',
        message: expect.stringMatching(/not an active option/i) as unknown as string,
      },
    ]);
  });

  it('AC-FB-05 — a submission of only empty rows is dropped from an OPTIONAL question', () => {
    const prepared = validateSubmission(
      [skillsQuestion()],
      [answer({ rows: [{}, { notes: '   ' }] })],
    );
    // Not an error, and not an empty answer row either: it is simply unanswered.
    expect(prepared).toEqual([]);
  });

  it('AC-FB-05 — the same submission fails a REQUIRED question as missing', () => {
    const error = failure(
      [skillsQuestion({ isRequired: true })],
      [answer({ rows: [{}, {}] })],
    );
    expect(error.code).toBe('REQUIRED_ANSWER_MISSING');
    expect(error['details']?.['missingKeys']).toEqual(['skills_and_tools']);
  });

  it('refuses an answer to a repeating group that declares no columns', () => {
    const error = failure(
      [skillsQuestion({ validation: {} })],
      [answer({ rows: [{ skill: 'ClickUp' }] })],
    );
    expect(error.code).toBe('VALIDATION_FAILED');
  });
});

describe('buildSnapshot — repeating groups (AC-FB-07)', () => {
  const stored = {
    rows: [
      { skill: 'ClickUp', proficiency: 'expert' },
      { skill: 'ClickUp', proficiency: 'aware' },
    ],
  };

  it('resolves the catalogue column inline, carrying only the options the rows use', () => {
    const snapshot = buildSnapshot(skillsQuestion(), CAPTURED_AT, stored);
    const group = snapshot['repeatingGroup'] as {
      columns: { key: string; choices?: unknown }[];
      minRows: number;
      maxRows: number;
    };
    expect(group.columns.find((column) => column.key === 'skill')?.choices).toEqual({
      from: 'inline',
      options: [{ value: 'ClickUp', label: 'ClickUp' }],
    });
    expect(group.minRows).toBe(0);
    expect(group.maxRows).toBe(2);
  });

  it('does NOT write the top-level options catalogue — it would be stored twice', () => {
    const snapshot = buildSnapshot(skillsQuestion(), CAPTURED_AT, stored);
    expect(snapshot['options']).toBeUndefined();
  });

  it('is empty-but-present when the answer carries no rows', () => {
    const snapshot = buildSnapshot(skillsQuestion(), CAPTURED_AT, { rows: [] });
    expect(snapshot['repeatingGroup']).toBeDefined();
  });

  it('still writes the options catalogue for every other question type', () => {
    // The regression that matters: this branch must be invisible to the twelve
    // types that came before it.
    const multi = skillsQuestion({
      questionType: 'multi_select',
      validation: {},
    });
    const snapshot = buildSnapshot(multi, CAPTURED_AT, ['ClickUp']);
    expect(snapshot['options']).toEqual([
      { value: 'ClickUp', label: 'ClickUp' },
      { value: 'Notion', label: 'Notion' },
      { value: 'Figma', label: 'Figma' },
    ]);
    expect(snapshot['repeatingGroup']).toBeUndefined();
  });
});
