/**
 * Small text chips for question metadata (type, required, audience, active)
 * and the accessible active toggle. Status is never colour-only — every chip
 * carries text (05 §4.6, AC-UI-03).
 */
import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "info" | "warning" | "success" | "danger";

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  info: "bg-info-subtle text-info",
  warning: "bg-warning-subtle text-warning-text",
  success: "bg-success-subtle text-success-text",
  danger: "bg-danger-subtle text-danger-text",
};

export function Chip({
  tone = "neutral",
  children,
  className,
}: {
  tone?: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Accessible switch: role="switch" button with a visible track + label. */
export function ActiveToggle({
  isActive,
  label,
  onChange,
  disabled,
}: {
  isActive: boolean;
  /** Accessible name, e.g. `Active: Budget questions`. */
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isActive}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!isActive)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-fast disabled:pointer-events-none disabled:opacity-50",
        isActive ? "bg-brand-blue" : "bg-neutral-300",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-surface-raised shadow-xs transition-transform duration-fast",
          isActive ? "translate-x-[1.125rem]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
