/**
 * Shared field chrome: label above input tied by htmlFor (05 §4.2), help
 * text, and inline error — or fieldset/legend for grouped controls
 * (AC-UI-03). Also owns the id conventions used by the error summary's
 * anchor links.
 */
import type { ReactNode } from "react";
import type { IntakeFormQuestion } from "@sdb/contracts";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Anchor/focus target id for a question. */
export function fieldId(key: string): string {
  return `field-${key}`;
}

export function helpId(key: string): string {
  return `field-${key}-help`;
}

export function errorId(key: string): string {
  return `field-${key}-error`;
}

export function describedBy(
  question: IntakeFormQuestion,
  hasError: boolean,
  extraIds: readonly string[] = [],
): string | undefined {
  const ids = [
    ...(question.helpText !== null ? [helpId(question.key)] : []),
    ...(hasError ? [errorId(question.key)] : []),
    ...extraIds,
  ];
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function RequiredMark({ isRequired }: { isRequired: boolean }) {
  if (!isRequired) {
    return <span className="ml-1 font-normal text-neutral-400">(optional)</span>;
  }
  return (
    <span aria-hidden="true" className="ml-0.5 text-danger-text">
      *
    </span>
  );
}

/** Shell for single-input questions. The input itself carries fieldId(key). */
export function InputShell({
  question,
  error,
  children,
}: {
  question: IntakeFormQuestion;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId(question.key)}>
        {question.label}
        <RequiredMark isRequired={question.isRequired} />
      </Label>
      {question.helpText !== null ? (
        <p id={helpId(question.key)} className="text-xs text-neutral-500">
          {question.helpText}
        </p>
      ) : null}
      {children}
      {error !== undefined ? (
        <p id={errorId(question.key)} className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Shell for grouped controls: fieldset with a legend (AC-UI-03). */
export function GroupShell({
  question,
  error,
  children,
  className,
}: {
  question: IntakeFormQuestion;
  error: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset
      id={fieldId(question.key)}
      aria-describedby={describedBy(question, error !== undefined)}
      aria-invalid={error !== undefined || undefined}
      className={cn("space-y-1.5", className)}
    >
      <legend className="block text-sm font-medium text-neutral-800">
        {question.label}
        <RequiredMark isRequired={question.isRequired} />
      </legend>
      {question.helpText !== null ? (
        <p id={helpId(question.key)} className="text-xs text-neutral-500">
          {question.helpText}
        </p>
      ) : null}
      {children}
      {error !== undefined ? (
        <p id={errorId(question.key)} className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
