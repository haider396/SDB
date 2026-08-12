/**
 * Question keys that map to first-class columns on `clients` / `requisitions`
 * in addition to being stored as answers. Source: docs/03-INTAKE-FORM-ENGINE.md
 * §3.4. These keys cannot be deleted or renamed — the API returns
 * `409 MAPPED_QUESTION_PROTECTED`. Seed questions MUST use these exact keys.
 */
export const MAPPED_QUESTION_KEYS = [
  'engine',
  'department',
  'role_category',
  'budget_range',
  'engagement_type',
  'hours_per_week',
  'overlap_window',
  'target_start_date',
  'english_spoken_required',
  'english_written_required',
  'max_accent_strength',
  'region_preference',
  'headcount',
  'company_name',
  'contact_name',
  'contact_email',
] as const;

export type MappedQuestionKey = (typeof MAPPED_QUESTION_KEYS)[number];

export function isMappedQuestionKey(key: string): key is MappedQuestionKey {
  return (MAPPED_QUESTION_KEYS as readonly string[]).includes(key);
}
