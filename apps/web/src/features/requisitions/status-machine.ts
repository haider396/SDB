/**
 * Client-side copy of the requisition state machine adjacency map from
 * docs/01-PRODUCT-OVERVIEW.md §4. Drives which transition buttons render —
 * the server remains the authority and still validates every transition
 * (409 INVALID_TRANSITION), so this map only shapes the UI.
 *
 * Special cases, verbatim from 01 §4:
 * - any NON-TERMINAL state may go to on_hold and closed_unfilled
 * - on_hold returns to the prior state — unknowable from the map alone, so
 *   the resume target is derived from the event log by the caller
 */
import type { RequisitionStatus } from "@sdb/contracts";

/** Terminal states accept no outbound transitions (AC-RQ-03). */
export const TERMINAL_STATUSES: readonly RequisitionStatus[] = [
  "placed",
  "closed_unfilled",
];

/** The forward edges of 01 §4 (excluding the on_hold/closed rules below). */
const FORWARD_EDGES: Record<RequisitionStatus, readonly RequisitionStatus[]> = {
  submitted: ["pending_principal_approval"],
  pending_principal_approval: ["changes_requested", "sourcing"],
  changes_requested: ["pending_principal_approval"],
  sourcing: ["candidates_presented"],
  candidates_presented: ["interviewing"],
  interviewing: ["offer_extended"],
  offer_extended: ["placed"],
  placed: [],
  on_hold: [], // resume target comes from the event log
  closed_unfilled: [],
};

export function isTerminalStatus(status: RequisitionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * All statuses the UI may offer from `current`. `resumeTarget` is the state
 * the requisition was in before going on hold (from the event log), used
 * only when current === "on_hold".
 */
export function allowedTransitions(
  current: RequisitionStatus,
  resumeTarget?: RequisitionStatus,
): RequisitionStatus[] {
  if (isTerminalStatus(current)) return [];
  if (current === "on_hold") {
    const targets: RequisitionStatus[] =
      resumeTarget !== undefined ? [resumeTarget] : [];
    targets.push("closed_unfilled");
    return targets;
  }
  return [...FORWARD_EDGES[current], "on_hold", "closed_unfilled"];
}

/** Ordered happy path used by the StageTracker visualisation. */
export const HAPPY_PATH: readonly RequisitionStatus[] = [
  "submitted",
  "pending_principal_approval",
  "sourcing",
  "candidates_presented",
  "interviewing",
  "offer_extended",
  "placed",
];
