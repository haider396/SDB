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
import type {
  ClientDashboardEvent,
  ClientDashboardRequisition,
} from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { daysSince, formatDateTime, formatRelative } from "@/lib/format";
import { useMe } from "@/lib/permissions";
import { useClientDashboard } from "./api";
import { clientEventSentence } from "./labels";
import { ClientStatusBadgePill } from "./components/client-stage-tracker";
import { StageCountStrip, totalCandidates } from "./components/stage-count-strip";

function RequisitionSummaryCard({
  requisition,
}: {
  requisition: ClientDashboardRequisition;
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
            <p className="font-mono text-xs text-neutral-500">
              {requisition.reference}
            </p>
          </div>
          <ClientStatusBadgePill status={requisition.status} />
        </div>
        <StageCountStrip
          stageCounts={requisition.stageCounts}
          // The dashboard payload carries no sourcingStartedAt — submittedAt
          // is the elapsed-time anchor here (UX 3.3).
          sourcingSince={
            requisition.status === "sourcing"
              ? requisition.submittedAt
              : undefined
          }
        />
        <p className="text-xs tabular-nums text-neutral-500">
          Submitted {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}
        </p>
      </CardContent>
    </Card>
  );
}

function RecentActivity({
  events,
  requisitionHref,
}: {
  events: ClientDashboardEvent[];
  /** Maps a requisition UUID to its short-public-id detail URL. */
  requisitionHref: (requisitionId: string) => string;
}) {
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
          <p className="text-sm text-neutral-800">
            <Link
              to={requisitionHref(event.entityId)}
              className="font-medium text-brand-navy-ink hover:text-brand-blue hover:underline"
            >
              {event.requisitionTitle ?? event.requisitionReference}
            </Link>
            : {clientEventSentence(event)}
            {event.actorName !== null ? (
              <span className="text-neutral-500"> by {event.actorName}</span>
            ) : null}
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

  const { principalApprovals } = dashboard.pendingActions;
  // Pending actions and events carry only requisition UUIDs; resolve them to
  // short public-id URLs via the dashboard's own requisition list. The UUID
  // fallback still routes (the API accepts both) — it is just longer.
  const publicIdById = new Map(
    dashboard.requisitions.map((requisition) => [
      requisition.id,
      requisition.publicId,
    ]),
  );
  const requisitionHref = (requisitionId: string) =>
    `/client/requisitions/${publicIdById.get(requisitionId) ?? requisitionId}`;
  // A filled or closed search never asks for candidate review (UX 3.3).
  const statusById = new Map(
    dashboard.requisitions.map((requisition) => [
      requisition.id,
      requisition.status,
    ]),
  );
  const candidatesAwaitingReview =
    dashboard.pendingActions.candidatesAwaitingReview.filter((item) => {
      const status = statusById.get(item.requisitionId);
      return status !== "placed" && status !== "closed_unfilled";
    });
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
                  <Card className="border-l-2 border-warning">
                    <CardContent className="grid grid-cols-[auto_6.5rem_1fr_auto] items-center gap-3 p-4">
                      <ShieldCheck
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-warning-text"
                      />
                      <span className="font-mono text-xs text-neutral-500">
                        {item.reference}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-brand-navy-ink">
                          Brief awaiting your approval
                        </p>
                        <p className="truncate text-xs text-neutral-500">
                          {item.advertisedTitle ?? "Untitled role"} · waiting{" "}
                          {formatRelative(item.since).replace(" ago", "")}
                        </p>
                      </div>
                      <Button asChild size="sm">
                        <Link to={requisitionHref(item.requisitionId)}>
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
                  <Card className="border-l-2 border-info">
                    <CardContent className="grid grid-cols-[auto_6.5rem_1fr_auto] items-center gap-3 p-4">
                      <UserSearch
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-info"
                      />
                      <span className="font-mono text-xs text-neutral-500">
                        {item.requisitionReference}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-brand-navy-ink">
                          {item.displayName} is ready for your review
                        </p>
                        {item.presentedAt !== null ? (
                          <p className="truncate text-xs text-neutral-500">
                            Presented {formatRelative(item.presentedAt)}
                          </p>
                        ) : null}
                      </div>
                      <Button asChild size="sm">
                        <Link
                          to={`${requisitionHref(item.requisitionId)}#candidates`}
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
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="recent-activity-heading"
              className="flex items-center gap-2 text-lg font-semibold tracking-tight text-brand-navy-ink"
            >
              <History aria-hidden="true" className="h-4 w-4 text-neutral-500" />
              Recent activity
            </h2>
            <p className="text-xs text-neutral-500">
              as of{" "}
              {formatDateTime(
                new Date(dashboardQuery.dataUpdatedAt || Date.now()).toISOString(),
              )}
            </p>
          </div>
          <Card>
            <CardContent className="p-6">
              <RecentActivity
                events={dashboard.recentEvents}
                requisitionHref={requisitionHref}
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
