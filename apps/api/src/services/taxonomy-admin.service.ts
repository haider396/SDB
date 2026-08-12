/**
 * Taxonomy-management business rules (docs/04-API.md §5). No HTTP types, no
 * SQL strings.
 *
 * Guard rails enforced here:
 * - engines are a fixed set of five: no create, no delete; only label,
 *   is_staffed, sort_order editable (the strict PATCH contract rejects the
 *   rest at validation time)
 * - keys are immutable after creation (auto-slug from label at create only);
 *   a re-key attempt is 422 VALIDATION_FAILED
 * - department keys unique per engine, role-category keys unique per
 *   department, disqualifier/rejection-reason keys unique globally — enforced
 *   in SQL, surfaced as 422
 * - deactivate = is_active := false (0004/0007/0008 have no archived_at);
 *   reactivation goes through PATCH isActive since 04 §5 has no activate action
 * - every write emits an events row inside the same transaction (rule 6)
 * - engine/department/role-category writes invalidate the public taxonomy
 *   cache (GET /taxonomy/public); tools/skills/industries/disqualifiers/
 *   rejection-reasons are not part of that payload, so they do not
 */
import type {
  CreateDepartmentBody,
  CreateDisqualifierBody,
  CreateIndustryBody,
  CreateRejectionReasonBody,
  CreateRoleCategoryBody,
  CreateToolBody,
  Department,
  Disqualifier,
  Engine,
  Industry,
  ListDepartmentsQuery,
  ListDisqualifiersQuery,
  ListReferenceDataQuery,
  ListRejectionReasonsQuery,
  ListRoleCategoriesQuery,
  RejectionReason,
  RoleCategory,
  Tool,
  UpdateDepartmentBody,
  UpdateDisqualifierBody,
  UpdateEngineBody,
  UpdateRejectionReasonBody,
  UpdateRoleCategoryBody,
} from '@sdb/contracts';
import { withTransaction, type Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  findDepartmentById,
  findDisqualifierById,
  findEngineById,
  findRejectionReasonById,
  findRoleCategoryById,
  insertDepartment,
  insertDisqualifier,
  insertIndustry,
  insertRejectionReason,
  insertRoleCategory,
  insertSkill,
  insertTool,
  listDepartmentKeys,
  listDepartments,
  listDisqualifierKeys,
  listDisqualifiers,
  listEngines,
  listIndustries,
  listRejectionReasonKeys,
  listRejectionReasons,
  listRoleCategories,
  listRoleCategoryKeys,
  listSkills,
  listTools,
  updateDepartment,
  updateDisqualifier,
  updateEngine,
  updateRejectionReason,
  updateRoleCategory,
} from '../repositories/taxonomy-admin.repo.js';
import { emitEvent } from './events.js';
import type { Actor } from './questions.service.js';
import { slugify } from './questions.service.js';

const PG_UNIQUE_VIOLATION = '23505';

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function uniqueKey(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/** Resolve create-time key: explicit (rejected if taken) or auto-slug. */
function resolveKey(
  explicit: string | undefined,
  label: string,
  existing: Set<string>,
  entity: string,
): string {
  if (explicit !== undefined) {
    if (existing.has(explicit)) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `A ${entity} with key '${explicit}' already exists.`,
        { fields: { key: 'Key already in use.' } },
      );
    }
    return explicit;
  }
  return uniqueKey(slugify(label), existing);
}

/** Keys are immutable after creation, everywhere in this surface. */
function assertKeyUnchanged(
  bodyKey: string | undefined,
  currentKey: string,
  entity: string,
): void {
  if (bodyKey !== undefined && bodyKey !== currentKey) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `A ${entity} key is immutable after creation.`,
      { fields: { key: 'Key is immutable after creation.' } },
    );
  }
}

/** { field: { from, to } } diff of the fields present in a PATCH body. */
function diffOf(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, to] of Object.entries(patch)) {
    if (to !== undefined && current[field] !== to) {
      changes[field] = { from: current[field] ?? null, to };
    }
  }
  return changes;
}

export interface TaxonomyAdminServiceDeps {
  db: Db;
  /**
   * Public-taxonomy cache invalidation hook — called on every engine,
   * department, and role-category write (the /taxonomy/public payload).
   */
  invalidatePublicTaxonomyCache: () => void;
}

