/**
 * Preview: the form exactly as a candidate meets it.
 *
 * Renders the CURRENT in-memory document, so unsaved edits are visible — the
 * point of a preview is to check what you are working on, not what was last
 * saved. It shares CanvasRenderer with the public form, so layout, styling and
 * theme are the real thing rather than an approximation.
 *
 * Three things are deliberately different from the editing canvas: no grid, no
 * selection chrome, and the fields WORK. Being able to type into them is what
 * makes conditional questions testable before the form goes live.
 *
 * Values are local and thrown away — nothing is submitted, and the consent and
 * typing steps are represented rather than functional.
 */
import { useMemo, useState } from "react";
import type { FormDocument, IntakeFormQuestion } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { QuestionField } from "@/features/intake-form/components/question-field";
import { StepProgress } from "@/features/intake-form/components/step-progress";
import {
  visibleQuestions,
  type IntakeValues,
} from "@/features/intake-form/conditional";
import { CanvasRenderer } from "../../render/canvas-renderer";
import { formThemeVars } from "../../render/styled-field";

export interface PreviewPaneProps {
  document: FormDocument;
  questionsById: ReadonlyMap<string, IntakeFormQuestion>;
  /** Per-form steps, so the preview shows the same tail the candidate gets. */
  hasTypingTest: boolean;
  hasDocumentsStep: boolean;
}

export function PreviewPane({
  document,
  questionsById,
  hasTypingTest,
  hasDocumentsStep,
}: PreviewPaneProps) {
  const [values, setValues] = useState<IntakeValues>({});
  const [stepIndex, setStepIndex] = useState(0);

  const allQuestions = useMemo(() => [...questionsById.values()], [questionsById]);
  const visibleKeys = useMemo(
    () => new Set(visibleQuestions(allQuestions, values).map((q) => q.key)),
    [allQuestions, values],
  );

  // The same tail the public renderer appends. Consent is unconditional.
  const steps = useMemo(
    () => [
      ...document.pages.map((page) => ({
        key: `page-${String(page.index)}`,
        label: page.title,
      })),
      ...(hasTypingTest ? [{ key: "__typing", label: "Typing speed" }] : []),
      ...(hasDocumentsStep ? [{ key: "__documents", label: "Documents" }] : []),
      { key: "__consent", label: "Consent" },
    ],
    [document.pages, hasDocumentsStep, hasTypingTest],
  );

  const page = document.pages[stepIndex];
  const tailStep = steps[stepIndex]?.key.startsWith("__") === true;

  return (
    <div className="sdb-form-scope" style={formThemeVars(document.theme)}>
      <StepProgress
        steps={steps}
        currentIndex={stepIndex}
        onNavigate={(index) => setStepIndex(index)}
      />

      {tailStep ? (
        <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center">
          <p className="text-sm font-medium text-neutral-700">
            {steps[stepIndex]?.label}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {steps[stepIndex]?.key === "__consent"
              ? "Always included. A candidate cannot be presented to a client without it."
              : "This step is built in, and is not part of the canvas."}
          </p>
        </div>
      ) : page === undefined ? (
        <p className="p-6 text-sm text-neutral-500">This step has no content.</p>
      ) : (
        <CanvasRenderer
          blocks={document.blocks}
          questionsById={questionsById}
          pageIndex={page.index}
          renderQuestion={(question) =>
            visibleKeys.has(question.key) ? (
              <QuestionField
                question={question}
                value={values[question.key]}
                onChange={(value) =>
                  setValues((current) => ({ ...current, [question.key]: value }))
                }
                onBlur={() => undefined}
                error={undefined}
              />
            ) : null
          }
        />
      )}

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="secondary"
          size="sm"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
        >
          Back
        </Button>
        <Button
          size="sm"
          disabled={stepIndex >= steps.length - 1}
          onClick={() =>
            setStepIndex((index) => Math.min(steps.length - 1, index + 1))
          }
        >
          Next
        </Button>
      </div>
    </div>
  );
}
