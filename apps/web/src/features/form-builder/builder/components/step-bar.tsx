/**
 * The step (section) bar: switch between steps, rename one, remove one, add one.
 *
 * Steps had no controls at all, so a form seeded from the registration template
 * was stuck at five of them — you could edit every field on a step but never
 * remove the step itself.
 *
 * Deleting a step deletes its blocks with it, so unlike a single field this one
 * DOES confirm. Undo would recover it, but "where did those eight questions
 * go?" is not a good moment to be discovering the undo button.
 */
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { FormPage } from "@sdb/contracts";
import { TypedConfirmDialog } from "@/components/patterns/typed-confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface StepBarProps {
  pages: readonly FormPage[];
  activeIndex: number;
  /** Blocks per step, so the confirmation can say what is being removed. */
  blockCountFor: (pageIndex: number) => number;
  onSelect: (index: number) => void;
  onAdd: (title: string) => void;
  onRename: (index: number, title: string, description: string | null) => void;
  onDelete: (index: number) => void;
}

export function StepBar({
  pages,
  activeIndex,
  blockCountFor,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: StepBarProps) {
  const [renaming, setRenaming] = useState<FormPage | null>(null);
  const [deleting, setDeleting] = useState<FormPage | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const active = pages.find((page) => page.index === activeIndex);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {pages.map((page) => (
          <Button
            key={page.index}
            size="sm"
            variant={page.index === activeIndex ? "primary" : "ghost"}
            onClick={() => onSelect(page.index)}
          >
            {page.title}
            <span className="ml-1.5 text-2xs opacity-60">
              {blockCountFor(page.index)}
            </span>
          </Button>
        ))}

        <span aria-hidden="true" className="mx-1 h-4 w-px bg-neutral-200" />

        {active !== undefined ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Rename the step "${active.title}"`}
              title="Rename this step"
              onClick={() => {
                setTitle(active.title);
                setDescription(active.description ?? "");
                setRenaming(active);
              }}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            {/* The last step cannot go — a form with no steps has nowhere to
                put anything, and the document schema requires at least one. */}
            {pages.length > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete the step "${active.title}"`}
                title="Delete this step"
                onClick={() => setDeleting(active)}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger-text" aria-hidden="true" />
              </Button>
            ) : null}
          </>
        ) : null}

        <Button
          size="sm"
          variant="secondary"
          onClick={() => onAdd(`Step ${String(pages.length + 1)}`)}
        >
          <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
          Add step
        </Button>
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename step</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="step-title">Title</Label>
              <Input
                id="step-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="step-description">
                Description
                <span className="ml-1 font-normal text-neutral-500">(optional)</span>
              </Label>
              <Textarea
                id="step-description"
                value={description}
                placeholder="Shown under the step title on the form."
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={title.trim() === ""}
              onClick={() => {
                if (renaming === null) return;
                onRename(
                  renaming.index,
                  title.trim(),
                  description.trim() === "" ? null : description.trim(),
                );
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TypedConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete the step "${deleting?.title ?? ""}"?`}
        description={
          <>
            {(() => {
              const count = deleting === null ? 0 : blockCountFor(deleting.index);
              return count === 0
                ? "This step is empty."
                : `The ${String(count)} block${count === 1 ? "" : "s"} on this step ${count === 1 ? "is" : "are"} removed with it.`;
            })()}{" "}
            Nothing is saved until you press Save, and Undo will bring it back.
          </>
        }
        confirmName={deleting?.title ?? ""}
        confirmLabel="Delete step"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (deleting === null) return;
          onDelete(deleting.index);
          setDeleting(null);
          return Promise.resolve();
        }}
      />
    </>
  );
}
