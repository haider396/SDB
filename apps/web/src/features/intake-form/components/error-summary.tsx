/**
 * Top-of-form error summary with anchor links to each field
 * (05 §4.4, §5 req 8). Server requestId is shown in small mono per §4.3.
 */
import { AlertTriangle } from "lucide-react";
import { fieldId } from "./fields/field-shell";

export interface SummaryEntry {
  questionKey: string;
  label: string;
  message: string;
}

/** Focus (and scroll to) the control for a questionKey. */
export function focusField(questionKey: string): void {
  const anchor = document.getElementById(fieldId(questionKey));
  if (!anchor) return;
  const target =
    anchor instanceof HTMLFieldSetElement
      ? anchor.querySelector<HTMLElement>("input, select, textarea, button")
      : anchor;
  target?.focus();
  if (typeof anchor.scrollIntoView === "function") {
    anchor.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function ErrorSummary({
  summary,
  entries,
  requestId,
  onNavigateToField,
}: {
  summary: string;
  entries: readonly SummaryEntry[];
  requestId: string | null;
  /** Called before focusing, so the renderer can switch to the right step. */
  onNavigateToField: (questionKey: string) => void;
}) {
  return (
    <div
      role="alert"
      tabIndex={-1}
      id="intake-error-summary"
      className="rounded-lg border border-danger bg-danger-subtle p-4"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-danger-text"
        />
        <div className="space-y-2">
          <p className="text-sm font-medium text-danger-text">{summary}</p>
          {entries.length > 0 ? (
            <ul className="space-y-1">
              {entries.map((entry) => (
                <li key={entry.questionKey}>
                  <a
                    href={`#${fieldId(entry.questionKey)}`}
                    className="text-sm text-danger-text underline underline-offset-2 hover:no-underline"
                    onClick={(event) => {
                      event.preventDefault();
                      onNavigateToField(entry.questionKey);
                    }}
                  >
                    {entry.label}: {entry.message}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {requestId !== null ? (
            <p className="font-mono text-xs text-neutral-500">
              Request ID: {requestId}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
