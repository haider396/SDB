/**
 * /admin/requisitions — every open role across all clients (05 §4.1 dense
 * table). Filters: status, client, search — held in the URL so back-
 * navigation restores them.
 *
 * The budget column only exists when at least one loaded row carries the
 * commercial keys: for callers without requisition.view_commercials the API
 * omits the keys entirely (AC-RQ-06), and the table must not render an
 * always-empty column, let alone crash.
 */
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Requisition, RequisitionStatus } from "@sdb/contracts";
import { RequisitionStatusSchema } from "@sdb/contracts";
import {
  DataTable,
  type DataTableColumnMeta,
} from "@/components/patterns/data-table";
import { MoneyFigure } from "@/components/patterns/money-figure";
import { PageHeader } from "@/components/patterns/page-header";
import {
  REQUISITION_STATUS_META,
  RequisitionStatusBadge,
} from "@/components/patterns/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiFetchCollection } from "@/lib/api-client";
import { daysSince, budgetParts, formatDate } from "@/lib/format";
import {
  hasNextPage,
  useCursorPagination,
  useRetainedTotal,
} from "@/lib/use-cursor-pagination";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useRequisitions, type RequisitionListFilters } from "./api";

function meta(value: DataTableColumnMeta): DataTableColumnMeta {
  return value;
}

/**
 * Best available "in this status since" instant given the list payload:
 * status-specific timestamps where they exist, updatedAt otherwise.
 */
export function statusSince(requisition: Requisition): string {
  switch (requisition.status) {
    case "submitted":
      return requisition.submittedAt;
    case "sourcing":
      return requisition.sourcingStartedAt ?? requisition.updatedAt;
    case "placed":
    case "closed_unfilled":
      return requisition.closedAt ?? requisition.updatedAt;
    default:
      return requisition.updatedAt;
  }
}

const baseColumns: ColumnDef<Requisition, unknown>[] = [
  {
    id: "reference",
    accessorKey: "reference",
    header: "Reference",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-neutral-500">
        {row.original.reference}
      </span>
    ),
  },
  {
    id: "clientName",
    accessorKey: "clientName",
    header: "Client",
    cell: ({ row }) => row.original.clientName,
  },
  {
    id: "advertisedTitle",
    accessorKey: "advertisedTitle",
    header: "Role",
    cell: ({ row }) => (
      <span className="font-medium text-brand-navy-ink">
        {row.original.advertisedTitle ?? "Untitled role"}
      </span>
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <RequisitionStatusBadge status={row.original.status} />,
  },
  {
    id: "headcount",
    accessorKey: "headcount",
    header: "Headcount",
    meta: meta({ numeric: true }),
    cell: ({ row }) => row.original.headcount,
  },
];

const budgetColumn: ColumnDef<Requisition, unknown> = {
  id: "budget",
  accessorFn: (row) => row.budgetMin ?? row.budgetMax ?? null,
  header: "Budget",
  meta: meta({ numeric: true }),
  cell: ({ row }) => (
    <MoneyFigure
      parts={budgetParts({
        budgetMin: row.original.budgetMin ?? null,
        budgetMax: row.original.budgetMax ?? null,
        budgetCurrency: row.original.budgetCurrency ?? null,
        budgetUnit: row.original.budgetUnit ?? null,
      })}
    />
  ),
};

const trailingColumns: ColumnDef<Requisition, unknown>[] = [
  {
    id: "submittedAt",
    accessorKey: "submittedAt",
    header: "Submitted",
    meta: meta({ numeric: true }),
    cell: ({ row }) => formatDate(row.original.submittedAt),
  },
  {
    id: "daysInStatus",
    accessorFn: (row) => daysSince(statusSince(row)),
    header: "Days in status",
    meta: meta({ numeric: true }),
    cell: ({ row }) => daysSince(statusSince(row.original)),
  },
];

interface ClientOption {
  id: string;
  companyName: string;
}

