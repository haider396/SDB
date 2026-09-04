/**
 * projectCandidatePatch — the guard against silent data loss.
 *
 * projectCandidate spreads EMPTY_PROJECTION, so every mapped key is present
 * with `null` where unanswered. That is correct when CREATING a candidate.
 *
 * On the ATTACH path it is destructive: toColumnAssignments skips `undefined`
 * but NOT `null`, so feeding the full projection to updateCandidate writes null
 * over every mapped column the second form did not ask about. A Video Editor
 * application captures a typing speed; a later Developer application that never
 * asks about typing would wipe it.
 *
 * These tests pin the difference, because nothing in the type system does.
 */
import { describe, expect, it } from 'vitest';
import type { QuestionType } from '@sdb/contracts';
import { projectCandidatePatch } from '../src/services/candidate-registration.service.js';

/** Minimal PreparedAnswer shaped like the real pipeline emits. */
function answer(
  key: string,
  value: string | number | boolean | null,
  questionType: QuestionType = 'short_text',
) {
  const isNumber = typeof value === 'number';
  return {
    question: {
      id: '00000000-0000-4000-8000-000000000001',
      key,
      label: key,
      helpText: null,
      placeholder: null,
      questionType,
      isRequired: false,
      sortOrder: 1,
      validation: {},
      options: [],
      audience: 'candidate',
      categoryId: '00000000-0000-4000-8000-000000000002',
      categoryKey: 'c',
      categoryLabel: 'C',
      categoryDescription: null,
      categorySortOrder: 1,
      conditionalKey: null,
      conditionalOperator: null,
      conditionalValue: null,
    },
    valueText: isNumber || typeof value === 'boolean' ? null : (value as string | null),
    valueNumber: isNumber ? value : null,
    valueBoolean: typeof value === 'boolean' ? value : null,
    valueDate: null,
    valueJson: null,
    optionIds: [],
  } as never;
}

describe('projectCandidatePatch builds by PRESENCE', () => {
  it('omits keys the form never asked about', () => {
    const patch = projectCandidatePatch([
      answer('email', 'ada@example.com'),
      answer('country', 'Mexico'),
    ]);

    expect(patch).toEqual({ email: 'ada@example.com', country: 'Mexico' });
    // The assertion that matters: absent, not null. `undefined` is skipped by
    // toColumnAssignments; `null` would be WRITTEN.
    expect('typingWpm' in patch).toBe(false);
    expect('phone' in patch).toBe(false);
    expect('city' in patch).toBe(false);
  });

  it('would not wipe a typing speed captured by an earlier form', () => {
    // The exact scenario: applied for Video Editor (typing captured), now
    // applying for Developer, which does not ask about typing.
    const developerApplication = projectCandidatePatch([
      answer('email', 'ada@example.com'),
      answer('first_name', 'Ada'),
      answer('last_name', 'Lovelace'),
    ]);

    expect(developerApplication.typingWpm).toBeUndefined();
    expect(Object.keys(developerApplication).sort()).toEqual([
      'email',
      'firstName',
      'lastName',
    ]);
  });

  it('DOES include a key answered with an explicit blank, so clearing works', () => {
    // A blank answer is still an answer: newest wins means it clears the field.
    const patch = projectCandidatePatch([answer('city', '')]);
    expect('city' in patch).toBe(true);
    expect(patch.city).toBeNull();
  });

  it('normalises email to lowercase so identity matching is stable', () => {
    const patch = projectCandidatePatch([answer('email', '  Ada@Example.COM  ')]);
    expect(patch.email).toBe('ada@example.com');
  });

  it('ignores questions that are not mapped columns', () => {
    const patch = projectCandidatePatch([
      answer('email', 'ada@example.com'),
      answer('why_do_you_want_this_job', 'Because I like it'),
    ]);
    expect(patch).toEqual({ email: 'ada@example.com' });
  });

  it('carries numeric answers as numbers', () => {
    const patch = projectCandidatePatch([
      answer('years_experience_total', 7, 'number'),
      answer('hours_available_per_week', 40, 'number'),
    ]);
    expect(patch.yearsExperienceTotal).toBe(7);
    expect(patch.hoursAvailablePerWeek).toBe(40);
  });

  it('is empty for a submission that answered nothing mapped', () => {
    expect(projectCandidatePatch([])).toEqual({});
  });
});
