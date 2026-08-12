-- 0001_extensions_and_enums.sql
-- Extensions and all enum types. See docs/02-DATABASE.md §1–2.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive email
create extension if not exists "pg_trgm";    -- fuzzy name search

create type user_role_key as enum ('super_admin','admin','client_admin','client_user');

create type client_status as enum ('prospect','active','inactive','archived');

create type service_tier as enum ('standard_placement','handheld_six_month');

create type requisition_status as enum (
  'submitted','pending_principal_approval','changes_requested','sourcing',
  'candidates_presented','interviewing','offer_extended','placed',
  'on_hold','closed_unfilled'
);

create type assignment_stage as enum (
  'sourced','screened','vetted','presented','client_reviewing',
  'interview_scheduled','interviewed','offer','placed',
  'rejected_by_admin','rejected_by_client','withdrawn','closed_not_selected'
);

create type rejection_actor as enum ('admin','client');

create type question_type as enum (
  'short_text','long_text','email','phone','number','currency_range',
  'single_select','multi_select','yes_no','date','scale','file_upload'
);

create type question_audience as enum ('client','internal');

create type proficiency_level as enum ('aware','working','proficient','expert');

create type language_level as enum ('basic','conversational','professional','native_equivalent');

create type accent_strength as enum ('none','light','moderate','heavy');

create type rate_unit as enum ('hourly','monthly');

create type engagement_type as enum ('full_time','part_time','project');

create type pool_status as enum ('active','passive','placed','unavailable','do_not_use');

create type vetting_status as enum ('not_started','in_progress','passed','failed');

create type employment_status as enum ('employed','available','serving_notice');

create type autonomy_level as enum ('needs_direction','balanced','fully_autonomous');

create type seniority_level as enum ('junior','mid','senior','lead');

create type candidate_file_type as enum (
  'cv','photo','video_intro','voice_sample','writing_sample',
  'portfolio','certificate','assessment_report','speedtest','other'
);

create type candidate_source as enum (
  'linkedin','upwork','referral','partner_recruiter','inbound','webhook','import','other'
);

create type submission_channel as enum ('manual','webhook','csv_import');

create type data_completeness as enum ('complete','incomplete');

create type workspace_type as enum ('dedicated_home_office','shared_space','coworking','unknown');

create type interview_outcome as enum ('pending','passed','failed','no_show','rescheduled','cancelled');

create type placement_status as enum ('active','ended_by_client','ended_by_candidate','completed');

create type notification_event as enum (
  'intake_submitted','portal_invitation','principal_approval_requested',
  'candidates_presented','client_decision_recorded','interview_scheduled',
  'requisition_status_changed'
);
