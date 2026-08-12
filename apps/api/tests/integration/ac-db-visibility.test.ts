/**
 * AC-DB-07 — client_visible_assignments returns rows only for the 8
 *            client-visible stages; the 6 gated PII fields are null before
 *            interview_scheduled and real from interview_scheduled onward.
 * AC-DB-08 — with the anon / authenticated database roles, selecting from
 *            candidates is denied (deny-all RLS + revoked grants). The API's
 *            superuser/service_role connection bypasses RLS by design; the
 *            test switches to the browser-facing roles with `set role` on a
 *            separate connection, which is exactly what an exposed anon or
 *            authenticated key would amount to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertAssignment,
  insertCandidate,
  insertClient,
  insertRequisition,
  insertUser,
} from './fixtures.js';
import { expectPgError, freshDb, sqlFor, type TestDb } from './harness.js';

const INSUFFICIENT_PRIVILEGE = '42501';

const ALL_STAGES = [
  'sourced', 'screened', 'vetted', 'presented', 'client_reviewing',
  'interview_scheduled', 'interviewed', 'offer', 'placed',
  'rejected_by_admin', 'rejected_by_client', 'withdrawn', 'closed_not_selected',
] as const;

const VISIBLE_STAGES = new Set([
  'presented', 'client_reviewing', 'interview_scheduled', 'interviewed',
  'offer', 'placed', 'rejected_by_client', 'closed_not_selected',
]);

const PII_UNLOCKED_STAGES = new Set([
  'interview_scheduled', 'interviewed', 'offer', 'placed',
]);

const GATED_FIELDS = [
  'first_name', 'last_name', 'email', 'phone', 'whatsapp', 'linkedin_url',
  'current_employer',
] as const;

/** The six fields named by the AC (first_name is additionally gated by the view). */
const SIX_GATED = GATED_FIELDS.filter((f) => f !== 'first_name');

let db: TestDb;

beforeAll(async () => {
  db = await freshDb();
});

afterAll(async () => {
  await db.close();
});

describe('AC-DB-07 — client_visible_assignments stage and PII matrix', () => {
  it('returns only the 8 visible stages and gates PII until interview_scheduled', async () => {
    const adminId = await insertUser(db.sql);
    const clientId = await insertClient(db.sql);
    const requisitionId = await insertRequisition(db.sql, { clientId });

    // One assignment per stage, each with a fully-populated candidate.
    const assignmentByStage = new Map<string, string>();
    for (const stage of ALL_STAGES) {
      const candidateId = await insertCandidate(db.sql);
      const assignmentId = await insertAssignment(db.sql, {
        requisitionId,
        candidateId,
        assignedBy: adminId,
        stage,
      });
      assignmentByStage.set(stage, assignmentId);
    }
    expect(assignmentByStage.size).toBe(13);

    type ViewRow = { assignment_id: string; stage: string; display_name: string | null } & {
      [K in (typeof GATED_FIELDS)[number]]: string | null;
    };
    const rows = await db.sql<ViewRow[]>`
      select * from client_visible_assignments
      where requisition_id = ${requisitionId}
    `;

    // Exactly the 8 visible stages, one row each.
    expect(rows.map((r) => r.stage).sort()).toEqual([...VISIBLE_STAGES].sort());

    for (const row of rows) {
      // Always-visible identity is present at every visible stage.
      expect(row.display_name, `display_name at ${row.stage}`).toBeTruthy();

      const unlocked = PII_UNLOCKED_STAGES.has(row.stage);
      for (const field of SIX_GATED) {
        if (unlocked) {
          expect(row[field], `${field} must be real at ${row.stage}`).toBeTruthy();
        } else {
          expect(row[field], `${field} must be null at ${row.stage}`).toBeNull();
        }
      }
      // first_name follows the same gate in the view.
      if (unlocked) {
        expect(row.first_name).toBeTruthy();
      } else {
        expect(row.first_name).toBeNull();
      }
    }

    // Explicit spot-checks for the two stages the AC names.
    for (const stage of ['presented', 'client_reviewing']) {
      const row = rows.find((r) => r.stage === stage);
      expect(row).toBeDefined();
      for (const field of SIX_GATED) {
        expect(row![field], `${field} at ${stage}`).toBeNull();
      }
    }
    const unlockedRow = rows.find((r) => r.stage === 'interview_scheduled');
    expect(unlockedRow).toBeDefined();
    for (const field of SIX_GATED) {
      expect(unlockedRow![field], `${field} at interview_scheduled`).toBeTruthy();
    }
  });
});

describe('AC-DB-08 — anon and authenticated roles are denied on candidates', () => {
  it.each(['anon', 'authenticated'])(
    'select * from candidates as %s → permission denied',
    async (role) => {
      // Separate connection so `set role` cannot leak into other tests.
      const restricted = sqlFor(db.url, 1);
      try {
        await restricted.unsafe(`set role ${role}`);
        const error = await expectPgError(
          restricted`select * from candidates`,
          INSUFFICIENT_PRIVILEGE,
        );
        expect(error.message).toMatch(/permission denied/i);
      } finally {
        await restricted.end({ timeout: 5 });
      }
    },
  );

  it('denies the anon role on every business table, not just candidates', async () => {
    const restricted = sqlFor(db.url, 1);
    try {
      await restricted.unsafe('set role anon');
      for (const table of ['clients', 'requisitions', 'assignments', 'events', 'users']) {
        await expectPgError(
          restricted.unsafe(`select * from "${table}"`),
          INSUFFICIENT_PRIVILEGE,
        );
      }
    } finally {
      await restricted.end({ timeout: 5 });
    }
  });
});
