/**
 * Job description + role description editor (T16). Replaces the old Brief.
 *
 * Rebecca, 35:09: "A job description is what we present externally when we're
 * looking for a candidate. A role description is what they have once they're
 * inside the company."
 *
 * Both are normally written by the CLIENT at intake — they are mapped intake
 * questions (MAPPED_QUESTION_KEYS), so the answers project onto
 * requisitions.job_description / .role_description. This card is the other
 * half of that: SDB fills them in when the client left them blank, which
 * Rebecca said is common ("they can choose to have us write it for them").
 *
 * The job description is load-bearing: a position cannot move to sourcing
 * without one (35:40, enforced in requisitions.service.ts). The empty state
 * says so rather than leaving an admin to discover it at the transition.
 *
 * Both fields render through SimpleMarkdown in preview — headings, bullets,
 * bold; no markdown library, no HTML injection surface.
 */
import { Eye, PenLine, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { RequisitionDetail } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { SimpleMarkdown } from "@/lib/simple-markdown";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { useUpdateRequisition } from "../api";

type Field = "jobDescription" | "roleDescription";

const FIELDS: {
  key: Field;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  {
    key: "jobDescription",
    label: "Job description",
    hint: "What candidates are shown. Required before sourcing can start.",
    placeholder:
      "What the role is, what a good candidate looks like, why someone would want it.",
  },
  {
    key: "roleDescription",
    label: "Role description",
    hint: "What the person actually does once they are onboard. Internal.",
    placeholder:
      "Day-to-day responsibilities, who they report to, what success looks like.",
  },
];

export function DescriptionsCard({
  requisition,
}: {
  requisition: RequisitionDetail;
}) {
  const updateRequisition = useUpdateRequisition();
  const [drafts, setDrafts] = useState<Record<Field, string>>({
    jobDescription: requisition.jobDescription ?? "",
    roleDescription: requisition.roleDescription ?? "",
  });
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [error, setError] = useState<string | null>(null);

  const saved: Record<Field, string> = {
    jobDescription: requisition.jobDescription ?? "",
    roleDescription: requisition.roleDescription ?? "",
  };

  // Track server updates (e.g. the client edited at intake) while not editing.
  useEffect(() => {
    setDrafts({
      jobDescription: requisition.jobDescription ?? "",
      roleDescription: requisition.roleDescription ?? "",
    });
  }, [requisition.jobDescription, requisition.roleDescription]);

  const isDirty =
    drafts.jobDescription !== saved.jobDescription ||
    drafts.roleDescription !== saved.roleDescription;
  useDirtyGuard(isDirty);

  const needsJobDescription = saved.jobDescription.trim() === "";

  const save = async () => {
    setError(null);
    try {
      await updateRequisition.mutateAsync({
        id: requisition.id,
        body: {
          jobDescription:
            drafts.jobDescription.trim() === "" ? null : drafts.jobDescription,
          roleDescription:
            drafts.roleDescription.trim() === "" ? null : drafts.roleDescription,
        },
      });
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not save the descriptions.",
      );
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Descriptions</CardTitle>
        <div className="flex items-center gap-1" role="group" aria-label="Editor mode">
          <Button
            variant={mode === "write" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("write")}
          >
            <PenLine aria-hidden="true" />
            Write
          </Button>
          <Button
            variant={mode === "preview" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("preview")}
          >
            <Eye aria-hidden="true" />
            Preview
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {needsJobDescription ? (
          <p className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              No job description yet. Sourcing cannot start until one is here —
              the client can add it, or write it for them.
            </span>
          </p>
        ) : null}

        {FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`requisition-${field.key}`}>{field.label}</Label>
            <p className="text-xs text-neutral-500">{field.hint}</p>
            {mode === "write" ? (
              <Textarea
                id={`requisition-${field.key}`}
                rows={8}
                value={drafts[field.key]}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            ) : (
              <div className="rounded-md border border-border-default bg-surface-subtle p-3">
                <SimpleMarkdown
                  source={drafts[field.key]}
                  emptyFallback={
                    <p className="text-sm text-neutral-500">
                      Nothing written yet.
                    </p>
                  }
                />
              </div>
            )}
          </div>
        ))}

        {error !== null ? (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!isDirty || updateRequisition.isPending}
          >
            {updateRequisition.isPending ? "Saving…" : "Save"}
          </Button>
          {isDirty ? (
            <p className="text-xs text-neutral-500">Unsaved changes</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
