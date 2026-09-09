/**
 * pruneValidation drops rules that do not apply to the (possibly changed)
 * question type, so an unknown key — 422 INVALID_VALIDATION_RULE — cannot be
 * produced by the editor (03 §1.5).
 *
 * The repeating-group case is here because its failure is SILENT. The columns
 * live in the same rule bag as minLength and maxLength, so a missing entry in
 * VALIDATION_KEYS_BY_TYPE compiles perfectly and simply deletes every column
 * definition on the next save from the question editor. The question survives,
 * the form renders an empty table, and nothing warns.
 */
import { describe, expect, it } from "vitest";
import type { ValidationRules } from "@sdb/contracts";
import { pruneValidation } from "@/features/question-manager/guard-rails";

const repeatingGroup: ValidationRules = {
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
};

describe("pruneValidation", () => {
  it("AC-FB-14 — keeps a repeating group's column definitions", () => {
    expect(pruneValidation("repeating_group", repeatingGroup)).toEqual(
      repeatingGroup,
    );
  });

  it("AC-FB-14 — drops the columns when the type is changed away", () => {
    // The mirror image: columns on a short_text question would be an unknown
    // key to the API, so changing type must strip them.
    expect(pruneValidation("short_text", repeatingGroup)).toEqual({});
  });

  it("keeps only the rules that apply to the type", () => {
    const bag: ValidationRules = { minLength: 2, maxLength: 200, scaleMin: 1 };
    expect(pruneValidation("short_text", bag)).toEqual({
      minLength: 2,
      maxLength: 200,
    });
  });
});
