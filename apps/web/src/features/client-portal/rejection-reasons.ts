/**
 * Rejection reason options for the client Reject dialog (01 §3 J6 step 4,
 * AC-PL-11): the live GET /rejection-reasons taxonomy filtered to
 * actor=client, so the dialog submits real `reasonId`s. The static copy of
 * the seeded client-actor reasons from 0011_seed_reference_data.sql remains
 * ONLY as a fallback when the listing call fails (id null → the dialog
 * submits the label as `reasonOther`, still satisfying chk_reason_present).
 */
import {
  fetchRejectionReasonsFor,
  type RejectionReasonOption,
} from "@/features/pipeline/rejection-reasons";

export type { RejectionReasonOption };

/** Verbatim keys/labels from 0011_seed_reference_data.sql (actor = client). */
const SEEDED_CLIENT_REASONS: readonly RejectionReasonOption[] = [
  { id: null, key: "skills_gap", label: "Skills gap", actor: "client", isOther: false },
  { id: null, key: "experience_level_mismatch", label: "Experience level too junior / too senior", actor: "client", isOther: false },
  { id: null, key: "english_communication", label: "English or communication level", actor: "client", isOther: false },
  { id: null, key: "culture_fit", label: "Culture or working-style fit", actor: "client", isOther: false },
  { id: null, key: "salary_mismatch", label: "Salary expectation mismatch", actor: "client", isOther: false },
  { id: null, key: "availability_timezone", label: "Availability or timezone overlap", actor: "client", isOther: false },
  { id: null, key: "chose_different_candidate", label: "Chose a different candidate", actor: "client", isOther: false },
  { id: null, key: "role_paused_cancelled", label: "Role paused or cancelled", actor: "client", isOther: false },
  { id: null, key: "other_client", label: "Other", actor: "client", isOther: true },
];

/** Client-actor reasons for the portal's Reject dialog. */
export function fetchClientRejectionReasons(): Promise<RejectionReasonOption[]> {
  return fetchRejectionReasonsFor("client", SEEDED_CLIENT_REASONS);
}
