/**
 * Cross-cutting UI state only (05-FRONTEND.md §1) — never a data store.
 * Sidebar collapse state persists per user via Zustand's persist middleware.
 * This stores UI preference only, never auth tokens (CLAUDE.md rule 8).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * How the client's candidate list is drawn.
 *
 * `null` means "never chosen", which is NOT the same as "cards": with no
 * preference the list picks for itself by size (see CANDIDATE_LIST_THRESHOLD).
 * A client hiring three of one role can be reviewing twenty candidates, and a
 * wall of full cards is unreadable at that size — but a small position still
 * reads better as cards. Storing the absence of a choice is what lets both be
 * true until someone says otherwise.
 */
export type CandidateView = "cards" | "list";

interface UiState {
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  candidateView: CandidateView | null;
  setCandidateView: (view: CandidateView) => void;
  /**
   * How the client's positions list is grouped (T24).
   *
   * Defaults to "none" rather than picking for the user, unlike the candidate
   * view above: a client with three positions gains nothing from headings, and
   * a page that silently reorganises itself on first visit is disorienting.
   * The picker is always visible, so it is discoverable without being imposed.
   */
  positionGroupBy: PositionGroupBy;
  setPositionGroupBy: (groupBy: PositionGroupBy) => void;
}

/** Mirrors `GroupBy` in features/client-portal/grouping.ts. */
export type PositionGroupBy = "none" | "department" | "priority";

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      isSidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
      candidateView: null,
      setCandidateView: (view) => set({ candidateView: view }),
      positionGroupBy: "none",
      setPositionGroupBy: (groupBy) => set({ positionGroupBy: groupBy }),
    }),
    { name: "sdb-ui-preferences" },
  ),
);
