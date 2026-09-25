/**
 * AC-DB-01 — all 11 migrations apply cleanly to an empty database and the
 *            schema matches docs/02-DATABASE.md.
 * AC-DB-02 — migrations are forward-only; re-running the re-runnable layer
 *            (0011 reference data + dev_seed) is a no-op.
 *
 * The harness itself enforces "apply exactly once": global-setup.ts builds
 * the template database by running 0001–0011 in order against an empty DB and
 * aborts the whole suite if any file errors — that IS the AC-DB-01 apply
 * check. The tests below assert the resulting schema, then prove the
 * by-design re-runnable layer (0011 is pure `on conflict do nothing`
 * reference data, as is dev_seed.sql) is idempotent.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDb, sqlFor, type TestDb } from './harness.js';
import { applyDevSeed, applySqlFile, MIGRATIONS_DIR } from './sql-files.js';

const EXPECTED_TABLES = [
  // 0002 identity
  'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
  // 0003 clients
  'clients', 'client_members',
  // 0004 taxonomy
  'engines', 'departments', 'role_categories', 'tools', 'skills', 'industries',
  // 0005 questions
  'question_categories', 'questions', 'question_options', 'question_role_scopes',
  // 0006 requisitions
  'requisitions', 'requisition_answers', 'requisition_answer_options',
  // 0007 candidates
  'candidates', 'candidate_languages', 'candidate_tools', 'candidate_skills',
  'candidate_industries', 'candidate_employment_history', 'candidate_education',
  'candidate_certifications', 'candidate_references', 'candidate_files',
  'candidate_notes', 'disqualifiers', 'candidate_disqualifier_checks',
  'candidate_assessments',
  // 0008 pipeline
  'assignments', 'rejection_reasons', 'rejections', 'interviews', 'placements',
  // 0009 events & ops
  'events', 'notification_log', 'webhook_ingest_log', 'app_settings',
  // 0017 candidate registration — candidates answer questions of their own,
  // so they need their own answer tables rather than sharing the client ones.
  'candidate_answers', 'candidate_answer_options',
  'candidate_registration_sessions', 'candidate_registration_files',
  // 0020 candidate form builder — a form is a versioned document of blocks
  // laid over the question library, and a submission ties one to a candidate.
  'candidate_forms', 'candidate_form_versions', 'candidate_form_blocks',
  'candidate_form_submissions',
].sort();

const EXPECTED_ENUMS = [
  'user_role_key', 'client_status', 'service_tier', 'requisition_status',
  'assignment_stage', 'rejection_actor', 'question_type', 'question_audience',
  'proficiency_level', 'language_level', 'accent_strength', 'rate_unit',
  'engagement_type', 'pool_status', 'vetting_status', 'employment_status',
  'autonomy_level', 'seniority_level', 'candidate_file_type',
  'candidate_source', 'submission_channel', 'data_completeness',
  'workspace_type', 'interview_outcome', 'placement_status',
  'notification_event',
  // 0030 — SDB's own ranking of a position. Deliberately NOT `urgency`, which
  // is the client's stated timeline captured at intake; see the migration.
  'requisition_priority',
].sort();

/** Key columns per critical table (docs/02-DATABASE.md §§3–10). */
const KEY_COLUMNS: Record<string, string[]> = {
  clients: ['payment_confirmed_at', 'portal_access_enabled_at', 'archived_at', 'status'],
  client_members: ['is_primary_contact', 'is_principal', 'accepted_at'],
  candidates: ['display_name', 'cv_search', 'do_not_present_to_client_ids',
    'has_consent_to_share_profile', 'pool_status', 'external_id', 'archived_at'],
  assignments: ['stage', 'requisition_id', 'candidate_id', 'presented_at', 'client_note'],
  requisitions: ['reference', 'client_id', 'status', 'principal_user_id', 'archived_at'],
  requisition_answers: ['value_text', 'value_number', 'value_boolean',
    'value_date', 'value_json', 'question_snapshot', 'question_key'],
  questions: ['key', 'question_type', 'audience', 'answer_count',
    'conditional_on_question_id', 'validation'],
  events: ['entity_type', 'entity_id', 'event_type', 'actor_id', 'from_value',
    'to_value', 'metadata', 'occurred_at'],
};

const EXPECTED_TRIGGER_FUNCTIONS = [
  'trg_answer_value_shape', 'trg_question_answer_count',
  'trg_block_question_type_change', 'trg_events_immutable',
  'trg_candidate_cv_search', 'trg_assignment_stage_event',
  'trg_requisition_status_event', 'trg_set_updated_at',
];

