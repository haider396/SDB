/**
 * Presentation-only mappings for the P6 admin surfaces. Bucket keys, entity
 * types, and enum values stay owned by @sdb/contracts; this file decides
 * display order, wording, and where a queue item links.
 */
import type {
  AttentionQueueBucketKey,
  AttentionQueueItem,
  InterviewOutcome,
  RejectionActor,
} from "@sdb/contracts";

/**
 * Display order of the seven buckets, most urgent first. This deliberately
 * differs from the contract's wire order (ATTENTION_QUEUE_BUCKET_KEYS):
 * payment-confirmed-but-no-access is a paying client locked out, so it
 * outranks a principal approval that has merely gone quiet.
 */
export const BUCKET_DISPLAY_ORDER: readonly AttentionQueueBucketKey[] = [
  "new_intake_submissions",
  "payment_confirmed_access_not_granted",
  "awaiting_principal_approval",
  "no_candidates_presented",
  "awaiting_client_feedback",
  "interview_without_outcome",
  "incomplete_webhook_candidates",
];

/** Fallback titles — the API's bucket `label` wins when present. */
export const BUCKET_LABELS: Record<AttentionQueueBucketKey, string> = {
  new_intake_submissions: "New intake submissions",
  awaiting_principal_approval: "Awaiting principal approval",
  payment_confirmed_access_not_granted: "Payment confirmed, access not granted",
  no_candidates_presented: "No candidates presented",
  awaiting_client_feedback: "Awaiting client feedback",
  interview_without_outcome: "Interview without outcome",
  incomplete_webhook_candidates: "Incomplete webhook candidates",
};

/** One sentence shown when a bucket is empty ("all clear" row). */
export const BUCKET_ALL_CLEAR: Record<AttentionQueueBucketKey, string> = {
  new_intake_submissions: "No unreviewed intake submissions.",
  awaiting_principal_approval: "No approvals have been waiting too long.",
  payment_confirmed_access_not_granted:
    "Every paying client has portal access.",
  no_candidates_presented: "No placement has been sourcing too long.",
  awaiting_client_feedback: "No presented candidate is waiting on a client.",
  interview_without_outcome: "Every past interview has an outcome.",
  incomplete_webhook_candidates: "No webhook candidates need completing.",
};

/**
 * Where a queue item links — every item links directly to the object
 * (01 §6). Assignment and interview items carry the REQUISITION's reference
 * (not its id), so they land on the requisitions list pre-filtered to that
 * one reference; its pipeline tab is one click away.
 */
export function queueItemHref(
  item: Pick<
    AttentionQueueItem,
    "entityType" | "entityId" | "reference" | "requisitionPublicId"
  >,
): string {
  switch (item.entityType) {
    case "requisition":
      // Short public id when the API provides it; the UUID still works as a
      // route param (the API accepts both), it is just longer in the URL.
      return `/admin/requisitions/${item.requisitionPublicId ?? item.entityId}`;
    // TODO(api follow-up): queue items carry no client/candidate public id,
    // so these two links still show the UUID. Once the API adds a public-id
    // field for client/candidate items, switch to it here.
    case "client":
      return `/admin/clients/${item.entityId}`;
    case "candidate":
      return `/admin/candidates/${item.entityId}`;
    case "assignment":
    case "interview":
      return `/admin/requisitions?search=${encodeURIComponent(item.reference)}`;
  }
}

/**
 * Buckets whose membership is a full filtered list elsewhere in the admin —
 * the header's "View all N" links there. Buckets without an equivalent
 * filter (e.g. awaiting client feedback) have no entry.
 */
export const BUCKET_VIEW_ALL_HREF: Partial<
  Record<AttentionQueueBucketKey, string>
> = {
  new_intake_submissions: "/admin/requisitions?status=submitted",
  incomplete_webhook_candidates: "/admin/candidates?dataCompleteness=incomplete",
  // The clients list reads `pendingAccess` (see clients-list-page.tsx).
  payment_confirmed_access_not_granted: "/admin/clients?pendingAccess=true",
};

/**
 * Waiting-time thresholds per bucket, in days. NOT in the API payload —
 * these are the default trio from docs/01-PRODUCT-OVERVIEW.md §6 (principal
 * approval > 3 days, sourcing with nothing presented > 5 days, client
 * feedback > 3 days), hardcoded here until the API exposes the configured
 * values. Buckets without a documented threshold are omitted.
 */
export const BUCKET_THRESHOLD_DAYS: Partial<
  Record<AttentionQueueBucketKey, number>
> = {
  awaiting_principal_approval: 3,
  no_candidates_presented: 5,
  awaiting_client_feedback: 3,
};

export const OUTCOME_LABELS: Record<InterviewOutcome, string> = {
  pending: "Pending",
  passed: "Passed",
  failed: "Failed",
  no_show: "No-show",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

export const ACTOR_LABELS: Record<RejectionActor, string> = {
  admin: "Admin",
  client: "Client",
};
