/**
 * Per-form wording overrides, and the reason the ordering matters.
 *
 * A block may re-word a library question for one form: a Video Editor form can
 * ask "Which editing suites do you know?" where the library says "Software
 * proficiency". The override is applied in resolve(), BEFORE validateSubmission
 * and therefore before buildSnapshot.
 *
 * That ordering is the entire design. question_snapshot is the immutable record
 * of what a candidate was actually asked (03 §1.4). Applied any later — at
 * render time only — the snapshot would record the library wording while the
 * candidate saw something else, and the historical record would be a lie. These
 * tests run the two real functions in the real order and assert the record
 * matches the screen.
 */
import { describe, expect, it } from 'vitest';
import { applyBlockOverrides } from '../src/services/candidate-form-public.service.js';
import { buildSnapshot } from '../src/services/intake-submission.service.js';
import type { BlockRecord } from '../src/repositories/candidate-forms.repo.js';
import type { FormQuestionRecord } from '../src/repositories/intake.repo.js';

const CAPTURED_AT = '2026-09-04T10:00:00.000Z';

function libraryQuestion(
  overrides: Partial<FormQuestionRecord> = {},
): FormQuestionRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key: 'software_proficiency',
    label: 'Software proficiency',
    helpText: 'Tell us what you know.',
    placeholder: 'Start typing',
    questionType: 'multi_select',
    isRequired: false,
    sortOrder: 1,
    validation: {},
    conditionalKey: null,
    conditionalOperator: null,
    conditionalValue: null,
    categoryId: '00000000-0000-4000-8000-000000000002',
    categoryKey: 'skills',
    categoryLabel: 'Skills',
    categoryDescription: null,
    categorySortOrder: 1,
    options: [
      { id: 'opt-1', value: 'premiere', label: 'Premiere Pro' },
      { id: 'opt-2', value: 'figma', label: 'Figma' },
      { id: 'opt-3', value: 'excel', label: 'Excel' },
    ],
    ...overrides,
  };
}

function block(overrides: Partial<BlockRecord> = {}): BlockRecord {
  return {
    id: '00000000-0000-4000-8000-0000000000ff',
    formVersionId: '00000000-0000-4000-8000-0000000000fe',
    parentBlockId: null,
    blockType: 'question',
    questionId: '00000000-0000-4000-8000-000000000001',
    pageIndex: 0,
    sortOrder: 0,
    layout: {},
    style: {},
    props: {},
    isRequiredOverride: null,
    labelOverride: null,
    placeholderOverride: null,
    helpTextOverride: null,
    optionValueOverrides: null,
    ...overrides,
  };
}

describe('applyBlockOverrides', () => {
  it('changes nothing when a form has stated no preference', () => {
    const question = libraryQuestion();
    expect(applyBlockOverrides(question, block())).toEqual(question);
  });

  it('re-words the label, hint and help text for this form only', () => {
    const resolved = applyBlockOverrides(
      libraryQuestion(),
      block({
        labelOverride: 'Which editing suites do you know?',
        placeholderOverride: 'e.g. Premiere',
        helpTextOverride: 'Pick every one you have shipped work in.',
      }),
    );
    expect(resolved).toMatchObject({
      label: 'Which editing suites do you know?',
      placeholder: 'e.g. Premiere',
      helpText: 'Pick every one you have shipped work in.',
    });
    // The identity of the question is untouched — an override is not a fork.
    expect(resolved.key).toBe('software_proficiency');
    expect(resolved.questionType).toBe('multi_select');
  });

  it('does not mutate the shared library record', () => {
    // The same FormQuestionRecord instance is reused across every block on the
    // form. Mutating it would leak one block's wording into the next.
    const question = libraryQuestion();
    applyBlockOverrides(question, block({ labelOverride: 'Renamed' }));
    expect(question.label).toBe('Software proficiency');
  });

  it('treats an empty string as a real override, not as "unset"', () => {
    // Clearing the help line on one form is a deliberate choice; only null
    // falls back to the library.
    const resolved = applyBlockOverrides(
      libraryQuestion(),
      block({ helpTextOverride: '' }),
    );
    expect(resolved.helpText).toBe('');
  });

  it('narrows the choices to the subset the form shows, in the form order', () => {
    const resolved = applyBlockOverrides(
      libraryQuestion(),
      block({ optionValueOverrides: ['figma', 'premiere'] }),
    );
    expect(resolved.options.map((option) => option.value)).toEqual([
      'figma',
      'premiere',
    ]);
  });

  it('ignores a stale value rather than inventing an option row', () => {
    // A choice deleted from the question after the form was built. Answering an
    // option that no longer exists would break the FK on option ids.
    const resolved = applyBlockOverrides(
      libraryQuestion(),
      block({ optionValueOverrides: ['figma', 'deleted_choice'] }),
    );
    expect(resolved.options.map((option) => option.value)).toEqual(['figma']);
  });

  it('still applies the required override alongside the wording', () => {
    const resolved = applyBlockOverrides(
      libraryQuestion({ isRequired: false }),
      block({ isRequiredOverride: true, labelOverride: 'Renamed' }),
    );
    expect(resolved.isRequired).toBe(true);
    expect(resolved.label).toBe('Renamed');
  });
});

describe('question_snapshot records what the candidate SAW', () => {
  it('stores the overridden label, not the library one', () => {
    const resolved = applyBlockOverrides(
      libraryQuestion(),
      block({ labelOverride: 'Which editing suites do you know?' }),
    );
    const snapshot = buildSnapshot(resolved, CAPTURED_AT);

    expect(snapshot['label']).toBe('Which editing suites do you know?');
    expect(snapshot['label']).not.toBe('Software proficiency');
    // The key still ties the answer back to the question it belongs to.
    expect(snapshot['questionKey']).toBe('software_proficiency');
  });

  it('stores the overridden help text', () => {
    const resolved = applyBlockOverrides(
      libraryQuestion(),
      block({ helpTextOverride: 'Pick every one you have shipped work in.' }),
    );
    expect(buildSnapshot(resolved, CAPTURED_AT)['helpText']).toBe(
      'Pick every one you have shipped work in.',
    );
  });

  it('stores only the choices this form offered', () => {
    // A candidate who never saw "Excel" must not have a record implying they
    // declined it.
    const resolved = applyBlockOverrides(
      libraryQuestion(),
      block({ optionValueOverrides: ['premiere', 'figma'] }),
    );
    expect(buildSnapshot(resolved, CAPTURED_AT)['options']).toEqual([
      { value: 'premiere', label: 'Premiere Pro' },
      { value: 'figma', label: 'Figma' },
    ]);
  });

  it('is unchanged for a form that overrides nothing', () => {
    const plain = buildSnapshot(libraryQuestion(), CAPTURED_AT);
    const throughBlock = buildSnapshot(
      applyBlockOverrides(libraryQuestion(), block()),
      CAPTURED_AT,
    );
    expect(throughBlock).toEqual(plain);
  });
});
