/**
 * Top-of-form error summary with anchor links to each field
 * (05 §4.4, §5 req 8). Server requestId is shown in small mono per §4.3.
 */
import { AlertTriangle } from "lucide-react";
import { cellFieldId, fieldId } from "./fields/field-shell";

/** One cell of a repeating group, as the summary points at it. */
export interface FieldCell {
  rowIndex: number;
  columnKey: string;
}

export interface SummaryEntry {
  questionKey: string;
  label: string;
  message: string;
  /**
   * Set only for a repeating-group cell, and then all three together: a
   * summary line reading "Skills & tools — row 2, Proficiency: …" that lands
   * on row 1 cell 1 is worse than no link at all (spec §7.4).
   */
  rowIndex?: number;
  columnKey?: string;
  /** Human column name. The key is a machine slug and is the last resort. */
  columnLabel?: string;
}

/** The anchor an entry points at: one cell when it names one, else the field. */
function anchorId(entry: SummaryEntry): string {
  return entry.rowIndex !== undefined && entry.columnKey !== undefined
    ? cellFieldId(entry.questionKey, entry.rowIndex, entry.columnKey)
    : fieldId(entry.questionKey);
}

/**
 * Focus (and scroll to) the control for a questionKey, or one cell of it.
 *
 * The one-argument call is unchanged: fieldId(key) is on the <fieldset>, and
 * focusing its first control lands on row 1 cell 1 — or on the Add button when
 * the table is empty, which is exactly where someone needs to be.
 */
export function focusField(questionKey: string, cell?: FieldCell): void {
  const anchor = document.getElementById(fieldId(questionKey));
  if (!anchor) return;
  // A row can have been removed between the failed submit and this click, so
  // a named cell that has gone falls back rather than dropping focus.
  const cellTarget =
    cell === undefined
      ? null
      : document.getElementById(
          cellFieldId(questionKey, cell.rowIndex, cell.columnKey),
        );
  const target =
    cellTarget ??
    (anchor instanceof HTMLFieldSetElement
      ? anchor.querySelector<HTMLElement>("input, select, textarea, button")
      : anchor);
  target?.focus();
  const scrollTo = cellTarget ?? anchor;
  if (typeof scrollTo.scrollIntoView === "function") {
    scrollTo.scrollIntoView({ behavior: "smooth", block: "center" });
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
  onNavigateToField: (questionKey: string, cell?: FieldCell) => void;
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
              {entries.map((entry) => {
                const cell =
                  entry.rowIndex !== undefined && entry.columnKey !== undefined
                    ? { rowIndex: entry.rowIndex, columnKey: entry.columnKey }
                    : undefined;
                return (
                  <li
                    // One question can contribute several lines, so the key
                    // has to carry the cell as well as the question.
                    key={`${entry.questionKey}:${String(entry.rowIndex ?? "")}:${
                      entry.columnKey ?? ""
                    }`}
                  >
                    <a
                      href={`#${anchorId(entry)}`}
                      className="text-sm text-danger-text underline underline-offset-2 hover:no-underline"
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigateToField(entry.questionKey, cell);
                      }}
                    >
                      {cell === undefined
                        ? `${entry.label}: ${entry.message}`
                        : // Rows are counted from one when spoken about, and
                          // from zero everywhere in the data.
                          `${entry.label} — row ${String(cell.rowIndex + 1)}, ${
                            entry.columnLabel ?? cell.columnKey
                          }: ${entry.message}`}
                    </a>
                  </li>
                );
              })}
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
