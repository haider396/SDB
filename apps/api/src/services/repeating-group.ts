/**
 * Repeating-group row validation, normalisation and snapshot resolution.
 * Design: docs/superpowers/specs/2026-09-09-repeating-group-question-type-design.md
 * §5.2 and §7.
 *
 * PURE ON PURPOSE. No SQL, no I/O, no Fastify: the question's options arrive as
 * an argument because `validateSubmission`'s scope record already loads them
 * active-only. That is what lets the whole row engine be unit-tested with plain
 * Vitest, which matters because the integration suite needs Docker and the
 * machine this was built on does not have it.
 *
 * NOTHING SHORT-CIRCUITS. A candidate with four bad rows must be told about all
 * four, each located to its row and its column (AC-FB-03). Stopping at the
 * first failure turns a five-row table into a five-round-trip form.
 */
import {
  RepeatingGroupConfigSchema,
  RepeatingGroupValueSchema,
  type IntakeFormOption,
  type RepeatingGroupColumn,
  type RepeatingGroupConfig,
  type RepeatingGroupFieldError,
  type RepeatingGroupRow,
  type RepeatingGroupSnapshot,
} from '@sdb/contracts';

/** The wording every other required field in this form uses. */
export const REQUIRED_CELL_MESSAGE = 'This field is required.';

/** Mirrors the single_select message in the pipeline's step 5. */
export const INVALID_OPTION_CELL_MESSAGE =
  'Not an active option of this question.';

/** YYYY-MM. Deliberately not a date — see RepeatingGroupColumnTypeSchema. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface NormalisedRepeatingGroup {
  /**
   * The rows as they should be STORED: unknown column keys stripped, empty
   * cells omitted, wholly empty rows dropped, cells coerced to their column's
   * type. Best-effort — populated even when there are errors.
   */
  rows: RepeatingGroupRow[];
  /** Every cell failure, row-major. The union of the two partitions below. */
  errors: RepeatingGroupFieldError[];
  /**
   * The failures the pipeline's step 4 reports as `VALIDATION_FAILED`:
   * required, type, length and range. Disjoint from `optionErrors`.
   */
  ruleErrors: RepeatingGroupFieldError[];
  /**
   * The failures step 5 reports as `INVALID_OPTION` (AC-FB-06). Split out
   * rather than merged because the two steps carry different error codes, and a
   * repeating group must not be the one question type whose rejected option
   * comes back under a different code from every other question's.
   */
  optionErrors: RepeatingGroupFieldError[];
  /**
   * A whole-answer failure — the wrong JSON shape, or a row count outside
   * minRows/maxRows. It has no row or column to point at.
   */
  groupError: string | null;
}

/**
 * The column definitions carried by a question's `validation` bag, or null when
 * the question does not declare a well-formed one.
 *
 * A `repeating_group` question with no columns is rejected on create and update
 * (AC-FB-01), so null here means a row written before that guard existed, or
 * one hand-edited in SQL. Callers treat it as a misconfiguration rather than
 * pretending the answer validated.
 */
export function readRepeatingGroupConfig(
  validation: Record<string, unknown>,
): RepeatingGroupConfig | null {
  const parsed = RepeatingGroupConfigSchema.safeParse(
    validation['repeatingGroup'],
  );
  return parsed.success ? parsed.data : null;
}

function isEmptyCell(cell: unknown): boolean {
  if (cell === undefined || cell === null) return true;
  if (typeof cell === 'string') return cell.trim().length === 0;
  return false;
}

/**
 * True when a repeating-group value holds no answered cell at all — no rows, or
 * only rows a candidate added and then abandoned.
 *
 * Lives here so the required-answer check and the normaliser cannot drift on
 * what "empty" means. AC-FB-05: a submission of only empty rows counts as
 * unanswered, and therefore fails only when the question is required.
 */
export function hasNoAnsweredCells(rows: readonly unknown[]): boolean {
  return rows.every((row) => {
    if (typeof row !== 'object' || row === null) return true;
    return Object.values(row as Record<string, unknown>).every(isEmptyCell);
  });
}

