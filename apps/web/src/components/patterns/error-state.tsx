/**
 * Error state per 05-FRONTEND.md §4.3: plain-language message, the requestId
 * in small mono text, and a Retry button.
 *
 * Retry is not offered unconditionally. On 401/403/404/410 the request fails
 * identically however many times it is repeated — the row does not exist, or
 * the caller is not allowed to see it — so a Retry button on those statuses is
 * a control whose only possible outcome is another failure. Someone who lands
 * on a bad id used to get a page whose sole control was that button, with no
 * way back to the list they came from. Those statuses now get status-specific
 * wording and, when the caller supplies `backTo`, a link out to the parent
 * list instead.
 *
 * The way out is a real router <Link> (AC-UI-04): focusable in tab order and
 * activatable with Enter, unlike a click handler that calls navigate().
 */
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";

/** Where to send someone whose error cannot be retried away. */
export interface ErrorStateBackTo {
  /** Router path of the parent list, e.g. "/admin/candidates". */
  to: string;
  /** Destination name, e.g. "Candidates" — rendered as "Back to Candidates". */
  label: string;
}

export interface ErrorStateProps {
  /** Plain-language message. Falls back to a generic sentence. */
  message?: string;
  /** Pass the caught error to surface its requestId automatically. */
  error?: unknown;
  onRetry?: () => void;
  /**
   * Optional escape hatch back to the parent list. Optional on purpose: every
   * existing call site keeps working untouched without passing it.
   */
  backTo?: ErrorStateBackTo;
}

interface StatusCopy {
  title: string;
  text: string;
  /** False where repeating the request cannot change the outcome. */
  canRetry: boolean;
  /**
   * True where the copy must not be replaced by a caller or server message,
   * because that message could disclose something the viewer may not know.
   */
  isFixed?: boolean;
}

/**
 * 500/502/503 and a status-less network failure (ApiError sets status 0) are
 * transient, so they fall through to the retryable default. Anything not
 * listed here — including a plain Error with no status at all — does too.
 */
function copyForStatus(status: number | undefined): StatusCopy | null {
  switch (status) {
    case 401:
      return {
        title: "Your session has ended",
        text: "Sign in again to pick up where you left off.",
        canRetry: false,
      };
    case 403:
      return {
        title: "You do not have access",
        // Deliberately says nothing about the record — not its type, not its
        // name, not whether it exists. A 403 that describes what is behind it
        // confirms the record to someone who is not allowed to know.
        text: "You do not have access to this. If that looks wrong, ask an administrator to check your permissions.",
        canRetry: false,
        isFixed: true,
      };
    case 404:
      return {
        title: "Not found",
        text: "We could not find this. It may have been deleted, or the link may be out of date.",
        canRetry: false,
      };
    case 410:
      return {
        title: "No longer available",
        text: "This has been removed and is no longer available.",
        canRetry: false,
      };
    default:
      return null;
  }
}

export function ErrorState({
  message,
  error,
  onRetry,
  backTo,
}: ErrorStateProps) {
  const apiError = error instanceof ApiError ? error : null;
  const statusCopy = copyForStatus(apiError?.status);

  const title = statusCopy?.title ?? "Could not load this";
  const text = statusCopy?.isFixed
    ? statusCopy.text
    : (message ??
      statusCopy?.text ??
      apiError?.message ??
      "Something went wrong while loading this. Please try again.");

  const canRetry = statusCopy?.canRetry ?? true;
  const showRetry = onRetry !== undefined && canRetry;

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg bg-surface-raised px-6 py-16 text-center shadow-sm"
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle">
        <AlertTriangle aria-hidden="true" className="h-6 w-6 text-danger-text" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-brand-navy-ink">
        {title}
      </h2>
      <p className="mt-1 max-w-md text-sm text-neutral-500">{text}</p>
      {apiError?.requestId ? (
        <p className="mt-2 font-mono text-xs text-neutral-400">
          Request ID: {apiError.requestId}
        </p>
      ) : null}
      {showRetry || backTo ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {showRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          {backTo ? (
            <Button asChild variant="secondary">
              <Link to={backTo.to}>Back to {backTo.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
