/**
 * Type-aware validation-rules editor. Renders ONLY the rule inputs that apply
 * to the current question type (guard-rails.ts), so an unknown key — 422
 * INVALID_VALIDATION_RULE — is impossible to produce by construction.
 * Controlled: emits a pruned ValidationRules object.
 *
 * File types are the fixed NFR-5 list (@sdb/contracts nfr.ts) as labelled
 * checkboxes — free-typed MIME strings cannot drift from what the API
 * accepts. The pattern field offers common presets with a raw-regex escape
 * hatch and a live "test a value" probe.
 */
import { useState } from "react";
import type { RateUnit, QuestionType, ValidationRules } from "@sdb/contracts";
import { ACCEPTED_UPLOAD_MIME_TYPES } from "@sdb/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
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
  pattern: "Pattern",
  scaleMin: "Scale minimum",
  scaleMax: "Scale maximum",
  scaleMinLabel: "Label at minimum",
  scaleMaxLabel: "Label at maximum",
  currency: "Currency (3-letter code)",
  allowedUnits: "Allowed rate units",
  acceptedMimeTypes: "Accepted file types",
  maxFileSizeMb: "Maximum file size (MB)",
};

const RATE_UNITS: readonly RateUnit[] = ["hourly", "monthly"];

/** Friendly labels for the nine NFR-5 upload MIME types. */
const MIME_TYPE_LABELS: Record<
  (typeof ACCEPTED_UPLOAD_MIME_TYPES)[number],
  string
> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word document (DOCX)",
  "image/png": "PNG image",
  "image/jpeg": "JPEG image",
  "image/webp": "WebP image",
  "video/mp4": "MP4 video",
  "video/webm": "WebM video",
  "audio/mpeg": "MP3 audio",
  "audio/mp4": "M4A audio",
};

/** Pattern presets — the raw-regex input only appears for Custom. */
const PATTERN_PRESETS = [
  { key: "none", label: "None", pattern: "" },
  { key: "url", label: "URL", pattern: "^https?://.+" },
  { key: "digits", label: "Digits only", pattern: "^[0-9]+$" },
  {
    key: "email",
    label: "Email-like",
    pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
  },
  { key: "custom", label: "Custom regex", pattern: null },
] as const;
type PatternPresetKey = (typeof PATTERN_PRESETS)[number]["key"];

function presetForPattern(pattern: string | undefined): PatternPresetKey {
  if (pattern === undefined || pattern === "") return "none";
  const match = PATTERN_PRESETS.find((preset) => preset.pattern === pattern);
  return match?.key ?? "custom";
}

/** Live regex probe: pass/fail/invalid, computed safely. */
function testPattern(
  pattern: string,
  value: string,
): "pass" | "fail" | "invalid" {
  try {
    return new RegExp(pattern).test(value) ? "pass" : "fail";
  } catch {
    return "invalid";
  }
}

function PatternField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const [preset, setPreset] = useState<PatternPresetKey>(() =>
    presetForPattern(value),
  );
  const [testValue, setTestValue] = useState("");
  const pattern = value ?? "";
  const result = pattern === "" ? null : testPattern(pattern, testValue);

  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="space-y-1">
        <Label htmlFor="rule-pattern-preset">{RULE_LABELS.pattern}</Label>
        <NativeSelect
          id="rule-pattern-preset"
          value={preset}
          onChange={(event) => {
            const nextKey = event.target.value as PatternPresetKey;
            setPreset(nextKey);
            const chosen = PATTERN_PRESETS.find((entry) => entry.key === nextKey);
            if (chosen !== undefined && chosen.pattern !== null) {
              onChange(chosen.pattern === "" ? undefined : chosen.pattern);
            }
            // Custom keeps whatever is in the raw input.
          }}
        >
          {PATTERN_PRESETS.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {preset === "custom" ? (
        <div className="space-y-1">
          <Label htmlFor="rule-pattern">Regular expression</Label>
          <Input
            id="rule-pattern"
            className="font-mono"
            value={pattern}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        </div>
      ) : null}
      {pattern !== "" ? (
        <div className="space-y-1">
          <Label htmlFor="rule-pattern-test">Test a value</Label>
          <div className="flex items-center gap-2">
            <Input
              id="rule-pattern-test"
              value={testValue}
              placeholder="Type a sample answer…"
              onChange={(event) => setTestValue(event.target.value)}
            />
            {result === "invalid" ? (
              <span className="shrink-0 text-xs font-medium text-danger-text">
                Invalid regex
              </span>
            ) : result === "pass" ? (
              <span className="shrink-0 text-xs font-medium text-success-text">
                Pass
              </span>
            ) : (
              <span className="shrink-0 text-xs font-medium text-danger-text">
                Fail
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

type TextRuleKey = "scaleMinLabel" | "scaleMaxLabel" | "currency";

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
          case "scaleMinLabel":
          case "scaleMaxLabel":
          case "currency":
            return textInput(key);
          case "pattern":
            return (
              <PatternField
                key={key}
                value={value.pattern}
                onChange={(next) => set("pattern", next)}
              />
            );
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
          case "acceptedMimeTypes": {
            const selected = value.acceptedMimeTypes ?? [];
            return (
              <fieldset key={key} className="space-y-1 sm:col-span-2">
                <legend className="block text-sm font-medium text-neutral-800">
                  {RULE_LABELS.acceptedMimeTypes}
                </legend>
                <p className="text-xs text-neutral-500">
                  Leave all unticked to accept every supported type (NFR-5).
                </p>
                <div className="grid grid-cols-1 gap-1 pt-1 sm:grid-cols-2">
                  {ACCEPTED_UPLOAD_MIME_TYPES.map((mimeType) => {
                    const isChecked = selected.includes(mimeType);
                    return (
                      <label
                        key={mimeType}
                        className="flex items-center gap-1.5 text-sm text-neutral-700"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(event) =>
                            set(
                              "acceptedMimeTypes",
                              event.target.checked
                                ? [...selected, mimeType]
                                : selected.filter(
                                    (entry) => entry !== mimeType,
                                  ),
                            )
                          }
                        />
                        {MIME_TYPE_LABELS[mimeType]}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          }
          default: {
            const unhandled: never = key;
            throw new Error(`Unhandled validation rule: ${String(unhandled)}`);
          }
        }
      })}
    </div>
  );
}