type CellOutcome =
  | { ok: true; value: string | number }
  | { ok: false; message: string; isOption: boolean };

function optionsFor(
  column: RepeatingGroupColumn,
  questionOptions: readonly IntakeFormOption[],
): readonly IntakeFormOption[] {
  if (column.choices === undefined) return [];
  return column.choices.from === 'question_options'
    ? questionOptions
    : column.choices.options;
}

function checkCell(
  column: RepeatingGroupColumn,
  questionOptions: readonly IntakeFormOption[],
  cell: string | number,
): CellOutcome {
  switch (column.columnType) {
    case 'number': {
      const numeric = typeof cell === 'number' ? cell : Number(cell);
      if (!Number.isFinite(numeric)) {
        return { ok: false, message: 'Enter a number.', isOption: false };
      }
      if (column.min !== undefined && numeric < column.min) {
        return {
          ok: false,
          message: `Must be at least ${String(column.min)}.`,
          isOption: false,
        };
      }
      if (column.max !== undefined && numeric > column.max) {
        return {
          ok: false,
          message: `Must be at most ${String(column.max)}.`,
          isOption: false,
        };
      }
      return { ok: true, value: numeric };
    }
    case 'month': {
      const text = String(cell);
      if (!MONTH_PATTERN.test(text)) {
        return {
          ok: false,
          message: 'Enter a month in the format YYYY-MM, for example 2024-03.',
          isOption: false,
        };
      }
      return { ok: true, value: text };
    }
    case 'single_select': {
      const text = String(cell);
      /*
       * A select column with no choices at all is a misconfiguration AC-FB-01
       * rejects on write. If one ever reaches here every value is wrong, which
       * is the honest answer — and the reason the web schema deliberately
       * accepts any string in that case and leaves the server as the authority.
       */
      const options = optionsFor(column, questionOptions);
      if (!options.some((option) => option.value === text)) {
        return {
          ok: false,
          message: INVALID_OPTION_CELL_MESSAGE,
          isOption: true,
        };
      }
      return { ok: true, value: text };
    }
    case 'short_text':
    case 'long_text': {
      // A number in a text column is coerced, not rejected: "2024" is a
      // perfectly good text answer, and a bare JSON number is how some clients
      // send one. Nothing is lost, and a hard failure here helps nobody.
      const text = typeof cell === 'string' ? cell : String(cell);
      if (column.maxLength !== undefined && text.length > column.maxLength) {
        return {
          ok: false,
          message: `Must be at most ${String(column.maxLength)} characters.`,
          isOption: false,
        };
      }
      return { ok: true, value: text };
    }
    default: {
      // A new column type must be given a rule here, not silently accepted.
      const unhandled: never = column.columnType;
      throw new Error(
        `Unhandled repeating-group column type: ${String(unhandled)}`,
      );
    }
  }
}

/**
 * The order of operations is spec §7.1, and it matters:
 *
 * 1. shape · 2. strip unknown keys and empty cells · 3. drop rows left with no
 * keys · 4. row count · 5. every cell, collecting every failure.
 *
 * Steps 2 and 3 run as one pass, and BEFORE anything that can produce an error:
 * an added-then-abandoned row is not a mistake, and a column retired between
 * page load and submit must not fail a submission that was correct when it was
 * filled in. Normalising first is also what makes "wholly empty row" the
 * one-line check "no keys left" rather than a per-type emptiness test.
 */
