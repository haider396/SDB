/**
 * Candidate Form Builder — business rules.
 *
 * Routes parse and authorise; this file owns the guard rails, the transaction
 * boundaries, and the event writes. Repositories own SQL only.
 *
 * THE ACTIVATION GATE IS THE POINT OF THIS SERVICE. A form goes public the
 * moment it is activated, so every way a form can be broken must be caught
 * here rather than by a candidate mid-submission:
 *
 *   - no questions at all
 *   - no email question — email IS the candidate's identity, so without it a
 *     submission cannot be matched to a person or de-duplicated
 *   - a non-default form with no role category (applicants would be untagged)
 *   - a question that is inactive, archived, or not candidate-audience
 *     (the last is AC-IF-02, enforced at BUILD time as well as read time)
 *   - a conditional question whose controller is not on the form: it would
 *     never become visible, so it is silently unanswerable
 */
import type { Db } from '../lib/db.js';
import { withTransaction } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import type {
  CandidateFormDetail,
  CandidateFormVersion,
  CreateCandidateFormBody,
  CreateFormBlockBody,
  FormBlock,
  FormPage,
  FormTheme,
  ListCandidateFormsQuery,
  SaveFormDocumentBody,
  UpdateCandidateFormBody,
  UpdateFormBlockBody,
} from '@sdb/contracts';
import {
  FormBlockSchema,
  FormPageSchema,
  FormThemeSchema,
  formPublicPath,
} from '@sdb/contracts';
import * as repo from '../repositories/candidate-forms.repo.js';
import { emitEvent } from './events.js';
import type { UserRoleKey } from '@sdb/contracts';

export interface Actor {
  userId: string;
  role: UserRoleKey | null;
}

export interface CandidateFormsServiceDeps {
  db: Db;
  /** Public form cache invalidation — called after every write that can
   *  change what a live link serves. */
  invalidateFormCache: () => void;
}

/** The question key that carries candidate identity. */
const IDENTITY_QUESTION_KEY = 'email';

/** A brand-new form starts with one empty page and the default SDB theme. */
function initialPages(): FormPage[] {
  return [{ index: 0, title: 'About you', description: null }];
}

function iso(value: Date): string {
  return value.toISOString();
}

/**
 * One stored block → the wire shape. Parsed rather than cast: a hand-edited
 * jsonb row must fail loudly here, not render as a broken canvas.
 */
function toBlockShape(block: repo.BlockRecord): FormBlock {
  return FormBlockSchema.parse({
    id: block.id,
    parentBlockId: block.parentBlockId,
    blockType: block.blockType,
    questionId: block.questionId,
    pageIndex: block.pageIndex,
    sortOrder: block.sortOrder,
    layout: block.layout,
    style: block.style,
    props: block.props,
    isRequiredOverride: block.isRequiredOverride,
    labelOverride: block.labelOverride,
    placeholderOverride: block.placeholderOverride,
    helpTextOverride: block.helpTextOverride,
    optionValueOverrides: block.optionValueOverrides,
  });
}

function toVersion(
  version: repo.VersionRecord,
  blocks: repo.BlockRecord[],
): CandidateFormVersion {
  return {
    id: version.id,
    formId: version.formId,
    versionNumber: version.versionNumber,
    // Stored jsonb is parsed defensively: a hand-edited row must surface as a
    // clear error here rather than as a broken canvas in the builder.
    pages: FormPageSchema.array().parse(version.pages),
    theme: FormThemeSchema.parse(version.theme),
    blocks: blocks.map(toBlockShape),
    createdAt: iso(version.createdAt),
    publishedAt: version.publishedAt === null ? null : iso(version.publishedAt),
  };
}

/** The three fields the forms table shows beyond the base row. */
function toSummary(form: repo.FormRecord) {
  return {
    ...toFormShape(form),
    roleCategory:
      form.roleCategoryId === null ||
      form.roleCategoryKey === null ||
      form.roleCategoryLabel === null
        ? null
        : {
            id: form.roleCategoryId,
            key: form.roleCategoryKey,
            label: form.roleCategoryLabel,
          },
    publicPath: formPublicPath({ slug: form.slug, isDefault: form.isDefault }),
    submissionCount: form.submissionCount,
  };
}

