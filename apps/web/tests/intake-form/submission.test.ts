/**
 * Submission payload (05 §5 req 7, 03 §3.3): only visible, answered
 * questions; each answer carries exactly one value field, keyed by type.
 */
import { describe, expect, it } from "vitest";
import { IntakeAnswerSchema, IntakeSubmissionSchema } from "@sdb/contracts";
import {
  buildAnswers,
  buildSubmission,
  toAnswer,
} from "@/features/intake-form/submission";
import { makeQuestion, testUuid } from "./helpers";

describe("toAnswer — value field keyed by question type (03 §3.3)", () => {
  it.each([
    ["short_text", "Acme Inc.", { valueText: "Acme Inc." }],
    ["long_text", "Long story.", { valueText: "Long story." }],
    ["email", "a@b.co", { valueText: "a@b.co" }],
    ["phone", "+63 900 000 0000", { valueText: "+63 900 000 0000" }],
    ["single_select", "6-15", { valueText: "6-15" }],
    ["number", 3, { valueNumber: 3 }],
    ["scale", 4, { valueNumber: 4 }],
    ["yes_no", true, { valueBoolean: true }],
    ["yes_no", false, { valueBoolean: false }],
    ["date", "2026-09-15", { valueDate: "2026-09-15" }],
    ["multi_select", ["clickup", "gohighlevel"], { valueJson: ["clickup", "gohighlevel"] }],
    [
      "currency_range",
      { min: 1500, max: 2500, unit: "monthly", currency: "USD" },
      { valueJson: { min: 1500, max: 2500, unit: "monthly", currency: "USD" } },
    ],
  ] as const)("%s → %j", (questionType, value, expected) => {
    const question = makeQuestion({ key: "q", questionType });
    const answer = toAnswer(question, value);
    expect(answer).toEqual({ questionKey: "q", ...expected });
    // Exactly one value field — the contracts refinement must accept it.
    expect(IntakeAnswerSchema.safeParse(answer).success).toBe(true);
  });

  it("returns null for blank values instead of null-valued answers", () => {
    expect(toAnswer(makeQuestion({ key: "q" }), "")).toBeNull();
    expect(toAnswer(makeQuestion({ key: "q" }), undefined)).toBeNull();
    expect(
      toAnswer(makeQuestion({ key: "q", questionType: "multi_select" }), []),
    ).toBeNull();
    expect(
      toAnswer(makeQuestion({ key: "q", questionType: "number" }), Number.NaN),
    ).toBeNull();
  });

  it("never produces a file_upload answer in P1", () => {
    const question = makeQuestion({ key: "cv", questionType: "file_upload" });
    expect(toAnswer(question, "anything")).toBeNull();
  });
});

describe("buildAnswers / buildSubmission", () => {
  const questions = [
    makeQuestion({ key: "company_name", questionType: "short_text" }),
    makeQuestion({ key: "flag", questionType: "yes_no" }),
    makeQuestion({
      key: "detail",
      questionType: "short_text",
      conditional: { questionKey: "flag", operator: "is_true", value: null },
    }),
    makeQuestion({ key: "notes", questionType: "long_text" }),
  ];

  it("sends only visible, answered questions", () => {
    const answers = buildAnswers(questions, {
      company_name: "Acme",
      flag: true,
      detail: "Legal",
      notes: "", // answered blank → excluded
    });
    expect(answers).toEqual([
      { questionKey: "company_name", valueText: "Acme" },
      { questionKey: "flag", valueBoolean: true },
      { questionKey: "detail", valueText: "Legal" },
    ]);
  });

  it("produces a submission that satisfies the contracts schema", () => {
    const roleCategoryId = testUuid();
    const submission = buildSubmission(
      "sha256:abc",
      roleCategoryId,
      questions,
      { company_name: "Acme", flag: false },
    );
    expect(submission).toEqual({
      formVersionHash: "sha256:abc",
      roleCategoryId,
      answers: [
        { questionKey: "company_name", valueText: "Acme" },
        { questionKey: "flag", valueBoolean: false },
      ],
    });
    expect(IntakeSubmissionSchema.safeParse(submission).success).toBe(true);
  });
});
