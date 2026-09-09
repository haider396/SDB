/**
 * The repeating-group row validator. Pure, so it runs without Docker — which
 * matters, because the integration suite that covers AC-FB-03..07 end to end
 * cannot run on this machine.
 */
import { describe, expect, it } from 'vitest';
import { RepeatingGroupConfigSchema } from '@sdb/contracts';
import {
  hasNoAnsweredCells,
  normaliseRepeatingGroup,
  readRepeatingGroupConfig,
  snapshotRepeatingGroup,
} from '../src/services/repeating-group.js';

const config = RepeatingGroupConfigSchema.parse({
  columns: [
    {
      key: 'skill',
      label: 'Skill',
      columnType: 'single_select',
      isRequired: true,
      choices: { from: 'question_options' },
    },
    {
      key: 'proficiency',
      label: 'Proficiency',
      columnType: 'single_select',
      isRequired: true,
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
      maxLength: 10,
    },
    {
      key: 'year',
      label: 'Year',
      columnType: 'number',
      isRequired: false,
      min: 1950,
      max: 2100,
    },
    { key: 'from_month', label: 'From', columnType: 'month', isRequired: false },
  ],
  minRows: 1,
  maxRows: 3,
});

const questionOptions = [
  { value: 'ClickUp', label: 'ClickUp' },
  { value: 'Notion', label: 'Notion' },
];

const run = (value: unknown) =>
  normaliseRepeatingGroup(config, questionOptions, value);

