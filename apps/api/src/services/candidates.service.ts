/**
 * Candidate business rules (docs/04-API.md §8). No HTTP types, no SQL.
 *
 * Access model:
 * - /candidates* is an ADMIN surface. Client-scoped callers hold
 *   `candidate.view` (for the P5 client portal served via
 *   client_visible_assignments), but the internal pool is never theirs:
 *   list() returns an empty page and every other read/write is a 404 —
 *   never data (CLAUDE.md rule 3; 04 §8 "Admin only").
 * - `data_completeness` is server-computed against the required-field set in
 *   services/data-completeness.ts on every core write.
 * - Every state change writes an events row in the same transaction
 *   (CLAUDE.md rule 6).
 * - `source` is always set explicitly on insert (defective 0007 default).
 */
import type {
  Candidate,
  CandidateConsentBody,
  CandidateDetail,
  CreateCandidateAssessmentBody,
  CreateCandidateBody,
  CreateCandidateEducationBody,
  CreateCandidateEmploymentBody,
  CreateCandidateCertificationBody,
  CreateCandidateLanguageBody,
  CreateCandidateNoteBody,
  CreateCandidateReferenceBody,
  ListCandidatesQuery,
  PutCandidateSkillsBody,
  PutCandidateToolsBody,
  PutDisqualifierChecksBody,
  UpdateCandidateBody,
  UpdateCandidateEducationBody,
  UpdateCandidateEmploymentBody,
  UpdateCandidateCertificationBody,
  UpdateCandidateLanguageBody,
  UpdateCandidateReferenceBody,
  UserRoleKey,
  CandidateLanguage,
  CandidateTool,
  CandidateSkill,
  CandidateEmployment,
  CandidateEducation,
  CandidateCertification,
  CandidateReference,
  CandidateNote,
  CandidateDisqualifierCheck,
  CandidateAssessment,
} from '@sdb/contracts';
import { ACCENT_STRENGTH_ORDER } from '@sdb/contracts';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { withTransaction, type Db, type Tx } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import * as repo from '../repositories/candidates.repo.js';
import { listFiles } from '../repositories/candidate-files.repo.js';
import { computeDataCompleteness } from './data-completeness.js';
import { emitEvent } from './events.js';

export interface CandidateActor {
  userId: string;
  role: UserRoleKey | null;
  /** Membership-derived scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
}

export interface CandidatesServiceDeps {
  db: Db;
}

interface PgError {
  code?: string;
  constraint_name?: string;
}

/** Map FK/unique violations on child writes to a 422, not a 500. */
function mapChildWriteError(error: unknown): never {
  const pg = error as PgError;
  if (pg.code === '23503') {
    throw new ApiError('VALIDATION_FAILED', 'A referenced record does not exist.');
  }
  if (pg.code === '23505') {
    throw new ApiError('VALIDATION_FAILED', 'This entry already exists.');
  }
  throw error;
}

export interface CandidatesService {
  list(
    query: ListCandidatesQuery,
    actor: CandidateActor,
  ): Promise<{ data: Candidate[]; nextCursor: string | null }>;
  create(body: CreateCandidateBody, actor: CandidateActor): Promise<Candidate>;
  get(candidateId: string, actor: CandidateActor): Promise<CandidateDetail>;
  update(
    candidateId: string,
    body: UpdateCandidateBody,
    actor: CandidateActor,
  ): Promise<Candidate>;
  archive(candidateId: string, actor: CandidateActor): Promise<Candidate>;
  captureConsent(
    candidateId: string,
    body: CandidateConsentBody,
    actor: CandidateActor,
  ): Promise<Candidate>;

  listLanguages(candidateId: string, actor: CandidateActor): Promise<CandidateLanguage[]>;
  addLanguage(
    candidateId: string,
    body: CreateCandidateLanguageBody,
    actor: CandidateActor,
  ): Promise<CandidateLanguage[]>;
  updateLanguage(
    candidateId: string,
    languageId: string,
    body: UpdateCandidateLanguageBody,
    actor: CandidateActor,
  ): Promise<CandidateLanguage[]>;
  removeLanguage(
    candidateId: string,
    languageId: string,
    actor: CandidateActor,
  ): Promise<void>;

