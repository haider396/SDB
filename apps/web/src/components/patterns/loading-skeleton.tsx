/**
 * Loading state per 05-FRONTEND.md §4.3: skeletons match the final layout's
 * shape and row count. Never a centred spinner on a full page.
 */
import { Skeleton } from "@/components/ui/skeleton";

export interface LoadingSkeletonProps {
  /** Row count matching the expected final layout. */
  rows?: number;
  /** "list" for table-like rows (40px), "card" for card blocks. */
  variant?: "list" | "card";
  label?: string;
}

export function LoadingSkeleton({
  rows = 5,
  variant = "list",
  label = "Loading…",
}: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="space-y-3"
    >
      {Array.from({ length: rows }, (_, index) =>
        variant === "list" ? (
          <div
            key={index}
            className="flex h-10 items-center gap-4 rounded-md bg-surface-raised px-4 shadow-xs"
          >
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ) : (
          <div
            key={index}
            className="space-y-3 rounded-lg bg-surface-raised p-6 shadow-sm"
          >
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ),
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}
