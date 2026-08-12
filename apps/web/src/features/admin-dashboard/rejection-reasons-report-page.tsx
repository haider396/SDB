/**
 * /admin/reports/rejection-reasons (04 §12, AC-PL-15): grouped rejection
 * counts split by actor over a required date range, with role-category and
 * actor filters, expandable free-text "Other" groups, and a client-side CSV
 * export. Table + inline bars — Recharts is reserved for /admin/stats
 * (05 §1), so the bars here are plain CSS on token colours.
 */
import { useId, useState } from "react";
import { ChevronDown, ChevronRight, Download, PieChart } from "lucide-react";
import type { RejectionActor } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/format";
import { useRejectionReasonsReport, useRoleCategories } from "./api";
import { ACTOR_LABELS } from "./labels";
import {
  buildRejectionReasonsCsv,
  dayEndIso,
  dayStartIso,
  defaultReportRange,
  groupReasons,
  type ReasonGroup,
} from "./rejection-reasons-report";

const ACTOR_BAR_CLASS: Record<RejectionActor, string> = {
  client: "bg-brand-blue",
  admin: "bg-warning",
};

function ActorBar({
  actor,
  count,
  max,
}: {
  actor: RejectionActor;
  count: number;
  max: number;
}) {
  const width = max === 0 ? 0 : Math.round((count / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-right text-sm tabular-nums text-neutral-800">
        {count}
      </span>
      <div aria-hidden="true" className="h-2 flex-1 rounded-full bg-neutral-100">
        <div
          className={`h-2 rounded-full ${ACTOR_BAR_CLASS[actor]}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function ReasonRow({ group, max }: { group: ReasonGroup; max: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const detailsId = useId();
  const otherTexts = [
    ...group.otherTextsByActor.client.map(
      (text) => ({ actor: "client" as const, text }),
    ),
    ...group.otherTextsByActor.admin.map(
      (text) => ({ actor: "admin" as const, text }),
    ),
  ];
  const hasTexts = otherTexts.length > 0;

  return (
    <>
      <tr className="border-b border-neutral-100">
        <th scope="row" className="py-2.5 pr-4 text-left align-top">
          {hasTexts ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              onClick={() => setIsExpanded((open) => !open)}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-navy-ink hover:text-brand-blue"
            >
              {isExpanded ? (
                <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
              )}
              {group.label}
            </button>
          ) : (
            <span className="text-sm font-medium text-brand-navy-ink">
              {group.label}
            </span>
          )}
        </th>
        <td className="w-1/4 py-2.5 pr-4 align-middle">
          <ActorBar actor="client" count={group.countByActor.client} max={max} />
        </td>
        <td className="w-1/4 py-2.5 pr-4 align-middle">
          <ActorBar actor="admin" count={group.countByActor.admin} max={max} />
        </td>
        <td className="w-16 py-2.5 text-right align-middle text-sm font-semibold tabular-nums text-brand-navy-ink">
          {group.total}
        </td>
      </tr>
      {hasTexts && isExpanded ? (
        <tr className="border-b border-neutral-100 bg-surface-subtle">
          <td colSpan={4} className="px-4 py-2.5" id={detailsId}>
            <ul className="space-y-1">
              {otherTexts.map((entry, index) => (
                <li key={index} className="flex gap-2 text-sm text-neutral-600">
                  <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                    {ACTOR_LABELS[entry.actor]}
                  </span>
                  <span className="min-w-0">{entry.text}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function RejectionReasonsReportPage() {
  const [{ fromDay: defaultFrom, toDay: defaultTo }] = useState(() =>
    defaultReportRange(),
  );
  const [fromDay, setFromDay] = useState(defaultFrom);
  const [toDay, setToDay] = useState(defaultTo);
  const [actor, setActor] = useState<"" | RejectionActor>("");
  const [roleCategoryId, setRoleCategoryId] = useState("");

  const hasRange = fromDay !== "" && toDay !== "";
  const query = useRejectionReasonsReport({
    from: dayStartIso(fromDay || defaultFrom),
    to: dayEndIso(toDay || defaultTo),
    ...(actor === "" ? {} : { actor }),
    ...(roleCategoryId === "" ? {} : { roleCategoryId }),
  });
  const roleCategories = useRoleCategories();

  const exportCsv = () => {
    if (query.data === undefined) return;
    const blob = new Blob([buildRejectionReasonsCsv(query.data)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rejection-reasons_${fromDay}_${toDay}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Rejection reasons" }]}
      title="Rejection reasons"
      subtitle="Why candidates are rejected, split by who rejected them"
      actions={
        <Button
          variant="secondary"
          onClick={exportCsv}
          disabled={query.data === undefined || query.data.rows.length === 0}
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          Export CSV
        </Button>
      }
    />
  );

  const groups = query.data === undefined ? [] : groupReasons(query.data.rows);
  const maxCount = groups.reduce(
    (max, group) =>
      Math.max(max, group.countByActor.client, group.countByActor.admin),
    0,
  );

  return (
    <div>
      {header}

      <form
        aria-label="Report filters"
        className="mb-6 flex flex-wrap items-end gap-4 rounded-lg bg-surface-raised p-4 shadow-xs"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="space-y-1.5">
          <Label htmlFor="report-from">From</Label>
          <Input
            id="report-from"
            type="date"
            required
            value={fromDay}
            onChange={(event) => setFromDay(event.target.value)}
            aria-invalid={fromDay === ""}
            className="w-40"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-to">To</Label>
          <Input
            id="report-to"
            type="date"
            required
            value={toDay}
            onChange={(event) => setToDay(event.target.value)}
            aria-invalid={toDay === ""}
            className="w-40"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-actor">Rejected by</Label>
          <NativeSelect
            id="report-actor"
            value={actor}
            onChange={(event) =>
              setActor(event.target.value as "" | RejectionActor)
            }
            className="w-40"
          >
            <option value="">All actors</option>
            <option value="client">Client</option>
            <option value="admin">Admin</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-role-category">Role category</Label>
          <NativeSelect
            id="report-role-category"
            value={roleCategoryId}
            onChange={(event) => setRoleCategoryId(event.target.value)}
            className="w-56"
          >
            <option value="">All role categories</option>
            {(roleCategories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {!hasRange ? (
          <p role="alert" className="text-sm text-danger-text">
            Both From and To dates are required.
          </p>
        ) : null}
      </form>

      {query.isPending ? (
        <LoadingSkeleton variant="list" rows={6} label="Loading the report…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={PieChart}
          title="No rejections in this range"
          description="Widen the date range or clear the filters to see rejection reasons."
        />
      ) : (
        <div className="rounded-lg bg-surface-raised p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-neutral-600">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full bg-brand-blue"
              />
              Rejected by client
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full bg-warning"
              />
              Rejected by admin
            </span>
            <span className="ml-auto tabular-nums">
              {query.data.totalCount} rejection
              {query.data.totalCount === 1 ? "" : "s"} ·{" "}
              {formatDate(query.data.from)} – {formatDate(query.data.to)}
            </span>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-200 text-xs font-medium uppercase tracking-wide text-neutral-500">
                <th scope="col" className="py-2 pr-4 text-left">
                  Reason
                </th>
                <th scope="col" className="py-2 pr-4 text-left">
                  Client
                </th>
                <th scope="col" className="py-2 pr-4 text-left">
                  Admin
                </th>
                <th scope="col" className="py-2 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <ReasonRow
                  key={`${group.reasonKey}-${group.label}`}
                  group={group}
                  max={maxCount}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
