/**
 * The candidate review section of a client requisition (01 §3 J6): a card
 * grid of ClientVisibleAssignment rows, the three decision flows, and an
 * aria-live region announcing each outcome (05 §4.6).
 *
 * Rows the view no longer returns (rejected_by_admin / withdrawn) simply
 * disappear on refetch — never a rejection the client did not make (01 §5).
 * Ordering: actionable stages first, then the journey order, muted last.
 */
import { LayoutGrid, List, UserSearch } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ClientVisibleAssignment } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useUiStore, type CandidateView } from "@/stores/ui-store";
import {
  useApproveForInterview,
  useClientAssignments,
  useRejectCandidate,
  useRequestInterview,
} from "../api";
import { CLIENT_STAGE_ORDER, isMutedStage } from "../labels";
import { CandidateCard } from "./candidate-card";
import { CandidateRow, candidateRowId } from "./candidate-row";
import {
  ClientRejectDialog,
  ConfirmDecisionDialog,
} from "./decision-dialogs";

/**
 * Above this many candidates the list collapses by default.
 *
 * Rebecca's case is one position hiring three of the same role, which puts
 * "12 to 20 candidates" on one page — unreadable as full cards. Below it, a
 * position reads better expanded. This is only the DEFAULT: an explicit choice
 * is remembered per user and always wins.
 */
const CANDIDATE_LIST_THRESHOLD = 8;

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
  /** The candidate opened from the collapsed list, or null when none is. */
  const [opened, setOpened] = useState<ClientVisibleAssignment | null>(null);
  /**
   * Which row opened the sheet, kept in a ref rather than read from `opened`:
   * by the time the close animation runs `opened` is already null, and focus
   * has to land somewhere real or it falls to <body>.
   */
  const openedFrom = useRef<string | null>(null);

  const storedView = useUiStore((state) => state.candidateView);
  const setStoredView = useUiStore((state) => state.setCandidateView);

  // Decision state (interview requested / declined reason) now comes from
  // the server row itself (UX 3.2) — nothing is session-local.
  const rows = [...(assignmentsQuery.data ?? [])].sort(reviewOrder);

  // An explicit choice always wins; with none, size decides.
  const view: CandidateView =
    storedView ?? (rows.length > CANDIDATE_LIST_THRESHOLD ? "list" : "cards");

  /**
   * The sheet renders the SAME CandidateCard the grid does, so the decision
   * flows, the stage-specific actions and the announcements cannot drift
   * between the two views. The row is a scanning affordance, not a second
   * implementation of the card.
   *
   * A decision closes it: the dialogs live at section level and the row that
   * was open is about to change stage, so leaving it open would show a card
   * describing a state the candidate has just left.
   */
  const cardFor = (row: ClientVisibleAssignment) => (
    <CandidateCard
      row={row}
      onApprove={(target) => {
        setOpened(null);
        setDialog({ kind: "approve", row: target });
      }}
      onRequestInterview={(target) => {
        setOpened(null);
        setDialog({ kind: "request", row: target });
      }}
      onReject={(target) => {
        setOpened(null);
        setDialog({ kind: "reject", row: target });
      }}
    />
  );

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
          <div className="flex items-center gap-3">
            <p className="text-sm tabular-nums text-neutral-500">
              {rows.length} candidate{rows.length === 1 ? "" : "s"}
            </p>
            {/* Both options are always offered, even when only three
                candidates are here — a control that appears once a list grows
                past a threshold reads as a glitch, not a feature. */}
            <div
              role="group"
              aria-label="Candidate view"
              className="flex items-center rounded-md border border-border-default p-0.5"
            >
              <Button
                size="sm"
                variant={view === "cards" ? "secondary" : "ghost"}
                aria-pressed={view === "cards"}
                onClick={() => setStoredView("cards")}
              >
                <LayoutGrid className="mr-1 h-3 w-3" aria-hidden="true" />
                Cards
              </Button>
              <Button
                size="sm"
                variant={view === "list" ? "secondary" : "ghost"}
                aria-pressed={view === "list"}
                onClick={() => setStoredView("list")}
              >
                <List className="mr-1 h-3 w-3" aria-hidden="true" />
                List
              </Button>
            </div>
          </div>
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
      ) : view === "list" ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <CandidateRow
              key={row.assignmentId}
              row={row}
              onOpen={(target) => {
                openedFrom.current = target.assignmentId;
                setOpened(target);
              }}
            />
          ))}
        </ul>
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

      {/* ----- The pop-out, opened from a collapsed row ----- */}
      <Sheet
        open={opened !== null}
        onOpenChange={(next) => {
          if (!next) setOpened(null);
        }}
      >
        <SheetContent
          className="w-full sm:max-w-lg"
          // Radix restores focus by itself only when the opener is its own
          // SheetTrigger. One sheet is shared by the whole list, so the row
          // has to be found again by id — otherwise focus lands on <body> and
          // a keyboard user is thrown back to the top of the page after every
          // candidate they look at.
          onCloseAutoFocus={(event) => {
            const id = openedFrom.current;
            if (id === null) return;
            const opener = document.getElementById(candidateRowId(id));
            if (opener === null) return;
            event.preventDefault();
            opener.focus();
          }}
        >
          {opened !== null ? (
            <>
              <SheetHeader>
                <SheetTitle>{opened.displayName}</SheetTitle>
              </SheetHeader>
              <SheetBody>{cardFor(opened)}</SheetBody>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

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
