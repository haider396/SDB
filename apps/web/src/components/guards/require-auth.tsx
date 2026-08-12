/**
 * RequireAuth — redirects to /login when unauthenticated (05-FRONTEND.md §2.1).
 */
import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { useSession } from "@/lib/auth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-content p-8">
        <LoadingSkeleton variant="card" rows={3} label="Checking your session…" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
