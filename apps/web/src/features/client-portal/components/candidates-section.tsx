/**
 * The candidate review section of a client requisition (01 §3 J6): a card
 * grid of ClientVisibleAssignment rows, the three decision flows, and an
 * aria-live region announcing each outcome (05 §4.6).
 *
 * Rows the view no longer returns (rejected_by_admin / withdrawn) simply
 * disappear on refetch — never a rejection the client did not make (01 §5).
 * Ordering: actionable stages first, then the journey order, muted last.
 */
import { UserSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ClientVisibleAssignment } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import {
  useApproveForInterview,
  useClientAssignments,
  useRejectCandidate,
  useRequestInterview,
} from "../api";
import { CLIENT_STAGE_ORDER, isMutedStage } from "../labels";
import { CandidateCard } from "./candidate-card";
import {
  ClientRejectDialog,
  ConfirmDecisionDialog,
} from "./decision-dialogs";

type DialogState =
  | { kind: "approve"; row: ClientVisibleAssignment }
  | { kind: "request"; row: ClientVisibleAssignment }
  | { kind: "reject"; row: ClientVisibleAssignment }
  | null;

function reviewOrder(
  a: ClientVisibleAssignment,
  b: ClientVisibleAssignment,
): number {
  const mutedDelta = Number(isMutedStage(a.stage)) - Number(isMutedStage(b.stage));
  if (mutedDelta !== 0) return mutedDelta;
  const stageDelta =
    CLIENT_STAGE_ORDER.indexOf(a.stage) - CLIENT_STAGE_ORDER.indexOf(b.stage);
  if (stageDelta !== 0) return stageDelta;
  return a.displayName.localeCompare(b.displayName);
}

export function CandidatesSection({ requisitionId }: { requisitionId: string }) {
  const assignmentsQuery = useClientAssignments(requisitionId);
  const approve = useApproveForInterview(requisitionId);
  const reject = useRejectCandidate(requisitionId);
  const requestInterview = useRequestInterview(requisitionId);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [announcement, setAnnouncement] = useState("");

  // Decision state (interview requested / declined reason) now comes from
  // the server row itself (UX 3.2) — nothing is session-local.
  const rows = [...(assignmentsQuery.data ?? [])].sort(reviewOrder);

  return (
    <section aria-labelledby="candidates-heading" id="candidates">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2
          id="candidates-heading"
          className="text-lg font-semibold tracking-tight text-brand-navy-ink"
        >
          Candidates
        </h2>
        {rows.length > 0 ? (
          <p className="text-sm tabular-nums text-neutral-500">
            {rows.length} candidate{rows.length === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {assignmentsQuery.isLoading ? (
        <LoadingSkeleton variant="card" rows={2} label="Loading candidates…" />
      ) : assignmentsQuery.isError ? (
        <ErrorState
          error={assignmentsQuery.error}
          onRetry={() => void assignmentsQuery.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UserSearch}
          title="No candidates to review yet"
          description="We are sourcing and vetting candidates for this role. You will be notified the moment the first ones are ready for your review."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {rows.map((row) => (
            <CandidateCard
              key={row.assignmentId}
              row={row}
              onApprove={(target) => setDialog({ kind: "approve", row: target })}
              onRequestInterview={(target) =>
                setDialog({ kind: "request", row: target })
              }
              onReject={(target) => setDialog({ kind: "reject", row: target })}
            />
          ))}
        </div>
      )}

      {/* ----- Move forward to interview (approve) ----- */}
      <ConfirmDecisionDialog
        row={dialog?.kind === "approve" ? dialog.row : null}
        title={(name) => `Move ${name} forward to interview?`}
        description="We'll let the SDB team know — they'll coordinate scheduling with you. The candidate's full contact details unlock once the interview is scheduled."
        confirmLabel="Move forward to interview"
        pendingLabel="Sending…"
        isPending={approve.isPending}
        onConfirm={async (row) => {
          await approve.mutateAsync({ assignmentId: row.assignmentId });
          setAnnouncement(`${row.displayName} is moving forward to interview.`);
          toast.success(`${row.displayName} is moving forward to interview.`);
        }}
        onClose={() => setDialog(null)}
      />

      {/* ----- Request interview (client_reviewing nudge) ----- */}
      <ConfirmDecisionDialog
        row={dialog?.kind === "request" ? dialog.row : null}
        title={(name) => `Request an interview with ${name}?`}
        description="Your Staffing Done Better team will be notified and will come back to you with proposed times. The candidate stays in review until the interview is scheduled."
        confirmLabel="Request interview"
        pendingLabel="Requesting…"
        isPending={requestInterview.isPending}
        onConfirm={async (row) => {
          await requestInterview.mutateAsync({ assignmentId: row.assignmentId });
          setAnnouncement(`Interview requested for ${row.displayName}.`);
          toast.success(`Interview requested for ${row.displayName}.`);
        }}
        onClose={() => setDialog(null)}
      />

      {/* ----- Structured decline ----- */}
      <ClientRejectDialog
        row={dialog?.kind === "reject" ? dialog.row : null}
        isPending={reject.isPending}
        onReject={async (row, body) => {
          await reject.mutateAsync({ assignmentId: row.assignmentId, body });
          setAnnouncement(`${row.displayName} declined.`);
          toast.success(`${row.displayName} declined.`);
        }}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}
