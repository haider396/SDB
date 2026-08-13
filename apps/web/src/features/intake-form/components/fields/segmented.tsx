/**
 * Segmented control built on native radio inputs: full keyboard behaviour
 * (arrow keys move and select, Tab enters/leaves the group) for free, with a
 * visible focus ring (AC-UI-04). Used by yes_no and scale.
 */
import { cn } from "@/lib/utils";

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  /** Radio group name — must be unique per question. */
  name: string;
  options: readonly SegmentedOption[];
  /** Currently selected option value, or undefined when unanswered. */
  value: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
  describedBy: string | undefined;
  /** Equal-width segments (yes/no); scale uses natural widths. */
  stretch?: boolean;
}

export function SegmentedControl({
  name,
  options,
  value,
  onChange,
  onBlur,
  invalid,
  describedBy,
  stretch = false,
}: SegmentedControlProps) {
  return (
    <div
      className={cn(
        // flex-wrap keeps a 1–10 scale usable at 360px-wide viewports.
        "inline-flex flex-wrap gap-1 rounded-md border border-border-default bg-surface-subtle p-1",
        invalid && "border-danger",
        stretch && "flex w-full",
      )}
    >
      {options.map((option) => (
        <label
          key={option.value}
          // `relative` contains the absolutely-positioned sr-only input; without
          // it the input escapes every overflow ancestor and stretches the page.
          className={cn("relative cursor-pointer", stretch && "flex-1")}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            onBlur={onBlur}
            aria-describedby={describedBy}
            className="peer sr-only"
          />
          <span
            className={cn(
              "flex h-8 min-w-9 items-center justify-center rounded-sm px-3 text-sm font-medium text-neutral-600 transition-colors duration-fast",
              "hover:text-neutral-900",
              "peer-checked:bg-surface-raised peer-checked:text-brand-navy-ink peer-checked:shadow-xs",
              "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-blue",
            )}
          >
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}
