/**
 * /admin/candidates/:id — the candidate workspace where vetting happens
 * (01 §3 J4; none of it is client-visible until presentation). Two-column at
 * ≥1280 px (05 §4.1): sectioned cards in SCREENING-CALL order on the left
 * (identity → language → professional → compensation → vetting →
 * disqualifiers → remote environment → skills, then the collections, with
 * source/consent last); photo, pool status, section nav, quick facts, files,
 * and archive in a sticky right rail. Every card saves independently; one
 * dirty registry guards navigation and powers the sticky "Save all" bar.
 */
import { useParams } from "react-router-dom";
import { ErrorState } from "@/components/patterns/error-state";
import { EventLogCard } from "@/components/patterns/event-log-card";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCandidate, useCandidateEvents } from "./api";
import { SUBMISSION_CHANNEL_LABELS } from "./labels";
import {
  DirtyRegistryProvider,
  useDirtySections,
} from "./components/section-form";
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
import { FormSubmissionsCard } from "./components/form-submissions-card";
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

/**
 * The main-column cards in screening-call order. `id` doubles as the anchor
 * (`candidate-section-<id>`) and — where the card registers with the dirty
 * registry — as its registry id.
 */
const SECTIONS: readonly { id: string; label: string }[] = [
  { id: "identity", label: "Identity & location" },
  { id: "language", label: "Language & communication" },
  { id: "professional", label: "Professional" },
  { id: "compensation", label: "Compensation & availability" },
  { id: "vetting", label: "Vetting & fit" },
  { id: "disqualifiers", label: "Disqualifier checks" },
  { id: "remote-environment", label: "Remote environment" },
  { id: "skills-summary", label: "Skills summary" },
  { id: "languages", label: "Languages" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "employment", label: "Employment" },
  { id: "education", label: "Education" },
  { id: "certifications", label: "Certifications" },
  { id: "references", label: "References" },
  { id: "notes", label: "Notes" },
  { id: "source", label: "Source & provenance" },
  { id: "form-answers", label: "Form answers" },
  { id: "consent", label: "Consent & retention" },
];

const SECTION_LABEL_BY_ID = new Map(
  SECTIONS.map((section) => [section.id, section.label]),
);

export function anchorIdFor(sectionId: string): string {
  return `candidate-section-${sectionId}`;
}

