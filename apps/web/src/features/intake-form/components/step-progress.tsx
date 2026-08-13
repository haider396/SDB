/**
 * Named progress steps with backward navigation (05 §5 req 5, §4.4).
 * Completed steps are buttons — going back never loses data because RHF
 * state lives for the whole form, not per step.
 *
 * UX 3.5: a visible "Step {n} of {total}" line (with the current step's
 * question count) renders from step 1. Below sm the pill row compacts to
 * dots; the current label lives in the step line.
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProgressStep {
  key: string;
  label: string;
  /** Questions on this step, shown in the step line when known. */
  questionCount?: number;
}

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
      <p className="mt-2 text-xs text-neutral-500">
        Step <span className="tabular-nums">{currentIndex + 1}</span> of{" "}
        <span className="tabular-nums">{steps.length}</span>
        {current !== undefined ? (
          <span className="sm:hidden">: {current.label}</span>
        ) : null}
        {questionCount !== undefined ? (
          <>
            {" "}
            · <span className="tabular-nums">{questionCount}</span> question
            {questionCount === 1 ? "" : "s"}
          </>
        ) : null}
      </p>
    </div>
  );
}
