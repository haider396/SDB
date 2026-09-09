/**
 * Intake answers grouped by category, rendered FROM SNAPSHOTS (03 §1.4):
 * label, type, and option labels come from `questionSnapshot` / the lifted
 * snapshot fields on the answer row — never from live question definitions,
 * so later edits to the questionnaire cannot change what was answered.
 */
import { MessageSquareText } from "lucide-react";
import type { RequisitionAnswer } from "@sdb/contracts";
import { AnswerTable } from "@/components/patterns/answer-table";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { humanizeKey } from "@/lib/format";
import {
  groupAnswersByCategory as groupAnswers,
  renderAnswerValue as renderValue,
  snapshotString as snapshotField,
} from "@/lib/answer-value";

/**
 * Value rendering and category grouping now live in lib/answer-value so the
 * candidate submissions card shares one implementation. Re-exported here
 * because both are part of this module's public surface.
 */
export {
  groupAnswersByCategory,
  renderAnswerValue,
  snapshotString,
} from "@/lib/answer-value";

export function AnswersCard({ answers }: { answers: RequisitionAnswer[] }) {
  const groups = groupAnswers(answers);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Intake answers</CardTitle>
      </CardHeader>
      <CardContent>
        {answers.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No answers recorded"
            description="Answers from the intake form appear here, exactly as they were given."
          />
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section
                key={group.categoryKey}
                aria-label={group.categoryLabel ?? humanizeKey(group.categoryKey)}
              >
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {group.categoryLabel ?? humanizeKey(group.categoryKey)}
                </h3>
                <dl className="divide-y divide-neutral-200">
                  {group.answers.map((answer) => {
                    // The snapshot is authoritative for display (03 §1.4);
                    // the lifted `label` field is the fallback.
                    const label =
                      snapshotField(answer.questionSnapshot, "label") ??
                      answer.label;
                    // The SNAPSHOT's type, never the live question's: no
                    // snapshot written before this feature says
                    // repeating_group, so no stored answer can change
                    // rendering (03 §1.4).
                    const isTable =
                      snapshotField(answer.questionSnapshot, "questionType") ===
                      "repeating_group";
                    return (
                      <div
                        key={answer.id}
                        className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[16rem_1fr] sm:gap-4"
                      >
                        <dt className="text-sm text-neutral-500">{label}</dt>
                        <dd className="whitespace-pre-wrap text-sm text-neutral-800">
                          {isTable ? (
                            <AnswerTable answer={answer} caption={label} />
                          ) : (
                            renderValue(answer)
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
