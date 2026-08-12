/**
 * "Add note" from the card menu → PATCH /assignments/:id adminNote.
 * Admin-only text: never serialised to client-scoped callers (the
 * assignment contract's adminNote is internal by definition).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { AdminAssignmentRow } from "@sdb/contracts";
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
import { useUpdateAssignmentNote } from "../api";

export interface NoteDialogProps {
  requisitionId: string;
  row: AdminAssignmentRow | null;
  onClose: () => void;
}

export function NoteDialog({ requisitionId, row, onClose }: NoteDialogProps) {
  const [note, setNote] = useState("");
  const update = useUpdateAssignmentNote(requisitionId);

  useEffect(() => {
    setNote(row?.adminNote ?? "");
  }, [row?.id, row?.adminNote]);

  const submit = () => {
    if (row === null) return;
    const trimmed = note.trim();
    update.mutate(
      { assignmentId: row.id, adminNote: trimmed === "" ? null : trimmed },
      {
        onSuccess: () => {
          toast.success("Note saved.");
          onClose();
        },
        onError: (error) => {
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Saving the note failed.",
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
            Note on {row?.candidate.displayName ?? "candidate"}
          </DialogTitle>
          <DialogDescription>
            Internal admin note — never visible to the client.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="assignment-admin-note">Admin note</Label>
          <Textarea
            id="assignment-admin-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={5000}
            rows={5}
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={update.isPending} onClick={submit}>
            {update.isPending ? "Saving…" : "Save note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
