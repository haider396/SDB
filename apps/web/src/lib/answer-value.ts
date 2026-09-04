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
