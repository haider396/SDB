/**
 * SQL for public candidate registration (T38). No business rules here — the
 * service owns validation, projection, and the transaction boundary.
 */
import type { Queryable } from '../lib/db.js';

export interface RegistrationSession {
  id: string;
  candidateId: string | null;
  submittedAt: Date | null;
  expiresAt: Date;
}

interface SessionRow {
  id: string;
  candidate_id: string | null;
  submitted_at: Date | null;
  expires_at: Date;
}

export async function createRegistrationSession(
  sql: Queryable,
  meta: { ipHash: string | null; userAgent: string | null },
): Promise<RegistrationSession> {
  const rows = await sql<SessionRow[]>`
    insert into candidate_registration_sessions (ip_hash, user_agent)
    values (${meta.ipHash}, ${meta.userAgent})
    returning id, candidate_id, submitted_at, expires_at
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new Error('registration session insert returned no row');
  }
  return {
    id: row.id,
    candidateId: row.candidate_id,
    submittedAt: row.submitted_at,
    expiresAt: row.expires_at,
  };
}

export async function getRegistrationSession(
  sql: Queryable,
  sessionId: string,
): Promise<RegistrationSession | null> {
  const rows = await sql<SessionRow[]>`
    select id, candidate_id, submitted_at, expires_at
    from candidate_registration_sessions
    where id = ${sessionId}
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    candidateId: row.candidate_id,
    submittedAt: row.submitted_at,
    expiresAt: row.expires_at,
  };
}

export async function markSessionSubmitted(
  sql: Queryable,
  sessionId: string,
  candidateId: string,
): Promise<void> {
  await sql`
    update candidate_registration_sessions
       set submitted_at = now(), candidate_id = ${candidateId}
     where id = ${sessionId}
  `;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export interface InsertCandidateAnswerInput {
  candidateId: string;
  /**
   * The submission this answer belongs to (0020). Null for admin-entered
   * answers, which keep the original one-per-candidate rule; a submission's
   * answers are unique per (candidate, question, submission), which is what
   * lets the same question be answered on two different forms.
   */
  submissionId?: string | null;
  questionId: string;
  questionKey: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: unknown;
  questionSnapshot: Record<string, unknown>;
}

/** Returns the new answer id so option rows can be attached to it. */
export async function insertCandidateAnswer(
  sql: Queryable,
  input: InsertCandidateAnswerInput,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_answers (
      candidate_id, submission_id, question_id, question_key,
      value_text, value_number, value_boolean, value_date, value_json,
      question_snapshot, answered_by
    ) values (
      ${input.candidateId},
      ${input.submissionId ?? null},
      ${input.questionId},
      ${input.questionKey},
      ${input.valueText},
      ${input.valueNumber},
      ${input.valueBoolean},
      ${input.valueDate},
      ${input.valueJson === null || input.valueJson === undefined
        ? null
        : sql.json(input.valueJson as never)},
      ${sql.json(input.questionSnapshot as never)},
      ${null}
    )
    returning id
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new Error('candidate answer insert returned no row');
  }
  return row.id;
}

export async function insertCandidateAnswerOptions(
  sql: Queryable,
  answerId: string,
  optionIds: string[],
): Promise<void> {
  if (optionIds.length === 0) return;
  await sql`
    insert into candidate_answer_options ${sql(
      optionIds.map((optionId) => ({ answer_id: answerId, option_id: optionId })),
    )}
  `;
}

// ---------------------------------------------------------------------------
// Staged uploads
// ---------------------------------------------------------------------------

export interface StageRegistrationFileInput {
  sessionId: string;
  fileType: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

export async function stageRegistrationFile(
  sql: Queryable,
  input: StageRegistrationFileInput,
): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_registration_files (
      session_id, file_type, storage_path, original_filename, mime_type, size_bytes
    ) values (
      ${input.sessionId},
      ${input.fileType}::candidate_file_type,
      ${input.storagePath},
      ${input.originalFilename},
      ${input.mimeType},
      ${input.sizeBytes}
    )
    returning id
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new Error('registration file insert returned no row');
  }
  return { id: row.id };
}

