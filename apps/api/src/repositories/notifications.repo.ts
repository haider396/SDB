/**
 * notification_log access for the P7 dispatcher, retry job, and admin log
 * view (docs/06-BACKEND.md §4.3). All SQL, no business logic.
 *
 * Attempt timing note: migration 0009 gives notification_log no
 * `last_attempt_at` column (forward-only, not editable), so each attempt's
 * instant is recorded inside the `provider_response` jsonb envelope —
 * `{ attemptedAt, httpStatus, body }` — which the retry job's backoff windows
 * read. The response body itself lives under `body` (06 §4.3).
 */
import type postgres from 'postgres';
import type { NotificationEvent, NotificationLogRow, NotificationStatus } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

function jsonb(sql: Queryable, value: unknown): postgres.Parameter {
  return sql.json(value as postgres.JSONValue);
}

interface NotificationLogDbRow {
  id: string;
  event: NotificationEvent;
  recipient_email: string;
  recipient_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
  provider: string;
  provider_response: unknown | null;
  status: NotificationStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

const COLUMNS: string[] = [
  'id',
  'event',
  'recipient_email',
  'recipient_user_id',
  'entity_type',
  'entity_id',
  'payload',
  'provider',
  'provider_response',
  'status',
  'attempts',
  'last_error',
  'created_at',
  'sent_at',
];

function toRow(row: NotificationLogDbRow): NotificationLogRow {
  return {
    id: row.id,
    event: row.event,
    recipientEmail: row.recipient_email,
    recipientUserId: row.recipient_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload,
    provider: row.provider,
    providerResponse: row.provider_response,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at === null ? null : row.sent_at.toISOString(),
  };
}

export async function findNotificationById(
  sql: Queryable,
  id: string,
): Promise<NotificationLogRow | null> {
  const rows = await sql<NotificationLogDbRow[]>`
    select ${sql(COLUMNS)} from notification_log
    where id = ${id}
  `;
  return rows[0] === undefined ? null : toRow(rows[0]);
}

/** Queued rows, oldest first, for the post-commit drain. */
export async function listQueuedNotifications(
  sql: Queryable,
  limit: number,
): Promise<NotificationLogRow[]> {
  const rows = await sql<NotificationLogDbRow[]>`
    select ${sql(COLUMNS)} from notification_log
    where status = 'queued'
    order by created_at asc, id asc
    limit ${limit}
  `;
  return rows.map(toRow);
}

/**
 * Failed rows still under the attempt cap (06 §4.3 "maximum 3 attempts").
 * Backoff-window eligibility is evaluated by the service, which owns the
 * clock; this returns every candidate.
 */
export async function listFailedRetryCandidates(
  sql: Queryable,
  maxAttempts: number,
  limit: number,
): Promise<NotificationLogRow[]> {
  const rows = await sql<NotificationLogDbRow[]>`
    select ${sql(COLUMNS)} from notification_log
    where status = 'failed' and attempts < ${maxAttempts}
    order by created_at asc, id asc
    limit ${limit}
  `;
  return rows.map(toRow);
}

export interface ListNotificationsFilters {
  status: NotificationStatus | null;
  event: NotificationEvent | null;
}

export interface NotificationsKeysetPosition {
  createdAt: string;
  id: string;
}

/**
 * Admin log view page, newest first, keyset on (created_at, id).
 * `total` is the full filtered count via `count(*) over ()` — accurate only
 * when no keyset position narrows the window (the service surfaces it on
 * first pages only, UX 2.9). 0 when the page is empty.
 */
export async function listNotificationsPage(
  sql: Queryable,
  filters: ListNotificationsFilters,
  limit: number,
  after: NotificationsKeysetPosition | null,
): Promise<{ data: NotificationLogRow[]; total: number }> {
  const rows = await sql<(NotificationLogDbRow & { total: string })[]>`
    select ${sql(COLUMNS)}, count(*) over ()::text as total from notification_log
    where true
      ${filters.status === null ? sql`` : sql`and status = ${filters.status}`}
      ${filters.event === null ? sql`` : sql`and event = ${filters.event}::notification_event`}
      ${
        after === null
          ? sql``
          : sql`and (created_at, id) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
      }
    order by created_at desc, id desc
    limit ${limit}
  `;
  return {
    data: rows.map(toRow),
    total: Number(rows[0]?.total ?? '0'),
  };
}

/**
 * Record a successful dispatch: status 'sent', the outbound body persisted
 * as the row's payload, the provider response envelope, and sent_at.
 */
export async function markNotificationSent(
  sql: Queryable,
  input: {
    id: string;
    payload: Record<string, unknown>;
    providerResponse: unknown;
    sentAt: string;
  },
): Promise<void> {
  await sql`
    update notification_log
    set status = 'sent',
        attempts = attempts + 1,
        last_error = null,
        payload = ${jsonb(sql, input.payload)},
        provider_response = ${jsonb(sql, input.providerResponse)},
        sent_at = ${input.sentAt}
    where id = ${input.id}
  `;
}

/**
 * Record a failed dispatch attempt: status 'failed', attempts incremented,
 * last_error captured (06 §4.3). `payload` is the outbound body that was
 * attempted (null when the failure precedes payload build).
 */
export async function markNotificationFailed(
  sql: Queryable,
  input: {
    id: string;
    payload: Record<string, unknown> | null;
    providerResponse: unknown;
    error: string;
  },
): Promise<void> {
  await sql`
    update notification_log
    set status = 'failed',
        attempts = attempts + 1,
        last_error = ${input.error},
        provider_response = ${jsonb(sql, input.providerResponse)},
        payload = coalesce(${
          input.payload === null ? null : jsonb(sql, input.payload)
        }, payload)
    where id = ${input.id}
  `;
}

/**
 * Manual resend (06 §4.3): back to 'queued' with the attempt counter and
 * error state reset so the row gets a fresh 3-attempt budget.
 */
export async function requeueNotification(
  sql: Queryable,
  id: string,
): Promise<NotificationLogRow | null> {
  const rows = await sql<NotificationLogDbRow[]>`
    update notification_log
    set status = 'queued',
        attempts = 0,
        last_error = null,
        provider_response = null,
        sent_at = null
    where id = ${id}
    returning ${sql(COLUMNS)}
  `;
  return rows[0] === undefined ? null : toRow(rows[0]);
}

// ---------------------------------------------------------------------------
// Dispatch-time payload enrichment (06 §4.1: every field a template might
// need). The enqueued context from P2–P6 carries what the enqueue site knew;
// the rest is resolved here from the row's entity reference.
// ---------------------------------------------------------------------------

export interface RequisitionNotificationContext {
  reference: string;
  advertisedTitle: string | null;
  clientName: string;
}

export async function getRequisitionContext(
  sql: Queryable,
  requisitionId: string,
): Promise<RequisitionNotificationContext | null> {
  const rows = await sql<
    { reference: string; advertised_title: string | null; company_name: string }[]
  >`
    select r.reference, r.advertised_title, c.company_name
    from requisitions r
    join clients c on c.id = r.client_id
    where r.id = ${requisitionId}
  `;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        reference: row.reference,
        advertisedTitle: row.advertised_title,
        clientName: row.company_name,
      };
}

export async function getAssignmentRequisitionContext(
  sql: Queryable,
  assignmentId: string,
): Promise<RequisitionNotificationContext | null> {
  const rows = await sql<
    { reference: string; advertised_title: string | null; company_name: string }[]
  >`
    select r.reference, r.advertised_title, c.company_name
    from assignments a
    join requisitions r on r.id = a.requisition_id
    join clients c on c.id = r.client_id
    where a.id = ${assignmentId}
  `;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        reference: row.reference,
        advertisedTitle: row.advertised_title,
        clientName: row.company_name,
      };
}

export async function getClientCompanyName(
  sql: Queryable,
  clientId: string,
): Promise<string | null> {
  const rows = await sql<{ company_name: string }[]>`
    select company_name from clients where id = ${clientId}
  `;
  return rows[0]?.company_name ?? null;
}

export async function getUserFullName(
  sql: Queryable,
  userId: string,
): Promise<string | null> {
  const rows = await sql<{ full_name: string }[]>`
    select full_name from users where id = ${userId}
  `;
  return rows[0]?.full_name ?? null;
}
