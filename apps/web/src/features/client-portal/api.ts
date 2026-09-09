/**
 * Data hooks for the P5 client portal (docs/04-API.md §7/§9/§10/§12,
 * 01 §3 J3/J6/J7).
 *
 * Every endpoint here is tenant-scoped SERVER-side — no hook ever sends a
 * clientId. The assignment listing returns ClientVisibleAssignment rows
 * (the 02 §11 view, gated PII nulled in SQL); this module never touches the
 * admin assignment shape.
 *
 * Query keys:
 *   ["client-portal", "dashboard"]                 — ClientDashboard
 *   ["client-portal", "requisitions"]              — Requisition[] (own)
 *   ["requisitions", "detail", id]                 — shared with admin key
 *     shape so nothing double-caches if a user ever holds both scopes
 *   ["client-portal", "assignments", requisitionId] — ClientVisibleAssignment[]
 *   ["client-portal", "interviews", assignmentId]  — Interview[]
 *
 * Decisions (approve / reject / request interview) are optimistic with
 * rollback (05 §4.5): the card updates immediately, a failure restores the
 * previous list and the caller toasts.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  ClientDashboard,
  ClientVisibleAssignment,
  Interview,
  RejectBody,
  Requisition,
  PublicTaxonomy,
  RequisitionDetail,
} from "@sdb/contracts";
import { apiFetch, apiFetchCollection } from "@/lib/api-client";
import { requisitionKeys } from "@/features/requisitions/api";

export const clientPortalKeys = {
  dashboard: ["client-portal", "dashboard"] as const,
  requisitions: ["client-portal", "requisitions"] as const,
  assignments: (requisitionId: string) =>
    ["client-portal", "assignments", requisitionId] as const,
  interviews: (assignmentId: string) =>
    ["client-portal", "interviews", assignmentId] as const,
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useClientDashboard(): UseQueryResult<ClientDashboard, Error> {
  return useQuery<ClientDashboard, Error>({
    queryKey: clientPortalKeys.dashboard,
    queryFn: () => apiFetch<ClientDashboard>("/client/dashboard"),
  });
}

/** The caller's own requisitions — implicitly scoped, no filters sent. */
/**
 * `ListRequisitionsQuerySchema` caps `limit` at 100, so a single request can
 * never return more than that — and this list used to ask for exactly 100 and
 * keep whatever came back. A client with 101 positions silently saw 100, with
 * no counter, no "load more" and nothing in the UI to suggest anything was
 * missing. Silent truncation on a list someone uses to check on their hires is
 * the worst shape a bug can take: it looks like it worked.
 *
 * So follow the cursor to the end. The page holds the whole list in memory on
 * purpose — grouping and sorting it (T24) then need no server round trip.
 */
const REQUISITIONS_PAGE_SIZE = 100;
/**
 * A runaway-loop guard, not a business limit. A client with 1,000 open
 * positions needs a paginated screen, not a longer fetch — if this is ever
 * reached, that is the finding.
 */
const REQUISITIONS_MAX_PAGES = 10;

export function useClientRequisitions(): UseQueryResult<Requisition[], Error> {
  return useQuery<Requisition[], Error>({
    queryKey: clientPortalKeys.requisitions,
    queryFn: async () => {
      const all: Requisition[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < REQUISITIONS_MAX_PAGES; page += 1) {
        const { data, meta } = await apiFetchCollection<Requisition>(
          "/requisitions",
          {
            query:
              cursor === undefined
                ? { limit: REQUISITIONS_PAGE_SIZE }
                : { limit: REQUISITIONS_PAGE_SIZE, cursor },
          },
        );
        all.push(...data);
        if (meta.nextCursor === null) return all;
        cursor = meta.nextCursor;
      }

      return all;
    },
  });
}

/**
 * Department id → label, for grouping the positions list.
 *
 * The list payload (`RequisitionSchema`) carries only `departmentId`; the
 * label lives on the DETAIL schema's `taxonomy`, which the list does not
 * return. Rather than change a shared endpoint for one screen's heading, read
 * the labels from `GET /taxonomy/public` — the same source the public intake
 * form uses. It is unauthenticated, small, and cached, so this costs one
 * request per session and nothing on navigation.
 *
 * If the API later puts the label on the list row, this hook and the lookup
 * it feeds both disappear.
 */
