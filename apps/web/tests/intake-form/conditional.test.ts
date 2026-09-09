/**
 * Conditional visibility (05 §5 req 4): equals/not_equals/in/is_true/is_false
 * evaluated reactively from current values; hidden questions excluded from
 * submission entirely.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateConditional,
  isBlank,
  isQuestionVisible,
  visibleQuestions,
} from "@/features/intake-form/conditional";
import { buildAnswers } from "@/features/intake-form/submission";
import { makeQuestion } from "./helpers";

describe("evaluateConditional", () => {
  it("equals / not_equals compare the answer to the condition value", () => {
    expect(evaluateConditional("equals", "6-15", "6-15")).toBe(true);
    expect(evaluateConditional("equals", "6-15", "1-5")).toBe(false);
    expect(evaluateConditional("not_equals", "6-15", "1-5")).toBe(true);
    expect(evaluateConditional("not_equals", "6-15", "6-15")).toBe(false);
  });

  it("in checks membership of the answer in the condition list", () => {
    expect(evaluateConditional("in", ["a", "b"], "a")).toBe(true);
    expect(evaluateConditional("in", ["a", "b"], "c")).toBe(false);
    // multi_select answer: any overlap counts
    expect(evaluateConditional("in", ["a", "b"], ["c", "b"])).toBe(true);
    expect(evaluateConditional("in", ["a", "b"], ["c", "d"])).toBe(false);
  });

  it("is_true / is_false require an explicit boolean", () => {
    expect(evaluateConditional("is_true", null, true)).toBe(true);
    expect(evaluateConditional("is_true", null, false)).toBe(false);
    expect(evaluateConditional("is_false", null, false)).toBe(true);
    expect(evaluateConditional("is_false", null, true)).toBe(false);
  });

  it("an unanswered controller satisfies no operator", () => {
    expect(evaluateConditional("equals", "x", undefined)).toBe(false);
    expect(evaluateConditional("not_equals", "x", undefined)).toBe(false);
    expect(evaluateConditional("is_true", null, undefined)).toBe(false);
    expect(evaluateConditional("in", ["x"], "")).toBe(false);
  });
});

describe("isQuestionVisible / visibleQuestions", () => {
  const controller = makeQuestion({ key: "has_industry", questionType: "yes_no" });
  const dependent = makeQuestion({
    key: "industry_detail",
    conditional: { questionKey: "has_industry", operator: "is_true", value: null },
  });
  const questions = [controller, dependent];

  it("shows the dependent only when the condition is met", () => {
    expect(isQuestionVisible(dependent, questions, {})).toBe(false);
    expect(isQuestionVisible(dependent, questions, { has_industry: false })).toBe(false);
    expect(isQuestionVisible(dependent, questions, { has_industry: true })).toBe(true);
  });

  it("hides a dependent whose controller is itself hidden (chained)", () => {
    const root = makeQuestion({ key: "root", questionType: "yes_no" });
    const middle = makeQuestion({
      key: "middle",
      questionType: "yes_no",
      conditional: { questionKey: "root", operator: "is_true", value: null },
    });
    const leaf = makeQuestion({
      key: "leaf",
      conditional: { questionKey: "middle", operator: "is_true", value: null },
    });
    const chain = [root, middle, leaf];
    // middle has an answer, but root hides middle → leaf hidden too
    expect(isQuestionVisible(leaf, chain, { middle: true, root: false })).toBe(false);
    expect(isQuestionVisible(leaf, chain, { middle: true, root: true })).toBe(true);
  });

  it("hides a question whose controller is not in the fetched set", () => {
    const orphan = makeQuestion({
      key: "orphan",
      conditional: { questionKey: "missing", operator: "is_true", value: null },
    });
    expect(isQuestionVisible(orphan, [orphan], { missing: true })).toBe(false);
  });

  it("resolves circular conditions to hidden instead of looping", () => {
    const a = makeQuestion({
      key: "a",
      conditional: { questionKey: "b", operator: "is_true", value: null },
    });
    const b = makeQuestion({
      key: "b",
      conditional: { questionKey: "a", operator: "is_true", value: null },
    });
    expect(isQuestionVisible(a, [a, b], { a: true, b: true })).toBe(false);
  });

  it("visibleQuestions preserves order and filters hidden", () => {
    const visible = visibleQuestions(questions, { has_industry: true });
    expect(visible.map((question) => question.key)).toEqual([
      "has_industry",
      "industry_detail",
    ]);
    expect(visibleQuestions(questions, {}).map((q) => q.key)).toEqual([
      "has_industry",
    ]);
  });
});

describe("hidden questions are excluded from the payload (05 §5 req 4/7)", () => {
  it("omits the hidden dependent entirely — not submitted as null", () => {
    const controller = makeQuestion({ key: "flag", questionType: "yes_no" });
    const dependent = makeQuestion({
      key: "detail",
      conditional: { questionKey: "flag", operator: "is_true", value: null },
    });
    const questions = [controller, dependent];

    // The user answered detail, then flipped flag to false → detail hidden.
    const answers = buildAnswers(questions, { flag: false, detail: "stale" });
    expect(answers).toEqual([{ questionKey: "flag", valueBoolean: false }]);
    expect(answers.some((answer) => answer.questionKey === "detail")).toBe(false);
  });
});

describe("isBlank knows an emptied repeating group is empty", () => {
  it("calls a table with no rows blank, and one with a row not blank", () => {
    // A candidate who adds a row and then deletes it submits { rows: [] }.
    // Without this the required check passes on an answer with nothing in it
    // and an empty answer row is written. Mirrors the API's own isBlank.
    expect(isBlank({ rows: [] })).toBe(true);
    expect(isBlank({ rows: [{}] })).toBe(false);
    expect(isBlank({ rows: [{ skill: "ClickUp" }] })).toBe(false);
  });

  it("leaves every other object shape alone", () => {
    // currency_range's value is an object too, and must stay non-blank.
    expect(isBlank({ min: 1, max: 2, unit: "monthly", currency: "USD" })).toBe(
      false,
    );
  });

  it("hides a dependent whose controlling table was emptied", () => {
    const controller = makeQuestion({
      key: "skills",
      questionType: "repeating_group",
    });
    const dependent = makeQuestion({
      key: "detail",
      conditional: { questionKey: "skills", operator: "not_equals", value: null },
    });
    expect(
      visibleQuestions([controller, dependent], { skills: { rows: [] } }).map(
        (question) => question.key,
      ),
    ).toEqual(["skills"]);
  });
});
