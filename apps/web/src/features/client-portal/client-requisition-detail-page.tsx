/**
 * /client/requisitions/:id — one requisition as the client sees it
 * (05 §4.1 two-column split): candidates + brief in the main column, a
 * sticky rail with the view-only progress tracker and — ONLY when the
 * status is pending_principal_approval AND the signed-in user is the
 * designated principal — the J3 approval panel. No role branching: the
 * principal check is data (me.user.id === principalUserId), not role.
 *
 * The brief renders through the same minimal renderer as the admin surface
 * (BriefPreview — paragraphs + preserved line breaks, no HTML injection).
 */
import { FileText } from "lucide-react";
import { useParams } from "react-router-dom";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { useMe } from "@/lib/permissions";
import { BriefPreview } from "@/features/requisitions/components/brief-card";
import { useClientRequisition } from "./api";
import { CandidatesSection } from "./components/candidates-section";
import { ClientStageTracker } from "./components/client-stage-tracker";
import { PrincipalApprovalPanel } from "./components/principal-approval-panel";

export function ClientRequisitionDetailPage() {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const requisitionQuery = useClientRequisition(id);

  if (requisitionQuery.isLoading) {
    return (
      <>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", to: "/client" },
            { label: "My requisitions", to: "/client/requisitions" },
            { label: "Requisition" },
          ]}
          title="Loading requisition…"
        />
        <LoadingSkeleton variant="card" rows={3} label="Loading requisition…" />
      </>
    );
  }
  if (requisitionQuery.isError) {
    return (
      <>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", to: "/client" },
            { label: "My requisitions", to: "/client/requisitions" },
            { label: "Requisition" },
          ]}
          title="Requisition"
        />
        <ErrorState
          error={requisitionQuery.error}
          onRetry={() => void requisitionQuery.refetch()}
        />
      </>
    );
  }
  const requisition = requisitionQuery.data;
  if (requisition === undefined) return null;

  const isPrincipalApprovalMine =
    requisition.status === "pending_principal_approval" &&
    me !== undefined &&
    requisition.principalUserId !== null &&
    me.user.id === requisition.principalUserId;

  const hasBrief =
    requisition.briefMarkdown !== null &&
    requisition.briefMarkdown.trim() !== "";

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", to: "/client" },
          { label: "My requisitions", to: "/client/requisitions" },
          { label: requisition.reference },
        ]}
        title={requisition.advertisedTitle ?? "Untitled role"}
        subtitle={`${requisition.reference} · submitted ${formatDate(requisition.submittedAt)}`}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ----- Main column ----- */}
        <div className="min-w-0 space-y-8">
          {hasBrief ? (
            <Card>
              <CardHeader className="flex-row items-center gap-2 space-y-0">
                <FileText
                  aria-hidden="true"
                  className="h-4 w-4 text-neutral-500"
                />
                <CardTitle className="text-base">Role brief</CardTitle>
              </CardHeader>
              <CardContent>
                <BriefPreview source={requisition.briefMarkdown ?? ""} />
              </CardContent>
            </Card>
          ) : null}

          <CandidatesSection requisitionId={requisition.id} />
        </div>

        {/* ----- Rail ----- */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          {isPrincipalApprovalMine ? (
            <PrincipalApprovalPanel requisition={requisition} />
          ) : null}
          <ClientStageTracker status={requisition.status} />
        </aside>
      </div>
    </>
  );
}