export interface TaxonomyAdminService {
  listEngines(filter: { isActive?: boolean }): Promise<Engine[]>;
  updateEngine(id: string, body: UpdateEngineBody, actor: Actor): Promise<Engine>;

  listDepartments(query: ListDepartmentsQuery): Promise<Department[]>;
  createDepartment(body: CreateDepartmentBody, actor: Actor): Promise<Department>;
  updateDepartment(
    id: string,
    body: UpdateDepartmentBody,
    actor: Actor,
  ): Promise<Department>;
  deactivateDepartment(id: string, actor: Actor): Promise<Department>;

  listRoleCategories(query: ListRoleCategoriesQuery): Promise<RoleCategory[]>;
  createRoleCategory(
    body: CreateRoleCategoryBody,
    actor: Actor,
  ): Promise<RoleCategory>;
  updateRoleCategory(
    id: string,
    body: UpdateRoleCategoryBody,
    actor: Actor,
  ): Promise<RoleCategory>;
  deactivateRoleCategory(id: string, actor: Actor): Promise<RoleCategory>;

  listTools(query: ListReferenceDataQuery): Promise<Tool[]>;
  createTool(body: CreateToolBody, actor: Actor): Promise<Tool>;
  listSkills(query: ListReferenceDataQuery): Promise<Tool[]>;
  createSkill(body: CreateToolBody, actor: Actor): Promise<Tool>;
  listIndustries(query: ListReferenceDataQuery): Promise<Industry[]>;
  createIndustry(body: CreateIndustryBody, actor: Actor): Promise<Industry>;

  listDisqualifiers(query: ListDisqualifiersQuery): Promise<Disqualifier[]>;
  createDisqualifier(
    body: CreateDisqualifierBody,
    actor: Actor,
  ): Promise<Disqualifier>;
  updateDisqualifier(
    id: string,
    body: UpdateDisqualifierBody,
    actor: Actor,
  ): Promise<Disqualifier>;

  listRejectionReasons(
    query: ListRejectionReasonsQuery,
  ): Promise<RejectionReason[]>;
  createRejectionReason(
    body: CreateRejectionReasonBody,
    actor: Actor,
  ): Promise<RejectionReason>;
  updateRejectionReason(
    id: string,
    body: UpdateRejectionReasonBody,
    actor: Actor,
  ): Promise<RejectionReason>;
}

