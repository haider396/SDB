/**
 * Maps a failed POST /intake-submissions back onto form fields by
 * questionKey (05-FRONTEND.md §5 req 8).
 *
 * The server fails fast with a field-level error map (03 §3.3):
 *   - REQUIRED_ANSWER_MISSING → `details.missingKeys: string[]`
 *   - VALIDATION_FAILED etc.  → per-key detail, either under `details.fields`
 *     or as `details` entries whose values are strings (or `{ message }`).
 */
import type { RepeatingGroupFieldError } from "@sdb/contracts";
import { RepeatingGroupFieldErrorSchema } from "@sdb/contracts";
import { ApiError } from "@/lib/api-client";

export interface SubmissionErrorMap {
  /** Plain-language summary for the top-of-form error region. */
  summary: string;
  requestId: string | null;
  /** Message per questionKey, for setError + anchor links. */
  fieldErrors: Record<string, string>;
  /**
   * Cell-precise failures for repeating groups, per questionKey (spec §7.3).
   *
   * A purely additive read: the server sends `rows` BESIDE the `message` that
   * `fieldErrors` already carries, so a caller that ignores this map behaves
   * exactly as it did before the question type existed.
   */
  rowErrors: Record<string, RepeatingGroupFieldError[]>;
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

/**
 * The `rows` array of one per-key detail, or null when there isn't one.
 *
 * Every entry is parsed rather than trusted: a shape the client cannot read is
 * dropped so the field keeps its top-level message, which is strictly better
 * than a summary that throws on a server we have not deployed yet.
 */
function rowsFrom(value: unknown): RepeatingGroupFieldError[] | null {
  if (typeof value !== "object" || value === null) return null;
  const rows = (value as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const parsed: RepeatingGroupFieldError[] = [];
  for (const row of rows) {
    const result = RepeatingGroupFieldErrorSchema.safeParse(row);
    if (result.success) parsed.push(result.data);
  }
  return parsed.length > 0 ? parsed : null;
}

export function mapSubmissionError(error: unknown): SubmissionErrorMap {
  if (!(error instanceof ApiError)) {
    return {
      summary: GENERIC_SUMMARY,
      requestId: null,
      fieldErrors: {},
      rowErrors: {},
    };
  }

  const fieldErrors: Record<string, string> = {};
  const rowErrors: Record<string, RepeatingGroupFieldError[]> = {};
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
      // Independent of the message above: a repeating group can fail with
      // rows and no group message, and the cells must still find their inputs.
      const rows = rowsFrom(value);
      if (rows !== null) rowErrors[key] = rows;
    }
  }

  return {
    summary: error.message || GENERIC_SUMMARY,
    requestId: error.requestId,
    fieldErrors,
    rowErrors,
  };
}
