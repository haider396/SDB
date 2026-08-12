/**
 * SQL for admin stats, the rejection-reasons report, and the global event
 * log (docs/04-API.md §12). No business logic — shaping and dedupe live in
 * services/reporting.service.ts.
 *
 * ADMIN SURFACE ONLY (event.view / requisition.view via an unscoped caller);
 * nothing here is tenant-filtered because nothing here may serve a
 * client-scoped read.
 */
import type { RejectionActor } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';
import type { EventRecord } from './requisitions.repo.js';

// ---------------------------------------------------------------------------
// Admin stats (04 §12 GET /admin/stats)
// ---------------------------------------------------------------------------

const TERMINAL_REQUISITION_STATUSES = ['placed', 'closed_unfilled'];

export async function countOpenRequisitions(sql: Queryable): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n
    from requisitions
    where status not in ${sql(TERMINAL_REQUISITION_STATUSES)}
  `;
  return Number(rows[0]?.n ?? '0');
}

/** Assignment counts by stage across active (non-terminal) requisitions. */
export async function getCandidatesByStage(
  sql: Queryable,
): Promise<Record<string, number>> {
  const rows = await sql<{ stage: string; count: string }[]>`
    select a.stage::text as stage, count(*)::text as count
    from assignments a
    join requisitions r on r.id = a.requisition_id
    where r.status not in ${sql(TERMINAL_REQUISITION_STATUSES)}
    group by a.stage
  `;
  return Object.fromEntries(rows.map((row) => [row.stage, Number(row.count)]));
}

/**
 * Mean of (presented_at − assignment created_at) in days over assignments
 * presented in the last 90 days; null when none were.
 */
export async function getAverageDaysToPresent(
  sql: Queryable,
): Promise<number | null> {
  const rows = await sql<{ avg_days: string | null }[]>`
    select avg(extract(epoch from (presented_at - created_at)) / 86400)::text
             as avg_days
    from assignments
    where presented_at is not null
      and presented_at >= now() - interval '90 days'
  `;
  const raw = rows[0]?.avg_days ?? null;
  if (raw === null) return null;
  const value = Number(raw);
  // Round to 2 dp for display; clamp float noise below zero.
  return Math.max(0, Math.round(value * 100) / 100);
}

export async function countActivePlacements(sql: Queryable): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n
    from placements
    where status = 'active'
  `;
  return Number(rows[0]?.n ?? '0');
}

// ---------------------------------------------------------------------------
// Rejection-reasons report (04 §12, AC-PL-15)
// ---------------------------------------------------------------------------

export interface RejectionReportFilters {
  from: string;
  to: string;
  actor: RejectionActor | null;
  roleCategoryId: string | null;
}

export interface RejectionReportGroupRecord {
  actor: RejectionActor;
  reasonId: string | null;
  reasonKey: string | null;
  label: string | null;
  count: number;
  otherTexts: string[];
}

/**
 * Grouped rejection counts: one row per (actor, reason), plus per actor one
 * reason-null row aggregating free-text (`reason_other`) rejections with
 * their texts. Window: `created_at` in [from, to] inclusive. The role
 * category filter joins rejections → assignments → requisitions.
 */
export async function getRejectionReasonGroups(
  sql: Queryable,
  filters: RejectionReportFilters,
): Promise<RejectionReportGroupRecord[]> {
  const rows = await sql<
    {
      actor: RejectionActor;
      reason_id: string | null;
      reason_key: string | null;
      label: string | null;
      count: string;
      other_texts: string[] | null;
    }[]
  >`
    select rj.actor, rj.reason_id, rr.key as reason_key, rr.label,
           count(*)::text as count,
           array_agg(rj.reason_other order by rj.created_at)
             filter (where rj.reason_id is null and rj.reason_other is not null)
             as other_texts
    from rejections rj
    left join rejection_reasons rr on rr.id = rj.reason_id
    join assignments a on a.id = rj.assignment_id
    join requisitions r on r.id = a.requisition_id
    where rj.created_at >= ${filters.from}
      and rj.created_at <= ${filters.to}
      ${filters.actor === null ? sql`` : sql`and rj.actor = ${filters.actor}`}
      ${
        filters.roleCategoryId === null
          ? sql``
          : sql`and r.role_category_id = ${filters.roleCategoryId}`
      }
    group by rj.actor, rj.reason_id, rr.key, rr.label
    order by rj.actor asc, count(*) desc, rr.label asc nulls last
  `;
  return rows.map((row) => ({
    actor: row.actor,
    reasonId: row.reason_id,
    reasonKey: row.reason_key,
    label: row.label,
    count: Number(row.count),
    otherTexts: row.other_texts ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Global event log (04 §12 GET /events)
// ---------------------------------------------------------------------------

export interface ListEventsFilters {
  entityType: string | null;
  entityId: string | null;
  eventType: string | null;
  actorId: string | null;
  from: string | null;
  to: string | null;
}

export interface EventsKeysetPosition {
  occurredAt: string;
  id: string;
}

/**
 * Newest-first keyset page over the audit trail. `limit + 1` rows are
 * requested by the service to detect a further page; the keyset is
 * (occurred_at, id) strictly descending.
 */
export async function listEventsPage(
  sql: Queryable,
  filters: ListEventsFilters,
  limit: number,
  after: EventsKeysetPosition | null,
): Promise<EventRecord[]> {
  const rows = await sql<
    {
      id: string;
      entity_type: string;
      entity_id: string;
      event_type: string;
      actor_id: string | null;
      actor_role: EventRecord['actorRole'];
      from_value: string | null;
      to_value: string | null;
      metadata: Record<string, unknown>;
      occurred_at: Date;
    }[]
  >`
    select id, entity_type, entity_id, event_type, actor_id, actor_role,
           from_value, to_value, metadata, occurred_at
    from events
    where true
      ${filters.entityType === null ? sql`` : sql`and entity_type = ${filters.entityType}`}
      ${filters.entityId === null ? sql`` : sql`and entity_id = ${filters.entityId}`}
      ${filters.eventType === null ? sql`` : sql`and event_type = ${filters.eventType}`}
      ${filters.actorId === null ? sql`` : sql`and actor_id = ${filters.actorId}`}
      ${filters.from === null ? sql`` : sql`and occurred_at >= ${filters.from}`}
      ${filters.to === null ? sql`` : sql`and occurred_at <= ${filters.to}`}
      ${
        after === null
          ? sql``
          : sql`and (occurred_at, id) < (${after.occurredAt}::timestamptz, ${after.id}::uuid)`
      }
    order by occurred_at desc, id desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    fromValue: row.from_value,
    toValue: row.to_value,
    metadata: row.metadata,
    occurredAt: row.occurred_at.toISOString(),
  }));
}
