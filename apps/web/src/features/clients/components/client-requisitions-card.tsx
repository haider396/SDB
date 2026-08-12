/**
 * Requisitions belonging to this client, linking through to the requisition
 * workspace. Reuses the requisitions list hook scoped by clientId.
 */
import { ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { RequisitionStatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { useRequisitions } from "@/features/requisitions/api";

export function ClientRequisitionsCard({ clientId }: { clientId: string }) {
  const query = useRequisitions({ clientId });
  const requisitions = (query.data?.pages ?? []).flatMap((page) => page.data);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requisitions</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <LoadingSkeleton
            variant="list"
            rows={3}
            label="Loading requisitions…"
          />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : requisitions.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No requisitions"
            description="Roles this client asks to fill appear here once an intake form is submitted for them."
          />
        ) : (
          <>
            <ul className="divide-y divide-border-default">
              {requisitions.map((requisition) => (
                <li key={requisition.id}>
                  <Link
                    to={`/admin/requisitions/${requisition.id}`}
                    className="flex h-10 items-center justify-between gap-4 rounded-sm px-1 text-sm transition-colors duration-fast hover:bg-surface-subtle"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="font-mono text-xs text-neutral-500">
                        {requisition.reference}
                      </span>
                      <span className="truncate font-medium text-brand-navy-ink">
                        {requisition.advertisedTitle ?? "Untitled role"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <RequisitionStatusBadge status={requisition.status} />
                      <span className="text-xs tabular-nums text-neutral-500">
                        {formatDate(requisition.submittedAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {query.hasNextPage ? (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
