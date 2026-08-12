/**
 * /admin — the needs-attention queue, the admin LANDING page
 * (01 §6: "a queue, not a dashboard"). Seven buckets, most urgent first
 * (BUCKET_DISPLAY_ORDER), every item a direct link to its object, oldest
 * first within a bucket. Empty buckets collapse to a slim all-clear row;
 * when all seven are empty the whole page celebrates instead.
 */
import { CheckCircle2, PartyPopper, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { AttentionQueueBucket } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAttentionQueue, useRefreshAttentionQueue } from "./api";
import {
  BUCKET_ALL_CLEAR,
  BUCKET_DISPLAY_ORDER,
  BUCKET_LABELS,
  queueItemHref,
} from "./labels";

function BucketCard({ bucket }: { bucket: AttentionQueueBucket }) {
  const title = bucket.label || BUCKET_LABELS[bucket.key];

  if (bucket.count === 0) {
    return (
      <section
        aria-label={title}
        className="flex items-center gap-3 rounded-lg bg-surface-raised px-4 py-2.5 shadow-xs"
      >
        <CheckCircle2
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-success-text"
        />
        <h2 className="text-sm font-medium text-neutral-600">{title}</h2>
        <p className="ml-auto text-xs text-neutral-500">
          {BUCKET_ALL_CLEAR[bucket.key]}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label={title}
      className="rounded-lg bg-surface-raised shadow-sm"
    >
      <header className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <h2 className="text-lg font-semibold tracking-tight text-brand-navy-ink">
          {title}
        </h2>
        <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-brand-blue-subtle px-2 py-0.5 text-xs font-semibold tabular-nums text-brand-blue">
          {bucket.count}
          <span className="sr-only">
            {" "}
            item{bucket.count === 1 ? "" : "s"}
          </span>
        </span>
        {bucket.count > bucket.items.length ? (
          <span className="ml-auto text-xs text-neutral-500">
            Showing the oldest {bucket.items.length}
          </span>
        ) : null}
      </header>
      <ul className="divide-y divide-neutral-100">
        {bucket.items.map((item) => (
          <li key={`${item.entityType}-${item.entityId}`}>
            <Link
              to={queueItemHref(item)}
              className="flex items-baseline gap-3 px-4 py-2.5 text-sm hover:bg-surface-subtle focus-visible:bg-surface-subtle"
            >
              <span className="shrink-0 font-mono text-xs text-neutral-500">
                {item.reference}
              </span>
              <span className="min-w-0 flex-1 truncate text-brand-navy-ink">
                {item.label}
              </span>
              <time
                dateTime={item.since}
                title={formatDateTime(item.since)}
                className="shrink-0 whitespace-nowrap text-xs tabular-nums text-neutral-500"
              >
                {formatRelative(item.since)}
              </time>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AttentionQueuePage() {
  const query = useAttentionQueue();
  const refresh = useRefreshAttentionQueue();

  const onRefresh = () => {
    refresh.mutate(undefined, {
      onError: (error) => {
        toast.error(
          error instanceof ApiError
            ? error.message
            : "Could not refresh the queue. Please try again.",
        );
      },
    });
  };

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Attention queue" }]}
      title="Attention queue"
      subtitle={
        query.data !== undefined
          ? `Everything that needs an admin decision, oldest first · computed ${formatRelative(query.data.computedAt)}`
          : "Everything that needs an admin decision, oldest first"
      }
      actions={
        <Button
          variant="secondary"
          onClick={onRefresh}
          disabled={refresh.isPending}
        >
          <RefreshCw
            aria-hidden="true"
            className={refresh.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"}
          />
          {refresh.isPending ? "Refreshing…" : "Refresh"}
        </Button>
      }
    />
  );

  if (query.isPending) {
    return (
      <div>
        {header}
        <LoadingSkeleton variant="card" rows={7} label="Loading the queue…" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const bucketsByKey = new Map(
    query.data.buckets.map((bucket) => [bucket.key, bucket]),
  );
  const ordered = BUCKET_DISPLAY_ORDER.flatMap((key) => {
    const bucket = bucketsByKey.get(key);
    return bucket === undefined ? [] : [bucket];
  });
  const isAllClear = ordered.every((bucket) => bucket.count === 0);

  return (
    <div>
      {header}
      {isAllClear ? (
        <EmptyState
          icon={PartyPopper}
          title="Nothing needs attention"
          description="Every intake is reviewed, every client has access, and no candidate or interview is waiting on you. Nice work — check back after the next refresh."
        />
      ) : (
        <div className="space-y-4">
          {ordered.map((bucket) => (
            <BucketCard key={bucket.key} bucket={bucket} />
          ))}
        </div>
      )}
    </div>
  );
}
