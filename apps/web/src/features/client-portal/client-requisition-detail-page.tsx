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
 * xl. The brief renders through SimpleMarkdown (headings/bullets/bold, no
 * HTML injection surface).
 */
import { FileText, Hourglass } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { useMe } from "@/lib/permissions";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import { useClientRequisition } from "./api";
import { CandidatesSection } from "./components/candidates-section";
import { ClientStageTracker } from "./components/client-stage-tracker";
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
        {/* ----- Rail FIRST in DOM (UX 3.4): the approval task tops the page
               on mobile/tablet; xl:order-2 returns it to the right column. */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:order-2 xl:self-start">
          {isPrincipalApprovalMine ? (
            hasBrief ? (
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
                    The brief is being finalised
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-neutral-600">
                    Our team is still writing the role brief. You will be able
                    to review and approve it here as soon as it is ready — no
                    action needed from you yet.
                  </p>
                </CardContent>
              </Card>
            )
          ) : null}
          <ClientStageTracker status={requisition.status} />
        </aside>

        {/* ----- Main column ----- */}
        <div className="min-w-0 space-y-8 xl:order-1">
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
                <SimpleMarkdown source={requisition.briefMarkdown ?? ""} />
              </CardContent>
            </Card>
          ) : null}

          <CandidatesSection requisitionId={requisition.id} />
        </div>
      </div>
    </>
  );
}
