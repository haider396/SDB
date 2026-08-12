/**
 * The principal's approval task (01 §3 J3, AC-E2E — J3 journey): rendered
 * ONLY when the requisition is pending_principal_approval AND the signed-in
 * user IS the designated principal (me.user.id === principalUserId). The
 * caller enforces that; this component just renders the two actions:
 *
 * - Approve → confirm dialog → POST /requisitions/:id/principal-approve
 * - Request changes → dialog with a REQUIRED comment →
 *   POST /requisitions/:id/principal-request-changes
 */
import { CheckCircle2, MessageSquareWarning, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { RequisitionDetail } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { usePrincipalApprove, usePrincipalRequestChanges } from "../api";

export function PrincipalApprovalPanel({
  requisition,
}: {
  requisition: RequisitionDetail;
}) {
  const approve = usePrincipalApprove();
  const requestChanges = usePrincipalRequestChanges();

  const [openDialog, setOpenDialog] = useState<"approve" | "changes" | null>(
    null,
  );
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpenDialog(null);
    setComment("");
    setError(null);
  };

  const confirmApprove = async () => {
    setError(null);
    try {
      await approve.mutateAsync({ id: requisition.id });
      toast.success("Brief approved — sourcing starts now.");
      close();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not approve the brief. Please try again.",
      );
    }
  };

  const confirmChanges = async () => {
    if (comment.trim() === "") {
      setError("Describe the changes you need — the comment is required.");
      return;
    }
    setError(null);
    try {
      await requestChanges.mutateAsync({
        id: requisition.id,
        comment: comment.trim(),
      });
      toast.success("Change request sent to your SDB team.");
      close();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not send the change request. Please try again.",
      );
    }
  };

  return (
    <Card className="border border-warning bg-warning-subtle">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <ShieldCheck aria-hidden="true" className="h-4 w-4 text-warning-text" />
        <CardTitle className="text-base">Your approval is needed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-neutral-600">
          As the principal for this hire, review the brief below. Approving
          starts candidate sourcing; requesting changes sends it back to the
          team with your comment.
        </p>
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={() => setOpenDialog("approve")}>
            <CheckCircle2 aria-hidden="true" />
            Approve brief
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpenDialog("changes")}
          >
            <MessageSquareWarning aria-hidden="true" />
            Request changes
          </Button>
        </div>
      </CardContent>

      {/* ----- Approve confirm ----- */}
      <Dialog
        open={openDialog === "approve"}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this brief?</DialogTitle>
            <DialogDescription>
              Sourcing starts immediately: our recruiters will begin finding
              and vetting candidates against this brief. You will be notified
              when the first candidates are ready to review.
            </DialogDescription>
          </DialogHeader>
          {error !== null ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={approve.isPending}
              onClick={() => void confirmApprove()}
            >
              {approve.isPending ? "Approving…" : "Approve brief"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----- Request changes (comment required) ----- */}
      <Dialog
        open={openDialog === "changes"}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request changes to the brief</DialogTitle>
            <DialogDescription>
              Tell the team what needs to change. The brief comes back to you
              for approval once it is revised.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="principal-change-comment">What should change?</Label>
            <Textarea
              id="principal-change-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={5000}
              rows={4}
              aria-invalid={error !== null && comment.trim() === ""}
            />
          </div>
          {error !== null ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={requestChanges.isPending}
              onClick={() => void confirmChanges()}
            >
              {requestChanges.isPending ? "Sending…" : "Send change request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
