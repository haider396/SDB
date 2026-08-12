/**
 * Record-outcome dialog for interview_scheduled cards (P6, 04 §10, J7
 * step 4). POST /interviews/:id/outcome with a segmented outcome choice:
 * passed / failed / no_show advance the assignment to Interviewed
 * server-side; `rescheduled` records the fact and KEEPS the stage — the
 * card stays at Interview scheduled awaiting the new round. `cancelled` is
 * not offered here: cancellation is its own action with its own rule.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  AdminAssignmentRow,
  Interview,
  OutcomeBody,
  RecordableOutcome,
} from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useRecordInterviewOutcome } from "../api";

export interface OutcomeDialogTarget {
  row: AdminAssignmentRow;
  interview: Interview;
}

export interface OutcomeDialogProps {
  requisitionId: string;
  target: OutcomeDialogTarget | null;
  onClose: () => void;
}

const OUTCOME_OPTIONS: readonly {
  value: RecordableOutcome;
  label: string;
  hint: string;
}[] = [
  { value: "passed", label: "Passed", hint: "moves to Interviewed" },
  { value: "failed", label: "Failed", hint: "moves to Interviewed" },
  { value: "no_show", label: "No-show", hint: "moves to Interviewed" },
  { value: "rescheduled", label: "Rescheduled", hint: "stage unchanged" },
];

export function OutcomeDialog({
  requisitionId,
  target,
  onClose,
}: OutcomeDialogProps) {
  const [outcome, setOutcome] = useState<RecordableOutcome | null>(null);
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const record = useRecordInterviewOutcome(requisitionId);

  // Reset per target.
  useEffect(() => {
    setOutcome(null);
    setNotes("");
    setValidationError(null);
  }, [target?.interview.id]);

  const submit = () => {
    if (target === null) return;
    if (outcome === null) {
      setValidationError("Choose an outcome.");
      return;
    }
    setValidationError(null);

    const body: OutcomeBody = {
      outcome,
      ...(notes.trim() === "" ? {} : { outcomeNotes: notes.trim() }),
    };

    record.mutate(
      { interview: target.interview, body },
      {
        onSuccess: () => {
          toast.success(
            outcome === "rescheduled"
              ? `Round ${target.interview.roundNumber} marked rescheduled — ${target.row.candidate.displayName} stays at Interview scheduled until the next round is set.`
              : `Outcome recorded for ${target.row.candidate.displayName}.`,
          );
          onClose();
        },
        onError: (error) => {
          setValidationError(
            error instanceof ApiError
              ? error.message
              : "Recording the outcome failed. Please try again.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Record outcome — round {target?.interview.roundNumber ?? ""}
          </DialogTitle>
          <DialogDescription>
            {target !== null
              ? `Interview outcome for ${target.row.candidate.displayName}. Passed, failed, and no-show move the candidate to Interviewed; rescheduled keeps them at Interview scheduled.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-neutral-700">
              Outcome
            </legend>
            <div
              role="radiogroup"
              aria-label="Outcome"
              className="grid grid-cols-2 gap-2"
            >
              {OUTCOME_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer flex-col rounded-md border px-3 py-2 text-sm transition-colors duration-fast",
                    outcome === option.value
                      ? "border-brand-blue bg-brand-blue-subtle text-brand-navy-ink"
                      : "border-border-default bg-surface-raised text-neutral-700 hover:bg-surface-subtle",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="interview-outcome"
                      value={option.value}
                      checked={outcome === option.value}
                      onChange={() => setOutcome(option.value)}
                      className="h-3.5 w-3.5 accent-current"
                    />
                    <span className="font-medium">{option.label}</span>
                  </span>
                  <span className="pl-5 text-xs text-neutral-500">
                    {option.hint}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="outcome-notes">Notes (optional)</Label>
            <Textarea
              id="outcome-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={5000}
              placeholder="How it went, follow-ups, feedback from the client."
            />
          </div>

          {validationError !== null ? (
            <p role="alert" className="text-sm text-danger-text">
              {validationError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={record.isPending} onClick={submit}>
            {record.isPending ? "Recording…" : "Record outcome"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
