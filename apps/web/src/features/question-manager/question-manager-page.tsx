/**
 * /admin/questions — the two-pane question manager with live preview
 * (05 §4.7, 03 §2). Categories left, questions of the selected category
 * right, and a toggleable third pane rendering the actual client form.
 * A page-level search filters across ALL categories (the all-questions
 * list is already loaded for the conditional builder); picking a result
 * selects its category and highlights the question row.
 */
import { useMemo, useState } from "react";
import { Eye, EyeOff, Plus, Search } from "lucide-react";
import type { Question } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { useAllQuestions, useCategories, useQuestions } from "./api";
import { CategoryPane } from "./components/category-pane";
import { PreviewPane } from "./components/preview-pane";
import { QuestionEditor, type EditorState } from "./components/question-editor";
import { QuestionPane } from "./components/question-pane";

const MAX_SEARCH_RESULTS = 12;

export function QuestionManagerPage() {
  const categoriesQuery = useCategories();
  const allQuestionsQuery = useAllQuestions();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [highlightedQuestionId, setHighlightedQuestionId] = useState<
    string | null
  >(null);

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

  const categoryLabelById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.label])),
    [categories],
  );

  const needle = searchText.trim().toLowerCase();
  const searchMatches = useMemo(() => {
    if (needle === "") return [];
    return (allQuestionsQuery.data ?? [])
      .filter(
        (question) =>
          question.archivedAt === null &&
          (question.label.toLowerCase().includes(needle) ||
            question.key.toLowerCase().includes(needle)),
      )
      .slice(0, MAX_SEARCH_RESULTS);
  }, [allQuestionsQuery.data, needle]);

  const pickSearchResult = (question: Question) => {
    setSelectedId(question.categoryId);
    setHighlightedQuestionId(question.id);
    setSearchText("");
  };

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

      {/* ----- Search across every category ----- */}
      <div className="relative mb-6 w-full max-w-md">
        <Label htmlFor="question-search" className="sr-only">
          Search questions
        </Label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
        />
        <Input
          id="question-search"
          type="search"
          className="pl-8"
          placeholder="Search all questions…"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        {needle !== "" ? (
          <ul
            aria-label="Matching questions"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border-default bg-surface-raised py-1 shadow-lg"
          >
            {searchMatches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-neutral-500">
                No questions match “{searchText.trim()}”.
              </li>
            ) : (
              searchMatches.map((question) => (
                <li key={question.id}>
                  <button
                    type="button"
                    onClick={() => pickSearchResult(question)}
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-subtle focus-visible:bg-surface-subtle"
                  >
                    <span className="min-w-0 flex-1 truncate text-neutral-800">
                      {question.label}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {categoryLabelById.get(question.categoryId) ?? "—"}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <div
        className={
          isPreviewOpen
            ? "grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr] xl:grid-cols-[16rem_1fr_22rem]"
            : "grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]"
        }
      >
        <section aria-label="Categories">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Categories
          </h2>
          <CategoryPane
            categories={categories}
            selectedCategoryId={selectedCategory?.id}
            onSelectCategory={setSelectedId}
          />
        </section>

        <section aria-label="Questions in category">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
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
              highlightedQuestionId={highlightedQuestionId}
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
          /* Below xl the grid has only two columns — span both so the
             preview stacks full-width instead of wrapping into a 16rem
             sliver under the category pane. */
          <section
            aria-label="Live preview"
            className="lg:col-span-2 xl:col-span-1"
          >
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
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
