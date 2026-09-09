/**
 * The two per-form steps that are not blocks: the typing test and documents.
 *
 * ── Why this panel exists ──────────────────────────────────────────────────
 * `hasTypingTest` and `hasDocumentsStep` are columns on `candidate_forms`, and
 * the whole stack supported them — DB, repository, contracts, the PATCH route,
 * the public renderer — except that nothing in the admin UI ever set them. So
 * every form built in the builder shipped with both off and no way to change
 * it: candidates were never asked for a CV and never took the typing test.
 * Same class of gap as the missing "New draft" and "Publish changes" buttons —
 * capability built server-side, unreachable from the app.
 *
 * ── Why it looks different from its neighbours ─────────────────────────────
 * Everything else in the builder's left column edits the DRAFT DOCUMENT: it is
 * undoable with Ctrl+Z and waits for Save. These two are FORM-level and persist
 * the instant they are ticked. Two controls that look alike but persist
 * differently is exactly how the original bug hid, so this one is bordered,
 * separately headed, and says so in words.
 */
import { toast } from "sonner";

export interface ExtraStepsPanelProps {
  hasTypingTest: boolean;
  hasDocumentsStep: boolean;
  /** True while a save is in flight — both boxes disable together. */
  isSaving: boolean;
  /** A live form has no draft between this change and a candidate. */
  isLive: boolean;
  /** Persists one flag. Rejection is surfaced by the toast, not swallowed. */
  onChange: (patch: {
    hasTypingTest?: boolean;
    hasDocumentsStep?: boolean;
  }) => Promise<unknown>;
}

export function ExtraStepsPanel({
  hasTypingTest,
  hasDocumentsStep,
  isSaving,
  isLive,
  onChange,
}: ExtraStepsPanelProps) {
  function save(
    patch: { hasTypingTest?: boolean; hasDocumentsStep?: boolean },
    on: string,
    off: string,
    next: boolean,
  ): void {
    void toast.promise(onChange(patch), {
      loading: "Saving…",
      success: next ? on : off,
      error: (error) =>
        error instanceof Error ? error.message : "Could not save that.",
    });
  }

  return (
    <section className="space-y-2 rounded-md border border-neutral-200 p-2">
      <h2 className="text-2xs font-semibold uppercase tracking-wide text-neutral-500">
        Extra steps
      </h2>
      <p className="text-2xs text-neutral-500">
        Added after your steps, before consent. Saved as soon as you tick them —
        not part of the draft.
      </p>

      <label className="flex items-start gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={hasTypingTest}
          disabled={isSaving}
          onChange={(event) =>
            save(
              { hasTypingTest: event.target.checked },
              "Candidates will take the typing test.",
              "Typing test removed.",
              event.target.checked,
            )
          }
        />
        <span>
          Typing speed test
          <span className="block text-2xs text-neutral-500">
            Records words per minute.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={hasDocumentsStep}
          disabled={isSaving}
          onChange={(event) =>
            save(
              { hasDocumentsStep: event.target.checked },
              "Candidates will be asked for a CV.",
              "Documents step removed.",
              event.target.checked,
            )
          }
        />
        <span>
          Documents
          <span className="block text-2xs text-neutral-500">
            CV upload and photo.
          </span>
        </span>
      </label>

      {isLive ? (
        /* Unlike a block edit, which waits for Publish changes, nothing stands
           between this tick and the next candidate to open the link. */
        <p className="text-2xs text-warning-text">
          This form is live — a change here applies straight away.
        </p>
      ) : null}
    </section>
  );
}
