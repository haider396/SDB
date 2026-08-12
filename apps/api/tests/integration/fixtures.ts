/**
 * Row-level fixtures for integration tests. Thin inserts only — no business
 * logic — so each test states exactly the data it depends on. All ids are
 * random UUIDs unless supplied; unique references get a random suffix.
 */
import { randomUUID } from 'node:crypto';
import type { UserRoleKey } from '@sdb/contracts';
import type postgres from 'postgres';
import type { Queryable } from '../../src/lib/db.js';

let refCounter = 0;
function uniqueRef(prefix: string): string {
  refCounter += 1;
  return `${prefix}-${Date.now() % 1_000_000}${refCounter.toString().padStart(3, '0')}`;
}

export async function insertUser(
  sql: Queryable,
  opts: { id?: string; email?: string; fullName?: string } = {},
): Promise<string> {
  const id = opts.id ?? randomUUID();
  const email = opts.email ?? `user-${id.slice(0, 8)}@example.com`;
  const fullName = opts.fullName ?? `Test User ${id.slice(0, 8)}`;
  await sql`
    insert into users (id, email, full_name)
    values (${id}, ${email}, ${fullName})
  `;
  return id;
}

export async function assignRole(
  sql: Queryable,
  userId: string,
  roleKey: UserRoleKey,
  clientId?: string,
): Promise<void> {
  await sql`
    insert into user_roles (user_id, role_id, scope_type, scope_id)
    values (
      ${userId},
      (select id from roles where key = ${roleKey}),
      ${clientId === undefined ? null : 'client'},
      ${clientId ?? null}
    )
  `;
}

export async function insertClient(
  sql: Queryable,
  opts: {
    id?: string;
    companyName?: string;
    paymentConfirmed?: boolean;
    portalAccessEnabled?: boolean;
  } = {},
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await sql`
    insert into clients (id, company_name, status, payment_confirmed_at, portal_access_enabled_at)
    values (
      ${id},
      ${opts.companyName ?? `Client ${id.slice(0, 8)}`},
      'active',
      ${opts.paymentConfirmed === false ? null : sql`now()`},
      ${opts.portalAccessEnabled === true ? sql`now()` : null}
    )
  `;
  return id;
}

