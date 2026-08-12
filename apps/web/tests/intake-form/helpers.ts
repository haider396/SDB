/** Shared factories for intake-form tests. */
import type {
  IntakeFormCategory,
  IntakeFormQuestion,
  IntakeFormResponse,
} from "@sdb/contracts";

let uuidCounter = 0;

/** Deterministic valid v4-shaped uuid for fixtures. */
export function testUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

export function makeQuestion(
  overrides: Partial<IntakeFormQuestion> & Pick<IntakeFormQuestion, "key">,
): IntakeFormQuestion {
  return {
    id: testUuid(),
    label: overrides.key,
    helpText: null,
    placeholder: null,
    questionType: "short_text",
    isRequired: false,
    sortOrder: 1,
    validation: {},
    options: [],
    conditional: null,
    ...overrides,
  };
}

export function makeCategory(
  overrides: Partial<IntakeFormCategory> & Pick<IntakeFormCategory, "key">,
): IntakeFormCategory {
  return {
    id: testUuid(),
    label: overrides.key,
    description: null,
    sortOrder: 1,
    questions: [],
    ...overrides,
  };
}

export function makeFormResponse(
  categories: IntakeFormCategory[],
): IntakeFormResponse {
  return {
    formVersionHash: "sha256:test-hash",
    generatedAt: "2026-08-12T09:00:00+00:00",
    categories,
  };
}