describe('AC-DB-01 — migrations apply cleanly and match the documented schema', () => {
  let db: TestDb;

  beforeAll(async () => {
    // freshDb() clones the template that global-setup built by applying all
    // 11 migrations to an empty database; reaching this point means they
    // applied cleanly.
    db = await freshDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates exactly the documented public tables', async () => {
    const rows = await db.sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'
    `;
    expect(rows.map((r) => r.tablename).sort()).toEqual(EXPECTED_TABLES);
  });

  it('creates all documented enum types', async () => {
    const rows = await db.sql<{ typname: string }[]>`
      select typname from pg_type
      where typtype = 'e'
        and typnamespace = 'public'::regnamespace
    `;
    expect(rows.map((r) => r.typname).sort()).toEqual(EXPECTED_ENUMS);
  });

  it('key tables carry their documented columns', async () => {
    const rows = await db.sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
    `;
    const byTable = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = byTable.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      byTable.set(row.table_name, set);
    }
    for (const [table, columns] of Object.entries(KEY_COLUMNS)) {
      const actual = byTable.get(table);
      expect(actual, `table ${table} missing`).toBeDefined();
      for (const column of columns) {
        expect(actual!.has(column), `${table}.${column} missing`).toBe(true);
      }
    }
  });

  it('creates the client_visible_assignments view with the gated PII columns', async () => {
    const rows = await db.sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'client_visible_assignments'
    `;
    const columns = new Set(rows.map((r) => r.column_name));
    expect(columns.size).toBeGreaterThan(0);
    for (const gated of ['first_name', 'last_name', 'email', 'phone',
      'whatsapp', 'linkedin_url', 'current_employer', 'display_name', 'stage']) {
      expect(columns.has(gated), `view missing ${gated}`).toBe(true);
    }
  });

  it('installs every documented trigger', async () => {
    const rows = await db.sql<{ tgname: string }[]>`
      select distinct tgname from pg_trigger where not tgisinternal
    `;
    const names = new Set(rows.map((r) => r.tgname));
    for (const trigger of EXPECTED_TRIGGER_FUNCTIONS) {
      expect(names.has(trigger), `trigger ${trigger} missing`).toBe(true);
    }
  });

  it('enables and forces row-level security on every table', async () => {
    const rows = await db.sql<{ relname: string }[]>`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and (c.relrowsecurity = false or c.relforcerowsecurity = false)
    `;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});

describe('AC-DB-02 — re-running the re-runnable layer is a no-op', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await freshDb({ seed: true });
  });

  afterAll(async () => {
    await db.close();
  });

  async function snapshotCounts(): Promise<Record<string, number>> {
    const tables = [
      'roles', 'permissions', 'role_permissions', 'engines',
      'rejection_reasons', 'app_settings', 'users', 'user_roles', 'clients',
      'client_members', 'departments', 'role_categories', 'tools', 'skills',
      'industries', 'question_categories', 'questions', 'question_options',
      'requisitions', 'requisition_answers', 'requisition_answer_options',
      'candidates', 'assignments', 'rejections', 'interviews', 'events',
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [row] = await db.sql.unsafe<{ n: string }[]>(
        `select count(*)::int as n from "${table}"`,
      );
      counts[table] = Number(row?.n ?? -1);
    }
    return counts;
  }

  it('0011 (reference data) and dev_seed.sql apply twice without changing a row', async () => {
    const before = await snapshotCounts();
    // Sanity: the seed actually populated the fixture.
    expect(before['candidates']).toBe(25);
    expect(before['permissions']).toBe(29);
    expect(before['roles']).toBe(4);

    // Single-connection handle: dev_seed.sql manages its own begin/commit.
    const reapply = sqlFor(db.url, 1);
    try {
      await applySqlFile(reapply, join(MIGRATIONS_DIR, '0011_seed_reference_data.sql'));
      await applyDevSeed(reapply);
    } finally {
      await reapply.end({ timeout: 5 });
    }

    const after = await snapshotCounts();
    expect(after).toEqual(before);
  });

  it('re-running a DDL migration is prevented by design (forward-only, applied exactly once)', async () => {
    // 0001–0010 are not idempotent by design — the harness (and production
    // CI via the Supabase migration table) applies each exactly once. Prove
    // the guard is real: re-applying a DDL migration errors instead of
    // silently mutating the schema.
    await expect(
      applySqlFile(db.sql, join(MIGRATIONS_DIR, '0002_identity.sql')),
    ).rejects.toThrowError(/already exists/);
  });
});
