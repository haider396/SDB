/**
 * currency_range → paired min/max inputs plus a prominent unit selector
 * (hourly/monthly). The unit is rendered first and large — this is the field
 * that causes the most expensive misunderstanding in the business
 * (05 §5 mapping table).
 */
import type { RateUnit } from "@sdb/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { allowedUnitsFor, DEFAULT_CURRENCY } from "../../schema-builder";
import { describedBy, fieldId, GroupShell } from "./field-shell";
import { SegmentedControl } from "./segmented";
import type { FieldProps } from "./types";

const UNIT_LABELS: Record<RateUnit, string> = {
  hourly: "Hourly",
  monthly: "Monthly",
};

interface DraftCurrencyRange {
  min?: number;
  max?: number;
  unit?: string;
  currency: string;
}

function draftFrom(value: unknown, currency: string): DraftCurrencyRange {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return {
      min: typeof record["min"] === "number" ? record["min"] : undefined,
      max: typeof record["max"] === "number" ? record["max"] : undefined,
      unit: typeof record["unit"] === "string" ? record["unit"] : undefined,
      currency:
        typeof record["currency"] === "string" ? record["currency"] : currency,
    };
  }
  return { currency };
}

export function CurrencyRangeField({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  const units = allowedUnitsFor(question.validation);
  const currency = question.validation.currency ?? DEFAULT_CURRENCY;
  const draft = draftFrom(value, currency);
  const groupDescribedBy = describedBy(question, error !== undefined);

  const update = (patch: Partial<DraftCurrencyRange>) => {
    const next = { ...draft, ...patch, currency };
    // Keep the RHF value undefined until anything is entered, so an optional
    // untouched range stays "blank" for validation and submission.
    if (next.min === undefined && next.max === undefined && next.unit === undefined) {
      onChange(undefined);
    } else {
      onChange(next);
    }
  };

  const amountInput = (
    bound: "min" | "max",
    label: string,
    placeholder: string,
  ) => {
    const id = `${fieldId(question.key)}-${bound}`;
    return (
      <div className="flex-1 space-y-1">
        <Label htmlFor={id} className="text-xs font-normal text-neutral-500">
          {label}
        </Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400"
          >
            {currency}
          </span>
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={question.validation.min}
            max={question.validation.max}
            placeholder={placeholder}
            value={draft[bound] ?? ""}
            onChange={(event) => {
              const parsed = event.target.valueAsNumber;
              const amount = Number.isNaN(parsed) ? undefined : parsed;
              update(bound === "min" ? { min: amount } : { max: amount });
            }}
            onBlur={onBlur}
            className="pl-12 tabular-nums"
            aria-invalid={error !== undefined || undefined}
            aria-describedby={groupDescribedBy}
          />
        </div>
      </div>
    );
  };

  return (
    <GroupShell question={question} error={error}>
      <div className="space-y-3">
        <SegmentedControl
          name={`${fieldId(question.key)}-unit`}
          options={units.map((unit) => ({
            value: unit,
            label: UNIT_LABELS[unit],
          }))}
          value={draft.unit}
          onChange={(unit) => update({ unit })}
          onBlur={onBlur}
          invalid={error !== undefined}
          describedBy={groupDescribedBy}
          stretch
        />
        <div className="flex gap-3">
          {amountInput("min", "Minimum", "Min")}
          {amountInput("max", "Maximum", "Max")}
        </div>
        <p className="text-xs text-neutral-500">
          {draft.unit !== undefined ? (
            <>
              Amounts are{" "}
              <strong className="font-semibold text-brand-navy-ink">
                per {draft.unit === "hourly" ? "hour" : "month"}
              </strong>{" "}
              in {currency}.
            </>
          ) : (
            <>Choose hourly or monthly first — amounts are in {currency}.</>
          )}
        </p>
      </div>
    </GroupShell>
  );
}
