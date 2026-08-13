/**
 * Requisitions belonging to this client, linking through to the requisition
 * workspace. Reuses the requisitions list hook scoped by clientId.
 */
import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { RequisitionStatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import {
  DEFAULT_PAGE_SIZE,
  hasNextPage,
  useCursorStack,
} from "@/lib/use-cursor-pagination";
import { useRequisitions } from "@/features/requisitions/api";

export function ClientRequisitionsCard({ clientId }: { clientId: string }) {
  const pager = useCursorStack(clientId);
  const query = useRequisitions(
    { clientId },
    { pageSize: DEFAULT_PAGE_SIZE, cursor: pager.cursor },
  );
  const requisitions = query.data?.data ?? [];
  const hasNext = hasNextPage(query.data);

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
            {pager.canPrev || hasNext ? (
              <div className="mt-3 flex items-center justify-between">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Previous page"
                  disabled={!pager.canPrev || query.isFetching}
                  onClick={pager.goPrev}
                >
                  <ChevronLeft aria-hidden="true" />
                  Prev
                </Button>
                <span className="text-xs tabular-nums text-neutral-500">
                  Page {pager.page}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Next page"
                  disabled={!hasNext || query.isFetching}
                  onClick={() => {
                    const next = query.data?.meta.nextCursor;
                    if (next != null) pager.goNext(next);
                  }}
                >
                  Next
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
