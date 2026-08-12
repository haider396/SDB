/**
 * /admin/questions — the two-pane question manager with live preview
 * (05 §4.7, 03 §2). Categories left, questions of the selected category
 * right, and a toggleable third pane rendering the actual client form.
 */
import { useMemo, useState } from "react";
import { Eye, EyeOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { useCategories, useQuestions } from "./api";
import { CategoryPane } from "./components/category-pane";
import { PreviewPane } from "./components/preview-pane";
import { QuestionEditor, type EditorState } from "./components/question-editor";
import { QuestionPane } from "./components/question-pane";

export function QuestionManagerPage() {
  const categoriesQuery = useCategories();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);

  const categories = useMemo(
    () =>
      (categoriesQuery.data ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [categoriesQuery.data],
  );
  const selectedCategory =
    categories.find((category) => category.id === selectedId) ?? categories[0];

  const questionsQuery = useQuestions(selectedCategory?.id);
  const questions = useMemo(
    () =>
      (questionsQuery.data ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [questionsQuery.data],
  );

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Questions" }]}
      title="Questions"
      subtitle="Intake form questions and categories"
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => setIsPreviewOpen((open) => !open)}
            aria-pressed={isPreviewOpen}
          >
            {isPreviewOpen ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
            {isPreviewOpen ? "Hide preview" : "Show preview"}
          </Button>
          <Button
            disabled={selectedCategory === undefined}
            onClick={() =>
              selectedCategory !== undefined &&
              setEditorState({ mode: "create", categoryId: selectedCategory.id })
            }
          >
            <Plus aria-hidden="true" />
            New question
          </Button>
        </>
      }
    />
  );

  if (categoriesQuery.isPending) {
    return (
      <div>
        {header}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr] xl:grid-cols-[16rem_1fr_22rem]">
          <LoadingSkeleton variant="list" rows={5} label="Loading categories…" />
          <LoadingSkeleton variant="list" rows={6} label="Loading questions…" />
          <div className="hidden xl:block">
            <LoadingSkeleton variant="card" rows={2} label="Loading preview…" />
          </div>
        </div>
      </div>
    );
  }

  if (categoriesQuery.isError) {
    return (
      <div>
        {header}
        <ErrorState
          error={categoriesQuery.error}
          onRetry={() => void categoriesQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div>
      {header}
      <div
        className={
          isPreviewOpen
            ? "grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr] xl:grid-cols-[16rem_1fr_22rem]"
            : "grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]"
        }
      >
        <section aria-label="Categories">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-tight text-neutral-500">
            Categories
          </h2>
          <CategoryPane
            categories={categories}
            selectedCategoryId={selectedCategory?.id}
            onSelectCategory={setSelectedId}
          />
        </section>

        <section aria-label="Questions in category">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-tight text-neutral-500">
            {selectedCategory !== undefined
              ? `Questions — ${selectedCategory.label}`
              : "Questions"}
          </h2>
          {selectedCategory === undefined ? (
            <p className="text-sm text-neutral-500">
              Create a category to start adding questions.
            </p>
          ) : questionsQuery.isPending ? (
            <LoadingSkeleton variant="list" rows={6} label="Loading questions…" />
          ) : questionsQuery.isError ? (
            <ErrorState
              error={questionsQuery.error}
              onRetry={() => void questionsQuery.refetch()}
            />
          ) : (
            <QuestionPane
              categoryId={selectedCategory.id}
              categoryLabel={selectedCategory.label}
              questions={questions}
              onCreate={() =>
                setEditorState({
                  mode: "create",
                  categoryId: selectedCategory.id,
                })
              }
              onEdit={(question) => setEditorState({ mode: "edit", question })}
            />
          )}
        </section>

        {isPreviewOpen ? (
          <section aria-label="Live preview">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-tight text-neutral-500">
              Live preview
            </h2>
            <PreviewPane />
          </section>
        ) : null}
      </div>

      {editorState !== null ? (
        <QuestionEditor
          key={
            editorState.mode === "edit"
              ? editorState.question.id
              : `create-${editorState.categoryId}`
          }
          state={editorState}
          categories={categories}
          onClose={() => setEditorState(null)}
        />
      ) : null}
    </div>
  );
}