function toFormShape(form: repo.FormRecord) {
  return {
    id: form.id,
    slug: form.slug,
    key: form.key,
    label: form.label,
    description: form.description,
    roleCategoryId: form.roleCategoryId,
    hasTypingTest: form.hasTypingTest,
    hasDocumentsStep: form.hasDocumentsStep,
    isDefault: form.isDefault,
    status: form.status,
    publishedVersionId: form.publishedVersionId,
    activatedAt: form.activatedAt === null ? null : iso(form.activatedAt),
    deactivatedAt: form.deactivatedAt === null ? null : iso(form.deactivatedAt),
    createdAt: iso(form.createdAt),
    updatedAt: iso(form.updatedAt),
    archivedAt: form.archivedAt === null ? null : iso(form.archivedAt),
  };
}

export interface CandidateFormsService {
  list(query: ListCandidateFormsQuery): Promise<ReturnType<typeof toSummary>[]>;
  get(id: string): Promise<CandidateFormDetail>;
  create(body: CreateCandidateFormBody, actor: Actor): Promise<CandidateFormDetail>;
  update(
    id: string,
    body: UpdateCandidateFormBody,
    actor: Actor,
  ): Promise<CandidateFormDetail>;
  archive(id: string, actor: Actor): Promise<void>;
  createDraft(id: string, actor: Actor): Promise<CandidateFormVersion>;
  saveDocument(
    id: string,
    versionId: string,
    body: SaveFormDocumentBody,
    actor: Actor,
  ): Promise<CandidateFormVersion>;
  addBlock(
    id: string,
    versionId: string,
    body: CreateFormBlockBody,
    actor: Actor,
  ): Promise<FormBlock>;
  patchBlock(
    id: string,
    versionId: string,
    blockId: string,
    body: UpdateFormBlockBody,
    actor: Actor,
  ): Promise<FormBlock>;
  removeBlock(
    id: string,
    versionId: string,
    blockId: string,
    actor: Actor,
  ): Promise<void>;
  activate(
    id: string,
    actor: Actor,
  ): Promise<{ form: ReturnType<typeof toFormShape>; publicPath: string }>;
  deactivate(id: string, actor: Actor): Promise<ReturnType<typeof toFormShape>>;
}

