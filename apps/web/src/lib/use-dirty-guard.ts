/**
 * Unsaved-changes guard (05 §4.4, AC-UI-09), two halves:
 *
 * - `useDirtyGuard(isDirty)` — call from any form component. Confirms before
 *   tab close (beforeunload) and registers the dirty state in a shared
 *   registry. It does NOT call useBlocker itself: React Router supports only
 *   ONE mounted blocker per page, and pages like the admin requisition
 *   detail mount several dirty-guarded forms at once (brief + fields).
 * - `<DirtyNavigationBlocker />` — mounted exactly ONCE per layout (admin
 *   and client shells). Owns the single useBlocker and confirms in-app
 *   navigation while ANY registered form is dirty.
 *
 * Components that need a custom discard dialog instead of window.confirm
 * (the question editor) can register an `onBlocked` handler.
 */
import { useEffect, useId } from "react";
import { useBlocker } from "react-router-dom";
import { create } from "zustand";

export interface DirtyEntry {
  message?: string;
  /**
   * Custom blocked-navigation handler: call `proceed` to leave and discard,
   * `reset` to stay. When absent the blocker falls back to window.confirm.
   */
  onBlocked?: (proceed: () => void, reset: () => void) => void;
}

interface DirtyRegistryState {
  entries: Readonly<Record<string, DirtyEntry>>;
  register: (id: string, entry: DirtyEntry) => void;
  unregister: (id: string) => void;
}

/** Cross-cutting UI state only — never data (05 §1). Not persisted. */
export const useDirtyRegistry = create<DirtyRegistryState>((set) => ({
  entries: {},
  register: (id, entry) =>
    set((state) => ({ entries: { ...state.entries, [id]: entry } })),
  unregister: (id) =>
    set((state) => {
      const { [id]: _removed, ...rest } = state.entries;
      return { entries: rest };
    }),
}));

const DEFAULT_MESSAGE =
  "You have unsaved changes. Leave this page and discard them?";

export interface DirtyGuardOptions {
  message?: string;
  onBlocked?: DirtyEntry["onBlocked"];
}

export function useDirtyGuard(
  isDirty: boolean,
  messageOrOptions?: string | DirtyGuardOptions,
): void {
  const id = useId();
  const options: DirtyGuardOptions =
    typeof messageOrOptions === "string"
      ? { message: messageOrOptions }
      : (messageOrOptions ?? {});
  const { message, onBlocked } = options;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (isDirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    useDirtyRegistry.getState().register(id, { message, onBlocked });
    return () => useDirtyRegistry.getState().unregister(id);
  }, [isDirty, id, message, onBlocked]);
}

/**
 * The single in-app navigation blocker. Mount once per layout, inside the
 * data router. Never mount two on the same page.
 */
export function DirtyNavigationBlocker() {
  const entries = useDirtyRegistry((state) => state.entries);
  const dirtyEntries = Object.values(entries);
  const blocker = useBlocker(dirtyEntries.length > 0);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const custom = dirtyEntries.find((entry) => entry.onBlocked !== undefined);
    if (custom?.onBlocked !== undefined) {
      custom.onBlocked(
        () => blocker.proceed(),
        () => blocker.reset(),
      );
      return;
    }
    const message =
      dirtyEntries.find((entry) => entry.message !== undefined)?.message ??
      DEFAULT_MESSAGE;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
    // dirtyEntries derives from `entries`, tracked via the store selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker, entries]);

  return null;
}
