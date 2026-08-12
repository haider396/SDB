/**
 * RequirePermission — renders a 403 page rather than redirecting, so the URL
 * stays inspectable (05-FRONTEND.md §2.1).
 */
import type { PermissionKey } from "@sdb/contracts";
import { ShieldX } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { can, useMe } from "@/lib/permissions";

export function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-content p-8">
      <EmptyState
        icon={ShieldX}
        title="403 — You do not have access to this page"
        description="Your account does not include the permission required here. If you believe you should have access, contact your administrator."
      />
    </div>
  );
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) {
  const { data: me, isLoading, error, refetch } = useMe();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-content p-8">
        <LoadingSkeleton variant="card" rows={3} label="Checking permissions…" />
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

  if (!can(me, permission)) {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
}
