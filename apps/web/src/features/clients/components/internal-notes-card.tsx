/**
 * Internal notes editor (right rail). The `internalNotes` key is admin-only
 * and ABSENT for client-scoped callers — the card renders only when the key
 * is present, so a scoped payload never crashes or shows an empty editor.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Client } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { useUpdateClient } from "../api";

export function InternalNotesCard({ client }: { client: Client }) {
  const updateClient = useUpdateClient();
  const savedNotes = client.internalNotes ?? "";
  const [notes, setNotes] = useState(savedNotes);
  const [error, setError] = useState<string | null>(null);

  // Refresh the draft when another surface updates the client.
  useEffect(() => {
    setNotes(savedNotes);
  }, [savedNotes]);

  if (!("internalNotes" in client)) return null;

  const isDirty = notes !== savedNotes;

  const save = async () => {
    setError(null);
    try {
      await updateClient.mutateAsync({
        id: client.id,
        body: { internalNotes: notes.trim() === "" ? null : notes },
      });
      toast.success("Internal notes saved.");
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not save the notes.",
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Internal notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="client-internal-notes" className="sr-only">
          Internal notes
        </Label>
        <Textarea
          id="client-internal-notes"
          rows={5}
          placeholder="Visible to admins only…"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
        {error !== null ? (
          <p role="alert" className="text-xs text-danger-text">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void save()}
            disabled={!isDirty || updateClient.isPending}
          >
            {updateClient.isPending ? "Saving…" : "Save notes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
