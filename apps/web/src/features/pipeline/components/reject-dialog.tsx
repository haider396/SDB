/**
 * Structured admin rejection (AC-PL-10/11): a reason from the live
 * GET /rejection-reasons taxonomy (actor=admin) OR free text when "Other",
 * plus optional detail. Submit maps to RejectBody: the row's real
 * `reasonId`; only when the taxonomy call failed and the seeded fallback is
 * in use (id null — see rejection-reasons.ts) does the label go as
 * `reasonOther` instead. The rejection actor is derived server-side from
 * the caller — never sent.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import type { AdminAssignmentRow, RejectBody } from "@sdb/contracts";
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
import { useRejectAssignment } from "../api";
import {
  fetchRejectionReasons,
  type RejectionReasonOption,
} from "../rejection-reasons";

export interface RejectDialogProps {
  requisitionId: string;
  row: AdminAssignmentRow | null;
  onClose: () => void;
}

export function RejectDialog({ requisitionId, row, onClose }: RejectDialogProps) {
  const [reasonKey, setReasonKey] = useState("");
  const [otherText, setOtherText] = useState("");
  const [detail, setDetail] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const reasonsQuery = useQuery<RejectionReasonOption[]>({
    queryKey: ["rejection-reasons", "admin"],
    queryFn: fetchRejectionReasons,
    staleTime: 5 * 60_000,
  });
  const reject = useRejectAssignment(requisitionId);

  // Reset per target.
  useEffect(() => {
    setReasonKey("");
    setOtherText("");
    setDetail("");
    setValidationError(null);
  }, [row?.id]);

  const reasons = reasonsQuery.data ?? [];
  const chosen = reasons.find((reason) => reason.key === reasonKey);
  // Submit stays disabled until a reason is chosen — and, for "Other",
  // until the free text is filled (AC-PL-10: a reason row is mandatory).
  const canSubmit =
    chosen !== undefined && (!chosen.isOther || otherText.trim() !== "");

  const submit = () => {
    if (row === null) return;
    if (chosen === undefined) {
      setValidationError("Choose a rejection reason.");
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

    reject.mutate(
      { assignmentId: row.id, body },
      {
        onSuccess: () => {
          toast.success(`${row.candidate.displayName} was rejected.`);
          onClose();
        },
        onError: (error) => {
          setValidationError(
            error instanceof ApiError
              ? error.message
              : "Rejecting failed. Please try again.",
          );
        },
      },
    );
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Reject {row?.candidate.displayName ?? "candidate"}
          </DialogTitle>
          <DialogDescription>
            Moves the assignment to a terminal stage and records the reason.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <NativeSelect
              id="reject-reason"
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
              <Label htmlFor="reject-other">Describe the reason</Label>
              <Textarea
                id="reject-other"
                value={otherText}
                onChange={(event) => setOtherText(event.target.value)}
                maxLength={1000}
                aria-invalid={
                  validationError !== null && otherText.trim() === ""
                }
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="reject-detail">Detail (optional)</Label>
            <Textarea
              id="reject-detail"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={5000}
              placeholder="Internal context for this rejection."
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
            disabled={!canSubmit || reject.isPending}
            onClick={submit}
          >
            {reject.isPending ? "Rejecting…" : "Reject candidate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
