-- candidate_questions_seed.sql
--
-- Starter question set for the public candidate registration form (T38).
--
-- Reference data, NOT a migration: Rebecca owns this content and will edit it
-- through the admin Question Manager. Seeded only so the form is usable on
-- day one — every row here is editable, reorderable, and deactivatable in the
-- UI without a deploy (01 §3 J9).
--
-- Re-runnable: fixed UUIDs + `on conflict do nothing`.
--
-- IMPORTANT: keys in CANDIDATE_MAPPED_QUESTION_KEYS
-- (packages/contracts/src/candidate-registration.ts) project onto first-class
-- `candidates` columns. Those keys must match EXACTLY or the projection
-- silently stops populating the column. Unmapped keys are still stored as
-- answers — they are simply not promoted.
--
-- The 4xx UUID block is used by dev_seed for CLIENT questions; candidate rows
-- use a 5xx block so the two seeds never collide.

-- ---------------------------------------------------------------------------
-- Categories → one form step each, in sort order.
-- ---------------------------------------------------------------------------
insert into question_categories (id, key, label, description, sort_order) values
  ('00000000-0000-4000-8000-000000000501', 'candidate_personal',   'About you',              'The basics, so we know who we are talking to',        10),
  ('00000000-0000-4000-8000-000000000502', 'candidate_location',   'Where you are',          'Location and when you can start',                     11),
  ('00000000-0000-4000-8000-000000000503', 'candidate_language',   'Language',               'How you communicate in English',                      12),
  ('00000000-0000-4000-8000-000000000504', 'candidate_experience', 'Your experience',        'What you have done and what you are good at',         13),
  ('00000000-0000-4000-8000-000000000505', 'candidate_work_setup', 'Your working setup',     'Availability and home office',                        14)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Questions. `audience = 'candidate'` is what routes these to /register and
-- keeps them off the client intake form.
-- ---------------------------------------------------------------------------
insert into questions (id, category_id, key, label, help_text, placeholder, question_type, audience, is_required, sort_order, validation) values
  -- About you -------------------------------------------------------------
  ('00000000-0000-4000-8000-000000000511', '00000000-0000-4000-8000-000000000501', 'first_name',            'First name',                    null,                                                      'Maria',                  'short_text',    'candidate', true,  1, '{"maxLength":100}'),
  ('00000000-0000-4000-8000-000000000512', '00000000-0000-4000-8000-000000000501', 'last_name',             'Last name',                     null,                                                      'Gonzalez',               'short_text',    'candidate', true,  2, '{"maxLength":100}'),
  ('00000000-0000-4000-8000-000000000513', '00000000-0000-4000-8000-000000000501', 'preferred_name',        'What should we call you?',      'Only if it differs from your first name.',                null,                     'short_text',    'candidate', false, 3, '{"maxLength":100}'),
  ('00000000-0000-4000-8000-000000000514', '00000000-0000-4000-8000-000000000501', 'email',                 'Email address',                 'We will contact you here.',                               'you@example.com',        'email',         'candidate', true,  4, '{}'),
  ('00000000-0000-4000-8000-000000000515', '00000000-0000-4000-8000-000000000501', 'phone',                 'Phone number',                  'Include your country code.',                              '+52 55 1234 5678',       'phone',         'candidate', false, 5, '{"maxLength":40}'),
  ('00000000-0000-4000-8000-000000000516', '00000000-0000-4000-8000-000000000501', 'whatsapp',              'WhatsApp number',               'If different from your phone number.',                    null,                     'phone',         'candidate', false, 6, '{"maxLength":40}'),
  ('00000000-0000-4000-8000-000000000517', '00000000-0000-4000-8000-000000000501', 'linkedin_url',          'LinkedIn profile',              null,                                                      'https://linkedin.com/in/', 'short_text',  'candidate', false, 7, '{"maxLength":500}'),

  -- Where you are ---------------------------------------------------------
  ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000502', 'country',               'Country',                       null,                                                      null,                     'single_select', 'candidate', true,  1, '{}'),
  ('00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-000000000502', 'region_state',          'State or region',               null,                                                      null,                     'short_text',    'candidate', false, 2, '{"maxLength":120}'),
  ('00000000-0000-4000-8000-000000000523', '00000000-0000-4000-8000-000000000502', 'city',                  'City',                          null,                                                      null,                     'short_text',    'candidate', false, 3, '{"maxLength":120}'),
  ('00000000-0000-4000-8000-000000000524', '00000000-0000-4000-8000-000000000502', 'timezone',              'Your timezone',                 'So clients know when you overlap with them.',             'America/Mexico_City',    'short_text',    'candidate', false, 4, '{"maxLength":80}'),
  ('00000000-0000-4000-8000-000000000525', '00000000-0000-4000-8000-000000000502', 'available_from',        'When could you start?',         null,                                                      null,                     'date',          'candidate', false, 5, '{}'),

  -- Language --------------------------------------------------------------
  ('00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-000000000503', 'english_spoken_level',  'Spoken English',                'Be honest — we match you to roles that fit.',             null,                     'single_select', 'candidate', true,  1, '{}'),
  ('00000000-0000-4000-8000-000000000532', '00000000-0000-4000-8000-000000000503', 'english_written_level', 'Written English',               null,                                                      null,                     'single_select', 'candidate', true,  2, '{}'),

  -- Your experience -------------------------------------------------------
  ('00000000-0000-4000-8000-000000000541', '00000000-0000-4000-8000-000000000504', 'current_title',         'Current or most recent job title', null,                                                   'Executive Assistant',    'short_text',    'candidate', false, 1, '{"maxLength":200}'),
  ('00000000-0000-4000-8000-000000000542', '00000000-0000-4000-8000-000000000504', 'current_employer',      'Current or most recent employer', null,                                                    null,                     'short_text',    'candidate', false, 2, '{"maxLength":200}'),
  ('00000000-0000-4000-8000-000000000543', '00000000-0000-4000-8000-000000000504', 'years_experience_total','Total years of work experience', null,                                                      '5',                      'number',        'candidate', false, 3, '{"min":0,"max":60}'),
  ('00000000-0000-4000-8000-000000000544', '00000000-0000-4000-8000-000000000504', 'has_us_client_experience','Have you worked with US-based clients or teams?', null,                                 null,                     'yes_no',        'candidate', false, 4, '{}'),
  ('00000000-0000-4000-8000-000000000545', '00000000-0000-4000-8000-000000000504', 'candidate_summary',     'Tell us about yourself',        'A short paragraph. What you do well, and the kind of role you want.', null,        'long_text',     'candidate', false, 5, '{"maxLength":1500}'),

  -- Your working setup ----------------------------------------------------
  ('00000000-0000-4000-8000-000000000551', '00000000-0000-4000-8000-000000000505', 'hours_available_per_week','Hours available per week',     null,                                                      '40',                     'number',        'candidate', false, 1, '{"min":1,"max":60}'),
  ('00000000-0000-4000-8000-000000000552', '00000000-0000-4000-8000-000000000505', 'workspace_type',        'Where do you work from?',       null,                                                      null,                     'single_select', 'candidate', false, 2, '{}'),
  ('00000000-0000-4000-8000-000000000553', '00000000-0000-4000-8000-000000000505', 'has_backup_internet',   'Do you have a backup internet connection?', 'A phone hotspot counts.',                     null,                     'yes_no',        'candidate', false, 3, '{}'),
  ('00000000-0000-4000-8000-000000000554', '00000000-0000-4000-8000-000000000505', 'has_backup_power',      'Do you have backup power?',     null,                                                      null,                     'yes_no',        'candidate', false, 4, '{}')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Options for the select questions.
