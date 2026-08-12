/**
 * Event log timeline (04 §7 GET /requisitions/:id/events): newest first,
 * relative times with the absolute instant on hover (title attribute),
 * actor role, and from → to for value changes.
 */
import { History } from "lucide-react";
import type { EntityEvent } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative, humanizeKey } from "@/lib/format";

const ACTOR_ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  client_admin: "Client admin",
  client_user: "Client user",
};

export function EventLogCard({
  events,
  isLoading,
  isError,
  error,
  onRetry,
}: {
  events: EntityEvent[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const ordered = [...(events ?? [])].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : -1,
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <History aria-hidden="true" className="h-4 w-4 text-neutral-500" />
        <CardTitle className="text-base">Event log</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSkeleton variant="list" rows={4} label="Loading events…" />
        ) : isError ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={History}
            title="No events yet"
            description="Every state change on this requisition is recorded here."
          />
        ) : (
          <ol className="space-y-3">
            {ordered.map((event) => (
              <li
                key={event.id}
                className="border-l-2 border-border-default pl-3"
              >
                <p className="text-sm font-medium text-brand-navy-ink">
                  {humanizeKey(event.eventType)}
                </p>
                {event.fromValue !== null || event.toValue !== null ? (
                  <p className="text-xs text-neutral-500">
                    {event.fromValue !== null
                      ? humanizeKey(event.fromValue)
                      : "—"}{" "}
                    <span aria-hidden="true">→</span>
                    <span className="sr-only">to</span>{" "}
                    {event.toValue !== null ? humanizeKey(event.toValue) : "—"}
                  </p>
                ) : null}
                <p className="text-xs text-neutral-500">
                  {event.actorRole !== null
                    ? `${ACTOR_ROLE_LABELS[event.actorRole] ?? event.actorRole} · `
                    : "System · "}
                  <time
                    dateTime={event.occurredAt}
                    title={formatDateTime(event.occurredAt)}
                  >
                    {formatRelative(event.occurredAt)}
                  </time>
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
