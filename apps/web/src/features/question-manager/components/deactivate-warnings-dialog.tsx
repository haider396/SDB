/**
 * Post-deactivation warnings dialog (AC-Q-09, 03 §2.3). The API deactivates
 * and answers 200 with warnings[] naming every question that conditionally
 * depends on this one; those dependents can no longer be revealed on the
 * form. The admin acknowledges — or reverses the toggle from right here.
 */
import type { Question, QuestionDeactivateWarning } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Chip } from "./chips";

export interface DeactivateWarningsState {
  question: Question;
  warnings: QuestionDeactivateWarning[];
}

export function DeactivateWarningsDialog({
  state,
  onReactivate,
  onClose,
}: {
  state: DeactivateWarningsState | null;
  onReactivate: (question: Question) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {state !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>
                “{state.question.label}” was deactivated — with warnings
              </DialogTitle>
              <DialogDescription>
                Deactivating it has these consequences:
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-2" aria-label="Consequences">
              {state.warnings.map((warning, index) => (
                <li
                  key={warning.dependent?.id ?? `${warning.code}-${String(index)}`}
                  className="flex items-center gap-2 rounded-md bg-surface-subtle px-3 py-2 text-sm text-neutral-800"
                >
                  {warning.dependent === null ? (
                    // A warning about the question itself — for instance that it
                    // fills a field on the candidate profile — so there is no
                    // other question to name.
                    <span className="min-w-0 flex-1">{warning.message}</span>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        {warning.dependent.label}
                      </span>
                      <span className="font-mono text-xs text-neutral-500">
                        {warning.dependent.key}
                      </span>
                      {!warning.dependent.isActive ? (
                        <Chip tone="warning">Inactive</Chip>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() => onReactivate(state.question)}
              >
                Undo — reactivate
              </Button>
              <Button onClick={onClose}>Keep deactivated</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
