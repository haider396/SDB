/**
 * A stored repeating-group answer, rendered as a table.
 *
 * ONE component, used by BOTH the candidate profile's applications card and
 * the requisition answers card. Solving it in only one of them would guarantee
 * drift the first time a repeating group reaches a client intake form — the
 * same reasoning lib/answer-value.ts gives for existing at all.
 *
 * A real <table> here, unlike the control on the form. This is read-only
 * display, so the reader is in BROWSE mode and `<th scope="col">` genuinely
 * labels each cell. The form control cannot use one because a reader in FORMS
 * mode announces only each input's own name (design §8.1).
 *
 * Every heading, every option label and every cell comes from
 * `question_snapshot` (03 §1.4). Renaming a column or retiring an option later
 * cannot change what a candidate is recorded as having answered (AC-FB-08).
 */
import {
  readRepeatingGroup,
  renderAnswerValue,
  repeatingGroupCellText,
  type SnapshotAnswer,
} from "@/lib/answer-value";

export function AnswerTable({
  answer,
  caption,
}: {
  answer: SnapshotAnswer;
  /** Names the table for a screen reader — normally the question's label. */
  caption?: string;
}) {
  const group = readRepeatingGroup(answer);

  // Not a readable repeating group after all. Show the plain-text rendering
  // rather than nothing: an answer that cannot be tabulated is still an answer.
  if (group === null) {
    return <span>{renderAnswerValue(answer)}</span>;
  }

  if (group.rows.length === 0) {
    return <span className="text-neutral-500">Nothing was added here.</span>;
  }

  return (
    // Wide tables scroll inside their own box; the page must never scroll
    // sideways, and these sit in a 1fr column beside a 16rem label.
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        {caption === undefined ? null : (
          <caption className="sr-only">{caption}</caption>
        )}
        <thead>
          <tr>
            {group.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="border-b border-neutral-200 py-1 pr-4 text-2xs font-semibold uppercase tracking-wide text-neutral-500"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row, rowIndex) => (
            <tr
              // Entry order IS the order and rows are never reordered or
              // edited here, so the index is a stable identity — unlike in the
              // form control, where removing a row makes React reuse the wrong
              // DOM node.
              key={rowIndex}
              className="align-top"
            >
              {group.columns.map((column) => {
                const text = repeatingGroupCellText(column, row[column.key]);
                return (
                  <td
                    key={column.key}
                    className="border-b border-neutral-100 py-1 pr-4 text-neutral-800"
                  >
                    {/* An em dash, not an empty cell: a blank looks like a
                        rendering fault rather than an unanswered column.
                        neutral-500 rather than the lighter 400 — it is text,
                        and 400 on white is 2.9:1 (AC-UI-02 wants 4.5:1). */}
                    {text ?? <span className="text-neutral-500">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
