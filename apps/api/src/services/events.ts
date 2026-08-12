/**
 * Event emission (docs/06-BACKEND.md §2.3).
 *
 * `emitEvent` is called inside the same transaction as the state change it
 * records — never after commit — so the event log is complete by construction.
 * Database triggers write duplicate backstop events; the read API de-duplicates
 * on display (02 §12).
 */
import type postgres from 'postgres';
import type { UserRoleKey } from '@sdb/contracts';
import type { Tx } from '../lib/db.js';

export type EventEntityType =
  | 'requisition'
  | 'assignment'
  | 'client'
  | 'candidate'
  | 'question'
  | 'question_category'
  | 'user'
  // Taxonomy management (04 §5) — per-entity types, one per managed table.
  | 'engine'
  | 'department'
  | 'role_category'
  | 'tool'
  | 'skill'
  | 'industry'
  | 'disqualifier'
  | 'rejection_reason'
  // Manual notification resend (P7, 06 §4.3) — an admin-actor state change
  // on a notification_log row, so it writes an event like any other.
  | 'notification';

export interface EmitEventParams {
  entityType: EventEntityType;
  entityId: string;
  eventType: string;
  actorId: string | null;
  actorRole: UserRoleKey | null;
  fromValue?: string | null;
  toValue?: string | null;
  metadata?: Record<string, unknown>;
}

export async function emitEvent(
  tx: Tx,
  params: EmitEventParams,
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    insert into events (
      entity_type, entity_id, event_type,
      actor_id, actor_role, from_value, to_value, metadata
    ) values (
      ${params.entityType},
      ${params.entityId},
      ${params.eventType},
      ${params.actorId},
      ${params.actorRole},
      ${params.fromValue ?? null},
      ${params.toValue ?? null},
      ${
        // sql.json, never a stringified parameter: postgres.js JSON-encodes
        // string parameters bound to jsonb, so `${JSON.stringify(x)}::jsonb`
        // double-encodes and stores a jsonb *string scalar* instead of the
        // object.
        tx.json((params.metadata ?? {}) as postgres.JSONValue)
      }
    )
    returning id
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new Error('event insert returned no row');
  }
  return row.id;
}