/** Lightweight client list for the filter select (admin-only endpoint). */
function useClientOptions() {
  return useQuery<ClientOption[]>({
    queryKey: ["clients", "options"],
    queryFn: async () => {
      const { data } = await apiFetchCollection<ClientOption>("/clients", {
        query: { limit: 100 },
      });
      return data.map((client) => ({
        id: client.id,
        companyName: client.companyName,
      }));
    },
    staleTime: 60_000,
  });
}

export function RequisitionsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedStatus = RequisitionStatusSchema.safeParse(
    searchParams.get("status"),
  );
  const status: RequisitionStatus | undefined = parsedStatus.success
    ? parsedStatus.data
    : undefined;
  const clientId = searchParams.get("clientId") ?? undefined;

  const [searchInput, setSearchInput] = useState(
    searchParams.get("search") ?? "",
  );
  const search = useDebouncedValue(searchInput.trim());

  const filters: RequisitionListFilters = {
    status,
    clientId,
    search: search === "" ? undefined : search,
  };
  // Any filter (or page-size) change discards the cursor stack → page 1.
  const pager = useCursorPagination(JSON.stringify(filters));
  const query = useRequisitions(filters, {
    pageSize: pager.pageSize,
    cursor: pager.cursor,
  });
  // meta.total arrives on the first page only; keep it while paginating.
  const totalCount = useRetainedTotal(
    pager.resetKey,
    pager.cursor === undefined,
    query.data?.meta.total,
  );
  const clientOptions = useClientOptions();

  const rows = useMemo(() => query.data?.data ?? [], [query.data]);

  // Commercial keys are ABSENT without requisition.view_commercials
  // (AC-RQ-06) — only show the column when the payload carries them.
  const hasCommercials = useMemo(
    () => rows.some((row) => "budgetMin" in row),
    [rows],
  );
  const columns = useMemo(
    () =>
      hasCommercials
        ? [...baseColumns, budgetColumn, ...trailingColumns]
        : [...baseColumns, ...trailingColumns],
    [hasCommercials],
  );

  const setParam = (key: string, value: string | null) => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const hasFilters =
    status !== undefined || clientId !== undefined || search !== "";

  return (
    // Full-height column: header + filters stay fixed, the table scrolls.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Admin", to: "/admin" },
          { label: "Requisitions" },
        ]}
        title="Requisitions"
        subtitle="Every open role across all clients"
      />

      <div className="mb-4 grid shrink-0 items-end gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
        {/* The search box gets two tracks (full width below sm) — one 11rem
            auto-fill track is too narrow for "Reference or role…". */}
        <div className="col-span-full space-y-1.5 sm:col-span-2">
          <Label htmlFor="requisitions-search">Search</Label>
          <Input
            id="requisitions-search"
            type="search"
            placeholder="Reference or role…"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setParam("search", event.target.value.trim());
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="requisitions-status">Status</Label>
          <NativeSelect
            id="requisitions-status"
            value={status ?? ""}
            onChange={(event) => setParam("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {RequisitionStatusSchema.options.map((value) => (
              <option key={value} value={value}>
                {REQUISITION_STATUS_META[value].label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="requisitions-client">Client</Label>
          <NativeSelect
            id="requisitions-client"
            value={clientId ?? ""}
            onChange={(event) => setParam("clientId", event.target.value)}
          >
            <option value="">All clients</option>
            {(clientOptions.data ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.companyName}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        label="Requisitions"
        isLoading={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{
          icon: ClipboardList,
          title: "No requisitions",
          description: hasFilters
            ? "No requisitions match these filters. Clear them to see the full list."
            : "Requisitions appear here when a prospect submits the intake form.",
        }}
        getRowHref={(requisition) => `/admin/requisitions/${requisition.id}`}
        pagination={{
          page: pager.page,
          pageSize: pager.pageSize,
          onPageSizeChange: pager.setPageSize,
          hasPrev: pager.canPrev,
          hasNext: hasNextPage(query.data),
          onPrev: pager.goPrev,
          onNext: () => {
            const next = query.data?.meta.nextCursor;
            if (next != null) pager.goNext(next);
          },
          isFetching: query.isFetching,
        }}
        totalCount={totalCount}
      />
    </div>
  );
}
