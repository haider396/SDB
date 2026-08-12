/**
 * AC-IF-18 — adding a new question_type to the enum without updating the
 * renderer map is a TypeScript compile error.
 *
 * The assertions below are type-level: `tsc --noEmit` (run in CI via
 * `pnpm typecheck`, and by `pnpm build`) fails if either direction of the
 * mapping drifts. The runtime expectations only pin the same fact for the
 * test report.
 */
import { describe, expect, it } from "vitest";
import { QuestionTypeSchema, type QuestionType } from "@sdb/contracts";
import { HANDLED_QUESTION_TYPES } from "@/features/intake-form/components/question-field";

// Direction 1: every QuestionType is handled by the renderer.
// (question-field.tsx also carries a `never` guard in its switch.)
type HandledType = keyof typeof HANDLED_QUESTION_TYPES;
const everyQuestionTypeIsHandled: Record<QuestionType, true> =
  HANDLED_QUESTION_TYPES;

// Direction 2: the renderer handles nothing outside the enum.
const noExtraTypesAreHandled: Record<HandledType, QuestionType> = Object.freeze(
  Object.fromEntries(
    QuestionTypeSchema.options.map((type) => [type, type]),
  ) as Record<QuestionType, QuestionType>,
);

describe("AC-IF-18 — renderer map exhaustiveness", () => {
  it("handles every question type in the contracts enum", () => {
    expect(Object.keys(everyQuestionTypeIsHandled).sort()).toEqual(
      [...QuestionTypeSchema.options].sort(),
    );
    expect(Object.keys(noExtraTypesAreHandled).sort()).toEqual(
      [...QuestionTypeSchema.options].sort(),
    );
  });
});
