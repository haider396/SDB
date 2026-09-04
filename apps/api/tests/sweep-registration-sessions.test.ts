/**
 * sweep-registration-sessions.
 *
 * `findExpiredSessions` and `deleteSessions` shipped in 0017 and were wired to
 * nothing, so every abandoned registration left its staged CV in Storage
 * permanently. The ordering is the part worth pinning: the rows are the only
 * record of the storage paths, so objects must be removed BEFORE the rows. Get
 * that backwards and the objects are orphaned with no way left to find them.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/lib/db.js';
import type { SupabaseStoragePort } from '../src/lib/supabase-storage.js';

const repo = vi.hoisted(() => ({
  findExpiredSessions: vi.fn(),
  deleteSessions: vi.fn(),
}));

vi.mock('../src/repositories/candidate-registration.repo.js', () => repo);

const { sweepRegistrationSessions } = await import(
  '../src/jobs/sweep-registration-sessions.js'
);

const db = {} as Db;

function makeStorage(removeObject: SupabaseStoragePort['removeObject']) {
  return { removeObject } as SupabaseStoragePort;
}

describe('sweepRegistrationSessions', () => {
  it('removes every staged object, then deletes the sessions', async () => {
    const order: string[] = [];
    repo.findExpiredSessions.mockImplementation(async () => [
      { id: 'session-a', storagePaths: ['registrations/a/cv.pdf', 'registrations/a/photo.png'] },
      { id: 'session-b', storagePaths: [] },
    ]);
    repo.deleteSessions.mockImplementation(async (_sql: unknown, ids: string[]) => {
      order.push(`delete:${ids.join(',')}`);
      return ids.length;
    });
    const storage = makeStorage(
      vi.fn(async (path: string) => {
        order.push(`remove:${path}`);
      }),
    );

    const result = await sweepRegistrationSessions(db, storage);

    expect(result).toEqual({
      sessionsDeleted: 2,
      objectsRemoved: 2,
      sessionsSkipped: 0,
    });
    // The ordering guarantee: both removals precede the delete.
    expect(order).toEqual([
      'remove:registrations/a/cv.pdf',
      'remove:registrations/a/photo.png',
      'delete:session-a,session-b',
    ]);
  });

  it('keeps a session whose object could not be removed, so it retries next run', async () => {
    repo.findExpiredSessions.mockResolvedValue([
      { id: 'session-ok', storagePaths: ['registrations/ok/cv.pdf'] },
      { id: 'session-bad', storagePaths: ['registrations/bad/cv.pdf'] },
    ]);
    repo.deleteSessions.mockImplementation(async (_sql: unknown, ids: string[]) => ids.length);
    const storage = makeStorage(
      vi.fn(async (path: string) => {
        if (path.includes('/bad/')) throw new Error('storage unavailable');
      }),
    );
    const warn = vi.fn();

    const result = await sweepRegistrationSessions(db, storage, {
      logger: { info: vi.fn(), warn },
    });

    expect(result.sessionsSkipped).toBe(1);
    expect(result.sessionsDeleted).toBe(1);
    // Only the healthy session is deleted; the failed one keeps its row, which
    // is the only record of the path still to be cleaned up.
    expect(repo.deleteSessions).toHaveBeenCalledWith(db, ['session-ok']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('does nothing when there is nothing expired', async () => {
    repo.findExpiredSessions.mockResolvedValue([]);
    repo.deleteSessions.mockResolvedValue(0);
    const removeObject = vi.fn();

    const result = await sweepRegistrationSessions(db, makeStorage(removeObject));

    expect(result).toEqual({
      sessionsDeleted: 0,
      objectsRemoved: 0,
      sessionsSkipped: 0,
    });
    expect(removeObject).not.toHaveBeenCalled();
  });
});
