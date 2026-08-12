-- 0010_views_triggers_rls.sql
-- client_visible_assignments view (docs/02-DATABASE.md §11, verbatim),
-- all triggers (§12), RLS enablement and grants (§13).

-- ===========================================================================
-- §11 — client_visible_assignments
-- ===========================================================================

create or replace view client_visible_assignments as
select
  a.id                as assignment_id,
  a.requisition_id,
  a.stage,
  a.presented_at,
  a.client_note,
  r.client_id,
  c.id                as candidate_id,
  c.reference,
  -- always visible
  c.display_name,
  c.photo_path,
  c.country, c.region_state, c.city, c.timezone,
  c.english_spoken_level, c.english_written_level, c.accent_strength,
  c.years_experience_total, c.years_experience_relevant,
  c.current_title, c.seniority_level,
  c.has_management_experience, c.team_size_managed,
  c.has_client_facing_experience, c.has_us_client_experience,
  c.remote_experience_years, c.available_from,
  c.engagement_types, c.hours_available_per_week,
  c.overlap_start, c.overlap_end, c.overlap_timezone,
  c.autonomy, c.can_manage_up,
  c.recruiter_recommendation, c.strengths,
  -- gated: unlocked at interview_scheduled or later
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.first_name  else null end as first_name,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.last_name   else null end as last_name,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.email::text else null end as email,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.phone       else null end as phone,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.whatsapp    else null end as whatsapp,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.linkedin_url else null end as linkedin_url,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.current_employer else null end as current_employer
from assignments a
join requisitions r on r.id = a.requisition_id
join candidates   c on c.id = a.candidate_id
where a.stage = any (array[
  'presented','client_reviewing','interview_scheduled',
  'interviewed','offer','placed','rejected_by_client','closed_not_selected'
]::assignment_stage[]);

-- ===========================================================================
-- §12 — Triggers
-- ===========================================================================

-- trg_set_updated_at — every table with updated_at
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_set_updated_at before update on users               for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on clients             for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on question_categories for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on questions           for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on requisitions        for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on requisition_answers for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on candidates          for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on assignments         for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on interviews          for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on placements          for each row execute function set_updated_at();
create trigger trg_set_updated_at before update on app_settings        for each row execute function set_updated_at();

-- trg_question_answer_count — maintain questions.answer_count
create or replace function maintain_question_answer_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update questions set answer_count = answer_count + 1 where id = new.question_id;
    return new;
  elsif tg_op = 'DELETE' then
    update questions set answer_count = greatest(answer_count - 1, 0) where id = old.question_id;
    return old;
  elsif tg_op = 'UPDATE' then
    if new.question_id is distinct from old.question_id then
      update questions set answer_count = greatest(answer_count - 1, 0) where id = old.question_id;
      update questions set answer_count = answer_count + 1 where id = new.question_id;
    end if;
    return new;
  end if;
  return null;
end;
$$;

create trigger trg_question_answer_count
  after insert or update or delete on requisition_answers
  for each row execute function maintain_question_answer_count();

-- trg_block_question_type_change — question_type is frozen once answered
create or replace function block_question_type_change()
returns trigger
language plpgsql
as $$
begin
  if new.question_type is distinct from old.question_type and old.answer_count > 0 then
    raise exception 'question % has % answer(s); question_type cannot be changed. Create a new question and deactivate this one.',
      old.key, old.answer_count
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  return new;
end;
$$;

create trigger trg_block_question_type_change
  before update on questions
  for each row execute function block_question_type_change();

-- trg_events_immutable — events rows can never be updated or deleted
create or replace function events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'events rows are immutable; % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger trg_events_immutable
  before update or delete on events
  for each row execute function events_immutable();

-- trg_candidate_cv_search — rebuild cv_search from name, title, and strengths.
-- Extracted CV text has no source column in the schema; the API appends it to
-- cv_search directly after text extraction. This trigger fires only on changes
-- to the listed columns, so a direct cv_search write is not clobbered.
create or replace function rebuild_candidate_cv_search()
returns trigger
language plpgsql
as $$
begin
  new.cv_search :=
      setweight(to_tsvector('english',
        coalesce(new.first_name, '') || ' ' ||
        coalesce(new.last_name, '')  || ' ' ||
        coalesce(new.preferred_name, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.current_title, '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.strengths, '')), 'C');
  return new;
end;
$$;

create trigger trg_candidate_cv_search
  before insert or update of first_name, last_name, preferred_name, current_title, strengths
  on candidates
  for each row execute function rebuild_candidate_cv_search();

-- trg_assignment_stage_event — one trigger-sourced events row per stage change
create or replace function log_assignment_stage_change()
returns trigger
language plpgsql
as $$
begin
  insert into events (entity_type, entity_id, event_type, from_value, to_value, metadata)
  values ('assignment', new.id, 'stage_changed', old.stage::text, new.stage::text,
          jsonb_build_object('source', 'trigger', 'requisition_id', new.requisition_id, 'candidate_id', new.candidate_id));
  return new;
end;
$$;

create trigger trg_assignment_stage_event
  after update on assignments
  for each row
  when (old.stage is distinct from new.stage)
  execute function log_assignment_stage_change();

-- trg_requisition_status_event — one trigger-sourced events row per status change
create or replace function log_requisition_status_change()
returns trigger
language plpgsql
as $$
begin
  insert into events (entity_type, entity_id, event_type, from_value, to_value, metadata)
  values ('requisition', new.id, 'status_changed', old.status::text, new.status::text,
          jsonb_build_object('source', 'trigger', 'client_id', new.client_id));
  return new;
end;
$$;

create trigger trg_requisition_status_event
  after update on requisitions
  for each row
  when (old.status is distinct from new.status)
  execute function log_requisition_status_change();

-- ===========================================================================
-- §13 — Row-level security: deny-all defence in depth
-- ===========================================================================

-- The Supabase roles exist on a hosted project but not on a plain Postgres
-- cluster. Create them (nologin) if absent so grants/revokes apply everywhere.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

-- Enable + force RLS on every table. No policies exist for anon/authenticated,
-- so they are denied everything; service_role bypasses RLS by design.
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to service_role;
