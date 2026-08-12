/**
 * View-only requisition progress for the client portal: the 01 §4 happy
 * path with done/current/upcoming markers and client-facing wording
 * (CLIENT_REQUISITION_STATUS_LABELS). No transition buttons — moving a
 * requisition is never a client action.
 */
import { Check, CircleDot, PauseCircle, XCircle } from "lucide-react";
import type { RequisitionStatus } from "@sdb/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { HAPPY_PATH } from "@/features/requisitions/status-machine";
import { CLIENT_REQUISITION_STATUS_LABELS } from "../labels";

export function ClientStatusBadgePill({ status }: { status: RequisitionStatus }) {
  const tone =
    status === "placed" || status === "offer_extended"
      ? "text-success-text bg-success-subtle"
      : status === "closed_unfilled" || status === "on_hold"
        ? "text-neutral-600 bg-neutral-100"
        : status === "pending_principal_approval" || status === "changes_requested"
          ? "text-warning-text bg-warning-subtle"
          : "text-info bg-info-subtle";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone,
      )}
    >
      {CLIENT_REQUISITION_STATUS_LABELS[status]}
    </span>
  );
}

export function ClientStageTracker({ status }: { status: RequisitionStatus }) {
  const currentIndex = HAPPY_PATH.indexOf(status);
  const isDetour = currentIndex === -1;
  // changes_requested sits between approval and sourcing on the happy path.
  const effectiveIndex =
    status === "changes_requested"
      ? HAPPY_PATH.indexOf("pending_principal_approval")
      : currentIndex;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Progress</CardTitle>
        <ClientStatusBadgePill status={status} />
      </CardHeader>
      <CardContent>
        <ol className="space-y-1" aria-label="Hiring progress">
          {HAPPY_PATH.map((stage, index) => {
            const isDone = effectiveIndex > index;
            const isCurrent = effectiveIndex === index;
            return (
              <li
                key={stage}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  isCurrent
                    ? "font-medium text-brand-navy-ink"
                    : isDone
                      ? "text-neutral-500"
                      : "text-neutral-400",
                )}
              >
                {isDone ? (
                  <Check aria-hidden="true" className="h-4 w-4 text-success" />
                ) : isCurrent ? (
                  <CircleDot
                    aria-hidden="true"
                    className="h-4 w-4 text-brand-blue"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="inline-block h-4 w-4 text-center leading-4"
                  >
                    ·
                  </span>
                )}
                {CLIENT_REQUISITION_STATUS_LABELS[stage]}
                {isDone ? <span className="sr-only"> — done</span> : null}
              </li>
            );
          })}
        </ol>

        {isDetour && status !== "changes_requested" ? (
          <p className="mt-4 flex items-center gap-2 rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text">
            {status === "on_hold" ? (
              <PauseCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            )}
            {status === "on_hold"
              ? "This search is paused. Contact your account manager to resume it."
              : "This search has been closed."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
