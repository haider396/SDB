/**
 * Rejection reason options for the Reject dialogs (admin actor here; the
 * client portal reuses the same machinery via
 * features/client-portal/rejection-reasons.ts).
 *
 * GET /rejection-reasons (04 §5 taxonomy reads) is the source of truth:
 * options carry real row UUIDs, so the dialogs submit `reasonId`. The
 * static seeded copies from 0011_seed_reference_data.sql remain ONLY as a
 * fallback when the listing call fails — there `id` is null and the dialog
 * submits the reason LABEL as `reasonOther` instead, which still satisfies
 * the DB chk_reason_present constraint and AC-PL-11 (a decline must never
 * dead-end on a taxonomy outage).
 */
import type { RejectionActor, RejectionReason } from "@sdb/contracts";
import { apiFetchCollection } from "@/lib/api-client";

export interface RejectionReasonOption {
  /** Null only in the seeded fallback (row UUIDs differ per environment). */
  id: string | null;
  key: string;
  label: string;
  actor: RejectionActor;
  /** True for the free-text "Other" rows — requires typed text. */
  isOther: boolean;
}

/** The seeded "Other" rows are keyed other_admin / other_client. */
function isOtherReason(reason: Pick<RejectionReason, "key" | "label">): boolean {
  return (
    reason.key.startsWith("other") ||
    reason.label.trim().toLowerCase() === "other"
  );
}

/**
 * Active reasons for one actor from GET /rejection-reasons, sorted by
 * sortOrder; the given seeded list on failure.
 */
export async function fetchRejectionReasonsFor(
  actor: RejectionActor,
  fallback: readonly RejectionReasonOption[],
): Promise<RejectionReasonOption[]> {
  try {
    const { data } = await apiFetchCollection<RejectionReason>(
      "/rejection-reasons",
      { query: { actor, isActive: true } },
    );
    return [...data]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((reason) => ({
        id: reason.id,
        key: reason.key,
        label: reason.label,
        actor: reason.actor,
        isOther: isOtherReason(reason),
      }));
  } catch {
    return [...fallback];
  }
}

/** Verbatim keys/labels from 0011_seed_reference_data.sql (actor = admin). */
const SEEDED_ADMIN_REASONS: readonly RejectionReasonOption[] = [
  { id: null, key: "failed_vetting", label: "Failed vetting", actor: "admin", isOther: false },
  { id: null, key: "unresponsive", label: "Unresponsive", actor: "admin", isOther: false },
  { id: null, key: "withdrew_from_process", label: "Withdrew from process", actor: "admin", isOther: false },
  { id: null, key: "salary_out_of_range", label: "Salary expectation out of range", actor: "admin", isOther: false },
  { id: null, key: "better_fit_other_client", label: "Better fit for a different client", actor: "admin", isOther: false },
  { id: null, key: "duplicate_record", label: "Duplicate record", actor: "admin", isOther: false },
  { id: null, key: "other_admin", label: "Other", actor: "admin", isOther: true },
];

/** Admin-actor reasons for the admin pipeline board's Reject dialog. */
export function fetchRejectionReasons(): Promise<RejectionReasonOption[]> {
  return fetchRejectionReasonsFor("admin", SEEDED_ADMIN_REASONS);
}
