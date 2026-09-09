/**
 * Rendering a stored answer.
 *
 * Extracted from features/requisitions/components/answers-card.tsx so the
 * candidate side can share it rather than copy it. This is 35 lines of typed-
 * column logic that MUST behave identically in both places — duplicating it
 * guarantees drift the first time someone adds a value shape.
 *
 * Structurally typed on purpose: RequisitionAnswer and CandidateAnswer are the
 * same row shape, so `AnswerLike` accepts both with no generics and no casts.
 */
import type {
  RepeatingGroupColumn,
  RepeatingGroupRow,
} from "@sdb/contracts";
import {
  RepeatingGroupSnapshotSchema,
  RepeatingGroupValueSchema,
} from "@sdb/contracts";
import { formatDate } from "./format";

export interface AnswerLike {
  selectedOptions: readonly { label: string }[];
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: unknown;
}

export interface SnapshotAnswer extends AnswerLike {
  questionSnapshot: Record<string, unknown>;
}

/** Render the stored value using the typed columns (02 §7 value shape). */
export function renderAnswerValue(answer: AnswerLike): string {
  if (answer.selectedOptions.length > 0) {
    return answer.selectedOptions.map((option) => option.label).join(", ");
  }
  if (answer.valueBoolean !== null) return answer.valueBoolean ? "Yes" : "No";
  if (answer.valueNumber !== null) return String(answer.valueNumber);
  if (answer.valueDate !== null) return formatDate(answer.valueDate);
  if (answer.valueText !== null && answer.valueText !== "") {
    return answer.valueText;
  }
  if (answer.valueJson !== null && answer.valueJson !== undefined) {
    if (typeof answer.valueJson === "object" && !Array.isArray(answer.valueJson)) {
      const json = answer.valueJson as Record<string, unknown>;
      /*
       * repeating_group: { rows: [...] }. Keyed on the VALUE's shape, not on
       * the question type, and placed first: every branch below is a loose
       * shape check too, and the one that runs first wins. Without this arm
       * the value falls through to JSON.stringify and a recruiter reads raw
       * JSON.
       *
       * A COUNT, not the contents. This function's contract is a string and
       * its string-only callers depend on that — notably supersededKeys() in
       * form-submissions-card.tsx, which compares two renderings. A count is a
       * COARSE comparison there: two applications listing different skills but
       * the same number of them do not read as superseded. That is the right
       * trade for now — the alternative is serialising every row into the
       * comparison key, and "Superseded" on a table of twenty skills because
       * one note changed is noise, not information. The rows themselves are
       * rendered by <AnswerTable/> from the snapshot's columns.
       */
      if (Array.isArray(json["rows"])) {
        const count = json["rows"].length;
        return `${String(count)} row${count === 1 ? "" : "s"}`;
      }
      // currency_range: { min, max, unit, currency } (02 §7)
      if (typeof json["min"] === "number" || typeof json["max"] === "number") {
        const currency = typeof json["currency"] === "string" ? json["currency"] : "";
        const unit = typeof json["unit"] === "string" ? ` / ${json["unit"]}` : "";
        const min =
          typeof json["min"] === "number" ? json["min"].toLocaleString("en-US") : null;
        const max =
          typeof json["max"] === "number" ? json["max"].toLocaleString("en-US") : null;
        const range = [min, max].filter((part) => part !== null).join("–");
        return `${currency ? `${currency} ` : ""}${range}${unit}`;
      }
      if (Array.isArray(json["fileIds"])) {
        const count = json["fileIds"].length;
        return `${String(count)} file${count === 1 ? "" : "s"} attached`;
      }
    }
    if (Array.isArray(answer.valueJson)) {
      return answer.valueJson.map((entry) => String(entry)).join(", ");
    }
    return JSON.stringify(answer.valueJson);
  }
  return "—";
}

export interface RepeatingGroupAnswer {
  columns: RepeatingGroupColumn[];
  rows: RepeatingGroupRow[];
}

/**
 * A stored repeating-group answer, read ENTIRELY from its own snapshot — or
 * null when this answer is not one.
 *
 * Null is the normal answer, not an error path: every row stored before this
 * feature has no `repeatingGroup` key in its snapshot, which is precisely why
 * nothing already in the database can take the table rendering path. A stored
 * snapshot is never reinterpreted.
 *
 * Both halves must parse. A snapshot with columns but a value that is not a
 * row list is a shape nothing writes, and rendering half of it would invent an
 * answer the candidate did not give.
 */
export function readRepeatingGroup(
  answer: SnapshotAnswer,
): RepeatingGroupAnswer | null {
  const snapshot = RepeatingGroupSnapshotSchema.safeParse(
    answer.questionSnapshot["repeatingGroup"],
  );
  if (!snapshot.success) return null;
  const value = RepeatingGroupValueSchema.safeParse(answer.valueJson);
  if (!value.success) return null;
  return { columns: snapshot.data.columns, rows: value.data.rows };
}

/**
 * The label recorded for a choice cell, falling back to the raw stored value.
 *
 * The fallback is the point: an option renamed, retired, or simply missing
 * from the snapshot's resolved list must never make an answer disappear. A
 * value we cannot label is still what the candidate chose.
 */
export function repeatingGroupCellText(
  column: RepeatingGroupColumn,
  cell: string | number | undefined,
): string | null {
  if (cell === undefined || cell === "") return null;
  const raw = String(cell);
  if (column.choices?.from !== "inline") return raw;
  return (
    column.choices.options.find((option) => option.value === raw)?.label ?? raw
  );
}

/** A snapshot field, when it is a string. Snapshots are loosely typed. */
export function snapshotString(
  snapshot: Record<string, unknown>,
  key: string,
): string | null {
  const value = snapshot[key];
  return typeof value === "string" ? value : null;
}

export interface AnswerGroup<T> {
  categoryKey: string;
  /**
   * The heading the person actually saw, when the snapshot recorded one.
   * Null for answers captured before snapshots carried it — callers fall back
   * to humanising the key.
   */
  categoryLabel: string | null;
  answers: T[];
}

/** Group by the snapshot's categoryKey, preserving answer order. */
export function groupAnswersByCategory<T extends SnapshotAnswer>(
  answers: readonly T[],
): AnswerGroup<T>[] {
  const groups = new Map<string, { label: string | null; answers: T[] }>();
  for (const answer of answers) {
    const categoryKey = snapshotString(answer.questionSnapshot, "categoryKey") ?? "other";
    const categoryLabel = snapshotString(answer.questionSnapshot, "categoryLabel");
    const bucket = groups.get(categoryKey);
    if (bucket === undefined) {
      groups.set(categoryKey, { label: categoryLabel, answers: [answer] });
    } else {
      bucket.answers.push(answer);
      // First non-null wins: a category renamed between two answers in one
      // submission should not flip the heading half way down the list.
      bucket.label ??= categoryLabel;
    }
  }
  return Array.from(groups, ([categoryKey, bucket]) => ({
    categoryKey,
    categoryLabel: bucket.label,
    answers: bucket.answers,
  }));
}
