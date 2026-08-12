/**
 * Reusable dense data table (05 §4.1: 40 px rows, 14 px text, tabular
 * numerals) built on TanStack Table 8 in headless mode.
 *
 * - Sorting is client-side over the loaded pages; sortable headers are real
 *   buttons and the <th> carries aria-sort (05 §4.6)
 * - Cursor pagination surfaces as a "Load more" button (04 §1 nextCursor)
 * - All four states are wired here once: skeleton (matching row count),
 *   empty, error (requestId + retry), success (AC-UI-02)
 * - Rows navigate on click AND on Enter/Space with the row focused, so the
 *   table stays keyboard operable without per-cell links
 */
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, type EmptyStateProps } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Per-column presentation hints, carried on TanStack's `meta`. */
export interface DataTableColumnMeta {
  /** Right-align and use tabular numerals (AC-UI-06). */
  numeric?: boolean;
  /** Extra classes for both the header and its cells (e.g. width). */
  className?: string;
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Accessible name for the table. */
  label: string;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: EmptyStateProps;
  /** Row → destination; makes rows clickable and keyboard-activatable. */
  getRowHref?: (row: TData) => string;
  /** Cursor pagination (04 §1). Hidden when there is no next page. */
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  /** Initial hidden/visible columns, keyed by column id. */
  initialColumnVisibility?: VisibilityState;
  /** Skeleton row count matching the expected final layout (05 §4.3). */
  skeletonRows?: number;
  /** Optional caption/footer line under the table (e.g. result counts). */
  footer?: ReactNode;
}

export function DataTable<TData>({
  columns,
  data,
  label,
  isLoading,
  isError,
  error,
  onRetry,
  empty,
  getRowHref,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  initialColumnVisibility,
  skeletonRows = 8,
  footer,
}: DataTableProps<TData>) {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialColumnVisibility ?? {},
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    // First click always sorts ascending, numeric columns included —
    // predictable cycling: none → asc → desc.
    sortDescFirst: false,
  });

  if (isLoading) {
    return (
      <LoadingSkeleton variant="list" rows={skeletonRows} label={`Loading ${label}…`} />
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  if (data.length === 0) {
    return <EmptyState {...empty} />;
  }

  const activateRow = (row: TData) => {
    if (getRowHref) navigate(getRowHref(row));
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: TData) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateRow(row);
    }
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-lg bg-surface-raised shadow-sm">
        <table className="w-full border-collapse text-sm" aria-label={label}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border-default">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    | DataTableColumnMeta
                    | undefined;
                  const sortDirection = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sortDirection === "asc"
                          ? "ascending"
                          : sortDirection === "desc"
                            ? "descending"
                            : canSort
                              ? "none"
                              : undefined
                      }
                      className={cn(
                        "h-10 whitespace-nowrap px-4 text-left text-xs font-semibold uppercase tracking-tight text-neutral-500",
                        meta?.numeric && "text-right",
                        meta?.className,
                      )}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm uppercase hover:text-neutral-800",
                            meta?.numeric && "flex-row-reverse",
                          )}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {sortDirection === "asc" ? (
                            <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                          ) : sortDirection === "desc" ? (
                            <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpDown
                              aria-hidden="true"
                              className="h-3.5 w-3.5 opacity-50"
                            />
                          )}
                          <span className="sr-only">
                            {sortDirection === "asc"
                              ? ", sorted ascending"
                              : sortDirection === "desc"
                                ? ", sorted descending"
                                : ", not sorted"}
                          </span>
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border-default last:border-b-0",
                  getRowHref &&
                    "cursor-pointer transition-colors duration-fast hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue",
                )}
                tabIndex={getRowHref ? 0 : undefined}
                onClick={getRowHref ? () => activateRow(row.original) : undefined}
                onKeyDown={
                  getRowHref
                    ? (event) => onRowKeyDown(event, row.original)
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta as
                    | DataTableColumnMeta
                    | undefined;
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "h-10 whitespace-nowrap px-4 text-neutral-800",
                        meta?.numeric && "text-right tabular-nums",
                        meta?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer !== undefined ? (
        <div className="mt-2 text-xs text-neutral-500">{footer}</div>
      ) : null}
      {onLoadMore && hasMore ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
