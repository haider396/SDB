/**
 * repeating_group — a question whose answer is a LIST OF ROWS: a few defined
 * columns and an "Add another" button. Design:
 * docs/superpowers/specs/2026-09-09-repeating-group-question-type-design.md
 *
 * A CSS GRID, NOT A <table>. `<th scope="col">` labels cells in a screen
 * reader's *browse* mode, but inside a form the reader is in *forms* mode and
 * announces only each input's own accessible name — so headers alone label
 * nothing. Nesting a per-row group inside a table would also break the table
 * semantics that were the only reason to reach for one.
 */
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { RepeatingGroupColumn, RepeatingGroupRow } from "@sdb/contracts";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  columnOptions,
  readRows,
  repeatingGroupConfig,
} from "../../repeating-group";
import { addRowId, cellFieldId, cellRemoveId, GroupShell } from "./field-shell";
import { SearchableSelect } from "./searchable-select";
import type { FieldProps } from "./types";

/**
 * Mirrors SEARCHABLE_SELECT_MIN_OPTIONS in select-fields.tsx. Copied rather
 * than imported so the threshold is visible where the decision is made — but
 * it must not drift: a form that teaches two different pickers for the same
 * job is worse than either picker on its own.
 */
const SEARCHABLE_SELECT_MIN_OPTIONS = 12;

/** One cell's value as the controls hand it back. */
type CellValue = string | number | undefined;

function CellControl({
  id,
  question,
  column,
  value,
  onChange,
  onBlur,
  invalid,
  describedById,
}: {
  id: string;
  question: FieldProps["question"];
  column: RepeatingGroupColumn;
  value: string | number | undefined;
  onChange: (next: CellValue) => void;
  onBlur: () => void;
  invalid: boolean;
  describedById: string | undefined;
}) {
  const text = value === undefined ? "" : String(value);
  const shared = {
    id,
    onBlur,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedById,
    placeholder: column.placeholder,
  };

  switch (column.columnType) {
    case "single_select": {
      const options = columnOptions(question, column);
      if (options.length >= SEARCHABLE_SELECT_MIN_OPTIONS) {
        return (
          <SearchableSelect
            inputId={id}
            options={options}
            value={text}
            onChange={(next) => onChange(next === "" ? undefined : next)}
            onBlur={onBlur}
            label={column.label}
            placeholder={column.placeholder ?? "Search…"}
            describedBy={describedById}
            invalid={invalid}
          />
        );
      }
      return (
        <NativeSelect
          {...shared}
          value={text}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : event.target.value)
          }
        >
          <option value="">Select…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      );
    }

    case "long_text":
      return (
        <Textarea
          {...shared}
          rows={2}
          maxLength={column.maxLength}
          value={text}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : event.target.value)
          }
        />
      );

    case "number":
      return (
        <Input
          {...shared}
          type="number"
          inputMode="decimal"
          min={column.min}
          max={column.max}
          value={text}
          onChange={(event) => {
            const raw = event.target.value;
            // A half-typed entry ("-", "1e") parses to NaN, which does not
            // survive JSON and would reach the API as null. Drop it instead.
            const parsed = Number(raw);
            onChange(raw === "" || Number.isNaN(parsed) ? undefined : parsed);
          }}
        />
      );

    case "month":
      return (
        <Input
          {...shared}
          type="month"
          value={text}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : event.target.value)
          }
        />
      );

    case "short_text":
      return (
        <Input
          {...shared}
          type="text"
          maxLength={column.maxLength}
          value={text}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : event.target.value)
          }
        />
      );

    default: {
      const unhandled: never = column.columnType;
      throw new Error(
        `Unhandled repeating-group column type: ${String(unhandled)}`,
      );
    }
  }
}

