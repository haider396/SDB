/**
 * Rejection reason options for the admin Reject dialog.
 *
 * TODO(api-gap): the API does not yet expose a rejection-reasons listing
 * route (docs/04-API.md §5 taxonomy-management reads are a known gap — no
 * GET /rejection-reasons exists in apps/api/src/routes as of P4). Until it
 * does, this file carries a static copy of the seeded reasons from
 * supabase/migrations/0011_seed_reference_data.sql. Because the seeded row
 * UUIDs are generated per environment, `id` is null here and the dialog
 * submits the reason LABEL as `reasonOther` (satisfying the DB
 * chk_reason_present constraint and AC-PL-11) instead of a `reasonId`.
 *
 * When the endpoint ships, replace the body of `fetchRejectionReasons` with:
 *   const { data } = await apiFetchCollection<RejectionReasonOption>("/rejection-reasons");
 *   return data.filter((reason) => reason.actor === "admin");
 * — nothing else in the feature needs to change: the dialog already prefers
 * `reasonId` whenever `id` is non-null.
 */
import type { RejectionActor } from "@sdb/contracts";

export interface RejectionReasonOption {
  /** Null until the listing endpoint provides real row UUIDs. */
  id: string | null;
  key: string;
  label: string;
  actor: RejectionActor;
  /** True for the free-text "Other" rows — requires typed text. */
  isOther: boolean;
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
  return Promise.resolve([...SEEDED_ADMIN_REASONS]);
}