export function useDepartmentLabels(): UseQueryResult<
  Record<string, string>,
  Error
> {
  return useQuery<Record<string, string>, Error>({
    queryKey: [...clientPortalKeys.requisitions, "department-labels"],
    queryFn: async () => {
      const taxonomy = await apiFetch<PublicTaxonomy>("/taxonomy/public");
      const labels: Record<string, string> = {};
      for (const engine of taxonomy.engines) {
        for (const department of engine.departments) {
          labels[department.id] = department.label;
        }
      }
      return labels;
    },
    staleTime: 5 * 60_000,
  });
}

export function useClientRequisition(
  id: string,
): UseQueryResult<RequisitionDetail, Error> {
  return useQuery<RequisitionDetail, Error>({
    queryKey: requisitionKeys.detail(id),
    queryFn: () => apiFetch<RequisitionDetail>(`/requisitions/${id}`),
  });
}

/** Client-visible assignments only — the 02 §11 view shape, nothing else. */
export function useClientAssignments(
  requisitionId: string,
): UseQueryResult<ClientVisibleAssignment[], Error> {
  return useQuery<ClientVisibleAssignment[], Error>({
    queryKey: clientPortalKeys.assignments(requisitionId),
    queryFn: async () => {
      const { data } = await apiFetchCollection<ClientVisibleAssignment>(
        `/requisitions/${requisitionId}/assignments`,
      );
      return data;
    },
  });
}

/** Interview rounds for an unlocked assignment; newest round last. */
export function useAssignmentInterviews(
  assignmentId: string,
  enabled: boolean,
): UseQueryResult<Interview[], Error> {
  return useQuery<Interview[], Error>({
    queryKey: clientPortalKeys.interviews(assignmentId),
    queryFn: async () => {
      const { data } = await apiFetchCollection<Interview>(
        `/assignments/${assignmentId}/interviews`,
      );
      return data;
    },
    enabled,
  });
}

// ---------------------------------------------------------------------------
// Decisions (01 §3 J6) — optimistic with rollback
// ---------------------------------------------------------------------------

interface DecisionContext {
  previous: ClientVisibleAssignment[] | undefined;
}

function useInvalidateAfterDecision(requisitionId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: clientPortalKeys.assignments(requisitionId),
    });
    // The page keys the requisition detail by the route param (possibly the
    // public id) while decisions carry the UUID — invalidate the detail
    // ROOT so both forms refresh.
    void queryClient.invalidateQueries({
      queryKey: [...requisitionKeys.root, "detail"],
    });
    void queryClient.invalidateQueries({
      queryKey: clientPortalKeys.dashboard,
    });
  };
}

function useOptimisticStage(requisitionId: string) {
  const queryClient = useQueryClient();
  return {
    async apply(
      assignmentId: string,
      stage: ClientVisibleAssignment["stage"],
    ): Promise<DecisionContext> {
      const key = clientPortalKeys.assignments(requisitionId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ClientVisibleAssignment[]>(key);
      if (previous !== undefined) {
        queryClient.setQueryData<ClientVisibleAssignment[]>(
          key,
          previous.map((row) =>
            row.assignmentId === assignmentId ? { ...row, stage } : row,
          ),
        );
      }
      return { previous };
    },
    rollback(context: DecisionContext | undefined) {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(
          clientPortalKeys.assignments(requisitionId),
          context.previous,
        );
      }
    },
    settle(updated: ClientVisibleAssignment) {
      queryClient.setQueryData<ClientVisibleAssignment[]>(
        clientPortalKeys.assignments(requisitionId),
        (rows) =>
          rows === undefined
            ? rows
            : rows.map((row) =>
                row.assignmentId === updated.assignmentId ? updated : row,
              ),
      );
    },
  };
}