export function RepeatingGroupField(props: FieldProps) {
  const { question, value, onChange, onBlur, error } = props;
  const config = repeatingGroupConfig(question);
  const rows = readRows(value);
  const rowCount = rows.length;

  /*
   * A STABLE per-row id, never the array index: with index keys, removing row
   * 2 makes React reuse row 3's DOM node, so focus and uncommitted cell text
   * follow the wrong row.
   */
  const nextId = useRef(0);
  const mintId = () => {
    nextId.current += 1;
    return `rg-${String(nextId.current)}`;
  };
  const [rowIds, setRowIds] = useState<string[]>(() => rows.map(() => mintId()));
  const [announcement, setAnnouncement] = useState("");

  // Add and remove keep ids and rows in step inside one batch, so this only
  // fires when the value changes from OUTSIDE the control — a server-set
  // default or a form reset, where there is no row identity worth preserving.
  useEffect(() => {
    setRowIds((current) => {
      if (current.length === rowCount) return current;
      if (current.length > rowCount) return current.slice(0, rowCount);
      return [
        ...current,
        ...Array.from({ length: rowCount - current.length }, () => mintId()),
      ];
    });
    // The COUNT, not `rows`: readRows rebuilds the array on every render, so
    // depending on it would re-run this effect forever.
  }, [rowCount]);

  /*
   * Where focus must land once the parent has re-rendered with the new row
   * set (AC-FB-09).
   *
   * It cannot be moved from inside the click handler. This control is
   * CONTROLLED: the added row's inputs do not exist until the parent applies
   * the value onChange just produced. Removal is worse — the button that was
   * clicked is itself unmounted, so focus falls to <body>, which is the
   * classic failure of this widget and what the AC names explicitly.
   */
  const pendingFocusId = useRef<string | null>(null);

  useLayoutEffect(() => {
    const id = pendingFocusId.current;
    if (id === null) return;
    const target = document.getElementById(id);
    // Still absent: the host has not applied the onChange (a form that
    // validates before committing, or a parent that dropped the value). Hold
    // the request for the render that does — clearing it here would strand
    // focus wherever the removal left it.
    if (target === null) return;
    pendingFocusId.current = null;
    target.focus();
  });

  // A repeating group with no columns is a misconfiguration the API rejects on
  // write (AC-FB-01). Render nothing rather than a broken table. Every hook
  // above runs unconditionally, so hook order never depends on the config.
  if (config === null) return null;

  const rowErrors = props.rowErrors ?? [];
  const template = [
    ...config.columns.map(
      (column) => `minmax(0, ${String(column.widthWeight)}fr)`,
    ),
    "auto", // the remove-button column
  ].join(" ");
  /*
   * The template rides a CSS variable rather than an inline
   * `gridTemplateColumns`, because it must apply only from `sm` up: below that
   * the row stacks into a single column. An inline style cannot carry a media
   * query; a variable read by an `sm:` utility can.
   */
  const gridVars = { "--rg-cols": template } as CSSProperties;
  const isAtMax = rowCount >= config.maxRows;

  const writeCell = (rowIndex: number, columnKey: string, next: CellValue) => {
    onChange({
      rows: rows.map((row, index) => {
        if (index !== rowIndex) return row;
        const draft: RepeatingGroupRow = { ...row };
        // An empty cell is OMITTED, never stored as "". That is what makes
        // isEmptyRow a one-line check on both sides of the wire, and what
        // stops a blank answer looking answered to the API's required check.
        if (next === undefined || next === "") delete draft[columnKey];
        else draft[columnKey] = next;
        return draft;
      }),
    });
  };

  const addRow = () => {
    if (isAtMax) {
      /*
       * The Add button stays ENABLED at the cap and says why on activation
       * (spec §8.2). A disabled control someone has just tabbed to explains
       * nothing — it simply does not respond, and the reason is invisible to
       * anyone not looking at the hint beside it.
       */
      setAnnouncement(
        `Maximum of ${String(config.maxRows)} ${
          config.maxRows === 1 ? "row" : "rows"
        } reached.`,
      );
      return;
    }
    setRowIds((current) => [...current, mintId()]);
    onChange({ rows: [...rows, {}] });
    setAnnouncement(`Row ${String(rowCount + 1)} added.`);
    // The first cell of the NEW row, so the next keystroke fills the thing
    // that was just asked for rather than the page behind it.
    const firstColumnKey = config.columns[0]?.key;
    if (firstColumnKey !== undefined) {
      pendingFocusId.current = cellFieldId(
        question.key,
        rowCount,
        firstColumnKey,
      );
    }
  };

  const removeRow = (rowIndex: number) => {
    const remaining = rowCount - 1;
    setRowIds((current) => current.filter((_, index) => index !== rowIndex));
    onChange({ rows: rows.filter((_, index) => index !== rowIndex) });
    setAnnouncement(
      `Row ${String(rowIndex + 1)} removed. ${String(remaining)} ${
        remaining === 1 ? "row remains" : "rows remain"
      }.`,
    );
    /*
     * The remove button of the row that TOOK ITS PLACE — same screen
     * position, same control, so several rows can be deleted in sequence
     * without hunting for focus. The last row has no replacement, so the Add
     * button takes it. Either way focus never reaches <body>.
     */
    pendingFocusId.current =
      rowIndex < remaining
        ? cellRemoveId(question.key, rowIndex)
        : addRowId(question.key);
  };

  return (
    /* `relative` on the fieldset is NOT decoration. The live region at the
       bottom is sr-only, sr-only is position:absolute, and the two surfaces
       this control actually ships on — /register and /f/:slug — are public
       routes with no shell: only admin-layout and client-layout are
       `relative overflow-clip`. Without this the region anchors to the
       document (HANDOFF §7). The control owns its own positioned ancestor
       rather than trusting whichever page mounts it. */
    <GroupShell question={question} error={error} className="relative">
      {/* Decorative duplication of the per-input labels below — a screen
          reader in forms mode announces the input's own name, never this. */}
      <div
        aria-hidden="true"
        className="hidden gap-2 text-xs font-medium text-neutral-600 sm:grid sm:grid-cols-[var(--rg-cols)]"
        style={gridVars}
      >
        {config.columns.map((column) => (
          <span key={column.key}>{column.label}</span>
        ))}
        <span />
      </div>

      {rowCount === 0 ? (
        <p className="text-sm text-neutral-600">Nothing added yet.</p>
      ) : null}

      <div className="space-y-2">
        {rows.map((row, rowIndex) => (
          <div
            key={rowIds[rowIndex] ?? `pending-${String(rowIndex)}`}
            role="group"
            aria-label={`Row ${String(rowIndex + 1)}`}
            /* `relative` is NOT optional. The cell labels below are sr-only
               from `sm` up, sr-only is position:absolute, and an absolute
               element with no positioned ancestor anchors to the document and
               stretches the page (HANDOFF §7). */
            className="relative grid gap-2 rounded-md border border-border-default p-2 sm:grid-cols-[var(--rg-cols)] sm:items-start sm:border-0 sm:p-0"
            style={gridVars}
          >
            {config.columns.map((column) => {
              const id = cellFieldId(question.key, rowIndex, column.key);
              const cellError = rowErrors.find(
                (candidate) =>
                  candidate.rowIndex === rowIndex &&
                  candidate.columnKey === column.key,
              );
              return (
                <div key={column.key}>
                  {/* Exactly ONE label element per input: visible while the
                      row is stacked, hidden once the header row takes over
                      at `sm`. */}
                  <label
                    htmlFor={id}
                    className="mb-1 block text-xs font-medium text-neutral-600 sm:sr-only"
                  >
                    {column.label}
                  </label>
                  <CellControl
                    id={id}
                    question={question}
                    column={column}
                    value={row[column.key]}
                    onChange={(next) => writeCell(rowIndex, column.key, next)}
                    onBlur={onBlur}
                    invalid={cellError !== undefined}
                    describedById={
                      cellError === undefined ? undefined : `${id}-error`
                    }
                  />
                  {cellError === undefined ? null : (
                    <p
                      id={`${id}-error`}
                      className="mt-1 text-xs text-danger-text"
                    >
                      {cellError.message}
                    </p>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              id={cellRemoveId(question.key, rowIndex)}
              onClick={() => removeRow(rowIndex)}
              // A NAME, not a bare icon. "Remove row 2" is what a screen
              // reader announces and what the tests locate by.
              aria-label={`Remove row ${String(rowIndex + 1)}`}
              className="mt-1 justify-self-start rounded-md p-2 text-neutral-600 hover:bg-neutral-100 hover:text-danger-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-blue sm:mt-0"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        {/* Never disabled, even at the cap — see addRow. The hint below is
            the sighted half of the same explanation. */}
        <button
          type="button"
          id={addRowId(question.key)}
          onClick={addRow}
          className="rounded-md border border-border-default px-3 py-1.5 text-sm font-medium text-brand-blue hover:bg-brand-blue-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
        >
          {config.addRowLabel}
        </button>
        {isAtMax ? (
          <p className="text-xs text-neutral-600">
            You can add at most {config.maxRows}{" "}
            {config.maxRows === 1 ? "row" : "rows"}.
          </p>
        ) : null}
      </div>

      {/* One live region owned by the control. Its ancestor is positioned. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </GroupShell>
  );
}
