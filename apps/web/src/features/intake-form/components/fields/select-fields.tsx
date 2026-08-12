/**
 * single_select → RadioGroup at ≤5 options, native Select above that;
 * yes_no → segmented two-option control; scale → discrete 1–n segmented
 * control with min/max labels. (05 §5 mapping table.)
 */
import { NativeSelect } from "@/components/ui/native-select";
import {
  DEFAULT_SCALE_MAX,
  DEFAULT_SCALE_MIN,
} from "../../schema-builder";
import { describedBy, fieldId, GroupShell, InputShell } from "./field-shell";
import { SegmentedControl } from "./segmented";
import type { FieldProps } from "./types";

const RADIO_GROUP_MAX_OPTIONS = 5;

function RadioOptions({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  const groupDescribedBy = describedBy(question, error !== undefined);
  return (
    <div className="space-y-2" role="none">
      {question.options.map((option) => {
        const optionId = `${fieldId(question.key)}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={optionId}
            className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800"
          >
            <input
              id={optionId}
              type="radio"
              name={fieldId(question.key)}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              onBlur={onBlur}
              aria-describedby={groupDescribedBy}
              className="h-4 w-4 accent-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

export function SingleSelectField(props: FieldProps) {
  const { question, value, onChange, onBlur, error } = props;

  if (question.options.length <= RADIO_GROUP_MAX_OPTIONS) {
    return (
      <GroupShell question={question} error={error}>
        <RadioOptions {...props} />
      </GroupShell>
    );
  }

  return (
    <InputShell question={question} error={error}>
      <NativeSelect
        id={fieldId(question.key)}
        value={typeof value === "string" ? value : ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value)
        }
        onBlur={onBlur}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(question, error !== undefined)}
      >
        <option value="">Select an option…</option>
        {question.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </InputShell>
  );
}

export function YesNoField({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  return (
    <GroupShell question={question} error={error}>
      <SegmentedControl
        name={fieldId(question.key)}
        options={[
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]}
        value={value === true ? "yes" : value === false ? "no" : undefined}
        onChange={(selected) => onChange(selected === "yes")}
        onBlur={onBlur}
        invalid={error !== undefined}
        describedBy={describedBy(question, error !== undefined)}
      />
    </GroupShell>
  );
}

export function ScaleField({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  const min = question.validation.scaleMin ?? DEFAULT_SCALE_MIN;
  const max = question.validation.scaleMax ?? DEFAULT_SCALE_MAX;
  const steps = Array.from({ length: Math.max(max - min + 1, 0) }, (_, index) => {
    const step = min + index;
    return { value: String(step), label: String(step) };
  });

  return (
    <GroupShell question={question} error={error}>
      <SegmentedControl
        name={fieldId(question.key)}
        options={steps}
        value={typeof value === "number" ? String(value) : undefined}
        onChange={(selected) => onChange(Number(selected))}
        onBlur={onBlur}
        invalid={error !== undefined}
        describedBy={describedBy(question, error !== undefined)}
      />
      {question.validation.scaleMinLabel !== undefined ||
      question.validation.scaleMaxLabel !== undefined ? (
        <div className="flex justify-between text-xs text-neutral-500">
          <span>{question.validation.scaleMinLabel ?? min}</span>
          <span>{question.validation.scaleMaxLabel ?? max}</span>
        </div>
      ) : null}
    </GroupShell>
  );
}
