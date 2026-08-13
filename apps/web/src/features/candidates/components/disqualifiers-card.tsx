/**
 * Disqualifier checklist (02 §8.2): one row per ACTIVE disqualifier, each
 * with pass / fail / n-a and optional notes. Saving PUTs the answered checks
 * — the endpoint upserts what is listed and leaves the rest untouched.
 */
import { useState } from "react";
import type {
  CandidateDetail,
  DisqualifierCheckResult,
  PutDisqualifierChecksBody,
} from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useChildWrite, useDisqualifierOptions } from "../api";
import { VisibilityChip } from "./badges";
import { useRegisterSectionSubmit, useReportDirty } from "./section-form";

interface CheckDraft {
  result: DisqualifierCheckResult | "";
  notes: string;
}

const RESULT_OPTIONS: { value: DisqualifierCheckResult; label: string }[] = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "not_applicable", label: "N/A" },
];

function ResultControl({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: DisqualifierCheckResult | "";
  onChange: (value: DisqualifierCheckResult) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`Result for ${label}`}
      className="inline-flex gap-1 rounded-md border border-border-default bg-surface-subtle p-1"
    >
      {RESULT_OPTIONS.map((option) => (
        <label key={option.value} className="cursor-pointer">
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <span
            className={cn(
              "flex h-7 items-center justify-center rounded-sm px-2.5 text-xs font-medium text-neutral-600 transition-colors duration-fast",
              "hover:text-neutral-900",
              option.value === "fail"
                ? "peer-checked:bg-danger-subtle peer-checked:text-danger-text"
                : option.value === "pass"
                  ? "peer-checked:bg-success-subtle peer-checked:text-success-text"
                  : "peer-checked:bg-surface-raised peer-checked:text-brand-navy-ink",
              "peer-checked:shadow-xs",
              "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-blue",
            )}
          >
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

export function DisqualifiersCard({
  candidate,
}: {
  candidate: CandidateDetail;
}) {
  const options = useDisqualifierOptions();
  const write = useChildWrite(candidate.id);

  const initial: Record<string, CheckDraft> = {};
  for (const check of candidate.disqualifierChecks) {
    initial[check.disqualifierId] = {
      result: check.result,
      notes: check.notes ?? "",
    };
  }
  const [drafts, setDrafts] = useState<Record<string, CheckDraft>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const draftFor = (disqualifierId: string): CheckDraft =>
    drafts[disqualifierId] ?? { result: "", notes: "" };

  const isDirty = (options.data ?? []).some((disqualifier) => {
    const draft = draftFor(disqualifier.id);
    const existing = initial[disqualifier.id] ?? { result: "", notes: "" };
    return draft.result !== existing.result || draft.notes !== existing.notes;
  });
  useReportDirty("disqualifiers", isDirty);

  const save = async () => {
    setError(null);
    const checks: PutDisqualifierChecksBody["checks"] = (options.data ?? [])
      .filter((disqualifier) => draftFor(disqualifier.id).result !== "")
      .map((disqualifier) => {
        const draft = draftFor(disqualifier.id);
        return {
          disqualifierId: disqualifier.id,
          // The filter above guarantees a concrete result.
          result: draft.result as DisqualifierCheckResult,
          notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
        };
      });
    if (checks.length === 0) {
      setError("Record at least one check result before saving.");
      return;
    }
    try {
      await write.mutateAsync({
        path: "disqualifier-checks",
        method: "PUT",
        body: { checks } satisfies PutDisqualifierChecksBody,
      });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 4000);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not save the disqualifier checks.",
      );
    }
  };
  useRegisterSectionSubmit("disqualifiers", save);

  const checkedById = new Map(
    candidate.disqualifierChecks.map((check) => [check.disqualifierId, check]),
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          Disqualifier checks
          <VisibilityChip visibility="internal" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {options.isPending ? (
          <LoadingSkeleton
            variant="list"
            rows={3}
            label="Loading disqualifiers…"
          />
        ) : options.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            The disqualifier list could not be loaded. Retry from the browser,
            or check the taxonomy configuration.
          </p>
        ) : (options.data ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">
            No active disqualifiers are configured. Manage them in Settings.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border-default">
              {(options.data ?? []).map((disqualifier) => {
                const draft = draftFor(disqualifier.id);
                const existing = checkedById.get(disqualifier.id);
                return (
                  <li key={disqualifier.id} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-neutral-800">
                        {disqualifier.label}
                      </p>
                      <ResultControl
                        id={`disqualifier-${disqualifier.id}`}
                        label={disqualifier.label}
                        value={draft.result}
                        onChange={(result) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [disqualifier.id]: { ...draftFor(disqualifier.id), result },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`disqualifier-notes-${disqualifier.id}`}
                        className="sr-only"
                      >
                        Notes for {disqualifier.label}
                      </label>
                      <Input
                        id={`disqualifier-notes-${disqualifier.id}`}
                        placeholder="Notes (optional)"
                        value={draft.notes}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [disqualifier.id]: {
                              ...draftFor(disqualifier.id),
                              notes: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    {existing !== undefined ? (
                      <p className="text-xs text-neutral-500">
                        Last checked {formatDateTime(existing.checkedAt)}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-end gap-3 border-t border-border-default pt-3">
              {error !== null ? (
                <p role="alert" className="mr-auto text-xs text-danger-text">
                  {error}
                </p>
              ) : savedFlash ? (
                <p aria-live="polite" className="mr-auto text-xs text-success-text">
                  Saved.
                </p>
              ) : isDirty ? (
                <p className="mr-auto text-xs text-warning-text">
                  Unsaved changes
                </p>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void save()}
                disabled={write.isPending || !isDirty}
              >
                {write.isPending ? "Saving…" : "Save checks"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
