/**
 * Taxonomy management (docs/04-API.md §5).
 *
 * - Engines are a fixed set of five: no POST/DELETE route exists (404), and
 *   PATCH accepts only label/isStaffed/sortOrder — anything else is 400.
 * - Departments (unique (engine_id, key)) and role categories (unique
 *   (department_id, key)): CRUD + deactivate, auto-slug keys, key immutability.
 * - Tools/skills/industries: GET/POST reference data with isActive on the
 *   response.
 * - Disqualifiers and rejection reasons: CRUD; rejection-reason create
 *   requires an actor and keys are immutable after creation.
 * - Permissions: settings.manage (super_admin only) for writes,
 *   requisition.view for reads (all four roles).
 * - Every write emits an events row (CLAUDE.md rule 6).
 * - Engine/department/role-category writes invalidate the cached
 *   GET /taxonomy/public payload.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  Department,
  Disqualifier,
  Engine,
  PublicTaxonomy,
  RejectionReason,
  RoleCategory,
  Tool,
} from '@sdb/contracts';
import {
  assignRole,
  insertClient,
  insertClientMember,
  insertUser,
} from './fixtures.js';
import { buildTestApp, freshDb, type TestApp, type TestDb } from './harness.js';

interface Collection<T> {
  data: T[];
  meta: { count: number; nextCursor: string | null };
}
interface Envelope<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; details?: Record<string, unknown> };
}

let db: TestDb;
let harness: TestApp;
let superAdminHeaders: Record<string, string>;
let adminHeaders: Record<string, string>;
let clientUserHeaders: Record<string, string>;
let engineByKey: Map<string, Engine>;

async function countEvents(
  entityType: string,
  entityId: string,
  eventType: string,
): Promise<number> {
  const rows = await db.sql<{ n: string }[]>`
    select count(*) as n from events
    where entity_type = ${entityType}
      and entity_id = ${entityId}
      and event_type = ${eventType}
  `;
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  db = await freshDb();

  const superAdmin = await insertUser(db.sql);
  await assignRole(db.sql, superAdmin, 'super_admin');
  const admin = await insertUser(db.sql);
  await assignRole(db.sql, admin, 'admin');
  const clientId = await insertClient(db.sql);
  const clientUser = await insertUser(db.sql);
  await assignRole(db.sql, clientUser, 'client_user', clientId);
  await insertClientMember(db.sql, { clientId, userId: clientUser });

  harness = await buildTestApp(db);
  superAdminHeaders = await harness.bearer(superAdmin);
  adminHeaders = await harness.bearer(admin);
  clientUserHeaders = await harness.bearer(clientUser);

  const res = await harness.app.inject({
    method: 'GET',
    url: '/api/v1/engines',
    headers: superAdminHeaders,
  });
  engineByKey = new Map(
    res.json<Collection<Engine>>().data.map((engine) => [engine.key, engine]),
  );
});

afterAll(async () => {
  await harness.app.close();
  await db.close();
});

// ---------------------------------------------------------------------------
// Engines — the five fixed rows
// ---------------------------------------------------------------------------

describe('engines — fixed set of five (04 §5)', () => {
  it('GET /engines lists the 5 seeded engines in sort order', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/engines',
      headers: clientUserHeaders,
    });
    expect(res.statusCode).toBe(200);
    const { data, meta } = res.json<Collection<Engine>>();
    expect(meta.count).toBe(5);
    expect(data.map((engine) => engine.key)).toEqual([
      'revenue',
      'brand',
      'client_experience',
      'operations',
      'leadership',
    ]);
    // Staffed per 0011: Brand, Client Experience, Operations.
    expect(
      data.filter((engine) => engine.isStaffed).map((engine) => engine.key),
    ).toEqual(['brand', 'client_experience', 'operations']);
  });

  it('supports the isActive filter', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/engines?isActive=false',
      headers: clientUserHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Collection<Engine>>().meta.count).toBe(0);
  });

  it('no POST /engines route exists — engines cannot be created', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/engines',
      headers: superAdminHeaders,
      payload: { key: 'sixth_engine', label: 'Sixth Engine' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('no DELETE /engines/:id route exists — engines cannot be deleted', async () => {
    const engine = engineByKey.get('revenue')!;
    const res = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/engines/${engine.id}`,
      headers: superAdminHeaders,
    });
    expect(res.statusCode).toBe(404);
    const still = await db.sql`select id from engines where id = ${engine.id}`;
    expect(still).toHaveLength(1);
  });

  it('PATCH edits label, isStaffed, sortOrder — and writes an event', async () => {
    const engine = engineByKey.get('leadership')!;
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/engines/${engine.id}`,
      headers: superAdminHeaders,
      payload: { label: 'Leadership & Vision', isStaffed: true, sortOrder: 6 },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<Envelope<Engine>>();
    expect(data.label).toBe('Leadership & Vision');
    expect(data.isStaffed).toBe(true);
    expect(data.sortOrder).toBe(6);
    expect(data.key).toBe('leadership'); // untouched

    expect(await countEvents('engine', engine.id, 'engine_updated')).toBe(1);
  });

  it.each([
    ['key', { key: 'renamed' }],
    ['description', { description: 'rewritten' }],
    ['isActive', { isActive: false }],
    ['mixed valid+invalid', { label: 'Ops', key: 'sneaky' }],
  ])('PATCH rejects a field outside label/isStaffed/sortOrder: %s', async (_name, payload) => {
    const engine = engineByKey.get('operations')!;
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/engines/${engine.id}`,
      headers: superAdminHeaders,
      payload,
    });
    expect(res.statusCode).toBe(400);
    const after = await db.sql<{ key: string; is_active: boolean }[]>`
      select key, is_active from engines where id = ${engine.id}
    `;
    expect(after[0]!.key).toBe('operations');
    expect(after[0]!.is_active).toBe(true);
  });

  it('PATCH of an unknown engine id is 404', async () => {
    const res = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/engines/${randomUUID()}`,
      headers: superAdminHeaders,
      payload: { label: 'Ghost' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

describe('departments — CRUD, auto-slug keys unique per engine, deactivate', () => {
  let created: Department;

  it('POST auto-slugs the key from the label and writes an event', async () => {
    const engine = engineByKey.get('operations')!;
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: superAdminHeaders,
      payload: { engineId: engine.id, label: 'Growth Marketing' },
    });
    expect(res.statusCode).toBe(201);
    created = res.json<Envelope<Department>>().data;
    expect(created.key).toBe('growth_marketing');
    expect(created.engineId).toBe(engine.id);
    expect(created.isActive).toBe(true);

    expect(
      await countEvents('department', created.id, 'department_created'),
    ).toBe(1);
  });

  it('a second department with the same label gets a suffixed key', async () => {
    const engine = engineByKey.get('operations')!;
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: superAdminHeaders,
      payload: { engineId: engine.id, label: 'Growth Marketing' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<Envelope<Department>>().data.key).toBe('growth_marketing_2');
  });

  it('an explicit duplicate key within the engine is 422', async () => {
    const engine = engineByKey.get('operations')!;
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: superAdminHeaders,
      payload: {
        engineId: engine.id,
        key: 'growth_marketing',
        label: 'Another Growth',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<ErrorBody>().error.code).toBe('VALIDATION_FAILED');
  });

  it('the same key under a DIFFERENT engine is fine (unique per engine)', async () => {
    const engine = engineByKey.get('brand')!;
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: superAdminHeaders,
      payload: { engineId: engine.id, key: 'growth_marketing', label: 'Growth' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST with an unknown engineId is 404', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: superAdminHeaders,
      payload: { engineId: randomUUID(), label: 'Orphan' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH edits label/sortOrder; a key change is 422 (immutable)', async () => {
    const ok = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/departments/${created.id}`,
      headers: superAdminHeaders,
      payload: { label: 'Growth & Demand', sortOrder: 7 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<Envelope<Department>>().data.label).toBe('Growth & Demand');
    expect(await countEvents('department', created.id, 'department_updated')).toBe(1);

    const rekey = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/departments/${created.id}`,
      headers: superAdminHeaders,
      payload: { key: 'different_key' },
    });
    expect(rekey.statusCode).toBe(422);
    expect(rekey.json<ErrorBody>().error.code).toBe('VALIDATION_FAILED');
  });

  it('deactivate sets is_active = false, writes an event; PATCH reactivates', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/departments/${created.id}/deactivate`,
      headers: superAdminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Envelope<Department>>().data.isActive).toBe(false);
    const row = await db.sql<{ is_active: boolean }[]>`
      select is_active from departments where id = ${created.id}
    `;
    expect(row[0]!.is_active).toBe(false);
    expect(
      await countEvents('department', created.id, 'department_deactivated'),
    ).toBe(1);

    // Deactivating an already-inactive department is idempotent — no 2nd event.
    const again = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/departments/${created.id}/deactivate`,
      headers: superAdminHeaders,
    });
    expect(again.statusCode).toBe(200);
    expect(
      await countEvents('department', created.id, 'department_deactivated'),
    ).toBe(1);

    const reactivate = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/departments/${created.id}`,
      headers: superAdminHeaders,
      payload: { isActive: true },
    });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json<Envelope<Department>>().data.isActive).toBe(true);
  });

  it('GET filters by engineId and isActive', async () => {
    const engine = engineByKey.get('operations')!;
    const res = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/departments?engineId=${engine.id}&isActive=true`,
      headers: clientUserHeaders,
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<Collection<Department>>();
    expect(data.length).toBeGreaterThanOrEqual(2);
    for (const department of data) {
      expect(department.engineId).toBe(engine.id);
      expect(department.isActive).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Role categories
// ---------------------------------------------------------------------------

describe('role categories — CRUD, keys unique per department, deactivate', () => {
  let departmentId: string;
  let otherDepartmentId: string;
  let created: RoleCategory;

  beforeAll(async () => {
    const engine = engineByKey.get('client_experience')!;
    for (const label of ['Support', 'Success']) {
      const res = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/departments',
        headers: superAdminHeaders,
        payload: { engineId: engine.id, label },
      });
      const department = res.json<Envelope<Department>>().data;
      if (label === 'Support') departmentId = department.id;
      else otherDepartmentId = department.id;
    }
  });

  it('POST auto-slugs the key and writes an event', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/role-categories',
      headers: superAdminHeaders,
      payload: {
        departmentId,
        label: 'Customer Support Rep',
        advertisedTitle: 'Customer Support Specialist',
        description: 'Front-line support',
      },
    });
    expect(res.statusCode).toBe(201);
    created = res.json<Envelope<RoleCategory>>().data;
    expect(created.key).toBe('customer_support_rep');
    expect(created.departmentId).toBe(departmentId);
    expect(created.advertisedTitle).toBe('Customer Support Specialist');
    expect(created.isActive).toBe(true);
    expect(
      await countEvents('role_category', created.id, 'role_category_created'),
    ).toBe(1);
  });

  it('duplicate key in the same department is 422; other department is fine', async () => {
    const dup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/role-categories',
      headers: superAdminHeaders,
      payload: { departmentId, key: 'customer_support_rep', label: 'Dup' },
    });
    expect(dup.statusCode).toBe(422);

    const other = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/role-categories',
      headers: superAdminHeaders,
      payload: {
        departmentId: otherDepartmentId,
        key: 'customer_support_rep',
        label: 'Same Key Elsewhere',
      },
    });
    expect(other.statusCode).toBe(201);
  });

  it('POST with an unknown departmentId is 404', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/role-categories',
      headers: superAdminHeaders,
      payload: { departmentId: randomUUID(), label: 'Orphan' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH edits fields; a key change is 422 (immutable)', async () => {
    const ok = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/role-categories/${created.id}`,
      headers: superAdminHeaders,
      payload: { advertisedTitle: null, description: 'Updated', sortOrder: 3 },
    });
    expect(ok.statusCode).toBe(200);
    const updated = ok.json<Envelope<RoleCategory>>().data;
    expect(updated.advertisedTitle).toBeNull();
    expect(updated.description).toBe('Updated');
    expect(
      await countEvents('role_category', created.id, 'role_category_updated'),
    ).toBe(1);

    const rekey = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/role-categories/${created.id}`,
      headers: superAdminHeaders,
      payload: { key: 'rebranded' },
    });
    expect(rekey.statusCode).toBe(422);
  });

  it('deactivate sets is_active = false and writes an event', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/role-categories/${created.id}/deactivate`,
      headers: superAdminHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Envelope<RoleCategory>>().data.isActive).toBe(false);
    expect(
      await countEvents('role_category', created.id, 'role_category_deactivated'),
    ).toBe(1);
  });

  it('GET filters by departmentId, engineId, isActive', async () => {
    const engine = engineByKey.get('client_experience')!;
    const byDepartment = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/role-categories?departmentId=${departmentId}`,
      headers: clientUserHeaders,
    });
    expect(byDepartment.statusCode).toBe(200);
    for (const roleCategory of byDepartment.json<Collection<RoleCategory>>().data) {
      expect(roleCategory.departmentId).toBe(departmentId);
    }

    const byEngine = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/role-categories?engineId=${engine.id}&isActive=true`,
      headers: clientUserHeaders,
    });
    expect(byEngine.statusCode).toBe(200);
    const { data } = byEngine.json<Collection<RoleCategory>>();
    expect(data.some((roleCategory) => roleCategory.id === created.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reference data: tools, skills, industries
// ---------------------------------------------------------------------------

describe('tools / skills / industries — GET/POST reference data (04 §5)', () => {
  it('POST /tools creates with isActive on the response; duplicates are 422', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tools',
      headers: superAdminHeaders,
      payload: { name: 'HubSpot IT', category: 'CRM' },
    });
    expect(res.statusCode).toBe(201);
    const tool = res.json<Envelope<Tool>>().data;
    expect(tool.name).toBe('HubSpot IT');
    expect(tool.category).toBe('CRM');
    expect(tool.isActive).toBe(true);
    expect(await countEvents('tool', tool.id, 'tool_created')).toBe(1);

    const dup = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tools',
      headers: superAdminHeaders,
      payload: { name: 'HubSpot IT' },
    });
    expect(dup.statusCode).toBe(422);

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tools?isActive=true',
      headers: clientUserHeaders,
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json<Collection<Tool>>();
    expect(listed.data.some((entry) => entry.id === tool.id)).toBe(true);
    expect(listed.meta.nextCursor).toBeNull();
  });

  it('POST /skills mirrors tools (name + optional category)', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/skills',
      headers: superAdminHeaders,
      payload: { name: 'Copywriting IT' },
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json<Envelope<Tool>>().data;
    expect(skill.category).toBeNull();
    expect(skill.isActive).toBe(true);
    expect(await countEvents('skill', skill.id, 'skill_created')).toBe(1);
  });

  it('POST /industries takes a name only', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/industries',
      headers: superAdminHeaders,
      payload: { name: 'Legal Services IT' },
    });
    expect(res.statusCode).toBe(201);
    const industry = res.json<Envelope<{ id: string; name: string; isActive: boolean }>>().data;
    expect(industry.isActive).toBe(true);
    expect(await countEvents('industry', industry.id, 'industry_created')).toBe(1);

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/industries',
      headers: clientUserHeaders,
    });
    expect(list.statusCode).toBe(200);
    expect(
      list
        .json<Collection<{ id: string }>>()
        .data.some((entry) => entry.id === industry.id),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Disqualifiers
// ---------------------------------------------------------------------------

describe('disqualifiers — CRUD with immutable keys and role-category scope', () => {
  let globalDisqualifier: Disqualifier;
  let roleCategoryId: string;

  beforeAll(async () => {
    const engine = engineByKey.get('brand')!;
    const department = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: superAdminHeaders,
      payload: { engineId: engine.id, label: 'Design' },
    });
    const roleCategory = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/role-categories',
      headers: superAdminHeaders,
      payload: {
        departmentId: department.json<Envelope<Department>>().data.id,
        label: 'Brand Designer',
      },
    });
    roleCategoryId = roleCategory.json<Envelope<RoleCategory>>().data.id;
  });

  it('POST creates a global disqualifier (auto-slug key) and writes an event', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/disqualifiers',
      headers: superAdminHeaders,
      payload: { label: 'No professional English' },
    });
    expect(res.statusCode).toBe(201);
    globalDisqualifier = res.json<Envelope<Disqualifier>>().data;
    expect(globalDisqualifier.key).toBe('no_professional_english');
    expect(globalDisqualifier.roleCategoryId).toBeNull();
    expect(globalDisqualifier.isActive).toBe(true);
    expect(
      await countEvents('disqualifier', globalDisqualifier.id, 'disqualifier_created'),
    ).toBe(1);
  });

  it('a role-scoped disqualifier lists under its scope along with globals', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/disqualifiers',
      headers: superAdminHeaders,
      payload: { label: 'No portfolio', roleCategoryId },
    });
    expect(res.statusCode).toBe(201);
    const scoped = res.json<Envelope<Disqualifier>>().data;
    expect(scoped.roleCategoryId).toBe(roleCategoryId);

    const list = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/disqualifiers?roleCategoryId=${roleCategoryId}`,
      headers: clientUserHeaders,
    });
    expect(list.statusCode).toBe(200);
    const ids = list.json<Collection<Disqualifier>>().data.map((entry) => entry.id);
    expect(ids).toContain(scoped.id); // in scope
    expect(ids).toContain(globalDisqualifier.id); // global applies everywhere
  });

  it('POST with an unknown roleCategoryId is 404', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/disqualifiers',
      headers: superAdminHeaders,
      payload: { label: 'Orphan check', roleCategoryId: randomUUID() },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH edits label/isActive; a key change is 422 (immutable)', async () => {
    const ok = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/disqualifiers/${globalDisqualifier.id}`,
      headers: superAdminHeaders,
      payload: { label: 'No business-level English', isActive: false },
    });
    expect(ok.statusCode).toBe(200);
    const updated = ok.json<Envelope<Disqualifier>>().data;
    expect(updated.label).toBe('No business-level English');
    expect(updated.isActive).toBe(false);
    expect(
      await countEvents('disqualifier', globalDisqualifier.id, 'disqualifier_updated'),
    ).toBe(1);

    const rekey = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/disqualifiers/${globalDisqualifier.id}`,
      headers: superAdminHeaders,
      payload: { key: 'renamed_check' },
    });
    expect(rekey.statusCode).toBe(422);
    expect(rekey.json<ErrorBody>().error.code).toBe('VALIDATION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Rejection reasons
// ---------------------------------------------------------------------------

describe('rejection reasons — seeded set, actor required, immutable keys', () => {
  it('GET lists the 16 seeded reasons, filterable by actor', async () => {
    const all = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/rejection-reasons',
      headers: clientUserHeaders,
    });
    expect(all.statusCode).toBe(200);
    expect(all.json<Collection<RejectionReason>>().meta.count).toBe(16);

    const client = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/rejection-reasons?actor=client',
      headers: clientUserHeaders,
    });
    expect(client.json<Collection<RejectionReason>>().meta.count).toBe(9);

    const admin = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/rejection-reasons?actor=admin',
      headers: clientUserHeaders,
    });
    const adminReasons = admin.json<Collection<RejectionReason>>();
    expect(adminReasons.meta.count).toBe(7);
    for (const reason of adminReasons.data) {
      expect(reason.actor).toBe('admin');
      expect(reason.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('POST requires the actor field', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/rejection-reasons',
      headers: superAdminHeaders,
      payload: { label: 'Visa complications' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST creates with an auto-slug key and writes an event', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/rejection-reasons',
      headers: superAdminHeaders,
      payload: { label: 'Visa complications', actor: 'admin' },
    });
    expect(res.statusCode).toBe(201);
    const reason = res.json<Envelope<RejectionReason>>().data;
    expect(reason.key).toBe('visa_complications');
    expect(reason.actor).toBe('admin');
    expect(reason.isActive).toBe(true);
    expect(
      await countEvents('rejection_reason', reason.id, 'rejection_reason_created'),
    ).toBe(1);
  });

  it('an explicit duplicate key is 422', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/rejection-reasons',
      headers: superAdminHeaders,
      payload: { key: 'skills_gap', label: 'Skills gap again', actor: 'client' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('PATCH edits label/sortOrder/isActive; key is immutable after creation', async () => {
    const rows = await db.sql<{ id: string; key: string }[]>`
      select id, key from rejection_reasons where key = 'unresponsive'
    `;
    const target = rows[0]!;

    const ok = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/rejection-reasons/${target.id}`,
      headers: superAdminHeaders,
      payload: { label: 'Candidate unresponsive', sortOrder: 20 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<Envelope<RejectionReason>>().data.label).toBe(
      'Candidate unresponsive',
    );
    expect(
      await countEvents('rejection_reason', target.id, 'rejection_reason_updated'),
    ).toBe(1);

    // Sending the CURRENT key is a no-op, not an error…
    const sameKey = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/rejection-reasons/${target.id}`,
      headers: superAdminHeaders,
      payload: { key: 'unresponsive', isActive: false },
    });
    expect(sameKey.statusCode).toBe(200);
    expect(sameKey.json<Envelope<RejectionReason>>().data.isActive).toBe(false);

    // …but a DIFFERENT key is rejected.
    const rekey = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/rejection-reasons/${target.id}`,
      headers: superAdminHeaders,
      payload: { key: 'ghosted_us' },
    });
    expect(rekey.statusCode).toBe(422);
    const after = await db.sql<{ key: string }[]>`
      select key from rejection_reasons where id = ${target.id}
    `;
    expect(after[0]!.key).toBe('unresponsive');
  });
});

// ---------------------------------------------------------------------------
// Permissions: settings.manage writes vs requisition.view reads
// ---------------------------------------------------------------------------

describe('permissions — settings.manage (super_admin only) vs requisition.view', () => {
  it('admin and client_user can READ every taxonomy list', async () => {
    for (const headers of [adminHeaders, clientUserHeaders]) {
      for (const url of [
        '/api/v1/engines',
        '/api/v1/departments',
        '/api/v1/role-categories',
        '/api/v1/tools',
        '/api/v1/skills',
        '/api/v1/industries',
        '/api/v1/disqualifiers',
        '/api/v1/rejection-reasons',
      ]) {
        const res = await harness.app.inject({ method: 'GET', url, headers });
        expect(res.statusCode, `GET ${url}`).toBe(200);
      }
    }
  });

  it('admin (settings.manage excluded per 02 §3) cannot WRITE', async () => {
    const engine = engineByKey.get('operations')!;
    const attempts = [
      {
        method: 'PATCH' as const,
        url: `/api/v1/engines/${engine.id}`,
        payload: { label: 'Nope' },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/departments',
        payload: { engineId: engine.id, label: 'Nope' },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/tools',
        payload: { name: 'Nope Tool' },
      },
      {
        method: 'POST' as const,
        url: '/api/v1/rejection-reasons',
        payload: { label: 'Nope', actor: 'admin' },
      },
    ];
    for (const attempt of attempts) {
      const res = await harness.app.inject({ ...attempt, headers: adminHeaders });
      expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403);
      const body = res.json<ErrorBody>();
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.details?.['requiredPermission']).toBe('settings.manage');
    }
  });

  it('client_user cannot WRITE either', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/skills',
      headers: clientUserHeaders,
      payload: { name: 'Client Skill' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// Public taxonomy cache invalidation
// ---------------------------------------------------------------------------

describe('GET /taxonomy/public cache is invalidated by taxonomy writes', () => {
  it('a role-category create appears immediately in the cached public payload', async () => {
    // Prime the cache.
    const before = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/taxonomy/public',
    });
    expect(before.statusCode).toBe(200);

    // Write through the admin surface: department + role category under a
    // STAFFED engine (operations), both visible in the public cascade.
    const engine = engineByKey.get('operations')!;
    const departmentRes = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: superAdminHeaders,
      payload: { engineId: engine.id, label: 'Fresh Cache Dept' },
    });
    expect(departmentRes.statusCode).toBe(201);
    const department = departmentRes.json<Envelope<Department>>().data;

    const roleCategoryRes = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/role-categories',
      headers: superAdminHeaders,
      payload: { departmentId: department.id, label: 'Fresh Cache Role' },
    });
    expect(roleCategoryRes.statusCode).toBe(201);
    const roleCategory = roleCategoryRes.json<Envelope<RoleCategory>>().data;

    // Within the cache TTL, the public payload must already contain the new
    // rows — the write invalidated the cache.
    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/taxonomy/public',
    });
    expect(after.statusCode).toBe(200);
    const { data } = after.json<{ data: PublicTaxonomy }>();
    const publicEngine = data.engines.find((entry) => entry.id === engine.id);
    const publicDepartment = publicEngine?.departments.find(
      (entry) => entry.id === department.id,
    );
    expect(publicDepartment).toBeDefined();
    expect(
      publicDepartment?.roleCategories.some((entry) => entry.id === roleCategory.id),
    ).toBe(true);

    // Deactivating the role category invalidates again — it disappears.
    const deactivate = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/role-categories/${roleCategory.id}/deactivate`,
      headers: superAdminHeaders,
    });
    expect(deactivate.statusCode).toBe(200);

    const afterDeactivate = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/taxonomy/public',
    });
    const payload = afterDeactivate.json<{ data: PublicTaxonomy }>().data;
    const stillThere = payload.engines
      .flatMap((entry) => entry.departments)
      .flatMap((entry) => entry.roleCategories)
      .some((entry) => entry.id === roleCategory.id);
    expect(stillThere).toBe(false);
  });
});
