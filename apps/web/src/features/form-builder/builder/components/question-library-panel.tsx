/**
 * Editing the QUESTION, not this form's copy of it.
 *
 * The panel above this one changes wording for one form and is undoable with
 * the rest of the document. Everything here is the opposite: it edits the
 * shared question, saves the moment you confirm, and reaches every form that
 * asks it — including the live registration form. Two controls with opposite
 * persistence sitting inches apart is the real hazard, so this panel is
 * deliberately walled off: its own border, its own heading, and the list of
 * forms it would affect stated before you touch anything.
 *
 * Ctrl+Z does not reach in here. The builder's history only knows about the
 * document, and giving library edits an undo entry would imply the server had
 * been rolled back too.
 */
import { useState } from "react";
import { AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  useCategories,
  useQuestionDetail,
} from "@/features/question-manager/api";
import { QuestionEditor } from "@/features/question-manager/components/question-editor";

const SECTION =
  "space-y-3 rounded-md border border-warning bg-warning-subtle p-3";

export interface QuestionLibraryPanelProps {
  questionId: string;
}

export function QuestionLibraryPanel({ questionId }: QuestionLibraryPanelProps) {
  const detail = useQuestionDetail(questionId);
  const categories = useCategories("candidate");
  const [editing, setEditing] = useState(false);

  const question = detail.data;
  const usedBy = question?.usedByForms ?? [];
  const liveForms = usedBy.filter((form) => form.status === "active");

  return (
    <section className={SECTION} aria-label="The question itself">
      <div className="flex items-center gap-1.5">
        <AlertTriangle
          className="h-3 w-3 shrink-0 text-warning-text"
          aria-hidden="true"
        />
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-warning-text">
          The question itself
        </h3>
      </div>

      <p className="text-2xs text-neutral-700">
        Changing this rewords the question everywhere it is asked, not just on
        this form. Use the fields above to change only this form.
      </p>

      {question === undefined ? (
        <p className="text-2xs text-neutral-600">Loading…</p>
      ) : (
        <>
          <dl className="space-y-1 text-2xs text-neutral-700">
            <div className="flex gap-1">
              <dt className="text-neutral-600">Type</dt>
              <dd className="font-medium">{question.questionType}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-neutral-600">Answers recorded</dt>
              <dd className="font-medium">{question.answerCount}</dd>
            </div>
          </dl>

          {usedBy.length > 0 ? (
            <div className="space-y-1">
              <p className="text-2xs font-medium text-neutral-700">
                Used by {usedBy.length}{" "}
                {usedBy.length === 1 ? "form" : "forms"}
                {liveForms.length > 0
                  ? ` — ${String(liveForms.length)} live right now`
                  : ""}
              </p>
              <ul className="space-y-0.5">
                {usedBy.map((form) => (
                  <li
                    key={form.formId}
                    className="flex items-center gap-1.5 text-2xs text-neutral-700"
                  >
                    <span className="min-w-0 flex-1 truncate">{form.label}</span>
                    {form.status === "active" ? (
                      <Chip tone="success" size="sm">
                        Live
                      </Chip>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={categories.data === undefined}
            onClick={() => setEditing(true)}
          >
            <Pencil className="mr-1 h-3 w-3" aria-hidden="true" />
            Edit the question
          </Button>
        </>
      )}

      {editing && question !== undefined && categories.data !== undefined ? (
        <QuestionEditor
          state={{ mode: "edit", question }}
          categories={categories.data}
          audience="candidate"
          onClose={() => setEditing(false)}
        />
      ) : null}
    </section>
  );
}
