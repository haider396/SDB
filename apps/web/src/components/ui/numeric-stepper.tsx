/**
 * A number input with −/+ buttons and a unit suffix.
 *
 * Deliberately not a slider: every value it edits (padding, border width,
 * radius, shadow offsets) is something an admin wants to set exactly — "2px",
 * not "about there" — and a slider adds a real role="slider" / aria-valuetext
 * surface for no benefit.
 */
import { forwardRef, type ChangeEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NumericStepperProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  className?: string;
}

export const NumericStepper = forwardRef<HTMLInputElement, NumericStepperProps>(
  function NumericStepper(
    { id, label, value, onChange, min = 0, max = 200, step = 1, unit = "px", className },
    ref,
  ) {
    const clamp = (next: number): number => Math.min(max, Math.max(min, next));

    return (
      <div className={cn("space-y-1", className)}>
        <label
          htmlFor={id}
          className="block text-xs font-medium text-neutral-600"
        >
          {label}
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-border-default text-neutral-600 hover:bg-surface-subtle disabled:opacity-40"
            disabled={value <= min}
            onClick={() => onChange(clamp(value - step))}
          >
            <Minus className="h-3 w-3" aria-hidden="true" />
          </button>
          <input
            ref={ref}
            id={id}
            type="number"
            inputMode="numeric"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(clamp(next));
            }}
            className="h-7 w-full min-w-0 rounded-sm border border-border-default bg-surface-raised px-2 text-center text-xs tabular-nums"
          />
          <button
            type="button"
            aria-label={`Increase ${label}`}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-border-default text-neutral-600 hover:bg-surface-subtle disabled:opacity-40"
            disabled={value >= max}
            onClick={() => onChange(clamp(value + step))}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
          {unit !== "" ? (
            <span aria-hidden="true" className="text-2xs text-neutral-400">
              {unit}
            </span>
          ) : null}
        </div>
      </div>
    );
  },
);