  listTools(candidateId: string, actor: CandidateActor): Promise<CandidateTool[]>;
  replaceTools(
    candidateId: string,
    body: PutCandidateToolsBody,
    actor: CandidateActor,
  ): Promise<CandidateTool[]>;
  listSkills(candidateId: string, actor: CandidateActor): Promise<CandidateSkill[]>;
  replaceSkills(
    candidateId: string,
    body: PutCandidateSkillsBody,
    actor: CandidateActor,
  ): Promise<CandidateSkill[]>;

  listEmployment(candidateId: string, actor: CandidateActor): Promise<CandidateEmployment[]>;
  addEmployment(
    candidateId: string,
    body: CreateCandidateEmploymentBody,
    actor: CandidateActor,
  ): Promise<CandidateEmployment[]>;
  updateEmployment(
    candidateId: string,
    entryId: string,
    body: UpdateCandidateEmploymentBody,
    actor: CandidateActor,
  ): Promise<CandidateEmployment[]>;
  removeEmployment(
    candidateId: string,
    entryId: string,
    actor: CandidateActor,
  ): Promise<void>;

  listEducation(candidateId: string, actor: CandidateActor): Promise<CandidateEducation[]>;
  addEducation(
    candidateId: string,
    body: CreateCandidateEducationBody,
    actor: CandidateActor,
  ): Promise<CandidateEducation[]>;
  updateEducation(
    candidateId: string,
    entryId: string,
    body: UpdateCandidateEducationBody,
    actor: CandidateActor,
  ): Promise<CandidateEducation[]>;
  removeEducation(
    candidateId: string,
    entryId: string,
    actor: CandidateActor,
  ): Promise<void>;

  listCertifications(
    candidateId: string,
    actor: CandidateActor,
  ): Promise<CandidateCertification[]>;
  addCertification(
    candidateId: string,
    body: CreateCandidateCertificationBody,
    actor: CandidateActor,
  ): Promise<CandidateCertification[]>;
  updateCertification(
    candidateId: string,
    entryId: string,
    body: UpdateCandidateCertificationBody,
    actor: CandidateActor,
  ): Promise<CandidateCertification[]>;
  removeCertification(
    candidateId: string,
    entryId: string,
    actor: CandidateActor,
  ): Promise<void>;

  listReferences(candidateId: string, actor: CandidateActor): Promise<CandidateReference[]>;
  addReference(
    candidateId: string,
    body: CreateCandidateReferenceBody,
    actor: CandidateActor,
  ): Promise<CandidateReference[]>;
  updateReference(
    candidateId: string,
    entryId: string,
    body: UpdateCandidateReferenceBody,
    actor: CandidateActor,
  ): Promise<CandidateReference[]>;
  removeReference(
    candidateId: string,
    entryId: string,
    actor: CandidateActor,
  ): Promise<void>;

  listNotes(candidateId: string, actor: CandidateActor): Promise<CandidateNote[]>;
  addNote(
    candidateId: string,
    body: CreateCandidateNoteBody,
    actor: CandidateActor,
  ): Promise<CandidateNote[]>;

  listDisqualifierChecks(
    candidateId: string,
    actor: CandidateActor,
  ): Promise<CandidateDisqualifierCheck[]>;
  putDisqualifierChecks(
    candidateId: string,
    body: PutDisqualifierChecksBody,
    actor: CandidateActor,
  ): Promise<CandidateDisqualifierCheck[]>;

