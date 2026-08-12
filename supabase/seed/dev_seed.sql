-- dev_seed.sql — development dummy data. NOT a migration; never applied to production.
-- Re-runnable: every insert carries an on conflict clause.
-- Fixed UUIDs (00000000-0000-4000-8000-XXXXXXXXXXXX) so tests can reference rows:
--   ...0101-0105  users            ...0121-0125  user_roles
--   ...0201-0202  clients          ...0211-0212  client_members
--   ...0301-0303  departments      ...0311-0314  role_categories
--   ...0401-0403  question_categories
--   ...0411-0423  questions        ...0431-0443  question_options
--   ...0501-0502  requisitions     ...0601-0626  requisition_answers
--   ...0701-0725  candidates       ...0801-0807  assignments
--   ...0811       rejections       ...0821       interviews
--   ...0901-0908  tools            ...0921-0928  skills        ...0941-0946 industries
-- Depends on migration 0011 having seeded roles, engines, and rejection_reasons.

begin;

-- ---------------------------------------------------------------------------
-- Users: 1 super_admin + 2 admins + 2 client users
-- ---------------------------------------------------------------------------
insert into users (id, email, full_name, phone, timezone) values
  ('00000000-0000-4000-8000-000000000101', 'rebecca@teamdonebetter.com', 'Rebecca Stone',  '+1-555-0101', 'America/New_York'),
  ('00000000-0000-4000-8000-000000000102', 'ximena@teamdonebetter.com',  'Ximena Reyes',   '+52-555-0102', 'America/Mexico_City'),
  ('00000000-0000-4000-8000-000000000103', 'haider@teamdonebetter.com',  'Haider Jutt',    '+92-555-0103', 'Asia/Karachi'),
  ('00000000-0000-4000-8000-000000000104', 'dana@acmecoaching.com',      'Dana Whitfield', '+1-555-0104', 'America/Chicago'),
  ('00000000-0000-4000-8000-000000000105', 'marcus@acmecoaching.com',    'Marcus Lee',     '+1-555-0105', 'America/Chicago')
on conflict (id) do nothing;

insert into user_roles (id, user_id, role_id, scope_type, scope_id) values
  ('00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000101', (select id from roles where key = 'super_admin'),  null,     null),
  ('00000000-0000-4000-8000-000000000122', '00000000-0000-4000-8000-000000000102', (select id from roles where key = 'admin'),        null,     null),
  ('00000000-0000-4000-8000-000000000123', '00000000-0000-4000-8000-000000000103', (select id from roles where key = 'admin'),        null,     null),
  ('00000000-0000-4000-8000-000000000124', '00000000-0000-4000-8000-000000000104', (select id from roles where key = 'client_admin'), 'client', '00000000-0000-4000-8000-000000000201'),
  ('00000000-0000-4000-8000-000000000125', '00000000-0000-4000-8000-000000000105', (select id from roles where key = 'client_user'),  'client', '00000000-0000-4000-8000-000000000201')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Clients: one active with payment + portal access, one prospect
-- ---------------------------------------------------------------------------
insert into clients (id, company_name, website, industry, team_size_band, company_timezone,
                     status, service_tier, payment_confirmed_at, invoice_reference,
                     portal_access_enabled_at, portal_access_enabled_by, internal_notes) values
  ('00000000-0000-4000-8000-000000000201', 'Acme Coaching Co', 'https://acmecoaching.com',
   'Coaching & Consulting', '6_20', 'America/Chicago',
   'active', 'standard_placement', now() - interval '30 days', 'INV-2026-014',
   now() - interval '28 days', '00000000-0000-4000-8000-000000000101',
   'First engagement. Fractional COO (Dana) runs intake; founder approves briefs.'),
  ('00000000-0000-4000-8000-000000000202', 'Northlight Legal', 'https://northlightlegal.com',
   'Legal Services', '1_5', 'America/Denver',
   'prospect', null, null, null, null, null,
   'Inbound via public intake form. Awaiting discovery call and payment.')
on conflict (id) do nothing;

insert into client_members (id, client_id, user_id, is_primary_contact, is_principal,
                            job_title, invited_by, invited_at, accepted_at) values
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000104', true, true, 'Fractional COO',
   '00000000-0000-4000-8000-000000000101', now() - interval '28 days', now() - interval '27 days'),
  ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000105', false, false, 'Marketing Lead',
   '00000000-0000-4000-8000-000000000104', now() - interval '20 days', now() - interval '19 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Taxonomy under the staffed engines (engines come from migration 0011)
-- ---------------------------------------------------------------------------
insert into departments (id, engine_id, key, label, sort_order) values
  ('00000000-0000-4000-8000-000000000301', (select id from engines where key = 'operations'),        'executive_assistance', 'Executive Assistance', 1),
  ('00000000-0000-4000-8000-000000000302', (select id from engines where key = 'client_experience'), 'customer_success',     'Customer Success',     1),
  ('00000000-0000-4000-8000-000000000303', (select id from engines where key = 'brand'),             'content_marketing',    'Content & Marketing',  1)
on conflict (id) do nothing;

insert into role_categories (id, department_id, key, label, advertised_title, description, sort_order) values
  ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000301', 'executive_assistant',      'Executive Assistant',      'Executive Assistant',      'Calendar, inbox, travel, and founder support', 1),
  ('00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000301', 'operations_manager',       'Operations Manager',       'Operations Manager',       'Systems, SOPs, and day-to-day business operations', 2),
  ('00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000302', 'customer_success_manager', 'Customer Success Manager', 'Customer Success Manager', 'Client onboarding, retention, and account health', 1),
  ('00000000-0000-4000-8000-000000000314', '00000000-0000-4000-8000-000000000303', 'content_marketer',         'Content Marketer',         'Content Marketing Specialist', 'Content production, social, and brand presence', 1)
