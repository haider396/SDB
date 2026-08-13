/**
 * The required-field set behind `candidates.data_completeness`
 * (docs/04-API.md §8.2 behaviour 2, docs/06-BACKEND.md §5
 * flag-incomplete-candidates).
 *
 * Derived from the 04 §8.2 webhook payload: the contact, location, language,
 * experience, rate, and role-category fields a candidate record needs before
 * admins can meaningfully work it. A candidate missing any of them is
 * 'incomplete' and surfaces in the needs-attention queue.
 *
 * ONE definition, used by:
 * - the webhook ingest service (initial computation, AC-CA-09)
 * - candidate create/update (kept current on every write)
 * - the daily flag-incomplete-candidates job (recomputation)
 */

/** camelCase field → column name for the completeness-required set. */
export const COMPLETENESS_REQUIRED_FIELDS = {
  email: 'email',
  phone: 'phone',
  country: 'country',
  englishSpokenLevel: 'english_spoken_level',
  yearsExperienceTotal: 'years_experience_total',
  expectedRateAmount: 'expected_rate_amount',
  expectedRateUnit: 'expected_rate_unit',
  primaryRoleCategoryId: 'primary_role_category_id',
} as const;

export type CompletenessField = keyof typeof COMPLETENESS_REQUIRED_FIELDS;

export const COMPLETENESS_REQUIRED_COLUMNS: readonly string[] = Object.values(
  COMPLETENESS_REQUIRED_FIELDS,
);

/**
 * Static SQL predicate (safe for `sql.unsafe` — built only from the constant
 * column list above): true when every required column is populated.
 */
export const COMPLETENESS_SQL_PREDICATE = COMPLETENESS_REQUIRED_COLUMNS.map(
  (column) => `${column} is not null`,
).join(' and ');

/**
 * The camelCase required-set keys currently missing from the record, in the
 * declaration order of COMPLETENESS_REQUIRED_FIELDS (UX 2.5 — the API
 * surfaces WHICH fields are missing, not just the flag).
 */
export function computeMissingFields(
  record: Partial<Record<CompletenessField, unknown>>,
): CompletenessField[] {
  const missing: CompletenessField[] = [];
  for (const field of Object.keys(
    COMPLETENESS_REQUIRED_FIELDS,
  ) as CompletenessField[]) {
    const value = record[field];
    if (value === undefined || value === null || value === '') {
      missing.push(field);
    }
  }
  return missing;
}

/** JS-side computation over a camelCase candidate-shaped record. */
export function computeDataCompleteness(
  record: Partial<Record<CompletenessField, unknown>>,
): 'complete' | 'incomplete' {
  return computeMissingFields(record).length > 0 ? 'incomplete' : 'complete';
}
