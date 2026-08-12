/**
 * Loading state matching the form's final layout (05 §4.3): progress pills,
 * a heading, and labelled field blocks — never a centred spinner.
 */
import { Skeleton } from "@/components/ui/skeleton";

export function IntakeFormSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading the intake form…"
      className="space-y-6"
    >
      <div className="flex items-center gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-6 w-24 rounded-full" />
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="space-y-5 rounded-lg bg-surface-raised p-6 shadow-sm">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-3">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-28" />
      </div>
      <span className="sr-only">Loading the intake form…</span>
    </div>
  );
}
