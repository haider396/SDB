/**
 * The candidate editor's sectioned cards, mirroring the 02-DATABASE.md §8
 * column groups. Each card saves independently through SectionCard; field
 * visibility chips derive from the client_visible_assignments view model
 * (visibility.ts) wherever a field differs from its card's dominant
 * visibility.
 */
import { UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { CandidateDetail } from "@sdb/contracts";
import {
  AccentStrengthSchema,
  AutonomyLevelSchema,
  CandidateSourceSchema,
  EmploymentStatusSchema,
  EngagementTypeSchema,
  LanguageLevelSchema,
  ProficiencyLevelSchema,
  SalesBackgroundWeightSchema,
  SeniorityLevelSchema,
  VettingStatusSchema,
  WorkspaceTypeSchema,
} from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { formatDateTime, SENIORITY_LABELS, ENGAGEMENT_LABELS } from "@/lib/format";
import {
  ACCENT_LABELS,
  AUTONOMY_LABELS,
  CANDIDATE_SOURCE_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  LANGUAGE_LEVEL_LABELS,
  PROFICIENCY_LABELS,
  SALES_WEIGHT_LABELS,
  SUBMISSION_CHANNEL_LABELS,
  VETTING_STATUS_LABELS,
  WORKSPACE_LABELS,
} from "../labels";
import { useInvalidateFiles, useTaxonomyOptions, useUpdateCandidate } from "../api";
import { uploadCandidateFile, validateUploadFile } from "../upload";
import { VisibilityChip } from "./badges";
import {
  SectionCard,
  type FieldDescriptor,
  type SelectOption,
} from "./section-form";

function opts<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): SelectOption[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const LANGUAGE_OPTS = opts(LanguageLevelSchema.options, LANGUAGE_LEVEL_LABELS);
const ACCENT_OPTS = opts(AccentStrengthSchema.options, ACCENT_LABELS);
const RATE_UNIT_OPTS: SelectOption[] = [
  { value: "hourly", label: "Hourly" },
  { value: "monthly", label: "Monthly" },
];

interface SectionProps {
  candidate: CandidateDetail;
}

// ---------------------------------------------------------------------------
// Identity & location
// ---------------------------------------------------------------------------

const IDENTITY_FIELDS: readonly FieldDescriptor[] = [
  { name: "firstName", label: "First name", kind: "text" },
  { name: "lastName", label: "Last name", kind: "text" },
  {
    name: "preferredName",
    label: "Preferred name",
    kind: "text",
    help: "Drives the client-facing display name.",
  },
  { name: "email", label: "Email", kind: "text" },
  { name: "phone", label: "Phone", kind: "text" },
  { name: "whatsapp", label: "WhatsApp", kind: "text" },
  { name: "linkedinUrl", label: "LinkedIn URL", kind: "text" },
  { name: "portfolioUrl", label: "Portfolio URL", kind: "text" },
  { name: "country", label: "Country", kind: "text" },
  { name: "regionState", label: "Region / state", kind: "text" },
  { name: "city", label: "City", kind: "text" },
  {
    name: "timezone",
    label: "Timezone",
    kind: "text",
    placeholder: "e.g. Asia/Manila",
  },
  { name: "nationality", label: "Nationality", kind: "text" },
  { name: "relocationStatus", label: "Relocation status", kind: "text" },
];

/**
 * Photo upload slot: uploads a `photo`-type candidate file through the
 * signed-URL flow, then PATCHes photo_path so the display photo follows.
 */
function PhotoSlot({ candidate }: SectionProps) {
  const updateCandidate = useUpdateCandidate();
  const invalidateFiles = useInvalidateFiles();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    const validationError = validateUploadFile(file);
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    setError(null);
    setIsUploading(true);
    try {
      const uploaded = await uploadCandidateFile({
        candidateId: candidate.id,
        file,
        fileType: "photo",
      });
      await updateCandidate.mutateAsync({
        id: candidate.id,
        body: { photoPath: uploaded.storagePath },
      });
      invalidateFiles(candidate.id);
      toast.success("Photo uploaded.");
    } catch (cause) {
      setError(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : "The photo upload failed.",
      );
    } finally {
      setIsUploading(false);
      if (inputRef.current !== null) inputRef.current.value = "";
    }
  };

  return (
    <div className="mt-4 flex items-center gap-3 rounded-md border border-dashed border-border-default p-3">
      {candidate.photoUrl !== null ? (
        <img
          src={candidate.photoUrl}
          alt={`Photo of ${candidate.displayName}`}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-blue-subtle text-sm font-semibold text-brand-blue"
        >
          {candidate.firstName.charAt(0)}
          {candidate.lastName.charAt(0)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-800">Profile photo</p>
        <p className="text-xs text-neutral-500">
          {candidate.photoPath !== null
            ? "A photo is on file. Uploading replaces it on the profile."
            : "Shown to clients on the presented card. PNG, JPEG, or WebP."}
        </p>
        {error !== null ? (
          <p role="alert" className="mt-1 text-xs text-danger-text">
            {error}
          </p>
        ) : null}
      </div>
      <input
        ref={inputRef}
        id="identity-photo-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void upload(file);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud aria-hidden="true" />
        {isUploading ? "Uploading…" : "Upload photo"}
      </Button>
    </div>
  );
}

export function IdentitySection({ candidate }: SectionProps) {
  return (
    <SectionCard
      sectionId="identity"
      title="Identity & location"
      description={`Display name: ${candidate.displayName}`}
      candidate={candidate}
      fields={IDENTITY_FIELDS}
      defaultVisibility="client"
      footer={<PhotoSlot candidate={candidate} />}
    />
  );
}

// ---------------------------------------------------------------------------
// Language & communication
// ---------------------------------------------------------------------------

const LANGUAGE_FIELDS: readonly FieldDescriptor[] = [
  {
    name: "englishSpokenLevel",
    label: "English — spoken",
    kind: "select",
    options: LANGUAGE_OPTS,
  },
  {
    name: "englishWrittenLevel",
    label: "English — written",
    kind: "select",
    options: LANGUAGE_OPTS,
  },
  {
    name: "accentStrength",
    label: "Accent strength",
    kind: "select",
    options: ACCENT_OPTS,
  },
  { name: "languageAssessedAt", label: "Assessed at", kind: "datetime" },
  { name: "accentNotes", label: "Accent notes", kind: "textarea" },
];

export function LanguageSection({ candidate }: SectionProps) {
  return (
    <SectionCard
      sectionId="language"
      title="Language & communication"
      candidate={candidate}
      fields={LANGUAGE_FIELDS}
      defaultVisibility="client"
      footer={
        candidate.languageAssessedBy !== null ? (
          <p className="mt-3 text-xs text-neutral-500">
            Assessed by {candidate.languageAssessedBy}
            {candidate.languageAssessedAt !== null
              ? ` on ${formatDateTime(candidate.languageAssessedAt)}`
              : ""}
          </p>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Professional
// ---------------------------------------------------------------------------

export function ProfessionalSection({ candidate }: SectionProps) {
  const taxonomy = useTaxonomyOptions();
  const engineOptions: SelectOption[] = (taxonomy.data?.engines ?? []).map(
    (engine) => ({ value: engine.id, label: engine.label }),
  );
  const roleOptions: SelectOption[] = (taxonomy.data?.roleCategories ?? []).map(
    (category) => ({
      value: category.id,
      label: `${category.label} (${category.engineLabel} · ${category.departmentLabel})`,
    }),
  );

  const fields: readonly FieldDescriptor[] = [
    {
      name: "yearsExperienceTotal",
      label: "Years experience — total",
      kind: "number",
    },
    {
      name: "yearsExperienceRelevant",
      label: "Years experience — relevant",
      kind: "number",
    },
    { name: "currentTitle", label: "Current title", kind: "text" },
    { name: "currentEmployer", label: "Current employer", kind: "text" },
    {
      name: "employmentStatus",
      label: "Employment status",
      kind: "select",
      options: opts(EmploymentStatusSchema.options, EMPLOYMENT_STATUS_LABELS),
    },
    { name: "noticePeriodDays", label: "Notice period (days)", kind: "integer" },
    { name: "availableFrom", label: "Available from", kind: "date" },
    {
      name: "seniorityLevel",
      label: "Seniority",
      kind: "select",
      options: opts(SeniorityLevelSchema.options, SENIORITY_LABELS),
    },
    { name: "engineId", label: "Engine", kind: "select", options: engineOptions },
    {
      name: "primaryRoleCategoryId",
      label: "Primary role category",
      kind: "select",
      options: roleOptions,
    },
    {
      name: "secondarySpecialisationId",
      label: "Secondary specialisation",
      kind: "select",
      options: roleOptions,
    },
    {
      name: "hasManagementExperience",
      label: "Management experience",
      kind: "boolSelect",
    },
    { name: "teamSizeManaged", label: "Team size managed", kind: "integer" },
    {
      name: "hasClientFacingExperience",
      label: "Client-facing experience",
      kind: "boolSelect",
    },
    {
      name: "hasUsClientExperience",
      label: "US client experience",
      kind: "boolSelect",
    },
    {
      name: "remoteExperienceYears",
      label: "Remote experience (years)",
      kind: "number",
    },
  ];

  return (
    <SectionCard
      sectionId="professional"
      title="Professional"
      candidate={candidate}
      fields={fields}
      defaultVisibility="client"
    />
  );
}

// ---------------------------------------------------------------------------
// Skills summary
// ---------------------------------------------------------------------------

const SKILLS_SUMMARY_FIELDS: readonly FieldDescriptor[] = [
  {
    name: "aiToolProficiency",
    label: "AI tool proficiency",
    kind: "select",
    options: opts(ProficiencyLevelSchema.options, PROFICIENCY_LABELS),
  },
  { name: "typingWpm", label: "Typing (WPM)", kind: "integer" },
  { name: "techLiteracyRating", label: "Tech literacy", kind: "rating" },
];

export function SkillsSummarySection({ candidate }: SectionProps) {
  return (
    <SectionCard
      sectionId="skills-summary"
      title="Skills summary"
      candidate={candidate}
      fields={SKILLS_SUMMARY_FIELDS}
      defaultVisibility="internal"
      titleChip={<VisibilityChip visibility="internal" />}
    />
  );
}

// ---------------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------------

const COMPENSATION_FIELDS: readonly FieldDescriptor[] = [
  { name: "expectedRateAmount", label: "Expected rate", kind: "number" },
  {
    name: "expectedRateUnit",
    label: "Rate unit",
    kind: "select",
    options: RATE_UNIT_OPTS,
  },
  {
    name: "expectedRateCurrency",
    label: "Currency",
    kind: "text",
    placeholder: "USD",
  },
  { name: "rateMin", label: "Rate min", kind: "number" },
  { name: "rateMax", label: "Rate max", kind: "number" },
  { name: "isRateNegotiable", label: "Rate negotiable", kind: "boolSelect" },
  { name: "currentRateAmount", label: "Current rate", kind: "number" },
  {
    name: "currentRateUnit",
    label: "Current rate unit",
    kind: "select",
    options: RATE_UNIT_OPTS,
  },
  {
    name: "engagementTypes",
    label: "Engagement types",
    kind: "multiEnum",
    options: opts(EngagementTypeSchema.options, ENGAGEMENT_LABELS),
  },
  {
    name: "hoursAvailablePerWeek",
    label: "Hours available / week",
    kind: "integer",
  },
  { name: "overlapStart", label: "Overlap window start", kind: "time" },
  { name: "overlapEnd", label: "Overlap window end", kind: "time" },
  {
    name: "overlapTimezone",
    label: "Overlap timezone",
    kind: "text",
    placeholder: "e.g. America/New_York",
  },
  {
    name: "maxConcurrentClients",
    label: "Max concurrent clients",
    kind: "integer",
  },
];

/** Money safety: an expected/current rate amount requires its unit (02 §7). */
const COMPENSATION_AMOUNT_UNIT_RULES = [
  { amountField: "expectedRateAmount", unitField: "expectedRateUnit" },
  { amountField: "currentRateAmount", unitField: "currentRateUnit" },
] as const;

export function CompensationSection({ candidate }: SectionProps) {
  return (
    <SectionCard
      sectionId="compensation"
      title="Compensation & availability"
      candidate={candidate}
      fields={COMPENSATION_FIELDS}
      defaultVisibility="internal"
      amountUnitRules={COMPENSATION_AMOUNT_UNIT_RULES}
    />
  );
}

// ---------------------------------------------------------------------------
// Remote environment
// ---------------------------------------------------------------------------

const REMOTE_ENV_FIELDS: readonly FieldDescriptor[] = [
  { name: "internetDownMbps", label: "Internet down (Mbps)", kind: "number" },
  { name: "internetUpMbps", label: "Internet up (Mbps)", kind: "number" },
  { name: "hasBackupInternet", label: "Backup internet", kind: "boolSelect" },
  { name: "hasBackupPower", label: "Backup power", kind: "boolSelect" },
  { name: "hasDualMonitor", label: "Dual monitor", kind: "boolSelect" },
  { name: "headsetQuality", label: "Headset quality", kind: "text" },
  {
    name: "workspace",
    label: "Workspace",
    kind: "select",
    options: opts(WorkspaceTypeSchema.options, WORKSPACE_LABELS),
  },
  {
    name: "isQuietEnvironmentVerified",
    label: "Quiet environment verified",
    kind: "boolSelect",
  },
  { name: "computerSpecs", label: "Computer specs", kind: "textarea" },
];

export function RemoteEnvironmentSection({ candidate }: SectionProps) {
  return (
    <SectionCard
      sectionId="remote-environment"
      title="Remote environment"
      candidate={candidate}
      fields={REMOTE_ENV_FIELDS}
      defaultVisibility="internal"
      titleChip={<VisibilityChip visibility="internal" />}
    />
  );
}

// ---------------------------------------------------------------------------
// Vetting & fit
// ---------------------------------------------------------------------------

const VETTING_FIELDS: readonly FieldDescriptor[] = [
  {
    name: "vettingStatus",
    label: "Vetting status",
    kind: "select",
    options: opts(VettingStatusSchema.options, VETTING_STATUS_LABELS),
  },
  { name: "screeningCallAt", label: "Screening call", kind: "datetime" },
  { name: "recruiterRating", label: "Recruiter rating", kind: "rating" },
  { name: "proactivityRating", label: "Proactivity", kind: "rating" },
  {
    name: "attentionToDetailRating",
    label: "Attention to detail",
    kind: "rating",
  },
  { name: "communicationRating", label: "Communication", kind: "rating" },
  {
    name: "energyPresentationRating",
    label: "Energy & presentation",
    kind: "rating",
  },
  {
    name: "autonomy",
    label: "Autonomy",
    kind: "select",
    options: opts(AutonomyLevelSchema.options, AUTONOMY_LABELS),
  },
  { name: "canManageUp", label: "Can manage up", kind: "boolSelect" },
  {
    name: "salesBackgroundWeight",
    label: "Sales background weight",
    kind: "select",
    options: opts(SalesBackgroundWeightSchema.options, SALES_WEIGHT_LABELS),
  },
  { name: "hasOpsBackground", label: "Ops background", kind: "boolSelect" },
  {
    name: "hasEntrepreneurialAmbition",
    label: "Entrepreneurial ambition",
    kind: "boolSelect",
  },
  {
    name: "recruiterRecommendation",
    label: "Recruiter recommendation",
    kind: "textarea",
    help: "Shown to the client with the presented profile.",
  },
  {
    name: "strengths",
    label: "Strengths",
    kind: "textarea",
    help: "Shown to the client with the presented profile.",
  },
  { name: "watchPoints", label: "Watch points", kind: "textarea" },
  { name: "redFlags", label: "Red flags", kind: "textarea" },
  { name: "areReferencesChecked", label: "References checked", kind: "checkbox" },
  {
    name: "backgroundCheckStatus",
    label: "Background check status",
    kind: "text",
  },
];

export function VettingSection({ candidate }: SectionProps) {
  return (
    <SectionCard
      sectionId="vetting"
      title="Vetting & fit"
      candidate={candidate}
      fields={VETTING_FIELDS}
      defaultVisibility="internal"
      footer={
        candidate.vettedBy !== null || candidate.vettedAt !== null ? (
          <p className="mt-3 text-xs text-neutral-500">
            Vetted{candidate.vettedBy !== null ? ` by ${candidate.vettedBy}` : ""}
            {candidate.vettedAt !== null
              ? ` on ${formatDateTime(candidate.vettedAt)}`
              : ""}
          </p>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Source & provenance — read-only when webhook-sourced (04 §8.2)
// ---------------------------------------------------------------------------

const SOURCE_FIELDS: readonly FieldDescriptor[] = [
  {
    name: "source",
    label: "Source",
    kind: "select",
    options: opts(CandidateSourceSchema.options, CANDIDATE_SOURCE_LABELS),
  },
  { name: "sourceDetail", label: "Source detail", kind: "text" },
  { name: "externalSystem", label: "External system", kind: "text" },
  { name: "externalId", label: "External ID", kind: "text" },
  { name: "firstContactedAt", label: "First contacted", kind: "datetime" },
  { name: "responsivenessRating", label: "Responsiveness", kind: "rating" },
];

export function SourceSection({ candidate }: SectionProps) {
  const isWebhookSourced = candidate.submittedVia === "webhook";
  return (
    <SectionCard
      sectionId="source"
      title="Source & provenance"
      description={`Submitted via ${SUBMISSION_CHANNEL_LABELS[candidate.submittedVia]}`}
      candidate={candidate}
      fields={SOURCE_FIELDS}
      defaultVisibility="internal"
      readOnly={isWebhookSourced}
    />
  );
}
