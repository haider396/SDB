/**
 * Public registration upload hardening.
 *
 * `confirmUpload` used to stamp `confirmed_at` unconditionally: any caller
 * holding an open session could mark a file confirmed that was never uploaded,
 * and `attachRegistrationFiles` would then promote a `candidate_files` row
 * pointing at an object that does not exist. The admin path
 * (candidate-files.service.ts) has always verified against Storage; these tests
 * pin the public path to the same behaviour.
 *
 * Also covers the staged-upload cap: CandidateRegistrationSchema.files is
 * .max(10), but that caps promotion at submit time — without a cap on
 * createUploadUrl one session can mint unlimited signed URLs.
 *
 * The repository module is mocked so this stays a unit test: the logic under
 * test is entirely in the service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/errors.js';
import type { Db } from '../src/lib/db.js';
import type { SupabaseStoragePort } from '../src/lib/supabase-storage.js';
import type { CandidateRegistrationFormService } from '../src/services/candidate-registration-form.service.js';

const repo = vi.hoisted(() => ({
  getRegistrationSession: vi.fn(),
  findRegistrationFile: vi.fn(),
  confirmRegistrationFile: vi.fn(),
  countStagedFiles: vi.fn(),
  stageRegistrationFile: vi.fn(),
  createRegistrationSession: vi.fn(),
  markSessionSubmitted: vi.fn(),
  attachRegistrationFiles: vi.fn(),
  insertCandidateAnswer: vi.fn(),
  insertCandidateAnswerOptions: vi.fn(),
}));

vi.mock('../src/repositories/candidate-registration.repo.js', () => repo);

const { createCandidateRegistrationService } = await import(
  '../src/services/candidate-registration.service.js'
);

const SESSION_ID = '00000000-0000-4000-8000-000000000901';
const FILE_ID = '00000000-0000-4000-8000-000000000902';

function openSession() {
  return {
    id: SESSION_ID,
    candidateId: null,
    submittedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

function makeService(storage: Partial<SupabaseStoragePort>) {
  return createCandidateRegistrationService({
    db: {} as Db,
    formService: {} as CandidateRegistrationFormService,
    storage: storage as SupabaseStoragePort,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getRegistrationSession.mockResolvedValue(openSession());
});

describe('confirmUpload verifies the object exists', () => {
  it('rejects a file that was never uploaded, and does NOT confirm it', async () => {
    repo.findRegistrationFile.mockResolvedValue({
      id: FILE_ID,
      storagePath: 'registrations/s/never-uploaded.pdf',
      sizeBytes: 1024,
      confirmedAt: null,
    });
    const statObject = vi.fn().mockResolvedValue(null); // not in Storage
    const service = makeService({ statObject });

    await expect(service.confirmUpload(SESSION_ID, FILE_ID)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    // The whole point: the row must not be marked confirmed, or the submit
    // path would promote a candidate_files row pointing at nothing.
    expect(repo.confirmRegistrationFile).not.toHaveBeenCalled();
    expect(statObject).toHaveBeenCalledWith('registrations/s/never-uploaded.pdf');
  });

  it('rejects when the uploaded size does not match the declared size', async () => {
    repo.findRegistrationFile.mockResolvedValue({
      id: FILE_ID,
      storagePath: 'registrations/s/cv.pdf',
      sizeBytes: 1024,
      confirmedAt: null,
    });
    const service = makeService({
      statObject: vi.fn().mockResolvedValue({ sizeBytes: 9_999_999, mimeType: null }),
    });

    await expect(service.confirmUpload(SESSION_ID, FILE_ID)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(repo.confirmRegistrationFile).not.toHaveBeenCalled();
  });

  it('confirms when the object exists at the declared size', async () => {
    repo.findRegistrationFile.mockResolvedValue({
      id: FILE_ID,
      storagePath: 'registrations/s/cv.pdf',
      sizeBytes: 1024,
      confirmedAt: null,
    });
    repo.confirmRegistrationFile.mockResolvedValue(true);
    const service = makeService({
      statObject: vi.fn().mockResolvedValue({ sizeBytes: 1024, mimeType: 'application/pdf' }),
    });

    await expect(service.confirmUpload(SESSION_ID, FILE_ID)).resolves.toEqual({
      confirmed: true,
    });
    expect(repo.confirmRegistrationFile).toHaveBeenCalledWith({}, SESSION_ID, FILE_ID);
  });

  it('is idempotent — a second confirm does not re-stat or re-write', async () => {
    repo.findRegistrationFile.mockResolvedValue({
      id: FILE_ID,
      storagePath: 'registrations/s/cv.pdf',
      sizeBytes: 1024,
      confirmedAt: new Date(),
    });
    const statObject = vi.fn();
    const service = makeService({ statObject });

    await expect(service.confirmUpload(SESSION_ID, FILE_ID)).resolves.toEqual({
      confirmed: true,
    });
    expect(statObject).not.toHaveBeenCalled();
    expect(repo.confirmRegistrationFile).not.toHaveBeenCalled();
  });

  it('404s for a file id that does not belong to the session', async () => {
    repo.findRegistrationFile.mockResolvedValue(null);
    const service = makeService({ statObject: vi.fn() });

    await expect(service.confirmUpload(SESSION_ID, FILE_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('still refuses an expired session before touching the file', async () => {
    repo.getRegistrationSession.mockResolvedValue({
      ...openSession(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const service = makeService({ statObject: vi.fn() });

    await expect(service.confirmUpload(SESSION_ID, FILE_ID)).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(repo.findRegistrationFile).not.toHaveBeenCalled();
  });
});

describe('createUploadUrl caps staged files per session', () => {
  const body = {
    fileType: 'cv' as const,
    originalFilename: 'cv.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  };

  it('refuses an eleventh upload and never mints a signed URL', async () => {
    repo.countStagedFiles.mockResolvedValue(10);
    const createSignedUploadUrl = vi.fn();
    const service = makeService({ createSignedUploadUrl });

    await expect(service.createUploadUrl(SESSION_ID, body)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
    expect(repo.stageRegistrationFile).not.toHaveBeenCalled();
  });

  it('allows the tenth upload', async () => {
    repo.countStagedFiles.mockResolvedValue(9);
    repo.stageRegistrationFile.mockResolvedValue({ id: FILE_ID });
    const service = makeService({
      createSignedUploadUrl: vi
        .fn()
        .mockResolvedValue({ url: 'https://storage.test/signed', token: 'tok' }),
    });

    const result = await service.createUploadUrl(SESSION_ID, body);
    expect(result.fileId).toBe(FILE_ID);
    expect(repo.stageRegistrationFile).toHaveBeenCalledOnce();
  });
});
