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
import { daysSince } from "@/lib/format";
import { useClientDashboard, useClientRequisitions } from "./api";
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
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              to={`/client/requisitions/${requisition.id}`}
              className="text-base font-semibold text-brand-navy-ink hover:text-brand-blue hover:underline"
            >
              {requisition.advertisedTitle ?? "Untitled role"}
            </Link>
            <p className="font-mono text-xs text-neutral-500">
              {requisition.reference}
            </p>
          </div>
          <ClientStatusBadgePill status={requisition.status} />
        </div>
        {stageCounts !== undefined ? (
          <StageCountStrip stageCounts={stageCounts} />
        ) : null}
        <p className="text-xs tabular-nums text-neutral-500">
          Submitted {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}
        </p>
      </CardContent>
    </Card>
  );
}

export function ClientRequisitionsPage() {
  const requisitionsQuery = useClientRequisitions();
  // Counts only — a failure here degrades to cards without strips.
  const dashboardQuery = useClientDashboard();

  const countsById = new Map(
    (dashboardQuery.data?.requisitions ?? []).map((entry) => [
      entry.id,
      entry.stageCounts,
    ]),
  );

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Dashboard", to: "/client" }, { label: "My requisitions" }]}
      title="My requisitions"
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
        <LoadingSkeleton variant="card" rows={3} label="Loading your requisitions…" />
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

  return (
    <>
      {header}
      {requisitions.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No requisitions yet"
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {requisitions.map((requisition) => (
              <RequisitionCard
                key={requisition.id}
                requisition={requisition}
                stageCounts={countsById.get(requisition.id)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
