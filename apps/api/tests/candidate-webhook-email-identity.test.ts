/**
 * Inbound webhook — email identity (0024).
 *
 * Migration 0024 made email unique among LIVE candidates. The webhook still
 * de-duplicated on externalId only, so a payload carrying an address that
 * already belonged to a DIFFERENT live candidate raised an unhandled 23505 and
 * came back as `500 INTERNAL_ERROR` — the one answer 04 §8.2's lenient-ingest
 * contract must never give a sourcing platform, because it says nothing about
 * what to fix and reads as "your service is down".
 *
 * Worse than the status code: the 23505 aborted the transaction, so the
 * `webhook_ingest_log` insert rolled back with it and the failure left NO trace
 * at all — behaviour 7 / AC-CA-12 says every authenticated request writes
 * exactly one row.
 *
 * These are unit tests: the repositories are mocked and `withTransaction` runs
 * against a fake `begin`, so what is pinned is the SERVICE's control flow —
 * refuse, log, map. The concurrency claim underneath it (pg_advisory_xact_lock
 * serialising two callers on one address) can only be proven against real
 * Postgres, which needs Docker; that belongs in
 * tests/integration/ac-candidate-webhook.test.ts and is NOT covered here. What
 * these tests can and do pin is the lock's call ORDER, which is the part a
 * refactor is most likely to get wrong.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '@sdb/contracts';
import type { Db, Tx } from '../src/lib/db.js';
import { ApiError } from '../src/lib/errors.js';
import type { SupabaseStoragePort } from '../src/lib/supabase-storage.js';

const candidatesRepo = vi.hoisted(() => ({
  findCandidateByExternalId: vi.fn(),
  findCandidateById: vi.fn(),
  findLiveCandidateByEmail: vi.fn(),
  findRoleCategoryIdByKey: vi.fn(),
  insertCandidate: vi.fn(),
  lockCandidateEmail: vi.fn(),
  setCvPrimaryFileIfUnset: vi.fn(),
  updateCandidate: vi.fn(),
}));

const filesRepo = vi.hoisted(() => ({
  findIngestByIdempotencyKey: vi.fn(),
  insertFile: vi.fn(),
  insertIngestLog: vi.fn(),
}));

const eventsService = vi.hoisted(() => ({ emitEvent: vi.fn() }));

vi.mock('../src/repositories/candidates.repo.js', () => candidatesRepo);
vi.mock('../src/repositories/candidate-files.repo.js', () => filesRepo);
vi.mock('../src/services/events.js', () => eventsService);

const { createCandidateWebhookService, isEmailIdentityViolation } =
  await import('../src/services/candidate-webhook.service.js');

/**
 * Marker handles. The repositories are mocked, so these only have to be
 * distinguishable — which is exactly the point: WHICH handle a write lands on
 * (the aborted transaction, or the pool afterwards) is half of what is under
 * test here.
 */
const TX = { handle: 'transaction' } as unknown as Tx;
const db = {
  begin: async (fn: (tx: Tx) => Promise<unknown>) => fn(TX),
} as unknown as Db;

const storage = {
  uploadObject: vi.fn(),
  removeObject: vi.fn(),
} as unknown as SupabaseStoragePort;

const logger = { warn: vi.fn() };

const EMAIL = 'ada@example.com';
const PAYLOAD = {
  externalId: 'src_9931',
  firstName: 'Grace',
  lastName: 'Hopper',
  email: EMAIL,
};

/** The candidate the address already belongs to. */
const OWNER = { id: 'owner-id', reference: 'CAN-000042' };

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'new-id',
    reference: 'CAN-000999',
    dataCompleteness: 'incomplete',
    source: 'linkedin',
    externalId: PAYLOAD.externalId,
    ...overrides,
  } as Candidate;
}

function makeService() {
  return createCandidateWebhookService({
    db,
    storage,
    webhookToken: 'token',
    logger,
  });
}

/** SQLSTATE 23505 as postgres.js reports it. */
function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error('duplicate key value'), {
    code: '23505',
    constraint_name: constraint,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  candidatesRepo.findCandidateByExternalId.mockResolvedValue(null);
  candidatesRepo.findLiveCandidateByEmail.mockResolvedValue(null);
  candidatesRepo.findCandidateById.mockResolvedValue(candidate());
  candidatesRepo.insertCandidate.mockResolvedValue(candidate());
  candidatesRepo.updateCandidate.mockResolvedValue(true);
  candidatesRepo.lockCandidateEmail.mockResolvedValue(undefined);
  filesRepo.insertIngestLog.mockResolvedValue('log-id');
});

