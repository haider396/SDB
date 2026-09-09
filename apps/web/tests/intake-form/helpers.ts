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

/**
 * A repeating-group question shaped like the seeded skills-and-tools one:
 * a catalogue column reading the question's OWN options, a fixed inline
 * proficiency list, and a free-text note.
 */
export function makeRepeatingGroupQuestion(
  overrides: Partial<IntakeFormQuestion> & Pick<IntakeFormQuestion, "key">,
): IntakeFormQuestion {
  return makeQuestion({
    questionType: "repeating_group",
    validation: {
      repeatingGroup: {
        columns: [
          {
            key: "skill",
            label: "Skill",
            columnType: "single_select",
            isRequired: true,
            widthWeight: 2,
            choices: { from: "question_options" },
          },
          {
            key: "proficiency",
            label: "Proficiency",
            columnType: "single_select",
            isRequired: true,
            widthWeight: 1,
            choices: {
              from: "inline",
              options: [
                { value: "aware", label: "Aware" },
                { value: "working", label: "Working" },
                { value: "proficient", label: "Proficient" },
                { value: "expert", label: "Expert" },
              ],
            },
          },
          {
            key: "notes",
            label: "Notes",
            columnType: "short_text",
            isRequired: false,
            widthWeight: 3,
            maxLength: 500,
          },
        ],
        minRows: 0,
        maxRows: 20,
        addRowLabel: "Add another",
      },
    },
    ...overrides,
  });
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
