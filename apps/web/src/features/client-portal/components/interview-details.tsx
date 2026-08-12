/**
 * Interview details on an unlocked candidate card (01 §3 J7). Scheduled
 * times render in the VIEWER's timezone with an explicit zone label
 * (NFR-11); the interview's own recorded timezone is shown alongside when
 * it differs, so nobody shows up an ocean early.
 */
import { CalendarClock, ExternalLink, Users } from "lucide-react";
import type { Interview } from "@sdb/contracts";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { ApiError } from "@/lib/api-client";
import { formatInViewerTimezone, viewerTimezone } from "../labels";

export function InterviewDetails({
  interviews,
  isLoading,
  isError,
  error,
}: {
  interviews: Interview[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}) {
  if (isLoading) {
    return (
      <LoadingSkeleton variant="list" rows={1} label="Loading interview details…" />
    );
  }
  if (isError) {
    return (
      <p role="alert" className="text-xs text-danger-text">
        {error instanceof ApiError
          ? error.message
          : "Could not load the interview details."}
      </p>
    );
  }
  const scheduled = (interviews ?? []).filter(
    (interview) =>
      interview.scheduledAt !== null && interview.outcome !== "cancelled",
  );
  if (scheduled.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Interview details are being finalised — we will notify you.
      </p>
    );
  }

  return (
    <ul aria-label="Interviews" className="space-y-2.5">
      {scheduled.map((interview) => (
        <li
          key={interview.id}
          className="rounded-md bg-surface-subtle px-3 py-2.5 text-sm"
        >
          <p className="flex items-center gap-1.5 font-medium text-brand-navy-ink">
            <CalendarClock
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-neutral-500"
            />
            Round {interview.roundNumber}
            {interview.scheduledAt !== null ? (
              <time dateTime={interview.scheduledAt}>
                — {formatInViewerTimezone(interview.scheduledAt)}
              </time>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            Shown in your timezone ({viewerTimezone()})
            {interview.timezone !== null && interview.timezone !== viewerTimezone()
              ? ` · scheduled in ${interview.timezone}`
              : ""}
            {interview.durationMinutes !== null
              ? ` · ${interview.durationMinutes} min`
              : ""}
          </p>
          {interview.interviewerNames !== null ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-600">
              <Users aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {interview.interviewerNames}
            </p>
          ) : null}
          {interview.meetingUrl !== null ? (
            <p className="mt-1">
              <a
                href={interview.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
              >
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                Join meeting
              </a>
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
