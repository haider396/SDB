/**
 * Pure helpers shared by the repeating-group control, its Zod schema, its
 * height calculation and the error plumbing. Kept out of the component so all
 * four can be tested without a render — jsdom is not where arithmetic or
 * option resolution should be verified.
 */
import type {
  IntakeFormOption,
  IntakeFormQuestion,
  RepeatingGroupColumn,
  RepeatingGroupConfig,
  RepeatingGroupFieldError,
  RepeatingGroupRow,
} from "@sdb/contracts";
import { RepeatingGroupValueSchema } from "@sdb/contracts";
import type { SummaryEntry } from "./components/error-summary";

const NO_OPTIONS: readonly IntakeFormOption[] = [];

/** The column definitions for a question, or null when it is not a repeating group. */
export function repeatingGroupConfig(
  question: IntakeFormQuestion,
): RepeatingGroupConfig | null {
  return question.validation.repeatingGroup ?? null;
}

/**
 * The choices for one column.
 *
 * `question_options` reads the question's OWN option list — the same list the
 * existing options editor writes, which is what lets an admin edit the skill
 * catalogue with no new UI. It arrives with the form payload, so there is no
 * fetch and no loading state.
 */
export function columnOptions(
  question: IntakeFormQuestion,
  column: RepeatingGroupColumn,
): readonly IntakeFormOption[] {
  if (column.choices === undefined) return NO_OPTIONS;
  return column.choices.from === "question_options"
    ? question.options
    : column.choices.options;
}

/**
 * The rows currently held in a field value, or [] for anything else.
 *
 * Tolerant on purpose: this runs on every keystroke against react-hook-form
 * state that starts as undefined, and a control that throws on its own initial
 * value is a control that never renders.
 */
export function readRows(value: unknown): RepeatingGroupRow[] {
  const parsed = RepeatingGroupValueSchema.safeParse(value);
  return parsed.success ? parsed.data.rows : [];
}

/** True when a row carries no answered cell at all. */
export function isEmptyRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (cell) => cell === undefined || cell === null || cell === "",
  );
}

/**
 * Flatten react-hook-form's nested error object for a repeating group into the
 * flat shape the control and the error summary both consume.
 *
 * RHF nests by the Zod issue path, so `rows[2].skill` arrives as
 * `{ rows: { 2: { skill: { message } } } }`. `unknown` and the narrowing below
 * rather than RHF's FieldErrors generics: the form's value type is
 * Record<string, unknown>, so RHF cannot type these paths anyway.
 */
export function toRowErrors(error: unknown): RepeatingGroupFieldError[] {
  if (typeof error !== "object" || error === null) return [];
  const rows = (error as { rows?: unknown }).rows;
  if (typeof rows !== "object" || rows === null) return [];

  const result: RepeatingGroupFieldError[] = [];
  for (const [indexKey, rowError] of Object.entries(rows)) {
    const rowIndex = Number(indexKey);
    if (!Number.isInteger(rowIndex)) continue;
    if (typeof rowError !== "object" || rowError === null) continue;
    for (const [columnKey, cellError] of Object.entries(rowError)) {
      const message = (cellError as { message?: unknown } | null)?.message;
      if (typeof message === "string") {
        result.push({ rowIndex, columnKey, message });
      }
    }
  }
  return result;
}

/**
 * The top-of-form summary lines for one question: one per failing cell, or a
 * single line for the question as a whole.
 *
 * Shared by all three hosts (/register, /f/:slug and the client intake form)
 * so the same failure reads the same way on each. Building it inline in each
 * of them is how three wordings of one message get into a codebase.
 */
export function summaryEntriesFor(
  question: IntakeFormQuestion,
  message: string,
  rowErrors: readonly RepeatingGroupFieldError[] | undefined,
): SummaryEntry[] {
  if (rowErrors === undefined || rowErrors.length === 0) {
    return [{ questionKey: question.key, label: question.label, message }];
  }
  const labels = new Map(
    (repeatingGroupConfig(question)?.columns ?? []).map((column) => [
      column.key,
      column.label,
    ]),
  );
  return rowErrors.map((cell) => ({
    questionKey: question.key,
    label: question.label,
    message: cell.message,
    rowIndex: cell.rowIndex,
    columnKey: cell.columnKey,
    // The key is a machine slug ('spoken_level') and this line is read aloud,
    // so it is only ever the fallback for a column the config has retired.
    columnLabel: labels.get(cell.columnKey) ?? cell.columnKey,
  }));
}

/**
 * The cell errors a control should show right now, given react-hook-form's
 * error for the field and whatever the last submission's server response said.
 *
 * The client's own validation wins whenever it has anything to say: it
 * reflects what is on screen this render, whereas the server map is a snapshot
 * of the last POST and goes stale the moment a cell is edited.
 */
export function activeRowErrors(
  fieldError: unknown,
  serverRowErrors: readonly RepeatingGroupFieldError[] | undefined,
): readonly RepeatingGroupFieldError[] | undefined {
  const client = toRowErrors(fieldError);
  return client.length > 0 ? client : serverRowErrors;
}