  listAssessments(candidateId: string, actor: CandidateActor): Promise<CandidateAssessment[]>;
  addAssessment(
    candidateId: string,
    body: CreateCandidateAssessmentBody,
    actor: CandidateActor,
  ): Promise<CandidateAssessment[]>;
}

export function createCandidatesService(
  deps: CandidatesServiceDeps,
): CandidatesService {
  const { db } = deps;

  /** The internal pool is admin-only; a client-scoped caller sees nothing. */
  function assertAdminSurface(actor: CandidateActor): void {
    if (actor.ownClientId !== null) {
      throw new ApiError('NOT_FOUND', 'Resource not found.');
    }
  }

  async function requireCandidate(
    sql: Db | Tx,
    candidateId: string,
  ): Promise<Candidate> {
    const candidate = await repo.findCandidateById(sql, candidateId);
    if (candidate === null) {
      throw new ApiError('NOT_FOUND', 'Candidate not found.');
    }
    return candidate;
  }

  async function emitChildEvent(
    tx: Tx,
    candidateId: string,
    actor: CandidateActor,
    collection: string,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await emitEvent(tx, {
      entityType: 'candidate',
      entityId: candidateId,
      eventType: `${collection}_${action}`,
      actorId: actor.userId,
      actorRole: actor.role,
      metadata,
    });
  }

  /** Recompute data_completeness after a core-field write. */
  async function refreshCompleteness(
    tx: Tx,
    candidate: Candidate,
    actor: CandidateActor,
  ): Promise<void> {
    const computed = computeDataCompleteness(candidate);
    if (computed !== candidate.dataCompleteness) {
      await repo.updateCandidate(tx, candidate.id, { dataCompleteness: computed });
      await emitEvent(tx, {
        entityType: 'candidate',
        entityId: candidate.id,
        eventType: 'data_completeness_changed',
        actorId: actor.userId,
        actorRole: actor.role,
        fromValue: candidate.dataCompleteness,
        toValue: computed,
      });
      candidate.dataCompleteness = computed;
    }
  }

  return {
    async list(query, actor) {
      if (actor.ownClientId !== null) {
        // Client callers hold candidate.view for the P5 portal surface, not
        // the pool: an empty page, never internal candidates (rule 3).
        return { data: [], nextCursor: null };
      }
      const accentCeiling = query.maxAccentStrength;
      const filters: repo.ListCandidatesFilters = {
        limit: query.limit,
        ...(query.search !== undefined ? { search: query.search } : {}),
        ...(query.roleCategoryId !== undefined
          ? { roleCategoryId: query.roleCategoryId }
          : {}),
        ...(query.engineId !== undefined ? { engineId: query.engineId } : {}),
        ...(query.country !== undefined ? { country: query.country } : {}),
        ...(query.englishSpokenLevel !== undefined
          ? { englishSpokenLevel: query.englishSpokenLevel }
          : {}),
        ...(accentCeiling !== undefined
          ? {
              accentStrengths: ACCENT_STRENGTH_ORDER.slice(
                0,
                ACCENT_STRENGTH_ORDER.indexOf(accentCeiling) + 1,
              ) as unknown as string[],
            }
          : {}),
        ...(query.poolStatus !== undefined ? { poolStatus: query.poolStatus } : {}),
        ...(query.vettingStatus !== undefined
          ? { vettingStatus: query.vettingStatus }
          : {}),
        ...(query.availableFrom !== undefined
          ? { availableFrom: query.availableFrom }
          : {}),
        ...(query.rateMax !== undefined && query.rateUnit !== undefined
          ? { rateMax: query.rateMax, rateUnit: query.rateUnit }
          : {}),
        ...(query.toolIds !== undefined ? { toolIds: query.toolIds } : {}),
        ...(query.dataCompleteness !== undefined
          ? { dataCompleteness: query.dataCompleteness }
          : {}),
        ...(query.cursor !== undefined
          ? { cursor: decodeCursor(query.cursor) }
          : {}),
      };
      const data = await repo.listCandidates(db, filters);
      const last = data[data.length - 1];
      const nextCursor =
        data.length === query.limit && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;
      return { data, nextCursor };
    },

    async create(body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        const { firstName, lastName, source, externalId, ...rest } = body;
        const candidate = await repo.insertCandidate(tx, {
          firstName,
          lastName,
          // Explicit always — never the (historically defective) column default.
          source: source ?? 'other',
          submittedVia: 'manual',
          dataCompleteness: computeDataCompleteness(body),
          externalId: externalId ?? null,
          fields: rest,
        });
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidate.id,
          eventType: 'candidate_created',
          actorId: actor.userId,
          actorRole: actor.role,
          toValue: candidate.reference,
          metadata: { submittedVia: 'manual', source: candidate.source },
        });
        return candidate;
      });
    },

    async get(candidateId, actor) {
      assertAdminSurface(actor);
      const candidate = await requireCandidate(db, candidateId);
      const [
        languages,
        tools,
        skills,
        employmentHistory,
        education,
        certifications,
        references,
        notes,
        disqualifierChecks,
        assessments,
        files,
      ] = await Promise.all([
        repo.listLanguages(db, candidateId),
        repo.listTools(db, candidateId),
        repo.listSkills(db, candidateId),
        repo.listEmployment(db, candidateId),
        repo.listEducation(db, candidateId),
        repo.listCertifications(db, candidateId),
        repo.listReferences(db, candidateId),
        repo.listNotes(db, candidateId),
        repo.listDisqualifierChecks(db, candidateId),
        repo.listAssessments(db, candidateId),
        listFiles(db, candidateId),
      ]);
      return {
        ...candidate,
        languages,
        tools,
        skills,
        employmentHistory,
        education,
        certifications,
        references,
        notes,
        disqualifierChecks,
        assessments,
        files,
      };
    },

    async update(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        const existing = await requireCandidate(tx, candidateId);
        const updated = await repo.updateCandidate(
          tx,
          candidateId,
          body as Record<string, unknown>,
        );
        if (!updated) throw new ApiError('NOT_FOUND', 'Candidate not found.');
        const changedKeys = Object.keys(body).filter(
          (key) => body[key as keyof UpdateCandidateBody] !== undefined,
        );
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidateId,
          eventType: 'candidate_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { changedKeys },
        });
        if (
          existing.vettingStatus !== undefined &&
          body.vettingStatus !== undefined &&
          body.vettingStatus !== existing.vettingStatus
        ) {
          await emitEvent(tx, {
            entityType: 'candidate',
            entityId: candidateId,
            eventType: 'vetting_status_changed',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: existing.vettingStatus,
            toValue: body.vettingStatus,
          });
        }
        if (body.poolStatus !== undefined && body.poolStatus !== existing.poolStatus) {
          await emitEvent(tx, {
            entityType: 'candidate',
            entityId: candidateId,
            eventType: 'pool_status_changed',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: existing.poolStatus,
            toValue: body.poolStatus,
          });
        }
        const fresh = await requireCandidate(tx, candidateId);
        await refreshCompleteness(tx, fresh, actor);
        // Changing a cv_search source column makes migration 0010's trigger
        // rebuild the tsvector WITHOUT the appended CV text — re-queue
        // extraction so the 2-minute job restores it (see jobs/extract-cv-text).
        const cvSearchSourceKeys = [
          'firstName',
          'lastName',
          'preferredName',
          'currentTitle',
          'strengths',
        ];
        if (
          fresh.cvPrimaryFileId !== null &&
          changedKeys.some((key) => cvSearchSourceKeys.includes(key))
        ) {
          const files = await listFiles(tx, candidateId);
          const primary = files.find(
            (file) =>
              file.id === fresh.cvPrimaryFileId &&
              file.virusScanStatus === 'complete',
          );
          if (primary !== undefined) {
            await emitEvent(tx, {
              entityType: 'candidate',
              entityId: candidateId,
              eventType: 'cv_text_extraction_queued',
              actorId: actor.userId,
              actorRole: actor.role,
              metadata: { fileId: primary.id, via: 'cv_search_rebuild' },
            });
          }
        }
        return fresh;
      });
    },

    async archive(candidateId, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const archived = await repo.archiveCandidate(tx, candidateId);
        if (!archived) throw new ApiError('NOT_FOUND', 'Candidate not found.');
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidateId,
          eventType: 'candidate_archived',
          actorId: actor.userId,
          actorRole: actor.role,
        });
        const candidate = await repo.findCandidateById(tx, candidateId, {
          includeArchived: true,
        });
        if (candidate === null) throw new ApiError('NOT_FOUND', 'Candidate not found.');
        return candidate;
      });
    },

    async captureConsent(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        const existing = await requireCandidate(tx, candidateId);
        await repo.setCandidateConsent(tx, candidateId, body);
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidateId,
          eventType: 'consent_captured',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: String(existing.hasConsentToShareProfile),
          toValue: String(body.hasConsentToShareProfile),
          metadata: { consentSource: body.consentSource },
        });
        return requireCandidate(tx, candidateId);
      });
    },

    // --- languages ---------------------------------------------------------

    async listLanguages(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listLanguages(db, candidateId);
    },

    async addLanguage(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        try {
          const id = await repo.insertLanguage(tx, candidateId, body);
          await emitChildEvent(tx, candidateId, actor, 'language', 'added', {
            languageId: id,
            language: body.language,
          });
        } catch (error) {
          mapChildWriteError(error);
        }
        return repo.listLanguages(tx, candidateId);
      });
    },

    async updateLanguage(candidateId, languageId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        let ok: boolean;
        try {
          ok = await repo.updateLanguage(tx, candidateId, languageId, body);
        } catch (error) {
          mapChildWriteError(error);
        }
        if (!ok) throw new ApiError('NOT_FOUND', 'Language entry not found.');
        await emitChildEvent(tx, candidateId, actor, 'language', 'updated', {
          languageId,
        });
        return repo.listLanguages(tx, candidateId);
      });
    },

    async removeLanguage(candidateId, languageId, actor) {
      assertAdminSurface(actor);
      await withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.deleteLanguage(tx, candidateId, languageId);
        if (!ok) throw new ApiError('NOT_FOUND', 'Language entry not found.');
        await emitChildEvent(tx, candidateId, actor, 'language', 'removed', {
          languageId,
        });
      });
    },

    // --- tools / skills (replace-set PUT) ----------------------------------

    async listTools(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listTools(db, candidateId);
    },

    async replaceTools(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        try {
          await repo.replaceTools(tx, candidateId, body.tools);
        } catch (error) {
          mapChildWriteError(error);
        }
        await emitChildEvent(tx, candidateId, actor, 'tools', 'replaced', {
          count: body.tools.length,
        });
        return repo.listTools(tx, candidateId);
      });
    },

    async listSkills(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listSkills(db, candidateId);
    },

    async replaceSkills(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        try {
          await repo.replaceSkills(tx, candidateId, body.skills);
        } catch (error) {
          mapChildWriteError(error);
        }
        await emitChildEvent(tx, candidateId, actor, 'skills', 'replaced', {
          count: body.skills.length,
        });
        return repo.listSkills(tx, candidateId);
      });
    },

    // --- employment history -------------------------------------------------

    async listEmployment(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listEmployment(db, candidateId);
    },

    async addEmployment(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const id = await repo.insertEmployment(
          tx,
          candidateId,
          body as Record<string, unknown>,
        );
        await emitChildEvent(tx, candidateId, actor, 'employment', 'added', {
          entryId: id,
        });
        return repo.listEmployment(tx, candidateId);
      });
    },

    async updateEmployment(candidateId, entryId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.updateEmployment(
          tx,
          candidateId,
          entryId,
          body as Record<string, unknown>,
        );
        if (!ok) throw new ApiError('NOT_FOUND', 'Employment entry not found.');
        await emitChildEvent(tx, candidateId, actor, 'employment', 'updated', {
          entryId,
        });
        return repo.listEmployment(tx, candidateId);
      });
    },

    async removeEmployment(candidateId, entryId, actor) {
      assertAdminSurface(actor);
      await withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.deleteEmployment(tx, candidateId, entryId);
        if (!ok) throw new ApiError('NOT_FOUND', 'Employment entry not found.');
        await emitChildEvent(tx, candidateId, actor, 'employment', 'removed', {
          entryId,
        });
      });
    },

    // --- education ----------------------------------------------------------

    async listEducation(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listEducation(db, candidateId);
    },

    async addEducation(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const id = await repo.insertEducation(
          tx,
          candidateId,
          body as Record<string, unknown>,
        );
        await emitChildEvent(tx, candidateId, actor, 'education', 'added', {
          entryId: id,
        });
        return repo.listEducation(tx, candidateId);
      });
    },

    async updateEducation(candidateId, entryId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.updateEducation(
          tx,
          candidateId,
          entryId,
          body as Record<string, unknown>,
        );
        if (!ok) throw new ApiError('NOT_FOUND', 'Education entry not found.');
        await emitChildEvent(tx, candidateId, actor, 'education', 'updated', {
          entryId,
        });
        return repo.listEducation(tx, candidateId);
      });
    },

    async removeEducation(candidateId, entryId, actor) {
      assertAdminSurface(actor);
      await withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.deleteEducation(tx, candidateId, entryId);
        if (!ok) throw new ApiError('NOT_FOUND', 'Education entry not found.');
        await emitChildEvent(tx, candidateId, actor, 'education', 'removed', {
          entryId,
        });
      });
    },

    // --- certifications -----------------------------------------------------

    async listCertifications(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listCertifications(db, candidateId);
    },

    async addCertification(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const id = await repo.insertCertification(
          tx,
          candidateId,
          body as Record<string, unknown>,
        );
        await emitChildEvent(tx, candidateId, actor, 'certification', 'added', {
          entryId: id,
        });
        return repo.listCertifications(tx, candidateId);
      });
    },

    async updateCertification(candidateId, entryId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.updateCertification(
          tx,
          candidateId,
          entryId,
          body as Record<string, unknown>,
        );
        if (!ok) throw new ApiError('NOT_FOUND', 'Certification not found.');
        await emitChildEvent(tx, candidateId, actor, 'certification', 'updated', {
          entryId,
        });
        return repo.listCertifications(tx, candidateId);
      });
    },

    async removeCertification(candidateId, entryId, actor) {
      assertAdminSurface(actor);
      await withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.deleteCertification(tx, candidateId, entryId);
        if (!ok) throw new ApiError('NOT_FOUND', 'Certification not found.');
        await emitChildEvent(tx, candidateId, actor, 'certification', 'removed', {
          entryId,
        });
      });
    },

    // --- references ---------------------------------------------------------

    async listReferences(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listReferences(db, candidateId);
    },

    async addReference(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const id = await repo.insertReference(
          tx,
          candidateId,
          body as Record<string, unknown>,
          actor.userId,
        );
        await emitChildEvent(tx, candidateId, actor, 'reference', 'added', {
          entryId: id,
        });
        return repo.listReferences(tx, candidateId);
      });
    },

    async updateReference(candidateId, entryId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.updateReference(
          tx,
          candidateId,
          entryId,
          body as Record<string, unknown>,
          actor.userId,
        );
        if (!ok) throw new ApiError('NOT_FOUND', 'Reference not found.');
        await emitChildEvent(tx, candidateId, actor, 'reference', 'updated', {
          entryId,
        });
        return repo.listReferences(tx, candidateId);
      });
    },

    async removeReference(candidateId, entryId, actor) {
      assertAdminSurface(actor);
      await withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const ok = await repo.deleteReference(tx, candidateId, entryId);
        if (!ok) throw new ApiError('NOT_FOUND', 'Reference not found.');
        await emitChildEvent(tx, candidateId, actor, 'reference', 'removed', {
          entryId,
        });
      });
    },

    // --- notes --------------------------------------------------------------

    async listNotes(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listNotes(db, candidateId);
    },

    async addNote(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        const id = await repo.insertNote(tx, candidateId, {
          authorId: actor.userId,
          body: body.body,
          ...(body.isClientVisible !== undefined
            ? { isClientVisible: body.isClientVisible }
            : {}),
        });
        await emitChildEvent(tx, candidateId, actor, 'note', 'added', {
          noteId: id,
          isClientVisible: body.isClientVisible ?? false,
        });
        return repo.listNotes(tx, candidateId);
      });
    },

    // --- disqualifier checks ------------------------------------------------

    async listDisqualifierChecks(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listDisqualifierChecks(db, candidateId);
    },

    async putDisqualifierChecks(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        try {
          for (const check of body.checks) {
            await repo.upsertDisqualifierCheck(tx, candidateId, {
              disqualifierId: check.disqualifierId,
              result: check.result,
              notes: check.notes ?? null,
              checkedBy: actor.userId,
            });
          }
        } catch (error) {
          mapChildWriteError(error);
        }
        await emitChildEvent(tx, candidateId, actor, 'disqualifier_checks', 'updated', {
          count: body.checks.length,
        });
        return repo.listDisqualifierChecks(tx, candidateId);
      });
    },

    // --- assessments (storage only, 04 §8) ----------------------------------

    async listAssessments(candidateId, actor) {
      assertAdminSurface(actor);
      await requireCandidate(db, candidateId);
      return repo.listAssessments(db, candidateId);
    },

    async addAssessment(candidateId, body, actor) {
      assertAdminSurface(actor);
      return withTransaction(db, async (tx) => {
        await requireCandidate(tx, candidateId);
        try {
          const id = await repo.insertAssessment(tx, candidateId, {
            provider: body.provider,
            assessmentType: body.assessmentType ?? null,
            takenAt: body.takenAt ?? null,
            scoreSummary: body.scoreSummary ?? null,
            reportFileId: body.reportFileId ?? null,
            interpretationNotes: body.interpretationNotes ?? null,
            rawPayload: body.rawPayload ?? null,
            interpretedBy: actor.userId,
          });
          await emitChildEvent(tx, candidateId, actor, 'assessment', 'added', {
            assessmentId: id,
            provider: body.provider,
          });
        } catch (error) {
          mapChildWriteError(error);
        }
        return repo.listAssessments(tx, candidateId);
      });
    },
  };
}
