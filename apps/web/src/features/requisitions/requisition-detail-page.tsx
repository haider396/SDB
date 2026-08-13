/**
 * /admin/requisitions/:id — the requisition workspace (J3/J4). Tabbed since
 * P4: "Overview" is the original two-column detail (intake answers, brief,
 * fields left; status tracker, approval, event log in a sticky rail — 05
 * §4.1) and "Pipeline" is the P4 kanban board (05 §4.7).
 *
 * Tab state lives in the URL as `?tab=…` (useSearchParams) so board links
 * are shareable; the URL always wins. With no tab param the default is
 * status-aware: requisitions in an active sourcing/interviewing phase land
 * on Pipeline (that is where the work is), everything else on Overview.
 * The tablist follows the WAI-ARIA tabs pattern with arrow-key navigation.
 */
import { useId, type KeyboardEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { RequisitionStatus } from "@sdb/contracts";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { PipelineTab } from "@/features/pipeline";
import { useRequisition, useRequisitionEvents } from "./api";
import { AnswersCard } from "./components/answers-card";
import { BriefCard } from "./components/brief-card";
import { EventLogCard } from "@/components/patterns/event-log-card";
import { FieldsCard } from "./components/fields-card";
import { PrincipalApprovalCard } from "./components/principal-approval-card";
import { StageTracker } from "./components/stage-tracker";

type TabKey = "overview" | "pipeline";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "pipeline", label: "Pipeline" },
];

/** Statuses whose day-to-day work happens on the board, not the overview. */
const PIPELINE_FIRST_STATUSES: readonly RequisitionStatus[] = [
  "sourcing",
  "candidates_presented",
  "interviewing",
  "offer_extended",
];

export function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const requisitionId = id ?? "";
  const query = useRequisition(requisitionId);
  const eventsQuery = useRequisitionEvents(requisitionId);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabsId = useId();

  // URL param wins; without one the status decides the default tab.
  const defaultTab: TabKey =
    query.data !== undefined &&
    PIPELINE_FIRST_STATUSES.includes(query.data.status)
      ? "pipeline"
      : "overview";
  const tabParam = searchParams.get("tab");
  const activeTab: TabKey =
    tabParam === "pipeline"
      ? "pipeline"
      : tabParam === "overview"
        ? "overview"
        : defaultTab;

  const selectTab = (tab: TabKey) => {
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        // The status-derived default needs no param; the other tab does.
        if (tab === defaultTab) next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: true },
    );
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((tab) => tab.key === activeTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      const nextTab = TABS[nextIndex];
      if (nextTab !== undefined) {
        selectTab(nextTab.key);
        document.getElementById(`${tabsId}-tab-${nextTab.key}`)?.focus();
      }
    }
  };

  const breadcrumbs = [
    { label: "Admin", to: "/admin" },
    { label: "Requisitions", to: "/admin/requisitions" },
  ];

  if (query.isPending) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[...breadcrumbs, { label: "Loading…" }]}
          title="Requisition"
        />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <LoadingSkeleton variant="card" rows={2} label="Loading answers…" />
            <LoadingSkeleton variant="card" rows={1} label="Loading brief…" />
          </div>
          <LoadingSkeleton variant="card" rows={3} label="Loading status…" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[...breadcrumbs, { label: "Requisition" }]}
          title="Requisition"
        />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const requisition = query.data;
  const title = requisition.advertisedTitle ?? "Untitled role";
  const taxonomyPath = [
    requisition.taxonomy.engine?.label,
    requisition.taxonomy.department?.label,
    requisition.taxonomy.roleCategory?.label,
  ]
    .filter((part): part is string => part !== undefined && part !== null)
    .join(" › ");

  return (
    <div>
      <PageHeader
        breadcrumbs={[...breadcrumbs, { label: requisition.reference }]}
        title={title}
        subtitle={
          taxonomyPath !== ""
            ? `${taxonomyPath} · submitted ${formatDate(requisition.submittedAt)}`
            : `Submitted ${formatDate(requisition.submittedAt)}`
        }
        meta={
          <>
            <span className="font-mono">{requisition.reference}</span>
            <span>
              Client:{" "}
              <Link
                to={`/admin/clients/${requisition.clientId}`}
                className="font-medium text-brand-blue hover:underline"
              >
                {requisition.clientName}
              </Link>
            </span>
          </>
        }
      />

      <div
        role="tablist"
        aria-label="Requisition sections"
        onKeyDown={onTabKeyDown}
        className="mb-6 flex gap-1 border-b border-border-default"
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            id={`${tabsId}-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`${tabsId}-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => selectTab(tab.key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
              activeTab === tab.key
                ? "border-brand-blue text-brand-blue"
                : "border-transparent text-neutral-500 hover:text-neutral-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <div
          id={`${tabsId}-panel-overview`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-overview`}
          className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]"
        >
          {/* ----- Main column ----- */}
          <div className="min-w-0 space-y-6">
            <AnswersCard answers={requisition.answers} />
            <BriefCard requisition={requisition} />
            <FieldsCard requisition={requisition} />
          </div>

          {/* ----- Sticky right rail (05 §4.1) ----- */}
          <div className="space-y-6 self-start xl:sticky xl:top-6">
            <StageTracker requisition={requisition} events={eventsQuery.data} />
            <PrincipalApprovalCard requisition={requisition} />
            <EventLogCard
              events={eventsQuery.data}
              isLoading={eventsQuery.isPending}
              isError={eventsQuery.isError}
              error={eventsQuery.error}
              onRetry={() => void eventsQuery.refetch()}
              emptyDescription="Every state change on this requisition is recorded here."
            />
          </div>
        </div>
      ) : (
        <div
          id={`${tabsId}-panel-pipeline`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-pipeline`}
        >
          <PipelineTab requisitionId={requisitionId} />
        </div>
      )}
    </div>
  );
}