export interface StagedRegistrationFile {
  id: string;
  storagePath: string;
  sizeBytes: number;
  confirmedAt: Date | null;
}

/** One staged upload, scoped to its session so a file id alone proves nothing. */
export async function findRegistrationFile(
  sql: Queryable,
  sessionId: string,
  fileId: string,
): Promise<StagedRegistrationFile | null> {
  const rows = await sql<
    { id: string; storage_path: string; size_bytes: string; confirmed_at: Date | null }[]
  >`
    select id, storage_path, size_bytes, confirmed_at
      from candidate_registration_files
     where id = ${fileId} and session_id = ${sessionId}
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    storagePath: row.storage_path,
    // size_bytes is bigint; postgres.js returns it as a string.
    sizeBytes: Number(row.size_bytes),
    confirmedAt: row.confirmed_at,
  };
}

/** Staged rows for a session, used to cap how many objects one session may mint. */
export async function countStagedFiles(
  sql: Queryable,
  sessionId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*) as count
      from candidate_registration_files
     where session_id = ${sessionId}
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function confirmRegistrationFile(
  sql: Queryable,
  sessionId: string,
  fileId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidate_registration_files
       set confirmed_at = now()
     where id = ${fileId} and session_id = ${sessionId}
    returning id
  `;
  return rows.length > 0;
}

/**
 * Promote confirmed staged uploads into candidate_files.
 *
 * Only rows the caller listed AND that were confirmed are promoted — an
 * unconfirmed row means the browser never finished the PUT, so the object may
 * not exist (06-BACKEND §6 step 3).
 *
 * `is_client_visible` is deliberately false: a self-registered candidate's
 * documents are internal until a recruiter decides otherwise.
 */
export async function attachRegistrationFiles(
  sql: Queryable,
  input: {
    candidateId: string;
    sessionId: string;
    files: { fileId: string; fileType: string }[];
  },
): Promise<number> {
  const ids = input.files.map((file) => file.fileId);
  if (ids.length === 0) return 0;
  const rows = await sql<{ id: string }[]>`
    insert into candidate_files (
      candidate_id, file_type, storage_path, original_filename,
      mime_type, size_bytes, is_client_visible, uploaded_by
    )
    select ${input.candidateId}, f.file_type, f.storage_path, f.original_filename,
           f.mime_type, f.size_bytes, false, null
    from candidate_registration_files f
    where f.session_id = ${input.sessionId}
      and f.id = any(${ids}::uuid[])
      and f.confirmed_at is not null
    returning id
  `;
  return rows.length;
}

/** Expiry sweep support — abandoned sessions and their staged rows. */
export async function findExpiredSessions(
  sql: Queryable,
  limit = 500,
): Promise<{ id: string; storagePaths: string[] }[]> {
  // The 'not exists' clause is belt-and-braces: a failed submit rolls the whole
  // transaction back, so an unsubmitted session should never own a promoted
  // path. But promotion does NOT move the object (0017), so if that assumption
  // is ever wrong the sweep would delete a real candidate's CV. Cheap insurance.
  const rows = await sql<{ id: string; storage_paths: string[] }[]>`
    select s.id,
           coalesce(
             array_agg(f.storage_path) filter (
               where f.id is not null
                 and not exists (
                   select 1 from candidate_files cf
                    where cf.storage_path = f.storage_path
                 )
             ),
             '{}'
           ) as storage_paths
    from candidate_registration_sessions s
    left join candidate_registration_files f on f.session_id = s.id
    where s.submitted_at is null and s.expires_at < now()
    group by s.id
    limit ${limit}
  `;
  return rows.map((row) => ({ id: row.id, storagePaths: row.storage_paths }));
}

export async function deleteSessions(
  sql: Queryable,
  sessionIds: string[],
): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const rows = await sql<{ id: string }[]>`
    delete from candidate_registration_sessions
    where id = any(${sessionIds}::uuid[])
    returning id
  `;
  return rows.length;
}