describe('email already belongs to a different live candidate', () => {
  beforeEach(() => {
    candidatesRepo.findLiveCandidateByEmail.mockResolvedValue(OWNER);
  });

  it('refuses with 422 naming the field, never a 500', async () => {
    const error = await makeService()
      .ingest(PAYLOAD, null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.code).toBe('VALIDATION_FAILED');
    expect(api.statusCode).toBe(422);
    // details.fields is what reaches a UI; a bare message does not.
    expect(api.details?.['fields']).toEqual({
      email: 'Already used by another candidate.',
    });
    // The integrator cannot act on "already used" without knowing which record.
    expect(api.details?.['conflictingCandidateReference']).toBe('CAN-000042');
  });

  it('writes nothing to any candidate and emits no event', async () => {
    await expect(makeService().ingest(PAYLOAD, null)).rejects.toThrow(ApiError);

    expect(candidatesRepo.insertCandidate).not.toHaveBeenCalled();
    expect(candidatesRepo.updateCandidate).not.toHaveBeenCalled();
    // Invariant 4 covers state TRANSITIONS. A refusal changed no state, so
    // there is nothing to record as one; the ingest log is its audit trail.
    expect(eventsService.emitEvent).not.toHaveBeenCalled();
  });

  it('logs the refusal as a rejected ingest row, on the pool not the transaction', async () => {
    await expect(makeService().ingest(PAYLOAD, null)).rejects.toThrow(ApiError);

    expect(filesRepo.insertIngestLog).toHaveBeenCalledTimes(1);
    const [handle, row] = filesRepo.insertIngestLog.mock.calls[0]!;
    // The real transaction is ABORTED by the time this runs — a log written on
    // `tx` would roll back with it, which is exactly how the live bug left no
    // trace of the failure at all.
    expect(handle).toBe(db);
    expect(handle).not.toBe(TX);
    expect(row).toMatchObject({
      result: 'rejected',
      externalId: 'src_9931',
      // Null, not the conflicting candidate: nothing was written to that
      // record, and pointing the row at it would read as though this ingest
      // had updated it.
      candidateId: null,
    });
    expect(row.errorDetail).toContain('CAN-000042');
    expect(row.errorDetail).toContain(EMAIL);
  });

  it('keeps the dropped-fields detail alongside the conflict reason', async () => {
    await expect(
      makeService().ingest({ ...PAYLOAD, accentStrength: 'nonsense' }, null),
    ).rejects.toThrow(ApiError);

    const row = filesRepo.insertIngestLog.mock.calls[0]![1];
    expect(row.errorDetail).toContain('dropped fields: accentStrength');
    expect(row.errorDetail).toContain('already belongs to');
  });

  it('warns so the conflict surfaces for review', async () => {
    await expect(makeService().ingest(PAYLOAD, null)).rejects.toThrow(ApiError);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, conflictsWith: 'CAN-000042' }),
      expect.stringContaining('refused'),
    );
  });

  it('takes the advisory lock BEFORE either identity lookup', async () => {
    await expect(makeService().ingest(PAYLOAD, null)).rejects.toThrow(ApiError);

    // The lock is what actually serialises two callers on one address; the
    // unique index is only the backstop. Checking after the lookups would
    // reintroduce the read-then-write race the lock exists to close.
    const lockedAt = candidatesRepo.lockCandidateEmail.mock.invocationCallOrder[0]!;
    expect(lockedAt).toBeLessThan(
      candidatesRepo.findCandidateByExternalId.mock.invocationCallOrder[0]!,
    );
    expect(lockedAt).toBeLessThan(
      candidatesRepo.findLiveCandidateByEmail.mock.invocationCallOrder[0]!,
    );
    expect(candidatesRepo.lockCandidateEmail).toHaveBeenCalledWith(TX, EMAIL);
  });
});

