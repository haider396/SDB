/**
 * Data hooks for the P4 pipeline board (docs/04-API.md §9, 01 §3 J4–J8).
 *
 * Query keys:
 *   ["pipeline", "assignments", requisitionId] — AdminAssignmentRow[]
 *   ["candidates", "detail", candidateId]      — shared with the candidates
 *     feature, so card hydration and the present review sheet reuse the same
 *     cache entries as the candidate workspace.
 *
 * Stage advances are optimistic with rollback (05 §4.5): the row moves
 * columns immediately, and a 409 INVALID_TRANSITION ({ from, to } in
 * details) rolls it back — the caller surfaces the toast.
 */
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AdminAssignmentRow,
  Assignment,
  AssignmentStage,
  CandidateDetail,
  CreateAssignmentsBody,
  Placement,
  PlaceBody,
  PresentBody,
  RejectBody,
} from "@sdb/contracts";
import { apiFetch, apiFetchCollection } from "@/lib/api-client";
import { candidateKeys } from "@/features/candidates/api";
import { requisitionKeys } from "@/features/requisitions/api";

export const pipelineKeys = {
  assignments: (requisitionId: string) =>
    ["pipeline", "assignments", requisitionId] as const,
};

export function useAssignments(requisitionId: string) {
  return useQuery<AdminAssignmentRow[]>({
    queryKey: pipelineKeys.assignments(requisitionId),
    queryFn: async () => {
      // Admin callers receive AdminAssignmentRow[] from this endpoint
      // (client-scoped callers get the view shape — never this surface).
      const { data } = await apiFetchCollection<AdminAssignmentRow>(
        `/requisitions/${requisitionId}/assignments`,
      );
      return data;
    },
  });
}

/**
 * Per-candidate detail hydration for board cards and the present review
 * sheet. The admin assignment row's candidate summary intentionally lacks
 * photoPath / English / accent (packages/contracts assignments.ts), so those
 * come from GET /candidates/:id — cached under the candidates feature's key
 * so the two surfaces share entries.
 */
export function useCandidateDetailsMap(
  candidateIds: readonly string[],
): Map<string, CandidateDetail> {
  const results = useQueries({
    queries: candidateIds.map((id) => ({
      queryKey: candidateKeys.detail(id),
      queryFn: () => apiFetch<CandidateDetail>(`/candidates/${id}`),
      staleTime: 60_000,
    })),
  });
  const map = new Map<string, CandidateDetail>();
  for (const result of results) {
    if (result.data !== undefined) map.set(result.data.id, result.data);
  }
  return map;
}

/** Invalidate everything a pipeline write can touch. */
function useInvalidatePipeline(requisitionId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: pipelineKeys.assignments(requisitionId),
    });
    // Present/place also move the requisition's own status + counts.
    void queryClient.invalidateQueries({
      queryKey: requisitionKeys.detail(requisitionId),
    });
    void queryClient.invalidateQueries({
      queryKey: requisitionKeys.events(requisitionId),
    });
  };
}

export function useCreateAssignments(requisitionId: string) {
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<AdminAssignmentRow[], unknown, CreateAssignmentsBody>({
    mutationFn: async (body) => {
      const { data } = await apiFetchCollection<AdminAssignmentRow>(
        `/requisitions/${requisitionId}/assignments`,
        { method: "POST", body },
      );
      return data;
    },
    onSuccess: () => invalidate(),
  });
}

export interface AdvanceArgs {
  assignmentId: string;
  toStage: AssignmentStage;
  note?: string;
}

interface AdvanceContext {
  previous: AdminAssignmentRow[] | undefined;
}

/**
 * Optimistic advance: the card moves columns immediately; on failure the
 * previous list is restored and the caller toasts (surfacing { from, to }
 * for 409 INVALID_TRANSITION).
 *
 * The optimistic row also gets `updatedAt = now` because days-in-stage is
 * derived from `updatedAt` — an approximation: the row carries no per-stage
 * timestamps, and updatedAt moves on any write, not only stage changes.
 */
export function useAdvanceAssignment(requisitionId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<AdminAssignmentRow, unknown, AdvanceArgs, AdvanceContext>({
    mutationFn: ({ assignmentId, toStage, note }) =>
      apiFetch<AdminAssignmentRow>(`/assignments/${assignmentId}/advance`, {
        method: "POST",
        body: note === undefined ? { toStage } : { toStage, note },
      }),
    onMutate: async ({ assignmentId, toStage }) => {
      const key = pipelineKeys.assignments(requisitionId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AdminAssignmentRow[]>(key);
      if (previous !== undefined) {
        queryClient.setQueryData<AdminAssignmentRow[]>(
          key,
          previous.map((row) =>
            row.id === assignmentId
              ? { ...row, stage: toStage, updatedAt: new Date().toISOString() }
              : row,
          ),
        );
      }
      return { previous };
    },
    onError: (_error, _args, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          pipelineKeys.assignments(requisitionId),
          context.previous,
        );
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminAssignmentRow[]>(
        pipelineKeys.assignments(requisitionId),
        (rows) =>
          rows === undefined
            ? rows
            : rows.map((row) => (row.id === updated.id ? updated : row)),
      );
      invalidate();
    },
  });
}

export interface UpdateNoteArgs {
  assignmentId: string;
  adminNote?: string | null;
  clientNote?: string | null;
}

export function useUpdateAssignmentNote(requisitionId: string) {
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<AdminAssignmentRow, unknown, UpdateNoteArgs>({
    mutationFn: ({ assignmentId, ...body }) =>
      apiFetch<AdminAssignmentRow>(`/assignments/${assignmentId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => invalidate(),
  });
}

/** Bulk present — all-or-nothing (422 CONSENT_MISSING lists candidateIds). */
export function usePresentAssignments(requisitionId: string) {
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<AdminAssignmentRow[], unknown, PresentBody>({
    mutationFn: async (body) => {
      const { data } = await apiFetchCollection<AdminAssignmentRow>(
        "/assignments/present",
        { method: "POST", body },
      );
      return data;
    },
    onSuccess: () => invalidate(),
  });
}

export interface RejectArgs {
  assignmentId: string;
  body: RejectBody;
}

export function useRejectAssignment(requisitionId: string) {
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<Assignment, unknown, RejectArgs>({
    mutationFn: ({ assignmentId, body }) =>
      apiFetch<Assignment>(`/assignments/${assignmentId}/reject`, {
        method: "POST",
        body,
      }),
    onSuccess: () => invalidate(),
  });
}

export interface PlaceArgs {
  assignmentId: string;
  body: PlaceBody;
}

export function usePlaceAssignment(requisitionId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<Placement, unknown, PlaceArgs>({
    mutationFn: ({ assignmentId, body }) =>
      apiFetch<Placement>(`/assignments/${assignmentId}/place`, {
        method: "POST",
        body,
      }),
    onSuccess: (placement) => {
      invalidate();
      // Placement flips the candidate's pool_status too (AC-PL-13).
      void queryClient.invalidateQueries({
        queryKey: candidateKeys.detail(placement.candidateId),
      });
      void queryClient.invalidateQueries({ queryKey: ["candidates", "list"] });
    },
  });
}
