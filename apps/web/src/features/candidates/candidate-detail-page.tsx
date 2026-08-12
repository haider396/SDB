/**
 * /admin/candidates/:id — the candidate workspace where vetting happens
 * (01 §3 J4; none of it is client-visible until presentation). Two-column at
 * ≥1280 px (05 §4.1): sectioned cards mirroring the 02 §8 column groups on
 * the left; photo, pool status, quick facts, files, and archive in a sticky
 * right rail. Every card saves independently; one dirty registry guards
 * navigation for all of them.
 */
import { useParams } from "react-router-dom";
import { ErrorState } from "@/components/patterns/error-state";
import { EventLogCard } from "@/components/patterns/event-log-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { useCandidate, useCandidateEvents } from "./api";
import { SUBMISSION_CHANNEL_LABELS } from "./labels";
import { DirtyRegistryProvider } from "./components/section-form";
import {
  CompensationSection,
  IdentitySection,
  LanguageSection,
  ProfessionalSection,
  RemoteEnvironmentSection,
  SkillsSummarySection,
  SourceSection,
  VettingSection,
} from "./components/sections";
import { ConsentCard } from "./components/consent-card";
import {
  CertificationsCard,
  EducationCard,
  EmploymentCard,
  LanguagesCard,
  NotesCard,
  ReferencesCard,
} from "./components/collections";
import { SkillsCard, ToolsCard } from "./components/tools-skills-card";
import { DisqualifiersCard } from "./components/disqualifiers-card";
import { FilesCard } from "./components/files-card";
import {
  ArchiveRailCard,
  ProfileRailCard,
  QuickFactsCard,
} from "./components/rail-cards";
import { formatDate } from "@/lib/format";

const BREADCRUMBS = [
  { label: "Admin", to: "/admin" },
  { label: "Candidates", to: "/admin/candidates" },
];

export function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const candidateId = id ?? "";
  const query = useCandidate(candidateId);
  const eventsQuery = useCandidateEvents(candidateId);

  if (query.isPending) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[...BREADCRUMBS, { label: "Loading…" }]}
          title="Candidate"
        />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            <LoadingSkeleton variant="card" rows={3} label="Loading candidate…" />
          </div>
          <LoadingSkeleton variant="card" rows={2} label="Loading details…" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[...BREADCRUMBS, { label: "Candidate" }]}
          title="Candidate"
        />
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const candidate = query.data;
  const fullName = `${candidate.firstName} ${candidate.lastName}`;

  return (
    <DirtyRegistryProvider>
      <div>
        <PageHeader
          breadcrumbs={[...BREADCRUMBS, { label: fullName }]}
          title={fullName}
          subtitle={`${candidate.reference} · via ${
            SUBMISSION_CHANNEL_LABELS[candidate.submittedVia]
          } · added ${formatDate(candidate.createdAt)}`}
        />

        {candidate.archivedAt !== null ? (
          <div
            role="status"
            className="mb-6 rounded-md bg-warning-subtle px-4 py-3 text-sm text-warning-text"
          >
            This candidate was archived on {formatDate(candidate.archivedAt)}.
            Edits remain possible but the profile is out of the active pool.
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
          {/* ----- Main column: 02 §8 section groups ----- */}
          <div className="min-w-0 space-y-6">
            <IdentitySection candidate={candidate} />
            <LanguageSection candidate={candidate} />
            <LanguagesCard candidate={candidate} />
            <ProfessionalSection candidate={candidate} />
            <SkillsSummarySection candidate={candidate} />
            <ToolsCard candidate={candidate} />
            <SkillsCard candidate={candidate} />
            <CompensationSection candidate={candidate} />
            <RemoteEnvironmentSection candidate={candidate} />
            <VettingSection candidate={candidate} />
            <DisqualifiersCard candidate={candidate} />
            <EmploymentCard candidate={candidate} />
            <EducationCard candidate={candidate} />
            <CertificationsCard candidate={candidate} />
            <ReferencesCard candidate={candidate} />
            <NotesCard candidate={candidate} />
            <SourceSection candidate={candidate} />
            <ConsentCard candidate={candidate} />
          </div>

          {/* ----- Sticky right rail (05 §4.1) ----- */}
          <div className="space-y-6 self-start xl:sticky xl:top-6">
            <ProfileRailCard candidate={candidate} />
            <QuickFactsCard candidate={candidate} />
            <FilesCard candidate={candidate} />
            <EventLogCard
              events={eventsQuery.data}
              isLoading={eventsQuery.isPending}
              isError={eventsQuery.isError}
              error={eventsQuery.error}
              onRetry={() => void eventsQuery.refetch()}
              emptyDescription="Every state change on this candidate is recorded here."
            />
            <ArchiveRailCard candidate={candidate} />
          </div>
        </div>
      </div>
    </DirtyRegistryProvider>
  );
}
