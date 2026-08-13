/**
 * SQL for the admin needs-attention queue (docs/01-PRODUCT-OVERVIEW.md §6,
 * docs/04-API.md §12). No business logic — bucket assembly, labels, and the
 * cache live in services/attention-queue.service.ts.
 *
 * ADMIN SURFACE ONLY — these queries join `candidates` and expose internal
 * stages; nothing here may ever serve a client-scoped read.
 *
 * "Since" semantics per bucket:
 * - status buckets use the moment the requisition ENTERED the status: the
 *   latest `status_changed` event with that to_value (the app emits one and
 *   the DB trigger backstops it), falling back to a status-specific column
 *   (`submitted_at`, `sourcing_started_at`) or `created_at`
 * - assignment/interview/candidate/client buckets use their natural
 *   timestamp columns (`presented_at`, `scheduled_at`,
 *   `payment_confirmed_at`, `created_at`)
 *
 * Thresholds ("> N days") are read from app_settings AT QUERY TIME by the
 * service and passed in as day counts; the comparison is
 * `since < now() - make_interval(days => N)` — strictly older than N days.
 */
import type { Queryable } from '../lib/db.js';

export interface QueueItemRecord {
  entityId: string;
  /**
   * Deep-link context (UX 1.7): the owning requisition's id, populated by
   * the assignment- and interview-shaped buckets only.
   */
  requisitionId?: string;
  /**
   * Short-URL companion (0015): the involved requisition's public_id —
   * populated by every requisition-linked bucket (requisition-shaped ones
   * included, where entityId is the requisition's uuid). requisitionId stays
   * a uuid for compatibility.
   */
  requisitionPublicId?: string;
  reference: string;
  label: string;
  since: string;
}

export interface QueueBucketRecord {
  count: number;
  items: QueueItemRecord[];
}

/** Items per bucket cap — `count` stays exact via a window function. */
const ITEM_CAP = 50;

interface BucketRow {
  entity_id: string;
  requisition_id?: string | null;
  requisition_public_id?: string | null;
  reference: string;
  label: string;
  since: Date;
  total: string;
}

function mapBucket(rows: BucketRow[]): QueueBucketRecord {
  return {
    count: Number(rows[0]?.total ?? '0'),
    items: rows.map((row) => ({
      entityId: row.entity_id,
      ...(row.requisition_id !== undefined && row.requisition_id !== null
        ? { requisitionId: row.requisition_id }
        : {}),
      ...(row.requisition_public_id !== undefined &&
      row.requisition_public_id !== null
        ? { requisitionPublicId: row.requisition_public_id }
        : {}),
      reference: row.reference,
      label: row.label,
      since: row.since.toISOString(),
    })),
  };
}

/** 01 §6 row 1: `requisition.status = submitted`. No threshold. */
export async function queueNewIntakeSubmissions(
  sql: Queryable,
): Promise<QueueBucketRecord> {
  const rows = await sql<BucketRow[]>`
    select r.id as entity_id, r.public_id as requisition_public_id, r.reference,
           r.reference || coalesce(' — ' || r.advertised_title, '') as label,
           r.submitted_at as since,
           count(*) over ()::text as total
    from requisitions r
    where r.status = 'submitted'
    order by r.submitted_at asc, r.id asc
    limit ${ITEM_CAP}
  `;
  return mapBucket(rows);
}

/** 01 §6 row 2: `status = pending_principal_approval` for > N days. */
export async function queueAwaitingPrincipalApproval(
  sql: Queryable,
  thresholdDays: number,
): Promise<QueueBucketRecord> {
  const rows = await sql<BucketRow[]>`
    select r.id as entity_id, r.public_id as requisition_public_id, r.reference,
           r.reference || coalesce(' — ' || r.advertised_title, '') as label,
           entered.since as since,
           count(*) over ()::text as total
    from requisitions r
    cross join lateral (
      select coalesce(
        (select max(e.occurred_at) from events e
         where e.entity_type = 'requisition'
           and e.entity_id = r.id
           and e.event_type = 'status_changed'
           and e.to_value = 'pending_principal_approval'),
        r.created_at
      ) as since
    ) entered
    where r.status = 'pending_principal_approval'
      and entered.since < now() - make_interval(days => ${thresholdDays})
    order by entered.since asc, r.id asc
    limit ${ITEM_CAP}
  `;
  return mapBucket(rows);
}

/** 01 §6 row 3: payment confirmed, portal access not granted. No threshold. */
export async function queuePaymentConfirmedAccessNotGranted(
  sql: Queryable,
): Promise<QueueBucketRecord> {
  const rows = await sql<BucketRow[]>`
    select c.id as entity_id, c.company_name as reference,
           c.company_name as label,
           c.payment_confirmed_at as since,
           count(*) over ()::text as total
    from clients c
    where c.payment_confirmed_at is not null
      and c.portal_access_enabled_at is null
      and c.archived_at is null
    order by c.payment_confirmed_at asc, c.id asc
    limit ${ITEM_CAP}
  `;
  return mapBucket(rows);
}

