/**
 * Brief editor: plain-text markdown source in a textarea with a preview
 * toggle. The preview is a deliberately minimal renderer — paragraphs split
 * on blank lines, line breaks preserved — no markdown library, no HTML
 * injection surface. Dirty-guarded (AC-UI-09).
 */
import { Eye, PenLine } from "lucide-react";
import { useEffect, useState } from "react";
import type { RequisitionDetail } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { useUpdateRequisition } from "../api";

/** Minimal, safe "markdown" preview: paragraphs + preserved line breaks. */
export function BriefPreview({ source }: { source: string }) {
  const paragraphs = source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  if (paragraphs.length === 0) {
    return <p className="text-sm text-neutral-500">Nothing drafted yet.</p>;
  }
  return (
    <div className="space-y-3">
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800"
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}

export function BriefCard({ requisition }: { requisition: RequisitionDetail }) {
  const updateRequisition = useUpdateRequisition();
  const savedBrief = requisition.briefMarkdown ?? "";
  const [draft, setDraft] = useState(savedBrief);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [error, setError] = useState<string | null>(null);

  // Track server updates (e.g. another surface saved) while not editing.
  useEffect(() => {
    setDraft(savedBrief);
  }, [savedBrief]);

  const isDirty = draft !== savedBrief;
  useDirtyGuard(isDirty);

  const save = async () => {
    setError(null);
    try {
      await updateRequisition.mutateAsync({
        id: requisition.id,
        body: { briefMarkdown: draft.trim() === "" ? null : draft },
      });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not save the brief.",
      );
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Brief</CardTitle>
        <div className="flex items-center gap-1" role="group" aria-label="Brief mode">
          <Button
            variant={mode === "write" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={mode === "write"}
            onClick={() => setMode("write")}
          >
            <PenLine aria-hidden="true" />
            Write
          </Button>
          <Button
            variant={mode === "preview" ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            <Eye aria-hidden="true" />
            Preview
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "write" ? (
          <div className="space-y-1.5">
            <Label htmlFor="requisition-brief" className="sr-only">
              Brief markdown
            </Label>
            <Textarea
              id="requisition-brief"
              rows={10}
              placeholder="Draft the role brief the principal will approve…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
        ) : (
          <BriefPreview source={draft} />
        )}
        {error !== null ? (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          {isDirty ? (
            <span className="text-xs text-neutral-500">Unsaved changes</span>
          ) : null}
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!isDirty || updateRequisition.isPending}
          >
            {updateRequisition.isPending ? "Saving…" : "Save brief"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
