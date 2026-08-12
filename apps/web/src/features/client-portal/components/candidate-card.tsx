/**
 * One presented candidate, as the client reviews it (01 §3 J6, AC-E2E-04/05).
 *
 * Renders a ClientVisibleAssignment row — the 02 §11 view shape — and
 * NOTHING else, so it structurally cannot leak internal data. Its field set
 * mirrors the admin present-review sheet's client preview
 * (features/pipeline/components/present-review-sheet.tsx): what the admin
 * was promised the client sees is exactly what this card shows.
 *
 * Actions by stage:
 *   presented            → Approve for interview · Request interview · Decline
 *   client_reviewing     → Request interview · Decline (+ "Approved" chip)
 *   interview_scheduled / interviewed → interview details + Decline
 *   offer / placed       → celebratory banner
 *   rejected_by_client / closed_not_selected → muted, no actions
 */
import {
  CalendarPlus,
  CheckCircle2,
  PartyPopper,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { ClientVisibleAssignment } from "@sdb/contracts";
import { isPiiUnlockedStage } from "@sdb/contracts";
import type { ClientVisibleStage } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { ENGAGEMENT_LABELS, SENIORITY_LABELS } from "@/lib/format";
import {
  ACCENT_LABELS,
  AUTONOMY_LABELS,
  LANGUAGE_LEVEL_LABELS,
  countryFlag,
} from "@/features/candidates/labels";
import { useAssignmentInterviews } from "../api";
import { CLIENT_STAGE_LABELS, isCelebratoryStage, isMutedStage } from "../labels";
import { CandidateFiles } from "./candidate-files";
import { ContactPanel } from "./contact-panel";
import { InterviewDetails } from "./interview-details";

// ---------------------------------------------------------------------------
// Stage badge (client wording; colour + text, never colour alone — AC-UI-03)
// ---------------------------------------------------------------------------

type BadgeTone = "info" | "interview" | "success" | "muted";

const STAGE_TONES: Record<ClientVisibleStage, BadgeTone> = {
  presented: "info",
  client_reviewing: "info",
  interview_scheduled: "interview",
  interviewed: "interview",
  offer: "success",
  placed: "success",
  rejected_by_client: "muted",
  closed_not_selected: "muted",
};

const TONE_CLASSES: Record<BadgeTone, string> = {
  info: "text-info bg-info-subtle",
  interview: "text-warning-text bg-warning-subtle",
  success: "text-success-text bg-success-subtle",
  muted: "text-neutral-600 bg-neutral-100",
};

export function ClientStageBadge({ stage }: { stage: ClientVisibleStage }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[STAGE_TONES[stage]],
      )}
    >
      {CLIENT_STAGE_LABELS[stage]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Profile facts
// ---------------------------------------------------------------------------

interface Fact {
  label: string;
  value: string;
}

function boolLabel(value: boolean | null): string | null {
  if (value === null) return null;
  return value ? "Yes" : "No";
}

/** Only facts with real values — nulls disappear rather than render as "—". */
function profileFacts(row: ClientVisibleAssignment): Fact[] {
  const facts: Array<Fact | null> = [
    row.yearsExperienceTotal !== null
      ? { label: "Experience", value: `${row.yearsExperienceTotal} years` }
      : null,
    row.yearsExperienceRelevant !== null
      ? {
          label: "Relevant experience",
          value: `${row.yearsExperienceRelevant} years`,
        }
      : null,
    row.seniorityLevel !== null
      ? { label: "Seniority", value: SENIORITY_LABELS[row.seniorityLevel] }
      : null,
    row.availableFrom !== null
      ? { label: "Available from", value: formatDate(row.availableFrom) }
      : null,
    row.engagementTypes !== null && row.engagementTypes.length > 0
      ? {
          label: "Engagement",
          value: row.engagementTypes
            .map((type) => ENGAGEMENT_LABELS[type])
            .join(", "),
        }
      : null,
    row.hoursAvailablePerWeek !== null
      ? { label: "Hours / week", value: String(row.hoursAvailablePerWeek) }
      : null,
    row.overlapStart !== null && row.overlapEnd !== null
      ? {
          label: "Overlap window",
          value: `${row.overlapStart.slice(0, 5)}–${row.overlapEnd.slice(0, 5)}${
            row.overlapTimezone !== null ? ` ${row.overlapTimezone}` : ""
          }`,
        }
      : null,
    row.autonomy !== null
      ? { label: "Autonomy", value: AUTONOMY_LABELS[row.autonomy] }
      : null,
    boolLabel(row.canManageUp) !== null
      ? { label: "Can manage up", value: boolLabel(row.canManageUp) ?? "" }
      : null,
  ];
  return facts.filter((fact): fact is Fact => fact !== null);
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CandidateCardProps {
  row: ClientVisibleAssignment;
  /** The client asked for an interview this session (no stage change). */
  isInterviewRequested: boolean;
  /** Reason label captured when this session declined the candidate. */
  rejectionReasonLabel: string | undefined;
  onApprove: (row: ClientVisibleAssignment) => void;
  onRequestInterview: (row: ClientVisibleAssignment) => void;
  onReject: (row: ClientVisibleAssignment) => void;
}

export function CandidateCard({
  row,
  isInterviewRequested,
  rejectionReasonLabel,
  onApprove,
  onRequestInterview,
  onReject,
}: CandidateCardProps) {
  const isMuted = isMutedStage(row.stage);
  const isCelebratory = isCelebratoryStage(row.stage);
  const showInterviews =
    row.stage === "interview_scheduled" || row.stage === "interviewed";
  const interviewsQuery = useAssignmentInterviews(
    row.assignmentId,
    showInterviews && isPiiUnlockedStage(row.stage),
  );

  const location = [row.city, row.regionState, row.country]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
  const flag = countryFlag(row.country);
  const facts = profileFacts(row);

  const chips: string[] = [
    ...(row.englishSpokenLevel !== null
      ? [`Spoken: ${LANGUAGE_LEVEL_LABELS[row.englishSpokenLevel]}`]
      : []),
    ...(row.englishWrittenLevel !== null
      ? [`Written: ${LANGUAGE_LEVEL_LABELS[row.englishWrittenLevel]}`]
      : []),
    ...(row.accentStrength !== null
      ? [ACCENT_LABELS[row.accentStrength]]
      : []),
  ];

  return (
    <article
      aria-label={`Candidate ${row.displayName}`}
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border-default bg-surface-raised p-5 shadow-sm",
        isMuted && "opacity-70",
      )}
    >
      {/* ----- Identity row ----- */}
      <div className="flex items-start gap-3">
        {row.photoPath !== null ? (
          <img
            src={row.photoPath}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-blue-subtle text-base font-semibold text-brand-blue"
          >
            {row.displayName.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-brand-navy-ink">
            {flag !== null ? `${flag} ` : ""}
            {row.displayName}
          </h3>
          {row.currentTitle !== null ? (
            <p className="truncate text-sm text-neutral-600">
              {row.currentTitle}
            </p>
          ) : null}
          {location !== "" || row.timezone !== null ? (
            <p className="text-xs text-neutral-500">
              {location}
              {location !== "" && row.timezone !== null ? " · " : ""}
              {row.timezone ?? ""}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <ClientStageBadge stage={row.stage} />
          {row.stage === "client_reviewing" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text">
              <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
              Approved
            </span>
          ) : null}
          {isInterviewRequested && !showInterviews && !isMuted ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-info-subtle px-2 py-0.5 text-[11px] font-medium text-info">
              <CalendarPlus aria-hidden="true" className="h-3 w-3" />
              Interview requested
            </span>
          ) : null}
        </div>
      </div>

      {/* ----- English + accent chips ----- */}
      {chips.length > 0 ? (
        <ul aria-label="English and accent" className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600"
            >
              {chip}
            </li>
          ))}
        </ul>
      ) : null}

      {/* ----- Profile facts ----- */}
      {facts.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="flex items-baseline justify-between gap-2"
            >
              <dt className="text-xs text-neutral-500">{fact.label}</dt>
              <dd className="text-right text-xs font-medium tabular-nums text-neutral-800">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {/* ----- SDB recommendation (highlighted) + strengths ----- */}
      {row.recruiterRecommendation !== null ? (
        <div className="rounded-md border-l-4 border-brand-blue bg-brand-blue-subtle px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-tight text-brand-blue">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            SDB recommendation
          </p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-800">
            {row.recruiterRecommendation}
          </p>
        </div>
      ) : null}
      {row.strengths !== null ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-tight text-neutral-500">
            Strengths
          </p>
          <p className="mt-1 text-sm leading-relaxed text-neutral-800">
            {row.strengths}
          </p>
        </div>
      ) : null}

      {/* ----- Note from the SDB team ----- */}
      {row.clientNote !== null && row.clientNote.trim() !== "" ? (
        <div className="rounded-md bg-surface-subtle px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-tight text-neutral-500">
            Note from your SDB team
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">
            {row.clientNote}
          </p>
        </div>
      ) : null}

      {/* ----- Files ----- */}
      <CandidateFiles files={row.files} candidateName={row.displayName} />

      {/* ----- Gated PII: lock panel or contact block (rule 4) ----- */}
      {!isMuted ? <ContactPanel row={row} /> : null}

      {/* ----- Interview details ----- */}
      {showInterviews ? (
        <InterviewDetails
          interviews={interviewsQuery.data}
          isLoading={interviewsQuery.isLoading}
          isError={interviewsQuery.isError}
          error={interviewsQuery.error}
        />
      ) : null}

      {/* ----- Terminal / celebratory banners ----- */}
      {isCelebratory ? (
        <p className="flex items-center gap-2 rounded-md bg-success-subtle px-3 py-2.5 text-sm font-medium text-success-text">
          <PartyPopper aria-hidden="true" className="h-4 w-4 shrink-0" />
          {row.stage === "placed"
            ? `${row.displayName} is joining your team. Congratulations!`
            : `An offer is out to ${row.displayName} — nearly there.`}
        </p>
      ) : null}
      {row.stage === "rejected_by_client" ? (
        <p className="rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-neutral-600">
          You declined this candidate
          {rejectionReasonLabel !== undefined
            ? `: ${rejectionReasonLabel}`
            : "."}
        </p>
      ) : null}
      {row.stage === "closed_not_selected" ? (
        <p className="rounded-md bg-surface-subtle px-3 py-2.5 text-sm text-neutral-600">
          This position has been filled.
        </p>
      ) : null}

      {/* ----- Actions ----- */}
      {row.stage === "presented" || row.stage === "client_reviewing" ? (
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border-default pt-4">
          {row.stage === "presented" ? (
            <Button size="sm" onClick={() => onApprove(row)}>
              <ThumbsUp aria-hidden="true" />
              Approve for interview
            </Button>
          ) : null}
          {!isInterviewRequested ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onRequestInterview(row)}
            >
              <CalendarPlus aria-hidden="true" />
              Request interview
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-danger-text hover:bg-danger-subtle"
            onClick={() => onReject(row)}
          >
            <ThumbsDown aria-hidden="true" />
            Decline
          </Button>
        </div>
      ) : null}
      {showInterviews ? (
        <div className="mt-auto flex justify-end border-t border-border-default pt-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-text hover:bg-danger-subtle"
            onClick={() => onReject(row)}
          >
            <ThumbsDown aria-hidden="true" />
            Decline
          </Button>
        </div>
      ) : null}
    </article>
  );
}
