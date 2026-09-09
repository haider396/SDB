/**
 * Candidate Form Builder service — the activation gate.
 *
 * Activation is the moment a form becomes public, so every way a form can be
 * broken has to be caught here rather than by a candidate mid-submission. These
 * tests pin each refusal, and the message an admin actually sees.
 *
 * The repository is mocked: the SQL is exercised against real Postgres by the
 * migration validation, and what needs testing here is the rules.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/lib/db.js';

const repo = vi.hoisted(() => ({
  listForms: vi.fn(),
  getForm: vi.fn(),
  getDefaultForm: vi.fn(),
  insertForm: vi.fn(),
  updateForm: vi.fn(),
  setFormStatus: vi.fn(),
  archiveForm: vi.fn(),
  insertVersion: vi.fn(),
  getVersion: vi.fn(),
  getDraftVersion: vi.fn(),
  updateVersionContent: vi.fn(),
  markVersionPublished: vi.fn(),
  getBlocks: vi.fn(),
  insertBlock: vi.fn(),
  updateBlock: vi.fn(),
  deleteBlock: vi.fn(),
  deleteAllBlocks: vi.fn(),
  getReferencedQuestions: vi.fn(),
  listFormsUsingQuestion: vi.fn(),
  listFormKeys: vi.fn(),
}));
vi.mock('../src/repositories/candidate-forms.repo.js', () => repo);

const events = vi.hoisted(() => ({ emitEvent: vi.fn() }));
vi.mock('../src/services/events.js', () => events);

const { createCandidateFormsService } = await import(
  '../src/services/candidate-forms.service.js'
);

const FORM_ID = '00000000-0000-4000-8000-000000000801';
const VERSION_ID = '00000000-0000-4000-8000-000000000802';
const RC_ID = '00000000-0000-4000-8000-000000000803';
const Q_EMAIL = '00000000-0000-4000-8000-000000000811';
const Q_COUNTRY = '00000000-0000-4000-8000-000000000812';
const Q_FIRST_NAME = '00000000-0000-4000-8000-000000000813';
const Q_LAST_NAME = '00000000-0000-4000-8000-000000000814';

const actor = { userId: '00000000-0000-4000-8000-000000000101', role: 'admin' as const };

/** `db.begin(fn)` is all withTransaction needs; pass the same stub through. */
const db = {
  begin: (fn: (tx: unknown) => unknown) => fn(db),
} as unknown as Db;

const invalidateFormCache = vi.fn();
const service = createCandidateFormsService({ db, invalidateFormCache });

function form(overrides: Record<string, unknown> = {}) {
  return {
    id: FORM_ID,
    slug: 'abc123def456',
    key: 'video_editor',
    label: 'Video Editor',
    description: null,
    roleCategoryId: RC_ID,
    roleCategoryKey: 'video_editor',
    roleCategoryLabel: 'Video Editor',
    hasTypingTest: false,
    hasDocumentsStep: false,
    isDefault: false,
    status: 'draft' as const,
    publishedVersionId: null,
    activatedAt: null,
    deactivatedAt: null,
    createdAt: new Date('2026-09-04T00:00:00Z'),
    updatedAt: new Date('2026-09-04T00:00:00Z'),
    archivedAt: null,
    submissionCount: 0,
    ...overrides,
  };
}

function draft() {
  return {
    id: VERSION_ID,
    formId: FORM_ID,
    versionNumber: 1,
    pages: [{ index: 0, title: 'About you', description: null }],
    theme: {},
    createdAt: new Date('2026-09-04T00:00:00Z'),
    publishedAt: null,
  };
}

function question(overrides: Record<string, unknown> = {}) {
  return {
    questionId: Q_EMAIL,
    key: 'email',
    label: 'Email',
    audience: 'candidate',
    isActive: true,
    isArchived: false,
    conditionalOnQuestionId: null,
    ...overrides,
  };
}

/** Email plus both names — the minimum a form needs to create a candidate. */
function identityQuestions() {
  return [
    question(),
    question({ questionId: Q_FIRST_NAME, key: 'first_name' }),
    question({ questionId: Q_LAST_NAME, key: 'last_name' }),
  ];
}

