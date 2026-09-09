/**
 * Everything a candidate submitted, grouped by application.
 *
 * This closes a real gap: `candidate_answers` was write-only. Every answer to a
 * question outside CANDIDATE_MAPPED_QUESTION_KEYS was stored and shown nowhere,
 * which would have made the form builder actively misleading — you could write
 * a custom question and never see a single answer to it.
 *
 * Labels and option text come from `questionSnapshot`, NEVER from the live
 * question (03 §1.4). That matters more now than it ever did: forms are
 * editable, and editing one must not retroactively rewrite what a candidate is
 * recorded as having been asked.
 */
import { useState } from "react";
import { MessageSquareText, Pencil } from "lucide-react";
import type { CandidateSubmission } from "@sdb/contracts";
import { AnswerTable } from "@/components/patterns/answer-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  groupAnswersByCategory,
  renderAnswerValue,
  snapshotString,
} from "@/lib/answer-value";
import { formatDate, humanizeKey } from "@/lib/format";
import { toast } from "sonner";
import { useUpdateCandidateAnswers } from "../api";
import {
  AnswerEditor,
  draftFromAnswer,
  isEditableAnswer,
  type AnswerDraft,
} from "./answer-editor";

const SOURCE_LABEL: Record<CandidateSubmission["source"], string> = {
  public_form: "Public form",
  backfill: "Before forms",
  admin: "Entered by an admin",
};

/**
 * Which question keys were answered differently in a LATER submission.
 *
 * Newest wins on the candidate's profile columns, so an older conflicting
 * answer is no longer what the record says. A recruiter needs to see that
 * rather than infer it — this is exactly the case where a candidate corrected
 * a phone number on a second application.
 */
function supersededKeys(
  submissions: readonly CandidateSubmission[],
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  // Submissions arrive newest-first.
  const seen = new Map<string, string>();
  for (const submission of submissions) {
    for (const answer of submission.answers) {
      const rendered = renderAnswerValue(answer);
      const newer = seen.get(answer.questionKey);
      if (newer !== undefined && newer !== rendered) {
        const set = result.get(submission.id) ?? new Set<string>();
        set.add(answer.questionKey);
        result.set(submission.id, set);
      }
      if (newer === undefined) seen.set(answer.questionKey, rendered);
    }
  }
  return result;
}

