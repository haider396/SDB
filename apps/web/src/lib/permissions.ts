/**
 * Permission resolution from GET /api/v1/auth/me (docs/04-API.md §2),
 * cached via TanStack Query for the lifetime of the session.
 */
import type { AuthMeResponse, PermissionKey } from "@sdb/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth";

export const ME_QUERY_KEY = ["auth", "me"] as const;

export function fetchMe(): Promise<AuthMeResponse> {
  return apiFetch<AuthMeResponse>("/auth/me");
}

/** Cached /auth/me. Only runs while a session exists. */
export function useMe(): UseQueryResult<AuthMeResponse, Error> {
  const { session } = useSession();
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    enabled: session !== null,
    staleTime: 5 * 60_000,
  });
}

export function can(
  me: AuthMeResponse | undefined,
  permissionKey: PermissionKey,
): boolean {
  return me?.permissions.includes(permissionKey) ?? false;
}

/** `can(permissionKey)` as a hook, backed by the cached /auth/me query. */
export function useCan(permissionKey: PermissionKey): {
  allowed: boolean;
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useMe();
  return {
    allowed: can(data, permissionKey),
    isLoading,
    error: error ?? null,
  };
}

/** Where a signed-in user lands, by role (docs/02-DATABASE.md role keys). */
export function homePathFor(me: AuthMeResponse): string {
  const isInternal = me.roles.some(
    (role) => role === "super_admin" || role === "admin",
  );
  return isInternal ? "/admin" : "/client";
}