describe('addresses that are NOT a conflict', () => {
  it('accepts an address the same externalId already owns', async () => {
    const existing = candidate({ id: 'same-id', reference: 'CAN-000100' });
    candidatesRepo.findCandidateByExternalId.mockResolvedValue(existing);
    candidatesRepo.findCandidateById.mockResolvedValue(existing);
    candidatesRepo.findLiveCandidateByEmail.mockResolvedValue({
      id: 'same-id',
      reference: 'CAN-000100',
    });

    const result = await makeService().ingest(PAYLOAD, null);

    expect(result.result).toBe('updated');
    expect(candidatesRepo.updateCandidate).toHaveBeenCalled();
    expect(filesRepo.insertIngestLog.mock.calls[0]![1].result).toBe('updated');
  });

  it('does not lock or look up when the payload carries no email', async () => {
    const noEmail = { ...PAYLOAD, email: undefined };

    const result = await makeService().ingest(noEmail, null);

    expect(result.result).toBe('created');
    expect(candidatesRepo.lockCandidateEmail).not.toHaveBeenCalled();
    expect(candidatesRepo.findLiveCandidateByEmail).not.toHaveBeenCalled();
  });

  it('does not lock on an email the lenient extractor dropped as invalid', async () => {
    // A malformed address never reaches the column, so there is nothing to
    // serialise on — and locking a garbage string would be a silent no-op.
    const result = await makeService().ingest(
      { ...PAYLOAD, email: 'not-an-address' },
      null,
    );

    expect(result.droppedFields).toContain('email');
    expect(candidatesRepo.lockCandidateEmail).not.toHaveBeenCalled();
  });
});

describe('23505 backstop — a violation that slipped past the lock', () => {
  it('maps the email index violation to the same 422, not a 500', async () => {
    // Pre-check clean (the race), then the write loses.
    candidatesRepo.findLiveCandidateByEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(OWNER);
    candidatesRepo.insertCandidate.mockRejectedValue(
      uniqueViolation('idx_candidates_email_live'),
    );

    const error = await makeService()
      .ingest(PAYLOAD, null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(422);
    expect((error as ApiError).details?.['conflictingCandidateReference']).toBe(
      'CAN-000042',
    );
  });

  it('re-reads the owner on the POOL, because the transaction is aborted', async () => {
    candidatesRepo.findLiveCandidateByEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(OWNER);
    candidatesRepo.insertCandidate.mockRejectedValue(
      uniqueViolation('idx_candidates_email_live'),
    );

    await expect(makeService().ingest(PAYLOAD, null)).rejects.toThrow(ApiError);

    // Any statement issued on the aborted transaction would itself error.
    const [handle] = candidatesRepo.findLiveCandidateByEmail.mock.calls[1]!;
    expect(handle).toBe(db);
    expect(filesRepo.insertIngestLog.mock.calls[0]![1].result).toBe('rejected');
  });

  it('leaves a DIFFERENT unique violation alone rather than mislabelling it', async () => {
    // candidates.external_id is unique too. Reporting that as an email
    // conflict would send the integrator to fix the wrong field, and would put
    // a false reason in the ingest log.
    candidatesRepo.insertCandidate.mockRejectedValue(
      uniqueViolation('candidates_external_id_key'),
    );

    const error = await makeService()
      .ingest(PAYLOAD, null)
      .catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(ApiError);
    expect(filesRepo.insertIngestLog).not.toHaveBeenCalled();
  });
});

describe('isEmailIdentityViolation', () => {
  it('matches only 23505 on the email index', () => {
    expect(
      isEmailIdentityViolation(uniqueViolation('idx_candidates_email_live')),
    ).toBe(true);
    expect(
      isEmailIdentityViolation(uniqueViolation('candidates_external_id_key')),
    ).toBe(false);
    expect(
      isEmailIdentityViolation(
        Object.assign(new Error('fk'), {
          code: '23503',
          constraint_name: 'idx_candidates_email_live',
        }),
      ),
    ).toBe(false);
  });

  it('survives a non-object throw instead of crashing the handler', () => {
    // It runs in a catch block; `throw null` is legal JavaScript, and a
    // TypeError here would reinstate the 500 this path exists to remove.
    expect(isEmailIdentityViolation(null)).toBe(false);
    expect(isEmailIdentityViolation(undefined)).toBe(false);
    expect(isEmailIdentityViolation('23505')).toBe(false);
  });
});
