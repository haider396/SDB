/**
 * Prev/Next pagination over the API's cursor scheme (04 §1).
 *
 * Cursors cannot jump to an arbitrary page, so the client keeps a stack of
 * the cursors it has walked through: page 1 is the un-cursored request, Next
 * pushes the current page's `meta.nextCursor`, Prev pops. Any filter or
 * page-size change invalidates every stored cursor, so the stack is keyed by
 * a caller-supplied reset key and discarded the moment the key changes —
 * derived during render, never in an effect, so a stale cursor is never
 * fetched.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Collection } from "@/lib/api-client";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Cursor + page size for one list request. */
export interface CursorPage {
  pageSize: number;
  /** Undefined on page 1 (the un-cursored request). */
  cursor?: string;
}

export interface CursorStack {
  /** Cursor for the current page; undefined on page 1. */
  cursor: string | undefined;
  /** 1-based page number. */
  page: number;
  canPrev: boolean;
  /** Push the current page's nextCursor and move forward. */
  goNext: (nextCursor: string) => void;
  goPrev: () => void;
}

/**
 * The bare cursor stack, held in component state. `resetKey` must change
 * whenever the underlying result set can change (filters, page size) — the
 * stack silently resets to page 1 when it does.
 */
export function useCursorStack(resetKey: string): CursorStack {
  const [state, setState] = useState<{ key: string; stack: string[] }>({
    key: resetKey,
    stack: [],
  });
  const stack = state.key === resetKey ? state.stack : [];
  return {
    cursor: stack.at(-1),
    page: stack.length + 1,
    canPrev: stack.length > 0,
    goNext: (nextCursor) =>
      setState({ key: resetKey, stack: [...stack, nextCursor] }),
    goPrev: () => setState({ key: resetKey, stack: stack.slice(0, -1) }),
  };
}

export interface CursorPagination extends CursorStack {
  pageSize: number;
  /** Persisted in the URL (`pageSize`) like the filters; resets to page 1. */
  setPageSize: (size: number) => void;
  /** Stack identity — feed to useRetainedTotal so totals reset with it. */
  resetKey: string;
}

/**
 * URL-aware pagination for list pages: the page size lives in the `pageSize`
 * search param (like the filters), the cursor stack in component state.
 * `filterKey` must uniquely encode the active filters (JSON.stringify of the
 * filters object is fine).
 */
export function useCursorPagination(filterKey: string): CursorPagination {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = Number(searchParams.get("pageSize"));
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(raw)
    ? raw
    : DEFAULT_PAGE_SIZE;
  const resetKey = `${filterKey}|${pageSize}`;
  const stack = useCursorStack(resetKey);

  const setPageSize = (size: number) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (size === DEFAULT_PAGE_SIZE) next.delete("pageSize");
        else next.set("pageSize", String(size));
        return next;
      },
      { replace: true },
    );
  };

  return { ...stack, pageSize, setPageSize, resetKey };
}

/**
 * meta.total is only sent on the first (un-cursored) page — remember it while
 * walking deeper so "x–y of N" keeps its N. Forgotten when resetKey changes.
 */
export function useRetainedTotal(
  resetKey: string,
  isFirstPage: boolean,
  totalFromMeta: number | undefined,
): number | undefined {
  const [known, setKnown] = useState<{ key: string; total: number } | null>(
    null,
  );
  useEffect(() => {
    if (isFirstPage && totalFromMeta !== undefined) {
      setKnown({ key: resetKey, total: totalFromMeta });
    }
  }, [resetKey, isFirstPage, totalFromMeta]);
  if (isFirstPage) return totalFromMeta;
  return known !== null && known.key === resetKey ? known.total : undefined;
}

/** nextCursor is null (or absent) on the last page (04 §1). */
export function hasNextPage(collection: Collection<unknown> | undefined): boolean {
  return collection !== undefined && collection.meta.nextCursor != null;
}
