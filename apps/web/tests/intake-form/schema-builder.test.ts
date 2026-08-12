/**
 * Dynamic Zod schema builder (05-FRONTEND.md §5 req 2): the client schema is
 * built from fetched question definitions — required, min/maxLength, min/max,
 * min/maxSelections, pattern, scale bounds, and the currency-range shape.
 */
import { describe, expect, it } from "vitest";
import {
  buildQuestionSchema,
  validateIntakeValues,
  REQUIRED_MESSAGE,
} from "@/features/intake-form/schema-builder";
import { makeQuestion } from "./helpers";

function firstError(schema: ReturnType<typeof buildQuestionSchema>, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? null;
}

describe("buildQuestionSchema — text types", () => {
  it("requires a non-blank value when isRequired", () => {
    const schema = buildQuestionSchema(
      makeQuestion({ key: "q", questionType: "short_text", isRequired: true }),
    );
    expect(firstError(schema, "")).toBe(REQUIRED_MESSAGE);
    expect(firstError(schema, undefined)).toBe(REQUIRED_MESSAGE);
    expect(schema.safeParse("Acme").success).toBe(true);
  });

  it("passes blank optional values", () => {
    const schema = buildQuestionSchema(
      makeQuestion({ key: "q", questionType: "short_text", isRequired: false }),
    );
    expect(schema.safeParse("").success).toBe(true);
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it("applies minLength and maxLength from the rule bag", () => {
    const schema = buildQuestionSchema(
      makeQuestion({
        key: "q",
        questionType: "short_text",
        isRequired: true,
        validation: { minLength: 3, maxLength: 5 },
      }),
    );
    expect(firstError(schema, "ab")).toContain("at least 3");
    expect(firstError(schema, "abcdef")).toContain("at most 5");
    expect(schema.safeParse("abcd").success).toBe(true);
  });

  it("applies a regex pattern", () => {
    const schema = buildQuestionSchema(
      makeQuestion({
        key: "q",
        questionType: "short_text",
        isRequired: true,
        validation: { pattern: "^REQ-\\d+$" },
      }),
    );
    expect(schema.safeParse("REQ-123").success).toBe(true);
    expect(schema.safeParse("nope").success).toBe(false);
  });

  it("validates email format for the email type", () => {
    const schema = buildQuestionSchema(
      makeQuestion({ key: "q", questionType: "email", isRequired: true }),
    );
    expect(schema.safeParse("someone@example.com").success).toBe(true);
    expect(firstError(schema, "not-an-email")).toBe(
      "Enter a valid email address.",
    );
  });
});

describe("buildQuestionSchema — number and scale", () => {
  it("applies min/max to numbers", () => {
    const schema = buildQuestionSchema(
      makeQuestion({
        key: "q",
        questionType: "number",
        isRequired: true,
        validation: { min: 5, max: 60 },
      }),
    );
    expect(firstError(schema, 4)).toContain("at least 5");
    expect(firstError(schema, 61)).toContain("at most 60");
    expect(schema.safeParse(40).success).toBe(true);
  });

  it("treats NaN as blank (unanswered number input)", () => {
    const required = buildQuestionSchema(
      makeQuestion({ key: "q", questionType: "number", isRequired: true }),
    );
    expect(firstError(required, Number.NaN)).toBe(REQUIRED_MESSAGE);
    const optional = buildQuestionSchema(
      makeQuestion({ key: "q", questionType: "number", isRequired: false }),
    );
    expect(optional.safeParse(Number.NaN).success).toBe(true);
  });

  it("enforces scale bounds from scaleMin/scaleMax", () => {
    const schema = buildQuestionSchema(
      makeQuestion({
        key: "q",
        questionType: "scale",
        isRequired: true,
        validation: { scaleMin: 1, scaleMax: 5 },
      }),
    );
    expect(schema.safeParse(3).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(6).success).toBe(false);
    expect(schema.safeParse(2.5).success).toBe(false);
  });
});

describe("buildQuestionSchema — selects", () => {
  const single = makeQuestion({
    key: "q",
    questionType: "single_select",
    isRequired: true,
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  });

  it("accepts only defined option values for single_select", () => {
    const schema = buildQuestionSchema(single);
    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("z").success).toBe(false);
    expect(firstError(schema, undefined)).toBe(REQUIRED_MESSAGE);
  });

  it("applies minSelections/maxSelections to multi_select", () => {
    const schema = buildQuestionSchema(
      makeQuestion({
        key: "q",
        questionType: "multi_select",
        isRequired: true,
        validation: { minSelections: 2, maxSelections: 3 },
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C" },
          { value: "d", label: "D" },
        ],
      }),
    );
    expect(firstError(schema, ["a"])).toContain("at least 2");
    expect(firstError(schema, ["a", "b", "c", "d"])).toContain("at most 3");
    expect(schema.safeParse(["a", "b"]).success).toBe(true);
    expect(schema.safeParse(["a", "z"]).success).toBe(false);
  });

  it("requires a required multi_select to have at least one selection", () => {
    const schema = buildQuestionSchema(
      makeQuestion({
        key: "q",
        questionType: "multi_select",
        isRequired: true,
        options: [{ value: "a", label: "A" }],
      }),
    );
    // [] is blank → required error, not a silent pass
    expect(firstError(schema, [])).toBe(REQUIRED_MESSAGE);
  });
});

