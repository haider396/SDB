/**
 * Dynamic Zod schema builder (05-FRONTEND.md §5 req 2).
 *
 * Builds the client-side validation schema from the fetched question
 * definitions so validation mirrors the server without duplicating rules:
 * every constraint comes from `question.validation` / `question.options` /
 * `question.isRequired` — nothing is hard-coded per question.
 *
 * The `question_type` switch carries a `never` exhaustiveness guard
 * (AC-IF-18): adding a QuestionType to the enum without handling it here is
 * a compile error.
 */
import { z } from "zod";
import type {
  IntakeFormQuestion,
  RateUnit,
  RepeatingGroupColumn,
  RepeatingGroupFieldError,
  ValidationRules,
} from "@sdb/contracts";
import { RateUnitSchema } from "@sdb/contracts";
import { isBlank, type IntakeValues } from "./conditional";
import { columnOptions, repeatingGroupConfig } from "./repeating-group";

export const REQUIRED_MESSAGE = "This field is required.";

/** Scale bounds when the rule bag omits them (05 §5: "discrete 1–n"). */
export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 5;
export const DEFAULT_CURRENCY = "USD";
const ALL_RATE_UNITS: readonly RateUnit[] = RateUnitSchema.options;

/** Blank inputs ('' / [] / NaN / null) become undefined before validation. */
function blankToUndefined(value: unknown): unknown {
  return isBlank(value) ? undefined : value;
}

function stringSchema(
  question: IntakeFormQuestion,
  rules: ValidationRules,
): z.ZodTypeAny {
  let schema = z.string({
    required_error: REQUIRED_MESSAGE,
    invalid_type_error: "Enter text.",
  });
  if (question.questionType === "email") {
    schema = schema.email("Enter a valid email address.");
  }
  if (rules.minLength !== undefined) {
    schema = schema.min(
      rules.minLength,
      `Must be at least ${rules.minLength} characters.`,
    );
  }
  if (rules.maxLength !== undefined) {
    schema = schema.max(
      rules.maxLength,
      `Must be at most ${rules.maxLength} characters.`,
    );
  }
  if (rules.pattern !== undefined) {
    schema = schema.regex(
      new RegExp(rules.pattern),
      "Does not match the expected format.",
    );
  }
  return schema;
}

function numberSchema(rules: ValidationRules): z.ZodTypeAny {
  let schema = z.number({
    required_error: REQUIRED_MESSAGE,
    invalid_type_error: "Enter a number.",
  });
  if (rules.min !== undefined) {
    schema = schema.min(rules.min, `Must be at least ${rules.min}.`);
  }
  if (rules.max !== undefined) {
    schema = schema.max(rules.max, `Must be at most ${rules.max}.`);
  }
  return schema;
}

/** Allowed units for a currency_range question. */
export function allowedUnitsFor(rules: ValidationRules): readonly RateUnit[] {
  return rules.allowedUnits !== undefined && rules.allowedUnits.length > 0
    ? rules.allowedUnits
    : ALL_RATE_UNITS;
}

function currencyRangeSchema(rules: ValidationRules): z.ZodTypeAny {
  const units = allowedUnitsFor(rules);
  const [firstUnit, ...restUnits] = units;
  if (firstUnit === undefined) {
    throw new Error("currency_range requires at least one allowed unit");
  }

  const amount = (label: string) => {
    let schema = z.number({
      required_error: `Enter a ${label} amount.`,
      invalid_type_error: "Enter a number.",
    });
    if (rules.min !== undefined) {
      schema = schema.min(rules.min, `Must be at least ${rules.min}.`);
    }
    if (rules.max !== undefined) {
      schema = schema.max(rules.max, `Must be at most ${rules.max}.`);
    }
    return schema;
  };

  return z
    .object(
      {
        min: z.preprocess(blankToUndefined, amount("minimum")),
        max: z.preprocess(blankToUndefined, amount("maximum")),
        unit: z.enum([firstUnit, ...restUnits], {
          required_error: "Select hourly or monthly.",
          invalid_type_error: "Select hourly or monthly.",
        }),
        currency: z
          .string()
          .length(3)
          .default(rules.currency ?? DEFAULT_CURRENCY),
      },
      {
        required_error: REQUIRED_MESSAGE,
        invalid_type_error: "Enter a budget range.",
      },
    )
    .superRefine((range, ctx) => {
      if (range.min > range.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max"],
          message: "Maximum must be greater than or equal to minimum.",
        });
      }
    });
}

function optionValuesSchema(question: IntakeFormQuestion): z.ZodTypeAny {
  const values = question.options.map((option) => option.value);
  const [first, ...rest] = values;
  if (first === undefined) {
    // Misconfigured question with no options — accept any string; the server
    // remains the authority (INVALID_OPTION).
    return z.string({ required_error: REQUIRED_MESSAGE });
  }
  return z.enum([first, ...rest], {
    required_error: REQUIRED_MESSAGE,
    invalid_type_error: "Choose one of the provided options.",
  });
}

