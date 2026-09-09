/**
 * SDB staff correcting what a candidate submitted.
 *
 * Haider, 9 Sep: staff open a candidate's profile and need to fix what is
 * there — a typo'd email, a figure the candidate got wrong, a gap they left.
 *
 * ── The two things this must never do ──────────────────────────────────────
 *
 * 1. **Change `question_snapshot`.** It records what the candidate was
 *    actually shown — the label, the type, the options as at that moment
 *    (03 §1.4, AC-IF-11, AC-IF-12). A recruiter fixing an answer has not
 *    changed the question. The write path simply does not touch it, and the
 *    body has no field that could.
 *
 * 2. **Lose what the candidate said.** Every edit emits an event carrying the
 *    old and new value, so the answer row holds the current best value while
 *    the event log holds the history. That is invariant 4 doing double duty
 *    rather than a second table nobody would maintain.
 *
 * ── Why validation is deliberately lighter than a submission ───────────────
 * A submission is validated against the question's rules because the candidate
 * is answering it. An edit is a CORRECTION by someone who has spoken to them,
 * so `required` must not apply — a recruiter clearing a field they know to be
 * wrong is a legitimate act, and refusing it would push them to type "unknown"
 * instead, which is worse data.
 *
 * What IS enforced is what keeps the row readable and storable:
 *   - the value must sit in the column the snapshot's type demands, or the
 *     `enforce_candidate_answer_value_shape` trigger rejects it;
 *   - a choice must be one the question actually offers, or the profile would
 *     render a value with no label.
 */
import {
  type UpdateCandidateAnswersBody,
  isCandidateMappedQuestionKey,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import type { Db } from '../lib/db.js';
import { withTransaction } from '../lib/db.js';
import * as repo from '../repositories/candidates.repo.js';
import { listOptionsForQuestions } from '../repositories/questions.repo.js';
import { emitEvent } from './events.js';


import type { CandidateActor } from './candidates.service.js';

/** Which value column the snapshot's question type demands. */
const COLUMN_FOR_TYPE: Record<string, keyof AnswerValue> = {
  short_text: 'valueText',
  long_text: 'valueText',
  email: 'valueText',
  phone: 'valueText',
  single_select: 'valueText',
  date: 'valueDate',
  number: 'valueNumber',
  scale: 'valueNumber',
  yes_no: 'valueBoolean',
  multi_select: 'valueJson',
  currency_range: 'valueJson',
  file_upload: 'valueJson',
  repeating_group: 'valueJson',
};

interface AnswerValue {
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: unknown;
}

const EMPTY: AnswerValue = {
  valueText: null,
  valueNumber: null,
  valueBoolean: null,
  valueDate: null,
  valueJson: null,
};

/** A short, human-readable rendering of a value, for the event trail. */
function describe(value: AnswerValue): string | null {
  if (value.valueText !== null) return value.valueText;
  if (value.valueNumber !== null) return String(value.valueNumber);
  if (value.valueBoolean !== null) return value.valueBoolean ? 'yes' : 'no';
  if (value.valueDate !== null) return value.valueDate;
  if (value.valueJson !== null && value.valueJson !== undefined) {
    return JSON.stringify(value.valueJson).slice(0, 500);
  }
  return null;
}

function snapshotString(
  snapshot: Record<string, unknown>,
  key: string,
): string | null {
  const value = snapshot[key];
  return typeof value === 'string' ? value : null;
}

export interface CandidateAnswersService {
  updateAnswers(
    candidateId: string,
    body: UpdateCandidateAnswersBody,
    actor: CandidateActor,
  ): Promise<{ updated: number }>;
}

export function createCandidateAnswersService(deps: {
  db: Db;
}): CandidateAnswersService {
  const { db } = deps;

  return {
    async updateAnswers(candidateId, body, actor) {
      return withTransaction(db, async (tx) => {
        const candidate = await repo.findCandidateById(tx, candidateId);
        if (candidate === null) {
          throw new ApiError('NOT_FOUND', 'Candidate not found.');
        }

        const existing = await repo.getAnswersForCandidate(tx, candidateId);
        const byKey = new Map(existing.map((answer) => [answer.questionKey, answer]));

        // Resolve every choice list up front: one query rather than one per
        // answer, and it also proves each question still exists.
        const questionIds = body.answers
          .map((answer) => byKey.get(answer.questionKey)?.questionId)
          .filter((id): id is string => id !== undefined);
        const optionsByQuestion = await listOptionsForQuestions(tx, questionIds);

        const fields: Record<string, string> = {};
        let updated = 0;

        for (const incoming of body.answers) {
          const current = byKey.get(incoming.questionKey);
          if (current === undefined) {
            // You can correct an answer; you cannot invent one the candidate
            // was never asked — that would need a snapshot, and inventing a
            // snapshot is exactly what this service refuses to do.
            fields[incoming.questionKey] =
              'This candidate has no answer to that question, so there is nothing to correct.';
            continue;
          }

          const type = snapshotString(current.questionSnapshot, 'questionType');
          if (type === null) {
            fields[incoming.questionKey] =
              'This answer has no recorded question type and cannot be edited.';
            continue;
          }

          const expected = COLUMN_FOR_TYPE[type];
          if (expected === undefined) {
            fields[incoming.questionKey] = `Unsupported question type '${type}'.`;
            continue;
          }

          const next: AnswerValue = {
            ...EMPTY,
            valueText: incoming.valueText ?? null,
            valueNumber: incoming.valueNumber ?? null,
            valueBoolean: incoming.valueBoolean ?? null,
            valueDate: incoming.valueDate ?? null,
            valueJson: incoming.valueJson ?? null,
          };

          const provided = (Object.keys(EMPTY) as (keyof AnswerValue)[]).filter(
            (key) => next[key] !== null,
          );
          if (provided.length > 1) {
            fields[incoming.questionKey] = 'Send exactly one value.';
            continue;
          }
          if (provided.length === 1 && provided[0] !== expected) {
            fields[incoming.questionKey] =
              `A ${type} answer must be sent as ${expected}.`;
            continue;
          }

          // A choice must be one the question actually offers, or the profile
          // renders a value with no label.
          if (type === 'single_select' && next.valueText !== null) {
            const allowed = (optionsByQuestion.get(current.questionId) ?? []).filter(
              (option) => option.isActive,
            );
            const match = allowed.find((option) => option.value === next.valueText);
            if (match === undefined) {
              fields[incoming.questionKey] = 'That is not one of the choices.';
              continue;
            }
            await repo.replaceCandidateAnswerOptions(tx, current.id, [match.id]);
          }

          const before = describe({
            valueText: current.valueText,
            valueNumber: current.valueNumber,
            valueBoolean: current.valueBoolean,
            valueDate: current.valueDate,
            valueJson: current.valueJson,
          });
          const after = describe(next);
          if (before === after) continue;

          await repo.updateCandidateAnswerValue(tx, current.id, next, actor.userId);
          updated += 1;

          await emitEvent(tx, {
            entityType: 'candidate',
            entityId: candidateId,
            eventType: 'candidate_answer_edited',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: before,
            toValue: after,
            metadata: {
              questionKey: incoming.questionKey,
              questionLabel:
                snapshotString(current.questionSnapshot, 'label') ??
                incoming.questionKey,
              // Flagged because these also rewrite a real candidates column,
              // and one of them (email) is the candidate's identity.
              mapped: isCandidateMappedQuestionKey(incoming.questionKey),
            },
          });
        }

        if (Object.keys(fields).length > 0) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'Some answers could not be saved.',
            { fields },
          );
        }

        return { updated };
      });
    },
  };
}