export function normaliseRepeatingGroup(
  config: RepeatingGroupConfig,
  questionOptions: readonly IntakeFormOption[],
  value: unknown,
): NormalisedRepeatingGroup {
  const parsed = RepeatingGroupValueSchema.safeParse(value);
  if (!parsed.success) {
    // The submission pipeline runs jsonShapeOk first, so this is only reachable
    // from a caller that did not — answer with a group error rather than
    // throwing out of a pure function.
    return {
      rows: [],
      errors: [],
      ruleErrors: [],
      optionErrors: [],
      groupError: 'Expected an object with a rows array.',
    };
  }

  const rows: RepeatingGroupRow[] = [];
  for (const rawRow of parsed.data.rows) {
    const row: RepeatingGroupRow = {};
    for (const column of config.columns) {
      const cell = rawRow[column.key];
      if (cell === undefined) continue;
      if (typeof cell === 'string') {
        const trimmed = cell.trim();
        if (trimmed.length === 0) continue;
        row[column.key] = trimmed;
      } else {
        row[column.key] = cell;
      }
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }

  let groupError: string | null = null;
  if (rows.length < config.minRows) {
    groupError =
      config.minRows === 1
        ? 'Add at least 1 row.'
        : `Add at least ${String(config.minRows)} rows.`;
  } else if (rows.length > config.maxRows) {
    groupError = `Add at most ${String(config.maxRows)} rows.`;
  }

  // Collected with a flag rather than pushed straight into two arrays, so all
  // three views below come out in the row-major order a person reads the table.
  const collected: { error: RepeatingGroupFieldError; isOption: boolean }[] = [];
  rows.forEach((row, rowIndex) => {
    for (const column of config.columns) {
      const cell = row[column.key];
      if (cell === undefined) {
        if (column.isRequired) {
          collected.push({
            error: {
              rowIndex,
              columnKey: column.key,
              message: REQUIRED_CELL_MESSAGE,
            },
            isOption: false,
          });
        }
        continue;
      }
      const outcome = checkCell(column, questionOptions, cell);
      if (outcome.ok) {
        // Coercion is written back so the STORED value matches the column's
        // declared type: a year typed into a number column is stored as 1999,
        // never as "1999".
        row[column.key] = outcome.value;
        continue;
      }
      collected.push({
        error: { rowIndex, columnKey: column.key, message: outcome.message },
        isOption: outcome.isOption,
      });
    }
  });

  return {
    rows,
    errors: collected.map((entry) => entry.error),
    ruleErrors: collected
      .filter((entry) => !entry.isOption)
      .map((entry) => entry.error),
    optionErrors: collected
      .filter((entry) => entry.isOption)
      .map((entry) => entry.error),
    groupError,
  };
}

/**
 * What `question_snapshot.repeatingGroup` holds (spec §7.2, AC-FB-07).
 *
 * Columns are copied VERBATIM, so a later rename or removal cannot change what
 * a candidate is recorded as having been asked (AC-IF-12).
 *
 * The one exception is a `from: 'question_options'` column, which is resolved
 * to `inline` carrying ONLY the options whose values appear in these rows. A
 * ~200-entry skill catalogue snapshotted on every answer row is ~15 KB per
 * candidate and buys nothing: an option nobody picked can never need rendering.
 * That is a considered reading of AC-IF-11's "options as at submission time" as
 * *the options needed to render this answer, as at submission time* — which is
 * why AC-FB-07 states it rather than leaving it to be rediscovered.
 *
 * Correspondingly `buildSnapshot` omits the top-level `options` catalogue for
 * this question type, so the same list is not stored twice.
 */
export function snapshotRepeatingGroup(
  config: RepeatingGroupConfig,
  questionOptions: readonly IntakeFormOption[],
  rows: readonly RepeatingGroupRow[],
): RepeatingGroupSnapshot {
  return {
    columns: config.columns.map((column) => {
      if (column.choices?.from !== 'question_options') return column;
      const used = new Set<string>();
      for (const row of rows) {
        const cell = row[column.key];
        if (cell !== undefined) used.add(String(cell));
      }
      return {
        ...column,
        choices: {
          from: 'inline',
          // Validation has already proved every used value is an active option,
          // so filtering the catalogue cannot drop a label a row needs.
          options: questionOptions
            .filter((option) => used.has(option.value))
            .map((option) => ({ value: option.value, label: option.label })),
        },
      };
    }),
    minRows: config.minRows,
    maxRows: config.maxRows,
  };
}
