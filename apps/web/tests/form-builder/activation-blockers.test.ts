/**
 * Why a form cannot go live.
 *
 * The activation gate returns its reasons in `details.fields` — sentences
 * written for an admin, like "This form must ask for an email address". The
 * builder read only `error.message` and threw the rest away, so pressing
 * Activate produced "This form is not ready to go live." and nothing else: no
 * indication of which of the five rules had been broken.
 *
 * The candidate-facing renderer had always read these fields. The admin
 * building the form — the only person who can act on them — had not.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { errorFieldMessages } from "@/features/form-builder/api";

function activationRefusal(fields: Record<string, string>): ApiError {
  return new ApiError({
    code: "VALIDATION_FAILED",
    message: "This form is not ready to go live.",
    details: { fields },
    requestId: "req-test-1",
    status: 422,
  });
}

describe("errorFieldMessages", () => {
  it("pulls out the reason the server refused", () => {
    const error = activationRefusal({
      email: "This form must ask for an email address — it is how a candidate is identified.",
    });
    expect(errorFieldMessages(error)).toEqual([
      "This form must ask for an email address — it is how a candidate is identified.",
    ]);
  });

  it("returns every blocker, not just the first", () => {
    // The gate collects ALL failures before throwing, so an admin fixes them
    // in one pass instead of discovering them one press at a time.
    const messages = errorFieldMessages(
      activationRefusal({
        blocks: "Add at least one question before activating.",
        email: "This form must ask for an email address.",
        roleCategoryId: "Choose the role this form is for.",
      }),
    );
    expect(messages).toHaveLength(3);
    expect(messages).toContain("Choose the role this form is for.");
  });

  it("is empty for an error that names no fields", () => {
    const error = new ApiError({
      code: "INTERNAL_ERROR",
      message: "An internal error occurred.",
      status: 500,
    });
    expect(errorFieldMessages(error)).toEqual([]);
  });

  it("is empty for a plain Error, so a network failure renders nothing odd", () => {
    expect(errorFieldMessages(new Error("offline"))).toEqual([]);
  });

  it("ignores non-string values rather than rendering [object Object]", () => {
    const error = new ApiError({
      code: "VALIDATION_FAILED",
      message: "Nope.",
      // A future field could carry structured detail; it must not leak into
      // the list as a stringified object.
      details: { fields: { email: "A real sentence.", other: { nested: true } } },
      status: 422,
    });
    expect(errorFieldMessages(error)).toEqual(["A real sentence."]);
  });

  it("survives details with no fields key at all", () => {
    const error = new ApiError({
      code: "VALIDATION_FAILED",
      message: "Nope.",
      details: { issues: [] },
      status: 422,
    });
    expect(errorFieldMessages(error)).toEqual([]);
  });
});
