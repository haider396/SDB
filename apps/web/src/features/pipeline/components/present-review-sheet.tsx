/**
 * The present-candidates review sheet (05 §4.7 "Candidate presentation",
 * AC-UI-04): for every selected vetted candidate it renders the CLIENT'S
 * view — exactly the always-visible fields of ClientVisibleAssignmentSchema
 * (packages/contracts/src/assignments.ts) — and lists the gated PII fields
 * (GATED_PII_FIELDS) lock-chipped as "Withheld until interview". The admin
 * should never have to guess what the client sees.
 *
 * Consent is the blocking gate: presenting is all-or-nothing on the server
 * (422 CONSENT_MISSING, AC-PL-05), so the confirm button is disabled while
 * any selected candidate lacks consent, with a banner naming them. A 422
 * that still slips through (raced consent change) maps offender ids back to
 * names inline.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Lock } from "lucide-react";
import { GATED_PII_FIELDS, type GatedPiiField } from "@sdb/contracts";
import type { AdminAssignmentRow, CandidateDetail } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import {
  ACCENT_LABELS,
  AUTONOMY_LABELS,
  LANGUAGE_LEVEL_LABELS,
  countryFlag,
  formatBytes,
} from "@/features/candidates/labels";
import { SENIORITY_LABELS, ENGAGEMENT_LABELS } from "@/lib/format";
import { usePresentAssignments } from "../api";

/** Human labels for the six gated fields, in GATED_PII_FIELDS order. */
const GATED_FIELD_LABELS: Record<GatedPiiField, string> = {
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  linkedinUrl: "LinkedIn",
  currentEmployer: "Current employer",
};

export interface PresentReviewSheetProps {
  requisitionId: string;
  /** The selected vetted assignments, in board order. */
  rows: AdminAssignmentRow[];
  candidateById: Map<string, CandidateDetail>;
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful present so the page can clear selection. */
  onPresented: () => void;
}

function boolLabel(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "Yes" : "No";
}

interface PreviewField {
  label: string;
  value: string;
}

/**
 * The always-visible field set, mirrored one-for-one from
 * ClientVisibleAssignmentSchema's "always visible" block. Values are read
 * from the candidate detail because the view reads the same candidate
 * columns.
 */
function previewFields(candidate: CandidateDetail): PreviewField[] {
  const location = [candidate.city, candidate.regionState, candidate.country]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
  const overlap =
    candidate.overlapStart !== null && candidate.overlapEnd !== null
      ? `${candidate.overlapStart}–${candidate.overlapEnd}${
          candidate.overlapTimezone !== null
            ? ` ${candidate.overlapTimezone}`
            : ""
        }`
      : "—";
  return [
    { label: "Location", value: location === "" ? "—" : location },
    { label: "Timezone", value: candidate.timezone ?? "—" },
    {
      label: "English (spoken)",
      value:
        candidate.englishSpokenLevel !== null
          ? LANGUAGE_LEVEL_LABELS[candidate.englishSpokenLevel]
          : "—",
    },
    {
      label: "English (written)",
      value:
        candidate.englishWrittenLevel !== null
          ? LANGUAGE_LEVEL_LABELS[candidate.englishWrittenLevel]
          : "—",
    },
    {
      label: "Accent",
      value:
        candidate.accentStrength !== null
          ? ACCENT_LABELS[candidate.accentStrength]
          : "—",
    },
    {
      label: "Experience (total)",
      value:
        candidate.yearsExperienceTotal !== null
          ? `${candidate.yearsExperienceTotal} years`
          : "—",
    },
    {
      label: "Experience (relevant)",
      value:
        candidate.yearsExperienceRelevant !== null
          ? `${candidate.yearsExperienceRelevant} years`
          : "—",
    },
    { label: "Current title", value: candidate.currentTitle ?? "—" },
    {
      label: "Seniority",
      value:
        candidate.seniorityLevel !== null
          ? SENIORITY_LABELS[candidate.seniorityLevel]
          : "—",
    },
    {
      label: "Management experience",
      value: boolLabel(candidate.hasManagementExperience),
    },
    {
      label: "Team size managed",
      value:
        candidate.teamSizeManaged !== null
          ? String(candidate.teamSizeManaged)
          : "—",
    },
    {
      label: "Client-facing experience",
      value: boolLabel(candidate.hasClientFacingExperience),
    },
    {
      label: "US-client experience",
      value: boolLabel(candidate.hasUsClientExperience),
    },
    {
      label: "Remote experience",
      value:
        candidate.remoteExperienceYears !== null
          ? `${candidate.remoteExperienceYears} years`
          : "—",
    },
    { label: "Available from", value: formatDate(candidate.availableFrom) },
    {
      label: "Engagement types",
      value:
        candidate.engagementTypes !== null &&
        candidate.engagementTypes.length > 0
          ? candidate.engagementTypes
              .map((type) => ENGAGEMENT_LABELS[type])
              .join(", ")
          : "—",
    },
    {
      label: "Hours available / week",
      value:
        candidate.hoursAvailablePerWeek !== null
          ? String(candidate.hoursAvailablePerWeek)
          : "—",
    },
    { label: "Overlap window", value: overlap },
    {
      label: "Autonomy",
      value:
        candidate.autonomy !== null ? AUTONOMY_LABELS[candidate.autonomy] : "—",
    },
    { label: "Can manage up", value: boolLabel(candidate.canManageUp) },
  ];
}