export function createCandidateFormsService(
  deps: CandidateFormsServiceDeps,
): CandidateFormsService {
  const { db } = deps;

  async function requireForm(id: string): Promise<repo.FormRecord> {
    const form = await repo.getForm(db, id);
    if (form === null || form.archivedAt !== null) {
      throw new ApiError('NOT_FOUND', 'Form not found.');
    }
    return form;
  }

  /**
   * A version must belong to the form AND still be editable. Publishing is
   * one-way: an already-published version is a historical record that
   * submissions point at, so it is never mutated.
   */
  async function requireDraft(
    formId: string,
    versionId: string,
  ): Promise<repo.VersionRecord> {
    const version = await repo.getVersion(db, versionId);
    if (version === null || version.formId !== formId) {
      throw new ApiError('NOT_FOUND', 'Form version not found.');
    }
    if (version.publishedAt !== null) {
      throw new ApiError(
        'INVALID_TRANSITION',
        'This version is published and can no longer be edited. Start a new draft.',
      );
    }
    return version;
  }

  async function detail(form: repo.FormRecord): Promise<CandidateFormDetail> {
    const draft = await repo.getDraftVersion(db, form.id);
    const published =
      form.publishedVersionId === null
        ? null
        : await repo.getVersion(db, form.publishedVersionId);

    return {
      ...toSummary(form),
      draftVersion:
        draft === null ? null : toVersion(draft, await repo.getBlocks(db, draft.id)),
      publishedVersion:
        published === null
          ? null
          : toVersion(published, await repo.getBlocks(db, published.id)),
    };
  }

  return {
    async list(query) {
      const forms = await repo.listForms(db, {
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.roleCategoryId !== undefined
          ? { roleCategoryId: query.roleCategoryId }
          : {}),
        ...(query.includeArchived !== undefined
          ? { includeArchived: query.includeArchived }
          : {}),
      });
      return forms.map(toSummary);
    },

    async get(id) {
      return detail(await requireForm(id));
    },

    async create(body, actor) {
      /**
       * Starting from a template COPIES it. The source form is never touched —
       * the new form gets its own slug, and therefore its own public URL, the
       * moment it is activated.
       */
      let template: {
        pages: unknown;
        theme: unknown;
        blocks: repo.BlockRecord[];
      } | null = null;
      if (body.templateFormId !== undefined) {
        const source = await repo.getForm(db, body.templateFormId);
        if (source === null || source.archivedAt !== null) {
          throw new ApiError('NOT_FOUND', 'That template no longer exists.');
        }
        // Prefer what the template actually serves; fall back to its draft so a
        // never-published form can still be copied.
        const sourceVersion =
          source.publishedVersionId === null
            ? await repo.getDraftVersion(db, source.id)
            : await repo.getVersion(db, source.publishedVersionId);
        if (sourceVersion === null) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'That template has nothing to copy yet.',
          );
        }
        template = {
          pages: sourceVersion.pages,
          theme: sourceVersion.theme,
          blocks: await repo.getBlocks(db, sourceVersion.id),
        };
      }

      const created = await withTransaction(db, async (tx) => {
        const form = await repo.insertForm(tx, {
          key: body.key,
          label: body.label,
          description: body.description ?? null,
          roleCategoryId: body.roleCategoryId ?? null,
          hasTypingTest: body.hasTypingTest ?? false,
          hasDocumentsStep: body.hasDocumentsStep ?? false,
          createdBy: actor.userId,
        });
        // Every form starts with an editable draft, so the builder never has
        // to special-case "no version yet".
        const version = await repo.insertVersion(tx, {
          formId: form.id,
          pages: template?.pages ?? initialPages(),
          theme: template?.theme ?? FormThemeSchema.parse({}),
          createdBy: actor.userId,
        });
        for (const block of template?.blocks ?? []) {
          await repo.insertBlock(tx, version.id, {
            // New ids: the copy is independent, and uq_form_blocks_question is
            // per version so the same question may appear on both forms.
            parentBlockId: null,
            blockType: block.blockType,
            questionId: block.questionId,
            pageIndex: block.pageIndex,
            sortOrder: block.sortOrder,
            layout: block.layout,
            style: block.style,
            props: block.props,
            isRequiredOverride: block.isRequiredOverride,
            labelOverride: block.labelOverride,
            placeholderOverride: block.placeholderOverride,
            helpTextOverride: block.helpTextOverride,
            optionValueOverrides: block.optionValueOverrides,
          });
        }
        await emitEvent(tx, {
          entityType: 'candidate_form',
          entityId: form.id,
          eventType: 'candidate_form_created',
          actorId: actor.userId,
          actorRole: actor.role,
          toValue: 'draft',
          metadata: {
            key: body.key,
            label: body.label,
            ...(body.templateFormId !== undefined
              ? { copiedFrom: body.templateFormId, blockCount: template?.blocks.length ?? 0 }
              : {}),
          },
        });
        return form;
      });
      return detail(await requireForm(created.id));
    },

    async update(id, body, actor) {
      const form = await requireForm(id);
      // The check constraint would catch this, but a 23514 surfaces as a 500;
      // an admin clearing the role category deserves a real message.
      if (body.roleCategoryId === null && !form.isDefault) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'A form must be linked to a role.',
          { fields: { roleCategoryId: 'Choose the role this form is for.' } },
        );
      }
      await withTransaction(db, async (tx) => {
        const patched = await repo.updateForm(tx, id, body);
        if (!patched) throw new ApiError('NOT_FOUND', 'Form not found.');
        await emitEvent(tx, {
          entityType: 'candidate_form',
          entityId: id,
          eventType: 'candidate_form_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { changed: Object.keys(body) },
        });
      });
      deps.invalidateFormCache();
      return detail(await requireForm(id));
    },

    async archive(id, actor) {
      const form = await requireForm(id);
      if (form.isDefault) {
        throw new ApiError(
          'INVALID_TRANSITION',
          'The default registration form cannot be deleted.',
        );
      }
      if (form.status === 'active') {
        throw new ApiError(
          'INVALID_TRANSITION',
          'Deactivate the form before deleting it, so the public link stops working first.',
        );
      }
      await withTransaction(db, async (tx) => {
        const archived = await repo.archiveForm(tx, id);
        if (!archived) throw new ApiError('NOT_FOUND', 'Form not found.');
        await emitEvent(tx, {
          entityType: 'candidate_form',
          entityId: id,
          eventType: 'candidate_form_archived',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: form.status,
          toValue: 'archived',
        });
      });
      deps.invalidateFormCache();
    },

    /** Start editing an active form: copy the published blocks into a draft. */
    async createDraft(id, actor) {
      const form = await requireForm(id);
      const existing = await repo.getDraftVersion(db, id);
      if (existing !== null) {
        return toVersion(existing, await repo.getBlocks(db, existing.id));
      }
      const source =
        form.publishedVersionId === null
          ? null
          : await repo.getVersion(db, form.publishedVersionId);

      const draft = await withTransaction(db, async (tx) => {
        const version = await repo.insertVersion(tx, {
          formId: id,
          pages: source?.pages ?? initialPages(),
          theme: source?.theme ?? FormThemeSchema.parse({}),
          createdBy: actor.userId,
        });
        if (source !== null) {
          for (const block of await repo.getBlocks(tx, source.id)) {
            await repo.insertBlock(tx, version.id, {
              parentBlockId: null, // parents are re-linked by the next save
              blockType: block.blockType,
              questionId: block.questionId,
              pageIndex: block.pageIndex,
              sortOrder: block.sortOrder,
              layout: block.layout,
              style: block.style,
              props: block.props,
              isRequiredOverride: block.isRequiredOverride,
              labelOverride: block.labelOverride,
              placeholderOverride: block.placeholderOverride,
              helpTextOverride: block.helpTextOverride,
              optionValueOverrides: block.optionValueOverrides,
            });
          }
        }
        return version;
      });
      return toVersion(draft, await repo.getBlocks(db, draft.id));
    },

    async saveDocument(id, versionId, body, actor) {
      await requireForm(id);
      await requireDraft(id, versionId);

      await withTransaction(db, async (tx) => {
        await repo.updateVersionContent(tx, versionId, {
          pages: body.pages,
          theme: body.theme,
        });
        // Whole-tree replace: the builder owns the canvas and sends all of it.
        // Single-block drags use PATCH .../blocks/:id instead, precisely so
        // two admins arranging the same form do not clobber each other.
        await repo.deleteAllBlocks(tx, versionId);
        for (const block of body.blocks) {
          await repo.insertBlock(tx, versionId, {
            id: block.id,
            parentBlockId: block.parentBlockId,
            blockType: block.blockType,
            questionId: block.questionId,
            pageIndex: block.pageIndex,
            sortOrder: block.sortOrder,
            layout: block.layout,
            style: block.style,
            props: block.props,
            isRequiredOverride: block.isRequiredOverride,
            labelOverride: block.labelOverride,
            placeholderOverride: block.placeholderOverride,
            helpTextOverride: block.helpTextOverride,
            optionValueOverrides: block.optionValueOverrides,
          });
        }
        await emitEvent(tx, {
          entityType: 'candidate_form',
          entityId: id,
          eventType: 'candidate_form_document_saved',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { versionId, blockCount: body.blocks.length },
        });
      });
      deps.invalidateFormCache();

      const version = await repo.getVersion(db, versionId);
      if (version === null) throw new ApiError('NOT_FOUND', 'Form version not found.');
      return toVersion(version, await repo.getBlocks(db, versionId));
    },

    async addBlock(id, versionId, body, actor) {
      await requireForm(id);
      await requireDraft(id, versionId);
      const created = await withTransaction(db, async (tx) => {
        const block = await repo.insertBlock(tx, versionId, {
          parentBlockId: body.parentBlockId ?? null,
          blockType: body.blockType,
          questionId: body.questionId ?? null,
          pageIndex: body.pageIndex,
          sortOrder: body.sortOrder,
          layout: body.layout,
          style: body.style ?? {},
          props: body.props ?? {},
          isRequiredOverride: body.isRequiredOverride ?? null,
          labelOverride: body.labelOverride ?? null,
          placeholderOverride: body.placeholderOverride ?? null,
          helpTextOverride: body.helpTextOverride ?? null,
          optionValueOverrides: body.optionValueOverrides ?? null,
        });
        await emitEvent(tx, {
          entityType: 'candidate_form',
          entityId: id,
          eventType: 'candidate_form_block_added',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { versionId, blockId: block.id, blockType: body.blockType },
        });
        return block;
      });
      deps.invalidateFormCache();
      const block = (await repo.getBlocks(db, versionId)).find(
        (candidate) => candidate.id === created.id,
      );
      if (block === undefined) throw new ApiError('NOT_FOUND', 'Block not found.');
      return toBlockShape(block);
    },

    /**
     * No event and no transaction: one row, one UPDATE. A canvas move is not
     * an auditable state change, and an events row per pointer-up would bury
     * the log — so the actor parameter is simply not taken here.
     */
    async patchBlock(id, versionId, blockId, body) {
      await requireForm(id);
      await requireDraft(id, versionId);
      const patched = await repo.updateBlock(db, versionId, blockId, body);
      if (!patched) throw new ApiError('NOT_FOUND', 'Block not found.');
      deps.invalidateFormCache();
      const block = (await repo.getBlocks(db, versionId)).find(
        (candidate) => candidate.id === blockId,
      );
      if (block === undefined) throw new ApiError('NOT_FOUND', 'Block not found.');
      return toBlockShape(block);
    },

    async removeBlock(id, versionId, blockId, actor) {
      await requireForm(id);
      await requireDraft(id, versionId);
      await withTransaction(db, async (tx) => {
        const deleted = await repo.deleteBlock(tx, versionId, blockId);
        if (!deleted) throw new ApiError('NOT_FOUND', 'Block not found.');
        await emitEvent(tx, {
          entityType: 'candidate_form',
          entityId: id,
          eventType: 'candidate_form_block_removed',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { versionId, blockId },
        });
      });
      deps.invalidateFormCache();
    },

    async activate(id, actor) {
      const form = await requireForm(id);
      const draft = await repo.getDraftVersion(db, id);
      if (draft === null) {
        throw new ApiError(
          'INVALID_TRANSITION',
          'There is no draft to publish. Start a new draft first.',
        );
      }

      // --- the activation gate -------------------------------------------
      const fields: Record<string, string> = {};

      if (!form.isDefault && form.roleCategoryId === null) {
        fields['roleCategoryId'] = 'Choose the role this form is for.';
      }

      const referenced = await repo.getReferencedQuestions(db, draft.id);
      if (referenced.length === 0) {
        fields['blocks'] = 'Add at least one question before activating.';
      }

      if (!referenced.some((q) => q.key === IDENTITY_QUESTION_KEY)) {
        // Email is the identity: without it a submission cannot be matched to
        // a candidate, so de-duplication and "one submission per form" break.
        fields['email'] =
          'This form must ask for an email address — it is how a candidate is identified.';
      }

      const unusable = referenced.filter(
        (q) => !q.isActive || q.isArchived || q.audience !== 'candidate',
      );
      if (unusable.length > 0) {
        fields['questions'] = `Not usable on a candidate form: ${unusable
          .map((q) => q.key)
          .join(', ')}.`;
      }

      // A conditional question whose controller is absent never becomes
      // visible, so it is silently unanswerable — catch it now, not live.
      const present = new Set(referenced.map((q) => q.questionId));
      const orphaned = referenced.filter(
        (q) =>
          q.conditionalOnQuestionId !== null && !present.has(q.conditionalOnQuestionId),
      );
      if (orphaned.length > 0) {
        fields['conditionals'] =
          `These questions depend on a question that is not on the form, so they would never appear: ${orphaned
            .map((q) => q.key)
            .join(', ')}.`;
      }

      if (Object.keys(fields).length > 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'This form is not ready to go live.',
          { fields },
        );
      }
      // -------------------------------------------------------------------

      await withTransaction(db, async (tx) => {
        await repo.markVersionPublished(tx, draft.id);
        await repo.setFormStatus(tx, id, 'active', draft.id);
        await emitEvent(tx, {
          entityType: 'candidate_form',
          entityId: id,
          eventType: 'candidate_form_activated',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: form.status,
          toValue: 'active',
          metadata: { versionId: draft.id, questionCount: referenced.length },
        });
      });
      deps.invalidateFormCache();

      const updated = await requireForm(id);
      return {
        form: toFormShape(updated),
        publicPath: formPublicPath({
          slug: updated.slug,
          isDefault: updated.isDefault,
        }),
      };
    },

    async deactivate(id, actor) {
      const form = await requireForm(id);
      if (form.status !== 'active') {
        throw new ApiError('INVALID_TRANSITION', 'This form is not active.');
      }
      await withTransaction(db, async (tx) => {
        await repo.setFormStatus(tx, id, 'inactive', null);
        await emitEvent(tx, {
          entityType: 'candidate_form',
          entityId: id,
          eventType: 'candidate_form_deactivated',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: 'active',
          toValue: 'inactive',
        });
      });
      deps.invalidateFormCache();
      return toFormShape(await requireForm(id));
    },
  };
}

export type { FormTheme };
