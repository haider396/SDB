/**
 * /client/requisitions/:id — one requisition as the client sees it
 * (05 §4.1 two-column split): candidates + brief in the main column, a
 * rail with the view-only progress tracker and — ONLY when the status is
 * pending_principal_approval AND the signed-in user is the designated
 * principal — the J3 approval panel. No role branching: the principal check
 * is data (me.user.id === principalUserId), not role.
 *
 * The rail renders FIRST in DOM (UX 3.4) so mobile/tablet see the approval
 * task above the fold; order utilities move it back to the right column at
 * xl. The job description lives in JobDescriptionCard, which renders it
 * through SimpleMarkdown (headings/bullets/bold, NO HTML injection surface)
 * and folds it down to a preview — a long one used to push the candidates,
 * the thing a client came here to do, below the fold.
 */
import { Hourglass } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { useMe } from "@/lib/permissions";
import { useClientRequisition } from "./api";
import { CandidatesSection } from "./components/candidates-section";
import { ClientStageTracker } from "./components/client-stage-tracker";
import { JobDescriptionCard } from "./components/job-description-card";
import { GuaranteeProgress } from "@/components/patterns/guarantee-progress";
import { PrincipalApprovalPanel } from "./components/principal-approval-panel";

export function ClientRequisitionDetailPage() {
  const { id = "" } = useParams();
  const { data: me } = useMe();
  const location = useLocation();
  const requisitionQuery = useClientRequisition(id);
  const isLoaded = requisitionQuery.data !== undefined;

  // /client/requisitions/:id#candidates lands ON the candidates section
  // (UX 3.5). Two subtleties:
  //
  // - Scroll the layout's <main> scroller explicitly rather than calling
  //   scrollIntoView: scrollIntoView scrolls EVERY scrollable ancestor,
  //   including the shell's overflow-hidden box (hidden overflow is still
  //   programmatically scrollable), which shifted the fixed chrome (top
  //   bar) out of view.
  // - The candidates grid loads through its own query, so right after the
  //   requisition renders the page is often too short to scroll — a single
  //   scrollTo would clamp to 0. Poll each animation frame (bounded) until
  //   the scroller can actually reach the section, then scroll once.
  useEffect(() => {
    if (!isLoaded || location.hash !== "#candidates") return;
    const deadline = performance.now() + 3000;
    let frame = 0;
    const attempt = () => {
      const section = document.getElementById("candidates");
      const scroller = section?.closest("main");
      if (section != null && scroller != null) {
        const top =
          section.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop;
        const maxTop = scroller.scrollHeight - scroller.clientHeight;
        if (maxTop >= top - 1) {
          scroller.scrollTo({ top, behavior: "smooth" });
          return;
        }
        if (performance.now() > deadline) {
          // Content never grew tall enough — best effort.
          if (maxTop > 0) scroller.scrollTo({ top: maxTop, behavior: "smooth" });
          return;
        }
      } else if (performance.now() > deadline) {
        return;
      }
      frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [isLoaded, location.hash]);

  if (requisitionQuery.isLoading) {
    return (
      <>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", to: "/client" },
            { label: "My placements", to: "/client/requisitions" },
            { label: "Placement" },
          ]}
          title="Loading placement…"
        />
        <LoadingSkeleton variant="card" rows={3} label="Loading placement…" />
      </>
    );
  }
  if (requisitionQuery.isError) {
    return (
      <>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", to: "/client" },
            { label: "My placements", to: "/client/requisitions" },
            { label: "Placement" },
          ]}
          title="Placement"
        />
        <ErrorState
          error={requisitionQuery.error}
          onRetry={() => void requisitionQuery.refetch()}
          backTo={{ to: "/client/requisitions", label: "My placements" }}
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

  // T16: the client reads the job description they (or SDB) wrote — the
  // admin-authored brief was retired in 0018, so the word "brief" no longer
  // names anything in this product and is not used in client-facing copy.
  const hasJobDescription =
    requisition.jobDescription !== null &&
    requisition.jobDescription.trim() !== "";

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", to: "/client" },
          { label: "My placements", to: "/client/requisitions" },
          { label: requisition.advertisedTitle ?? "Untitled role" },
        ]}
        title={requisition.advertisedTitle ?? "Untitled role"}
        subtitle={`Opened ${formatDate(requisition.submittedAt)}`}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ----- Rail FIRST in DOM (UX 3.4): the approval task tops the page
               on mobile/tablet; xl:order-2 returns it to the right column. */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:order-2 xl:self-start">
          {isPrincipalApprovalMine ? (
            hasJobDescription ? (
              <PrincipalApprovalPanel requisition={requisition} />
            ) : (
              // Nothing to approve yet — explain instead of a dead-end CTA.
              <Card className="border border-warning bg-warning-subtle">
                <CardHeader className="flex-row items-center gap-2 space-y-0">
                  <Hourglass
                    aria-hidden="true"
                    className="h-4 w-4 text-warning-text"
                  />
                  <CardTitle className="text-base">
                    The job description is being finalised
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-neutral-600">
                    Our team is still writing the job description. You will be
                    able to review and approve it here as soon as it is ready —
                    no action needed from you yet.
                  </p>
                </CardContent>
              </Card>
            )
          ) : null}
          <ClientStageTracker status={requisition.status} />

          {/* Post-hire guarantee (T31). Rebecca, 37:34: "under hire, let's
              have it automatically say like first 30-day period, 60-day,
              90-day." Sits under the tracker, which ends at "Hired". */}
          {requisition.placement !== null ? (
            <Card>
              <CardContent className="p-4">
                <GuaranteeProgress placement={requisition.placement} />
              </CardContent>
            </Card>
          ) : null}
        </aside>

        {/* ----- Main column ----- */}
        <div className="min-w-0 space-y-8 xl:order-1">
          {hasJobDescription ? (
            <JobDescriptionCard description={requisition.jobDescription ?? ""} />
          ) : null}

          <CandidatesSection requisitionId={requisition.id} />
        </div>
      </div>
    </>
  );
}