describe('normaliseRepeatingGroup', () => {
  it('returns the rows unchanged when every cell is valid', () => {
    const result = run({
      rows: [{ skill: 'ClickUp', proficiency: 'expert', notes: 'ok' }],
    });
    expect(result.groupError).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { skill: 'ClickUp', proficiency: 'expert', notes: 'ok' },
    ]);
  });

  it('sets a groupError when the value is not { rows: [...] }', () => {
    expect(run([{ skill: 'ClickUp' }]).groupError).not.toBeNull();
    expect(run({ rows: 'nope' }).groupError).not.toBeNull();
    expect(run(undefined).groupError).not.toBeNull();
  });

  it('AC-FB-05 — drops a wholly empty row instead of rejecting it', () => {
    const result = run({
      rows: [{ skill: 'ClickUp', proficiency: 'expert' }, {}],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('AC-FB-05 — treats a whitespace-only cell as no answer, not as a value', () => {
    const result = run({
      rows: [{ skill: 'ClickUp', proficiency: 'expert' }, { notes: '   ' }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('strips an unknown column key without erroring', () => {
    const result = run({
      rows: [{ skill: 'ClickUp', proficiency: 'expert', retired: 'x' }],
    });
    expect(result.rows[0]).toEqual({ skill: 'ClickUp', proficiency: 'expert' });
    expect(result.errors).toEqual([]);
  });

  it('drops a row left empty by stripping — a retired column is not an answer', () => {
    const result = run({
      rows: [{ skill: 'ClickUp', proficiency: 'expert' }, { retired: 'x' }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('AC-FB-03 — reports EVERY row missing a required column, not just the first', () => {
    const result = run({ rows: [{ skill: 'ClickUp' }, { skill: 'Notion' }] });
    expect(result.errors).toEqual([
      {
        rowIndex: 0,
        columnKey: 'proficiency',
        message: expect.stringMatching(/required/i) as unknown as string,
      },
      {
        rowIndex: 1,
        columnKey: 'proficiency',
        message: expect.stringMatching(/required/i) as unknown as string,
      },
    ]);
  });

  it('AC-FB-03 — collects several failures in ONE row, row-major', () => {
    const result = run({
      rows: [{ skill: 'Airtable', notes: 'x'.repeat(11), year: 'abc' }],
    });
    expect(
      result.errors.map((error) => [error.rowIndex, error.columnKey]),
    ).toEqual([
      [0, 'skill'],
      [0, 'proficiency'],
      [0, 'notes'],
      [0, 'year'],
    ]);
  });

  it('AC-FB-06 — rejects a choice value that is not an active option, naming the cell', () => {
    const result = run({ rows: [{ skill: 'Airtable', proficiency: 'expert' }] });
    expect(result.errors).toEqual([
      {
        rowIndex: 0,
        columnKey: 'skill',
        message: expect.stringMatching(
          /not an active option/i,
        ) as unknown as string,
      },
    ]);
  });

  it('partitions option failures away from rule failures — the two carry different codes', () => {
    const result = run({
      rows: [{ skill: 'Airtable' }, { skill: 'ClickUp', proficiency: 'aware' }],
    });
    expect(result.optionErrors).toEqual([
      { rowIndex: 0, columnKey: 'skill', message: expect.any(String) as string },
    ]);
    expect(result.ruleErrors).toEqual([
      {
        rowIndex: 0,
        columnKey: 'proficiency',
        message: expect.any(String) as string,
      },
    ]);
    // The partitions are disjoint and their union is `errors`.
    expect(result.errors).toHaveLength(2);
  });

  it('coerces a numeric string and rejects a non-numeric one', () => {
    const ok = run({
      rows: [{ skill: 'ClickUp', proficiency: 'expert', year: '1999' }],
    });
    expect(ok.rows[0]?.year).toBe(1999);
    const bad = run({
      rows: [{ skill: 'ClickUp', proficiency: 'expert', year: 'abc' }],
    });
    expect(bad.errors[0]).toMatchObject({ rowIndex: 0, columnKey: 'year' });
  });

  it('enforces min, max and maxLength per cell', () => {
    expect(
      run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', year: 1900 }] })
        .errors[0],
    ).toMatchObject({ columnKey: 'year' });
    expect(
      run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', year: 2200 }] })
        .errors[0],
    ).toMatchObject({ columnKey: 'year' });
    expect(
      run({
        rows: [
          { skill: 'ClickUp', proficiency: 'expert', notes: 'x'.repeat(11) },
        ],
      }).errors[0],
    ).toMatchObject({ columnKey: 'notes' });
  });

  it('rejects an impossible month', () => {
    expect(
      run({
        rows: [
          { skill: 'ClickUp', proficiency: 'expert', from_month: '2024-13' },
        ],
      }).errors[0],
    ).toMatchObject({ columnKey: 'from_month' });
    expect(
      run({
        rows: [
          { skill: 'ClickUp', proficiency: 'expert', from_month: '2024-03' },
        ],
      }).errors,
    ).toEqual([]);
  });

  it('AC-FB-04 — sets a groupError outside minRows/maxRows', () => {
    expect(run({ rows: [] }).groupError).toMatch(/at least/i);
    const four = Array.from({ length: 4 }, () => ({
      skill: 'ClickUp',
      proficiency: 'expert',
    }));
    expect(run({ rows: four }).groupError).toMatch(/at most/i);
  });

  it('trims a text cell so a padded answer is stored as what it says', () => {
    const result = run({
      rows: [{ skill: 'ClickUp', proficiency: 'expert', notes: '  hi  ' }],
    });
    expect(result.rows[0]?.notes).toBe('hi');
  });
});

describe('hasNoAnsweredCells', () => {
  it('AC-FB-05 — an added-then-abandoned row set counts as unanswered', () => {
    expect(hasNoAnsweredCells([])).toBe(true);
    expect(hasNoAnsweredCells([{}, {}])).toBe(true);
    expect(hasNoAnsweredCells([{ notes: '' }, { notes: '   ' }])).toBe(true);
    expect(hasNoAnsweredCells([{ skill: 'ClickUp' }])).toBe(false);
    // A zero is an answer. Falsiness is not emptiness.
    expect(hasNoAnsweredCells([{ year: 0 }])).toBe(false);
  });
});

describe('readRepeatingGroupConfig', () => {
  it('returns the config from a validation bag that declares one', () => {
    const bag: Record<string, unknown> = {
      repeatingGroup: {
        columns: [
          { key: 'school', label: 'School', columnType: 'short_text' },
        ],
      },
    };
    expect(readRepeatingGroupConfig(bag)?.columns).toHaveLength(1);
  });

  it('returns null for a bag with no repeatingGroup, or a malformed one', () => {
    expect(readRepeatingGroupConfig({})).toBeNull();
    expect(readRepeatingGroupConfig({ repeatingGroup: { columns: [] } })).toBeNull();
  });
});

describe('snapshotRepeatingGroup', () => {
  const rows = [{ skill: 'ClickUp', proficiency: 'expert' }];

  it('AC-FB-07 — resolves a question_options column to inline, with ONLY the used options', () => {
    const snapshot = snapshotRepeatingGroup(config, questionOptions, rows);
    const skill = snapshot.columns.find((column) => column.key === 'skill');
    expect(skill?.choices).toEqual({
      from: 'inline',
      options: [{ value: 'ClickUp', label: 'ClickUp' }],
    });
  });

  it('AC-FB-07 — an option nobody picked is not carried', () => {
    const snapshot = snapshotRepeatingGroup(config, questionOptions, []);
    const skill = snapshot.columns.find((column) => column.key === 'skill');
    expect(skill?.choices).toEqual({ from: 'inline', options: [] });
  });

  it('leaves an inline column exactly as configured', () => {
    const snapshot = snapshotRepeatingGroup(config, questionOptions, rows);
    const proficiency = snapshot.columns.find(
      (column) => column.key === 'proficiency',
    );
    expect(proficiency?.choices).toEqual({
      from: 'inline',
      options: [
        { value: 'aware', label: 'Aware' },
        { value: 'expert', label: 'Expert' },
      ],
    });
  });

  it('copies non-choice columns verbatim, so a later rename cannot rewrite history', () => {
    const snapshot = snapshotRepeatingGroup(config, questionOptions, rows);
    expect(
      snapshot.columns.find((column) => column.key === 'notes')?.label,
    ).toBe('Notes');
    expect(snapshot.minRows).toBe(1);
    expect(snapshot.maxRows).toBe(3);
  });

  it('drops the option id — the snapshot stores value and label, nothing else', () => {
    const withIds = [
      { id: 'opt-1', value: 'ClickUp', label: 'ClickUp' },
      { id: 'opt-2', value: 'Notion', label: 'Notion' },
    ];
    const snapshot = snapshotRepeatingGroup(config, withIds, rows);
    const skill = snapshot.columns.find((column) => column.key === 'skill');
    expect(skill?.choices).toEqual({
      from: 'inline',
      options: [{ value: 'ClickUp', label: 'ClickUp' }],
    });
  });
});
