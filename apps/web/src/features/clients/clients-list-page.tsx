/**
 * /admin/clients — dense client list (05 §4.1) with status/search/pending-
 * access filters held in the URL so back-navigation restores them. Rows
 * navigate to the client detail workspace.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Check, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Client, ClientStatus } from "@sdb/contracts";
import { ClientStatusSchema } from "@sdb/contracts";
import { ClientStatusBadge } from "@/components/patterns/status-badge";
import { DataTable, type DataTableColumnMeta } from "@/components/patterns/data-table";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate, SERVICE_TIER_LABELS } from "@/lib/format";
import { useCan } from "@/lib/permissions";
import {
  hasNextPage,
  useCursorPagination,
  useRetainedTotal,
} from "@/lib/use-cursor-pagination";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useClients, type ClientListFilters } from "./api";
import { NewClientDialog } from "./components/new-client-dialog";

const CLIENT_STATUSES = ClientStatusSchema.options;

const STATUS_FILTER_LABELS: Record<ClientStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

function meta(value: DataTableColumnMeta): DataTableColumnMeta {
  return value;
}

const columns: ColumnDef<Client, unknown>[] = [
  {
    id: "companyName",
    accessorKey: "companyName",
    header: "Company",
    cell: ({ row }) => (
      <span className="font-medium text-brand-navy-ink">
        {row.original.companyName}
      </span>
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <ClientStatusBadge status={row.original.status} />,
  },
  {
    id: "serviceTier",
    accessorKey: "serviceTier",
    header: "Service tier",
    cell: ({ row }) =>
      row.original.serviceTier === null
        ? "—"
        : SERVICE_TIER_LABELS[row.original.serviceTier],
  },
  {
    // The onboarding funnel in one cell: awaiting payment → payment
    // confirmed → portal live. The two date columns it replaces told the
    // same story in twice the width.
    id: "onboarding",
    accessorFn: (row) =>
      row.portalAccessEnabledAt !== null
        ? 2
        : row.paymentConfirmedAt !== null
          ? 1
          : 0,
    header: "Onboarding",
    cell: ({ row }) =>
      row.original.portalAccessEnabledAt !== null ? (
        <span className="inline-flex items-center gap-1 text-success-text">
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
          Portal live {formatDate(row.original.portalAccessEnabledAt)}
        </span>
      ) : row.original.paymentConfirmedAt !== null ? (
        <span className="inline-flex items-center gap-1 text-neutral-800">
          <Check aria-hidden="true" className="h-3.5 w-3.5 text-success-text" />
          Payment confirmed {formatDate(row.original.paymentConfirmedAt)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-neutral-500">
          <Minus aria-hidden="true" className="h-3.5 w-3.5" />
          Awaiting payment
        </span>
      ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    meta: meta({ numeric: true }),
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

export function ClientsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const parsedStatus = ClientStatusSchema.safeParse(statusParam);
  const status: ClientStatus | undefined = parsedStatus.success
    ? parsedStatus.data
    : undefined;
  const hasPendingAccess = searchParams.get("pendingAccess") === "true";

  const [searchInput, setSearchInput] = useState(
    searchParams.get("search") ?? "",
  );
  const search = useDebouncedValue(searchInput.trim());

  const filters: ClientListFilters = {
    status,
    search: search === "" ? undefined : search,
    hasPendingAccess: hasPendingAccess || undefined,
  };
  // Any filter (or page-size) change discards the cursor stack → page 1.
  const pager = useCursorPagination(JSON.stringify(filters));
  const query = useClients(filters, {
    pageSize: pager.pageSize,
    cursor: pager.cursor,
  });
  // meta.total arrives on the first page only; keep it while paginating.
  const totalCount = useRetainedTotal(
    pager.resetKey,
    pager.cursor === undefined,
    query.data?.meta.total,
  );
  // POST /clients requires client.create — offer the action only then.
  const { allowed: canCreate } = useCan("client.create");
  const [isNewOpen, setIsNewOpen] = useState(false);

  const rows = useMemo(() => query.data?.data ?? [], [query.data]);

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

  return (
    // Full-height column: header + filters stay fixed, the table scrolls.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Clients" }]}
        title="Clients"
        subtitle="Client companies, members, and portal access"
        actions={
          canCreate ? (
            <Button onClick={() => setIsNewOpen(true)}>
              <Plus aria-hidden="true" />
              New client
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex shrink-0 flex-wrap items-end gap-4">
        <div className="w-64 space-y-1.5">
          <Label htmlFor="clients-search">Search</Label>
          <Input
            id="clients-search"
            type="search"
            placeholder="Company name…"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setParam("search", event.target.value.trim());
            }}
          />
        </div>
        <div className="w-48 space-y-1.5">
          <Label htmlFor="clients-status">Status</Label>
          <NativeSelect
            id="clients-status"
            value={status ?? ""}
            onChange={(event) => setParam("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {CLIENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_FILTER_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label
          htmlFor="clients-pending-access"
          className="flex h-9 cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
        >
          <input
            id="clients-pending-access"
            type="checkbox"
            className="h-4 w-4 accent-current"
            checked={hasPendingAccess}
            onChange={(event) =>
              setParam("pendingAccess", event.target.checked ? "true" : null)
            }
          />
          Pending access only
        </label>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        label="Clients"
        isLoading={query.isPending}
        isError={query.isError}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={{
          icon: Building2,
          title: "No clients yet",
          description:
            search !== "" || status !== undefined || hasPendingAccess
              ? "No clients match these filters. Clear them to see the full list."
              : "Clients appear here when a prospect submits the intake form, ready for payment confirmation and portal access.",
        }}
        getRowHref={(client) => `/admin/clients/${client.id}`}
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

      <NewClientDialog open={isNewOpen} onClose={() => setIsNewOpen(false)} />
    </div>
  );
}
