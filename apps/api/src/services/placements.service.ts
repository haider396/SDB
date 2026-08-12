/**
 * Placement reads and updates (docs/04-API.md §11). Creation is NOT here —
 * a placement only ever comes into existence through the one-transaction
 * `POST /assignments/:id/place` flow in services/assignments.service.ts
 * (AC-PL-13).
 *
 * - Client-scoped callers are implicitly tenant-filtered: their clientId
 *   comes from membership, never from the request; a foreign placement is a
 *   404 (04 §1.3). Placements carry no candidate PII, so serving them from
 *   the base table does not cross the client_visible_assignments gate.
 * - PATCH is an admin surface (client.update) and writes an event.
 */
import type {
  ListPlacementsQuery,
  Placement,
  UpdatePlacementBody,
  UserRoleKey,
} from '@sdb/contracts';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { withTransaction, type Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  findPlacementById,
  listPlacements,
  updatePlacement,
} from '../repositories/placements.repo.js';
import { emitEvent } from './events.js';

export interface PlacementActor {
  userId: string;
  role: UserRoleKey | null;
  /** Resolved membership scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
}

export interface PlacementsServiceDeps {
  db: Db;
}

export interface PlacementsService {
  list(
    query: ListPlacementsQuery,
    actor: PlacementActor,
  ): Promise<{ data: Placement[]; nextCursor: string | null }>;
  get(placementId: string, actor: PlacementActor): Promise<Placement>;
  update(
    placementId: string,
    body: UpdatePlacementBody,
    actor: PlacementActor,
  ): Promise<Placement>;
}

export function createPlacementsService(
  deps: PlacementsServiceDeps,
): PlacementsService {
  const { db } = deps;

  async function load(
    placementId: string,
    actor: PlacementActor,
  ): Promise<Placement> {
    const record =
      actor.ownClientId === null
        ? await findPlacementById(db, placementId)
        : await findPlacementById(db, placementId, actor.ownClientId);
    if (record === null) {
      throw new ApiError('NOT_FOUND', 'Placement not found.');
    }
    return record;
  }

  return {
    async list(query, actor) {
      // 04 §1.3: the tenant filter for scoped callers comes from membership;
      // the clientId query param is honoured for admins only.
      const clientId = actor.ownClientId ?? query.clientId;
      const rows = await listPlacements(db, {
        ...(clientId !== undefined ? { clientId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        limit: query.limit,
        ...(query.cursor !== undefined ? { cursor: decodeCursor(query.cursor) } : {}),
      });
      const last = rows[rows.length - 1];
      return {
        data: rows,
        nextCursor:
          rows.length === query.limit && last !== undefined
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
      };
    },

    async get(placementId, actor) {
      return load(placementId, actor);
    },

    async update(placementId, body, actor) {
      // client.update is an admin permission; the surface does not exist for
      // client-scoped callers.
      if (actor.ownClientId !== null) {
        throw new ApiError('NOT_FOUND', 'Placement not found.');
      }
      const existing = await load(placementId, actor);
      let updated: Placement | null = null;
      await withTransaction(db, async (tx) => {
        updated = await updatePlacement(tx, placementId, body);
        if (updated === null) {
          throw new ApiError('NOT_FOUND', 'Placement not found.');
        }
        await emitEvent(tx, {
          entityType: 'assignment',
          entityId: existing.assignmentId,
          eventType: 'placement_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          ...(body.status !== undefined && body.status !== existing.status
            ? { fromValue: existing.status, toValue: body.status }
            : {}),
          metadata: {
            placementId,
            requisitionId: existing.requisitionId,
            candidateId: existing.candidateId,
            changedFields: Object.keys(body),
          },
        });
      });
      if (updated === null) {
        throw new ApiError('INTERNAL_ERROR', 'Placement update returned no row.');
      }
      return updated;
    },
  };
}