on conflict (id) do nothing;

insert into tools (id, name, category) values
  ('00000000-0000-4000-8000-000000000901', 'HubSpot',    'crm'),
  ('00000000-0000-4000-8000-000000000902', 'Salesforce', 'crm'),
  ('00000000-0000-4000-8000-000000000903', 'ClickUp',    'project_management'),
  ('00000000-0000-4000-8000-000000000904', 'Asana',      'project_management'),
  ('00000000-0000-4000-8000-000000000905', 'Slack',      'communication'),
  ('00000000-0000-4000-8000-000000000906', 'Notion',     'documentation'),
  ('00000000-0000-4000-8000-000000000907', 'Zapier',     'automation'),
  ('00000000-0000-4000-8000-000000000908', 'Canva',      'design')
on conflict (id) do nothing;

insert into skills (id, name, category) values
  ('00000000-0000-4000-8000-000000000921', 'Calendar Management',     'administrative'),
  ('00000000-0000-4000-8000-000000000922', 'Inbox Management',        'administrative'),
  ('00000000-0000-4000-8000-000000000923', 'Copywriting',             'marketing'),
  ('00000000-0000-4000-8000-000000000924', 'Data Analysis',           'analytical'),
  ('00000000-0000-4000-8000-000000000925', 'Project Management',      'operations'),
  ('00000000-0000-4000-8000-000000000926', 'Customer Support',        'client_experience'),
  ('00000000-0000-4000-8000-000000000927', 'Bookkeeping',             'finance'),
  ('00000000-0000-4000-8000-000000000928', 'Social Media Management', 'marketing')
on conflict (id) do nothing;

insert into industries (id, name) values
  ('00000000-0000-4000-8000-000000000941', 'Coaching & Consulting'),
  ('00000000-0000-4000-8000-000000000942', 'Legal Services'),
  ('00000000-0000-4000-8000-000000000943', 'E-commerce'),
  ('00000000-0000-4000-8000-000000000944', 'Real Estate'),
  ('00000000-0000-4000-8000-000000000945', 'Healthcare'),
  ('00000000-0000-4000-8000-000000000946', 'SaaS')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Intake questions: 3 categories, 13 questions covering most types
-- ---------------------------------------------------------------------------
insert into question_categories (id, key, label, description, sort_order) values
  ('00000000-0000-4000-8000-000000000401', 'company_context',   'Company Context',        'About your business',                     1),
  ('00000000-0000-4000-8000-000000000402', 'role_requirements', 'Role Requirements',      'What the role needs',                     2),
  ('00000000-0000-4000-8000-000000000403', 'working_setup',     'Working Setup & Budget', 'Hours, budget, and timeline',             3)
on conflict (id) do nothing;

insert into questions (id, category_id, key, label, help_text, placeholder, question_type, is_required, sort_order, validation, created_by) values
  ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000401', 'company_name',             'Company name',                         null,                                          'Acme Inc',            'short_text',     true,  1, '{"maxLength":200}',                                              '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000412', '00000000-0000-4000-8000-000000000401', 'company_website',          'Company website',                      null,                                          'https://',            'short_text',     false, 2, '{"maxLength":500}',                                              '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000413', '00000000-0000-4000-8000-000000000401', 'contact_email',            'Best contact email',                   'We will send your confirmation here.',        'you@company.com',     'email',          true,  3, '{}',                                                             '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000414', '00000000-0000-4000-8000-000000000401', 'team_size',                'How big is your team?',                null,                                          null,                  'single_select',  false, 4, '{}',                                                             '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000415', '00000000-0000-4000-8000-000000000402', 'role_title',               'What role are you hiring for?',        null,                                          'Executive Assistant', 'short_text',     true,  1, '{"maxLength":200}',                                              '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000416', '00000000-0000-4000-8000-000000000402', 'english_spoken_required',  'Spoken English requirement',           'The minimum level you need on calls.',        null,                  'single_select',  true,  2, '{}',                                                             '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000417', '00000000-0000-4000-8000-000000000402', 'must_have_skills',         'Must-have skills',                     'Pick up to four.',                            null,                  'multi_select',   false, 3, '{"minSelections":1,"maxSelections":4}',                          '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000418', '00000000-0000-4000-8000-000000000402', 'requires_us_overlap',      'Do you need US business-hours overlap?', null,                                        null,                  'yes_no',         false, 4, '{}',                                                             '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000419', '00000000-0000-4000-8000-000000000402', 'urgency_scale',            'How urgent is this hire?',             null,                                          null,                  'scale',          false, 5, '{"scaleMin":1,"scaleMax":5,"scaleMinLabel":"Exploring","scaleMaxLabel":"Yesterday"}', '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000420', '00000000-0000-4000-8000-000000000403', 'budget_range',             'Monthly or hourly budget range',       'A range is fine — we will advise on market.', null,                  'currency_range', true,  1, '{"currency":"USD","allowedUnits":["hourly","monthly"]}',         '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000403', 'target_start_date',        'Ideal start date',                     null,                                          null,                  'date',           false, 2, '{}',                                                             '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000403', 'hours_per_week',           'Hours per week',                       null,                                          '40',                  'number',         false, 3, '{"min":5,"max":60}',                                             '00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000423', '00000000-0000-4000-8000-000000000403', 'additional_context',       'Anything else we should know?',        null,                                          null,                  'long_text',      false, 4, '{"maxLength":5000}',                                             '00000000-0000-4000-8000-000000000101')
