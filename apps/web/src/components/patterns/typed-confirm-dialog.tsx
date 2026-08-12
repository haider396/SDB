/**
 * Destructive confirmation requiring the object name typed back (05 §4.4,
 * AC-UI-10). Generic over the action: the caller supplies the mutation via
 * onConfirm and surfaces nothing itself — API failures render inline here.
 */
import { useEffect, useState, type ReactNode } from "react";
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

export interface TypedConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** What happens if they proceed — a full sentence or two. */
  description: ReactNode;
  /** The exact string the user must type to arm the button. */
  confirmName: string;
  confirmLabel: string;
  pendingLabel: string;
  /** Reject to keep the dialog open with the error inline. */
  onConfirm: () => Promise<void>;
  /** Map an ApiError to a friendlier sentence; return null to use default. */
  mapError?: (error: ApiError) => string | null;
}

export function TypedConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmName,
  confirmLabel,
  pendingLabel,
  onConfirm,
  mapError,
}: TypedConfirmDialogProps) {
  const [typedName, setTypedName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Reset the challenge whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setTypedName("");
      setError(null);
      setIsPending(false);
    }
  }, [open]);

  const isArmed = typedName === confirmName;

  const confirm = async () => {
    if (!isArmed || isPending) return;
    setIsPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(mapError?.(cause) ?? cause.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
      setIsPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="typed-confirm-name">
              Type <span className="font-semibold">{confirmName}</span> to
              confirm
            </Label>
            <Input
              id="typed-confirm-name"
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
              disabled={!isArmed || isPending}
            >
              {isPending ? pendingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
