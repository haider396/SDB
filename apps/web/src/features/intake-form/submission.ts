/**
 * Submission payload builder (05-FRONTEND.md §5 req 7, 03 §3.3).
 *
 * Only visible, answered questions are sent. Hidden questions are excluded
 * entirely — never submitted as null. Each answer carries exactly one value
 * field, keyed by question type. The type switch has a `never` guard
 * (AC-IF-18).
 */
import type {
  IntakeAnswer,
  IntakeFormQuestion,
  IntakeSubmission,
  JsonValue,
} from "@sdb/contracts";
import { RepeatingGroupValueSchema } from "@sdb/contracts";
import { isBlank, visibleQuestions, type IntakeValues } from "./conditional";

export interface CurrencyRangeValue {
  min: number;
  max: number;
  unit: string;
  currency: string;
}

function isCurrencyRangeValue(value: unknown): value is CurrencyRangeValue {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CurrencyRangeValue).min === "number" &&
    typeof (value as CurrencyRangeValue).max === "number" &&
    typeof (value as CurrencyRangeValue).unit === "string" &&
    typeof (value as CurrencyRangeValue).currency === "string"
  );
}

/** Map one answered question to its wire shape, or null when unanswerable. */
export function toAnswer(
  question: IntakeFormQuestion,
  value: unknown,
): IntakeAnswer | null {
  if (isBlank(value)) return null;
  const type = question.questionType;
  switch (type) {
    case "short_text":
    case "long_text":
    case "email":
    case "phone":
    case "single_select":
      return typeof value === "string"
        ? { questionKey: question.key, valueText: value }
        : null;
    case "number":
    case "scale":
      return typeof value === "number"
        ? { questionKey: question.key, valueNumber: value }
        : null;
    case "yes_no":
      return typeof value === "boolean"
        ? { questionKey: question.key, valueBoolean: value }
        : null;
    case "date":
      return typeof value === "string"
        ? { questionKey: question.key, valueDate: value }
        : null;
    case "multi_select":
      return Array.isArray(value)
        ? {
            questionKey: question.key,
            valueJson: value.filter(
              (item): item is string => typeof item === "string",
            ),
          }
        : null;
    case "currency_range":
      return isCurrencyRangeValue(value)
        ? {
            questionKey: question.key,
            valueJson: {
              min: value.min,
              max: value.max,
              unit: value.unit,
              currency: value.currency,
            } satisfies JsonValue,
          }
        : null;
    case "file_upload":
      // Upload arrives in P3; the P1 public form never submits file answers.
      return null;
    case "repeating_group": {
      const parsed = RepeatingGroupValueSchema.safeParse(value);
      // A malformed value is dropped rather than sent — the server would
      // reject it with VALUE_TYPE_MISMATCH and the candidate would see an
      // error about a shape they never typed.
      return parsed.success
        ? {
            questionKey: question.key,
            valueJson: { rows: parsed.data.rows } as JsonValue,
          }
        : null;
    }
    default: {
      const unhandled: never = type;
      throw new Error(`Unhandled question type: ${String(unhandled)}`);
    }
  }
}

/** Answers for the visible, answered subset of all fetched questions. */
export function buildAnswers(
  questions: readonly IntakeFormQuestion[],
  values: IntakeValues,
): IntakeAnswer[] {
  const answers: IntakeAnswer[] = [];
  for (const question of visibleQuestions(questions, values)) {
    const answer = toAnswer(question, values[question.key]);
    if (answer !== null) answers.push(answer);
  }
  return answers;
}

export function buildSubmission(
  formVersionHash: string,
  roleCategoryId: string,
  questions: readonly IntakeFormQuestion[],
  values: IntakeValues,
): IntakeSubmission {
  return {
    formVersionHash,
    roleCategoryId,
    answers: buildAnswers(questions, values),
  };
}
