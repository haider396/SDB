/**
 * The SDB palette, as a swatch grid.
 *
 * ⚠ There is no free-text field and no colour input by design. Haider chose
 * "brand palette only", and the closed FORM_COLOR_TOKENS enum is what actually
 * enforces it — the AC-UI-01 lint rule is static and would never catch a hex
 * arriving from the database.
 *
 * Each swatch paints itself with `var(--token)`, so the swatch and the rendered
 * form can never disagree about what a token looks like.
 */
import { Check } from "lucide-react";
import { FORM_COLOR_TOKENS, type FormColorToken } from "@sdb/contracts";
import { cn } from "@/lib/utils";

/** Human labels; the token name itself is the accessible fallback. */
const LABELS: Partial<Record<FormColorToken, string>> = {
  "brand-navy": "Brand navy",
  "brand-navy-deep": "Deep navy",
  "brand-navy-ink": "Ink",
  "brand-blue": "Brand blue",
  "brand-slate": "Slate",
  "brand-teal": "Teal",
  "brand-on-dark": "White",
  "surface-page": "Page",
  "surface-raised": "Card",
  "surface-subtle": "Subtle",
  "surface-inverse": "Inverse",
  "border-default": "Border",
  transparent: "None",
};

function labelFor(token: FormColorToken): string {
  return LABELS[token] ?? token.replace(/-/g, " ");
}

export interface ColorTokenPickerProps {
  id: string;
  label: string;
  value: FormColorToken | undefined;
  onChange: (token: FormColorToken) => void;
  /** Shown when nothing is set, so "inherit" is visible rather than implied. */
  inheritLabel?: string;
}

export function ColorTokenPicker({
  id,
  label,
  value,
  onChange,
  inheritLabel = "Inherited",
}: ColorTokenPickerProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span id={`${id}-label`} className="text-xs font-medium text-neutral-600">
          {label}
        </span>
        <span className="text-2xs text-neutral-400">
          {value === undefined ? inheritLabel : labelFor(value)}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="grid grid-cols-9 gap-1"
      >
        {FORM_COLOR_TOKENS.map((token) => {
          const selected = value === token;
          return (
            <button
              key={token}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={labelFor(token)}
              title={labelFor(token)}
              onClick={() => onChange(token)}
              // The swatch IS the token — no parallel colour list to drift.
              style={{ background: `var(--${token})` }}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-sm ring-1 ring-inset ring-neutral-300",
                selected && "ring-2 ring-brand-blue",
                token === "transparent" && "bg-surface-raised",
              )}
            >
              {selected ? (
                <Check
                  className="h-3 w-3 text-brand-on-dark mix-blend-difference"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
