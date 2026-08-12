/**
 * The candidate field visibility model, derived from the
 * `client_visible_assignments` view (docs/02-DATABASE.md §11):
 *
 *   - "client"   — in the view's always-visible column list: shown to clients
 *                  from the `presented` stage onwards
 *   - "gated"    — in the view's CASE-gated list: null until the assignment
 *                  reaches `interview_scheduled` or later
 *   - "internal" — not selected by the view at all: never leaves the admin
 *                  surface
 *
 * The editor renders a chip whenever a field's visibility differs from its
 * section's dominant visibility, so admins always know what a client can see
 * without the UI hand-annotating every input.
 */
import type { Candidate } from "@sdb/contracts";

export type FieldVisibility = "client" | "gated" | "internal";

type CandidateField = keyof Candidate;

/** Always-visible columns of client_visible_assignments (02 §11). */
const CLIENT_FIELDS: readonly CandidateField[] = [
  "displayName",
  "preferredName", // feeds the generated display_name
  "photoPath",
  "country",
  "regionState",
  "city",
  "timezone",
  "englishSpokenLevel",
  "englishWrittenLevel",
  "accentStrength",
  "yearsExperienceTotal",
  "yearsExperienceRelevant",
  "currentTitle",
  "seniorityLevel",
  "hasManagementExperience",
  "teamSizeManaged",
  "hasClientFacingExperience",
  "hasUsClientExperience",
  "remoteExperienceYears",
  "availableFrom",
  "engagementTypes",
  "hoursAvailablePerWeek",
  "overlapStart",
  "overlapEnd",
  "overlapTimezone",
  "autonomy",
  "canManageUp",
  "recruiterRecommendation",
  "strengths",
];

/** CASE-gated columns: unlocked at interview_scheduled or later (02 §11). */
const GATED_FIELDS: readonly CandidateField[] = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "whatsapp",
  "linkedinUrl",
  "currentEmployer",
];

const CLIENT_SET: ReadonlySet<CandidateField> = new Set(CLIENT_FIELDS);
const GATED_SET: ReadonlySet<CandidateField> = new Set(GATED_FIELDS);

export function visibilityOf(field: CandidateField): FieldVisibility {
  if (GATED_SET.has(field)) return "gated";
  if (CLIENT_SET.has(field)) return "client";
  return "internal";
}