/** 01 §6 row 4: `status = sourcing` for > N days with nothing presented. */
export async function queueNoCandidatesPresented(
  sql: Queryable,
  thresholdDays: number,
): Promise<QueueBucketRecord> {
  const rows = await sql<BucketRow[]>`
    select r.id as entity_id, r.public_id as requisition_public_id, r.reference,
           r.reference || coalesce(' — ' || r.advertised_title, '') as label,
           coalesce(r.sourcing_started_at, r.created_at) as since,
           count(*) over ()::text as total
    from requisitions r
    where r.status = 'sourcing'
      and coalesce(r.sourcing_started_at, r.created_at)
            < now() - make_interval(days => ${thresholdDays})
    order by coalesce(r.sourcing_started_at, r.created_at) asc, r.id asc
    limit ${ITEM_CAP}
  `;
  return mapBucket(rows);
}

/** 01 §6 row 5: assignment at `presented` for > N days. */
export async function queueAwaitingClientFeedback(
  sql: Queryable,
  thresholdDays: number,
): Promise<QueueBucketRecord> {
  const rows = await sql<BucketRow[]>`
    select a.id as entity_id, r.id as requisition_id,
           r.public_id as requisition_public_id, r.reference,
           c.display_name || ' — ' || r.reference as label,
           a.presented_at as since,
           count(*) over ()::text as total
    from assignments a
    join requisitions r on r.id = a.requisition_id
    join candidates c on c.id = a.candidate_id
    where a.stage = 'presented'
      and a.presented_at is not null
      and a.presented_at < now() - make_interval(days => ${thresholdDays})
    order by a.presented_at asc, a.id asc
    limit ${ITEM_CAP}
  `;
  return mapBucket(rows);
}

/** 01 §6 row 6: `scheduled_at < now()` and outcome still pending. */
export async function queueInterviewWithoutOutcome(
  sql: Queryable,
): Promise<QueueBucketRecord> {
  const rows = await sql<BucketRow[]>`
    select i.id as entity_id, r.id as requisition_id,
           r.public_id as requisition_public_id, r.reference,
           c.display_name || ' — round ' || i.round_number || ' — ' || r.reference as label,
           i.scheduled_at as since,
           count(*) over ()::text as total
    from interviews i
    join assignments a on a.id = i.assignment_id
    join requisitions r on r.id = a.requisition_id
    join candidates c on c.id = a.candidate_id
    where i.outcome = 'pending'
      and i.scheduled_at is not null
      and i.scheduled_at < now()
    order by i.scheduled_at asc, i.id asc
    limit ${ITEM_CAP}
  `;
  return mapBucket(rows);
}

/** 01 §6 row 7: `candidates.data_completeness = 'incomplete'`. */
export async function queueIncompleteWebhookCandidates(
  sql: Queryable,
): Promise<QueueBucketRecord> {
  const rows = await sql<BucketRow[]>`
    select c.id as entity_id, c.reference,
           c.display_name || ' — ' || c.reference as label,
           c.created_at as since,
           count(*) over ()::text as total
    from candidates c
    where c.data_completeness = 'incomplete'
      and c.archived_at is null
    order by c.created_at asc, c.id asc
    limit ${ITEM_CAP}
  `;
  return mapBucket(rows);
}

// ---------------------------------------------------------------------------
// Thresholds (app_settings, read at query time — 01 §6)
// ---------------------------------------------------------------------------

export interface QueueThresholds {
  principalApprovalDays: number;
  noCandidatesDays: number;
  awaitingClientDays: number;
}

const THRESHOLD_DEFAULTS: QueueThresholds = {
  principalApprovalDays: 3,
  noCandidatesDays: 5,
  awaitingClientDays: 3,
};

/** Seeded by migration 0011; defaults cover a missing or non-numeric row. */
export async function getQueueThresholds(
  sql: Queryable,
): Promise<QueueThresholds> {
  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value
    from app_settings
    where key in ('queue.principal_approval_days',
                  'queue.no_candidates_days',
                  'queue.awaiting_client_days')
  `;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const days = (key: string, fallback: number): number => {
    const value = byKey.get(key);
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    principalApprovalDays: days(
      'queue.principal_approval_days',
      THRESHOLD_DEFAULTS.principalApprovalDays,
    ),
    noCandidatesDays: days(
      'queue.no_candidates_days',
      THRESHOLD_DEFAULTS.noCandidatesDays,
    ),
    awaitingClientDays: days(
      'queue.awaiting_client_days',
      THRESHOLD_DEFAULTS.awaitingClientDays,
    ),
  };
}