/** Approve for interview: presented → client_reviewing (J6 step 3). */
export function useApproveForInterview(requisitionId: string) {
  const optimistic = useOptimisticStage(requisitionId);
  const invalidate = useInvalidateAfterDecision(requisitionId);
  return useMutation<
    ClientVisibleAssignment,
    unknown,
    { assignmentId: string },
    DecisionContext
  >({
    mutationFn: ({ assignmentId }) =>
      apiFetch<ClientVisibleAssignment>(
        `/assignments/${assignmentId}/approve-for-interview`,
        { method: "POST" },
      ),
    onMutate: ({ assignmentId }) =>
      optimistic.apply(assignmentId, "client_reviewing"),
    onError: (_error, _args, context) => optimistic.rollback(context),
    onSuccess: (updated) => {
      optimistic.settle(updated);
      invalidate();
    },
  });
}

/** Reject: → rejected_by_client, structured reason required (AC-PL-11). */
export function useRejectCandidate(requisitionId: string) {
  const optimistic = useOptimisticStage(requisitionId);
  const invalidate = useInvalidateAfterDecision(requisitionId);
  return useMutation<
    unknown,
    unknown,
    { assignmentId: string; body: RejectBody },
    DecisionContext
  >({
    mutationFn: ({ assignmentId, body }) =>
      apiFetch<unknown>(`/assignments/${assignmentId}/reject`, {
        method: "POST",
        body,
      }),
    onMutate: ({ assignmentId }) =>
      optimistic.apply(assignmentId, "rejected_by_client"),
    onError: (_error, _args, context) => optimistic.rollback(context),
    // The reject endpoint returns the CORE assignment row, not the view
    // shape — never merge it into the client-visible cache; refetch instead.
    onSuccess: () => invalidate(),
  });
}

/**
 * Request interview: records the request and notifies the admin — the stage
 * does NOT change (scheduling is the admin's move, J7). The returned row
 * carries `interviewRequestedAt` (UX 3.2), settled into the cache so the
 * card's chip appears without waiting for the refetch.
 */
export function useRequestInterview(requisitionId: string) {
  const optimistic = useOptimisticStage(requisitionId);
  const invalidate = useInvalidateAfterDecision(requisitionId);
  return useMutation<ClientVisibleAssignment, unknown, { assignmentId: string }>(
    {
      mutationFn: ({ assignmentId }) =>
        apiFetch<ClientVisibleAssignment>(
          `/assignments/${assignmentId}/request-interview`,
          { method: "POST" },
        ),
      onSuccess: (updated) => {
        optimistic.settle(updated);
        invalidate();
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Principal approval (01 §3 J3)
// ---------------------------------------------------------------------------

function useInvalidatePrincipal() {
  const queryClient = useQueryClient();
  return (_id: string) => {
    // The approval panel mutates with the requisition's UUID while the page
    // keys its detail query by the route param (possibly the public id) —
    // invalidate the detail ROOT so both forms refresh.
    void queryClient.invalidateQueries({
      queryKey: [...requisitionKeys.root, "detail"],
    });
    void queryClient.invalidateQueries({
      queryKey: clientPortalKeys.dashboard,
    });
    void queryClient.invalidateQueries({
      queryKey: clientPortalKeys.requisitions,
    });
  };
}

/** Approve the brief: pending_principal_approval → sourcing. */
export function usePrincipalApprove() {
  const invalidate = useInvalidatePrincipal();
  return useMutation<RequisitionDetail, unknown, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<RequisitionDetail>(`/requisitions/${id}/principal-approve`, {
        method: "POST",
      }),
    onSuccess: (_updated, { id }) => invalidate(id),
  });
}

/** Request changes with a required comment: → changes_requested. */
export function usePrincipalRequestChanges() {
  const invalidate = useInvalidatePrincipal();
  return useMutation<RequisitionDetail, unknown, { id: string; comment: string }>(
    {
      mutationFn: ({ id, comment }) =>
        apiFetch<RequisitionDetail>(
          `/requisitions/${id}/principal-request-changes`,
          { method: "POST", body: { comment } },
        ),
      onSuccess: (_updated, { id }) => invalidate(id),
    },
  );
}
