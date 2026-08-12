-- 0011_seed_reference_data.sql
-- Reference data: roles, permissions, role_permissions, engines,
-- rejection_reasons, app_settings.
-- See docs/02-DATABASE.md §3, §5, §10 and docs/SDB-Portal-Config-Reference.md §3.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
insert into roles (key, label) values
  ('super_admin',  'Super Admin'),
  ('admin',        'Admin'),
  ('client_admin', 'Client Admin'),
  ('client_user',  'Client User')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Permissions (exhaustive for MVP — docs/02-DATABASE.md §3)
-- ---------------------------------------------------------------------------
insert into permissions (key, label, domain) values
  ('client.view',                        'View clients',                          'client'),
  ('client.create',                      'Create clients',                        'client'),
  ('client.update',                      'Update clients',                        'client'),
  ('client.grant_access',                'Grant portal access',                   'client'),
  ('client.invite_user',                 'Invite client users',                   'client'),
  ('requisition.view',                   'View requisitions',                     'requisition'),
  ('requisition.create',                 'Create requisitions',                   'requisition'),
  ('requisition.update',                 'Update requisitions',                   'requisition'),
  ('requisition.transition',             'Transition requisition status',         'requisition'),
  ('requisition.approve_as_principal',   'Approve requisition as principal',      'requisition'),
  ('requisition.view_commercials',       'View requisition commercial terms',     'requisition'),
  ('candidate.view',                     'View candidates',                       'candidate'),
  ('candidate.create',                   'Create candidates',                     'candidate'),
  ('candidate.update',                   'Update candidates',                     'candidate'),
  ('candidate.view_pii',                 'View candidate PII',                    'candidate'),
  ('candidate.assign',                   'Assign candidates to requisitions',     'candidate'),
  ('candidate.present',                  'Present candidates to clients',         'candidate'),
  ('candidate.reject',                   'Reject candidates',                     'candidate'),
  ('assignment.view',                    'View assignments',                      'assignment'),
  ('assignment.advance',                 'Advance assignment stage',              'assignment'),
  ('assignment.reject',                  'Reject assignments',                    'assignment'),
  ('interview.view',                     'View interviews',                       'interview'),
  ('interview.create',                   'Create interviews',                     'interview'),
  ('interview.update',                   'Update interviews',                     'interview'),
  ('question.view',                      'View intake questions',                 'question'),
  ('question.manage',                    'Manage intake questions',               'question'),
  ('settings.manage',                    'Manage application settings',           'settings'),
  ('user.manage',                        'Manage users',                          'user'),
  ('event.view',                         'View event log',                        'event')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Role → permission mapping (docs/02-DATABASE.md §3)
-- ---------------------------------------------------------------------------

-- super_admin: everything
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.key = 'super_admin'
on conflict do nothing;

-- admin: everything except settings.manage, user.manage, question.manage
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.key = 'admin'
  and p.key not in ('settings.manage', 'user.manage', 'question.manage')
on conflict do nothing;

-- client_admin
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.key = 'client_admin'
  and p.key in (
    'client.view', 'client.invite_user',
    'requisition.view', 'requisition.create', 'requisition.approve_as_principal',
    'candidate.view', 'assignment.view', 'assignment.reject', 'interview.view'
  )
on conflict do nothing;

-- client_user: client_admin minus client.invite_user and requisition.approve_as_principal
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.key = 'client_user'
  and p.key in (
    'client.view',
    'requisition.view', 'requisition.create',
    'candidate.view', 'assignment.view', 'assignment.reject', 'interview.view'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Engines — the 5E model, descriptions verbatim from the client's diagnostic
-- (docs/02-DATABASE.md §5). Staffed: Brand, Client Experience, Operations.
-- ---------------------------------------------------------------------------
insert into engines (key, label, description, is_staffed, sort_order) values
  ('revenue',           'Revenue',           'How your business attracts clients and generates consistent income',   false, 1),
  ('brand',             'Brand',             'How the market perceives you and whether it builds trust before a call', true, 2),
  ('client_experience', 'Client Experience', 'How you deliver, retain clients, and turn them into advocates',          true, 3),
  ('operations',        'Operations',        'The systems and structure that keep the business moving without you',    true, 4),
  ('leadership',        'Leadership',        'Your ability to lead the company instead of just running inside it',    false, 5)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Rejection reasons (docs/SDB-Portal-Config-Reference.md §3)
-- ---------------------------------------------------------------------------

-- Client-side
insert into rejection_reasons (key, label, actor, sort_order) values
  ('skills_gap',                'Skills gap',                                'client', 1),
  ('experience_level_mismatch', 'Experience level too junior / too senior',  'client', 2),
  ('english_communication',     'English or communication level',            'client', 3),
  ('culture_fit',               'Culture or working-style fit',              'client', 4),
  ('salary_mismatch',           'Salary expectation mismatch',               'client', 5),
  ('availability_timezone',     'Availability or timezone overlap',          'client', 6),
  ('chose_different_candidate', 'Chose a different candidate',               'client', 7),
  ('role_paused_cancelled',     'Role paused or cancelled',                  'client', 8),
  ('other_client',              'Other',                                     'client', 9)
on conflict (key) do nothing;

-- Admin-side
insert into rejection_reasons (key, label, actor, sort_order) values
  ('failed_vetting',            'Failed vetting',                            'admin', 1),
  ('unresponsive',              'Unresponsive',                              'admin', 2),
  ('withdrew_from_process',     'Withdrew from process',                     'admin', 3),
  ('salary_out_of_range',       'Salary expectation out of range',           'admin', 4),
  ('better_fit_other_client',   'Better fit for a different client',         'admin', 5),
  ('duplicate_record',          'Duplicate record',                          'admin', 6),
  ('other_admin',               'Other',                                     'admin', 7)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- App settings — needs-attention thresholds (docs/01-PRODUCT-OVERVIEW.md §6)
-- ---------------------------------------------------------------------------
insert into app_settings (key, value, description) values
  ('queue.principal_approval_days', '3'::jsonb,  'Days a requisition may sit at pending_principal_approval before it enters the needs-attention queue'),
  ('queue.no_candidates_days',      '5'::jsonb,  'Days a requisition may sit at sourcing with no candidates presented before it enters the needs-attention queue'),
  ('queue.awaiting_client_days',    '3'::jsonb,  'Days an assignment may sit at presented awaiting client feedback before it enters the needs-attention queue'),
  ('intake.form_cache_ttl_seconds', '60'::jsonb, 'Cache TTL for the public intake form definition')
on conflict (key) do nothing;
