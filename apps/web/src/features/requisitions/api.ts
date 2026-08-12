/**
 * Data hooks for admin requisition management (docs/04-API.md §7, 01 §3 J3).
 *
 * Query keys:
 *   ["requisitions", "list", filters]  — cursor-paginated list (infinite)
 *   ["requisitions", "detail", id]     — detail incl. answers with snapshots
 *   ["requisitions", "events", id]     — chronological event log
 *
 * Commercial fields are key-ABSENT for callers without
 * requisition.view_commercials (AC-RQ-06) — callers must probe with `in`,
 * never assume the keys exist.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import type {
  EntityEvent,
  Requisition,
  RequisitionDetail,
  RequisitionStatus,
  TransitionRequisitionBody,
  UpdateRequisitionBody,
} from "@sdb/contracts";
import {
  apiFetch,
  apiFetchCollection,
  type Collection,
} from "@/lib/api-client";

export interface RequisitionListFilters {
  status?: RequisitionStatus;
  clientId?: string;
  search?: string;
}

export const requisitionKeys = {
  root: ["requisitions"] as const,
  list: (filters: RequisitionListFilters) =>
    ["requisitions", "list", filters] as const,
  detail: (id: string) => ["requisitions", "detail", id] as const,
  events: (id: string) => ["requisitions", "events", id] as const,
};

const PAGE_SIZE = 25;

export function useRequisitions(
  filters: RequisitionListFilters,
): UseInfiniteQueryResult<InfiniteData<Collection<Requisition>>, Error> {
  return useInfiniteQuery({
    queryKey: requisitionKeys.list(filters),
    queryFn: ({ pageParam }) =>
      apiFetchCollection<Requisition>("/requisitions", {
        query: {
          status: filters.status,
          clientId: filters.clientId,
          search: filters.search === "" ? undefined : filters.search,
          limit: PAGE_SIZE,
          cursor: pageParam,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  });
}

export function useRequisition(id: string) {
  return useQuery<RequisitionDetail>({
    queryKey: requisitionKeys.detail(id),
    queryFn: () => apiFetch<RequisitionDetail>(`/requisitions/${id}`),
  });
}

export function useRequisitionEvents(id: string) {
  return useQuery<EntityEvent[]>({
    queryKey: requisitionKeys.events(id),
    queryFn: async () => {
      const { data } = await apiFetchCollection<EntityEvent>(
        `/requisitions/${id}/events`,
      );
      return data;
    },
  });
}

function useInvalidateRequisition() {
  const queryClient = useQueryClient();
  return (id: string) => {
    void queryClient.invalidateQueries({ queryKey: requisitionKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: requisitionKeys.events(id) });
    void queryClient.invalidateQueries({ queryKey: ["requisitions", "list"] });
  };
}

export function useUpdateRequisition() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRequisition();
  return useMutation<
    RequisitionDetail,
    unknown,
    { id: string; body: UpdateRequisitionBody }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<RequisitionDetail>(`/requisitions/${id}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: (updated, { id }) => {
      queryClient.setQueryData(requisitionKeys.detail(id), updated);
      invalidate(id);
    },
  });
}

/** Generic state-machine transition; 409 INVALID_TRANSITION on bad edges. */
export function useTransitionRequisition() {
  const invalidate = useInvalidateRequisition();
  return useMutation<
    RequisitionDetail,
    unknown,
    { id: string; body: TransitionRequisitionBody }
  >({
    mutationFn: ({ id, body }) =>
      apiFetch<RequisitionDetail>(`/requisitions/${id}/transition`, {
        method: "POST",
        body,
      }),
    onSuccess: (_updated, { id }) => {
      invalidate(id);
    },
  });
}

/** Dedicated J3 entry point: moves to pending_principal_approval + notifies. */
export function useRequestPrincipalApproval() {
  const invalidate = useInvalidateRequisition();
  return useMutation<RequisitionDetail, unknown, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<RequisitionDetail>(
        `/requisitions/${id}/request-principal-approval`,
        { method: "POST" },
      ),
    onSuccess: (_updated, { id }) => {
      invalidate(id);
    },
  });
}
