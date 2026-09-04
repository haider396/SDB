/**
 * Named progress steps with backward navigation (05 §5 req 5, §4.4).
 * Completed steps are buttons — going back never loses data because RHF
 * state lives for the whole form, not per step.
 *
 * UX 3.5: a visible "Step {n} of {total}" line (with the current step's
 * question count) renders from step 1.
 *
 * TWO PRESENTATIONS, chosen by step count:
 *
 * - **≤ COMPACT_THRESHOLD steps** — labelled pills with connectors. Readable
 *   and fits comfortably on one line at the intake form's 3–4 steps.
 * - **more than that** — a segmented progress bar. The pill row wrapped onto
 *   three lines at the registration form's 8 steps (T38), leaving connector
 *   dashes dangling at line breaks and reading as noise rather than progress.
 *   Segments never wrap, scale to any count, and put the position in the step
 *   line underneath where there is room for it.
 *
 * Both keep the same affordances: completed steps are clickable, the current
 * step carries `aria-current="step"`, and every segment has an accessible name.
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProgressStep {
  key: string;
  label: string;
  /** Questions on this step, shown in the step line when known. */
  questionCount?: number;
}

/** Above this many steps, labelled pills stop fitting on one line. */
const COMPACT_THRESHOLD = 5;

export function StepProgress({
  steps,
  currentIndex,
  onNavigate,
}: {
  steps: readonly ProgressStep[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}) {
  const current = steps[currentIndex];
  const questionCount = current?.questionCount;
  const isCompact = steps.length > COMPACT_THRESHOLD;

  // Secondary, not Meta: "Step 2 of 6" is the only place a candidate on a phone
  // can see how much is left, and at Meta it fails AA on the page background
  // (4.11:1 against 4.5:1).
  const stepLine = (
    <p className="mt-2 text-xs text-neutral-600">
      Step <span className="tabular-nums">{currentIndex + 1}</span> of{" "}
      <span className="tabular-nums">{steps.length}</span>
      {current !== undefined ? (
        <span className={isCompact ? undefined : "sm:hidden"}>
          {isCompact ? " · " : ": "}
          <span className="font-medium text-brand-navy-ink">
            {current.label}
          </span>
        </span>
      ) : null}
      {questionCount !== undefined ? (
        <>
          {" "}
          · <span className="tabular-nums">{questionCount}</span> question
          {questionCount === 1 ? "" : "s"}
        </>
      ) : null}
    </p>
  );

  if (isCompact) {
    return (
      <div>
        <nav aria-label="Form steps">
          {/* Segments sit in a taller button so the hit area clears 24px
              while the bar itself stays a thin 6px rule. */}
          <ol className="flex items-center gap-1.5">
            {steps.map((step, index) => {
              const isCurrent = index === currentIndex;
              const isDone = index < currentIndex;
              return (
                <li key={step.key} className="min-w-0 flex-1">
                  <button
                    type="button"
                    disabled={!isDone}
                    onClick={() => onNavigate(index)}
                    aria-current={isCurrent ? "step" : undefined}
                    className={cn(
                      "group flex w-full items-center rounded-sm py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
                      isDone && "cursor-pointer",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-1.5 w-full rounded-full motion-safe:transition-colors motion-safe:duration-fast",
                        // 05 §3.5: determinate progress uses --gradient-progress
                        isDone && "bg-gradient-progress group-hover:opacity-80",
                        isCurrent && "bg-brand-blue",
                        !isDone && !isCurrent && "bg-neutral-200",
                      )}
                    />
                    <span className="sr-only">
                      Step {index + 1} of {steps.length}: {step.label}
                      {isDone ? " (completed)" : isCurrent ? " (current)" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        {stepLine}
      </div>
    );
  }

  return (
    <div>
      <nav aria-label="Form steps">
        {/* Full pills from sm up */}
        <ol className="hidden flex-wrap items-center gap-x-1 gap-y-2 sm:flex">
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex;
            const isDone = index < currentIndex;
            return (
              <li key={step.key} className="flex items-center gap-1">
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mx-1 h-px w-4 sm:w-6",
                      // 05 §3.5: determinate progress uses --gradient-progress
                      isDone || isCurrent
                        ? "bg-gradient-progress"
                        : "bg-border-default",
                    )}
                  />
                ) : null}
                <button
                  type="button"
                  disabled={!isDone}
                  onClick={() => onNavigate(index)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
                    isCurrent && "bg-brand-blue-subtle text-brand-blue",
                    isDone &&
                      "cursor-pointer text-neutral-600 hover:bg-surface-subtle",
                    !isCurrent && !isDone && "text-neutral-400",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full text-2xs tabular-nums",
                      isCurrent && "bg-brand-blue text-brand-on-dark",
                      isDone && "bg-success-subtle text-success-text",
                      !isCurrent && !isDone && "bg-surface-subtle",
                    )}
                  >
                    {isDone ? <Check className="h-3 w-3" /> : index + 1}
                  </span>
                  {step.label}
                </button>
              </li>
            );
          })}
        </ol>

        {/* Compact dots below sm; the step line below carries the label */}
        <ol className="flex items-center gap-2 sm:hidden">
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex;
            const isDone = index < currentIndex;
            return (
              <li key={step.key}>
                <button
                  type="button"
                  disabled={!isDone}
                  onClick={() => onNavigate(index)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
                    isDone && "cursor-pointer",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2.5 w-2.5 rounded-full transition-colors duration-fast",
                      isCurrent && "bg-brand-blue",
                      isDone && "bg-success",
                      !isCurrent && !isDone && "bg-border-default",
                    )}
                  />
                  <span className="sr-only">
                    Step {index + 1}: {step.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Visible step position from step 1 (UX 3.5) */}
      {stepLine}
    </div>
  );
}
