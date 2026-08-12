/**
 * SQL for placements (docs/02-DATABASE.md §9, docs/04-API.md §11). No
 * business logic — the one-transaction place flow lives in
 * services/assignments.service.ts.
 */
import type { Placement, PlacementStatus } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

const num = (value: string | null): number | null =>
  value === null ? null : Number(value);

interface PlacementRow {
  id: string;
  assignment_id: string;
  candidate_id: string;
  client_id: string;
  requisition_id: string;
  start_date: string;
  end_date: string | null;
  rate_amount: string | null;
  rate_unit: Placement['rateUnit'];
  rate_currency: string | null;
  hours_per_week: number | null;
  service_tier: Placement['serviceTier'];
  guarantee_end_date: string | null;
  status: PlacementStatus;
  created_at: Date;
  updated_at: Date;
}

function mapPlacement(row: PlacementRow): Placement {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    candidateId: row.candidate_id,
    clientId: row.client_id,
    requisitionId: row.requisition_id,
    startDate: row.start_date,
    endDate: row.end_date,
    rateAmount: num(row.rate_amount),
    rateUnit: row.rate_unit,
    // char(3) — trim in case the driver preserves padding.
    rateCurrency: row.rate_currency === null ? null : row.rate_currency.trim(),
    hoursPerWeek: row.hours_per_week,
    serviceTier: row.service_tier,
    guaranteeEndDate: row.guarantee_end_date,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const PLACEMENT_COLUMNS = `
  id, assignment_id, candidate_id, client_id, requisition_id,
  start_date::text as start_date, end_date::text as end_date,
  rate_amount::text as rate_amount, rate_unit, rate_currency,
  hours_per_week, service_tier, guarantee_end_date::text as guarantee_end_date,
  status, created_at, updated_at
`;

export interface InsertPlacementInput {
  assignmentId: string;
  candidateId: string;
  clientId: string;
  requisitionId: string;
  startDate: string;
  endDate: string | null;
  rateAmount: number | null;
  rateUnit: string | null;
  rateCurrency: string | null;
  hoursPerWeek: number | null;
  serviceTier: string | null;
  guaranteeEndDate: string | null;
}

export async function insertPlacement(
  sql: Queryable,
  input: InsertPlacementInput,
): Promise<Placement> {
  const rows = await sql<PlacementRow[]>`
    insert into placements (
      assignment_id, candidate_id, client_id, requisition_id,
      start_date, end_date, rate_amount, rate_unit, rate_currency,
      hours_per_week, service_tier, guarantee_end_date
    ) values (
      ${input.assignmentId}, ${input.candidateId}, ${input.clientId},
      ${input.requisitionId}, ${input.startDate}::date,
      ${input.endDate}::date, ${input.rateAmount},
      ${input.rateUnit}::rate_unit,
      ${input.rateCurrency ?? 'USD'},
      ${input.hoursPerWeek}, ${input.serviceTier}::service_tier,
      ${input.guaranteeEndDate}::date
    )
    returning ${sql.unsafe(PLACEMENT_COLUMNS)}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('placement insert returned no row');
  return mapPlacement(row);
}

/**
 * `clientId` (when given) is the mandatory tenant filter for client-scoped
 * callers — a cross-tenant id yields null, surfacing as 404 (04 §1.3).
 */
export async function findPlacementById(
  sql: Queryable,
  placementId: string,
  clientId?: string,
): Promise<Placement | null> {
  const rows = await sql<PlacementRow[]>`
    select ${sql.unsafe(PLACEMENT_COLUMNS)}
    from placements
    where id = ${placementId}
      ${clientId === undefined ? sql`` : sql`and client_id = ${clientId}`}
  `;
  const row = rows[0];
  return row === undefined ? null : mapPlacement(row);
}

export interface ListPlacementsFilters {
  /** Mandatory tenant filter for client-scoped callers (04 §1.3). */
  clientId?: string;
  status?: PlacementStatus;
  limit: number;
  cursor?: { createdAt: string; id: string };
}

export async function listPlacements(
  sql: Queryable,
  filters: ListPlacementsFilters,
): Promise<Placement[]> {
  const rows = await sql<PlacementRow[]>`
    select ${sql.unsafe(PLACEMENT_COLUMNS)}
    from placements
    where true
      ${filters.clientId === undefined ? sql`` : sql`and client_id = ${filters.clientId}`}
      ${filters.status === undefined ? sql`` : sql`and status = ${filters.status}`}
      ${
        filters.cursor === undefined
          ? sql``
          : sql`and (created_at, id) < (${filters.cursor.createdAt}::timestamptz, ${filters.cursor.id}::uuid)`
      }
    order by created_at desc, id desc
    limit ${filters.limit}
  `;
  return rows.map(mapPlacement);
}

export interface PlacementPatch {
  startDate?: string;
  endDate?: string | null;
  rateAmount?: number | null;
  rateUnit?: string | null;
  rateCurrency?: string | null;
  hoursPerWeek?: number | null;
  serviceTier?: string | null;
  guaranteeEndDate?: string | null;
  status?: PlacementStatus;
}

export async function updatePlacement(
  sql: Queryable,
  placementId: string,
  patch: PlacementPatch,
): Promise<Placement | null> {
  const assignments: Record<string, unknown> = {};
  if (patch.startDate !== undefined) assignments['start_date'] = patch.startDate;
  if (patch.endDate !== undefined) assignments['end_date'] = patch.endDate;
  if (patch.rateAmount !== undefined) assignments['rate_amount'] = patch.rateAmount;
  if (patch.rateUnit !== undefined) assignments['rate_unit'] = patch.rateUnit;
  if (patch.rateCurrency !== undefined) assignments['rate_currency'] = patch.rateCurrency;
  if (patch.hoursPerWeek !== undefined) assignments['hours_per_week'] = patch.hoursPerWeek;
  if (patch.serviceTier !== undefined) assignments['service_tier'] = patch.serviceTier;
  if (patch.guaranteeEndDate !== undefined) {
    assignments['guarantee_end_date'] = patch.guaranteeEndDate;
  }
  if (patch.status !== undefined) assignments['status'] = patch.status;
  if (Object.keys(assignments).length === 0) {
    return findPlacementById(sql, placementId);
  }
  const rows = await sql<PlacementRow[]>`
    update placements
    set ${sql(assignments)}, updated_at = now()
    where id = ${placementId}
    returning ${sql.unsafe(PLACEMENT_COLUMNS)}
  `;
  const row = rows[0];
  return row === undefined ? null : mapPlacement(row);
}
