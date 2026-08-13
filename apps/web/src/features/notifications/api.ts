/**
 * Data hooks for the admin notification log (docs/06-BACKEND.md §4.3:
 * "Admin UI exposes a notification log view with a manual resend action").
 *
 * Query keys:
 *   ["notifications", "list", filters, page] — one cursor page (Prev/Next)
 *
 * Resend re-queues the row and attempts an immediate dispatch; the returned
 * row reflects the outcome, so the list refetches after it settles.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
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
import type { CursorPage } from "@/lib/use-cursor-pagination";

export interface NotificationListFilters {
  status?: NotificationStatus;
  event?: NotificationEvent;
}

export const notificationKeys = {
  root: ["notifications"] as const,
  list: (filters: NotificationListFilters, page: CursorPage) =>
    ["notifications", "list", filters, page] as const,
};

/** One cursor page of the log; the caller owns the cursor stack (Prev/Next). */
export function useNotifications(
  filters: NotificationListFilters,
  page: CursorPage,
): UseQueryResult<Collection<NotificationLogRow>, Error> {
  return useQuery({
    queryKey: notificationKeys.list(filters, page),
    queryFn: () =>
      apiFetchCollection<NotificationLogRow>("/admin/notifications", {
        query: {
          status: filters.status,
          event: filters.event,
          limit: page.pageSize,
          cursor: page.cursor,
        },
      }),
    // Keep the previous page's rows on screen while the next one loads.
    placeholderData: keepPreviousData,
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
