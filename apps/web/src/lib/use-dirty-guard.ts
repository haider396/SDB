/**
 * Unsaved-changes guard (05 §4.4, AC-UI-09): confirms before in-app
 * navigation away from a dirty form (useBlocker) and before tab close
 * (beforeunload). Same pattern as the question editor, extracted for the
 * P2 brief and fields editors.
 */
import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

export function useDirtyGuard(isDirty: boolean, message?: string): void {
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (isDirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const blocker = useBlocker(isDirty);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const confirmed = window.confirm(
      message ??
        "You have unsaved changes. Leave this page and discard them?",
    );
    if (confirmed) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);
}
