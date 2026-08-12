/**
 * Data hooks for admin client management (docs/04-API.md §6, 01 §3 J2).
 *
 * Query keys:
 *   ["clients", "list", filters]   — cursor-paginated list (infinite)
 *   ["clients", "detail", id]      — one client
 *   ["clients", "members", id]     — members of one client
 *
 * Mutations invalidate the detail + list they touched; access/payment
 * changes also refresh members (grant-access creates the primary contact).
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  Client,
  ClientMember,
  ConfirmPaymentBody,
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

export interface ClientListFilters {
  status?: Client["status"];
  search?: string;
  hasPendingAccess?: boolean;
}

export const clientKeys = {
  root: ["clients"] as const,
  list: (filters: ClientListFilters) => ["clients", "list", filters] as const,
  detail: (id: string) => ["clients", "detail", id] as const,
  members: (id: string) => ["clients", "members", id] as const,
};

const PAGE_SIZE = 25;

export function useClients(
  filters: ClientListFilters,
): UseInfiniteQueryResult<InfiniteData<Collection<Client>>, Error> {
  return useInfiniteQuery({
    queryKey: clientKeys.list(filters),
    queryFn: ({ pageParam }) =>
      apiFetchCollection<Client>("/clients", {
        query: {
          status: filters.status,
          search: filters.search === "" ? undefined : filters.search,
          hasPendingAccess: filters.hasPendingAccess ? "true" : undefined,
          limit: PAGE_SIZE,
          cursor: pageParam,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
  });
}

export function useClient(id: string) {
  return useQuery<Client>({
    queryKey: clientKeys.detail(id),
    queryFn: () => apiFetch<Client>(`/clients/${id}`),
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
    void queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: ["clients", "list"] });
    if (options?.members === true) {
      void queryClient.invalidateQueries({ queryKey: clientKeys.members(id) });
    }
  };
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
