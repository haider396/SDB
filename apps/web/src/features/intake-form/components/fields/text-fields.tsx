/**
 * short_text / email / phone → Input with the appropriate type + inputMode;
 * long_text → auto-growing Textarea with a character counter when maxLength
 * is set; number → Input type=number with tabular numerals; date → native
 * date input (ISO on the wire, localised display). (05 §5 mapping table.)
 */
import { useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describedBy, fieldId, InputShell } from "./field-shell";
import type { FieldProps } from "./types";

const TEXT_INPUT_ATTRIBUTES = {
  short_text: { type: "text", inputMode: undefined, autoComplete: undefined },
  email: { type: "email", inputMode: "email", autoComplete: "email" },
  phone: { type: "tel", inputMode: "tel", autoComplete: "tel" },
} as const;

export function TextField({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  const kind =
    question.questionType === "email" || question.questionType === "phone"
      ? question.questionType
      : "short_text";
  const attributes = TEXT_INPUT_ATTRIBUTES[kind];
  return (
    <InputShell question={question} error={error}>
      <Input
        id={fieldId(question.key)}
        type={attributes.type}
        inputMode={attributes.inputMode}
        autoComplete={attributes.autoComplete}
        placeholder={question.placeholder ?? undefined}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(question, error !== undefined)}
      />
    </InputShell>
  );
}

export function LongTextField({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const text = typeof value === "string" ? value : "";
  const maxLength = question.validation.maxLength;
  const countId = `${fieldId(question.key)}-count`;

  const autoGrow = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  return (
    <InputShell question={question} error={error}>
      <Textarea
        id={fieldId(question.key)}
        ref={textareaRef}
        rows={3}
        placeholder={question.placeholder ?? undefined}
        value={text}
        maxLength={maxLength}
        onChange={(event) => {
          onChange(event.target.value);
          autoGrow();
        }}
        onBlur={onBlur}
        className="resize-none overflow-hidden"
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(
          question,
          error !== undefined,
          maxLength !== undefined ? [countId] : [],
        )}
      />
      {maxLength !== undefined ? (
        <p id={countId} className="text-right text-xs tabular-nums text-neutral-400">
          {text.length} / {maxLength}
        </p>
      ) : null}
    </InputShell>
  );
}

export function NumberField({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  return (
    <InputShell question={question} error={error}>
      <Input
        id={fieldId(question.key)}
        type="number"
        inputMode="decimal"
        placeholder={question.placeholder ?? undefined}
        value={typeof value === "number" && !Number.isNaN(value) ? value : ""}
        min={question.validation.min}
        max={question.validation.max}
        onChange={(event) => {
          const parsed = event.target.valueAsNumber;
          onChange(Number.isNaN(parsed) ? undefined : parsed);
        }}
        onBlur={onBlur}
        className="tabular-nums"
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(question, error !== undefined)}
      />
    </InputShell>
  );
}

export function DateField({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  return (
    <InputShell question={question} error={error}>
      <Input
        id={fieldId(question.key)}
        type="date"
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="tabular-nums"
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(question, error !== undefined)}
      />
    </InputShell>
  );
}
