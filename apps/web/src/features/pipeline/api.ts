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
  CreateInterviewBody,
  EntityEvent,
  Interview,
  OutcomeBody,
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
  events: (assignmentId: string) =>
    ["pipeline", "events", assignmentId] as const,
  interviews: (assignmentId: string) =>
    ["pipeline", "interviews", assignmentId] as const,
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

/**
 * Full audit trail for one assignment (04 §9 GET /assignments/:id/events),
 * fetched lazily — only while the history sheet is open.
 */
export function useAssignmentEvents(assignmentId: string | null) {
  return useQuery<EntityEvent[]>({
    queryKey: pipelineKeys.events(assignmentId ?? ""),
    enabled: assignmentId !== null,
    queryFn: async () => {
      const { data } = await apiFetchCollection<EntityEvent>(
        `/assignments/${assignmentId ?? ""}/events`,
      );
      return data;
    },
  });
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

// ---------------------------------------------------------------------------
// Interviews (P6, docs/04-API.md §10)
// ---------------------------------------------------------------------------

/**
 * Interview hydration for cards at `interview_scheduled` / `interviewed`
 * only — other stages have nothing to show, so their assignments are never
 * queried. Keyed per assignment so an outcome write invalidates one list.
 */
export function useInterviewsMap(
  assignmentIds: readonly string[],
): Map<string, Interview[]> {
  const results = useQueries({
    queries: assignmentIds.map((assignmentId) => ({
      queryKey: pipelineKeys.interviews(assignmentId),
      queryFn: async () => {
        const { data } = await apiFetchCollection<Interview>(
          `/assignments/${assignmentId}/interviews`,
        );
        return { assignmentId, interviews: data };
      },
      staleTime: 30_000,
    })),
  });
  const map = new Map<string, Interview[]>();
  for (const result of results) {
    if (result.data !== undefined) {
      map.set(result.data.assignmentId, result.data.interviews);
    }
  }
  return map;
}

/** The earliest still-pending interview — what the card shows and acts on. */
export function nextPendingInterview(
  interviews: Interview[] | undefined,
): Interview | null {
  const pending = (interviews ?? [])
    .filter((interview) => interview.outcome === "pending")
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  return pending[0] ?? null;
}

/** The most recently recorded real outcome (not pending/cancelled). */
export function latestRecordedOutcome(
  interviews: Interview[] | undefined,
): Interview | null {
  const recorded = (interviews ?? [])
    .filter(
      (interview) =>
        interview.outcome !== "pending" && interview.outcome !== "cancelled",
    )
    .sort((a, b) =>
      (a.outcomeRecordedAt ?? "").localeCompare(b.outcomeRecordedAt ?? ""),
    );
  return recorded[recorded.length - 1] ?? null;
}

export interface CreateInterviewArgs {
  assignmentId: string;
  body: CreateInterviewBody;
}

/**
 * POST /assignments/:id/interviews — THE stage gate: the assignment moves
 * client_reviewing → interview_scheduled server-side (409 INVALID_TRANSITION
 * from any other stage), and gated PII unlocks for the client.
 */
export function useCreateInterview(requisitionId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<Interview, unknown, CreateInterviewArgs>({
    mutationFn: ({ assignmentId, body }) =>
      apiFetch<Interview>(`/assignments/${assignmentId}/interviews`, {
        method: "POST",
        body,
      }),
    onSuccess: (interview) => {
      void queryClient.invalidateQueries({
        queryKey: pipelineKeys.interviews(interview.assignmentId),
      });
      invalidate();
    },
  });
}

export interface RecordOutcomeArgs {
  interview: Interview;
  body: OutcomeBody;
}

/**
 * POST /interviews/:id/outcome. Non-`rescheduled` outcomes also advance the
 * assignment to `interviewed` server-side; `rescheduled` keeps the stage.
 */
export function useRecordInterviewOutcome(requisitionId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<Interview, unknown, RecordOutcomeArgs>({
    mutationFn: ({ interview, body }) =>
      apiFetch<Interview>(`/interviews/${interview.id}/outcome`, {
        method: "POST",
        body,
      }),
    onSuccess: (interview) => {
      void queryClient.invalidateQueries({
        queryKey: pipelineKeys.interviews(interview.assignmentId),
      });
      invalidate();
    },
  });
}

/** POST /interviews/:id/cancel — outcome `cancelled`, stage NEVER changes. */
export function useCancelInterview(requisitionId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidatePipeline(requisitionId);
  return useMutation<Interview, unknown, Interview>({
    mutationFn: (interview) =>
      apiFetch<Interview>(`/interviews/${interview.id}/cancel`, {
        method: "POST",
      }),
    onSuccess: (interview) => {
      void queryClient.invalidateQueries({
        queryKey: pipelineKeys.interviews(interview.assignmentId),
      });
      invalidate();
    },
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
    onSuccess: () => {
      invalidate();
      // Placement flips the candidate's pool_status too (AC-PL-13). The
      // payload carries only the UUID, but detail pages key by their route
      // param — which may be the candidate's public id — so invalidate the
      // whole detail root rather than miss the public-id-keyed entry.
      void queryClient.invalidateQueries({
        queryKey: [...candidateKeys.root, "detail"],
      });
      void queryClient.invalidateQueries({ queryKey: ["candidates", "list"] });
    },
  });
}
