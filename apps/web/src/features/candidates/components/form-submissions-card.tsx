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
import { MessageSquareText } from "lucide-react";
import type { CandidateSubmission } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import {
  groupAnswersByCategory,
  renderAnswerValue,
  snapshotString,
} from "@/lib/answer-value";
import { formatDate, humanizeKey } from "@/lib/format";

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
}: {
  submissions: readonly CandidateSubmission[];
}) {
  const superseded = supersededKeys(submissions);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Form answers</CardTitle>
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
                            return (
                              <div
                                key={answer.id}
                                className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[16rem_1fr] sm:gap-4"
                              >
                                <dt className="text-sm text-neutral-500">
                                  {snapshotString(answer.questionSnapshot, "label") ??
                                    answer.label}
                                </dt>
                                <dd className="flex flex-wrap items-center gap-2 whitespace-pre-wrap text-sm text-neutral-800">
                                  {renderAnswerValue(answer)}
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
