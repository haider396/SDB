/**
 * Data hooks for the public intake form (03-INTAKE-FORM-ENGINE.md §3,
 * 04-API.md §3). Both endpoints are public — `auth: false` skips the token
 * lookup entirely so the public form never touches the Supabase client
 * (AC-IF-17: nothing is written to localStorage/sessionStorage).
 */
import { useMutation, useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  IntakeFormResponseSchema,
  IntakeSubmissionResponseSchema,
  type IntakeFormResponse,
  type IntakeSubmission,
  type IntakeSubmissionResponse,
} from "@sdb/contracts";
import { apiFetch } from "@/lib/api-client";
import { PublicTaxonomySchema, type PublicTaxonomy } from "./taxonomy";

export function usePublicTaxonomy() {
  return useQuery<PublicTaxonomy>({
    queryKey: ["taxonomy", "public"],
    queryFn: async () => {
      const payload = await apiFetch<unknown>("/taxonomy/public", {
        auth: false,
      });
      return PublicTaxonomySchema.parse(payload);
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Fetches the form definition; refetches when the role category changes
 * (05 §5 req 1). Previous questions stay on screen while the role-scoped
 * set loads, so backward navigation never flashes empty.
 */
export function useIntakeForm(roleCategoryId: string | undefined) {
  return useQuery<IntakeFormResponse>({
    queryKey: ["intake-form", roleCategoryId ?? null],
    queryFn: async () => {
      const payload = await apiFetch<unknown>("/intake-form", {
        auth: false,
        query: { roleCategoryId, audience: "client" },
      });
      return IntakeFormResponseSchema.parse(payload);
    },
    placeholderData: keepPreviousData,
  });
}

export function useSubmitIntake() {
  return useMutation<IntakeSubmissionResponse, unknown, IntakeSubmission>({
    mutationFn: async (submission) => {
      const payload = await apiFetch<unknown>("/intake-submissions", {
        method: "POST",
        auth: false,
        body: submission,
      });
      return IntakeSubmissionResponseSchema.parse(payload);
    },
  });
}
