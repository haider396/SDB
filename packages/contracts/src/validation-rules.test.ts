import { describe, expect, it } from 'vitest';
import { ValidationRulesSchema } from './validation-rules.js';

describe('ValidationRulesSchema', () => {
  it('accepts the full documented rule bag from 02-DATABASE §6', () => {
    const result = ValidationRulesSchema.safeParse({
      minLength: 0,
      maxLength: 5000,
      min: 0,
      max: 1000000,
      minSelections: 1,
      maxSelections: 5,
      pattern: '^[0-9]{4}$',
      scaleMin: 1,
      scaleMax: 5,
      scaleMinLabel: 'Low',
      scaleMaxLabel: 'High',
      currency: 'USD',
      allowedUnits: ['hourly', 'monthly'],
      acceptedMimeTypes: ['application/pdf'],
      maxFileSizeMb: 25,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty bag (the column default)', () => {
    expect(ValidationRulesSchema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown keys (drives 422 INVALID_VALIDATION_RULE)', () => {
    const result = ValidationRulesSchema.safeParse({ maxLenght: 10 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe('unrecognized_keys');
    }
  });

  it('rejects an unknown key even alongside valid keys', () => {
    expect(
      ValidationRulesSchema.safeParse({ minLength: 1, required: true }).success,
    ).toBe(false);
  });

  it('rejects wrong-typed values for known keys', () => {
    expect(ValidationRulesSchema.safeParse({ minLength: 'ten' }).success).toBe(
      false,
    );
    expect(
      ValidationRulesSchema.safeParse({ allowedUnits: ['weekly'] }).success,
    ).toBe(false);
  });
});

/**
 * Regression guard for the additive `repeatingGroup` key.
 *
 * `questions.validation` is stored jsonb that is re-parsed on every form read
 * (intake-form, candidate-registration-form and candidate-form-public all call
 * ValidationRulesSchema.parse on the raw column). Adding a key to a `.strict()`
 * schema is only safe if every value already in the column parses to exactly
 * what it parsed to before — a `repeatingGroup: undefined` slipped into the
 * output would change `question_snapshot` for every answer ever written, since
 * buildSnapshot() copies `validation` verbatim.
 *
 * The bags below are the distinct `validation` literals actually present in
 * supabase/seed/dev_seed.sql, written in schema-declaration order, which is the
 * order z.object emits — so JSON.stringify equality here is literal byte
 * identity, not just deep equality.
 */
describe('ValidationRulesSchema is byte-identical for pre-existing rule bags', () => {
  const storedBags: readonly Record<string, unknown>[] = [
    {},
    { maxLength: 200 },
    { maxLength: 20000 },
    { min: 0, max: 100 },
    { minSelections: 1, maxSelections: 4 },
    { pattern: '^[0-9]{4}$' },
    { scaleMin: 1, scaleMax: 5, scaleMinLabel: 'Exploring', scaleMaxLabel: 'Yesterday' },
    { currency: 'USD', allowedUnits: ['hourly', 'monthly'] },
    { acceptedMimeTypes: ['application/pdf'], maxFileSizeMb: 25 },
    {
      minLength: 0,
      maxLength: 5000,
      min: 0,
      max: 1000000,
      minSelections: 1,
      maxSelections: 5,
      pattern: '^[0-9]{4}$',
      scaleMin: 1,
      scaleMax: 5,
      scaleMinLabel: 'Low',
      scaleMaxLabel: 'High',
      currency: 'USD',
      allowedUnits: ['hourly', 'monthly'],
      acceptedMimeTypes: ['application/pdf'],
      maxFileSizeMb: 25,
    },
  ];

  it.each(storedBags)('round-trips %j unchanged', (bag) => {
    const parsed = ValidationRulesSchema.parse(bag);
    expect(parsed).toEqual(bag);
    // Deep equality alone would not catch an injected `repeatingGroup: undefined`,
    // which toEqual treats as absent. The key list does.
    expect(Object.keys(parsed)).toEqual(Object.keys(bag));
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(bag));
  });
});
