/**
 * SQL for interviews (docs/02-DATABASE.md §9, docs/04-API.md §10). No
 * business logic — the stage rule (create moves the assignment to
 * `interview_scheduled` through the machine), the outcome/cancel rules, and
 * the notification fan-out live in services/interviews.service.ts.
 *
 * `unique (assignment_id, round_number)` stays authoritative for round
 * collisions: a race between the next-round read and the insert surfaces as
 * SQLSTATE 23505, which the service maps to a clean 422.
 */
import type { Interview, InterviewOutcome } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

interface InterviewRow {
  id: string;
  assignment_id: string;
  round_number: number;
  scheduled_at: Date | null;
  timezone: string | null;
  duration_minutes: number | null;
  meeting_url: string | null;
  interviewer_names: string | null;
  requested_by: string | null;
  created_by: string;
  outcome: InterviewOutcome;
  outcome_notes: string | null;
  outcome_recorded_by: string | null;
  outcome_recorded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapInterview(row: InterviewRow): Interview {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    roundNumber: row.round_number,
    scheduledAt: iso(row.scheduled_at),
    timezone: row.timezone,
    durationMinutes: row.duration_minutes,
    meetingUrl: row.meeting_url,
    interviewerNames: row.interviewer_names,
    requestedBy: row.requested_by,
    createdBy: row.created_by,
    outcome: row.outcome,
    outcomeNotes: row.outcome_notes,
    outcomeRecordedBy: row.outcome_recorded_by,
    outcomeRecordedAt: iso(row.outcome_recorded_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const INTERVIEW_COLUMNS = `
  id, assignment_id, round_number, scheduled_at, timezone, duration_minutes,
  meeting_url, interviewer_names, requested_by, created_by, outcome,
  outcome_notes, outcome_recorded_by, outcome_recorded_at, created_at,
  updated_at
`;

export async function findInterviewById(
  sql: Queryable,
  interviewId: string,
): Promise<Interview | null> {
  const rows = await sql<InterviewRow[]>`
    select ${sql.unsafe(INTERVIEW_COLUMNS)}
    from interviews
    where id = ${interviewId}
  `;
  const row = rows[0];
  return row === undefined ? null : mapInterview(row);
}

/** All interviews of one assignment, in round order. */
export async function listInterviewsForAssignment(
  sql: Queryable,
  assignmentId: string,
): Promise<Interview[]> {
  const rows = await sql<InterviewRow[]>`
    select ${sql.unsafe(INTERVIEW_COLUMNS)}
    from interviews
    where assignment_id = ${assignmentId}
    order by round_number asc
  `;
  return rows.map(mapInterview);
}

/** Next round for the assignment: max(round_number) + 1, or 1. */
export async function getNextRoundNumber(
  sql: Queryable,
  assignmentId: string,
): Promise<number> {
  const rows = await sql<{ next: number }[]>`
    select coalesce(max(round_number), 0)::int + 1 as next
    from interviews
    where assignment_id = ${assignmentId}
  `;
  return rows[0]?.next ?? 1;
}

/** True when the assignment has another pending interview besides `exceptId`. */
export async function hasOtherPendingInterview(
  sql: Queryable,
  assignmentId: string,
  exceptId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    select id from interviews
    where assignment_id = ${assignmentId}
      and id <> ${exceptId}
      and outcome = 'pending'
    limit 1
  `;
  return rows.length > 0;
}

export interface InsertInterviewInput {
  assignmentId: string;
  roundNumber: number;
  scheduledAt: string;
  timezone: string;
  durationMinutes: number | null;
  meetingUrl: string | null;
  interviewerNames: string | null;
  createdBy: string;
}

/** Insert at outcome = 'pending'. 23505 on a round collision (unique). */
export async function insertInterview(
  sql: Queryable,
  input: InsertInterviewInput,
): Promise<Interview> {
  const rows = await sql<InterviewRow[]>`
    insert into interviews (
      assignment_id, round_number, scheduled_at, timezone, duration_minutes,
      meeting_url, interviewer_names, created_by
    ) values (
      ${input.assignmentId}, ${input.roundNumber}, ${input.scheduledAt},
      ${input.timezone}, ${input.durationMinutes}, ${input.meetingUrl},
      ${input.interviewerNames}, ${input.createdBy}
    )
    returning ${sql.unsafe(INTERVIEW_COLUMNS)}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('interview insert returned no row');
  return mapInterview(row);
}

export interface InterviewSchedulePatch {
  scheduledAt?: string;
  timezone?: string;
  durationMinutes?: number | null;
  meetingUrl?: string | null;
  interviewerNames?: string | null;
}

/**
 * Schedule-field update, guarded on outcome = 'pending' so a recorded
 * interview cannot be silently rescheduled (the CAS mirrors the service's
 * 422; a concurrent outcome write makes this match zero rows).
 */
export async function updateInterviewSchedule(
  sql: Queryable,
  interviewId: string,
  patch: InterviewSchedulePatch,
): Promise<Interview | null> {
  const assignments: Record<string, unknown> = {};
  if (patch.scheduledAt !== undefined) assignments['scheduled_at'] = patch.scheduledAt;
  if (patch.timezone !== undefined) assignments['timezone'] = patch.timezone;
  if (patch.durationMinutes !== undefined) assignments['duration_minutes'] = patch.durationMinutes;
  if (patch.meetingUrl !== undefined) assignments['meeting_url'] = patch.meetingUrl;
  if (patch.interviewerNames !== undefined) assignments['interviewer_names'] = patch.interviewerNames;
  const rows = await sql<InterviewRow[]>`
    update interviews
    set ${sql(assignments)}, updated_at = now()
    where id = ${interviewId}
      and outcome = 'pending'
    returning ${sql.unsafe(INTERVIEW_COLUMNS)}
  `;
  const row = rows[0];
  return row === undefined ? null : mapInterview(row);
}

/**
 * Outcome write with a compare-and-set on `outcome = 'pending'` — an
 * already-recorded interview matches zero rows and the service raises the
 * 422; concurrent recorders cannot both win.
 */
export async function writeInterviewOutcome(
  sql: Queryable,
  interviewId: string,
  outcome: InterviewOutcome,
  outcomeNotes: string | null,
  recordedBy: string,
): Promise<Interview | null> {
  const rows = await sql<InterviewRow[]>`
    update interviews
    set outcome = ${outcome},
        outcome_notes = ${outcomeNotes},
        outcome_recorded_by = ${recordedBy},
        outcome_recorded_at = now(),
        updated_at = now()
    where id = ${interviewId}
      and outcome = 'pending'
    returning ${sql.unsafe(INTERVIEW_COLUMNS)}
  `;
  const row = rows[0];
  return row === undefined ? null : mapInterview(row);
}