describe("buildQuestionSchema — yes_no and date", () => {
  it("requires an explicit boolean for required yes_no", () => {
    const schema = buildQuestionSchema(
      makeQuestion({ key: "q", questionType: "yes_no", isRequired: true }),
    );
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse(false).success).toBe(true);
    expect(firstError(schema, undefined)).toBe(REQUIRED_MESSAGE);
  });

  it("accepts ISO dates only", () => {
    const schema = buildQuestionSchema(
      makeQuestion({ key: "q", questionType: "date", isRequired: true }),
    );
    expect(schema.safeParse("2026-09-15").success).toBe(true);
    expect(schema.safeParse("15/09/2026").success).toBe(false);
    expect(schema.safeParse("2026-13-45").success).toBe(false);
  });
});

describe("buildQuestionSchema — currency_range", () => {
  const question = makeQuestion({
    key: "budget",
    questionType: "currency_range",
    isRequired: true,
    validation: {
      currency: "USD",
      allowedUnits: ["hourly", "monthly"],
      min: 1,
      max: 100000,
    },
  });

  it("accepts a full range with an allowed unit", () => {
    const schema = buildQuestionSchema(question);
    const result = schema.safeParse({
      min: 1500,
      max: 2500,
      unit: "monthly",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // currency defaults from the rule bag
      expect(result.data).toMatchObject({ currency: "USD" });
    }
  });

  it("rejects min greater than max", () => {
    const schema = buildQuestionSchema(question);
    const result = schema.safeParse({ min: 3000, max: 2500, unit: "monthly" });
    expect(result.success).toBe(false);
  });

  it("rejects a unit outside allowedUnits", () => {
    const hourlyOnly = buildQuestionSchema(
      makeQuestion({
        key: "budget",
        questionType: "currency_range",
        isRequired: true,
        validation: { allowedUnits: ["hourly"] },
      }),
    );
    expect(
      hourlyOnly.safeParse({ min: 10, max: 20, unit: "monthly" }).success,
    ).toBe(false);
  });

  it("requires both amounts and the unit", () => {
    const schema = buildQuestionSchema(question);
    expect(schema.safeParse({ min: 1500, unit: "monthly" }).success).toBe(false);
    expect(schema.safeParse({ min: 1500, max: 2500 }).success).toBe(false);
    expect(firstError(schema, undefined)).toBe(REQUIRED_MESSAGE);
  });

  it("applies rule min/max bounds to both amounts", () => {
    const schema = buildQuestionSchema(question);
    expect(
      schema.safeParse({ min: 0, max: 2500, unit: "monthly" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ min: 1500, max: 200000, unit: "monthly" }).success,
    ).toBe(false);
  });
});

describe("buildQuestionSchema — file_upload (P1 stub)", () => {
  it("never blocks submission, even when marked required", () => {
    const schema = buildQuestionSchema(
      makeQuestion({ key: "cv", questionType: "file_upload", isRequired: true }),
    );
    expect(schema.safeParse(undefined).success).toBe(true);
  });
});

describe("validateIntakeValues", () => {
  it("returns first message per key and strips unknown keys on success", () => {
    const questions = [
      makeQuestion({ key: "a", questionType: "short_text", isRequired: true }),
      makeQuestion({ key: "b", questionType: "number", isRequired: false }),
    ];
    const invalid = validateIntakeValues(questions, { a: "", b: 3 });
    expect(invalid.values).toBeNull();
    expect(invalid.errors).toEqual({ a: REQUIRED_MESSAGE });

    const valid = validateIntakeValues(questions, {
      a: "hello",
      b: 3,
      hidden_key: "should be stripped",
    });
    expect(valid.errors).toEqual({});
    expect(valid.values).toEqual({ a: "hello", b: 3 });
  });
});
