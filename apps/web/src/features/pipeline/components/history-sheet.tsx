/**
 * "View history" for a pipeline card (04 §9 GET /assignments/:id/events):
 * the assignment's full audit trail — stage moves, notes, decisions — in a
 * side sheet, fetched only while the sheet is open.
 */
import type { AdminAssignmentRow } from "@sdb/contracts";
import { History } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { EventLogTimeline } from "@/components/patterns/event-log-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAssignmentEvents } from "../api";

export interface HistorySheetProps {
  row: AdminAssignmentRow | null;
  onClose: () => void;
}

export function HistorySheet({ row, onClose }: HistorySheetProps) {
  const eventsQuery = useAssignmentEvents(row === null ? null : row.id);

  return (
    <Sheet
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Assignment history</SheetTitle>
          <SheetDescription>
            {row !== null
              ? `Every recorded event for ${row.candidate.displayName} on this requisition`
              : "Every recorded event for this assignment"}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {eventsQuery.isPending && row !== null ? (
            <LoadingSkeleton variant="list" rows={4} label="Loading history…" />
          ) : eventsQuery.isError ? (
            <ErrorState
              error={eventsQuery.error}
              onRetry={() => void eventsQuery.refetch()}
            />
          ) : (eventsQuery.data ?? []).length === 0 ? (
            <EmptyState
              icon={History}
              title="No events yet"
              description="Every state change on this assignment is recorded here."
            />
          ) : (
            <EventLogTimeline events={eventsQuery.data ?? []} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
