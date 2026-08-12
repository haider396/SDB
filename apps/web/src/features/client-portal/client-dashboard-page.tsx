/**
 * /client — the client dashboard (04 §12, 01 §3 J3/J6).
 *
 * Pending actions come FIRST: briefs awaiting THIS caller's principal
 * approval and presented candidates awaiting review, each linking straight
 * to the work. Then requisition summary cards with the client-visible stage
 * strip, then a recent-activity feed. Brand-new clients (one requisition,
 * nothing presented) get a reassuring "being reviewed" empty state.
 */
import {
  ArrowRight,
  CalendarClock,
  History,
  Hourglass,
  Plus,
  ShieldCheck,
  UserSearch,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ClientDashboardRequisition, EntityEvent } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { daysSince, formatDateTime, formatRelative, humanizeKey } from "@/lib/format";
import { useMe } from "@/lib/permissions";
import { useClientDashboard } from "./api";
import { ClientStatusBadgePill } from "./components/client-stage-tracker";
import { StageCountStrip, totalCandidates } from "./components/stage-count-strip";

function RequisitionSummaryCard({
  requisition,
}: {
  requisition: ClientDashboardRequisition;
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
        <StageCountStrip stageCounts={requisition.stageCounts} />
        <p className="text-xs tabular-nums text-neutral-500">
          Submitted {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}
        </p>
      </CardContent>
    </Card>
  );
}

function RecentActivity({ events }: { events: EntityEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Activity on your requisitions will appear here.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="border-l-2 border-border-default pl-3">
          <p className="text-sm font-medium text-brand-navy-ink">
            {humanizeKey(event.eventType)}
          </p>
          <p className="text-xs text-neutral-500">
            <time
              dateTime={event.occurredAt}
              title={formatDateTime(event.occurredAt)}
            >
              {formatRelative(event.occurredAt)}
            </time>
          </p>
        </li>
      ))}
    </ol>
  );
}

export function ClientDashboardPage() {
  const { data: me } = useMe();
  const dashboardQuery = useClientDashboard();

  const firstName = me?.user.fullName.split(" ")[0] ?? "";
  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Dashboard" }]}
      title={firstName === "" ? "Welcome back" : `Welcome back, ${firstName}`}
      subtitle="Your hiring at a glance"
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

  if (dashboardQuery.isLoading) {
    return (
      <>
        {header}
        <LoadingSkeleton variant="card" rows={3} label="Loading your dashboard…" />
      </>
    );
  }
  if (dashboardQuery.isError) {
    return (
      <>
        {header}
        <ErrorState
          error={dashboardQuery.error}
          onRetry={() => void dashboardQuery.refetch()}
        />
      </>
    );
  }
  const dashboard = dashboardQuery.data;
  if (dashboard === undefined) return header;

  const { principalApprovals, candidatesAwaitingReview } =
    dashboard.pendingActions;
  const pendingCount = principalApprovals.length + candidatesAwaitingReview.length;

  // Brand-new client: requisitions exist but nothing has happened yet.
  const isBrandNew =
    pendingCount === 0 &&
    dashboard.requisitions.length > 0 &&
    dashboard.requisitions.every(
      (requisition) => totalCandidates(requisition.stageCounts) === 0,
    );

  return (
    <>
      {header}
      <div className="space-y-8">
        {/* ----- Pending actions FIRST ----- */}
        {pendingCount > 0 ? (
          <section aria-labelledby="pending-actions-heading">
            <h2
              id="pending-actions-heading"
              className="mb-3 text-lg font-semibold tracking-tight text-brand-navy-ink"
            >
              Needs your attention
            </h2>
            <ul className="space-y-3">
              {principalApprovals.map((item) => (
                <li key={item.requisitionId}>
                  <Card className="border border-warning">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <ShieldCheck
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-warning-text"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-brand-navy-ink">
                          Brief awaiting your approval
                        </p>
                        <p className="truncate text-xs text-neutral-500">
                          {item.advertisedTitle ?? "Untitled role"} ·{" "}
                          <span className="font-mono">{item.reference}</span> ·
                          waiting {formatRelative(item.since).replace(" ago", "")}
                        </p>
                      </div>
                      <Button asChild size="sm">
                        <Link to={`/client/requisitions/${item.requisitionId}`}>
                          Review brief
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              ))}
              {candidatesAwaitingReview.map((item) => (
                <li key={item.assignmentId}>
                  <Card className="border border-info">
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <UserSearch
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-info"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-brand-navy-ink">
                          {item.displayName} is ready for your review
                        </p>
                        <p className="truncate text-xs text-neutral-500">
                          <span className="font-mono">
                            {item.requisitionReference}
                          </span>
                          {item.presentedAt !== null
                            ? ` · presented ${formatRelative(item.presentedAt)}`
                            : ""}
                        </p>
                      </div>
                      <Button asChild size="sm">
                        <Link
                          to={`/client/requisitions/${item.requisitionId}#candidates`}
                        >
                          Review candidate
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ----- Brand-new client reassurance ----- */}
        {isBrandNew ? (
          <EmptyState
            icon={Hourglass}
            title="Your hire request is being reviewed"
            description="Our team is reviewing your brief and lining up the search. You will see candidates here the moment they are ready — no action needed from you yet."
          />
        ) : null}

        {/* ----- Requisitions ----- */}
        <section aria-labelledby="dashboard-requisitions-heading">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2
              id="dashboard-requisitions-heading"
              className="text-lg font-semibold tracking-tight text-brand-navy-ink"
            >
              Your requisitions
            </h2>
            <Link
              to="/client/requisitions"
              className="text-sm font-medium text-brand-blue hover:underline"
            >
              View all
            </Link>
          </div>
          {dashboard.requisitions.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No requisitions yet"
              description="When you request a hire, it appears here with live progress and candidates to review."
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
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {dashboard.requisitions.map((requisition) => (
                <RequisitionSummaryCard
                  key={requisition.id}
                  requisition={requisition}
                />
              ))}
            </div>
          )}
        </section>

        {/* ----- Recent activity ----- */}
        <section aria-labelledby="recent-activity-heading">
          <h2
            id="recent-activity-heading"
            className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight text-brand-navy-ink"
          >
            <History aria-hidden="true" className="h-4 w-4 text-neutral-500" />
            Recent activity
          </h2>
          <Card>
            <CardContent className="p-5">
              <RecentActivity events={dashboard.recentEvents} />
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