on conflict (id) do nothing;

insert into question_options (id, question_id, value, label, sort_order) values
  ('00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-000000000414', '1_5',                 '1–5',                  1),
  ('00000000-0000-4000-8000-000000000432', '00000000-0000-4000-8000-000000000414', '6_20',                '6–20',                 2),
  ('00000000-0000-4000-8000-000000000433', '00000000-0000-4000-8000-000000000414', '21_50',               '21–50',                3),
  ('00000000-0000-4000-8000-000000000434', '00000000-0000-4000-8000-000000000414', '50_plus',             'More than 50',         4),
  ('00000000-0000-4000-8000-000000000435', '00000000-0000-4000-8000-000000000416', 'conversational',      'Conversational',       1),
  ('00000000-0000-4000-8000-000000000436', '00000000-0000-4000-8000-000000000416', 'professional',        'Professional',         2),
  ('00000000-0000-4000-8000-000000000437', '00000000-0000-4000-8000-000000000416', 'native_equivalent',   'Native-equivalent',    3),
  ('00000000-0000-4000-8000-000000000438', '00000000-0000-4000-8000-000000000417', 'calendar_management', 'Calendar management',  1),
  ('00000000-0000-4000-8000-000000000439', '00000000-0000-4000-8000-000000000417', 'inbox_management',    'Inbox management',     2),
  ('00000000-0000-4000-8000-000000000440', '00000000-0000-4000-8000-000000000417', 'copywriting',         'Copywriting',          3),
  ('00000000-0000-4000-8000-000000000441', '00000000-0000-4000-8000-000000000417', 'data_analysis',       'Data analysis',        4),
  ('00000000-0000-4000-8000-000000000442', '00000000-0000-4000-8000-000000000417', 'project_management',  'Project management',   5),
  ('00000000-0000-4000-8000-000000000443', '00000000-0000-4000-8000-000000000417', 'customer_support',    'Customer support',     6)
on conflict (id) do nothing;

-- Scope the urgency question to the Executive Assistance roles as a scoping example
insert into question_role_scopes (question_id, role_category_id) values
  ('00000000-0000-4000-8000-000000000419', '00000000-0000-4000-8000-000000000311'),
  ('00000000-0000-4000-8000-000000000419', '00000000-0000-4000-8000-000000000312')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Requisitions
