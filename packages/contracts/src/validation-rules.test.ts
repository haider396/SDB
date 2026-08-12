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