function multiSelectSchema(
  question: IntakeFormQuestion,
  rules: ValidationRules,
): z.ZodTypeAny {
  let schema = z.array(optionValuesSchema(question), {
    required_error: REQUIRED_MESSAGE,
    invalid_type_error: "Choose from the provided options.",
  });
  if (rules.minSelections !== undefined) {
    schema = schema.min(
      rules.minSelections,
      `Select at least ${rules.minSelections}.`,
    );
  }
  if (rules.maxSelections !== undefined) {
    schema = schema.max(
      rules.maxSelections,
      `Select at most ${rules.maxSelections}.`,
    );
  }
  return schema;
}

function dateSchema(): z.ZodTypeAny {
  return z
    .string({ required_error: REQUIRED_MESSAGE })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.");
}

function scaleSchema(rules: ValidationRules): z.ZodTypeAny {
  const min = rules.scaleMin ?? DEFAULT_SCALE_MIN;
  const max = rules.scaleMax ?? DEFAULT_SCALE_MAX;
  return z
    .number({
      required_error: REQUIRED_MESSAGE,
      invalid_type_error: "Choose a value on the scale.",
    })
    .int()
    .min(min, `Choose a value between ${min} and ${max}.`)
    .max(max, `Choose a value between ${min} and ${max}.`);
}

function cellSchema(
  question: IntakeFormQuestion,
  column: RepeatingGroupColumn,
): z.ZodTypeAny {
  switch (column.columnType) {
    case "number": {
      let schema = z.number({ invalid_type_error: "Enter a number." });
      if (column.min !== undefined) {
        schema = schema.min(column.min, `Must be at least ${String(column.min)}.`);
      }
      if (column.max !== undefined) {
        schema = schema.max(column.max, `Must be at most ${String(column.max)}.`);
      }
      return schema;
    }
    case "month":
      // \d, not a literal 'd'. The escape was lost transcribing this from the
      // design, and the typo silently rejects EVERY month a candidate can
      // type — the control is <input type="month">, so nothing else can
      // reach here to expose it.
      return z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Enter a month, for example 2024-03.");
    case "single_select": {
      const values = columnOptions(question, column).map((option) => option.value);
      const [first, ...rest] = values;
      // A misconfigured column with no choices accepts any string; the server
      // remains the authority (INVALID_OPTION).
      if (first === undefined) return z.string();
      return z.enum([first, ...rest], {
        invalid_type_error: "Choose one of the provided options.",
      });
    }
    case "short_text":
    case "long_text": {
      let schema = z.string();
      if (column.maxLength !== undefined) {
        schema = schema.max(
          column.maxLength,
          `Must be at most ${String(column.maxLength)} characters.`,
        );
      }
      return schema;
    }
    default: {
      const unhandled: never = column.columnType;
      throw new Error(`Unhandled repeating-group column type: ${String(unhandled)}`);
    }
  }
}

/**
 * Schema for a repeating-group answer, built column by column so Zod issue
 * paths come out as ["rows", 2, "skill"] — which is what lets an error find
 * its exact cell instead of collapsing to one message for the whole table.
 *
 * A REQUIRED cell is `.optional()` followed by a refine, not a bare required
 * schema. z.preprocess turns "" into undefined, and an undefined value against
 * a non-optional schema produces Zod's own "Required" wording rather than
 * REQUIRED_MESSAGE — which is the copy every other field in this form uses.
 *
 * `.strict()` is deliberately NOT used on the row object. An unknown column
 * key — a column retired between page load and submit — is stripped by
 * z.object's default behaviour rather than raising, which mirrors the server's
 * step 3 and means a mid-session config change cannot block a submission.
 */
export function repeatingGroupSchema(question: IntakeFormQuestion): z.ZodTypeAny {
  const config = repeatingGroupConfig(question);
  // Not a repeating group, or a misconfigured one. The API rejects the latter
  // on write (AC-FB-01); the renderer must not crash on it in the meantime.
  if (config === null) return z.unknown();

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const column of config.columns) {
    const cell = cellSchema(question, column).optional();
    shape[column.key] = z.preprocess(
      blankToUndefined,
      column.isRequired
        ? cell.refine((value) => value !== undefined, REQUIRED_MESSAGE)
        : cell,
    );
  }

  return z.object({
    rows: z
      .array(z.object(shape))
      .min(
        config.minRows,
        config.minRows === 1
          ? "Add at least one row."
          : `Add at least ${String(config.minRows)} rows.`,
      )
      .max(config.maxRows, `Add at most ${String(config.maxRows)} rows.`),
  });
}

/**
 * Schema for a single question's value, before required/optional wrapping.
 * Exhaustive over QuestionType — the `never` default is the AC-IF-18 guard.
 */
