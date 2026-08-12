/**
 * AC-DB-06 — events rows are immutable: UPDATE and DELETE both raise.
 * AC-DB-10 — every assignment stage change writes exactly one trigger-sourced
 *            events row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertAssignment,
  insertCandidate,
  insertClient,
  insertRequisition,
  insertUser,
} from './fixtures.js';
import { expectPgError, freshDb, type TestDb } from './harness.js';

const INSUFFICIENT_PRIVILEGE = '42501';

let db: TestDb;
let adminId: string;
let clientId: string;
let requisitionId: string;

beforeAll(async () => {
  db = await freshDb();
  adminId = await insertUser(db.sql);
  clientId = await insertClient(db.sql);
  requisitionId = await insertRequisition(db.sql, { clientId });
});

afterAll(async () => {
  await db.close();
});

describe('AC-DB-06 — events are immutable', () => {
  it('raises on UPDATE and on DELETE', async () => {
    const [event] = await db.sql<{ id: string }[]>`
      insert into events (entity_type, entity_id, event_type)
      values ('candidate', gen_random_uuid(), 'test_event')
      returning id
    `;
    expect(event).toBeDefined();

    await expectPgError(
      db.sql`update events set event_type = 'tampered' where id = ${event!.id}`,
      INSUFFICIENT_PRIVILEGE,
    );
    await expectPgError(
      db.sql`delete from events where id = ${event!.id}`,
      INSUFFICIENT_PRIVILEGE,
    );

    // The row is untouched.
    const [row] = await db.sql<{ event_type: string }[]>`
      select event_type from events where id = ${event!.id}
    `;
    expect(row?.event_type).toBe('test_event');
  });
});

describe('AC-DB-10 — one trigger-sourced events row per assignment stage change', () => {
  it('writes exactly one events row per stage change, none for other updates', async () => {
    const candidateId = await insertCandidate(db.sql);
    const assignmentId = await insertAssignment(db.sql, {
      requisitionId,
      candidateId,
      assignedBy: adminId,
      stage: 'sourced',
    });

    const eventsFor = () => db.sql<
      { from_value: string | null; to_value: string | null; metadata: { source?: string } }[]
    >`
      select from_value, to_value, metadata
      from events
      where entity_type = 'assignment' and entity_id = ${assignmentId}
      order by occurred_at asc
    `;

    // Insert alone writes no stage-change event.
    expect(await eventsFor()).toHaveLength(0);

    await db.sql`update assignments set stage = 'screened' where id = ${assignmentId}`;
    let events = await eventsFor();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from_value: 'sourced', to_value: 'screened' });
    expect(events[0]!.metadata.source).toBe('trigger');

    await db.sql`update assignments set stage = 'vetted' where id = ${assignmentId}`;
    events = await eventsFor();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ from_value: 'screened', to_value: 'vetted' });
    expect(events[1]!.metadata.source).toBe('trigger');

    // A non-stage update writes nothing.
    await db.sql`update assignments set admin_note = 'note' where id = ${assignmentId}`;
    expect(await eventsFor()).toHaveLength(2);

    // A no-op stage "change" (same value) writes nothing.
    await db.sql`update assignments set stage = 'vetted' where id = ${assignmentId}`;
    expect(await eventsFor()).toHaveLength(2);
  });

  it('walks a full pipeline: one event per transition', async () => {
    const candidateId = await insertCandidate(db.sql);
    const assignmentId = await insertAssignment(db.sql, {
      requisitionId,
      candidateId,
      assignedBy: adminId,
      stage: 'sourced',
    });
    const stages = ['screened', 'vetted', 'presented', 'client_reviewing',
      'interview_scheduled', 'interviewed', 'offer', 'placed'];
    for (const stage of stages) {
      await db.sql`
        update assignments set stage = ${stage}::assignment_stage
        where id = ${assignmentId}
      `;
    }
    const rows = await db.sql<{ n: number }[]>`
      select count(*)::int as n
      from events
      where entity_type = 'assignment'
        and entity_id = ${assignmentId}
        and event_type = 'stage_changed'
        and metadata->>'source' = 'trigger'
    `;
    expect(rows[0]?.n).toBe(stages.length);
  });
});
