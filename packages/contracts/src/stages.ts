/**
 * STAGE_VISIBILITY constants — single source of truth, copied verbatim from
 * docs/01-PRODUCT-OVERVIEW.md §5.
 *
 * - CLIENT_VISIBLE_STAGES: the only assignment stages a client-scoped endpoint
 *   may ever return. `rejected_by_admin` and `withdrawn` are deliberately absent.
 * - PII_UNLOCKED_STAGES: stages at which gated candidate PII is exposed
 *   (enforced in SQL by the client_visible_assignments view).
 */
import type { AssignmentStage } from './enums.js';

export const CLIENT_VISIBLE_STAGES = [
  'presented', 'client_reviewing', 'interview_scheduled',
  'interviewed', 'offer', 'placed',
  'rejected_by_client', 'closed_not_selected',
] as const;

export const PII_UNLOCKED_STAGES = [
  'interview_scheduled', 'interviewed', 'offer', 'placed',
] as const;

export type ClientVisibleStage = (typeof CLIENT_VISIBLE_STAGES)[number];
export type PiiUnlockedStage = (typeof PII_UNLOCKED_STAGES)[number];

// Compile-time guarantee that every listed stage is a real assignment stage.
const _clientVisibleCheck: readonly AssignmentStage[] = CLIENT_VISIBLE_STAGES;
const _piiUnlockedCheck: readonly AssignmentStage[] = PII_UNLOCKED_STAGES;
void _clientVisibleCheck;
void _piiUnlockedCheck;

/**
 * The candidate fields withheld from clients until the assignment reaches a
 * PII-unlocked stage (docs/02-DATABASE.md §11). camelCase API field names.
 */
export const GATED_PII_FIELDS = [
  'lastName',
  'email',
  'phone',
  'whatsapp',
  'linkedinUrl',
  'currentEmployer',
] as const;
export type GatedPiiField = (typeof GATED_PII_FIELDS)[number];

export function isClientVisibleStage(
  stage: AssignmentStage,
): stage is ClientVisibleStage {
  return (CLIENT_VISIBLE_STAGES as readonly AssignmentStage[]).includes(stage);
}

export function isPiiUnlockedStage(
  stage: AssignmentStage,
): stage is PiiUnlockedStage {
  return (PII_UNLOCKED_STAGES as readonly AssignmentStage[]).includes(stage);
}