function baseSchemaFor(question: IntakeFormQuestion): z.ZodTypeAny {
  const rules = question.validation;
  const type = question.questionType;
  switch (type) {
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
      return stringSchema(question, rules);
    case "number":
      return numberSchema(rules);
    case "currency_range":
      return currencyRangeSchema(rules);
    case "single_select":
      return optionValuesSchema(question);
    case "multi_select":
      return multiSelectSchema(question, rules);
    case "yes_no":
      return z.boolean({
        required_error: REQUIRED_MESSAGE,
        invalid_type_error: "Choose yes or no.",
      });
    case "date":
      return dateSchema();
    case "scale":
      return scaleSchema(rules);
    case "file_upload":
      // Upload arrives in P3 — the P1 renderer shows a disabled drop zone
      // and never carries a value, required or not.
      return z.unknown();
    case "repeating_group":
      return repeatingGroupSchema(question);
    default: {
      const unhandled: never = type;
      throw new Error(`Unhandled question type: ${String(unhandled)}`);
    }
  }
}

/** Full schema for one question, honouring isRequired and blank inputs. */
export function buildQuestionSchema(question: IntakeFormQuestion): z.ZodTypeAny {
  const base = baseSchemaFor(question);
  if (question.questionType === "file_upload") {
    return z.unknown().optional();
  }
  if (question.questionType === "repeating_group") {
    /*
     * An unanswered repeating group is { rows: [] }, which the schema accepts
     * when minRows is 0 — so requiredness is enforced by minRows and by the
     * explicit check below, NOT by the generic optional() wrapper. Wrapping it
     * would run blankToUndefined first, and isBlank now calls { rows: [] }
     * blank, so an optional table would be handed `undefined` and a required
     * one would fail with the wrong message before minRows was ever consulted.
     *
     * The undefined arm is not theoretical: react-hook-form starts every
     * field undefined, so a candidate who never touches the table submits the
     * step with no value at all.
     */
    const table = z.preprocess(
      (value) => (value === undefined ? { rows: [] } : value),
      base,
    );
    return question.isRequired
      ? table.refine((value) => !isBlank(value), REQUIRED_MESSAGE)
      : table;
  }
  return z.preprocess(
    blankToUndefined,
    question.isRequired ? base : base.optional(),
  );
}

/**
 * Schema over a set of (visible) questions, keyed by questionKey. Keys not in
 * the set are stripped, so hidden/unknown values never reach validation.
 */
export function buildIntakeSchema(
  questions: readonly IntakeFormQuestion[],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const question of questions) {
    shape[question.key] = buildQuestionSchema(question);
  }
  return z.object(shape);
}

export interface IntakeValidationResult {
  /** Parsed values for visible questions only. Null when invalid. */
  values: IntakeValues | null;
  /** First message per questionKey. */
  errors: Record<string, string>;
  /**
   * Cell-precise failures for repeating groups, per questionKey.
   *
   * Additive: `errors` still holds exactly one message per key, so no existing
   * caller changes. Repeating-group cells are the only failures that cannot be
   * expressed as one message on one control (spec §7.4).
   */
  rowErrors: Record<string, RepeatingGroupFieldError[]>;
}

/**
 * The Zod issue path for one cell of a repeating group, or null.
 *
 * Paths come out as [questionKey, "rows", 2, "skill"] because
 * repeatingGroupSchema is built column by column rather than as one blob —
 * which is the whole reason an error can find its exact input.
 */
function cellFrom(
  path: readonly (string | number)[],
): { rowIndex: number; columnKey: string } | null {
  const [, marker, rowIndex, columnKey] = path;
  if (marker !== "rows") return null;
  if (typeof rowIndex !== "number" || typeof columnKey !== "string") return null;
  return { rowIndex, columnKey };
}

/**
 * Validate current values against the visible subset of `questions`.
 * Hidden questions are excluded from validation entirely (05 §5 req 4).
 */
export function validateIntakeValues(
  questions: readonly IntakeFormQuestion[],
  values: IntakeValues,
): IntakeValidationResult {
  const schema = buildIntakeSchema(questions);
  const result = schema.safeParse(values);
  if (result.success) {
    return { values: result.data, errors: {}, rowErrors: {} };
  }
  const errors: Record<string, string> = {};
  const rowErrors: Record<string, RepeatingGroupFieldError[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string") continue;
    const cell = cellFrom(issue.path);
    if (cell !== null) {
      const bucket = rowErrors[key] ?? [];
      bucket.push({ ...cell, message: issue.message });
      rowErrors[key] = bucket;
      continue;
    }
    if (errors[key] !== undefined) continue;
    errors[key] = issue.message;
  }
  /*
   * A repeating group whose only failures are per-cell still needs a message
   * on the fieldset itself — the cells may be off-screen, and the summary
   * links need something to say. The wording mirrors what the server sends
   * for the same failure (spec §7.3), so the two surfaces cannot disagree.
   */
  for (const [key, cells] of Object.entries(rowErrors)) {
    if (errors[key] !== undefined) continue;
    const affected = new Set(cells.map((cell) => cell.rowIndex)).size;
    errors[key] =
      affected === 1
        ? "1 row has problems."
        : `${String(affected)} rows have problems.`;
  }
  return { values: null, errors, rowErrors };
}
