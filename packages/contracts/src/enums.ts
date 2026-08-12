/**
 * Zod mirrors of every Postgres enum defined in docs/02-DATABASE.md §2.
 * Values must match the SQL `create type ... as enum` definitions exactly.
 *
 * Naming convention (followed across this package):
 *   - `XxxSchema` is the Zod enum
 *   - `Xxx` is the inferred TypeScript union type
 */
import { z } from 'zod';

export const UserRoleKeySchema = z.enum([
  'super_admin',
  'admin',
  'client_admin',
  'client_user',
]);
export type UserRoleKey = z.infer<typeof UserRoleKeySchema>;

export const ClientStatusSchema = z.enum([
  'prospect',
  'active',
  'inactive',
  'archived',
]);
export type ClientStatus = z.infer<typeof ClientStatusSchema>;

export const ServiceTierSchema = z.enum([
  'standard_placement',
  'handheld_six_month',
]);
export type ServiceTier = z.infer<typeof ServiceTierSchema>;

export const RequisitionStatusSchema = z.enum([
  'submitted',
  'pending_principal_approval',
  'changes_requested',
  'sourcing',
  'candidates_presented',
  'interviewing',
  'offer_extended',
  'placed',
  'on_hold',
  'closed_unfilled',
]);
export type RequisitionStatus = z.infer<typeof RequisitionStatusSchema>;

export const AssignmentStageSchema = z.enum([
  'sourced',
  'screened',
  'vetted',
  'presented',
  'client_reviewing',
  'interview_scheduled',
  'interviewed',
  'offer',
  'placed',
  'rejected_by_admin',
  'rejected_by_client',
  'withdrawn',
  'closed_not_selected',
]);
export type AssignmentStage = z.infer<typeof AssignmentStageSchema>;

export const RejectionActorSchema = z.enum(['admin', 'client']);
export type RejectionActor = z.infer<typeof RejectionActorSchema>;

export const QuestionTypeSchema = z.enum([
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'currency_range',
  'single_select',
  'multi_select',
  'yes_no',
  'date',
  'scale',
  'file_upload',
]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const QuestionAudienceSchema = z.enum(['client', 'internal']);
export type QuestionAudience = z.infer<typeof QuestionAudienceSchema>;

export const ProficiencyLevelSchema = z.enum([
  'aware',
  'working',
  'proficient',
  'expert',
]);
export type ProficiencyLevel = z.infer<typeof ProficiencyLevelSchema>;

export const LanguageLevelSchema = z.enum([
  'basic',
  'conversational',
  'professional',
  'native_equivalent',
]);
export type LanguageLevel = z.infer<typeof LanguageLevelSchema>;

export const AccentStrengthSchema = z.enum([
  'none',
  'light',
  'moderate',
  'heavy',
]);
export type AccentStrength = z.infer<typeof AccentStrengthSchema>;

export const RateUnitSchema = z.enum(['hourly', 'monthly']);
export type RateUnit = z.infer<typeof RateUnitSchema>;

export const EngagementTypeSchema = z.enum([
  'full_time',
  'part_time',
  'project',
]);
export type EngagementType = z.infer<typeof EngagementTypeSchema>;

export const PoolStatusSchema = z.enum([
  'active',
  'passive',
  'placed',
  'unavailable',
  'do_not_use',
]);
export type PoolStatus = z.infer<typeof PoolStatusSchema>;

export const VettingStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'passed',
  'failed',
]);
export type VettingStatus = z.infer<typeof VettingStatusSchema>;

export const EmploymentStatusSchema = z.enum([
  'employed',
  'available',
  'serving_notice',
]);
export type EmploymentStatus = z.infer<typeof EmploymentStatusSchema>;

export const AutonomyLevelSchema = z.enum([
  'needs_direction',
  'balanced',
  'fully_autonomous',
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

export const SeniorityLevelSchema = z.enum(['junior', 'mid', 'senior', 'lead']);
export type SeniorityLevel = z.infer<typeof SeniorityLevelSchema>;

export const CandidateFileTypeSchema = z.enum([
  'cv',
  'photo',
  'video_intro',
  'voice_sample',
  'writing_sample',
  'portfolio',
  'certificate',
  'assessment_report',
  'speedtest',
  'other',
]);
export type CandidateFileType = z.infer<typeof CandidateFileTypeSchema>;

export const CandidateSourceSchema = z.enum([
  'linkedin',
  'upwork',
  'referral',
  'partner_recruiter',
  'inbound',
  'webhook',
  'import',
  'other',
]);
export type CandidateSource = z.infer<typeof CandidateSourceSchema>;

export const SubmissionChannelSchema = z.enum([
  'manual',
  'webhook',
  'csv_import',
]);
export type SubmissionChannel = z.infer<typeof SubmissionChannelSchema>;

export const DataCompletenessSchema = z.enum(['complete', 'incomplete']);
export type DataCompleteness = z.infer<typeof DataCompletenessSchema>;

export const WorkspaceTypeSchema = z.enum([
  'dedicated_home_office',
  'shared_space',
  'coworking',
  'unknown',
]);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;

export const InterviewOutcomeSchema = z.enum([
  'pending',
  'passed',
  'failed',
  'no_show',
  'rescheduled',
  'cancelled',
]);
export type InterviewOutcome = z.infer<typeof InterviewOutcomeSchema>;

export const PlacementStatusSchema = z.enum([
  'active',
  'ended_by_client',
  'ended_by_candidate',
  'completed',
]);
export type PlacementStatus = z.infer<typeof PlacementStatusSchema>;

export const NotificationEventSchema = z.enum([
  'intake_submitted',
  'portal_invitation',
  'principal_approval_requested',
  'candidates_presented',
  'client_decision_recorded',
  'interview_scheduled',
  'requisition_status_changed',
]);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;
