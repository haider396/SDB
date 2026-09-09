/**
 * The checklist of reasons a form cannot go live.
 *
 * Why a panel and not a toast: this is a checklist, not a notification. A toast
 * that says "This form is not ready to go live." and vanishes is exactly what
 * left an admin with no idea which rule they had broken.
 *
 * ── The bug this extraction fixes ──────────────────────────────────────────
 * The panel used to render only while `status !== "active"`, which was correct
 * when a draft was the only thing that could be activated. "Publish changes"
 * then made a LIVE form publishable too — and its refusals landed in a panel
 * that was hidden precisely because the form was live. The toast still said
 * "See the list on the page"; there was no list. So an admin fixing a live
 * form was told nothing at all.
 *
 * It now shows whenever there is something publishable — a draft form, or a
 * live form holding a draft — and there is a reason it would be refused.
 */
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ActivationBlocker {
  id: string;
  message: string;
  /** Present when the builder can repair it in one click. */
  fix?: () => void;
}

export interface ActivationBlockersProps {
  blockers: readonly ActivationBlocker[];
  /** Rules only the server can check. Listed verbatim. */
  serverBlockers: readonly string[];
  /** The form is live. */
  isActive: boolean;
  /** An unpublished draft exists — on a live form, changes waiting to publish. */
  hasDraft: boolean;
}

export function ActivationBlockers({
  blockers,
  serverBlockers,
  isActive,
  hasDraft,
}: ActivationBlockersProps) {
  // Nothing to publish means nothing to warn about: a live form with no draft
  // has already passed this gate.
  const publishable = !isActive || hasDraft;
  if (!publishable) return null;
  if (blockers.length === 0 && serverBlockers.length === 0) return null;

  return (
    <section
      aria-label="Before this form can go live"
      className="rounded-md border border-warning bg-warning-subtle px-3 py-2.5"
    >
      <div className="flex items-center gap-1.5">
        <AlertTriangle
          className="h-3.5 w-3.5 shrink-0 text-warning-text"
          aria-hidden="true"
        />
        <h2 className="text-xs font-semibold text-warning-text">
          {isActive ? "Before these changes can go live" : "Before this form can go live"}
        </h2>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {blockers.map((blocker) => (
          <li
            key={blocker.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-neutral-800"
          >
            <span className="min-w-0 flex-1">{blocker.message}</span>
            {blocker.fix !== undefined ? (
              <Button size="sm" variant="secondary" onClick={blocker.fix}>
                Add it now
              </Button>
            ) : null}
          </li>
        ))}
        {/* A question deactivated in another tab, an orphaned conditional, a
            missing name question — things only the server can know. */}
        {serverBlockers.map((message) => (
          <li key={message} className="text-xs text-neutral-800">
            {message}
          </li>
        ))}
      </ul>
    </section>
  );
}
