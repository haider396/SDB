/**
 * Editing one submitted answer, in place on the candidate's profile.
 *
 * Haider, 9 Sep: SDB staff open a candidate's profile and need to correct what
 * is there.
 *
 * ── The control comes from the SNAPSHOT, never the live question ───────────
 * `question_snapshot` records what the candidate was actually shown — the
 * type, the label, the choices as at that moment (03 §1.4). So a recruiter
 * correcting a choice answer picks from the options that were genuinely on
 * offer, not from whatever the question was edited to say since. Reading the
 * live question here would let staff record an answer the candidate could
 * never have given.
 *
 * ── What is deliberately NOT editable inline ───────────────────────────────
 * A repeating table, a currency range and an uploaded file each need a real
 * editor of their own; a single text box pretending to edit them would produce
 * malformed values that the server would then reject, or worse, accept. Those
 * render read-only with a line saying so, rather than a control that lies.
 */
import type { CandidateAnswer } from "@sdb/contracts";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { snapshotString } from "@/lib/answer-value";

/** One answer's pending value, in the shape the API expects. */
export interface AnswerDraft {
  valueText?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueDate?: string;
}

/** Types this editor can safely render a control for. */
const EDITABLE = new Set([
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "scale",
  "date",
  "yes_no",
  "single_select",
]);

export function isEditableAnswer(answer: CandidateAnswer): boolean {
  const type = snapshotString(answer.questionSnapshot, "questionType");
  return type !== null && EDITABLE.has(type);
}

/** The stored value, as a draft — what the field starts with. */
export function draftFromAnswer(answer: CandidateAnswer): AnswerDraft {
  if (answer.valueBoolean !== null) return { valueBoolean: answer.valueBoolean };
  if (answer.valueNumber !== null) return { valueNumber: answer.valueNumber };
  if (answer.valueDate !== null) return { valueDate: answer.valueDate };
  return { valueText: answer.valueText ?? "" };
}

function snapshotOptions(
  answer: CandidateAnswer,
): { value: string; label: string }[] {
  const raw = answer.questionSnapshot["options"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    return typeof record["value"] === "string" && typeof record["label"] === "string"
      ? [{ value: record["value"], label: record["label"] }]
      : [];
  });
}

export function AnswerEditor({
  answer,
  draft,
  onChange,
}: {
  answer: CandidateAnswer;
  draft: AnswerDraft;
  onChange: (next: AnswerDraft) => void;
}) {
  const type = snapshotString(answer.questionSnapshot, "questionType") ?? "";
  const id = `answer-${answer.id}`;

  switch (type) {
    case "long_text":
      return (
        <Textarea
          id={id}
          rows={3}
          value={draft.valueText ?? ""}
          onChange={(event) => onChange({ valueText: event.target.value })}
        />
      );

    case "number":
    case "scale":
      return (
        <Input
          id={id}
          type="number"
          className="tabular-nums"
          value={draft.valueNumber === undefined ? "" : String(draft.valueNumber)}
          onChange={(event) => {
            const parsed = event.target.valueAsNumber;
            // An empty box clears the answer rather than storing NaN — a
            // recruiter deleting a figure they know is wrong is a real act.
            onChange(
              Number.isNaN(parsed) ? {} : { valueNumber: parsed },
            );
          }}
        />
      );

    case "date":
      return (
        <Input
          id={id}
          type="date"
          className="tabular-nums"
          value={draft.valueDate ?? ""}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? {} : { valueDate: event.target.value },
            )
          }
        />
      );

    case "yes_no":
      return (
        <NativeSelect
          id={id}
          value={
            draft.valueBoolean === undefined ? "" : draft.valueBoolean ? "yes" : "no"
          }
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? {}
                : { valueBoolean: event.target.value === "yes" },
            )
          }
        >
          <option value="">Not answered</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </NativeSelect>
      );

    case "single_select": {
      const options = snapshotOptions(answer);
      return (
        <NativeSelect
          id={id}
          value={draft.valueText ?? ""}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? {} : { valueText: event.target.value },
            )
          }
        >
          <option value="">Not answered</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      );
    }

    default:
      return (
        <Input
          id={id}
          type={type === "email" ? "email" : type === "phone" ? "tel" : "text"}
          value={draft.valueText ?? ""}
          onChange={(event) => onChange({ valueText: event.target.value })}
        />
      );
  }
}
