/**
 * SQL for the client dashboard (docs/04-API.md §12 GET /client/dashboard).
 * No business logic — composition lives in services/dashboard.service.ts.
 *
 * CLIENT-SCOPED SURFACE. Every function takes `clientId` as a required first
 * parameter; there is no variant without it (06 §3). Candidate-bearing reads
 * query the `client_visible_assignments` view exclusively, so internal
 * stages and gated PII are structurally absent (CLAUDE.md rules 3–4).
 */
import type { RequisitionStatus } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';
import type { EventRecord } from './requisitions.repo.js';

export interface ClientRequisitionSummaryRecord {
  id: string;
  reference: string;
  advertisedTitle: string | null;
  status: RequisitionStatus;
  submittedAt: string;
  updatedAt: string;
}

/** The caller's own requisitions, newest first. */
export async function listClientRequisitionSummaries(
  sql: Queryable,
  clientId: string,
): Promise<ClientRequisitionSummaryRecord[]> {
  const rows = await sql<
    {
      id: string;
      reference: string;
      advertised_title: string | null;
      status: RequisitionStatus;
      submitted_at: Date;
      updated_at: Date;
    }[]
  >`
    select id, reference, advertised_title, status, submitted_at, updated_at
    from requisitions
    where client_id = ${clientId}
    order by created_at desc, id desc
  `;
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    advertisedTitle: row.advertised_title,
    status: row.status,
    submittedAt: row.submitted_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

/**
 * Client-visible stage counts for ALL of the client's requisitions in one
 * query — the view's WHERE clause has already excluded internal stages.
 */
export async function getStageCountsByRequisition(
  sql: Queryable,
  clientId: string,
): Promise<Map<string, Record<string, number>>> {
  const rows = await sql<
    { requisition_id: string; stage: string; count: string }[]
  >`
    select requisition_id, stage::text as stage, count(*)::text as count
    from client_visible_assignments
    where client_id = ${clientId}
    group by requisition_id, stage
  `;
  const byRequisition = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const counts = byRequisition.get(row.requisition_id) ?? {};
    counts[row.stage] = Number(row.count);
    byRequisition.set(row.requisition_id, counts);
  }
  return byRequisition;
}

export interface PendingPrincipalApprovalRecord {
  requisitionId: string;
  reference: string;
  advertisedTitle: string | null;
  since: string;
}

/** Briefs waiting on THIS user's principal approval (J3). */
export async function listPendingPrincipalApprovals(
  sql: Queryable,
  clientId: string,
  principalUserId: string,
): Promise<PendingPrincipalApprovalRecord[]> {
  const rows = await sql<
    {
      id: string;
      reference: string;
      advertised_title: string | null;
      updated_at: Date;
    }[]
  >`
    select id, reference, advertised_title, updated_at
    from requisitions
    where client_id = ${clientId}
      and status = 'pending_principal_approval'
      and principal_user_id = ${principalUserId}
    order by updated_at asc, id asc
  `;
  return rows.map((row) => ({
    requisitionId: row.id,
    reference: row.reference,
    advertisedTitle: row.advertised_title,
    since: row.updated_at.toISOString(),
  }));
}

export interface CandidateAwaitingReviewRecord {
  assignmentId: string;
  requisitionId: string;
  requisitionReference: string;
  displayName: string;
  presentedAt: string | null;
}

/** Presented, undecided candidates — from the view only (rule 3). */
export async function listCandidatesAwaitingReview(
  sql: Queryable,
  clientId: string,
): Promise<CandidateAwaitingReviewRecord[]> {
  const rows = await sql<
    {
      assignment_id: string;
      requisition_id: string;
      reference: string;
      display_name: string;
      presented_at: Date | null;
    }[]
  >`
    select cva.assignment_id, cva.requisition_id, r.reference,
           cva.display_name, cva.presented_at
    from client_visible_assignments cva
    join requisitions r on r.id = cva.requisition_id
    where cva.client_id = ${clientId}
      and cva.stage = 'presented'
    order by cva.presented_at asc nulls last, cva.assignment_id asc
  `;
  return rows.map((row) => ({
    assignmentId: row.assignment_id,
    requisitionId: row.requisition_id,
    requisitionReference: row.reference,
    displayName: row.display_name,
    presentedAt: row.presented_at === null ? null : row.presented_at.toISOString(),
  }));
}

/**
 * Recent requisition events for the client's own requisitions, newest first.
 * Requisition events only: assignment events can carry internal pipeline
 * stages in their from-values (see contracts ClientDashboardSchema).
 */
export async function listRecentClientRequisitionEvents(
  sql: Queryable,
  clientId: string,
  limit: number,
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
    select e.id, e.entity_type, e.entity_id, e.event_type, e.actor_id,
           e.actor_role, e.from_value, e.to_value, e.metadata, e.occurred_at
    from events e
    join requisitions r on r.id = e.entity_id
    where e.entity_type = 'requisition'
      and r.client_id = ${clientId}
    order by e.occurred_at desc, e.id desc
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
