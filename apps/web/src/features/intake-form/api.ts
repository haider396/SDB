/**
 * Data hooks for the intake form engine (03-INTAKE-FORM-ENGINE.md §3,
 * 04-API.md §3). One engine, two entry points (03 §3.5):
 *
 * - Public (default, `authenticated = false`): `auth: false` skips the token
 *   lookup entirely so the public form never touches the Supabase client
 *   (AC-IF-17: nothing is written to localStorage/sessionStorage).
 * - In-portal (`authenticated = true`): the same GETs carry a bearer token,
 *   and submission goes to POST /requisitions instead of /intake-submissions.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  InPortalRequisitionResponseSchema,
  IntakeFormResponseSchema,
  IntakeSubmissionResponseSchema,
  type InPortalRequisitionResponse,
  type IntakeFormResponse,
  type IntakeSubmission,
  type IntakeSubmissionResponse,
} from "@sdb/contracts";
import { apiFetch } from "@/lib/api-client";
import { PublicTaxonomySchema, type PublicTaxonomy } from "./taxonomy";

export function usePublicTaxonomy(authenticated = false) {
  return useQuery<PublicTaxonomy>({
    queryKey: ["taxonomy", "public", authenticated],
    queryFn: async () => {
      const payload = await apiFetch<unknown>("/taxonomy/public", {
        auth: authenticated,
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
export function useIntakeForm(
  roleCategoryId: string | undefined,
  authenticated = false,
) {
  return useQuery<IntakeFormResponse>({
    queryKey: ["intake-form", roleCategoryId ?? null, authenticated],
    queryFn: async () => {
      const payload = await apiFetch<unknown>("/intake-form", {
        auth: authenticated,
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

/**
 * In-portal second-hire submission (03 §3.5): POST /requisitions with the
 * SAME wire shape, attaching server-side to the caller's own client — no
 * clientId is ever sent from the browser (04 §1.3).
 */
export function useSubmitInPortalRequisition() {
  const queryClient = useQueryClient();
  return useMutation<InPortalRequisitionResponse, unknown, IntakeSubmission>({
    mutationFn: async (submission) => {
      const payload = await apiFetch<unknown>("/requisitions", {
        method: "POST",
        body: submission,
      });
      return InPortalRequisitionResponseSchema.parse(payload);
    },
    onSuccess: () => {
      // The client portal's dashboard + requisition list now have one more
      // row (features/client-portal/api.ts key prefix).
      void queryClient.invalidateQueries({ queryKey: ["client-portal"] });
    },
  });
}