export function createTaxonomyAdminService(
  deps: TaxonomyAdminServiceDeps,
): TaxonomyAdminService {
  const { db } = deps;

  /** Translate a duplicate-key violation into the standard 422. */
  function rethrowDuplicate(error: unknown, entity: string): never {
    if (pgCode(error) === PG_UNIQUE_VIOLATION) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `A ${entity} with this key or name already exists.`,
        { fields: { key: 'Duplicate key or name.' } },
      );
    }
    throw error as Error;
  }

  return {
    // --- engines -----------------------------------------------------------

    async listEngines(filter) {
      return listEngines(db, filter);
    },

    async updateEngine(id, body, actor) {
      const current = await findEngineById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Engine not found.');
      }
      const changes = diffOf(
        { label: current.label, isStaffed: current.isStaffed, sortOrder: current.sortOrder },
        { label: body.label, isStaffed: body.isStaffed, sortOrder: body.sortOrder },
      );
      await withTransaction(db, async (tx) => {
        await updateEngine(tx, id, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.isStaffed !== undefined ? { isStaffed: body.isStaffed } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        });
        await emitEvent(tx, {
          entityType: 'engine',
          entityId: id,
          eventType: 'engine_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { key: current.key, changes },
        });
      });
      deps.invalidatePublicTaxonomyCache();
      const updated = await findEngineById(db, id);
      if (updated === null) throw new ApiError('NOT_FOUND', 'Engine not found.');
      return updated;
    },

    // --- departments -------------------------------------------------------

    async listDepartments(query) {
      return listDepartments(db, {
        ...(query.engineId !== undefined ? { engineId: query.engineId } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      });
    },

    async createDepartment(body, actor) {
      const engine = await findEngineById(db, body.engineId);
      if (engine === null) {
        throw new ApiError('NOT_FOUND', 'Engine not found.');
      }
      const existingKeys = new Set(await listDepartmentKeys(db, body.engineId));
      const key = resolveKey(body.key, body.label, existingKeys, 'department');
      const sortOrder = body.sortOrder ?? existingKeys.size + 1;
      let id: string;
      try {
        id = await withTransaction(db, async (tx) => {
          const created = await insertDepartment(tx, {
            engineId: body.engineId,
            key,
            label: body.label,
            managerUserId: body.managerUserId ?? null,
            sortOrder,
          });
          await emitEvent(tx, {
            entityType: 'department',
            entityId: created,
            eventType: 'department_created',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: 'active',
            metadata: { key, label: body.label, engineKey: engine.key },
          });
          return created;
        });
      } catch (error) {
        rethrowDuplicate(error, 'department');
      }
      deps.invalidatePublicTaxonomyCache();
      const created = await findDepartmentById(db, id);
      if (created === null) throw new ApiError('NOT_FOUND', 'Department not found.');
      return created;
    },

    async updateDepartment(id, body, actor) {
      const current = await findDepartmentById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Department not found.');
      }
      assertKeyUnchanged(body.key, current.key, 'department');
      const changes = diffOf(
        {
          label: current.label,
          managerUserId: current.managerUserId,
          sortOrder: current.sortOrder,
          isActive: current.isActive,
        },
        {
          label: body.label,
          managerUserId: body.managerUserId,
          sortOrder: body.sortOrder,
          isActive: body.isActive,
        },
      );
      await withTransaction(db, async (tx) => {
        await updateDepartment(tx, id, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.managerUserId !== undefined
            ? { managerUserId: body.managerUserId }
            : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        });
        await emitEvent(tx, {
          entityType: 'department',
          entityId: id,
          eventType: 'department_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { key: current.key, changes },
        });
      });
      deps.invalidatePublicTaxonomyCache();
      const updated = await findDepartmentById(db, id);
      if (updated === null) throw new ApiError('NOT_FOUND', 'Department not found.');
      return updated;
    },

    async deactivateDepartment(id, actor) {
      const current = await findDepartmentById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Department not found.');
      }
      if (current.isActive) {
        await withTransaction(db, async (tx) => {
          await updateDepartment(tx, id, { isActive: false });
          await emitEvent(tx, {
            entityType: 'department',
            entityId: id,
            eventType: 'department_deactivated',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: 'active',
            toValue: 'inactive',
            metadata: { key: current.key },
          });
        });
        deps.invalidatePublicTaxonomyCache();
      }
      const updated = await findDepartmentById(db, id);
      if (updated === null) throw new ApiError('NOT_FOUND', 'Department not found.');
      return updated;
    },

    // --- role categories ---------------------------------------------------

    async listRoleCategories(query) {
      return listRoleCategories(db, {
        ...(query.departmentId !== undefined
          ? { departmentId: query.departmentId }
          : {}),
        ...(query.engineId !== undefined ? { engineId: query.engineId } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      });
    },

    async createRoleCategory(body, actor) {
      const department = await findDepartmentById(db, body.departmentId);
      if (department === null) {
        throw new ApiError('NOT_FOUND', 'Department not found.');
      }
      const existingKeys = new Set(
        await listRoleCategoryKeys(db, body.departmentId),
      );
      const key = resolveKey(body.key, body.label, existingKeys, 'role category');
      const sortOrder = body.sortOrder ?? existingKeys.size + 1;
      let id: string;
      try {
        id = await withTransaction(db, async (tx) => {
          const created = await insertRoleCategory(tx, {
            departmentId: body.departmentId,
            key,
            label: body.label,
            advertisedTitle: body.advertisedTitle ?? null,
            description: body.description ?? null,
            sortOrder,
          });
          await emitEvent(tx, {
            entityType: 'role_category',
            entityId: created,
            eventType: 'role_category_created',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: 'active',
            metadata: { key, label: body.label, departmentKey: department.key },
          });
          return created;
        });
      } catch (error) {
        rethrowDuplicate(error, 'role category');
      }
      deps.invalidatePublicTaxonomyCache();
      const created = await findRoleCategoryById(db, id);
      if (created === null) {
        throw new ApiError('NOT_FOUND', 'Role category not found.');
      }
      return created;
    },

    async updateRoleCategory(id, body, actor) {
      const current = await findRoleCategoryById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Role category not found.');
      }
      assertKeyUnchanged(body.key, current.key, 'role category');
      const changes = diffOf(
        {
          label: current.label,
          advertisedTitle: current.advertisedTitle,
          description: current.description,
          sortOrder: current.sortOrder,
          isActive: current.isActive,
        },
        {
          label: body.label,
          advertisedTitle: body.advertisedTitle,
          description: body.description,
          sortOrder: body.sortOrder,
          isActive: body.isActive,
        },
      );
      await withTransaction(db, async (tx) => {
        await updateRoleCategory(tx, id, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.advertisedTitle !== undefined
            ? { advertisedTitle: body.advertisedTitle }
            : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        });
        await emitEvent(tx, {
          entityType: 'role_category',
          entityId: id,
          eventType: 'role_category_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { key: current.key, changes },
        });
      });
      deps.invalidatePublicTaxonomyCache();
      const updated = await findRoleCategoryById(db, id);
      if (updated === null) {
        throw new ApiError('NOT_FOUND', 'Role category not found.');
      }
      return updated;
    },

    async deactivateRoleCategory(id, actor) {
      const current = await findRoleCategoryById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Role category not found.');
      }
      if (current.isActive) {
        await withTransaction(db, async (tx) => {
          await updateRoleCategory(tx, id, { isActive: false });
          await emitEvent(tx, {
            entityType: 'role_category',
            entityId: id,
            eventType: 'role_category_deactivated',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: 'active',
            toValue: 'inactive',
            metadata: { key: current.key },
          });
        });
        deps.invalidatePublicTaxonomyCache();
      }
      const updated = await findRoleCategoryById(db, id);
      if (updated === null) {
        throw new ApiError('NOT_FOUND', 'Role category not found.');
      }
      return updated;
    },

    // --- reference data ----------------------------------------------------

    async listTools(query) {
      return listTools(db, {
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      });
    },

    async createTool(body, actor) {
      try {
        return await withTransaction(db, async (tx) => {
          const tool = await insertTool(tx, {
            name: body.name,
            category: body.category ?? null,
          });
          await emitEvent(tx, {
            entityType: 'tool',
            entityId: tool.id,
            eventType: 'tool_created',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: 'active',
            metadata: { name: body.name, category: body.category ?? null },
          });
          return tool;
        });
      } catch (error) {
        rethrowDuplicate(error, 'tool');
      }
    },

    async listSkills(query) {
      return listSkills(db, {
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      });
    },

    async createSkill(body, actor) {
      try {
        return await withTransaction(db, async (tx) => {
          const skill = await insertSkill(tx, {
            name: body.name,
            category: body.category ?? null,
          });
          await emitEvent(tx, {
            entityType: 'skill',
            entityId: skill.id,
            eventType: 'skill_created',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: 'active',
            metadata: { name: body.name, category: body.category ?? null },
          });
          return skill;
        });
      } catch (error) {
        rethrowDuplicate(error, 'skill');
      }
    },

    async listIndustries(query) {
      return listIndustries(db, {
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      });
    },

    async createIndustry(body, actor) {
      try {
        return await withTransaction(db, async (tx) => {
          const industry = await insertIndustry(tx, { name: body.name });
          await emitEvent(tx, {
            entityType: 'industry',
            entityId: industry.id,
            eventType: 'industry_created',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: 'active',
            metadata: { name: body.name },
          });
          return industry;
        });
      } catch (error) {
        rethrowDuplicate(error, 'industry');
      }
    },

    // --- disqualifiers -----------------------------------------------------

    async listDisqualifiers(query) {
      return listDisqualifiers(db, {
        ...(query.roleCategoryId !== undefined
          ? { roleCategoryId: query.roleCategoryId }
          : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      });
    },

    async createDisqualifier(body, actor) {
      if (body.roleCategoryId !== undefined && body.roleCategoryId !== null) {
        const roleCategory = await findRoleCategoryById(db, body.roleCategoryId);
        if (roleCategory === null) {
          throw new ApiError('NOT_FOUND', 'Role category not found.');
        }
      }
      const existingKeys = new Set(await listDisqualifierKeys(db));
      const key = resolveKey(body.key, body.label, existingKeys, 'disqualifier');
      const sortOrder = body.sortOrder ?? existingKeys.size + 1;
      let id: string;
      try {
        id = await withTransaction(db, async (tx) => {
          const created = await insertDisqualifier(tx, {
            key,
            label: body.label,
            roleCategoryId: body.roleCategoryId ?? null,
            sortOrder,
          });
          await emitEvent(tx, {
            entityType: 'disqualifier',
            entityId: created,
            eventType: 'disqualifier_created',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: 'active',
            metadata: { key, label: body.label },
          });
          return created;
        });
      } catch (error) {
        rethrowDuplicate(error, 'disqualifier');
      }
      const created = await findDisqualifierById(db, id);
      if (created === null) throw new ApiError('NOT_FOUND', 'Disqualifier not found.');
      return created;
    },

    async updateDisqualifier(id, body, actor) {
      const current = await findDisqualifierById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Disqualifier not found.');
      }
      assertKeyUnchanged(body.key, current.key, 'disqualifier');
      if (body.roleCategoryId !== undefined && body.roleCategoryId !== null) {
        const roleCategory = await findRoleCategoryById(db, body.roleCategoryId);
        if (roleCategory === null) {
          throw new ApiError('NOT_FOUND', 'Role category not found.');
        }
      }
      const changes = diffOf(
        {
          label: current.label,
          roleCategoryId: current.roleCategoryId,
          sortOrder: current.sortOrder,
          isActive: current.isActive,
        },
        {
          label: body.label,
          roleCategoryId: body.roleCategoryId,
          sortOrder: body.sortOrder,
          isActive: body.isActive,
        },
      );
      await withTransaction(db, async (tx) => {
        await updateDisqualifier(tx, id, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.roleCategoryId !== undefined
            ? { roleCategoryId: body.roleCategoryId }
            : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        });
        await emitEvent(tx, {
          entityType: 'disqualifier',
          entityId: id,
          eventType: 'disqualifier_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { key: current.key, changes },
        });
      });
      const updated = await findDisqualifierById(db, id);
      if (updated === null) throw new ApiError('NOT_FOUND', 'Disqualifier not found.');
      return updated;
    },

    // --- rejection reasons -------------------------------------------------

    async listRejectionReasons(query) {
      return listRejectionReasons(db, {
        ...(query.actor !== undefined ? { actor: query.actor } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      });
    },

    async createRejectionReason(body, actor) {
      const existingKeys = new Set(await listRejectionReasonKeys(db));
      const key = resolveKey(body.key, body.label, existingKeys, 'rejection reason');
      const sortOrder = body.sortOrder ?? existingKeys.size + 1;
      let id: string;
      try {
        id = await withTransaction(db, async (tx) => {
          const created = await insertRejectionReason(tx, {
            key,
            label: body.label,
            actor: body.actor,
            sortOrder,
          });
          await emitEvent(tx, {
            entityType: 'rejection_reason',
            entityId: created,
            eventType: 'rejection_reason_created',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: 'active',
            metadata: { key, label: body.label, reasonActor: body.actor },
          });
          return created;
        });
      } catch (error) {
        rethrowDuplicate(error, 'rejection reason');
      }
      const created = await findRejectionReasonById(db, id);
      if (created === null) {
        throw new ApiError('NOT_FOUND', 'Rejection reason not found.');
      }
      return created;
    },

    async updateRejectionReason(id, body, actor) {
      const current = await findRejectionReasonById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Rejection reason not found.');
      }
      // Key is immutable after creation (04 §5): reporting groups by key and
      // rejections reference reasons by id — a silent re-key would corrupt both.
      assertKeyUnchanged(body.key, current.key, 'rejection reason');
      const changes = diffOf(
        {
          label: current.label,
          actor: current.actor,
          sortOrder: current.sortOrder,
          isActive: current.isActive,
        },
        {
          label: body.label,
          actor: body.actor,
          sortOrder: body.sortOrder,
          isActive: body.isActive,
        },
      );
      await withTransaction(db, async (tx) => {
        await updateRejectionReason(tx, id, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.actor !== undefined ? { actor: body.actor } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        });
        await emitEvent(tx, {
          entityType: 'rejection_reason',
          entityId: id,
          eventType: 'rejection_reason_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { key: current.key, changes },
        });
      });
      const updated = await findRejectionReasonById(db, id);
      if (updated === null) {
        throw new ApiError('NOT_FOUND', 'Rejection reason not found.');
      }
      return updated;
    },
  };
}
