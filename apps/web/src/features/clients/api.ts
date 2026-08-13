/**
 * Data hooks for admin client management (docs/04-API.md §6, 01 §3 J2).
 *
 * Query keys:
 *   ["clients", "list", filters, page] — one cursor page (Prev/Next)
 *   ["clients", "detail", id]      — one client
 *   ["clients", "members", id]     — members of one client
 *
 * Mutations invalidate the detail + list they touched; access/payment
 * changes also refresh members (grant-access creates the primary contact).
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  Client,
  ClientMember,
  ConfirmPaymentBody,
  CreateClientBody,
  EntityEvent,
  GrantAccessBody,
  InviteMemberBody,
  RevokeAccessResponse,
  UpdateClientBody,
  UpdateMemberBody,
} from "@sdb/contracts";
import {
  apiFetch,
  apiFetchCollection,
  apiFetchEnvelope,
  type Collection,
} from "@/lib/api-client";
import type { CursorPage } from "@/lib/use-cursor-pagination";

export interface ClientListFilters {
  status?: Client["status"];
  search?: string;
  hasPendingAccess?: boolean;
}

export const clientKeys = {
  root: ["clients"] as const,
  list: (filters: ClientListFilters, page: CursorPage) =>
    ["clients", "list", filters, page] as const,
  detail: (id: string) => ["clients", "detail", id] as const,
  events: (id: string) => ["clients", "events", id] as const,
  members: (id: string) => ["clients", "members", id] as const,
};

/** One cursor page of the list; the caller owns the cursor stack (Prev/Next). */
export function useClients(
  filters: ClientListFilters,
  page: CursorPage,
): UseQueryResult<Collection<Client>, Error> {
  return useQuery({
    queryKey: clientKeys.list(filters, page),
    queryFn: () =>
      apiFetchCollection<Client>("/clients", {
        query: {
          status: filters.status,
          search: filters.search === "" ? undefined : filters.search,
          hasPendingAccess: filters.hasPendingAccess ? "true" : undefined,
          limit: page.pageSize,
          cursor: page.cursor,
        },
      }),
    // Keep the previous page's rows on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}

export function useClient(id: string) {
  return useQuery<Client>({
    queryKey: clientKeys.detail(id),
    queryFn: () => apiFetch<Client>(`/clients/${id}`),
  });
}

/**
 * Audit trail for one client via the global event log
 * (04 §12 GET /events?entityType=client&entityId=…, 06 §7).
 */
/**
 * `id` must be the client's UUID (the `/events` filter validates `entityId`
 * as a uuid — it does NOT resolve public ids, unlike the single-entity
 * routes). Pass the loaded detail's `id`, never the route param, and leave
 * it undefined until the detail has loaded.
 */
export function useClientEvents(id: string | undefined) {
  return useQuery<EntityEvent[]>({
    queryKey: clientKeys.events(id ?? ""),
    enabled: id !== undefined,
    queryFn: async () => {
      const { data } = await apiFetchCollection<EntityEvent>("/events", {
        query: { entityType: "client", entityId: id, limit: 50 },
      });
      return data;
    },
  });
}

export function useClientMembers(id: string) {
  return useQuery<ClientMember[]>({
    queryKey: clientKeys.members(id),
    queryFn: async () => {
      const { data } = await apiFetchCollection<ClientMember>(
        `/clients/${id}/members`,
      );
      return data;
    },
  });
}

function useInvalidateClient() {
  const queryClient = useQueryClient();
  return (id: string, options?: { members?: boolean }) => {
    // Mutations pass the client's UUID, but the detail page keys its query
    // by the route param — which may be the short public id — so invalidate
    // the detail ROOT rather than miss one of the two forms.
    void queryClient.invalidateQueries({
      queryKey: [...clientKeys.root, "detail"],
    });
    void queryClient.invalidateQueries({ queryKey: ["clients", "list"] });
    if (options?.members === true) {
      void queryClient.invalidateQueries({ queryKey: clientKeys.members(id) });
    }
  };
}

/** POST /clients — manual creation outside the intake funnel (04 §6). */
export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation<Client, unknown, CreateClientBody>({
    mutationFn: (body) => apiFetch<Client>("/clients", { method: "POST", body }),
    onSuccess: (created) => {
      // The new-client dialog navigates to the publicId URL, so seed the
      // cache under the key that page will read (detail pages key by the
      // route param).
      queryClient.setQueryData(clientKeys.detail(created.publicId), created);
      void queryClient.invalidateQueries({ queryKey: ["clients", "list"] });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateClient();
  return useMutation<Client, unknown, { id: string; body: UpdateClientBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch<Client>(`/clients/${id}`, { method: "PATCH", body }),
    onSuccess: (updated, { id }) => {
      queryClient.setQueryData(clientKeys.detail(id), updated);
      invalidate(id);
    },
  });
}

export function useConfirmPayment() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateClient();
  return useMutation<Client, unknown, { id: string; body: ConfirmPaymentBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch<Client>(`/clients/${id}/confirm-payment`, {
        method: "POST",
        body,
      }),
    onSuccess: (updated, { id }) => {
      queryClient.setQueryData(clientKeys.detail(id), updated);
      invalidate(id);
    },
  });
}

export function useGrantAccess() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateClient();
  return useMutation<Client, unknown, { id: string; body: GrantAccessBody }>({
    mutationFn: ({ id, body }) =>
      apiFetch<Client>(`/clients/${id}/grant-access`, {
        method: "POST",
        body,
      }),
    onSuccess: (updated, { id }) => {
      queryClient.setQueryData(clientKeys.detail(id), updated);
      invalidate(id, { members: true });
    },
  });
}

export function useRevokeAccess() {
  const invalidate = useInvalidateClient();
  return useMutation<RevokeAccessResponse, unknown, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch<RevokeAccessResponse>(`/clients/${id}/revoke-access`, {
        method: "POST",
      }),
    onSuccess: (_data, { id }) => {
      invalidate(id, { members: true });
    },
  });
}

export function useInviteMember() {
  const invalidate = useInvalidateClient();
  return useMutation<
    ClientMember,
    unknown,
    { clientId: string; body: InviteMemberBody }
  >({
    mutationFn: ({ clientId, body }) =>
      apiFetch<ClientMember>(`/clients/${clientId}/members/invite`, {
        method: "POST",
        body,
      }),
    onSuccess: (_member, { clientId }) => {
      invalidate(clientId, { members: true });
    },
  });
}

export function useUpdateMember() {
  const invalidate = useInvalidateClient();
  return useMutation<
    ClientMember,
    unknown,
    { clientId: string; userId: string; body: UpdateMemberBody }
  >({
    mutationFn: ({ clientId, userId, body }) =>
      apiFetch<ClientMember>(`/clients/${clientId}/members/${userId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: (_member, { clientId }) => {
      invalidate(clientId, { members: true });
    },
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidateClient();
  return useMutation<void, unknown, { clientId: string; userId: string }>({
    // 204 No Content — apiFetchEnvelope, since there is no { data } to unwrap.
    mutationFn: async ({ clientId, userId }) => {
      await apiFetchEnvelope<undefined>(
        `/clients/${clientId}/members/${userId}`,
        { method: "DELETE" },
      );
    },
    onSuccess: (_data, { clientId }) => {
      invalidate(clientId, { members: true });
    },
  });
}
