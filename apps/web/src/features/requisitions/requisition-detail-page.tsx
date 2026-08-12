/**
 * /admin/requisitions/:id — the requisition workspace (J3). Two-column at
 * ≥1280 px: intake answers (from snapshots), brief editor, and fields editor
 * left; status/stage tracker, principal approval, and event log in a sticky
 * right rail (05 §4.1).
 */
import { Link, useParams } from "react-router-dom";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { formatDate } from "@/lib/format";
import { useRequisition, useRequisitionEvents } from "./api";
import { AnswersCard } from "./components/answers-card";
import { BriefCard } from "./components/brief-card";
import { EventLogCard } from "./components/event-log-card";
import { FieldsCard } from "./components/fields-card";
import { PrincipalApprovalCard } from "./components/principal-approval-card";
import { StageTracker } from "./components/stage-tracker";

export function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const requisitionId = id ?? "";
  const query = useRequisition(requisitionId);
  const eventsQuery = useRequisitionEvents(requisitionId);

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
        subtitle={`${requisition.reference} · ${taxonomyPath !== "" ? `${taxonomyPath} · ` : ""}submitted ${formatDate(requisition.submittedAt)}`}
      />

      <p className="-mt-6 mb-6 text-sm text-neutral-500">
        Client:{" "}
        <Link
          to={`/admin/clients/${requisition.clientId}`}
          className="font-medium text-brand-blue hover:underline"
        >
          {requisition.clientName}
        </Link>
      </p>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
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
          />
        </div>
      </div>
    </div>
  );
}
