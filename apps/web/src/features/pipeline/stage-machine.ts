/**
 * Client-side copy of the assignment stage machine adjacency map.
 *
 * SOURCE OF TRUTH: apps/api/src/services/state-machines.ts
 * (ASSIGNMENT_TRANSITIONS), itself derived from docs/01-PRODUCT-OVERVIEW.md
 * §5. The map below is a verbatim copy — the server remains the authority
 * and still validates every advance (409 INVALID_TRANSITION with
 * { from, to }), so this map only shapes the UI: which board columns light
 * up as drop targets during a drag, and which "Advance to…" menu items
 * render. tests/p4/stage-machine.test.ts pins this copy against a literal
 * of the API map so drift fails the suite.
 */
import type { AssignmentStage } from "@sdb/contracts";

/** Verbatim from apps/api/src/services/state-machines.ts (01 §5). */
export const ASSIGNMENT_TRANSITIONS: Record<
  AssignmentStage,
  readonly AssignmentStage[]
> = {
  sourced: ["screened", "rejected_by_admin", "withdrawn", "closed_not_selected"],
  screened: ["vetted", "rejected_by_admin", "withdrawn", "closed_not_selected"],
  vetted: ["presented", "rejected_by_admin", "withdrawn", "closed_not_selected"],
  presented: [
    "client_reviewing",
    "rejected_by_admin",
    "rejected_by_client",
    "withdrawn",
    "closed_not_selected",
  ],
  client_reviewing: [
    "interview_scheduled",
    "rejected_by_admin",
    "rejected_by_client",
    "withdrawn",
    "closed_not_selected",
  ],
  interview_scheduled: [
    "interviewed",
    "rejected_by_admin",
    "withdrawn",
    "closed_not_selected",
  ],
  interviewed: [
    "offer",
    "rejected_by_admin",
    "rejected_by_client",
    "withdrawn",
    "closed_not_selected",
  ],
  offer: ["placed", "rejected_by_admin", "withdrawn", "closed_not_selected"],
  placed: [],
  rejected_by_admin: [],
  rejected_by_client: [],
  withdrawn: [],
  closed_not_selected: [],
};

/** The nine active-pipeline columns of the board, in happy-path order. */
export const BOARD_STAGES = [
  "sourced",
  "screened",
  "vetted",
  "presented",
  "client_reviewing",
  "interview_scheduled",
  "interviewed",
  "offer",
  "placed",
] as const satisfies readonly AssignmentStage[];
export type BoardStage = (typeof BOARD_STAGES)[number];

/** Terminal exits, shown as a collapsed side group rather than columns. */
export const TERMINAL_STAGES = [
  "rejected_by_admin",
  "rejected_by_client",
  "withdrawn",
  "closed_not_selected",
] as const satisfies readonly AssignmentStage[];
export type TerminalStage = (typeof TERMINAL_STAGES)[number];

export function isBoardStage(stage: AssignmentStage): stage is BoardStage {
  return (BOARD_STAGES as readonly AssignmentStage[]).includes(stage);
}

export function isTerminalStage(
  stage: AssignmentStage,
): stage is TerminalStage {
  return (TERMINAL_STAGES as readonly AssignmentStage[]).includes(stage);
}

/** Every stage legally reachable from `from` in one transition. */
export function allowedTargets(from: AssignmentStage): AssignmentStage[] {
  return [...ASSIGNMENT_TRANSITIONS[from]];
}

/** True when `from → to` is a legal edge of the machine. */
export function canAdvance(from: AssignmentStage, to: AssignmentStage): boolean {
  return ASSIGNMENT_TRANSITIONS[from].includes(to);
}

/**
 * Drop-target state of a board column while a card from `activeStage` is
 * being dragged (05 §4.7: invalid target columns are VISUALLY DISABLED
 * during the drag, not rejected after the drop).
 *
 * - "idle":     no drag in progress
 * - "origin":   the dragged card's own column — dropping is a no-op
 * - "valid":    a legal transition target
 * - "disabled": unreachable from `activeStage`; refuses the drop
 */
export type ColumnDropState = "idle" | "origin" | "valid" | "disabled";

export function columnDropState(
  activeStage: AssignmentStage | null,
  columnStage: BoardStage,
): ColumnDropState {
  if (activeStage === null) return "idle";
  if (activeStage === columnStage) return "origin";
  return canAdvance(activeStage, columnStage) ? "valid" : "disabled";
}

/**
 * Targets offered by the card's "Advance to…" keyboard/menu path. Rejections
 * are excluded (they go through the Reject dialog so a reason row is always
 * written — AC-PL-11), `placed` is excluded (it goes through the Place
 * dialog → POST /assignments/:id/place transaction, never a bare advance),
 * and `closed_not_selected` is excluded (only the placement flow sets it on
 * siblings). `withdrawn` stays: it is a legitimate direct exit.
 */
export function menuAdvanceTargets(from: AssignmentStage): AssignmentStage[] {
  return allowedTargets(from).filter(
    (target) =>
      target !== "rejected_by_admin" &&
      target !== "rejected_by_client" &&
      target !== "placed" &&
      target !== "closed_not_selected",
  );
}
