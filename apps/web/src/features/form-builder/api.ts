/**
 * Form-builder server state.
 *
 * Public reads use `auth: false` — a candidate has no session, and the token
 * lookup must be skipped entirely so the Supabase client is never initialised
 * on a public page.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  CandidateFormDetail,
  CandidateFormSummary,
  CandidateFormVersion,
  CreateCandidateFormBody,
  FormBlock,
  FormDocument,
  UpdateCandidateFormBody,
  UpdateFormBlockBody,
} from "@sdb/contracts";
import { ApiError, apiFetch } from "@/lib/api-client";

export interface PublicFormPayload {
  form: {
    slug: string;
    key: string;
    label: string;
    description: string | null;
    hasTypingTest: boolean;
    hasDocumentsStep: boolean;
    isDefault: boolean;
    roleCategory: { id: string; key: string; label: string } | null;
  };
  formVersionId: string;
  formVersionHash: string;
  generatedAt: string;
  theme: FormDocument["theme"];
  pages: FormDocument["pages"];
  blocks: FormBlock[];
  categories: {
    id: string;
    key: string;
    label: string;
    description: string | null;
    sortOrder: number;
    questions: import("@sdb/contracts").IntakeFormQuestion[];
  }[];
}

export const formKeys = {
  root: ["candidate-forms"] as const,
  list: ["candidate-forms", "list"] as const,
  detail: (id: string) => ["candidate-forms", "detail", id] as const,
  publicForm: (slug: string) => ["candidate-forms", "public", slug] as const,
};

/** The public payload for /f/:slug. Unauthenticated. */
export function usePublicForm(slug: string): UseQueryResult<PublicFormPayload> {
  return useQuery({
    queryKey: formKeys.publicForm(slug),
    queryFn: async () => {
      return await apiFetch<PublicFormPayload>(
        `/candidate-forms/public/${encodeURIComponent(slug)}`,
        { auth: false },
      );
    },
    retry: false,
  });
}

export function useFormList() {
  return useQuery({
    queryKey: formKeys.list,
    queryFn: async () => {
      return await apiFetch<CandidateFormSummary[]>("/candidate-forms");
    },
  });
}

export function useForm(id: string) {
  return useQuery({
    queryKey: formKeys.detail(id),
    queryFn: async () => {
      return await apiFetch<CandidateFormDetail>(`/candidate-forms/${id}`);
    },
  });
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * The per-field reasons behind a 422, in the order the server listed them.
 *
 * The activation gate already writes admin-readable sentences — "This form
 * must ask for an email address — it is how a candidate is identified." —
 * into details.fields. Reading only error.message threw all of that away and
 * left the admin with "This form is not ready to go live." and nothing to act
 * on. The candidate-facing renderer has always read these; the builder did not.
 */
export function errorFieldMessages(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const fields = error.details?.["fields"];
  if (typeof fields !== "object" || fields === null) return [];
  return Object.values(fields as Record<string, unknown>).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function useCreateForm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateCandidateFormBody) => {
      return await apiFetch<CandidateFormDetail>("/candidate-forms", {
        method: "POST",
        body,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formKeys.root });
    },
  });
}

export function useUpdateForm(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateCandidateFormBody) => {
      return await apiFetch<CandidateFormDetail>(`/candidate-forms/${id}`, {
        method: "PATCH",
        body,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formKeys.detail(id) });
    },
  });
}

/** Whole-document save — the builder's Save button. */
export function useSaveDocument(id: string, versionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (document: FormDocument) => {
      return await apiFetch<CandidateFormVersion>(
        `/candidate-forms/${id}/versions/${versionId}`,
        { method: "PUT", body: document },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formKeys.detail(id) });
    },
  });
}

/** Single-block patch — the drag/resize endpoint. */
export function usePatchBlock(id: string, versionId: string) {
  return useMutation({
    mutationFn: async (input: { blockId: string; patch: UpdateFormBlockBody }) => {
      return await apiFetch<FormBlock>(
        `/candidate-forms/${id}/versions/${versionId}/blocks/${input.blockId}`,
        { method: "PATCH", body: input.patch },
      );
    },
    onError: (error: unknown) => {
      toast.error(failureMessage(error, "Could not move the block."));
    },
  });
}

/**
 * Activate / deactivate. Optimistic with rollback, matching
 * question-manager/api.ts — a status toggle that lags feels broken, but a
 * failed one must not leave the UI lying about whether the link is live.
 */
export function useSetFormStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (next: "active" | "inactive") => {
      const path = next === "active" ? "activate" : "deactivate";
      return await apiFetch<unknown>(`/candidate-forms/${id}/${path}`, {
        method: "POST",
      });
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: formKeys.detail(id) });
      const previous = queryClient.getQueryData<CandidateFormDetail>(
        formKeys.detail(id),
      );
      if (previous !== undefined) {
        queryClient.setQueryData<CandidateFormDetail>(formKeys.detail(id), {
          ...previous,
          status: next,
        });
      }
      return { previous };
    },
    onError: (error: unknown, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(formKeys.detail(id), context.previous);
      }
      const reasons = errorFieldMessages(error);
      toast.error(
        failureMessage(error, "Could not change the form's status."),
        // A list of blockers does not belong in a toast that disappears — the
        // page renders them inline. Keep the toast to the headline.
        reasons.length > 0 ? { description: "See the list on the page." } : {},
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: formKeys.root });
    },
  });
}

export function useCreateDraft(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return await apiFetch<CandidateFormVersion>(
        `/candidate-forms/${id}/versions`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formKeys.detail(id) });
    },
  });
}

/**
 * Delete a form. Soft on the server (archived_at), and refused there if the
 * form is still live or is the seeded default — so the guard rails hold even
 * if this UI is bypassed.
 */
export function useDeleteForm(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch<{ deleted: true }>(`/candidate-forms/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formKeys.root });
    },
  });
}

/**
 * Delete by id supplied at call time — for the forms list, where one dialog
 * serves every row rather than a hook per row.
 */
export function useDeleteFormById() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<{ deleted: true }>(`/candidate-forms/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: formKeys.root });
    },
  });
}
