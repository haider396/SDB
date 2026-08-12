/**
 * Error state per 05-FRONTEND.md §4.3: plain-language message, the requestId
 * in small mono text, and a Retry button.
 */
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";

export interface ErrorStateProps {
  /** Plain-language message. Falls back to a generic sentence. */
  message?: string;
  /** Pass the caught error to surface its requestId automatically. */
  error?: unknown;
  onRetry?: () => void;
}

export function ErrorState({ message, error, onRetry }: ErrorStateProps) {
  const apiError = error instanceof ApiError ? error : null;
  const text =
    message ??
    apiError?.message ??
    "Something went wrong while loading this. Please try again.";

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg bg-surface-raised px-6 py-16 text-center shadow-sm"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle">
        <AlertTriangle aria-hidden="true" className="h-6 w-6 text-danger-text" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-brand-navy-ink">
        Could not load this
      </h2>
      <p className="mt-1 max-w-md text-sm text-neutral-500">{text}</p>
      {apiError?.requestId ? (
        <p className="mt-2 font-mono text-xs text-neutral-400">
          Request ID: {apiError.requestId}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-6" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
