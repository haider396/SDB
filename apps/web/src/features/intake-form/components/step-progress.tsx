/**
 * Named progress steps with backward navigation (05 §5 req 5, §4.4).
 * Completed steps are buttons — going back never loses data because RHF
 * state lives for the whole form, not per step.
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProgressStep {
  key: string;
  label: string;
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
  return (
    <nav aria-label="Form steps">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
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
                    isDone || isCurrent ? "bg-brand-blue" : "bg-border-default",
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
                    "flex h-4 w-4 items-center justify-center rounded-full text-[0.625rem] tabular-nums",
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
    </nav>
  );
}
