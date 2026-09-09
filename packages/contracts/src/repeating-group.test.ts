import { describe, expect, it } from 'vitest';
import {
  RepeatingGroupConfigSchema,
  RepeatingGroupValueSchema,
  validateRepeatingGroupConfig,
} from './repeating-group.js';
import { ValidationRulesSchema } from './validation-rules.js';

const skillsConfig = {
  columns: [
    { key: 'skill', label: 'Skill', columnType: 'single_select', isRequired: true,
      choices: { from: 'question_options' } },
    { key: 'proficiency', label: 'Proficiency', columnType: 'single_select', isRequired: true,
      choices: { from: 'inline', options: [{ value: 'expert', label: 'Expert' }] } },
    { key: 'notes', label: 'Notes', columnType: 'short_text', isRequired: false, maxLength: 500 },
  ],
  minRows: 0,
  maxRows: 20,
};

describe('RepeatingGroupConfigSchema', () => {
  it('accepts the seeded skills-and-tools shape and applies defaults', () => {
    const result = RepeatingGroupConfigSchema.safeParse(skillsConfig);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.addRowLabel).toBe('Add another');
    expect(result.data.columns[0]?.widthWeight).toBe(1);
  });

  it('rejects a config with no columns', () => {
    expect(RepeatingGroupConfigSchema.safeParse({ ...skillsConfig, columns: [] }).success).toBe(false);
  });
});

describe('validateRepeatingGroupConfig', () => {
  it('accepts a valid config', () => {
    const config = RepeatingGroupConfigSchema.parse(skillsConfig);
    expect(validateRepeatingGroupConfig(config)).toBeNull();
  });

  it('rejects duplicate column keys', () => {
    const config = RepeatingGroupConfigSchema.parse({
      ...skillsConfig,
      columns: [skillsConfig.columns[0], skillsConfig.columns[0]],
    });
    expect(validateRepeatingGroupConfig(config)).toMatch(/duplicate/i);
  });

  it('rejects a single_select column with no choices', () => {
    const config = RepeatingGroupConfigSchema.parse({
      ...skillsConfig,
      columns: [{ key: 'skill', label: 'Skill', columnType: 'single_select', isRequired: true }],
    });
    expect(validateRepeatingGroupConfig(config)).toMatch(/choices/i);
  });

  it('rejects a non-select column that declares choices', () => {
    const config = RepeatingGroupConfigSchema.parse({
      ...skillsConfig,
      columns: [{ key: 'notes', label: 'Notes', columnType: 'short_text', isRequired: false,
                  choices: { from: 'question_options' } }],
    });
    expect(validateRepeatingGroupConfig(config)).toMatch(/choices/i);
  });

  it('rejects minRows greater than maxRows', () => {
    const config = RepeatingGroupConfigSchema.parse({ ...skillsConfig, minRows: 5, maxRows: 2 });
    expect(validateRepeatingGroupConfig(config)).toMatch(/minRows/);
  });
});

describe('RepeatingGroupValueSchema', () => {
  it('accepts rows of strings and numbers', () => {
    const result = RepeatingGroupValueSchema.safeParse({
      rows: [{ skill: 'ClickUp', proficiency: 'expert' }, { school: 'UNAM', year: 2019 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty rows array', () => {
    expect(RepeatingGroupValueSchema.safeParse({ rows: [] }).success).toBe(true);
  });

  it('rejects a bare array — the value is always an object with a rows key', () => {
    expect(RepeatingGroupValueSchema.safeParse([{ skill: 'ClickUp' }]).success).toBe(false);
  });

  it('rejects nested objects in a cell', () => {
    expect(RepeatingGroupValueSchema.safeParse({ rows: [{ skill: { a: 1 } }] }).success).toBe(false);
  });
});

describe('ValidationRulesSchema with repeatingGroup', () => {
  it('accepts a repeatingGroup config', () => {
    expect(ValidationRulesSchema.safeParse({ repeatingGroup: skillsConfig }).success).toBe(true);
  });

  it('still rejects an unknown key — the schema stays strict (AC-Q-11)', () => {
    expect(ValidationRulesSchema.safeParse({ repeatingGroups: skillsConfig }).success).toBe(false);
  });

  it('parses an existing rule bag to an object with no repeatingGroup key', () => {
    const parsed = ValidationRulesSchema.parse({ maxLength: 200 });
    expect('repeatingGroup' in parsed).toBe(false);
  });
});

/**
 * Regression guard for the import cycle documented at the top of options.ts.
 *
 * Loading the BARREL is what exposes it. Entered through `./index.js` the cycle
 * validation-rules → repeating-group → intake → validation-rules does not throw:
 * intake.ts evaluates while validation-rules.js is still initialising, so
 * IntakeFormQuestionSchema.shape.validation is left `undefined` and every parse
 * of a form question dies at runtime instead. Importing './intake.js' directly
 * would not reproduce it, which is why this test goes through the barrel.
 */
describe('barrel module graph is acyclic', () => {
  it('IntakeFormQuestionSchema still validates its validation bag', async () => {
    const { IntakeFormQuestionSchema } = await import('./index.js');
    const question = {
      id: '00000000-0000-4000-8000-000000000001',
      key: 'skills_and_tools',
      label: 'Skills & tools',
      helpText: null,
      placeholder: null,
      questionType: 'short_text',
      isRequired: false,
      sortOrder: 1,
      validation: { maxLength: 200 },
      options: [],
      conditional: null,
    };
    expect(IntakeFormQuestionSchema.safeParse(question).success).toBe(true);
    expect(
      IntakeFormQuestionSchema.safeParse({
        ...question,
        validation: { maxLenght: 200 },
      }).success,
    ).toBe(false);
  });
});
