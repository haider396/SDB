/**
 * State machines as explicit adjacency maps — the single home for transitions
 * (docs/06-BACKEND.md §2.2). No handler writes a status or stage directly;
 * later phases route all writes through transitionRequisition()/
 * advanceAssignment(), which validate against these maps, write the row, and
 * emit the event in one transaction.
 */
import type { AssignmentStage, RequisitionStatus } from '@sdb/contracts';

/** Verbatim from docs/06-BACKEND.md §2.2. */
export const REQUISITION_TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  submitted:                 ['pending_principal_approval', 'on_hold', 'closed_unfilled'],
  pending_principal_approval:['sourcing', 'changes_requested', 'on_hold', 'closed_unfilled'],
  changes_requested:         ['pending_principal_approval', 'on_hold', 'closed_unfilled'],
  sourcing:                  ['candidates_presented', 'on_hold', 'closed_unfilled'],
  candidates_presented:      ['interviewing', 'sourcing', 'on_hold', 'closed_unfilled'],
  interviewing:              ['offer_extended', 'candidates_presented', 'on_hold', 'closed_unfilled'],
  offer_extended:            ['placed', 'interviewing', 'on_hold', 'closed_unfilled'],
  placed:                    [],
  on_hold:                   ['sourcing', 'candidates_presented', 'interviewing', 'closed_unfilled'],
  closed_unfilled:           [],
};

/**
 * Derived from the stage machine in docs/01-PRODUCT-OVERVIEW.md §5:
 * - happy path: sourced → screened → vetted → presented → client_reviewing →
 *   interview_scheduled → interviewed → offer → placed
 * - `rejected_by_admin` reachable from any non-terminal stage
 * - `rejected_by_client` only from presented, client_reviewing, interviewed
 * - `withdrawn` from any non-terminal stage
 * - `closed_not_selected` set by the placement flow on sibling assignments,
 *   which may sit at any non-terminal stage when another candidate is placed
 * - terminals (placed and the four exits) have no outbound transitions
 */
export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStage, AssignmentStage[]> = {
  sourced:             ['screened', 'rejected_by_admin', 'withdrawn', 'closed_not_selected'],
  screened:            ['vetted', 'rejected_by_admin', 'withdrawn', 'closed_not_selected'],
  vetted:              ['presented', 'rejected_by_admin', 'withdrawn', 'closed_not_selected'],
  presented:           ['client_reviewing', 'rejected_by_admin', 'rejected_by_client', 'withdrawn', 'closed_not_selected'],
  client_reviewing:    ['interview_scheduled', 'rejected_by_admin', 'rejected_by_client', 'withdrawn', 'closed_not_selected'],
  interview_scheduled: ['interviewed', 'rejected_by_admin', 'withdrawn', 'closed_not_selected'],
  interviewed:         ['offer', 'rejected_by_admin', 'rejected_by_client', 'withdrawn', 'closed_not_selected'],
  offer:               ['placed', 'rejected_by_admin', 'withdrawn', 'closed_not_selected'],
  placed:              [],
  rejected_by_admin:   [],
  rejected_by_client:  [],
  withdrawn:           [],
  closed_not_selected: [],
};

/** True when `from → to` is a legal transition in the given adjacency map. */
export function canTransition<S extends string>(
  map: Record<S, S[]>,
  from: S,
  to: S,
): boolean {
  return map[from].includes(to);
}
