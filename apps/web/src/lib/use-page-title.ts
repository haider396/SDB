/**
 * Per-route document titles (UX 1.10): "Attention queue · SDB Portal".
 * PageHeader calls this with its title, so every page that uses the shared
 * header (all of them — 05 §4.1) gets a tab title for free; standalone
 * pages (login, public intake) call it directly.
 */
import { useEffect } from "react";

const SUFFIX = "SDB Portal";

export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (title === undefined || title.trim() === "") return;
    document.title = `${title} · ${SUFFIX}`;
    // No cleanup: the next page sets its own title; restoring the previous
    // one on unmount would only flash stale titles during navigation.
  }, [title]);
}