-- ---------------------------------------------------------------------------
insert into requisitions (id, reference, client_id, engine_id, department_id, role_category_id,
                          primary_role_category_id, advertised_title, headcount, status, service_tier,
                          seniority_level, budget_min, budget_max, budget_unit, budget_currency,
                          engagement_type, hours_per_week, overlap_start, overlap_end, overlap_timezone,
                          target_start_date, english_spoken_required, english_written_required,
                          max_accent_strength, brief_markdown, intake_completed_by,
                          intake_contact_name, intake_contact_email, principal_user_id,
                          principal_approved_at, submitted_at, sourcing_started_at) values
  ('00000000-0000-4000-8000-000000000501', 'REQ-000001',
   '00000000-0000-4000-8000-000000000201',
   (select id from engines where key = 'operations'),
   '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000311',
   '00000000-0000-4000-8000-000000000311', 'Executive Assistant', 1,
   'candidates_presented', 'standard_placement', 'mid',
   1500.00, 2200.00, 'monthly', 'USD', 'full_time', 40,
   '09:00', '14:00', 'America/Chicago', current_date + 20,
   'professional', 'professional', 'light',
   '## Executive Assistant for Acme Coaching\n\nFounder support: calendar, inbox, travel, client scheduling. Must be proactive and detail-obsessed.',
   '00000000-0000-4000-8000-000000000104', 'Dana Whitfield', 'dana@acmecoaching.com',
   '00000000-0000-4000-8000-000000000104', now() - interval '21 days',
   now() - interval '25 days', now() - interval '21 days'),
  ('00000000-0000-4000-8000-000000000502', 'REQ-000002',
   '00000000-0000-4000-8000-000000000202',
   (select id from engines where key = 'client_experience'),
   '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000313',
   '00000000-0000-4000-8000-000000000313', 'Customer Success Manager', 1,
   'submitted', null, 'mid',
   8.00, 12.00, 'hourly', 'USD', 'part_time', 25,
   null, null, null, current_date + 45,
   'professional', null, null, null,
   null, 'Jordan Pike', 'jordan@northlightlegal.com', null,
   null, now() - interval '2 days', null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Requisition answers (with question_snapshot, per the snapshot pattern)
-- ---------------------------------------------------------------------------
insert into requisition_answers (id, requisition_id, question_id, question_key,
                                 value_text, value_number, value_boolean, value_date, value_json,
                                 question_snapshot, answered_by) values
  -- REQ-000001 (answered in-portal by Dana)
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000411', 'company_name',
   'Acme Coaching Co', null, null, null, null,
   '{"questionKey":"company_name","label":"Company name","questionType":"short_text","categoryKey":"company_context","capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000413', 'contact_email',
   'dana@acmecoaching.com', null, null, null, null,
   '{"questionKey":"contact_email","label":"Best contact email","questionType":"email","categoryKey":"company_context","capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000414', 'team_size',
   '6_20', null, null, null, null,
   '{"questionKey":"team_size","label":"How big is your team?","questionType":"single_select","categoryKey":"company_context","options":[{"value":"1_5","label":"1–5"},{"value":"6_20","label":"6–20"},{"value":"21_50","label":"21–50"},{"value":"50_plus","label":"More than 50"}],"capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000604', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000415', 'role_title',
   'Executive Assistant', null, null, null, null,
   '{"questionKey":"role_title","label":"What role are you hiring for?","questionType":"short_text","categoryKey":"role_requirements","capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000605', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000416', 'english_spoken_required',
   'professional', null, null, null, null,
   '{"questionKey":"english_spoken_required","label":"Spoken English requirement","questionType":"single_select","categoryKey":"role_requirements","options":[{"value":"conversational","label":"Conversational"},{"value":"professional","label":"Professional"},{"value":"native_equivalent","label":"Native-equivalent"}],"capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000417', 'must_have_skills',
   null, null, null, null, '["calendar_management","inbox_management"]',
   '{"questionKey":"must_have_skills","label":"Must-have skills","questionType":"multi_select","categoryKey":"role_requirements","options":[{"value":"calendar_management","label":"Calendar management"},{"value":"inbox_management","label":"Inbox management"},{"value":"copywriting","label":"Copywriting"},{"value":"data_analysis","label":"Data analysis"},{"value":"project_management","label":"Project management"},{"value":"customer_support","label":"Customer support"}],"capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000607', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000418', 'requires_us_overlap',
   null, null, true, null, null,
   '{"questionKey":"requires_us_overlap","label":"Do you need US business-hours overlap?","questionType":"yes_no","categoryKey":"role_requirements","capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000608', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000419', 'urgency_scale',
   null, 4, null, null, null,
   '{"questionKey":"urgency_scale","label":"How urgent is this hire?","questionType":"scale","categoryKey":"role_requirements","validation":{"scaleMin":1,"scaleMax":5},"capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000609', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000420', 'budget_range',
   null, null, null, null, '{"min":1500,"max":2200,"unit":"monthly","currency":"USD"}',
   '{"questionKey":"budget_range","label":"Monthly or hourly budget range","questionType":"currency_range","categoryKey":"working_setup","capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000610', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000421', 'target_start_date',
   null, null, null, '2026-09-01', null,
   '{"questionKey":"target_start_date","label":"Ideal start date","questionType":"date","categoryKey":"working_setup","capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000422', 'hours_per_week',
   null, 40, null, null, null,
   '{"questionKey":"hours_per_week","label":"Hours per week","questionType":"number","categoryKey":"working_setup","capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  ('00000000-0000-4000-8000-000000000612', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000423', 'additional_context',
   'Founder travels twice a month; EA will own all trip logistics. Prior coaching-industry exposure is a plus.', null, null, null, null,
   '{"questionKey":"additional_context","label":"Anything else we should know?","questionType":"long_text","categoryKey":"working_setup","capturedAt":"2026-07-18T14:02:11Z"}',
   '00000000-0000-4000-8000-000000000104'),
  -- REQ-000002 (public intake, no authenticated answerer)
  ('00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000411', 'company_name',
   'Northlight Legal', null, null, null, null,
   '{"questionKey":"company_name","label":"Company name","questionType":"short_text","categoryKey":"company_context","capturedAt":"2026-08-10T19:41:03Z"}',
   null),
  ('00000000-0000-4000-8000-000000000622', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000413', 'contact_email',
   'jordan@northlightlegal.com', null, null, null, null,
   '{"questionKey":"contact_email","label":"Best contact email","questionType":"email","categoryKey":"company_context","capturedAt":"2026-08-10T19:41:03Z"}',
   null),
  ('00000000-0000-4000-8000-000000000623', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000415', 'role_title',
   'Customer Success Manager', null, null, null, null,
   '{"questionKey":"role_title","label":"What role are you hiring for?","questionType":"short_text","categoryKey":"role_requirements","capturedAt":"2026-08-10T19:41:03Z"}',
   null),
  ('00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000416', 'english_spoken_required',
   'professional', null, null, null, null,
   '{"questionKey":"english_spoken_required","label":"Spoken English requirement","questionType":"single_select","categoryKey":"role_requirements","options":[{"value":"conversational","label":"Conversational"},{"value":"professional","label":"Professional"},{"value":"native_equivalent","label":"Native-equivalent"}],"capturedAt":"2026-08-10T19:41:03Z"}',
   null),
  ('00000000-0000-4000-8000-000000000625', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000420', 'budget_range',
   null, null, null, null, '{"min":8,"max":12,"unit":"hourly","currency":"USD"}',
   '{"questionKey":"budget_range","label":"Monthly or hourly budget range","questionType":"currency_range","categoryKey":"working_setup","capturedAt":"2026-08-10T19:41:03Z"}',
   null),
  ('00000000-0000-4000-8000-000000000626', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000422', 'hours_per_week',
   null, 25, null, null, null,
   '{"questionKey":"hours_per_week","label":"Hours per week","questionType":"number","categoryKey":"working_setup","capturedAt":"2026-08-10T19:41:03Z"}',
   null)
on conflict (id) do nothing;

insert into requisition_answer_options (answer_id, option_id) values
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000432'),
  ('00000000-0000-4000-8000-000000000605', '00000000-0000-4000-8000-000000000436'),
  ('00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-000000000438'),
  ('00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-000000000439'),
  ('00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000436')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 25 candidates, LATAM, varied countries / levels / rates
