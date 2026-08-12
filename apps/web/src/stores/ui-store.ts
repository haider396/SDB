/**
 * Cross-cutting UI state only (05-FRONTEND.md §1) — never a data store.
 * Sidebar collapse state persists per user via Zustand's persist middleware.
 * This stores UI preference only, never auth tokens (CLAUDE.md rule 8).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      isSidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
    }),
    { name: "sdb-ui-preferences" },
  ),
);
