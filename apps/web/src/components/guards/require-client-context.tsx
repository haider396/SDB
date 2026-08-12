/**
 * RequireClientContext — resolves clientId from /auth/me; renders a
 * "no access yet" state when the user has no active client membership
 * (05-FRONTEND.md §2.1).
 */
import { createContext, useContext, type ReactNode } from "react";
import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { useMe } from "@/lib/permissions";

const ClientContext = createContext<string | null>(null);

/** The signed-in user's clientId. Only valid inside RequireClientContext. */
export function useClientId(): string {
  const clientId = useContext(ClientContext);
  if (clientId === null) {
    throw new Error("useClientId must be used inside <RequireClientContext>");
  }
  return clientId;
}

export function RequireClientContext({ children }: { children: ReactNode }) {
  const { data: me, isLoading, error, refetch } = useMe();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-content p-8">
        <LoadingSkeleton variant="card" rows={3} label="Loading your workspace…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-content p-8">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (!me?.clientId) {
    return (
      <div className="mx-auto max-w-content p-8">
        <EmptyState
          icon={Building2}
          title="No client access yet"
          description="Your account is not linked to an active client workspace. If your company works with Staffing Done Better, ask your account manager to send you an invitation."
        />
      </div>
    );
  }

  return (
    <ClientContext.Provider value={me.clientId}>
      {children}
    </ClientContext.Provider>
  );
}
