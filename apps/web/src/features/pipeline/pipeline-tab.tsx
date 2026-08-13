/**
 * The Pipeline tab of /admin/requisitions/:id (P4). Owns the board data,
 * the present multi-select state, and every dialog/sheet. Advance is
 * optimistic with rollback (05 §4.5): a 409 INVALID_TRANSITION surfaces
 * its { from, to } in the toast.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import type { AdminAssignmentRow, AssignmentStage } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { ApiError } from "@/lib/api-client";
import {
  useAdvanceAssignment,
  useAssignments,
  useCandidateDetailsMap,
  useInterviewsMap,
} from "./api";
import { STAGE_LABELS } from "./labels";
import { AddCandidatesSheet } from "./components/add-candidates-sheet";
import type { CardActions } from "./components/assignment-card";
import {
  CancelInterviewDialog,
  type CancelInterviewTarget,
} from "./components/cancel-interview-dialog";
import { HistorySheet } from "./components/history-sheet";
import { NoteDialog } from "./components/note-dialog";
import {
  OutcomeDialog,
  type OutcomeDialogTarget,
} from "./components/outcome-dialog";
import { PipelineBoard } from "./components/pipeline-board";
import { PlaceDialog } from "./components/place-dialog";
import { PresentReviewSheet } from "./components/present-review-sheet";
import { RejectDialog } from "./components/reject-dialog";
import { ScheduleInterviewDialog } from "./components/schedule-interview-dialog";

export interface PipelineTabProps {
  requisitionId: string;
}

export function PipelineTab({ requisitionId }: PipelineTabProps) {
  const query = useAssignments(requisitionId);
  const advance = useAdvanceAssignment(requisitionId);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const candidateIds = useMemo(
    () => [...new Set(rows.map((row) => row.candidateId))],
    [rows],
  );
  const candidateById = useCandidateDetailsMap(candidateIds);

  // Interview hydration only where the card shows it (P6).
  const interviewAssignmentIds = useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row.stage === "interview_scheduled" || row.stage === "interviewed",
        )
        .map((row) => row.id),
    [rows],
  );
  const interviewsByAssignmentId = useInterviewsMap(interviewAssignmentIds);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<AdminAssignmentRow | null>(
    null,
  );
  const [placeTarget, setPlaceTarget] = useState<AdminAssignmentRow | null>(
    null,
  );
  const [noteTarget, setNoteTarget] = useState<AdminAssignmentRow | null>(null);
  const [historyTarget, setHistoryTarget] =
    useState<AdminAssignmentRow | null>(null);
  const [scheduleTarget, setScheduleTarget] =
    useState<AdminAssignmentRow | null>(null);
  const [outcomeTarget, setOutcomeTarget] =
    useState<OutcomeDialogTarget | null>(null);
  const [cancelTarget, setCancelTarget] =
    useState<CancelInterviewTarget | null>(null);

  const onAdvance = (row: AdminAssignmentRow, toStage: AssignmentStage) => {
    advance.mutate(
      { assignmentId: row.id, toStage },
      {
        onError: (error) => {
          if (
            error instanceof ApiError &&
            error.code === "INVALID_TRANSITION"
          ) {
            const from = error.details?.from;
            const to = error.details?.to;
            const fromLabel =
              typeof from === "string" && from in STAGE_LABELS
                ? STAGE_LABELS[from as AssignmentStage]
                : String(from ?? "");
            const toLabel =
              typeof to === "string" && to in STAGE_LABELS
                ? STAGE_LABELS[to as AssignmentStage]
                : String(to ?? "");
            toast.error(
              `Cannot move ${row.candidate.displayName} from ${fromLabel} to ${toLabel} — rolled back.`,
            );
            return;
          }
          toast.error(
            error instanceof ApiError
              ? `${error.message} The card was rolled back.`
              : "The stage change failed and was rolled back.",
          );
        },
      },
    );
  };

  const actions: CardActions = {
    onAdvance,
    onViewHistory: setHistoryTarget,
    onAddNote: setNoteTarget,
    onReject: setRejectTarget,
    onPlace: setPlaceTarget,
    onScheduleInterview: setScheduleTarget,
    onRecordOutcome: (row, interview) => setOutcomeTarget({ row, interview }),
    onCancelInterview: (row, interview) => setCancelTarget({ row, interview }),
  };

  const toggleSelect = (assignmentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const vettedRows = rows.filter((row) => row.stage === "vetted");
  const selectedRows = vettedRows.filter((row) => selectedIds.has(row.id));

  if (query.isPending) {
    return (
      <div className="flex gap-3" aria-hidden={false}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="w-64 shrink-0">
            <LoadingSkeleton
              variant="card"
              rows={2}
              label="Loading pipeline…"
            />
          </div>
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => setIsAddOpen(true)}>Add candidates</Button>
        {selectedRows.length >= 1 ? (
          <>
            <Button variant="primary" onClick={() => setIsReviewOpen(true)}>
              Present {selectedRows.length} candidate
              {selectedRows.length === 1 ? "" : "s"}
            </Button>
            <Button variant="ghost" onClick={clearSelection}>
              Clear selection
            </Button>
          </>
        ) : null}
        <p className="ml-auto text-xs text-neutral-500">
          Tick vetted candidates to present them. Drag a card to advance it —
          columns it cannot legally reach are disabled while you drag. Or use
          a card's menu.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No candidates in this pipeline"
          description="Assign candidates from the pool to start moving them through the stages."
          action={
            <Button onClick={() => setIsAddOpen(true)}>Add candidates</Button>
          }
        />
      ) : (
        <PipelineBoard
          rows={rows}
          candidateById={candidateById}
          interviewsByAssignmentId={interviewsByAssignmentId}
          actions={actions}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          vettedHeaderAction={
            selectedRows.length > 0 ? (
              <span className="text-2xs font-medium text-brand-blue">
                {selectedRows.length} selected
              </span>
            ) : undefined
          }
        />
      )}

      <AddCandidatesSheet
        requisitionId={requisitionId}
        assignedCandidateIds={new Set(rows.map((row) => row.candidateId))}
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
      />

      <PresentReviewSheet
        requisitionId={requisitionId}
        rows={selectedRows}
        candidateById={candidateById}
        isOpen={isReviewOpen && selectedRows.length > 0}
        onClose={() => setIsReviewOpen(false)}
        onPresented={clearSelection}
      />

      <RejectDialog
        requisitionId={requisitionId}
        row={rejectTarget}
        onClose={() => setRejectTarget(null)}
      />
      <PlaceDialog
        requisitionId={requisitionId}
        row={placeTarget}
        onClose={() => setPlaceTarget(null)}
      />
      <NoteDialog
        requisitionId={requisitionId}
        row={noteTarget}
        onClose={() => setNoteTarget(null)}
      />
      <HistorySheet
        row={historyTarget}
        onClose={() => setHistoryTarget(null)}
      />
      <ScheduleInterviewDialog
        requisitionId={requisitionId}
        row={scheduleTarget}
        onClose={() => setScheduleTarget(null)}
      />
      <OutcomeDialog
        requisitionId={requisitionId}
        target={outcomeTarget}
        onClose={() => setOutcomeTarget(null)}
      />
      <CancelInterviewDialog
        requisitionId={requisitionId}
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
