/**
 * The placement's next step, in the MAIN column (T4 + T21).
 *
 * Rebecca on the 13 Aug call could not find the transition controls at all —
 * Haider had to say "on the right, on the right, on the right, on the right"
 * before she spotted them, then asked "so that's not a dropdown?". Her verdict
 * (53:50): "for the move to, on hold, closed unfilled — the navigation of
 * those buttons, I want to change, the button visuals are not clear there."
 * And at 56:40, on the approval specifically: "the button to push it to get
 * the approval needs to be next to the brief."
 *
 * Three things were wrong, and none of them was the button styling:
 *
 * 1. **Location.** Every action lived in the right rail. On a wide screen the
 *    eye goes to the main column, so the one control that moves the work
 *    forward was parked out of the reading path. It now sits directly under
 *    the brief — which is also the thing being approved.
 * 2. **Hierarchy.** "Move to pending approval" and "Close unfilled" were both
 *    outlined secondary buttons, so nothing said which one you probably want.
 *    The forward move is now a single primary button; the pause/close detours
 *    stay in the rail, quieter, where they belong.
 * 3. **The "Move to" caption.** A small grey uppercase label above a stack of
 *    buttons reads as a heading for a group — which is exactly why she took it
 *    for a dropdown. Replaced with a plain sentence naming the next step.
 *
 * The state machine is untouched: this renders the SAME `allowedTransitions`
 * the rail used, and the server still validates every move.
 */
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { EntityEvent, RequisitionDetail, RequisitionStatus } from "@sdb/contracts";
import { REQUISITION_STATUS_META } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { useTransitionRequisition } from "../api";
import { allowedTransitions, isTerminalStatus } from "../status-machine";
import { resumeTargetFromEvents } from "./stage-tracker";

/**
 * What the admin is most likely to do next, in plain words — so the button
 * says what happens rather than naming an internal status.
 */
const NEXT_STEP_COPY: Partial<
  Record<RequisitionStatus, { action: string; explain: string }>
> = {
  pending_principal_approval: {
    action: "Send brief for approval",
    explain:
      "The client's principal reviews the brief before we start sourcing.",
  },
  sourcing: {
    action: "Start sourcing",
    explain: "The brief is approved — begin finding candidates.",
  },
  candidates_presented: {
    action: "Mark candidates presented",
    explain: "The client can now review who you have put forward.",
  },
  interviewing: {
    action: "Move to interviewing",
    explain: "The client is scheduling or holding interviews.",
  },
  offer_extended: {
    action: "Mark offer extended",
    explain: "An offer is with the candidate.",
  },
  placed: {
    action: "Mark as hired",
    explain: "Records the placement and closes the other candidates.",
  },
};

export function NextStepCard({
  requisition,
  events,
}: {
  requisition: RequisitionDetail;
  events: EntityEvent[] | undefined;
}) {
  const transition = useTransitionRequisition();
  const [error, setError] = useState<string | null>(null);

  const resumeTarget = resumeTargetFromEvents(events);
  const targets = allowedTransitions(requisition.status, resumeTarget);
  // The forward move only — pause and close stay in the rail.
  const forward = targets.find(
    (target) => target !== "on_hold" && target !== "closed_unfilled",
  );

  if (isTerminalStatus(requisition.status)) {
    return (
      <Card className="border-l-2 border-success">
        <CardContent className="flex items-start gap-3 p-4">
          <CheckCircle2
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-success-text"
          />
          <div>
            <p className="text-sm font-medium text-brand-navy-ink">
              This placement is {REQUISITION_STATUS_META[requisition.status].label.toLowerCase()}
            </p>
            <p className="mt-0.5 text-sm text-neutral-600">
              No further steps — it cannot be reopened.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (forward === undefined) return null;

  const copy = NEXT_STEP_COPY[forward];
  const label = copy?.action ?? `Move to ${REQUISITION_STATUS_META[forward].label}`;

  const run = async () => {
    setError(null);
    try {
      await transition.mutateAsync({
        id: requisition.id,
        body: { toStatus: forward },
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "INVALID_TRANSITION") {
        setError(
          "This placement has moved since the page loaded. Refresh and try again.",
        );
      } else {
        setError(
          cause instanceof ApiError ? cause.message : "Could not change the status.",
        );
      }
    }
  };

  return (
    <Card className="border-l-2 border-brand-blue">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-navy-ink">Next step</p>
          <p className="mt-0.5 text-sm text-neutral-600">
            {copy?.explain ??
              `Move this placement to ${REQUISITION_STATUS_META[forward].label}.`}
          </p>
          {error !== null ? (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              {error}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          onClick={() => void run()}
          disabled={transition.isPending}
          className="shrink-0"
        >
          {transition.isPending ? "Moving…" : label}
          <ArrowRight aria-hidden="true" />
        </Button>
      </CardContent>
    </Card>
  );
}
