/**
 * AC-FB-01 — a `repeating_group` question must declare its columns.
 *
 * This covers the DECISION, which is pure. The wiring that calls it — create,
 * and update against the type and validation the row will END UP with — needs a
 * real migrated Postgres and therefore lives in
 * tests/integration/ac-questions.test.ts. That suite needs Docker and was NOT
 * run on this machine.
 *
 * The guard matters more than its size suggests: `pruneValidation` in the web
 * question editor is the only thing that normally keeps `repeatingGroup` in the
 * bag on save (design §11.1), and a client-side filter is a convenience, never
 * a control. Anyone can PATCH `validation: {}` at the endpoint directly, and
 * without this the question would survive while its columns silently did not.
 */
import { describe, expect, it } from 'vitest';
import { ValidationRulesSchema, type ValidationRules } from '@sdb/contracts';
import { ApiError } from '../src/lib/errors.js';
import { assertRepeatingGroupConfigured } from '../src/services/questions.service.js';

const soundConfig = {
  repeatingGroup: {
    columns: [
      {
        key: 'skill',
        label: 'Skill',
        columnType: 'single_select',
        isRequired: true,
        choices: { from: 'question_options' },
      },
      { key: 'notes', label: 'Notes', columnType: 'short_text' },
    ],
    minRows: 0,
    maxRows: 20,
  },
};

const rules = (bag: Record<string, unknown>): ValidationRules =>
  ValidationRulesSchema.parse(bag);

function reasonFor(bag: Record<string, unknown>): ApiError {
  try {
    assertRepeatingGroupConfigured('repeating_group', rules(bag));
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected assertRepeatingGroupConfigured to throw.');
}

describe('assertRepeatingGroupConfigured', () => {
  it('accepts a well-formed config', () => {
    expect(() =>
      assertRepeatingGroupConfigured('repeating_group', rules(soundConfig)),
    ).not.toThrow();
  });

  it('AC-FB-01 — rejects a repeating group with no repeatingGroup key at all', () => {
    const error = reasonFor({});
    expect(error.code).toBe('INVALID_VALIDATION_RULE');
    expect(error.message).toMatch(/at least one column/i);
  });

  it('AC-FB-01 — rejects a bag that kept every other rule but dropped the columns', () => {
    // The exact shape pruneValidation would write if it forgot 'repeatingGroup'.
    expect(reasonFor({ maxLength: 200 }).code).toBe('INVALID_VALIDATION_RULE');
  });

  it('names the field, so the message reaches the question editor', () => {
    // details.fields is what the UI renders; a bare message does not surface.
    const fields = reasonFor({})['details']?.['fields'];
    expect(fields).toMatchObject({ validation: expect.any(String) as string });
  });

  it('rejects duplicate column keys with the reason from contracts', () => {
    const duplicate = {
      repeatingGroup: {
        columns: [
          soundConfig.repeatingGroup.columns[1],
          soundConfig.repeatingGroup.columns[1],
        ],
      },
    };
    const error = reasonFor(duplicate);
    expect(error.code).toBe('INVALID_VALIDATION_RULE');
    expect(error.message).toMatch(/duplicate/i);
  });

  it('rejects a single_select column that declares no choices', () => {
    const noChoices = {
      repeatingGroup: {
        columns: [
          {
            key: 'skill',
            label: 'Skill',
            columnType: 'single_select',
            isRequired: true,
          },
        ],
      },
    };
    expect(reasonFor(noChoices).message).toMatch(/choices/i);
  });

  it('rejects minRows above maxRows', () => {
    const impossible = {
      repeatingGroup: {
        ...soundConfig.repeatingGroup,
        minRows: 5,
        maxRows: 2,
      },
    };
    expect(reasonFor(impossible).message).toMatch(/minRows/);
  });

  it('says nothing about any other question type', () => {
    // The guard is scoped by type: a short_text question with no repeatingGroup
    // key is the normal case and must pass untouched.
    expect(() =>
      assertRepeatingGroupConfigured('short_text', rules({ maxLength: 200 })),
    ).not.toThrow();
    // …and a stray repeatingGroup bag on another type is the validation
    // editor's problem, not this guard's.
    expect(() =>
      assertRepeatingGroupConfigured('long_text', rules(soundConfig)),
    ).not.toThrow();
  });
});
