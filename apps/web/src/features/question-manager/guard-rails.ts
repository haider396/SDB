/**
 * Client-side mirrors of the edit guard rails in 03-INTAKE-FORM-ENGINE.md
 * §1.5 and the per-type validation vocabulary (02-DATABASE.md §6). The API
 * remains the enforcer; these exist so the UI communicates the rules up
 * front instead of round-tripping to find out.
 */
import type {
  ConditionalOperator,
  QuestionConditional,
  QuestionType,
  ValidationRules,
} from "@sdb/contracts";
import { isMappedQuestionKey } from "@sdb/contracts";

export { isMappedQuestionKey };

/**
 * Bounded (non-recursive) conditional value the builder can produce. The
 * contracts type allows any JsonValue, but react-hook-form's path inference
 * cannot traverse a recursive type (TS2589), and the builder only ever emits
 * these shapes anyway. ConditionalDraft is assignable to QuestionConditional.
 */
export type ConditionalValue = string | number | boolean | string[] | null;

export interface ConditionalDraft {
  questionKey: string;
  operator: ConditionalOperator;
  value: ConditionalValue;
}

/** Narrow a stored conditional (JsonValue) to the builder's bounded shape. */
export function toConditionalDraft(
  conditional: QuestionConditional | null,
): ConditionalDraft | null {
  if (conditional === null) return null;
  const { value } = conditional;
  const bounded: ConditionalValue = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ? value
      : null;
  return {
    questionKey: conditional.questionKey,
    operator: conditional.operator,
    value: bounded,
  };
}

export type ValidationRuleKey = keyof ValidationRules;

/**
 * Which validation keys apply to each question type. The editor renders ONLY
 * these, so an unknown key (422 INVALID_VALIDATION_RULE) is impossible to
 * produce by construction.
 */
export const VALIDATION_KEYS_BY_TYPE: Record<
  QuestionType,
  readonly ValidationRuleKey[]
> = {
  short_text: ["minLength", "maxLength", "pattern"],
  long_text: ["minLength", "maxLength"],
  email: ["maxLength"],
  phone: ["maxLength"],
  number: ["min", "max"],
  currency_range: ["currency", "allowedUnits", "min", "max"],
  single_select: [],
  multi_select: ["minSelections", "maxSelections"],
  yes_no: [],
  date: [],
  scale: ["scaleMin", "scaleMax", "scaleMinLabel", "scaleMaxLabel"],
  file_upload: ["acceptedMimeTypes", "maxFileSizeMb"],
};

/** Types that carry an options list. */
export function hasOptions(questionType: QuestionType): boolean {
  return questionType === "single_select" || questionType === "multi_select";
}

/** Drop rules that do not apply to the (possibly changed) type. */
export function pruneValidation(
  questionType: QuestionType,
  validation: ValidationRules,
): ValidationRules {
  const allowed = new Set<string>(VALIDATION_KEYS_BY_TYPE[questionType]);
  const pruned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(validation)) {
    if (allowed.has(key) && value !== undefined) pruned[key] = value;
  }
  return pruned as ValidationRules;
}

/** Operators that make sense against a given controller question type. */
export function operatorsForControllerType(
  questionType: QuestionType,
): readonly ConditionalOperator[] {
  switch (questionType) {
    case "yes_no":
      return ["is_true", "is_false"];
    case "single_select":
      return ["equals", "not_equals", "in"];
    case "multi_select":
      return ["in"];
    default:
      return ["equals", "not_equals"];
  }
}

export const OPERATOR_LABELS: Record<ConditionalOperator, string> = {
  equals: "equals",
  not_equals: "does not equal",
  in: "is one of",
  is_true: "is yes",
  is_false: "is no",
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email",
  phone: "Phone",
  number: "Number",
  currency_range: "Currency range",
  single_select: "Single select",
  multi_select: "Multi select",
  yes_no: "Yes / no",
  date: "Date",
  scale: "Scale",
  file_upload: "File upload",
};

/**
 * Auto-slug of the label for the key preview at creation (03 §2.2): lower
 * snake_case, letters/digits/underscores only, must start with a letter —
 * matching QuestionKeySchema.
 */
export function slugifyKey(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 100);
  return slug;
}
