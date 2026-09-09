/**
 * /client/requisitions — every role the client has open (04 §7; the list is
 * implicitly tenant-scoped server-side, no clientId ever sent).
 *
 * Candidate stage counts come from the dashboard payload (the list endpoint
 * carries none). If the dashboard call fails while the list succeeds, the
 * cards render without counts and the gap is flagged inline — the 05 §4.3
 * "partial" state, not a full-page error.
 */
import { ClipboardList, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import type { ClientDashboardRequisition, Requisition } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PriorityChip } from "@/components/patterns/priority-chip";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useUiStore, type PositionGroupBy } from "@/stores/ui-store";
import { daysSince } from "@/lib/format";
import {
  useClientDashboard,
  useClientRequisitions,
  useDepartmentLabels,
} from "./api";
import { GROUP_BY_OPTIONS, groupPositions } from "./grouping";
import { ClientStatusBadgePill } from "./components/client-stage-tracker";
import { StageCountStrip } from "./components/stage-count-strip";

function RequisitionCard({
  requisition,
  stageCounts,
}: {
  requisition: Requisition;
  stageCounts: ClientDashboardRequisition["stageCounts"] | undefined;
}) {
  const days = daysSince(requisition.submittedAt);
  return (
    <Card className="group relative motion-safe:transition-shadow motion-safe:duration-fast hover:shadow-md">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              to={`/client/requisitions/${requisition.publicId}`}
              className="text-base font-semibold text-brand-navy-ink after:absolute after:inset-0 group-hover:text-brand-blue group-hover:underline"
            >
              {requisition.advertisedTitle ?? "Untitled role"}
            </Link>
          </div>
          {/* Priority first: it is the thing Rebecca asked to see at a glance
              (39:18, "seen on the card, preview card"). `normal` renders
              nothing, so most cards show only the status pill. */}
          <PriorityChip priority={requisition.priority} size="sm" />
          <ClientStatusBadgePill status={requisition.status} />
        </div>
        {stageCounts !== undefined ? (
          <StageCountStrip
            stageCounts={stageCounts}
            sourcingSince={
              requisition.status === "sourcing"
                ? requisition.sourcingStartedAt ?? requisition.submittedAt
                : undefined
            }
          />
        ) : null}
        <p className="text-xs tabular-nums text-neutral-500">
          Opened {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}
        </p>
      </CardContent>
    </Card>
  );
}

export function ClientRequisitionsPage() {
  const requisitionsQuery = useClientRequisitions();
  // Counts only — a failure here degrades to cards without strips.
  const dashboardQuery = useClientDashboard();
  // Labels only — a failure here degrades to an "Other" heading, never a
  // missing position.
  const departmentLabelsQuery = useDepartmentLabels();

  const groupBy = useUiStore((state) => state.positionGroupBy);
  const setGroupBy = useUiStore((state) => state.setPositionGroupBy);

  const countsById = new Map(
    (dashboardQuery.data?.requisitions ?? []).map((entry) => [
      entry.id,
      entry.stageCounts,
    ]),
  );

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Dashboard", to: "/client" }, { label: "My placements" }]}
      title="My placements"
      subtitle="Track every role you have open with us"
      actions={
        <Button asChild>
          <Link to="/client/requisitions/new">
            <Plus aria-hidden="true" />
            Request another hire
          </Link>
        </Button>
      }
    />
  );

  if (requisitionsQuery.isLoading) {
    return (
      <>
        {header}
        <LoadingSkeleton variant="card" rows={3} label="Loading your placements…" />
      </>
    );
  }
  if (requisitionsQuery.isError) {
    return (
      <>
        {header}
        <ErrorState
          error={requisitionsQuery.error}
          onRetry={() => void requisitionsQuery.refetch()}
        />
      </>
    );
  }
  const requisitions = requisitionsQuery.data ?? [];
  // Grouping is a pure transform of a list already held in memory — this list
  // is NOT paginated (see grouping.ts for why that matters), so no request.
  const groups = groupPositions(
    requisitions,
    groupBy,
    departmentLabelsQuery.data ?? {},
  );

  return (
    <>
      {header}
      {requisitions.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No placements yet"
          description="Request a hire and it will appear here with live progress, the brief, and candidates to review."
          action={
            <Button asChild>
              <Link to="/client/requisitions/new">
                <Plus aria-hidden="true" />
                Request a hire
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {dashboardQuery.isError ? (
            <p className="text-xs text-neutral-500">
              Candidate counts are unavailable right now — everything else is
              up to date.
            </p>
          ) : null}

          {/* Rebecca, 38:40: "let's think about what this looks like when
              they're hiring for 15 positions… sorted at the top based on
              alphabetical department… And Priority." */}
          <div className="flex items-center justify-end gap-2">
            <Label htmlFor="group-positions" className="text-xs text-neutral-600">
              Group by
            </Label>
            <NativeSelect
              id="group-positions"
              className="w-44"
              value={groupBy}
              onChange={(event) =>
                setGroupBy(event.target.value as PositionGroupBy)
              }
            >
              {GROUP_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <p aria-live="polite" className="sr-only">
            {groupBy === "none"
              ? `${requisitions.length} placements, not grouped.`
              : `Grouped by ${groupBy}, ${groups.length} group${groups.length === 1 ? "" : "s"}.`}
          </p>

          {groups.map((group) => (
            // Each group is its own section so a screen-reader user can move
            // between departments by heading rather than hearing fifteen cards
            // as one run.
            <section
              key={group.key}
              aria-labelledby={group.label === "" ? undefined : `group-${group.key}`}
              className="space-y-3"
            >
              {group.label === "" ? null : (
                <h2
                  id={`group-${group.key}`}
                  className="text-sm font-semibold tracking-tight text-neutral-600"
                >
                  {group.label}{" "}
                  <span className="font-normal tabular-nums text-neutral-400">
                    ({group.positions.length})
                  </span>
                </h2>
              )}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {group.positions.map((requisition) => (
                  <RequisitionCard
                    key={requisition.id}
                    requisition={requisition}
                    stageCounts={countsById.get(requisition.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
