/**
 * Live preview pane (05 §4.7, AC-Q-14): renders the ACTUAL client form by
 * feeding GET /questions/preview — the same payload the public intake form
 * consumes — through the intake-form feature's own QuestionField renderer
 * and conditional-visibility logic. Nothing here re-implements the form.
 *
 * Every successful edit invalidates the ["question-preview"] query, so the
 * pane re-renders without a page reload. The fields are interactive so the
 * admin can exercise conditional logic; values live in local state only.
 */
import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import type { IntakeFormCategory, IntakeFormQuestion } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  QuestionField,
  isQuestionVisible,
  type IntakeValues,
} from "@/features/intake-form";
import { roleCategoryChoices, usePreview, useTaxonomy } from "../api";

function bySortOrder<T extends { sortOrder: number }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder;
}

export function PreviewPane() {
  const [roleCategoryId, setRoleCategoryId] = useState<string | null>(null);
  const [values, setValues] = useState<IntakeValues>({});
  const previewQuery = usePreview(roleCategoryId);
  const taxonomyQuery = useTaxonomy();
  const roleChoices = roleCategoryChoices(taxonomyQuery.data);

  const categories: IntakeFormCategory[] = useMemo(
    () =>
      (previewQuery.data?.categories ?? [])
        .slice()
        .sort(bySortOrder)
        .map((category) => ({
          ...category,
          questions: category.questions.slice().sort(bySortOrder),
        })),
    [previewQuery.data],
  );
  const allQuestions: IntakeFormQuestion[] = useMemo(
    () => categories.flatMap((category) => category.questions),
    [categories],
  );

  const setAnswer = (key: string, value: unknown) => {
    setValues((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <div className="space-y-4" aria-label="Live form preview">
      <div className="space-y-1.5">
        <Label htmlFor="preview-role-category">Preview for role category</Label>
        <NativeSelect
          id="preview-role-category"
          value={roleCategoryId ?? ""}
          onChange={(event) => {
            setRoleCategoryId(
              event.target.value === "" ? null : event.target.value,
            );
            setValues({});
          }}
        >
          <option value="">Universal questions only</option>
          {roleChoices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.pathLabel}
            </option>
          ))}
        </NativeSelect>
      </div>

      {previewQuery.isPending ? (
        <LoadingSkeleton variant="card" rows={2} label="Loading preview…" />
      ) : previewQuery.isError ? (
        <ErrorState
          error={previewQuery.error}
          onRetry={() => void previewQuery.refetch()}
        />
      ) : allQuestions.length === 0 ? (
        <EmptyState
          icon={Eye}
          title="Nothing to preview"
          description="No active client-facing questions match this role category yet."
        />
      ) : (
        <div className="space-y-4">
          {previewQuery.isFetching ? (
            <p aria-live="polite" className="text-xs text-neutral-500">
              Refreshing preview…
            </p>
          ) : null}
          {categories.map((category) => {
            const visible = category.questions.filter((question) =>
              isQuestionVisible(question, allQuestions, values),
            );
            if (visible.length === 0) return null;
            return (
              <section
                key={category.id}
                aria-label={category.label}
                className="rounded-lg bg-surface-raised p-4 shadow-sm"
              >
                <h3 className="text-sm font-semibold tracking-tight text-brand-navy-ink">
                  {category.label}
                </h3>
                {category.description !== null ? (
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {category.description}
                  </p>
                ) : null}
                <div className="mt-3 space-y-4">
                  {visible.map((question) => (
                    <QuestionField
                      key={question.id}
                      question={question}
                      value={values[question.key]}
                      onChange={(value) => setAnswer(question.key, value)}
                      onBlur={() => undefined}
                      error={undefined}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
