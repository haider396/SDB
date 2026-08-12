/**
 * Destructive archive confirmation: the admin must type the question's label
 * before the Archive button arms (05 §4.4, AC-UI-10). Archive is a soft
 * delete — answers stay intact (03 §1.5). Mapped questions never reach this
 * dialog (the row action is disabled), but the API's 409 is still surfaced
 * in case of a race.
 */
import { useEffect, useState } from "react";
import type { Question } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useArchiveQuestion } from "../api";

export function ArchiveQuestionDialog({
  question,
  onClose,
}: {
  question: Question | null;
  onClose: () => void;
}) {
  const archiveQuestion = useArchiveQuestion();
  const [typedName, setTypedName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset the challenge whenever a new target opens.
  useEffect(() => {
    setTypedName("");
    setError(null);
  }, [question?.id]);

  const isArmed = question !== null && typedName === question.label;

  const confirm = async () => {
    if (question === null || !isArmed) return;
    try {
      await archiveQuestion.mutateAsync({
        id: question.id,
        categoryId: question.categoryId,
      });
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "MAPPED_QUESTION_PROTECTED") {
        setError(
          "This is a mapped question — its answers fill first-class requisition fields, so it cannot be archived. Deactivate it instead.",
        );
      } else {
        setError(
          cause instanceof ApiError
            ? cause.message
            : "Could not archive the question.",
        );
      }
    }
  };

  return (
    <Dialog
      open={question !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {question !== null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <DialogHeader>
              <DialogTitle>Archive “{question.label}”?</DialogTitle>
              <DialogDescription>
                The question disappears from all forms and lists. Existing
                answers are kept. This cannot be undone from the portal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="archive-confirm-name">
                Type <span className="font-semibold">{question.label}</span> to
                confirm
              </Label>
              <Input
                id="archive-confirm-name"
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                autoComplete="off"
              />
              {error !== null ? (
                <p role="alert" className="text-xs text-danger-text">
                  {error}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={!isArmed || archiveQuestion.isPending}
              >
                {archiveQuestion.isPending ? "Archiving…" : "Archive question"}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