-- Role categories: ...311 EA, ...312 Ops Manager, ...313 CSM, ...314 Content
-- ---------------------------------------------------------------------------
insert into candidates (id, reference, first_name, last_name, email, phone, country, city, timezone,
                        english_spoken_level, english_written_level, accent_strength,
                        years_experience_total, years_experience_relevant, current_title, current_employer,
                        employment_status, seniority_level, primary_role_category_id,
                        expected_rate_amount, expected_rate_unit, engagement_types, hours_available_per_week,
                        vetting_status, recruiter_rating, recruiter_recommendation, strengths,
                        source, submitted_via, has_consent_to_share_profile, consent_captured_at,
                        data_completeness, pool_status) values
  ('00000000-0000-4000-8000-000000000701', 'CAN-000001', 'Valentina', 'García',    'valentina.garcia@example.com',  '+52-55-1001', 'Mexico',     'Mexico City',    'America/Mexico_City', 'professional',      'professional',      'light',    8.0, 6.5, 'Executive Assistant',        'Grupo Andar',        'employed',       'senior', '00000000-0000-4000-8000-000000000311', 2200.00, 'monthly', '{full_time}', 40, 'passed',      5, 'Exceptional EA — ran a two-founder calendar across four timezones.', 'Calendar mastery, discretion, zero-drop follow-through', 'linkedin',          'manual',  true,  now() - interval '40 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000702', 'CAN-000002', 'Mateo',     'Fernández', 'mateo.fernandez@example.com',   '+54-11-1002', 'Argentina',  'Buenos Aires',   'America/Argentina/Buenos_Aires', 'native_equivalent', 'professional', 'none', 6.0, 5.0, 'Senior Executive Assistant', 'Remote First SA',    'serving_notice', 'mid',    '00000000-0000-4000-8000-000000000311', 12.00,   'hourly',  '{full_time}', 40, 'passed',      5, 'US-agency background; communicates like a native speaker.',          'US client experience, proactive updates, systems thinker', 'referral',          'manual',  true,  now() - interval '35 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000703', 'CAN-000003', 'Camila',    'Rodríguez', 'camila.rodriguez@example.com',  '+57-1-1003',  'Colombia',   'Bogotá',         'America/Bogota',      'professional',      'professional',      'light',    5.5, 4.0, 'Executive Assistant',        'Constructora Nima',  'employed',       'mid',    '00000000-0000-4000-8000-000000000311', 1700.00, 'monthly', '{full_time}', 40, 'passed',      4, 'Steady, warm, highly organised. Strong on travel logistics.',        'Travel planning, inbox zero discipline, warm client manner', 'upwork',            'manual',  true,  now() - interval '30 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000704', 'CAN-000004', 'Santiago',  'López',     'santiago.lopez@example.com',    '+52-33-1004', 'Mexico',     'Guadalajara',    'America/Mexico_City', 'conversational',    'professional',      'moderate', 2.5, 2.0, 'Administrative Assistant',   'Hotel Mirador',      'available',      'junior', '00000000-0000-4000-8000-000000000311', 900.00,  'monthly', '{full_time}', 45, 'passed',      3, 'Junior but hungry; best for a structured role with SOPs.',           'Fast learner, reliable, great attitude', 'inbound',           'manual',  true,  now() - interval '28 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000705', 'CAN-000005', 'Isabella',  'Martínez',  'isabella.martinez@example.com', '+506-1005',   'Costa Rica', 'San José',       'America/Costa_Rica',  'native_equivalent', 'native_equivalent', 'none',     9.0, 7.0, 'Chief of Staff',             'Verdant Ventures',   'employed',       'senior', '00000000-0000-4000-8000-000000000311', 2800.00, 'monthly', '{full_time}', 40, 'passed',      5, 'Chief-of-staff calibre; can run the whole back office.',             'Leadership support, process design, board-level polish', 'partner_recruiter', 'manual',  true,  now() - interval '26 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000706', 'CAN-000006', 'Sebastián', 'Pérez',     'sebastian.perez@example.com',   '+56-2-1006',  'Chile',      'Santiago',       'America/Santiago',    'professional',      'professional',      'light',    10.0, 8.0, 'Operations Manager',        'LogiChile',          'employed',       'senior', '00000000-0000-4000-8000-000000000312', 3000.00, 'monthly', '{full_time}', 40, 'passed',      4, 'Built ops from scratch at two logistics startups.',                 'SOP authorship, KPI dashboards, vendor management', 'linkedin',          'manual',  true,  now() - interval '25 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000707', 'CAN-000007', 'Luciana',   'Gómez',     'luciana.gomez@example.com',     '+598-1007',   'Uruguay',    'Montevideo',     'America/Montevideo',  'professional',      'native_equivalent', 'light',    7.0, 5.5, 'Operations Lead',            'Playa Digital',      'serving_notice', 'mid',    '00000000-0000-4000-8000-000000000312', 14.00,   'hourly',  '{full_time}', 40, 'in_progress', 4, 'Strong generalist; final vetting call pending.',                     'Automation (Zapier), documentation, calm under pressure', 'referral',          'manual',  true,  now() - interval '20 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000708', 'CAN-000008', 'Diego',     'Sánchez',   'diego.sanchez@example.com',     '+51-1-1008',  'Peru',       'Lima',           'America/Lima',        'conversational',    'professional',      'moderate', 6.0, 4.0, 'Project Coordinator',        'Constructora Sur',   'employed',       'mid',    '00000000-0000-4000-8000-000000000312', 1600.00, 'monthly', '{full_time,project}', 40, 'not_started', null, null,                                                             'Scheduling, budget tracking', 'webhook',           'webhook', true,  now() - interval '10 days', 'incomplete', 'active'),
  ('00000000-0000-4000-8000-000000000709', 'CAN-000009', 'Mariana',   'Díaz',      'mariana.diaz@example.com',      '+57-4-1009',  'Colombia',   'Medellín',       'America/Bogota',      'professional',      'professional',      'light',    5.0, 4.5, 'Customer Success Manager',   'SaaS Andes',         'employed',       'mid',    '00000000-0000-4000-8000-000000000313', 1900.00, 'monthly', '{full_time}', 40, 'passed',      5, 'Owned a 120-account book with 96% retention.',                       'Retention playbooks, empathetic escalation handling', 'linkedin',          'manual',  true,  now() - interval '22 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000710', 'CAN-000010', 'Nicolás',   'Torres',    'nicolas.torres@example.com',    '+54-351-1010','Argentina',  'Córdoba',        'America/Argentina/Cordoba', 'native_equivalent', 'native_equivalent', 'none', 8.5, 7.0, 'Head of Customer Success', 'Nube CX',        'employed',       'senior', '00000000-0000-4000-8000-000000000313', 15.00,   'hourly',  '{full_time,part_time}', 30, 'passed',  5, 'Led a five-person CS team; ideal for a maturing CX function.',       'Team leadership, QBR craft, churn diagnostics', 'referral',          'manual',  true,  now() - interval '18 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000711', 'CAN-000011', 'Gabriela',  'Ramírez',   'gabriela.ramirez@example.com',  '+52-81-1011', 'Mexico',     'Monterrey',      'America/Monterrey',   'professional',      'professional',      'light',    4.5, 4.0, 'Account Manager',            'Distribuidora Norte','employed',       'mid',    '00000000-0000-4000-8000-000000000313', 1750.00, 'monthly', '{full_time}', 40, 'in_progress', 4, 'Great instincts with upset customers; reference checks running.',    'De-escalation, CRM hygiene (HubSpot), bilingual reporting', 'upwork',            'manual',  true,  now() - interval '15 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000712', 'CAN-000012', 'Emiliano',  'Flores',    'emiliano.flores@example.com',   '+593-2-1012', 'Ecuador',    'Quito',          'America/Guayaquil',   'conversational',    'conversational',    'moderate', 2.0, 1.5, 'Support Agent',              'TeleAyuda',          'available',      'junior', '00000000-0000-4000-8000-000000000313', 6.50,    'hourly',  '{full_time}', 45, 'not_started', null, null,                                                            'Ticket triage, patience, CSAT 4.8/5', 'import',            'csv_import', false, null,                     'complete',   'passive'),
  ('00000000-0000-4000-8000-000000000713', 'CAN-000013', 'Sofía',     'Herrera',   'sofia.herrera@example.com',     '+502-1013',   'Guatemala',  'Guatemala City', 'America/Guatemala',   'professional',      'professional',      'light',    5.0, 4.0, 'Content Specialist',         'Agencia Vela',       'employed',       'mid',    '00000000-0000-4000-8000-000000000314', 1500.00, 'monthly', '{full_time}', 40, 'passed',      4, 'Portfolio spans coaching and SaaS; strong hooks.',                   'Short-form copy, content calendars, Canva systems', 'linkedin',          'manual',  true,  now() - interval '17 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000714', 'CAN-000014', 'Tomás',     'Castro',    'tomas.castro@example.com',      '+56-32-1014', 'Chile',      'Valparaíso',     'America/Santiago',    'professional',      'native_equivalent', 'light',    6.5, 5.0, 'Copywriter',                 'Freelance',          'available',      'mid',    '00000000-0000-4000-8000-000000000314', 11.00,   'hourly',  '{part_time,project}', 25, 'passed',  4, 'Sharp long-form writer; best for thought-leadership content.',       'Long-form writing, SEO basics, interview-to-article', 'upwork',            'manual',  true,  now() - interval '14 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000715', 'CAN-000015', 'Renata',    'Morales',   'renata.morales@example.com',    '+52-55-1015', 'Mexico',     'Mexico City',    'America/Mexico_City', 'native_equivalent', 'native_equivalent', 'none',     9.5, 8.0, 'Content Lead',              'Marca Viva',         'employed',       'senior', '00000000-0000-4000-8000-000000000314', 2600.00, 'monthly', '{full_time}', 40, 'passed',      5, 'Ran content for a 7-figure coaching brand; understands the niche.',  'Brand voice, funnels, team direction', 'partner_recruiter', 'manual',  true,  now() - interval '12 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000716', 'CAN-000016', 'Joaquín',   'Vargas',    'joaquin.vargas@example.com',    '+57-2-1016',  'Colombia',   'Cali',           'America/Bogota',      'professional',      'professional',      'moderate', 4.0, 3.0, 'Virtual Assistant',          'Freelance',          'available',      'mid',    '00000000-0000-4000-8000-000000000311', 8.00,    'hourly',  '{full_time}', 40, 'in_progress', 3, 'Solid generalist VA; English is fine but accent is noticeable.',     'Flexible, multi-client experience, quick turnaround', 'inbound',           'manual',  true,  now() - interval '9 days',  'complete',   'active'),
  ('00000000-0000-4000-8000-000000000717', 'CAN-000017', 'Antonella', 'Rojas',     'antonella.rojas@example.com',   '+51-54-1017', 'Peru',       'Arequipa',       'America/Lima',        'conversational',    'professional',      'moderate', 1.5, 1.0, 'Junior Assistant',           'Estudio Rojas',      'employed',       'junior', '00000000-0000-4000-8000-000000000311', 750.00,  'monthly', '{full_time}', 48, 'not_started', null, null,                                                            'Eager, organised, strong written English', 'inbound',           'manual',  false, null,                     'complete',   'passive'),
  ('00000000-0000-4000-8000-000000000718', 'CAN-000018', 'Felipe',    'Mendoza',   'felipe.mendoza@example.com',    '+591-2-1018', 'Bolivia',    'La Paz',         'America/La_Paz',      'conversational',    'conversational',    'heavy',    3.0, 2.0, 'Operations Assistant',       'Importadora MZ',     'employed',       'junior', '00000000-0000-4000-8000-000000000312', 950.00,  'monthly', '{full_time}', 40, 'failed',      2, 'English not yet strong enough for US-facing work.',                  'Process discipline, spreadsheet fluency', 'webhook',           'webhook', true,  now() - interval '8 days',  'incomplete', 'do_not_use'),
  ('00000000-0000-4000-8000-000000000719', 'CAN-000019', 'Regina',    'Ortiz',     'regina.ortiz@example.com',      '+52-222-1019','Mexico',     'Puebla',         'America/Mexico_City', 'professional',      'professional',      'light',    5.5, 4.5, 'Client Services Manager',    'Consultora Opal',    'serving_notice', 'mid',    '00000000-0000-4000-8000-000000000313', 1850.00, 'monthly', '{full_time}', 40, 'passed',      4, 'Consulting-client background; polished on video.',                   'Onboarding design, expectation management', 'linkedin',          'manual',  true,  now() - interval '11 days', 'complete',   'active'),
  ('00000000-0000-4000-8000-000000000720', 'CAN-000020', 'Bruno',     'Silva',     'bruno.silva@example.com',       '+55-11-1020', 'Brazil',     'São Paulo',      'America/Sao_Paulo',   'professional',      'professional',      'moderate', 11.0, 9.0, 'Senior Operations Manager', 'Fábrica Digital',    'employed',       'senior', '00000000-0000-4000-8000-000000000312', 16.00,   'hourly',  '{full_time}', 40, 'passed',      4, 'Deep ops experience; Portuguese-first but writes excellent English.','Scaling teams, tooling migrations, budget ownership', 'linkedin',          'manual',  true,  now() - interval '7 days',  'complete',   'active'),
  ('00000000-0000-4000-8000-000000000721', 'CAN-000021', 'Julieta',   'Ríos',      'julieta.rios@example.com',      '+54-341-1021','Argentina',  'Rosario',        'America/Argentina/Cordoba', 'professional', 'professional',     'light',    4.0, 3.5, 'Executive Assistant',        'Estudio RH',         'available',      'mid',    '00000000-0000-4000-8000-000000000311', 1400.00, 'monthly', '{full_time}', 40, 'in_progress', 4, 'Available immediately; screening call booked.',                      'Availability, CRM data entry, meeting notes', 'upwork',            'manual',  true,  now() - interval '6 days',  'complete',   'active'),
  ('00000000-0000-4000-8000-000000000722', 'CAN-000022', 'Andrés',    'Guerrero',  'andres.guerrero@example.com',   '+57-5-1022',  'Colombia',   'Barranquilla',   'America/Bogota',      'native_equivalent', 'professional',      'none',     6.0, 5.0, 'Customer Success Lead',      'Costa Tech',         'employed',       'mid',    '00000000-0000-4000-8000-000000000313', 2000.00, 'monthly', '{full_time}', 40, 'passed',      5, 'Grew NPS 20 points in a year; excellent on camera.',                 'Voice-of-customer programs, renewals, bilingual demos', 'referral',          'manual',  true,  now() - interval '5 days',  'complete',   'active'),
  ('00000000-0000-4000-8000-000000000723', 'CAN-000023', 'Ximena',    'Paredes',   'ximena.paredes@example.com',    '+593-4-1023', 'Ecuador',    'Guayaquil',      'America/Guayaquil',   'conversational',    'professional',      'moderate', 2.0, 1.5, 'Social Media Assistant',     'Freelance',          'available',      'junior', '00000000-0000-4000-8000-000000000314', 6.00,    'hourly',  '{part_time}', 20, 'not_started', null, null,                                                            'Reels editing, scheduling tools, trend awareness', 'other',             'manual',  false, null,                     'complete',   'passive'),
  ('00000000-0000-4000-8000-000000000724', 'CAN-000024', 'Rafael',    'Duarte',    'rafael.duarte@example.com',     '+55-48-1024', 'Brazil',     'Florianópolis',  'America/Sao_Paulo',   'professional',      'professional',      'light',    7.0, 5.0, 'Content Strategist',         'Onda Creative',      'employed',       'mid',    '00000000-0000-4000-8000-000000000314', 1950.00, 'monthly', '{full_time,project}', 40, 'in_progress', 4, 'Strategy-first content operator; portfolio review scheduled.',       'Editorial strategy, analytics, repurposing systems', 'linkedin',          'manual',  true,  now() - interval '4 days',  'complete',   'active'),
  ('00000000-0000-4000-8000-000000000725', 'CAN-000025', 'Daniela',   'Fuentes',   'daniela.fuentes@example.com',   '+56-2-1025',  'Chile',      'Santiago',       'America/Santiago',    'native_equivalent', 'native_equivalent', 'none',     8.0, 7.0, 'Executive Business Partner', 'Cobre Capital',      'employed',       'senior', '00000000-0000-4000-8000-000000000311', 2500.00, 'monthly', '{full_time}', 40, 'passed',      5, 'Finance-sector EA; unflappable and extremely precise.',              'Board meeting prep, confidentiality, financial literacy', 'partner_recruiter', 'manual',  true,  now() - interval '3 days',  'complete',   'active')