export function PresentReviewSheet({
  requisitionId,
  rows,
  candidateById,
  isOpen,
  onClose,
  onPresented,
}: PresentReviewSheetProps) {
  const [clientNote, setClientNote] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  // Collapsed-by-default rows; the first candidate starts expanded so the
  // admin sees a full preview without an extra click.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const firstRowId = rows[0]?.id;
  useEffect(() => {
    if (isOpen) {
      setExpandedIds(new Set(firstRowId === undefined ? [] : [firstRowId]));
    }
  }, [isOpen, firstRowId]);
  const toggleExpanded = (rowId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };
  const present = usePresentAssignments(requisitionId);

  const missingConsent = rows.filter(
    (row) => !row.candidate.hasConsentToShareProfile,
  );
  const nameOfCandidateId = (candidateId: string): string =>
    rows.find((row) => row.candidateId === candidateId)?.candidate
      .displayName ?? candidateId;

  const confirm = () => {
    setInlineError(null);
    const note = clientNote.trim();
    present.mutate(
      {
        assignmentIds: rows.map((row) => row.id),
        ...(note === "" ? {} : { clientNote: note }),
      },
      {
        onSuccess: (updated) => {
          toast.success(
            updated.length === 1
              ? "1 candidate presented to the client."
              : `${updated.length} candidates presented to the client.`,
          );
          setClientNote("");
          onPresented();
          onClose();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "CONSENT_MISSING") {
            const ids = error.details?.candidateIds;
            const names = Array.isArray(ids)
              ? ids
                  .filter((id): id is string => typeof id === "string")
                  .map(nameOfCandidateId)
                  .join(", ")
              : "";
            setInlineError(
              names === ""
                ? "One or more candidates have not consented to profile sharing. Nobody was presented."
                : `Consent is missing for: ${names}. Nobody was presented.`,
            );
            return;
          }
          setInlineError(
            error instanceof ApiError
              ? error.message
              : "Presenting failed. Please try again.",
          );
        },
      },
    );
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setInlineError(null);
          onClose();
        }
      }}
    >
      <SheetContent className="max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            Present {rows.length} candidate{rows.length === 1 ? "" : "s"}
          </SheetTitle>
          <SheetDescription>
            This is exactly what the client will see. Locked fields stay
            hidden until an interview is scheduled.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {missingConsent.length > 0 ? (
            <div
              role="alert"
              className="mb-4 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text"
            >
              Presenting is blocked: consent to share the profile is missing
              for{" "}
              {missingConsent
                .map((row) => row.candidate.displayName)
                .join(", ")}
              . Presenting is all-or-nothing — capture consent first or
              deselect them.
            </div>
          ) : null}

          {inlineError !== null ? (
            <div
              role="alert"
              className="mb-4 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text"
            >
              {inlineError}
            </div>
          ) : null}

          <ul aria-label="Client preview" className="space-y-4">
            {rows.map((row) => {
              const candidate = candidateById.get(row.candidateId);
              const clientVisibleFiles =
                candidate?.files.filter((file) => file.isClientVisible) ?? [];
              const isExpanded = expandedIds.has(row.id);
              return (
                <li
                  key={row.id}
                  aria-label={`Client preview for ${row.candidate.displayName}`}
                  className="rounded-lg border border-border-default bg-surface-raised p-4 shadow-xs"
                >
                  {/* ----- Header row: always visible ----- */}
                  <div className="flex items-center gap-3">
                    {candidate?.photoPath != null ? (
                      <img
                        src={candidate.photoPath}
                        alt=""
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue-subtle text-sm font-semibold text-brand-blue"
                      >
                        {row.candidate.displayName.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      {/* Clients identify candidates by displayName until PII unlocks. */}
                      <p className="truncate text-sm font-semibold text-brand-navy-ink">
                        {countryFlag(row.candidate.country) ?? ""}{" "}
                        {row.candidate.displayName}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {row.candidate.reference}
                      </p>
                    </div>
                    {!row.candidate.hasConsentToShareProfile ? (
                      <span className="ml-auto shrink-0 rounded-full bg-danger-subtle px-2 py-0.5 text-[11px] font-medium text-danger-text">
                        Consent missing
                      </span>
                    ) : (
                      <span className="ml-auto shrink-0 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text">
                        Consent on file
                      </span>
                    )}
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} preview for ${row.candidate.displayName}`}
                      onClick={() => toggleExpanded(row.id)}
                      className="shrink-0 rounded-sm p-1 text-neutral-500 hover:text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={
                          isExpanded
                            ? "h-4 w-4 rotate-180 transition-transform duration-fast"
                            : "h-4 w-4 transition-transform duration-fast"
                        }
                      />
                    </button>
                  </div>

                  {/* Gated PII stays visible in the header region even when
                      collapsed — listed, locked, never previewed with values. */}
                  <div className="mt-2">
                    <p className="text-xs font-medium text-neutral-500">
                      Withheld until an interview is scheduled
                    </p>
                    <ul
                      aria-label={`Fields withheld from the client for ${row.candidate.displayName}`}
                      className="mt-1 flex flex-wrap gap-1.5"
                    >
                      {GATED_PII_FIELDS.map((field) => (
                        <li key={field}>
                          <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                            <Lock aria-hidden="true" className="h-3 w-3" />
                            <span className="line-through">
                              {GATED_FIELD_LABELS[field]}
                            </span>
                            <span className="sr-only">
                              — withheld until interview
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* ----- Expandable detail ----- */}
                  {!isExpanded ? null : candidate === undefined ? (
                    <div className="mt-3">
                      <LoadingSkeleton
                        variant="card"
                        rows={1}
                        label="Loading candidate details…"
                      />
                    </div>
                  ) : (
                    <div className="mt-3 border-t border-border-default pt-3">
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                        {previewFields(candidate).map((field) => (
                          <div
                            key={field.label}
                            className="flex items-baseline justify-between gap-2"
                          >
                            <dt className="text-xs text-neutral-500">
                              {field.label}
                            </dt>
                            <dd className="text-right text-xs font-medium text-neutral-800">
                              {field.value}
                            </dd>
                          </div>
                        ))}
                      </dl>

                      {candidate.recruiterRecommendation !== null ? (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-neutral-500">
                            Recruiter recommendation
                          </p>
                          <p className="mt-0.5 text-sm text-neutral-800">
                            {candidate.recruiterRecommendation}
                          </p>
                        </div>
                      ) : null}
                      {candidate.strengths !== null ? (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-neutral-500">
                            Strengths
                          </p>
                          <p className="mt-0.5 text-sm text-neutral-800">
                            {candidate.strengths}
                          </p>
                        </div>
                      ) : null}

                      <div className="mt-3">
                        <p className="text-xs font-medium text-neutral-500">
                          Files the client can download
                        </p>
                        {clientVisibleFiles.length === 0 ? (
                          <p className="mt-0.5 text-xs text-neutral-500">
                            None — no files are marked client-visible.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-0.5">
                            {clientVisibleFiles.map((file) => (
                              <li
                                key={file.id}
                                className="text-xs text-neutral-800"
                              >
                                {file.originalFilename}{" "}
                                <span className="text-neutral-500">
                                  ({formatBytes(file.sizeBytes)})
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 space-y-1.5">
            <Label htmlFor="present-client-note">
              Note to the client (optional)
            </Label>
            <Textarea
              id="present-client-note"
              value={clientNote}
              onChange={(event) => setClientNote(event.target.value)}
              placeholder="Shown to the client alongside these candidates."
              maxLength={5000}
            />
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              rows.length === 0 ||
              missingConsent.length > 0 ||
              present.isPending
            }
            onClick={confirm}
          >
            {present.isPending
              ? "Presenting…"
              : `Present ${rows.length} candidate${rows.length === 1 ? "" : "s"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
