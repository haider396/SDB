/**
 * Data hooks for the question manager (docs/04-API.md §4, 03 §2).
 *
 * Query keys:
 *   ["question-categories"]                 — all categories, admin view
 *   ["questions", categoryId]               — questions of one category
 *   ["question-detail", id]                 — detail incl. dependents
 *   ["question-preview", roleCategoryId]    — the ACTUAL client form payload
 *
 * Every successful mutation invalidates ["question-preview"] so the live
 * preview reflects the edit without a page reload (AC-Q-14), plus the list
 * keys it touched. Reorder and active toggles are optimistic with rollback
 * and a toast on failure (05 §4.5).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  IntakeFormResponseSchema,
  PublicTaxonomySchema,
  type CreateQuestionBody,
  type CreateQuestionCategoryBody,
  type CreateQuestionOptionBody,
  type IntakeFormResponse,
  type PublicTaxonomy,
  type Question,
  type QuestionCategory,
  type QuestionDeactivateWarning,
  type QuestionDetail,
  type UpdateQuestionBody,
  type UpdateQuestionCategoryBody,
  type UpdateQuestionOptionBody,
} from "@sdb/contracts";
import {
  apiFetch,
  apiFetchCollection,
  apiFetchEnvelope,
  ApiError,
} from "@/lib/api-client";

export const questionKeys = {
  categories: ["question-categories"] as const,
  questionsRoot: ["questions"] as const,
  allQuestions: ["questions", "all"] as const,
  questions: (categoryId: string) => ["questions", categoryId] as const,
  detail: (id: string) => ["question-detail", id] as const,
  preview: (roleCategoryId: string | null) =>
    ["question-preview", roleCategoryId] as const,
  previewRoot: ["question-preview"] as const,
  taxonomy: ["taxonomy", "public"] as const,
};

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Everything the preview shows depends on; call after ANY successful edit. */
function invalidatePreview(
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  void queryClient.invalidateQueries({ queryKey: questionKeys.previewRoot });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useCategories() {
  return useQuery<QuestionCategory[]>({
    queryKey: questionKeys.categories,
    queryFn: async () => {
      const { data } = await apiFetchCollection<QuestionCategory>(
        "/question-categories",
      );
      return data;
    },
  });
}

/** Every question across categories — controller choices for conditionals. */
export function useAllQuestions() {
  return useQuery<Question[]>({
    queryKey: questionKeys.allQuestions,
    queryFn: async () => {
      const { data } = await apiFetchCollection<Question>("/questions");
      return data;
    },
  });
}

export function useQuestions(categoryId: string | undefined) {
  return useQuery<Question[]>({
    queryKey:
      categoryId === undefined
        ? ["questions", "none"]
        : questionKeys.questions(categoryId),
    queryFn: async () => {
      if (categoryId === undefined) return [];
      const { data } = await apiFetchCollection<Question>("/questions", {
        query: { categoryId, includeAnswerCounts: true },
      });
      return data;
    },
    enabled: categoryId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useQuestionDetail(id: string | undefined) {
  return useQuery<QuestionDetail>({
    queryKey: id === undefined ? ["question-detail", "none"] : questionKeys.detail(id),
    queryFn: async () => {
      if (id === undefined) throw new Error("No question id");
      return apiFetch<QuestionDetail>(`/questions/${id}`);
    },
    enabled: id !== undefined,
  });
}

/** The EXACT public form payload, filtered by role category (03 §2.2). */
export function usePreview(roleCategoryId: string | null) {
  return useQuery<IntakeFormResponse>({
    queryKey: questionKeys.preview(roleCategoryId),
    queryFn: async () => {
      const payload = await apiFetch<unknown>("/questions/preview", {
        query: { roleCategoryId: roleCategoryId ?? undefined },
      });
      return IntakeFormResponseSchema.parse(payload);
    },
    placeholderData: keepPreviousData,
  });
}

/** Taxonomy for the role-category scoping multi-select and preview filter. */
export function useTaxonomy() {
  return useQuery<PublicTaxonomy>({
    queryKey: questionKeys.taxonomy,
    queryFn: async () => {
      const payload = await apiFetch<unknown>("/taxonomy/public");
      return PublicTaxonomySchema.parse(payload);
    },
    staleTime: 5 * 60_000,
  });
}

/** Flat list of role categories with their engine/department path labels. */
export interface RoleCategoryChoice {
  id: string;
  label: string;
  pathLabel: string;
}

export function roleCategoryChoices(
  taxonomy: PublicTaxonomy | undefined,
): RoleCategoryChoice[] {
  if (taxonomy === undefined) return [];
  return taxonomy.engines.flatMap((engine) =>
    engine.departments.flatMap((department) =>
      department.roleCategories.map((roleCategory) => ({
        id: roleCategory.id,
        label: roleCategory.label,
        pathLabel: `${engine.label} › ${department.label} › ${roleCategory.label}`,
      })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Category mutations
// ---------------------------------------------------------------------------

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation<QuestionCategory, unknown, CreateQuestionCategoryBody>({
    mutationFn: (body) =>
      apiFetch<QuestionCategory>("/question-categories", {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: questionKeys.categories });
      invalidatePreview(queryClient);
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation<
    QuestionCategory,
    unknown,
    { id: string; body: UpdateQuestionCategoryBody }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<QuestionCategory>(`/question-categories/${id}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: questionKeys.categories });
      invalidatePreview(queryClient);
    },
  });
}

/** Optimistic drag/keyboard reorder of categories, rollback on failure. */
export function useReorderCategories() {
  const queryClient = useQueryClient();
  return useMutation<
    { reordered: true },
    unknown,
    string[],
    { previous: QuestionCategory[] | undefined }
  >({
    mutationFn: (orderedCategoryIds) =>
      apiFetch<{ reordered: true }>("/question-categories/reorder", {
        method: "PATCH",
        body: { orderedCategoryIds },
      }),
    onMutate: async (orderedCategoryIds) => {
      await queryClient.cancelQueries({ queryKey: questionKeys.categories });
      const previous = queryClient.getQueryData<QuestionCategory[]>(
        questionKeys.categories,
      );
      if (previous !== undefined) {
        const byId = new Map(previous.map((category) => [category.id, category]));
        const next = orderedCategoryIds
          .map((id) => byId.get(id))
          .filter((category): category is QuestionCategory => category !== undefined)
          .map((category, index) => ({ ...category, sortOrder: index + 1 }));
        queryClient.setQueryData(questionKeys.categories, next);
      }
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(questionKeys.categories, context.previous);
      }
      toast.error(
        failureMessage(error, "Could not save the new category order."),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: questionKeys.categories });
      invalidatePreview(queryClient);
    },
  });
}

/** Optimistic active toggle for a category, rollback on failure. */
export function useSetCategoryActive() {
  const queryClient = useQueryClient();
  return useMutation<
    QuestionCategory,
    unknown,
    { id: string; isActive: boolean },
    { previous: QuestionCategory[] | undefined }
  >({
    mutationFn: ({ id, isActive }) =>
      apiFetch<QuestionCategory>(
        `/question-categories/${id}/${isActive ? "activate" : "deactivate"}`,
        { method: "POST" },
      ),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: questionKeys.categories });
      const previous = queryClient.getQueryData<QuestionCategory[]>(
        questionKeys.categories,
      );
      if (previous !== undefined) {
        queryClient.setQueryData(
          questionKeys.categories,
          previous.map((category) =>
            category.id === id ? { ...category, isActive } : category,
          ),
        );
      }
      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(questionKeys.categories, context.previous);
      }
      toast.error(
        failureMessage(
          error,
          `Could not ${variables.isActive ? "activate" : "deactivate"} the category.`,
        ),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: questionKeys.categories });
      invalidatePreview(queryClient);
    },
  });
}

// ---------------------------------------------------------------------------
// Question mutations
// ---------------------------------------------------------------------------

function invalidateQuestionLists(
  queryClient: ReturnType<typeof useQueryClient>,
  _categoryId: string,
): void {
  // Root key matches every per-category list AND the all-questions list.
  void queryClient.invalidateQueries({ queryKey: questionKeys.questionsRoot });
  // questionCount on categories changes with create/archive; cheap to refresh.
  void queryClient.invalidateQueries({ queryKey: questionKeys.categories });
  invalidatePreview(queryClient);
}

export function useCreateQuestion() {
  const queryClient = useQueryClient();
  return useMutation<QuestionDetail, unknown, CreateQuestionBody>({
    mutationFn: (body) =>
      apiFetch<QuestionDetail>("/questions", { method: "POST", body }),
    onSuccess: (created) => {
      invalidateQuestionLists(queryClient, created.categoryId);
    },
  });
}

export function useUpdateQuestion() {
  const queryClient = useQueryClient();
  return useMutation<
    QuestionDetail,
    unknown,
    { id: string; categoryId: string; body: UpdateQuestionBody }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<QuestionDetail>(`/questions/${id}`, { method: "PATCH", body }),
    onSuccess: (updated, { id, categoryId }) => {
      queryClient.setQueryData(questionKeys.detail(id), updated);
      invalidateQuestionLists(queryClient, categoryId);
      if (updated.categoryId !== categoryId) {
        invalidateQuestionLists(queryClient, updated.categoryId);
      }
    },
  });
}

/** Optimistic drag/keyboard reorder within a category, rollback on failure. */
export function useReorderQuestions() {
  const queryClient = useQueryClient();
  return useMutation<
    { reordered: true },
    unknown,
    { categoryId: string; orderedQuestionIds: string[] },
    { previous: Question[] | undefined }
  >({
    mutationFn: ({ categoryId, orderedQuestionIds }) =>
      apiFetch<{ reordered: true }>("/questions/reorder", {
        method: "PATCH",
        body: { categoryId, orderedQuestionIds },
      }),
    onMutate: async ({ categoryId, orderedQuestionIds }) => {
      const key = questionKeys.questions(categoryId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Question[]>(key);
      if (previous !== undefined) {
        const byId = new Map(previous.map((question) => [question.id, question]));
        const next = orderedQuestionIds
          .map((id) => byId.get(id))
          .filter((question): question is Question => question !== undefined)
          .map((question, index) => ({ ...question, sortOrder: index + 1 }));
        queryClient.setQueryData(key, next);
      }
      return { previous };
    },
    onError: (error, { categoryId }, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          questionKeys.questions(categoryId),
          context.previous,
        );
      }
      toast.error(
        failureMessage(error, "Could not save the new question order."),
      );
    },
    onSettled: (_data, _error, { categoryId }) => {
      void queryClient.invalidateQueries({
        queryKey: questionKeys.questions(categoryId),
      });
      invalidatePreview(queryClient);
    },
  });
}

export interface DeactivateQuestionResult {
  question: QuestionDetail;
  warnings: QuestionDeactivateWarning[];
}

/**
 * Optimistic activate/deactivate toggle. Deactivation resolves with the
 * server's warnings[] naming conditional dependents (AC-Q-09) so the caller
 * can raise the warnings dialog (03 §2.3).
 */
export function useSetQuestionActive() {
  const queryClient = useQueryClient();
  return useMutation<
    DeactivateQuestionResult,
    unknown,
    { id: string; categoryId: string; isActive: boolean },
    { previous: Question[] | undefined }
  >({
    mutationFn: async ({ id, isActive }) => {
      if (isActive) {
        const question = await apiFetch<QuestionDetail>(
          `/questions/${id}/activate`,
          { method: "POST" },
        );
        return { question, warnings: [] };
      }
      const envelope = await apiFetchEnvelope<{
        data: QuestionDetail;
        warnings: QuestionDeactivateWarning[];
      }>(`/questions/${id}/deactivate`, { method: "POST" });
      return { question: envelope.data, warnings: envelope.warnings };
    },
    onMutate: async ({ id, categoryId, isActive }) => {
      const key = questionKeys.questions(categoryId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Question[]>(key);
      if (previous !== undefined) {
        queryClient.setQueryData(
          key,
          previous.map((question) =>
            question.id === id ? { ...question, isActive } : question,
          ),
        );
      }
      return { previous };
    },
    onError: (error, { categoryId, isActive }, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          questionKeys.questions(categoryId),
          context.previous,
        );
      }
      toast.error(
        failureMessage(
          error,
          `Could not ${isActive ? "activate" : "deactivate"} the question.`,
        ),
      );
    },
    onSettled: (_data, _error, { categoryId }) => {
      invalidateQuestionLists(queryClient, categoryId);
    },
  });
}

export function useDuplicateQuestion() {
  const queryClient = useQueryClient();
  return useMutation<QuestionDetail, unknown, { id: string; categoryId: string }>({
    mutationFn: ({ id }) =>
      apiFetch<QuestionDetail>(`/questions/${id}/duplicate`, {
        method: "POST",
      }),
    onSuccess: (duplicated) => {
      invalidateQuestionLists(queryClient, duplicated.categoryId);
      toast.success(`Duplicated as “${duplicated.label}”.`);
    },
    onError: (error) => {
      toast.error(failureMessage(error, "Could not duplicate the question."));
    },
  });
}

/** Soft archive (03 §1.5). Mapped questions 409 MAPPED_QUESTION_PROTECTED. */
export function useArchiveQuestion() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, { id: string; categoryId: string }>({
    // 204 No Content — apiFetchEnvelope, since there is no { data } to unwrap.
    mutationFn: async ({ id }) => {
      await apiFetchEnvelope<undefined>(`/questions/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: (_data, { categoryId }) => {
      invalidateQuestionLists(queryClient, categoryId);
    },
  });
}

// ---------------------------------------------------------------------------
// Option mutations (edit mode — create mode sends options in the POST body)
// ---------------------------------------------------------------------------

export function useAddOption() {
  const queryClient = useQueryClient();
  return useMutation<
    QuestionDetail,
    unknown,
    { questionId: string; categoryId: string; body: CreateQuestionOptionBody }
  >({
    mutationFn: ({ questionId, body }) =>
      apiFetch<QuestionDetail>(`/questions/${questionId}/options`, {
        method: "POST",
        body,
      }),
    onSuccess: (updated, { questionId, categoryId }) => {
      queryClient.setQueryData(questionKeys.detail(questionId), updated);
      invalidateQuestionLists(queryClient, categoryId);
    },
  });
}

export function useUpdateOption() {
  const queryClient = useQueryClient();
  return useMutation<
    QuestionDetail,
    unknown,
    {
      questionId: string;
      categoryId: string;
      optionId: string;
      body: UpdateQuestionOptionBody;
    }
  >({
    mutationFn: ({ questionId, optionId, body }) =>
      apiFetch<QuestionDetail>(
        `/questions/${questionId}/options/${optionId}`,
        { method: "PATCH", body },
      ),
    onSuccess: (updated, { questionId, categoryId }) => {
      queryClient.setQueryData(questionKeys.detail(questionId), updated);
      invalidateQuestionLists(queryClient, categoryId);
    },
  });
}

export function useDeactivateOption() {
  const queryClient = useQueryClient();
  return useMutation<
    QuestionDetail,
    unknown,
    { questionId: string; categoryId: string; optionId: string }
  >({
    mutationFn: ({ questionId, optionId }) =>
      apiFetch<QuestionDetail>(
        `/questions/${questionId}/options/${optionId}/deactivate`,
        { method: "POST" },
      ),
    onSuccess: (updated, { questionId, categoryId }) => {
      queryClient.setQueryData(questionKeys.detail(questionId), updated);
      invalidateQuestionLists(queryClient, categoryId);
    },
  });
}