on conflict (id) do nothing;

-- A few structured child rows
insert into candidate_languages (id, candidate_id, language, spoken_level, written_level, is_native) values
  ('00000000-0000-4000-8000-000000000751', '00000000-0000-4000-8000-000000000701', 'Spanish',    'native_equivalent', 'native_equivalent', true),
  ('00000000-0000-4000-8000-000000000752', '00000000-0000-4000-8000-000000000720', 'Portuguese', 'native_equivalent', 'native_equivalent', true),
  ('00000000-0000-4000-8000-000000000753', '00000000-0000-4000-8000-000000000720', 'Spanish',    'professional',      'professional',      false)
on conflict (id) do nothing;

insert into candidate_tools (candidate_id, tool_id, proficiency, years_used) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000903', 'expert',     4.0),  -- Valentina / ClickUp
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000905', 'expert',     6.0),  -- Valentina / Slack
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000906', 'proficient', 3.0),  -- Mateo / Notion
  ('00000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000907', 'expert',     5.0),  -- Sebastián / Zapier
  ('00000000-0000-4000-8000-000000000709', '00000000-0000-4000-8000-000000000901', 'expert',     4.0),  -- Mariana / HubSpot
  ('00000000-0000-4000-8000-000000000713', '00000000-0000-4000-8000-000000000908', 'expert',     5.0)   -- Sofía / Canva
