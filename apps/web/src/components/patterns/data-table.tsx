/**
 * Reusable dense data table (05 §4.1: 40 px rows, 14 px text, tabular
 * numerals) built on TanStack Table 8 in headless mode.
 *
 * - Sorting is client-side within the visible page; sortable headers are
 *   real buttons and the <th> carries aria-sort (05 §4.6)
 * - Cursor pagination surfaces as a Prev/Next footer with a page-size
 *   select (04 §1: cursors cannot jump to an arbitrary page, so the caller
 *   keeps a cursor stack — see lib/use-cursor-pagination)
 * - The rows scroll inside a viewport-bounded region with a sticky header,
 *   so page chrome (header, filters) stays fixed while data scrolls. In a
 *   non-flex parent the region simply grows with its content.
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
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, type EmptyStateProps } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { PAGE_SIZE_OPTIONS } from "@/lib/use-cursor-pagination";
import { cn } from "@/lib/utils";

/** Per-column presentation hints, carried on TanStack's `meta`. */
export interface DataTableColumnMeta {
  /** Right-align and use tabular numerals (AC-UI-06). */
  numeric?: boolean;
  /** Extra classes for both the header and its cells (e.g. width). */
  className?: string;
}

/** Controlled Prev/Next pagination over a cursor API (04 §1). */
export interface DataTablePagination {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Disables the controls while a page is in flight. */
  isFetching?: boolean;
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
  /** Prev/Next footer controls; the caller owns the cursor stack. */
  pagination?: DataTablePagination;
  /** Initial hidden/visible columns, keyed by column id. */
  initialColumnVisibility?: VisibilityState;
  /** Skeleton row count matching the expected final layout (05 §4.3). */
  skeletonRows?: number;
  /**
   * Server-reported total (meta.total, sent on the first page only). Feeds
   * the count line, the "x–y of N" range, and the page count; callers keep
   * the first page's total while paginating (useRetainedTotal).
   */
  totalCount?: number;
}

function DataTableFooter({
  pagination,
  rowCount,
  totalCount,
}: {
  pagination: DataTablePagination;
  rowCount: number;
  totalCount?: number;
}) {
  const {
    page,
    pageSize,
    onPageSizeChange,
    hasPrev,
    hasNext,
    onPrev,
    onNext,
    isFetching = false,
  } = pagination;

  const from = rowCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + rowCount;
  const pageCount =
    totalCount !== undefined
      ? Math.max(1, Math.ceil(totalCount / pageSize))
      : undefined;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-b-lg border-t border-border-default bg-surface-raised px-4 py-2 shadow-sm">
      <p className="text-sm tabular-nums text-neutral-500">
        {rowCount === 0
          ? "No rows"
          : totalCount !== undefined
            ? `${from}–${to} of ${totalCount}`
            : `${from}–${to}`}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-neutral-500">
          Rows per page
          <NativeSelect
            className="w-20"
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </NativeSelect>
        </label>
        <p className="text-sm tabular-nums text-neutral-500">
          Page {page}
          {pageCount !== undefined ? ` of ${pageCount}` : ""}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous page"
            disabled={!hasPrev || isFetching}
            onClick={onPrev}
          >
            <ChevronLeft aria-hidden="true" />
            Prev
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next page"
            disabled={!hasNext || isFetching}
            onClick={onNext}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
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
  pagination,
  initialColumnVisibility,
  skeletonRows = 8,
  totalCount,
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

  // A truly empty result set shows the empty state. An empty page deeper in
  // the pagination keeps the footer so Prev remains reachable.
  if (data.length === 0 && !(pagination?.hasPrev ?? false)) {
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex shrink-0 items-baseline justify-end">
        <p className="text-sm tabular-nums text-neutral-500">
          {totalCount !== undefined
            ? `${totalCount} total`
            : `${data.length} rows`}
        </p>
      </div>
      <div
        className={cn(
          // The one scroll container for both axes: vertical inside the
          // bounded region (sticky header), horizontal for wide tables.
          "min-h-48 flex-1 overflow-auto bg-surface-raised shadow-sm",
          pagination !== undefined ? "rounded-t-lg" : "rounded-lg",
        )}
      >
        {/* border-separate: collapsed borders detach from sticky cells. */}
        <table
          className="w-full border-separate border-spacing-0 text-sm"
          aria-label={label}
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
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
                        "sticky top-0 z-10 h-10 whitespace-nowrap border-b border-border-default bg-surface-raised px-4 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500",
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
          <tbody className="[&>tr:last-child>td]:border-b-0">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
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
                        "h-10 whitespace-nowrap border-b border-neutral-200 px-4 text-neutral-800",
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
      {pagination !== undefined ? (
        <DataTableFooter
          pagination={pagination}
          rowCount={data.length}
          totalCount={totalCount}
        />
      ) : null}
    </div>
  );
}