--
-- Country: LATAM-focused starter list plus Other. Rebecca confirmed on the
-- 13 Aug call that region should be a dropdown with an Other escape hatch
-- (T15); the same reasoning applies to a candidate's own country.
--
-- Language levels mirror the `language_level` enum exactly so the projection
-- onto candidates.english_spoken_level / _written_level is a straight
-- assignment with no translation layer to drift.
-- ---------------------------------------------------------------------------
insert into question_options (id, question_id, value, label, sort_order) values
  -- country
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000521', 'Mexico', 'Mexico',              1),
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000521', 'Colombia', 'Colombia',            2),
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-000000000521', 'Argentina', 'Argentina',           3),
  ('00000000-0000-4000-8000-000000000604', '00000000-0000-4000-8000-000000000521', 'Brazil', 'Brazil',              4),
  ('00000000-0000-4000-8000-000000000605', '00000000-0000-4000-8000-000000000521', 'Peru', 'Peru',                5),
  ('00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-000000000521', 'Chile', 'Chile',               6),
  ('00000000-0000-4000-8000-000000000607', '00000000-0000-4000-8000-000000000521', 'Costa Rica', 'Costa Rica',          7),
  ('00000000-0000-4000-8000-000000000608', '00000000-0000-4000-8000-000000000521', 'Dominican Republic', 'Dominican Republic',  8),
  ('00000000-0000-4000-8000-000000000609', '00000000-0000-4000-8000-000000000521', 'Venezuela', 'Venezuela',           9),
  ('00000000-0000-4000-8000-000000000610', '00000000-0000-4000-8000-000000000521', 'Guatemala', 'Guatemala',          10),
  ('00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000521', 'Somewhere else', 'Somewhere else',  11),

  -- english_spoken_level  (values == language_level enum)
  ('00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000531', 'basic',             'Basic — simple conversations',            1),
  ('00000000-0000-4000-8000-000000000622', '00000000-0000-4000-8000-000000000531', 'conversational',    'Conversational — comfortable on a call',  2),
  ('00000000-0000-4000-8000-000000000623', '00000000-0000-4000-8000-000000000531', 'professional',      'Professional — client-facing',            3),
  ('00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000531', 'native_equivalent', 'Native or equivalent',                    4),

  -- english_written_level
  ('00000000-0000-4000-8000-000000000631', '00000000-0000-4000-8000-000000000532', 'basic',             'Basic',                                   1),
  ('00000000-0000-4000-8000-000000000632', '00000000-0000-4000-8000-000000000532', 'conversational',    'Conversational',                          2),
  ('00000000-0000-4000-8000-000000000633', '00000000-0000-4000-8000-000000000532', 'professional',      'Professional',                            3),
  ('00000000-0000-4000-8000-000000000634', '00000000-0000-4000-8000-000000000532', 'native_equivalent', 'Native or equivalent',                    4),

  -- workspace_type  (values == workspace_type enum)
  ('00000000-0000-4000-8000-000000000641', '00000000-0000-4000-8000-000000000552', 'dedicated_home_office', 'A dedicated home office', 1),
  ('00000000-0000-4000-8000-000000000642', '00000000-0000-4000-8000-000000000552', 'shared_space',          'A shared space at home',  2),
  ('00000000-0000-4000-8000-000000000643', '00000000-0000-4000-8000-000000000552', 'coworking',             'A coworking space',       3)
on conflict (id) do nothing;
