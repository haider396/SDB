/**
 * Type-aware validation-rules editor. Renders ONLY the rule inputs that apply
 * to the current question type (guard-rails.ts), so an unknown key — 422
 * INVALID_VALIDATION_RULE — is impossible to produce by construction.
 * Controlled: emits a pruned ValidationRules object.
 */
import type { RateUnit, QuestionType, ValidationRules } from "@sdb/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  VALIDATION_KEYS_BY_TYPE,
  type ValidationRuleKey,
} from "../guard-rails";

const RULE_LABELS: Record<ValidationRuleKey, string> = {
  minLength: "Minimum length",
  maxLength: "Maximum length",
  min: "Minimum value",
  max: "Maximum value",
  minSelections: "Minimum selections",
  maxSelections: "Maximum selections",
  pattern: "Pattern (regular expression)",
  scaleMin: "Scale minimum",
  scaleMax: "Scale maximum",
  scaleMinLabel: "Label at minimum",
  scaleMaxLabel: "Label at maximum",
  currency: "Currency (3-letter code)",
  allowedUnits: "Allowed rate units",
  acceptedMimeTypes: "Accepted file types (comma separated)",
  maxFileSizeMb: "Maximum file size (MB)",
};

const RATE_UNITS: readonly RateUnit[] = ["hourly", "monthly"];

type NumberRuleKey =
  | "minLength"
  | "maxLength"
  | "min"
  | "max"
  | "minSelections"
  | "maxSelections"
  | "scaleMin"
  | "scaleMax"
  | "maxFileSizeMb";

type TextRuleKey = "pattern" | "scaleMinLabel" | "scaleMaxLabel" | "currency";

export function ValidationRulesEditor({
  questionType,
  value,
  onChange,
}: {
  questionType: QuestionType;
  value: ValidationRules;
  onChange: (next: ValidationRules) => void;
}) {
  const keys = VALIDATION_KEYS_BY_TYPE[questionType];
  if (keys.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        The {questionType.replace(/_/g, " ")} type has no configurable
        validation rules.
      </p>
    );
  }

  const set = (key: ValidationRuleKey, next: unknown) => {
    const draft: Record<string, unknown> = { ...value };
    if (
      next === undefined ||
      next === "" ||
      (Array.isArray(next) && next.length === 0)
    ) {
      delete draft[key];
    } else {
      draft[key] = next;
    }
    onChange(draft as ValidationRules);
  };

  const numberInput = (key: NumberRuleKey) => (
    <div key={key} className="space-y-1">
      <Label htmlFor={`rule-${key}`}>{RULE_LABELS[key]}</Label>
      <Input
        id={`rule-${key}`}
        type="number"
        inputMode="numeric"
        value={value[key] ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          set(key, raw === "" ? undefined : Number(raw));
        }}
      />
    </div>
  );

  const textInput = (key: TextRuleKey) => (
    <div key={key} className="space-y-1">
      <Label htmlFor={`rule-${key}`}>{RULE_LABELS[key]}</Label>
      <Input
        id={`rule-${key}`}
        value={value[key] ?? ""}
        onChange={(event) => set(key, event.target.value || undefined)}
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {keys.map((key) => {
        switch (key) {
          case "minLength":
          case "maxLength":
          case "min":
          case "max":
          case "minSelections":
          case "maxSelections":
          case "scaleMin":
          case "scaleMax":
          case "maxFileSizeMb":
            return numberInput(key);
          case "pattern":
          case "scaleMinLabel":
          case "scaleMaxLabel":
          case "currency":
            return textInput(key);
          case "allowedUnits":
            return (
              <fieldset key={key} className="space-y-1">
                <legend className="block text-sm font-medium text-neutral-800">
                  {RULE_LABELS.allowedUnits}
                </legend>
                <div className="flex items-center gap-4 pt-1">
                  {RATE_UNITS.map((unit) => {
                    const selected = value.allowedUnits ?? [];
                    const isChecked = selected.includes(unit);
                    return (
                      <label
                        key={unit}
                        className="flex items-center gap-1.5 text-sm text-neutral-700"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(event) =>
                            set(
                              "allowedUnits",
                              event.target.checked
                                ? [...selected, unit]
                                : selected.filter((entry) => entry !== unit),
                            )
                          }
                        />
                        {unit === "hourly" ? "Hourly" : "Monthly"}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          case "acceptedMimeTypes":
            return (
              <div key={key} className="space-y-1 sm:col-span-2">
                <Label htmlFor="rule-acceptedMimeTypes">
                  {RULE_LABELS.acceptedMimeTypes}
                </Label>
                <Input
                  id="rule-acceptedMimeTypes"
                  placeholder="application/pdf, image/png"
                  value={(value.acceptedMimeTypes ?? []).join(", ")}
                  onChange={(event) =>
                    set(
                      "acceptedMimeTypes",
                      event.target.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter((entry) => entry.length > 0),
                    )
                  }
                />
              </div>
            );
          default: {
            const unhandled: never = key;
            throw new Error(`Unhandled validation rule: ${String(unhandled)}`);
          }
        }
      })}
    </div>
  );
}
