/**
 * Grouping stored answers for display.
 *
 * The heading is the part with a history: snapshots record `categoryKey`,
 * which is stable, but humanising it produces "Candidate Work Setup" where the
 * candidate's screen said "Your working setup". Snapshots now also record
 * `categoryLabel`; rows written before that must still render, which is what
 * the fallback here pins.
 */
import { describe, expect, it } from "vitest";
import { groupAnswersByCategory } from "@/lib/answer-value";

import type { SnapshotAnswer } from "@/lib/answer-value";

/** The full stored-answer shape; only the snapshot and text matter here. */
function answer(
  categoryKey: string,
  categoryLabel: string | null,
  valueText: string,
): SnapshotAnswer {
  return {
    questionSnapshot:
      categoryLabel === null ? { categoryKey } : { categoryKey, categoryLabel },
    valueText,
    selectedOptions: [],
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
  };
}

describe("groupAnswersByCategory", () => {
  it("keeps answers in the order given, grouped by category", () => {
    const groups = groupAnswersByCategory([
      answer("candidate_personal", "About you", "Valentina"),
      answer("candidate_location", "Where you are", "Colombia"),
      answer("candidate_personal", "About you", "Ríos"),
    ]);

    expect(groups.map((group) => group.categoryKey)).toEqual([
      "candidate_personal",
      "candidate_location",
    ]);
    expect(groups[0]?.answers.map((entry) => entry.valueText)).toEqual([
      "Valentina",
      "Ríos",
    ]);
  });

  it("carries the heading the candidate actually saw", () => {
    const [group] = groupAnswersByCategory([
      answer("candidate_work_setup", "Your working setup", "40"),
    ]);
    expect(group?.categoryLabel).toBe("Your working setup");
  });

  it("reports null for answers stored before snapshots carried a label", () => {
    // The caller falls back to humanising the key — the old behaviour, still
    // correct for historical rows.
    const [group] = groupAnswersByCategory([
      answer("candidate_work_setup", null, "40"),
    ]);
    expect(group?.categoryLabel).toBeNull();
    expect(group?.categoryKey).toBe("candidate_work_setup");
  });

  it("keeps the first label when a category was renamed mid-submission", () => {
    // Two answers, one labelled and one not, must not make the heading flicker
    // or depend on which answer happened to sort first.
    const [group] = groupAnswersByCategory([
      answer("candidate_language", null, "professional"),
      answer("candidate_language", "Language", "professional"),
    ]);
    expect(group?.categoryLabel).toBe("Language");
  });

  it("buckets an answer with no category at all rather than dropping it", () => {
    const groups = groupAnswersByCategory([
      { ...answer("x", null, "orphan"), questionSnapshot: {} },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.categoryKey).toBe("other");
    expect(groups[0]?.answers[0]?.valueText).toBe("orphan");
  });
});
