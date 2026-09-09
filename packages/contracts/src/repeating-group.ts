/**
 * The `repeating_group` question type — a question whose answer is a LIST OF
 * ROWS, each row having a few defined columns.
 * Design: docs/superpowers/specs/2026-09-09-repeating-group-question-type-design.md
 *
 * COLUMN TYPES ARE A SEPARATE, SMALLER ENUM FROM QuestionType. Reusing
 * QuestionType would drag currency_range, file_upload, scale and — fatally —
 * repeating_group itself into a column's domain. Nesting is therefore
 * impossible by construction, not by a rule someone has to remember.
 *
 * NOTHING HERE IS A ZodEffects. Cross-field rules live in
 * validateRepeatingGroupConfig() rather than a .superRefine(), because these
 * schemas end up inside QuestionSchema and IntakeFormQuestionSchema, which are
 * walked by @asteasolutions/zod-to-openapi. A ZodEffects in that path breaks
 * OpenAPI generation the same way a z.lazy does (04 §15, and the note on
 * JsonValueSchema in intake.ts).
 *
 * The option shape comes from ./options.js rather than ./intake.js: importing
 * intake here would close an import cycle back through validation-rules.js.
 * The reasoning is written out in full in options.ts.
 */
import { z } from 'zod';
import { IntakeFormOptionSchema } from './options.js';

/** Column machine keys: snake_case slugs, unique within one question. */
export const RepeatingGroupColumnKeySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, 'column key must be a snake_case slug');

export const RepeatingGroupColumnTypeSchema = z.enum([
  'short_text',
  'long_text',
  'number',
  /**
   * YYYY-MM, not a date. "March 2024" is what someone remembers about a job,
   * and a fabricated day-of-month is a lie the data would carry forever.
   */
  'month',
  'single_select',
]);
export type RepeatingGroupColumnType = z.infer<typeof RepeatingGroupColumnTypeSchema>;

/**
 * Where a choice column's options come from.
 *
 * 'question_options' means the question's OWN option list — which is what lets
 * an admin edit the skill catalogue through the options editor they already
 * use, with no new admin UI. 'inline' is for short fixed lists we define
 * (proficiency, language level).
 */
export const RepeatingGroupChoicesSchema = z.discriminatedUnion('from', [
  z.object({ from: z.literal('question_options') }),
  z.object({
    from: z.literal('inline'),
    options: z.array(IntakeFormOptionSchema).min(1),
  }),
]);
export type RepeatingGroupChoices = z.infer<typeof RepeatingGroupChoicesSchema>;

export const RepeatingGroupColumnSchema = z.object({
  key: RepeatingGroupColumnKeySchema,
  label: z.string().min(1).max(120),
  columnType: RepeatingGroupColumnTypeSchema,
  isRequired: z.boolean().default(false),
  helpText: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Relative width of this column in the row grid. */
  widthWeight: z.number().int().min(1).max(6).default(1),
  /** Required for single_select, forbidden otherwise — enforced by validateRepeatingGroupConfig. */
  choices: RepeatingGroupChoicesSchema.optional(),
});
export type RepeatingGroupColumn = z.infer<typeof RepeatingGroupColumnSchema>;

/** Eight columns is already unusable on a phone; the cap is a kindness. */
export const REPEATING_GROUP_MAX_COLUMNS = 8;
/** Hard ceiling on rows, independent of a question's own maxRows. */
export const REPEATING_GROUP_MAX_ROWS = 50;

export const RepeatingGroupConfigSchema = z.object({
  columns: z.array(RepeatingGroupColumnSchema).min(1).max(REPEATING_GROUP_MAX_COLUMNS),
  minRows: z.number().int().min(0).max(REPEATING_GROUP_MAX_ROWS).default(0),
  maxRows: z.number().int().min(1).max(REPEATING_GROUP_MAX_ROWS).default(20),
  addRowLabel: z.string().min(1).max(60).default('Add another'),
});
export type RepeatingGroupConfig = z.infer<typeof RepeatingGroupConfigSchema>;

/**
 * Cross-field rules, kept out of the schema so it stays OpenAPI-walkable.
 * Returns an error message, or null when the config is sound.
 */
export function validateRepeatingGroupConfig(
  config: RepeatingGroupConfig,
): string | null {
  const seen = new Set<string>();
  for (const column of config.columns) {
    if (seen.has(column.key)) {
      return `Duplicate column key '${column.key}'.`;
    }
    seen.add(column.key);

    const isSelect = column.columnType === 'single_select';
    if (isSelect && column.choices === undefined) {
      return `Column '${column.key}' is a single_select and must declare choices.`;
    }
    if (!isSelect && column.choices !== undefined) {
      return `Column '${column.key}' is not a single_select and must not declare choices.`;
    }
  }
  if (config.minRows > config.maxRows) {
    return 'minRows must not exceed maxRows.';
  }
  return null;
}

/**
 * One cell. Strings and numbers only — a nested object would make the stored
 * answer unrenderable by the flat table on the candidate profile, and there is
 * no use for one.
 */
export const RepeatingGroupCellSchema = z.union([z.string(), z.number()]);

/** An EMPTY cell is omitted from the row object, never sent as '' or null. */
export const RepeatingGroupRowSchema = z.record(RepeatingGroupCellSchema);
export type RepeatingGroupRow = z.infer<typeof RepeatingGroupRowSchema>;

/**
 * The stored `value_json`.
 *
 * An OBJECT with a `rows` key, never a bare array: a bare array is caught by
 * the existing Array.isArray branch in apps/web/src/lib/answer-value.ts and
 * rendered as "[object Object]" by every consumer we forget to teach. This
 * matches the { fileIds: [...] } precedent already used by file_upload.
 */
export const RepeatingGroupValueSchema = z.object({
  rows: z.array(RepeatingGroupRowSchema).max(REPEATING_GROUP_MAX_ROWS),
});
export type RepeatingGroupValue = z.infer<typeof RepeatingGroupValueSchema>;

/** One validation failure, located to a row and a column. */
export const RepeatingGroupFieldErrorSchema = z.object({
  rowIndex: z.number().int().min(0),
  columnKey: z.string(),
  message: z.string(),
});
export type RepeatingGroupFieldError = z.infer<typeof RepeatingGroupFieldErrorSchema>;

/**
 * What `question_snapshot.repeatingGroup` holds.
 *
 * Every choice column is resolved to `from: 'inline'` carrying ONLY the
 * options the stored rows actually use — a ~200-entry catalogue snapshotted on
 * every answer row costs ~15 KB per candidate and buys nothing, because an
 * option nobody picked can never need rendering.
 */
export const RepeatingGroupSnapshotSchema = z.object({
  columns: z.array(RepeatingGroupColumnSchema),
  minRows: z.number().int(),
  maxRows: z.number().int(),
});
export type RepeatingGroupSnapshot = z.infer<typeof RepeatingGroupSnapshotSchema>;
