/**
 * Conditional visibility evaluation (05-FRONTEND.md §5 req 4).
 *
 * A question with a `conditional` is visible only when the controlling
 * question is itself visible AND the operator is satisfied by the current
 * value. An unanswered controlling question satisfies no operator — this
 * mirrors the server rule that conditions are evaluated "by the other
 * submitted answers" (03-INTAKE-FORM-ENGINE.md §3.3 rule 6): an answer that
 * was never submitted cannot satisfy a condition.
 */
import type {
  ConditionalOperator,
  IntakeFormQuestion,
  JsonValue,
} from "@sdb/contracts";

/** All in-progress form values, keyed by questionKey. */
export type IntakeValues = Record<string, unknown>;

/** Empty per the server's notion of "non-empty" answers: no value at all. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  if (typeof value === "number") return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

export function evaluateConditional(
  operator: ConditionalOperator,
  conditionValue: JsonValue | null,
  answer: unknown,
): boolean {
  if (isBlank(answer)) return false;
  switch (operator) {
    case "equals":
      return deepEqual(answer, conditionValue);
    case "not_equals":
      return !deepEqual(answer, conditionValue);
    case "in":
      return (
        Array.isArray(conditionValue) &&
        conditionValue.some((candidate) =>
          Array.isArray(answer)
            ? answer.some((item) => deepEqual(item, candidate))
            : deepEqual(answer, candidate),
        )
      );
    case "is_true":
      return answer === true;
    case "is_false":
      return answer === false;
    default: {
      const unhandled: never = operator;
      throw new Error(`Unhandled conditional operator: ${String(unhandled)}`);
    }
  }
}

/**
 * Whether a question is visible given the full question set and current
 * values. Visibility chains: a question whose controller is hidden is hidden
 * too. Cycles (which the server rejects with CIRCULAR_CONDITION) resolve to
 * hidden rather than looping.
 */
export function isQuestionVisible(
  question: IntakeFormQuestion,
  questions: readonly IntakeFormQuestion[],
  values: IntakeValues,
  visiting: ReadonlySet<string> = new Set(),
): boolean {
  if (question.conditional === null) return true;
  if (visiting.has(question.key)) return false;

  const controller = questions.find(
    (candidate) => candidate.key === question.conditional?.questionKey,
  );
  // A controller outside the fetched set (inactive or out of scope) can never
  // be answered here, so the dependent question stays hidden.
  if (!controller) return false;

  const nextVisiting = new Set(visiting);
  nextVisiting.add(question.key);
  if (!isQuestionVisible(controller, questions, values, nextVisiting)) {
    return false;
  }

  return evaluateConditional(
    question.conditional.operator,
    question.conditional.value,
    values[controller.key],
  );
}

/** The subset of `questions` currently visible, in the given order. */
export function visibleQuestions(
  questions: readonly IntakeFormQuestion[],
  values: IntakeValues,
): IntakeFormQuestion[] {
  return questions.filter((question) =>
    isQuestionVisible(question, questions, values),
  );
}