export function FormSubmissionsCard({
  submissions,
  candidateId,
}: {
  submissions: readonly CandidateSubmission[];
  candidateId: string;
}) {
  const superseded = supersededKeys(submissions);
  const update = useUpdateCandidateAnswers(candidateId);

  /**
   * Pending edits, keyed by questionKey. `null` means "not editing" — an empty
   * map would mean "editing, nothing changed yet", and the two need to be
   * distinguishable or Cancel cannot know whether to close.
   */
  const [drafts, setDrafts] = useState<Map<string, AnswerDraft> | null>(null);
  const isEditing = drafts !== null;

  const allAnswers = submissions.flatMap((submission) => submission.answers);

  function startEditing() {
    setDrafts(
      new Map(
        allAnswers
          .filter(isEditableAnswer)
          .map((answer) => [answer.questionKey, draftFromAnswer(answer)]),
      ),
    );
  }

  async function save() {
    if (drafts === null) return;
    // Send only what actually changed. An unchanged answer would still be
    // rejected-or-written server-side, and would put a misleading entry in the
    // event trail saying someone edited a field they only looked at.
    const answers = allAnswers
      .filter(isEditableAnswer)
      .flatMap((answer) => {
        const draft = drafts.get(answer.questionKey);
        if (draft === undefined) return [];
        const original = draftFromAnswer(answer);
        const changed =
          JSON.stringify(draft) !== JSON.stringify(original);
        return changed ? [{ questionKey: answer.questionKey, ...draft }] : [];
      });

    if (answers.length === 0) {
      setDrafts(null);
      return;
    }
    await toast.promise(update.mutateAsync({ answers }), {
      loading: "Saving changes…",
      success: (result) =>
        `${result.updated} answer${result.updated === 1 ? "" : "s"} updated.`,
      error: (error) =>
        error instanceof Error ? error.message : "Could not save the changes.",
    }).unwrap().then(() => {
      setDrafts(null);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        {/* Named for what it is to a recruiter: the thing the candidate
            applied with. Plural only when there is more than one. */}
        <CardTitle>
          {submissions.length > 1 ? "Applications" : "Application"}
        </CardTitle>
        {allAnswers.some(isEditableAnswer) ? (
          isEditing ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDrafts(null)}
                disabled={update.isPending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={startEditing}>
              <Pencil className="mr-1 h-3 w-3" aria-hidden="true" />
              Edit answers
            </Button>
          )
        ) : null}
      </CardHeader>
      <CardContent>
        {submissions.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No form answers"
            description="Answers from any form this candidate completed appear here, exactly as they were given."
          />
        ) : (
          <div className="space-y-3">
            {submissions.map((submission, index) => (
              <details
                key={submission.id}
                // Most recent open; the rest collapsed. The candidate page
                // already carries 18 cards — four expanded applications would
                // make it unusable.
                open={index === 0}
                className="rounded-md border border-neutral-200"
              >
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium text-neutral-800">
                    {submission.formLabel}
                  </span>
                  {submission.roleCategory !== null ? (
                    <Chip tone="brand-blue" size="sm">
                      {submission.roleCategory.label}
                    </Chip>
                  ) : null}
                  <Chip tone="neutral" size="sm">
                    {SOURCE_LABEL[submission.source]}
                  </Chip>
                  <span className="ml-auto text-xs text-neutral-500">
                    {formatDate(submission.submittedAt)}
                  </span>
                </summary>

                <div className="space-y-4 border-t border-neutral-200 px-3 py-3">
                  {submission.answers.length === 0 ? (
                    <p className="text-xs text-neutral-500">
                      No answers were recorded for this application.
                    </p>
                  ) : (
                    groupAnswersByCategory(submission.answers).map((group) => (
                      <section
                        key={group.categoryKey}
                        aria-label={group.categoryLabel ?? humanizeKey(group.categoryKey)}
                      >
                        <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-neutral-500">
                          {group.categoryLabel ?? humanizeKey(group.categoryKey)}
                        </h4>
                        <dl className="divide-y divide-neutral-200">
                          {group.answers.map((answer) => {
                            const isSuperseded =
                              superseded.get(submission.id)?.has(answer.questionKey) ===
                              true;
                            const label =
                              snapshotString(answer.questionSnapshot, "label") ??
                              answer.label;
                            // The SNAPSHOT's type, never the live question's:
                            // no snapshot written before this feature says
                            // repeating_group, so no stored answer can change
                            // rendering (03 §1.4).
                            const isTable =
                              snapshotString(
                                answer.questionSnapshot,
                                "questionType",
                              ) === "repeating_group";
                            return (
                              <div
                                key={answer.id}
                                className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[16rem_1fr] sm:gap-4"
                              >
                                <dt className="text-sm text-neutral-500">{label}</dt>
                                <dd className="flex flex-wrap items-center gap-2 whitespace-pre-wrap text-sm text-neutral-800">
                                  {/* The table's own wrapper is w-full, so it
                                      takes the whole flex line and the
                                      Superseded chip wraps beneath it. */}
                                  {isEditing && isEditableAnswer(answer) ? (
                                    <div className="w-full">
                                      <AnswerEditor
                                        answer={answer}
                                        draft={
                                          drafts.get(answer.questionKey) ?? {}
                                        }
                                        onChange={(next) =>
                                          setDrafts((previous) => {
                                            if (previous === null) return previous;
                                            const updated = new Map(previous);
                                            updated.set(answer.questionKey, next);
                                            return updated;
                                          })
                                        }
                                      />
                                    </div>
                                  ) : isTable ? (
                                    <AnswerTable answer={answer} caption={label} />
                                  ) : (
                                    renderAnswerValue(answer)
                                  )}
                                  {isSuperseded ? (
                                    <Chip tone="warning" size="sm">
                                      Superseded
                                    </Chip>
                                  ) : null}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </section>
                    ))
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
