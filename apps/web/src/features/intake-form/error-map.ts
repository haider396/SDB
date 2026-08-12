/**
 * Maps a failed POST /intake-submissions back onto form fields by
 * questionKey (05-FRONTEND.md §5 req 8).
 *
 * The server fails fast with a field-level error map (03 §3.3):
 *   - REQUIRED_ANSWER_MISSING → `details.missingKeys: string[]`
 *   - VALIDATION_FAILED etc.  → per-key detail, either under `details.fields`
 *     or as `details` entries whose values are strings (or `{ message }`).
 */
import { ApiError } from "@/lib/api-client";

export interface SubmissionErrorMap {
  /** Plain-language summary for the top-of-form error region. */
  summary: string;
  requestId: string | null;
  /** Message per questionKey, for setError + anchor links. */
  fieldErrors: Record<string, string>;
}

const GENERIC_SUMMARY =
  "Your request could not be submitted. Please try again.";

function messageFrom(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return null;
}

export function mapSubmissionError(error: unknown): SubmissionErrorMap {
  if (!(error instanceof ApiError)) {
    return { summary: GENERIC_SUMMARY, requestId: null, fieldErrors: {} };
  }

  const fieldErrors: Record<string, string> = {};
  const details = error.details;

  if (details !== null) {
    const missingKeys = details["missingKeys"];
    if (Array.isArray(missingKeys)) {
      for (const key of missingKeys) {
        if (typeof key === "string") {
          fieldErrors[key] = "This answer is required.";
        }
      }
    }

    const fields = details["fields"];
    const perKeySource =
      typeof fields === "object" && fields !== null
        ? (fields as Record<string, unknown>)
        : details;
    for (const [key, value] of Object.entries(perKeySource)) {
      if (key === "missingKeys" || key === "fields") continue;
      const message = messageFrom(value);
      if (message !== null && fieldErrors[key] === undefined) {
        fieldErrors[key] = message;
      }
    }
  }

  return {
    summary: error.message || GENERIC_SUMMARY,
    requestId: error.requestId,
    fieldErrors,
  };
}
