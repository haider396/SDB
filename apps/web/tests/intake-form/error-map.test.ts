/**
 * 422 → field mapping (05 §5 req 8): missingKeys and per-key detail map back
 * onto fields by questionKey; everything else degrades to a summary.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { mapSubmissionError } from "@/features/intake-form/error-map";

describe("mapSubmissionError", () => {
  it("maps REQUIRED_ANSWER_MISSING missingKeys onto fields", () => {
    const mapped = mapSubmissionError(
      new ApiError({
        code: "REQUIRED_ANSWER_MISSING",
        message: "Some required answers are missing.",
        details: { missingKeys: ["company_name", "budget_range"] },
        requestId: "01J9XREQID",
        status: 422,
      }),
    );
    expect(mapped.summary).toBe("Some required answers are missing.");
    expect(mapped.requestId).toBe("01J9XREQID");
    expect(mapped.fieldErrors).toEqual({
      company_name: "This answer is required.",
      budget_range: "This answer is required.",
    });
  });

  it("maps VALIDATION_FAILED per-key detail under details.fields", () => {
    const mapped = mapSubmissionError(
      new ApiError({
        code: "VALIDATION_FAILED",
        message: "Validation failed.",
        details: {
          fields: { hours_per_week: "Must be at most 60." },
        },
        requestId: "01J9XVALID",
        status: 422,
      }),
    );
    expect(mapped.fieldErrors).toEqual({
      hours_per_week: "Must be at most 60.",
    });
  });

  it("maps flat per-key detail records too", () => {
    const mapped = mapSubmissionError(
      new ApiError({
        code: "INVALID_OPTION",
        message: "Invalid option.",
        details: { team_size: "Option is not active." },
        requestId: null,
        status: 422,
      }),
    );
    expect(mapped.fieldErrors).toEqual({ team_size: "Option is not active." });
  });

  it("accepts per-key detail objects carrying a message", () => {
    const mapped = mapSubmissionError(
      new ApiError({
        code: "VALUE_TYPE_MISMATCH",
        message: "Wrong value type.",
        details: { target_start_date: { message: "Expected valueDate." } },
        requestId: null,
        status: 422,
      }),
    );
    expect(mapped.fieldErrors).toEqual({
      target_start_date: "Expected valueDate.",
    });
  });

  it("combines missingKeys with per-key details, missingKeys winning", () => {
    const mapped = mapSubmissionError(
      new ApiError({
        code: "REQUIRED_ANSWER_MISSING",
        message: "Missing answers.",
        details: {
          missingKeys: ["contact_email"],
          contact_email: "ignored — missingKeys already covered it",
          other_field: "Also broken.",
        },
        requestId: null,
        status: 422,
      }),
    );
    expect(mapped.fieldErrors).toEqual({
      contact_email: "This answer is required.",
      other_field: "Also broken.",
    });
  });

  it("degrades non-ApiError failures to a generic summary", () => {
    const mapped = mapSubmissionError(new Error("boom"));
    expect(mapped.fieldErrors).toEqual({});
    expect(mapped.requestId).toBeNull();
    expect(mapped.summary).toContain("could not be submitted");
  });
});

/**
 * Repeating groups add `rows` beside the `message` the server already sends
 * (spec §7.3). The extension is only additive if the OLD reading still works,
 * so every test here pins fieldErrors as well.
 */
describe("mapSubmissionError — repeating-group rows", () => {
  const rowsFailure = new ApiError({
    code: "VALIDATION_FAILED",
    message: "Validation failed.",
    details: {
      fields: {
        skills_and_tools: {
          message: "2 rows have problems.",
          rows: [
            {
              rowIndex: 1,
              columnKey: "proficiency",
              message: "This field is required.",
            },
            {
              rowIndex: 3,
              columnKey: "skill",
              message: "Not an active option of this question.",
            },
          ],
        },
        hours_per_week: "Must be at most 60.",
      },
    },
    requestId: null,
    status: 422,
  });

  it("extracts details.fields[key].rows onto their row and column", () => {
    expect(mapSubmissionError(rowsFailure).rowErrors).toEqual({
      skills_and_tools: [
        {
          rowIndex: 1,
          columnKey: "proficiency",
          message: "This field is required.",
        },
        {
          rowIndex: 3,
          columnKey: "skill",
          message: "Not an active option of this question.",
        },
      ],
    });
  });

  it("still puts .message into fieldErrors exactly as it does today", () => {
    expect(mapSubmissionError(rowsFailure).fieldErrors).toEqual({
      skills_and_tools: "2 rows have problems.",
      hours_per_week: "Must be at most 60.",
    });
  });

  it("drops a malformed rows entry without losing the field's message", () => {
    const mapped = mapSubmissionError(
      new ApiError({
        code: "VALIDATION_FAILED",
        message: "Validation failed.",
        details: {
          fields: {
            skills_and_tools: {
              message: "Something is wrong.",
              rows: [{ rowIndex: "one", columnKey: "skill", message: "no" }],
            },
          },
        },
        requestId: null,
        status: 422,
      }),
    );
    expect(mapped.fieldErrors).toEqual({
      skills_and_tools: "Something is wrong.",
    });
    expect(mapped.rowErrors).toEqual({});
  });

  it("returns an empty map for an ordinary field-level failure", () => {
    const mapped = mapSubmissionError(
      new ApiError({
        code: "VALIDATION_FAILED",
        message: "Validation failed.",
        details: { fields: { hours_per_week: "Must be at most 60." } },
        requestId: null,
        status: 422,
      }),
    );
    expect(mapped.rowErrors).toEqual({});
  });
});
