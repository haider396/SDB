/**
 * SQL for taxonomy management (docs/04-API.md §5): engines, departments,
 * role_categories, tools, skills, industries (migration 0004), disqualifiers
 * (0007), rejection_reasons (0008). No business logic here — guard rails
 * (fixed engine set, key immutability, auto-slugging) live in
 * services/taxonomy-admin.service.ts.
 *
 * None of these tables carry timestamps or archived_at — active state is the
 * `is_active` flag, per the 0004/0007/0008 DDL.
 */
import type {
  Department,
  Disqualifier,
  Engine,
  Industry,
  RejectionActor,
  RejectionReason,
  RoleCategory,
  Tool,
} from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

interface EngineRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  is_staffed: boolean;
  sort_order: number;
  is_active: boolean;
}

function mapEngine(row: EngineRow): Engine {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    isStaffed: row.is_staffed,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export async function listEngines(
  sql: Queryable,
  filter: { isActive?: boolean } = {},
): Promise<Engine[]> {
  const rows = await sql<EngineRow[]>`
    select id, key, label, description, is_staffed, sort_order, is_active
    from engines
    where true
      ${filter.isActive === undefined ? sql`` : sql`and is_active = ${filter.isActive}`}
    order by sort_order, label
  `;
  return rows.map(mapEngine);
}

export async function findEngineById(
  sql: Queryable,
  id: string,
): Promise<Engine | null> {
  const rows = await sql<EngineRow[]>`
    select id, key, label, description, is_staffed, sort_order, is_active
    from engines where id = ${id}
  `;
  const row = rows[0];
  return row === undefined ? null : mapEngine(row);
}

export async function updateEngine(
  sql: Queryable,
  id: string,
  patch: { label?: string; isStaffed?: boolean; sortOrder?: number },
): Promise<void> {
  await sql`
    update engines set
      label      = coalesce(${patch.label ?? null}, label),
      is_staffed = coalesce(${patch.isStaffed ?? null}, is_staffed),
      sort_order = coalesce(${patch.sortOrder ?? null}, sort_order)
    where id = ${id}
  `;
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

interface DepartmentRow {
  id: string;
  engine_id: string;
  key: string;
  label: string;
  manager_user_id: string | null;
  sort_order: number;
  is_active: boolean;
}

function mapDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    engineId: row.engine_id,
    key: row.key,
    label: row.label,
    managerUserId: row.manager_user_id,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export async function listDepartments(
  sql: Queryable,
  filter: { engineId?: string; isActive?: boolean } = {},
): Promise<Department[]> {
  const rows = await sql<DepartmentRow[]>`
    select id, engine_id, key, label, manager_user_id, sort_order, is_active
    from departments
    where true
      ${filter.engineId === undefined ? sql`` : sql`and engine_id = ${filter.engineId}`}
      ${filter.isActive === undefined ? sql`` : sql`and is_active = ${filter.isActive}`}
    order by sort_order, label
  `;
  return rows.map(mapDepartment);
}

export async function findDepartmentById(
  sql: Queryable,
  id: string,
): Promise<Department | null> {
  const rows = await sql<DepartmentRow[]>`
    select id, engine_id, key, label, manager_user_id, sort_order, is_active
    from departments where id = ${id}
  `;
  const row = rows[0];
  return row === undefined ? null : mapDepartment(row);
}

/** Keys already used within one engine (unique (engine_id, key) in 0004). */
export async function listDepartmentKeys(
  sql: Queryable,
  engineId: string,
): Promise<string[]> {
  const rows = await sql<{ key: string }[]>`
    select key from departments where engine_id = ${engineId}
  `;
  return rows.map((row) => row.key);
}

export async function insertDepartment(
  sql: Queryable,
  input: {
    engineId: string;
    key: string;
    label: string;
    managerUserId: string | null;
    sortOrder: number;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into departments (engine_id, key, label, manager_user_id, sort_order)
    values (${input.engineId}, ${input.key}, ${input.label},
            ${input.managerUserId}, ${input.sortOrder})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('department insert returned no row');
  return row.id;
}

export async function updateDepartment(
  sql: Queryable,
  id: string,
  patch: {
    label?: string;
    managerUserId?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<void> {
  await sql`
    update departments set
      label      = coalesce(${patch.label ?? null}, label),
      sort_order = coalesce(${patch.sortOrder ?? null}, sort_order),
      is_active  = coalesce(${patch.isActive ?? null}, is_active),
      manager_user_id = ${
        patch.managerUserId === undefined
          ? sql`manager_user_id`
          : patch.managerUserId
      }
    where id = ${id}
  `;
}

// ---------------------------------------------------------------------------
// Role categories
// ---------------------------------------------------------------------------

interface RoleCategoryRow {
  id: string;
  department_id: string;
  key: string;
  label: string;
  advertised_title: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

function mapRoleCategory(row: RoleCategoryRow): RoleCategory {
  return {
    id: row.id,
    departmentId: row.department_id,
    key: row.key,
    label: row.label,
    advertisedTitle: row.advertised_title,
    description: row.description,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export async function listRoleCategories(
  sql: Queryable,
  filter: { departmentId?: string; engineId?: string; isActive?: boolean } = {},
): Promise<RoleCategory[]> {
  const rows = await sql<RoleCategoryRow[]>`
    select rc.id, rc.department_id, rc.key, rc.label, rc.advertised_title,
           rc.description, rc.sort_order, rc.is_active
    from role_categories rc
    ${
      filter.engineId === undefined
        ? sql``
        : sql`join departments d on d.id = rc.department_id and d.engine_id = ${filter.engineId}`
    }
    where true
      ${
        filter.departmentId === undefined
          ? sql``
          : sql`and rc.department_id = ${filter.departmentId}`
      }
      ${filter.isActive === undefined ? sql`` : sql`and rc.is_active = ${filter.isActive}`}
    order by rc.sort_order, rc.label
  `;
  return rows.map(mapRoleCategory);
}

export async function findRoleCategoryById(
  sql: Queryable,
  id: string,
): Promise<RoleCategory | null> {
  const rows = await sql<RoleCategoryRow[]>`
    select id, department_id, key, label, advertised_title, description,
           sort_order, is_active
    from role_categories where id = ${id}
  `;
  const row = rows[0];
  return row === undefined ? null : mapRoleCategory(row);
}

/** Keys already used within one department (unique (department_id, key)). */
export async function listRoleCategoryKeys(
  sql: Queryable,
  departmentId: string,
): Promise<string[]> {
  const rows = await sql<{ key: string }[]>`
    select key from role_categories where department_id = ${departmentId}
  `;
  return rows.map((row) => row.key);
}

export async function insertRoleCategory(
  sql: Queryable,
  input: {
    departmentId: string;
    key: string;
    label: string;
    advertisedTitle: string | null;
    description: string | null;
    sortOrder: number;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into role_categories
      (department_id, key, label, advertised_title, description, sort_order)
    values (${input.departmentId}, ${input.key}, ${input.label},
            ${input.advertisedTitle}, ${input.description}, ${input.sortOrder})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('role_category insert returned no row');
  return row.id;
}

export async function updateRoleCategory(
  sql: Queryable,
  id: string,
  patch: {
    label?: string;
    advertisedTitle?: string | null;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<void> {
  await sql`
    update role_categories set
      label      = coalesce(${patch.label ?? null}, label),
      sort_order = coalesce(${patch.sortOrder ?? null}, sort_order),
      is_active  = coalesce(${patch.isActive ?? null}, is_active),
      advertised_title = ${
        patch.advertisedTitle === undefined
          ? sql`advertised_title`
          : patch.advertisedTitle
      },
      description = ${
        patch.description === undefined ? sql`description` : patch.description
      }
    where id = ${id}
  `;
}

// ---------------------------------------------------------------------------
// Reference data: tools, skills, industries
// ---------------------------------------------------------------------------

interface NamedRow {
  id: string;
  name: string;
  category: string | null;
  is_active: boolean;
}

function mapTool(row: NamedRow): Tool {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    isActive: row.is_active,
  };
}

export async function listTools(
  sql: Queryable,
  filter: { isActive?: boolean } = {},
): Promise<Tool[]> {
  const rows = await sql<NamedRow[]>`
    select id, name, category, is_active from tools
    where true
      ${filter.isActive === undefined ? sql`` : sql`and is_active = ${filter.isActive}`}
    order by name
  `;
  return rows.map(mapTool);
}

export async function insertTool(
  sql: Queryable,
  input: { name: string; category: string | null },
): Promise<Tool> {
  const rows = await sql<NamedRow[]>`
    insert into tools (name, category) values (${input.name}, ${input.category})
    returning id, name, category, is_active
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('tool insert returned no row');
  return mapTool(row);
}

export async function listSkills(
  sql: Queryable,
  filter: { isActive?: boolean } = {},
): Promise<Tool[]> {
  const rows = await sql<NamedRow[]>`
    select id, name, category, is_active from skills
    where true
      ${filter.isActive === undefined ? sql`` : sql`and is_active = ${filter.isActive}`}
    order by name
  `;
  return rows.map(mapTool);
}

export async function insertSkill(
  sql: Queryable,
  input: { name: string; category: string | null },
): Promise<Tool> {
  const rows = await sql<NamedRow[]>`
    insert into skills (name, category) values (${input.name}, ${input.category})
    returning id, name, category, is_active
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('skill insert returned no row');
  return mapTool(row);
}

interface IndustryRow {
  id: string;
  name: string;
  is_active: boolean;
}

export async function listIndustries(
  sql: Queryable,
  filter: { isActive?: boolean } = {},
): Promise<Industry[]> {
  const rows = await sql<IndustryRow[]>`
    select id, name, is_active from industries
    where true
      ${filter.isActive === undefined ? sql`` : sql`and is_active = ${filter.isActive}`}
    order by name
  `;
  return rows.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active }));
}

export async function insertIndustry(
  sql: Queryable,
  input: { name: string },
): Promise<Industry> {
  const rows = await sql<IndustryRow[]>`
    insert into industries (name) values (${input.name})
    returning id, name, is_active
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('industry insert returned no row');
  return { id: row.id, name: row.name, isActive: row.is_active };
}

// ---------------------------------------------------------------------------
// Disqualifiers
// ---------------------------------------------------------------------------

interface DisqualifierRow {
  id: string;
  key: string;
  label: string;
  role_category_id: string | null;
  sort_order: number;
  is_active: boolean;
}

function mapDisqualifier(row: DisqualifierRow): Disqualifier {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    roleCategoryId: row.role_category_id,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export async function listDisqualifiers(
  sql: Queryable,
  filter: { roleCategoryId?: string; isActive?: boolean } = {},
): Promise<Disqualifier[]> {
  const rows = await sql<DisqualifierRow[]>`
    select id, key, label, role_category_id, sort_order, is_active
    from disqualifiers
    where true
      ${
        filter.roleCategoryId === undefined
          ? sql``
          : sql`and (role_category_id = ${filter.roleCategoryId} or role_category_id is null)`
      }
      ${filter.isActive === undefined ? sql`` : sql`and is_active = ${filter.isActive}`}
    order by sort_order, label
  `;
  return rows.map(mapDisqualifier);
}

export async function findDisqualifierById(
  sql: Queryable,
  id: string,
): Promise<Disqualifier | null> {
  const rows = await sql<DisqualifierRow[]>`
    select id, key, label, role_category_id, sort_order, is_active
    from disqualifiers where id = ${id}
  `;
  const row = rows[0];
  return row === undefined ? null : mapDisqualifier(row);
}

export async function listDisqualifierKeys(sql: Queryable): Promise<string[]> {
  const rows = await sql<{ key: string }[]>`select key from disqualifiers`;
  return rows.map((row) => row.key);
}

export async function insertDisqualifier(
  sql: Queryable,
  input: {
    key: string;
    label: string;
    roleCategoryId: string | null;
    sortOrder: number;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into disqualifiers (key, label, role_category_id, sort_order)
    values (${input.key}, ${input.label}, ${input.roleCategoryId}, ${input.sortOrder})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('disqualifier insert returned no row');
  return row.id;
}

export async function updateDisqualifier(
  sql: Queryable,
  id: string,
  patch: {
    label?: string;
    roleCategoryId?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<void> {
  await sql`
    update disqualifiers set
      label      = coalesce(${patch.label ?? null}, label),
      sort_order = coalesce(${patch.sortOrder ?? null}, sort_order),
      is_active  = coalesce(${patch.isActive ?? null}, is_active),
      role_category_id = ${
        patch.roleCategoryId === undefined
          ? sql`role_category_id`
          : patch.roleCategoryId
      }
    where id = ${id}
  `;
}

// ---------------------------------------------------------------------------
// Rejection reasons
// ---------------------------------------------------------------------------

interface RejectionReasonRow {
  id: string;
  key: string;
  label: string;
  actor: RejectionActor;
  sort_order: number;
  is_active: boolean;
}

function mapRejectionReason(row: RejectionReasonRow): RejectionReason {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    actor: row.actor,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export async function listRejectionReasons(
  sql: Queryable,
  filter: { actor?: RejectionActor; isActive?: boolean } = {},
): Promise<RejectionReason[]> {
  const rows = await sql<RejectionReasonRow[]>`
    select id, key, label, actor, sort_order, is_active
    from rejection_reasons
    where true
      ${filter.actor === undefined ? sql`` : sql`and actor = ${filter.actor}::rejection_actor`}
      ${filter.isActive === undefined ? sql`` : sql`and is_active = ${filter.isActive}`}
    order by actor, sort_order, label
  `;
  return rows.map(mapRejectionReason);
}

export async function findRejectionReasonById(
  sql: Queryable,
  id: string,
): Promise<RejectionReason | null> {
  const rows = await sql<RejectionReasonRow[]>`
    select id, key, label, actor, sort_order, is_active
    from rejection_reasons where id = ${id}
  `;
  const row = rows[0];
  return row === undefined ? null : mapRejectionReason(row);
}

export async function listRejectionReasonKeys(sql: Queryable): Promise<string[]> {
  const rows = await sql<{ key: string }[]>`select key from rejection_reasons`;
  return rows.map((row) => row.key);
}

export async function insertRejectionReason(
  sql: Queryable,
  input: {
    key: string;
    label: string;
    actor: RejectionActor;
    sortOrder: number;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into rejection_reasons (key, label, actor, sort_order)
    values (${input.key}, ${input.label}, ${input.actor}::rejection_actor,
            ${input.sortOrder})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('rejection_reason insert returned no row');
  return row.id;
}

export async function updateRejectionReason(
  sql: Queryable,
  id: string,
  patch: {
    label?: string;
    actor?: RejectionActor;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<void> {
  await sql`
    update rejection_reasons set
      label      = coalesce(${patch.label ?? null}, label),
      sort_order = coalesce(${patch.sortOrder ?? null}, sort_order),
      is_active  = coalesce(${patch.isActive ?? null}, is_active),
      actor      = coalesce(${patch.actor ?? null}::rejection_actor, actor)
    where id = ${id}
  `;
}