export async function insertClientMember(
  sql: Queryable,
  opts: {
    clientId: string;
    userId: string;
    isPrimaryContact?: boolean;
    isPrincipal?: boolean;
  },
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into client_members (id, client_id, user_id, is_primary_contact, is_principal, accepted_at)
    values (${id}, ${opts.clientId}, ${opts.userId},
            ${opts.isPrimaryContact ?? false}, ${opts.isPrincipal ?? false}, now())
  `;
  return id;
}

export async function insertRequisition(
  sql: Queryable,
  opts: { id?: string; clientId: string },
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await sql`
    insert into requisitions (id, reference, client_id)
    values (${id}, ${uniqueRef('REQ-IT')}, ${opts.clientId})
  `;
  return id;
}

/** Candidate with every gated PII field populated, so gating is observable. */
export async function insertCandidate(
  sql: Queryable,
  opts: { id?: string; firstName?: string; lastName?: string } = {},
): Promise<string> {
  const id = opts.id ?? randomUUID();
  const short = id.slice(0, 8);
  // `source` is set explicitly: the column default in migration 0007
  // ('manual'::text::candidate_source) casts to a value the enum does not
  // contain, so relying on the default fails at insert time. Flagged as a
  // schema defect for a forward-only fix migration; tests do not mask it.
  await sql`
    insert into candidates (
      id, reference, first_name, last_name,
      email, phone, whatsapp, linkedin_url, current_employer, current_title, country,
      source
    ) values (
      ${id}, ${uniqueRef('CAN-IT')},
      ${opts.firstName ?? `First${short}`}, ${opts.lastName ?? `Last${short}`},
      ${`candidate-${short}@example.com`}, ${'+1-555-0000'}, ${'+1-555-0001'},
      ${`https://linkedin.com/in/c${short}`}, ${'Employer Inc'}, ${'Specialist'}, ${'Mexico'},
      'other'
    )
  `;
  return id;
}

export async function insertAssignment(
  sql: Queryable,
  opts: {
    id?: string;
    requisitionId: string;
    candidateId: string;
    assignedBy: string;
    stage?: string;
  },
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await sql`
    insert into assignments (id, requisition_id, candidate_id, assigned_by, stage)
    values (${id}, ${opts.requisitionId}, ${opts.candidateId}, ${opts.assignedBy},
            ${opts.stage ?? 'sourced'}::assignment_stage)
  `;
  return id;
}

export async function insertQuestionCategory(
  sql: Queryable,
  opts: { id?: string; key?: string } = {},
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await sql`
    insert into question_categories (id, key, label)
    values (${id}, ${opts.key ?? `cat_${id.slice(0, 8)}`}, 'Test Category')
  `;
  return id;
}

export async function insertQuestion(
  sql: Queryable,
  opts: {
    id?: string;
    categoryId: string;
    questionType: string;
    key?: string;
    label?: string;
    audience?: 'client' | 'internal';
    isRequired?: boolean;
    isActive?: boolean;
    sortOrder?: number;
    validation?: Record<string, unknown>;
  },
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await sql`
    insert into questions (id, category_id, key, label, question_type,
                           audience, is_required, is_active, sort_order, validation)
    values (${id}, ${opts.categoryId}, ${opts.key ?? `q_${id.slice(0, 8)}`},
            ${opts.label ?? 'Test Question'}, ${opts.questionType}::question_type,
            ${opts.audience ?? 'client'}::question_audience,
            ${opts.isRequired ?? false}, ${opts.isActive ?? true},
            ${opts.sortOrder ?? 0},
            ${sql.json((opts.validation ?? {}) as postgres.JSONValue)})
  `;
  return id;
}

export async function insertQuestionOption(
  sql: Queryable,
  opts: {
    id?: string;
    questionId: string;
    value?: string;
    label?: string;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await sql`
    insert into question_options (id, question_id, value, label, sort_order, is_active)
    values (${id}, ${opts.questionId}, ${opts.value ?? `opt_${id.slice(0, 8)}`},
            ${opts.label ?? 'Option'}, ${opts.sortOrder ?? 0}, ${opts.isActive ?? true})
  `;
  return id;
}

export async function scopeQuestionToRole(
  sql: Queryable,
  questionId: string,
  roleCategoryId: string,
): Promise<void> {
  await sql`
    insert into question_role_scopes (question_id, role_category_id)
    values (${questionId}, ${roleCategoryId})
    on conflict do nothing
  `;
}

/** Minimal engine → department → role_category chain for scoping tests. */
export async function insertTaxonomyChain(
  sql: Queryable,
  opts: { engineKey?: string } = {},
): Promise<{
  engineId: string;
  engineKey: string;
  departmentId: string;
  departmentKey: string;
  roleCategoryId: string;
  roleCategoryKey: string;
}> {
  const engineKey = opts.engineKey ?? 'operations';
  const engineRows = await sql<{ id: string }[]>`
    select id from engines where key = ${engineKey}
  `;
  const engineId = engineRows[0]?.id;
  if (engineId === undefined) {
    throw new Error(`engine ${engineKey} not seeded`);
  }
  const departmentId = randomUUID();
  const departmentKey = `dept_${departmentId.slice(0, 8)}`;
  await sql`
    insert into departments (id, engine_id, key, label)
    values (${departmentId}, ${engineId}, ${departmentKey}, 'Test Department')
  `;
  const roleCategoryId = randomUUID();
  const roleCategoryKey = `role_${roleCategoryId.slice(0, 8)}`;
  await sql`
    insert into role_categories (id, department_id, key, label)
    values (${roleCategoryId}, ${departmentId}, ${roleCategoryKey}, 'Test Role')
  `;
  return {
    engineId,
    engineKey,
    departmentId,
    departmentKey,
    roleCategoryId,
    roleCategoryKey,
  };
}

export interface AnswerValues {
  valueText?: string | null;
  valueNumber?: number | null;
  valueBoolean?: boolean | null;
  valueDate?: string | null;
  valueJson?: postgres.JSONValue | null;
}

export async function insertAnswer(
  sql: Queryable,
  opts: {
    id?: string;
    requisitionId: string;
    questionId: string;
    questionKey?: string;
  } & AnswerValues,
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await sql`
    insert into requisition_answers (
      id, requisition_id, question_id, question_key,
      value_text, value_number, value_boolean, value_date, value_json,
      question_snapshot
    ) values (
      ${id}, ${opts.requisitionId}, ${opts.questionId},
      ${opts.questionKey ?? 'test_question'},
      ${opts.valueText ?? null}, ${opts.valueNumber ?? null},
      ${opts.valueBoolean ?? null}, ${opts.valueDate ?? null},
      ${opts.valueJson === undefined || opts.valueJson === null ? null : sql.json(opts.valueJson)},
      ${sql.json({ label: 'Test Question', questionType: 'snapshot' })}
    )
  `;
  return id;
}