on conflict do nothing;

insert into candidate_skills (candidate_id, skill_id, proficiency) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000921', 'expert'),
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000922', 'expert'),
  ('00000000-0000-4000-8000-000000000706', '00000000-0000-4000-8000-000000000925', 'expert'),
  ('00000000-0000-4000-8000-000000000709', '00000000-0000-4000-8000-000000000926', 'expert'),
  ('00000000-0000-4000-8000-000000000713', '00000000-0000-4000-8000-000000000923', 'proficient'),
  ('00000000-0000-4000-8000-000000000715', '00000000-0000-4000-8000-000000000928', 'expert')
on conflict do nothing;

insert into candidate_industries (candidate_id, industry_id, years) values
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000941', 3.0),
  ('00000000-0000-4000-8000-000000000709', '00000000-0000-4000-8000-000000000946', 4.0),
  ('00000000-0000-4000-8000-000000000715', '00000000-0000-4000-8000-000000000941', 5.0),
  ('00000000-0000-4000-8000-000000000725', '00000000-0000-4000-8000-000000000944', 2.0)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Assignments at varied stages (REQ-000001 pipeline + one cross-requisition)
-- ---------------------------------------------------------------------------
insert into assignments (id, requisition_id, candidate_id, stage, presented_at, client_decision_at,
                         assigned_by, presented_by, admin_note, client_note, sort_order) values
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000701',
   'presented', now() - interval '5 days', null,
   '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101',
   'Top pick for this brief.', 'Our strongest match — eight years supporting founders, immaculate references.', 1),
  ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000702',
   'interview_scheduled', now() - interval '6 days', now() - interval '3 days',
   '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101',
   'Client asked for the earliest slot.', 'Native-level English and deep US-agency experience.', 2),
  ('00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000703',
   'client_reviewing', now() - interval '5 days', now() - interval '2 days',
   '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000101',
   null, 'A calm, systems-minded EA with standout travel-planning experience.', 3),
  ('00000000-0000-4000-8000-000000000804', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000725',
   'vetted', null, null,
   '00000000-0000-4000-8000-000000000102', null,
   'Hold back as bench in case the top three fall through.', null, 4),
  ('00000000-0000-4000-8000-000000000805', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000705',
   'rejected_by_client', now() - interval '6 days', now() - interval '1 day',
   '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101',
   null, 'Chief-of-staff calibre operator.', 5),
  ('00000000-0000-4000-8000-000000000806', '00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000721',
   'sourced', null, null,
   '00000000-0000-4000-8000-000000000103', null,
   'Sourced from Upwork; screening call booked.', null, 6),
  -- Same candidate on a second requisition at a different stage (rule 2 sanity case)
  ('00000000-0000-4000-8000-000000000807', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000701',
   'sourced', null, null,
   '00000000-0000-4000-8000-000000000102', null,
   'Could also fit the Northlight CSM brief if it converts.', null, 1)
on conflict (id) do nothing;

-- Rejection behind assignment ...805 (client rejected on salary)
insert into rejections (id, assignment_id, actor, rejected_by, reason_id, detail) values
  ('00000000-0000-4000-8000-000000000811', '00000000-0000-4000-8000-000000000805',
   'client', '00000000-0000-4000-8000-000000000104',
   (select id from rejection_reasons where key = 'salary_mismatch'),
   'Loved her, but $2,800/month is above the approved band.')
on conflict (id) do nothing;

-- Interview for assignment ...802
insert into interviews (id, assignment_id, round_number, scheduled_at, timezone, duration_minutes,
                        meeting_url, interviewer_names, requested_by, created_by, outcome) values
  ('00000000-0000-4000-8000-000000000821', '00000000-0000-4000-8000-000000000802', 1,
   now() + interval '2 days', 'America/Chicago', 45,
   'https://meet.google.com/dev-seed-interview', 'Dana Whitfield, Marcus Lee',
   '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000102', 'pending')
on conflict (id) do nothing;

commit;