/** Run activate() and return the `details.fields` an admin would be shown. */
async function activateFields(): Promise<Record<string, string>> {
  try {
    await service.activate(FORM_ID, actor);
    throw new Error('activation was ACCEPTED but should have been refused');
  } catch (error) {
    const apiError = error as { code?: string; details?: { fields?: Record<string, string> } };
    if (apiError.code !== 'VALIDATION_FAILED') throw error;
    return apiError.details?.fields ?? {};
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.getForm.mockResolvedValue(form());
  repo.getDraftVersion.mockResolvedValue(draft());
  repo.getBlocks.mockResolvedValue([]);
  repo.markVersionPublished.mockResolvedValue(true);
  repo.setFormStatus.mockResolvedValue(true);
  events.emitEvent.mockResolvedValue('event-id');
});

describe('activation gate', () => {
  it('refuses a form with no questions', async () => {
    repo.getReferencedQuestions.mockResolvedValue([]);
    const fields = await activateFields();
    expect(fields['blocks']).toMatch(/at least one question/i);
  });

  it('refuses a form that never asks for an email', async () => {
    // Email is the candidate's identity — without it a submission cannot be
    // matched to a person, so de-duplication silently stops working.
    repo.getReferencedQuestions.mockResolvedValue([
      question({ questionId: Q_COUNTRY, key: 'country' }),
    ]);
    const fields = await activateFields();
    expect(fields['email']).toMatch(/email address/i);
    expect(fields['blocks']).toBeUndefined();
  });

  it('refuses a form that never asks for a first and last name', async () => {
    // candidates.first_name and last_name are NOT NULL, so a form that does not
    // collect them activates fine and then dead-ends EVERY new candidate on the
    // final step with 'A last name is required' — naming a field they were
    // never shown, and which they have no way to supply.
    repo.getReferencedQuestions.mockResolvedValue([question()]);
    const fields = await activateFields();
    expect(fields['first_name']).toMatch(/first name/i);
    expect(fields['last_name']).toMatch(/last name/i);
  });

  it('accepts a form that asks for email and both names', async () => {
    repo.getReferencedQuestions.mockResolvedValue(identityQuestions());
    await expect(service.activate(FORM_ID, actor)).resolves.toBeDefined();
  });

  it('refuses a non-default form with no role category', async () => {
    repo.getForm.mockResolvedValue(form({ roleCategoryId: null }));
    repo.getReferencedQuestions.mockResolvedValue([question()]);
    const fields = await activateFields();
    expect(fields['roleCategoryId']).toMatch(/role/i);
  });

  it('allows the DEFAULT form to have no role category', async () => {
    repo.getForm.mockResolvedValue(
      form({ isDefault: true, roleCategoryId: null, roleCategoryKey: null, roleCategoryLabel: null }),
    );
    repo.getReferencedQuestions.mockResolvedValue(identityQuestions());
    await expect(service.activate(FORM_ID, actor)).resolves.toMatchObject({
      publicPath: '/register',
    });
  });

  it('refuses an internal-audience question — AC-IF-02 at build time', async () => {
    repo.getReferencedQuestions.mockResolvedValue([
      question(),
      question({ questionId: Q_COUNTRY, key: 'internal_note', audience: 'internal' }),
    ]);
    const fields = await activateFields();
    expect(fields['questions']).toContain('internal_note');
  });

  it('refuses an archived or deactivated question', async () => {
    repo.getReferencedQuestions.mockResolvedValue([
      question(),
      question({ questionId: Q_COUNTRY, key: 'old_q', isActive: false }),
    ]);
    const fields = await activateFields();
    expect(fields['questions']).toContain('old_q');
  });

  it('refuses a conditional whose controller is not on the form', async () => {
    // It would never become visible, so it is silently unanswerable.
    repo.getReferencedQuestions.mockResolvedValue([
      question(),
      question({
        questionId: Q_COUNTRY,
        key: 'full_time_transition_after',
        conditionalOnQuestionId: '00000000-0000-4000-8000-000000000899',
      }),
    ]);
    const fields = await activateFields();
    expect(fields['conditionals']).toContain('full_time_transition_after');
  });

  it('accepts a conditional whose controller IS on the form', async () => {
    repo.getReferencedQuestions.mockResolvedValue([
      ...identityQuestions(),
      question({
        questionId: Q_COUNTRY,
        key: 'dependent',
        conditionalOnQuestionId: Q_EMAIL,
      }),
    ]);
    await expect(service.activate(FORM_ID, actor)).resolves.toBeTruthy();
  });

  it('reports every problem at once rather than one per attempt', async () => {
    repo.getForm.mockResolvedValue(form({ roleCategoryId: null }));
    repo.getReferencedQuestions.mockResolvedValue([]);
    const fields = await activateFields();
    expect(Object.keys(fields).sort()).toEqual([
      'blocks',
      'email',
      'first_name',
      'last_name',
      'roleCategoryId',
    ]);
  });

  it('refuses when there is no draft to publish', async () => {
    repo.getDraftVersion.mockResolvedValue(null);
    await expect(service.activate(FORM_ID, actor)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('publishes the draft and returns the shareable link on success', async () => {
    repo.getReferencedQuestions.mockResolvedValue(identityQuestions());
    repo.getForm
      .mockResolvedValueOnce(form())
      .mockResolvedValue(form({ status: 'active', publishedVersionId: VERSION_ID }));

    const result = await service.activate(FORM_ID, actor);

    expect(repo.markVersionPublished).toHaveBeenCalledWith(db, VERSION_ID);
    expect(repo.setFormStatus).toHaveBeenCalledWith(db, FORM_ID, 'active', VERSION_ID);
    expect(result.publicPath).toBe('/f/abc123def456');
    expect(result.form.status).toBe('active');
    expect(invalidateFormCache).toHaveBeenCalled();
    expect(events.emitEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ eventType: 'candidate_form_activated', toValue: 'active' }),
    );
  });
});

describe('lifecycle guards', () => {
  it('refuses to delete the default registration form', async () => {
    repo.getForm.mockResolvedValue(form({ isDefault: true, status: 'inactive' }));
    await expect(service.archive(FORM_ID, actor)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect(repo.archiveForm).not.toHaveBeenCalled();
  });

  it('refuses to delete a form whose public link is still live', async () => {
    repo.getForm.mockResolvedValue(form({ status: 'active' }));
    await expect(service.archive(FORM_ID, actor)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('archives an inactive form', async () => {
    repo.getForm.mockResolvedValue(form({ status: 'inactive' }));
    repo.archiveForm.mockResolvedValue(true);
    await expect(service.archive(FORM_ID, actor)).resolves.toBeUndefined();
    expect(repo.archiveForm).toHaveBeenCalledWith(db, FORM_ID);
  });

  it('refuses to deactivate a form that is not active', async () => {
    repo.getForm.mockResolvedValue(form({ status: 'draft' }));
    await expect(service.deactivate(FORM_ID, actor)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('refuses to edit a published version', async () => {
    repo.getVersion.mockResolvedValue({ ...draft(), publishedAt: new Date() });
    await expect(
      service.saveDocument(
        FORM_ID,
        VERSION_ID,
        { pages: [{ index: 0, title: 'X', description: null }], theme: {}, blocks: [] } as never,
        actor,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('refuses a version belonging to a different form', async () => {
    repo.getVersion.mockResolvedValue({ ...draft(), formId: 'other-form' });
    await expect(
      service.addBlock(FORM_ID, VERSION_ID, {} as never, actor),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to clear the role category on a non-default form', async () => {
    await expect(
      service.update(FORM_ID, { roleCategoryId: null }, actor),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repo.updateForm).not.toHaveBeenCalled();
  });
});

/**
 * Naming a form.
 *
 * `candidate_forms.key` is unique across the WHOLE table and delete is a soft
 * delete, so a deleted form keeps owning its key forever. The browser used to
 * derive the key from the label with no knowledge of that, and creating a
 * second "Test" after deleting the first died on a raw 23505 that reached the
 * admin as "An internal error occurred".
 */
describe('form keys are derived and made unique server-side', () => {
  beforeEach(() => {
    repo.insertForm.mockResolvedValue({ id: FORM_ID, slug: 'abc123def456' });
    repo.insertVersion.mockResolvedValue(draft());
    repo.getForm.mockResolvedValue(form());
  });

  async function create(label: string) {
    await service.create({ label, roleCategoryId: RC_ID }, actor);
    return (repo.insertForm.mock.calls[0]?.[1] as { key: string }).key;
  }

  it('derives the key from the label when none is supplied', async () => {
    repo.listFormKeys.mockResolvedValue([]);
    expect(await create('Video Editor')).toBe('video_editor');
  });

  it('steps around a key an ARCHIVED form still owns', async () => {
    // The exact reported bug: delete "Test", create "Test" again.
    repo.listFormKeys.mockResolvedValue(['test']);
    expect(await create('Test')).toBe('test_2');
  });

  it('keeps counting past several deleted namesakes', async () => {
    repo.listFormKeys.mockResolvedValue(['test', 'test_2', 'test_3']);
    expect(await create('Test')).toBe('test_4');
  });

  it('produces a valid identifier from an awkward name', async () => {
    repo.listFormKeys.mockResolvedValue([]);
    // Leading digits, punctuation and runs of separators would all break the
    // key regex if passed through untouched.
    expect(await create('  2026 — Video/Editor!!  ')).toBe('form_2026_video_editor');
  });

  it('falls back rather than emitting an empty key', async () => {
    repo.listFormKeys.mockResolvedValue([]);
    expect(await create('!!!')).toBe('form');
  });

  it('records the key it actually used in the event', async () => {
    repo.listFormKeys.mockResolvedValue(['test']);
    await create('Test');
    const emitted = events.emitEvent.mock.calls
      .map((call) => call[1] as { eventType: string; metadata?: { key?: string } })
      .find((entry) => entry.eventType === 'candidate_form_created');
    expect(emitted?.metadata?.key).toBe('test_2');
  });

  it('turns a racing duplicate into a message about the name', async () => {
    // Two admins, same name, same instant: the dedupe above cannot see the
    // other transaction, so the constraint fires and must read sensibly.
    repo.listFormKeys.mockResolvedValue([]);
    repo.insertForm.mockRejectedValue(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint_name: 'candidate_forms_key_key',
      }),
    );
    await expect(
      service.create({ label: 'Test', roleCategoryId: RC_ID }, actor),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: { label: 'That name is taken.' } },
    });
  });
});

/**
 * Starting a form FROM a template.
 *
 * The typing test and the documents step are form-level flags, not blocks, so
 * the block copy carried neither. "Start from → Candidate registration"
 * therefore produced a form whose canvas looked identical to the template's
 * and which never asked a candidate for a CV or ran the typing test — invisible
 * from the builder, because every block really had been copied.
 */
describe('create from a template', () => {
  const TEMPLATE_ID = '00000000-0000-4000-8000-000000000901';

  /** Wire the repo up as if TEMPLATE_ID were a published form with the flags on. */
  function templateWithFlags(
    flags: { hasTypingTest: boolean; hasDocumentsStep: boolean },
  ): void {
    repo.listFormKeys.mockResolvedValue([]);
    repo.getBlocks.mockResolvedValue([]);
    repo.insertForm.mockImplementation((_tx: unknown, input: unknown) =>
      Promise.resolve({ ...form(), ...(input as object), id: FORM_ID }),
    );
    repo.insertVersion.mockResolvedValue(draft());
    repo.getVersion.mockResolvedValue(draft());
    repo.getForm.mockImplementation((_db: unknown, id: string) =>
      Promise.resolve(
        id === TEMPLATE_ID
          ? form({ id: TEMPLATE_ID, publishedVersionId: VERSION_ID, ...flags })
          : form(),
      ),
    );
  }

  it('inherits the typing test and documents steps from the template', async () => {
    templateWithFlags({ hasTypingTest: true, hasDocumentsStep: true });

    await service.create(
      { label: 'Copy of registration', roleCategoryId: RC_ID, templateFormId: TEMPLATE_ID },
      actor,
    );

    expect(repo.insertForm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hasTypingTest: true, hasDocumentsStep: true }),
    );
  });

  it('lets an explicit false switch a template step off', async () => {
    // `??` not `||`: false is a real choice, not a missing value.
    templateWithFlags({ hasTypingTest: true, hasDocumentsStep: true });

    await service.create(
      {
        label: 'No typing test',
        roleCategoryId: RC_ID,
        templateFormId: TEMPLATE_ID,
        hasTypingTest: false,
      },
      actor,
    );

    expect(repo.insertForm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hasTypingTest: false, hasDocumentsStep: true }),
    );
  });

  it('leaves both off for a form built from scratch', async () => {
    repo.listFormKeys.mockResolvedValue([]);
    repo.getForm.mockResolvedValue(form());
    repo.insertForm.mockImplementation((_tx: unknown, input: unknown) =>
      Promise.resolve({ ...form(), ...(input as object), id: FORM_ID }),
    );
    repo.insertVersion.mockResolvedValue(draft());

    await service.create({ label: 'From scratch', roleCategoryId: RC_ID }, actor);

    expect(repo.insertForm).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ hasTypingTest: false, hasDocumentsStep: false }),
    );
  });
});
