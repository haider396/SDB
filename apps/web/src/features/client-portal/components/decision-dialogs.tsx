/**
 * The three client decisions (01 §3 J6, AC-E2E-05):
 *
 * - Approve for interview — confirm dialog explaining what happens next,
 *   then POST /assignments/:id/approve-for-interview (optimistic).
 * - Request interview — confirm dialog, POST .../request-interview. The
 *   stage does not change; the caller shows an "interview requested" chip.
 * - Reject — structured client-actor reason (reasonOther required when
 *   Other), optional detail, POST /assignments/:id/reject. The rejection
 *   actor is derived server-side from the caller — never sent (AC-PL-09).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ClientVisibleAssignment, RejectBody } from "@sdb/contracts";
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
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import {
  fetchClientRejectionReasons,
  type RejectionReasonOption,
} from "../rejection-reasons";

// ---------------------------------------------------------------------------
// Simple confirm (approve / request interview)
// ---------------------------------------------------------------------------

export interface ConfirmDecisionDialogProps {
  row: ClientVisibleAssignment | null;
  title: (name: string) => string;
  /** What happens next, spelled out before they commit. */
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending: boolean;
  onConfirm: (row: ClientVisibleAssignment) => Promise<void>;
  onClose: () => void;
}

export function ConfirmDecisionDialog({
  row,
  title,
  description,
  confirmLabel,
  pendingLabel,
  isPending,
  onConfirm,
  onClose,
}: ConfirmDecisionDialogProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [row?.assignmentId]);

  const confirm = async () => {
    if (row === null) return;
    setError(null);
    try {
      await onConfirm(row);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Something went wrong. Please try again.",
      );
    }
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title(row?.displayName ?? "candidate")}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error !== null ? (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={() => void confirm()}>
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Structured rejection (client actor)
// ---------------------------------------------------------------------------

export interface ClientRejectDialogProps {
  row: ClientVisibleAssignment | null;
  isPending: boolean;
  /** Resolves on success; the chosen reason label is handed back so the
   * caller can show it on the now-muted card. */
  onReject: (
    row: ClientVisibleAssignment,
    body: RejectBody,
    reasonLabel: string,
  ) => Promise<void>;
  onClose: () => void;
}

export function ClientRejectDialog({
  row,
  isPending,
  onReject,
  onClose,
}: ClientRejectDialogProps) {
  const [reasonKey, setReasonKey] = useState("");
  const [otherText, setOtherText] = useState("");
  const [detail, setDetail] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const reasonsQuery = useQuery<RejectionReasonOption[]>({
    queryKey: ["rejection-reasons", "client"],
    queryFn: fetchClientRejectionReasons,
    staleTime: 5 * 60_000,
  });

  // Reset per target.
  useEffect(() => {
    setReasonKey("");
    setOtherText("");
    setDetail("");
    setValidationError(null);
  }, [row?.assignmentId]);

  const reasons = reasonsQuery.data ?? [];
  const chosen = reasons.find((reason) => reason.key === reasonKey);

  const submit = async () => {
    if (row === null) return;
    if (chosen === undefined) {
      setValidationError("Choose a reason so we can source better matches.");
      return;
    }
    if (chosen.isOther && otherText.trim() === "") {
      setValidationError("Describe the reason when choosing Other.");
      return;
    }
    setValidationError(null);

    // A real row id always goes as reasonId; an "Other" choice ALSO carries
    // the typed text as reasonOther so the report's free texts stay populated
    // (both fields are legal together — RejectBodySchema). Only the seeded
    // fallback (id null) sends the label as reasonOther instead.
    const body: RejectBody = {
      ...(chosen.id !== null ? { reasonId: chosen.id } : {}),
      ...(chosen.isOther
        ? { reasonOther: otherText.trim() }
        : chosen.id === null
          ? { reasonOther: chosen.label }
          : {}),
      ...(detail.trim() === "" ? {} : { detail: detail.trim() }),
    };
    const reasonLabel = chosen.isOther ? otherText.trim() : chosen.label;

    try {
      await onReject(row, body, reasonLabel);
      onClose();
    } catch (cause) {
      setValidationError(
        cause instanceof ApiError
          ? cause.message
          : "Rejecting failed. Please try again.",
      );
    }
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Decline {row?.displayName ?? "candidate"}
          </DialogTitle>
          <DialogDescription>
            Your reason goes straight to our recruiting team so the next
            candidates are a better fit. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="client-reject-reason">Reason</Label>
            <NativeSelect
              id="client-reject-reason"
              value={reasonKey}
              onChange={(event) => setReasonKey(event.target.value)}
              aria-invalid={validationError !== null && chosen === undefined}
            >
              <option value="">Choose a reason…</option>
              {reasons.map((reason) => (
                <option key={reason.key} value={reason.key}>
                  {reason.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          {chosen?.isOther === true ? (
            <div className="space-y-1.5">
              <Label htmlFor="client-reject-other">Describe the reason</Label>
              <Textarea
                id="client-reject-other"
                value={otherText}
                onChange={(event) => setOtherText(event.target.value)}
                maxLength={1000}
                aria-invalid={validationError !== null && otherText.trim() === ""}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="client-reject-detail">
              Anything else we should know? (optional)
            </Label>
            <Textarea
              id="client-reject-detail"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={5000}
              placeholder="Context that helps us refine the search."
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
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => void submit()}
          >
            {isPending ? "Declining…" : "Decline candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
