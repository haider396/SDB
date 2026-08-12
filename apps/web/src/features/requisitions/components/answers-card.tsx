/**
 * Intake answers grouped by category, rendered FROM SNAPSHOTS (03 §1.4):
 * label, type, and option labels come from `questionSnapshot` / the lifted
 * snapshot fields on the answer row — never from live question definitions,
 * so later edits to the questionnaire cannot change what was answered.
 */
import { MessageSquareText } from "lucide-react";
import type { RequisitionAnswer } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, humanizeKey } from "@/lib/format";

/** Snapshot fields we read, all optional — snapshots are loosely typed. */
function snapshotString(
  snapshot: Record<string, unknown>,
  key: string,
): string | null {
  const value = snapshot[key];
  return typeof value === "string" ? value : null;
}

/** Render the stored value using the typed columns (02 §7 value shape). */
export function renderAnswerValue(answer: RequisitionAnswer): string {
  if (answer.selectedOptions.length > 0) {
    return answer.selectedOptions.map((option) => option.label).join(", ");
  }
  if (answer.valueBoolean !== null) return answer.valueBoolean ? "Yes" : "No";
  if (answer.valueNumber !== null) return String(answer.valueNumber);
  if (answer.valueDate !== null) return formatDate(answer.valueDate);
  if (answer.valueText !== null && answer.valueText !== "") {
    return answer.valueText;
  }
  if (answer.valueJson !== null) {
    // currency_range: { min, max, unit, currency } (02 §7)
    if (
      typeof answer.valueJson === "object" &&
      !Array.isArray(answer.valueJson)
    ) {
      const json = answer.valueJson as Record<string, unknown>;
      if (typeof json["min"] === "number" || typeof json["max"] === "number") {
        const currency = typeof json["currency"] === "string" ? json["currency"] : "";
        const unit = typeof json["unit"] === "string" ? ` / ${json["unit"]}` : "";
        const min = typeof json["min"] === "number" ? json["min"].toLocaleString("en-US") : null;
        const max = typeof json["max"] === "number" ? json["max"].toLocaleString("en-US") : null;
        const range = [min, max].filter((part) => part !== null).join("–");
        return `${currency ? `${currency} ` : ""}${range}${unit}`;
      }
      if (Array.isArray(json["fileIds"])) {
        const count = json["fileIds"].length;
        return `${count} file${count === 1 ? "" : "s"} attached`;
      }
    }
    if (Array.isArray(answer.valueJson)) {
      return answer.valueJson.map((entry) => String(entry)).join(", ");
    }
    return JSON.stringify(answer.valueJson);
  }
  return "—";
}

interface AnswerGroup {
  categoryKey: string;
  answers: RequisitionAnswer[];
}

/** Group by the snapshot's categoryKey, preserving answer order. */
export function groupAnswersByCategory(
  answers: RequisitionAnswer[],
): AnswerGroup[] {
  const groups = new Map<string, RequisitionAnswer[]>();
  for (const answer of answers) {
    const categoryKey =
      snapshotString(answer.questionSnapshot, "categoryKey") ?? "other";
    const bucket = groups.get(categoryKey);
    if (bucket === undefined) groups.set(categoryKey, [answer]);
    else bucket.push(answer);
  }
  return Array.from(groups, ([categoryKey, grouped]) => ({
    categoryKey,
    answers: grouped,
  }));
}

export function AnswersCard({ answers }: { answers: RequisitionAnswer[] }) {
  const groups = groupAnswersByCategory(answers);

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
                aria-label={humanizeKey(group.categoryKey)}
              >
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-tight text-neutral-500">
                  {humanizeKey(group.categoryKey)}
                </h3>
                <dl className="divide-y divide-border-default">
                  {group.answers.map((answer) => {
                    // The snapshot is authoritative for display (03 §1.4);
                    // the lifted `label` field is the fallback.
                    const label =
                      snapshotString(answer.questionSnapshot, "label") ??
                      answer.label;
                    return (
                      <div
                        key={answer.id}
                        className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-[16rem_1fr] sm:gap-4"
                      >
                        <dt className="text-sm text-neutral-500">{label}</dt>
                        <dd className="whitespace-pre-wrap text-sm text-neutral-800">
                          {renderAnswerValue(answer)}
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