export function scrollToSection(sectionId: string): void {
  document
    .getElementById(anchorIdFor(sectionId))
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Anchor jump link used by the rail nav and the save bar. */
function SectionJumpLink({
  sectionId,
  children,
  className,
}: {
  sectionId: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={`#${anchorIdFor(sectionId)}`}
      onClick={(event) => {
        event.preventDefault();
        scrollToSection(sectionId);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

/** Rail card: one jump link per section card, in page order. */
function SectionNavCard() {
  const dirty = useDirtySections();
  const dirtySet = new Set(dirty?.dirtyIds ?? []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">On this page</CardTitle>
      </CardHeader>
      <CardContent>
        <nav aria-label="Candidate sections">
          <ul className="space-y-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <SectionJumpLink
                  sectionId={section.id}
                  className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-sm text-neutral-600 hover:text-brand-navy-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                >
                  {section.label}
                  {dirtySet.has(section.id) ? (
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-text"
                      title="Unsaved changes"
                    >
                      <span className="sr-only"> — unsaved changes</span>
                    </span>
                  ) : null}
                </SectionJumpLink>
              </li>
            ))}
          </ul>
        </nav>
      </CardContent>
    </Card>
  );
}

/**
 * Sticky bottom bar, shown while ≥1 section is dirty: count, jump links to
 * each dirty section, and a Save-all that flushes every dirty card's own
 * form sequentially through the registry.
 */
function UnsavedChangesBar() {
  const dirty = useDirtySections();
  if (dirty === null || dirty.dirtyIds.length === 0) return null;
  const count = dirty.dirtyIds.length;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-0 z-10 -mx-2 mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-t-lg bg-surface-raised px-4 py-2.5 shadow-lg"
    >
      <p className="text-sm font-medium text-neutral-800">
        {count} section{count === 1 ? " has" : "s have"} unsaved changes
      </p>
      <ul className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {dirty.dirtyIds.map((sectionId) => (
          <li key={sectionId}>
            <SectionJumpLink
              sectionId={sectionId}
              className="text-sm text-brand-blue hover:underline"
            >
              {SECTION_LABEL_BY_ID.get(sectionId) ?? sectionId}
            </SectionJumpLink>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        className="ml-auto"
        disabled={dirty.isSavingAll}
        onClick={() => void dirty.saveAll()}
      >
        {dirty.isSavingAll ? "Saving…" : "Save all"}
      </Button>
    </div>
  );
}

function SectionAnchor({
  sectionId,
  children,
}: {
  sectionId: string;
  children: React.ReactNode;
}) {
  return (
    <div id={anchorIdFor(sectionId)} className="scroll-mt-6">
      {children}
    </div>
  );
}

export function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const candidateId = id ?? "";
  const query = useCandidate(candidateId);
  // The route param may be a public id; /events needs the real UUID.
  const eventsQuery = useCandidateEvents(query.data?.id);

  if (query.isPending) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[...BREADCRUMBS, { label: "Loading…" }]}
          title="Candidate"
        />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
          <div className="space-y-6">
            {/* Roughly one skeleton per section card (05 §4.3). */}
            {Array.from({ length: 6 }, (_, index) => (
              <LoadingSkeleton
                key={index}
                variant="card"
                rows={3}
                label={index === 0 ? "Loading candidate…" : undefined}
              />
            ))}
          </div>
          <div className="space-y-6">
            <LoadingSkeleton variant="card" rows={2} label="Loading details…" />
            <LoadingSkeleton variant="card" rows={3} />
            <LoadingSkeleton variant="card" rows={2} />
          </div>
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
          subtitle={`Added ${formatDate(candidate.createdAt)}`}
          meta={
            <>
              <span className="font-mono">{candidate.reference}</span>
              <span>
                via {SUBMISSION_CHANNEL_LABELS[candidate.submittedVia]}
              </span>
            </>
          }
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
          {/* ----- Main column: screening-call order (UX 2.5) ----- */}
          <div className="min-w-0 space-y-6">
            <SectionAnchor sectionId="identity">
              <IdentitySection candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="language">
              <LanguageSection candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="professional">
              <ProfessionalSection candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="compensation">
              <CompensationSection candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="vetting">
              <VettingSection candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="disqualifiers">
              <DisqualifiersCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="remote-environment">
              <RemoteEnvironmentSection candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="skills-summary">
              <SkillsSummarySection candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="languages">
              <LanguagesCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="tools">
              <ToolsCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="skills">
              <SkillsCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="employment">
              <EmploymentCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="education">
              <EducationCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="certifications">
              <CertificationsCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="references">
              <ReferencesCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="notes">
              <NotesCard candidate={candidate} />
            </SectionAnchor>
            <SectionAnchor sectionId="source">
              <SourceSection candidate={candidate} />
            </SectionAnchor>
            {/* Read-only, so it deliberately does NOT register with the
                dirty registry and never appears in the Save-all bar. */}
            <SectionAnchor sectionId="form-answers">
              <FormSubmissionsCard submissions={candidate.submissions} />
            </SectionAnchor>
            <SectionAnchor sectionId="consent">
              <ConsentCard candidate={candidate} />
            </SectionAnchor>
          </div>

          {/* ----- Sticky right rail (05 §4.1) ----- */}
          <div className="space-y-6 self-start xl:sticky xl:top-6">
            <ProfileRailCard candidate={candidate} />
            <SectionNavCard />
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

        <UnsavedChangesBar />
      </div>
    </DirtyRegistryProvider>
  );
}
