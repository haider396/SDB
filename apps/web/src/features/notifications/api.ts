/**
 * Data hooks for the admin notification log (docs/06-BACKEND.md §4.3:
 * "Admin UI exposes a notification log view with a manual resend action").
 *
 * Query keys:
 *   ["notifications", "list", filters] — cursor-paginated log (infinite)
 *
 * Resend re-queues the row and attempts an immediate dispatch; the returned
 * row reflects the outcome, so the list refetches after it settles.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import type {
  NotificationEvent,
  NotificationLogRow,
  NotificationStatus,
  ResendResponse,
} from "@sdb/contracts";
import {
  apiFetch,
  apiFetchCollection,
  type Collection,
} from "@/lib/api-client";

export interface NotificationListFilters {
  status?: NotificationStatus;
  event?: NotificationEvent;
}

export const notificationKeys = {
  root: ["notifications"] as const,
  list: (filters: NotificationListFilters) =>
    ["notifications", "list", filters] as const,
};

const PAGE_SIZE = 25;

export function useNotifications(
  filters: NotificationListFilters,
): UseInfiniteQueryResult<InfiniteData<Collection<NotificationLogRow>>, Error> {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(filters),
    queryFn: ({ pageParam }) =>
      apiFetchCollection<NotificationLogRow>("/admin/notifications", {
        query: {
          status: filters.status,
          event: filters.event,
          limit: PAGE_SIZE,
          cursor: pageParam,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  });
}

/** POST /admin/notifications/:id/resend — settings.manage only (04-adjacent). */
export function useResendNotification() {
  const queryClient = useQueryClient();
  return useMutation<ResendResponse, unknown, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<ResendResponse>(`/admin/notifications/${id}/resend`, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.root });
    },
  });
}
