/**
 * Data hooks for the P6 admin surfaces (docs/04-API.md §12):
 *
 *   ["admin", "attention-queue"]          — GET /admin/attention-queue
 *   ["admin", "stats"]                    — GET /admin/stats
 *   ["reports", "rejection-reasons", …]   — GET /reports/rejection-reasons
 *   ["taxonomy", "role-categories"]       — GET /role-categories (report filter)
 *
 * The queue is served from a 5-minute cache (06 §5); the manual Refresh
 * button re-requests with `?refresh=true` and writes the recomputed result
 * straight into the query cache so the page updates without a second GET.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AdminStats,
  AttentionQueue,
  RejectionActor,
  RejectionReasonsReport,
  RoleCategory,
} from "@sdb/contracts";
import { apiFetch, apiFetchCollection } from "@/lib/api-client";

export const adminDashboardKeys = {
  attentionQueue: ["admin", "attention-queue"] as const,
  stats: ["admin", "stats"] as const,
  rejectionReasonsReport: (query: RejectionReasonsReportQuery) =>
    [
      "reports",
      "rejection-reasons",
      query.from,
      query.to,
      query.actor ?? null,
      query.roleCategoryId ?? null,
    ] as const,
  roleCategories: ["taxonomy", "role-categories"] as const,
};

export function useAttentionQueue() {
  return useQuery<AttentionQueue>({
    queryKey: adminDashboardKeys.attentionQueue,
    queryFn: () => apiFetch<AttentionQueue>("/admin/attention-queue"),
  });
}

/**
 * Total queue size for the sidebar badge. Shares the queue's cache entry;
 * the long staleTime keeps navigation from hammering the endpoint (the
 * queue itself is served from a 5-minute server cache anyway, 06 §5).
 */
export function useAttentionQueueTotal(): number | undefined {
  const query = useQuery<AttentionQueue>({
    queryKey: adminDashboardKeys.attentionQueue,
    queryFn: () => apiFetch<AttentionQueue>("/admin/attention-queue"),
    staleTime: 5 * 60_000,
  });
  if (query.data === undefined) return undefined;
  return query.data.buckets.reduce((total, bucket) => total + bucket.count, 0);
}

/** Manual refresh: bypasses the server cache with `?refresh=true`. */
export function useRefreshAttentionQueue() {
  const queryClient = useQueryClient();
  return useMutation<AttentionQueue, unknown, void>({
    mutationFn: () =>
      apiFetch<AttentionQueue>("/admin/attention-queue", {
        query: { refresh: true },
      }),
    onSuccess: (queue) => {
      queryClient.setQueryData(adminDashboardKeys.attentionQueue, queue);
    },
  });
}

export function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: adminDashboardKeys.stats,
    queryFn: () => apiFetch<AdminStats>("/admin/stats"),
  });
}

/** `from`/`to` are REQUIRED by the endpoint (04 §12) — never optional here. */
export interface RejectionReasonsReportQuery {
  from: string;
  to: string;
  actor?: RejectionActor;
  roleCategoryId?: string;
}

export function useRejectionReasonsReport(query: RejectionReasonsReportQuery) {
  return useQuery<RejectionReasonsReport>({
    queryKey: adminDashboardKeys.rejectionReasonsReport(query),
    queryFn: () =>
      apiFetch<RejectionReasonsReport>("/reports/rejection-reasons", {
        query: {
          from: query.from,
          to: query.to,
          actor: query.actor,
          roleCategoryId: query.roleCategoryId,
        },
      }),
  });
}

/** Role categories for the report filter (admin taxonomy listing, 04 §5). */
export function useRoleCategories() {
  return useQuery<RoleCategory[]>({
    queryKey: adminDashboardKeys.roleCategories,
    queryFn: async () => {
      const { data } = await apiFetchCollection<RoleCategory>(
        "/role-categories",
        { query: { isActive: true } },
      );
      return data;
    },
    staleTime: 5 * 60_000,
  });
}
