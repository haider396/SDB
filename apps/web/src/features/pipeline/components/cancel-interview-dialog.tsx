/**
 * Cancel-interview confirmation (P6, 04 §10). POST /interviews/:id/cancel
 * sets outcome = cancelled and NEVER changes the assignment's stage — the
 * card stays at Interview scheduled until a new round is scheduled or the
 * candidate is moved on, and the dialog says so.
 */
import { toast } from "sonner";
import type { AdminAssignmentRow, Interview } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { useCancelInterview } from "../api";
import { formatInViewerTimezone } from "../interview-time";

export interface CancelInterviewTarget {
  row: AdminAssignmentRow;
  interview: Interview;
}

export interface CancelInterviewDialogProps {
  requisitionId: string;
  target: CancelInterviewTarget | null;
  onClose: () => void;
}

export function CancelInterviewDialog({
  requisitionId,
  target,
  onClose,
}: CancelInterviewDialogProps) {
  const cancel = useCancelInterview(requisitionId);

  const confirm = () => {
    if (target === null) return;
    cancel.mutate(target.interview, {
      onSuccess: () => {
        toast.success(
          `Round ${target.interview.roundNumber} cancelled. ${target.row.candidate.displayName} stays at Interview scheduled.`,
        );
        onClose();
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Cancelling the interview failed. Please try again.",
        );
      },
    });
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Cancel round {target?.interview.roundNumber ?? ""}?
          </DialogTitle>
          <DialogDescription>
            {target !== null
              ? `${target.row.candidate.displayName}'s interview${
                  target.interview.scheduledAt !== null
                    ? ` on ${formatInViewerTimezone(target.interview.scheduledAt)}`
                    : ""
                } will be cancelled. The candidate stays at Interview scheduled — schedule a new round or move them on afterwards.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Keep interview
          </Button>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={confirm}
          >
            {cancel.isPending ? "Cancelling…" : "Cancel interview"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
