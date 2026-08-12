/**
 * Status card: the 01 §4 state machine visualised as a vertical tracker
 * (happy path with done/current/upcoming markers, detours flagged inline)
 * plus one button per allowed next transition from the local adjacency map.
 * The server still validates — a 409 INVALID_TRANSITION surfaces inline
 * with its from/to detail.
 */
import { ArrowRight, Check, CircleDot, PauseCircle, XCircle } from "lucide-react";
import { useState } from "react";
import type { EntityEvent, RequisitionDetail, RequisitionStatus } from "@sdb/contracts";
import { RequisitionStatusSchema } from "@sdb/contracts";
import {
  REQUISITION_STATUS_META,
  RequisitionStatusBadge,
} from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useTransitionRequisition } from "../api";
import { allowedTransitions, HAPPY_PATH, isTerminalStatus } from "../status-machine";

/**
 * The state to resume to from on_hold: the fromValue of the latest
 * status_changed event that moved the requisition INTO on_hold (01 §4
 * "returns to prior state").
 */
export function resumeTargetFromEvents(
  events: EntityEvent[] | undefined,
): RequisitionStatus | undefined {
  if (events === undefined) return undefined;
  const ordered = [...events].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : -1,
  );
  for (const event of ordered) {
    if (event.toValue === "on_hold" && event.fromValue !== null) {
      const parsed = RequisitionStatusSchema.safeParse(event.fromValue);
      if (parsed.success) return parsed.data;
    }
  }
  return undefined;
}

export function StageTracker({
  requisition,
  events,
}: {
  requisition: RequisitionDetail;
  events: EntityEvent[] | undefined;
}) {
  const transition = useTransitionRequisition();
  const [error, setError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<RequisitionStatus | null>(
    null,
  );

  const current = requisition.status;
  const resumeTarget = resumeTargetFromEvents(events);
  const targets = allowedTransitions(current, resumeTarget);

  const currentHappyIndex = HAPPY_PATH.indexOf(current);
  const isDetour = currentHappyIndex === -1;

  const runTransition = async (toStatus: RequisitionStatus) => {
    setError(null);
    setPendingTarget(toStatus);
    try {
      await transition.mutateAsync({
        id: requisition.id,
        body: { toStatus },
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "INVALID_TRANSITION") {
        const from = cause.details?.["from"];
        const to = cause.details?.["to"];
        setError(
          typeof from === "string" && typeof to === "string"
            ? `The server rejected this transition: ${from} → ${to} is not allowed. The requisition may have moved — refresh and try again.`
            : cause.message,
        );
      } else {
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Could not change the status.",
        );
      }
    } finally {
      setPendingTarget(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Status</CardTitle>
        <RequisitionStatusBadge status={current} />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ----- Happy-path tracker ----- */}
        <ol className="space-y-1" aria-label="Requisition stages">
          {HAPPY_PATH.map((stage, index) => {
            const isDone = currentHappyIndex > index;
            const isCurrent = currentHappyIndex === index;
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
                {REQUISITION_STATUS_META[stage].label}
                {isDone ? <span className="sr-only"> — done</span> : null}
              </li>
            );
          })}
        </ol>

        {/* Detour states sit outside the happy path */}
        {isDetour ? (
          <p className="flex items-center gap-2 rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text">
            {current === "on_hold" ? (
              <PauseCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            ) : (
              <XCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
            )}
            {current === "on_hold"
              ? resumeTarget !== undefined
                ? `On hold — resumes to ${REQUISITION_STATUS_META[resumeTarget].label}.`
                : "On hold — the resume target could not be read from the event log."
              : `Currently ${REQUISITION_STATUS_META[current].label}.`}
          </p>
        ) : null}

        {/* ----- Allowed transitions (01 §4 adjacency map) ----- */}
        {isTerminalStatus(current) ? (
          <p className="text-xs text-neutral-500">
            This is a terminal status — no further transitions.
          </p>
        ) : targets.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-tight text-neutral-500">
              Move to
            </p>
            <div className="flex flex-col gap-2">
              {targets.map((target) => (
                <Button
                  key={target}
                  variant={
                    target === "closed_unfilled" ? "destructive" : "secondary"
                  }
                  size="sm"
                  className="justify-start"
                  onClick={() => void runTransition(target)}
                  disabled={transition.isPending}
                >
                  <ArrowRight aria-hidden="true" />
                  {pendingTarget === target
                    ? "Moving…"
                    : REQUISITION_STATUS_META[target].label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {error !== null ? (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
