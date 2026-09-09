-- skills_tools_taxonomy_seed.sql
--
-- T9 -- the starter skill and tool taxonomy, organised by section.
--
-- WHAT T9 GETS WRONG. The task says the `category` column on `tools` and
-- `skills` "is simply unpopulated". It is not. All 16 rows dev_seed.sql
-- inserts already carry a category:
--
--     tools    automation, communication, crm, design, documentation, project_management
--     skills   administrative, analytical, client_experience, finance, marketing, operations
--
-- What was actually missing are the two sections Rebecca named out loud at
-- 17:47 and 18:01 -- **Tech Stack** and **Leadership** -- plus enough rows in
-- every section for the list to be usable before she edits it:
--   "we'll populate a whole -- I mean, yeah, just put AI, put something
--    together, and then we'll edit it"
--   "have it be organized by section, and tech stack would be a section...
--    and then, like, you know, leadership would be a section."
--
-- So this file only ADDS. No existing row's name or category is touched;
-- there is no `update` and no `delete` anywhere in it.
--
-- WHY A SEED AND NOT A MIGRATION. 02-DATABASE.md, after the migration table:
-- "Seed data for departments, role categories, questions, tools, skills, and
-- industries is not in migrations -- it is entered by the client through the
-- admin UI." Rebecca owns this content and asked to edit it; a migration
-- would freeze it and force a deploy for every wording change.
--
-- ONE SHARED VOCABULARY. Until now `tools` and `skills` used disjoint
-- category sets -- no tool was ever `marketing`, no skill was ever `crm`.
-- T7 renders both tables as ONE table grouped by category, which only works
-- if they agree. The two sets are merged here into the 14 keys below and both
-- tables draw from all of them.
--
-- SECTIONS (key -> the label the UI should render). Counts include the
-- carried-forward dev_seed rows:
--
--   tech_stack           Tech Stack                            12 tools,   6 skills
--   project_management   Project Management                    10 tools,   0 skills
--   communication        Communication                          7 tools,   7 skills
--   documentation        Documentation & Knowledge              8 tools,   4 skills
--   automation           Automation & AI                        8 tools,   4 skills
--   design               Design & Creative                      8 tools,   6 skills
--   crm                  CRM & Sales                            9 tools,   8 skills
--   marketing            Marketing                              9 tools,   9 skills
--   finance              Finance & Bookkeeping                  9 tools,   9 skills
--   administrative       Administrative & Executive Support     5 tools,  10 skills
--   operations           Operations                             6 tools,   8 skills
--   client_experience    Client Experience                      6 tools,   8 skills
--   analytical           Analytics & Reporting                  5 tools,   7 skills
--   leadership           Leadership                             0 tools,  12 skills
--
-- RE-RUNNABLE. Fixed uuids plus an UNTARGETED `on conflict do nothing`.
-- Untargeted is deliberate: it swallows a conflict on EITHER unique
-- constraint -- `tools_pkey`/`skills_pkey` and `tools_name_key`/
-- `skills_name_key`. A targeted `on conflict (id) do nothing` would still
-- raise 23505 the moment someone had already created "Figma" through
-- POST /api/v1/tools under a different id, which for reference data the
-- client edits is the normal case, not the exotic one.
--
-- The 16 dev_seed rows are repeated here with dev_seed's exact ids so that:
--   * a production database, which never runs dev_seed, still gets the full
--     catalogue rather than one missing HubSpot, Slack and ClickUp; and
--   * the two seeds may run in either order -- whichever goes first wins the
--     id, and dev_seed's `candidate_tools`/`candidate_skills` rows, which
--     reference those ids by hand, keep resolving either way.
--
-- UUID blocks: tools 000000910001+, skills 000000920001+. Both are clear of
-- every block already in use (dev_seed 0000000009xx, candidate questions
-- 00000000005xx, countries 000000900001-000000900251, and the 0000095xxxxx /
-- 0000096xxxxx / 0000097xxxxx question-option blocks).
--
-- NAMES ARE CANDIDATE-FACING. These become the choices on the public
-- registration form, so they are written the way a person writes them --
-- "ClickUp", "Monday.com", "Search Engine Optimization (SEO)" -- never as
-- slugs. The CATEGORY value stays snake_case because that is what all 16
-- existing rows use and matching them is what keeps the grouping from
-- splitting in two; `tools`/`skills` have no label column, so the display
-- labels above belong in the UI's category map, not in this data.

-- ---------------------------------------------------------------------------
-- Tools
-- ---------------------------------------------------------------------------
insert into tools (id, name, category) values
  -- Carried forward from dev_seed.sql -- same ids, same categories, nothing changed.
  ('00000000-0000-4000-8000-000000000901', 'HubSpot',                  'crm'),
  ('00000000-0000-4000-8000-000000000902', 'Salesforce',               'crm'),
  ('00000000-0000-4000-8000-000000000903', 'ClickUp',                  'project_management'),
  ('00000000-0000-4000-8000-000000000904', 'Asana',                    'project_management'),
  ('00000000-0000-4000-8000-000000000905', 'Slack',                    'communication'),
  ('00000000-0000-4000-8000-000000000906', 'Notion',                   'documentation'),
  ('00000000-0000-4000-8000-000000000907', 'Zapier',                   'automation'),
  ('00000000-0000-4000-8000-000000000908', 'Canva',                    'design'),

  -- Tech Stack ----------------------------------------------------
  ('00000000-0000-4000-8000-000000910001', 'Google Workspace',         'tech_stack'),
  ('00000000-0000-4000-8000-000000910002', 'Microsoft 365',            'tech_stack'),
  ('00000000-0000-4000-8000-000000910003', 'Microsoft Excel',          'tech_stack'),
  ('00000000-0000-4000-8000-000000910004', 'Google Sheets',            'tech_stack'),
  ('00000000-0000-4000-8000-000000910005', 'Microsoft Word',           'tech_stack'),
  ('00000000-0000-4000-8000-000000910006', 'Microsoft PowerPoint',     'tech_stack'),
  ('00000000-0000-4000-8000-000000910007', 'Google Drive',             'tech_stack'),
  ('00000000-0000-4000-8000-000000910008', 'Dropbox',                  'tech_stack'),
  ('00000000-0000-4000-8000-000000910009', 'Airtable',                 'tech_stack'),
  ('00000000-0000-4000-8000-000000910010', 'WordPress',                'tech_stack'),
  ('00000000-0000-4000-8000-000000910011', 'Shopify',                  'tech_stack'),
  ('00000000-0000-4000-8000-000000910012', 'Webflow',                  'tech_stack'),

  -- Project Management --------------------------------------------
  ('00000000-0000-4000-8000-000000910013', 'Trello',                   'project_management'),
  ('00000000-0000-4000-8000-000000910014', 'Monday.com',               'project_management'),
  ('00000000-0000-4000-8000-000000910015', 'Jira',                     'project_management'),
  ('00000000-0000-4000-8000-000000910016', 'Basecamp',                 'project_management'),
  ('00000000-0000-4000-8000-000000910017', 'Smartsheet',               'project_management'),
  ('00000000-0000-4000-8000-000000910018', 'Wrike',                    'project_management'),
  ('00000000-0000-4000-8000-000000910019', 'Todoist',                  'project_management'),
  ('00000000-0000-4000-8000-000000910020', 'Teamwork',                 'project_management'),

  -- Communication -------------------------------------------------
  ('00000000-0000-4000-8000-000000910021', 'Zoom',                     'communication'),
  ('00000000-0000-4000-8000-000000910022', 'Microsoft Teams',          'communication'),
  ('00000000-0000-4000-8000-000000910023', 'Google Meet',              'communication'),
  ('00000000-0000-4000-8000-000000910024', 'Loom',                     'communication'),
  ('00000000-0000-4000-8000-000000910025', 'WhatsApp Business',        'communication'),
  ('00000000-0000-4000-8000-000000910026', 'Discord',                  'communication'),

  -- Documentation & Knowledge -------------------------------------
  ('00000000-0000-4000-8000-000000910027', 'Google Docs',              'documentation'),
  ('00000000-0000-4000-8000-000000910028', 'Confluence',               'documentation'),
  ('00000000-0000-4000-8000-000000910029', 'Coda',                     'documentation'),
  ('00000000-0000-4000-8000-000000910030', 'SharePoint',               'documentation'),
  ('00000000-0000-4000-8000-000000910031', 'Process Street',           'documentation'),
  ('00000000-0000-4000-8000-000000910032', 'Trainual',                 'documentation'),
  ('00000000-0000-4000-8000-000000910033', 'Scribe',                   'documentation'),

  -- Automation & AI -----------------------------------------------
  ('00000000-0000-4000-8000-000000910034', 'Make',                     'automation'),
  ('00000000-0000-4000-8000-000000910035', 'n8n',                      'automation'),
  ('00000000-0000-4000-8000-000000910036', 'Microsoft Power Automate', 'automation'),
  ('00000000-0000-4000-8000-000000910037', 'Google Apps Script',       'automation'),
  ('00000000-0000-4000-8000-000000910038', 'ChatGPT',                  'automation'),
  ('00000000-0000-4000-8000-000000910039', 'Claude',                   'automation'),
  ('00000000-0000-4000-8000-000000910040', 'Google Gemini',            'automation'),

  -- Design & Creative ---------------------------------------------
  ('00000000-0000-4000-8000-000000910041', 'Figma',                    'design'),
  ('00000000-0000-4000-8000-000000910042', 'Adobe Photoshop',          'design'),
  ('00000000-0000-4000-8000-000000910043', 'Adobe Illustrator',        'design'),
  ('00000000-0000-4000-8000-000000910044', 'Adobe InDesign',           'design'),
  ('00000000-0000-4000-8000-000000910045', 'Adobe Premiere Pro',       'design'),
  ('00000000-0000-4000-8000-000000910046', 'CapCut',                   'design'),
  ('00000000-0000-4000-8000-000000910047', 'Descript',                 'design'),

  -- CRM & Sales ---------------------------------------------------
  ('00000000-0000-4000-8000-000000910048', 'GoHighLevel',              'crm'),
  ('00000000-0000-4000-8000-000000910049', 'Pipedrive',                'crm'),
  ('00000000-0000-4000-8000-000000910050', 'Zoho CRM',                 'crm'),
  ('00000000-0000-4000-8000-000000910051', 'Close',                    'crm'),
  ('00000000-0000-4000-8000-000000910052', 'Keap',                     'crm'),
  ('00000000-0000-4000-8000-000000910053', 'Apollo.io',                'crm'),
  ('00000000-0000-4000-8000-000000910054', 'Copper',                   'crm'),

  -- Marketing -----------------------------------------------------
  ('00000000-0000-4000-8000-000000910055', 'Mailchimp',                'marketing'),
  ('00000000-0000-4000-8000-000000910056', 'ActiveCampaign',           'marketing'),
  ('00000000-0000-4000-8000-000000910057', 'Klaviyo',                  'marketing'),
  ('00000000-0000-4000-8000-000000910058', 'ConvertKit',               'marketing'),
  ('00000000-0000-4000-8000-000000910059', 'Meta Business Suite',      'marketing'),
  ('00000000-0000-4000-8000-000000910060', 'Hootsuite',                'marketing'),
  ('00000000-0000-4000-8000-000000910061', 'Buffer',                   'marketing'),
  ('00000000-0000-4000-8000-000000910062', 'Later',                    'marketing'),
  ('00000000-0000-4000-8000-000000910063', 'Google Ads',               'marketing'),

  -- Finance & Bookkeeping -----------------------------------------
  ('00000000-0000-4000-8000-000000910064', 'QuickBooks Online',        'finance'),
  ('00000000-0000-4000-8000-000000910065', 'Xero',                     'finance'),
  ('00000000-0000-4000-8000-000000910066', 'FreshBooks',               'finance'),
  ('00000000-0000-4000-8000-000000910067', 'Wave',                     'finance'),
  ('00000000-0000-4000-8000-000000910068', 'Bill.com',                 'finance'),
  ('00000000-0000-4000-8000-000000910069', 'Expensify',                'finance'),
  ('00000000-0000-4000-8000-000000910070', 'Gusto',                    'finance'),
  ('00000000-0000-4000-8000-000000910071', 'Deel',                     'finance'),
  ('00000000-0000-4000-8000-000000910072', 'Stripe',                   'finance'),

  -- Administrative & Executive Support ----------------------------
  ('00000000-0000-4000-8000-000000910073', 'Calendly',                 'administrative'),
  ('00000000-0000-4000-8000-000000910074', 'Google Calendar',          'administrative'),
  ('00000000-0000-4000-8000-000000910075', 'Acuity Scheduling',        'administrative'),
  ('00000000-0000-4000-8000-000000910076', 'DocuSign',                 'administrative'),
  ('00000000-0000-4000-8000-000000910077', 'Motion',                   'administrative'),

  -- Operations ----------------------------------------------------
  ('00000000-0000-4000-8000-000000910078', 'Typeform',                 'operations'),
  ('00000000-0000-4000-8000-000000910079', 'Jotform',                  'operations'),
  ('00000000-0000-4000-8000-000000910080', 'Google Forms',             'operations'),
  ('00000000-0000-4000-8000-000000910081', 'Toggl Track',              'operations'),
  ('00000000-0000-4000-8000-000000910082', 'Harvest',                  'operations'),
  ('00000000-0000-4000-8000-000000910083', 'Time Doctor',              'operations'),

  -- Client Experience ---------------------------------------------
  ('00000000-0000-4000-8000-000000910084', 'Zendesk',                  'client_experience'),
  ('00000000-0000-4000-8000-000000910085', 'Intercom',                 'client_experience'),
  ('00000000-0000-4000-8000-000000910086', 'Freshdesk',                'client_experience'),
  ('00000000-0000-4000-8000-000000910087', 'Help Scout',               'client_experience'),
  ('00000000-0000-4000-8000-000000910088', 'Gorgias',                  'client_experience'),
  ('00000000-0000-4000-8000-000000910089', 'Front',                    'client_experience'),

  -- Analytics & Reporting -----------------------------------------
  ('00000000-0000-4000-8000-000000910090', 'Google Analytics',         'analytical'),
  ('00000000-0000-4000-8000-000000910091', 'Looker Studio',            'analytical'),
  ('00000000-0000-4000-8000-000000910092', 'Microsoft Power BI',       'analytical'),
  ('00000000-0000-4000-8000-000000910093', 'Tableau',                  'analytical'),
  ('00000000-0000-4000-8000-000000910094', 'Hotjar',                   'analytical')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------
insert into skills (id, name, category) values
  -- Carried forward from dev_seed.sql -- same ids, same categories, nothing changed.
  ('00000000-0000-4000-8000-000000000921', 'Calendar Management',                 'administrative'),
  ('00000000-0000-4000-8000-000000000922', 'Inbox Management',                    'administrative'),
  ('00000000-0000-4000-8000-000000000923', 'Copywriting',                         'marketing'),
  ('00000000-0000-4000-8000-000000000924', 'Data Analysis',                       'analytical'),
  ('00000000-0000-4000-8000-000000000925', 'Project Management',                  'operations'),
  ('00000000-0000-4000-8000-000000000926', 'Customer Support',                    'client_experience'),
  ('00000000-0000-4000-8000-000000000927', 'Bookkeeping',                         'finance'),
  ('00000000-0000-4000-8000-000000000928', 'Social Media Management',             'marketing'),

  -- Tech Stack ----------------------------------------------------
  ('00000000-0000-4000-8000-000000920001', 'Spreadsheet Formulas & Pivot Tables', 'tech_stack'),
  ('00000000-0000-4000-8000-000000920002', 'Basic HTML & CSS',                    'tech_stack'),
  ('00000000-0000-4000-8000-000000920003', 'Website Maintenance',                 'tech_stack'),
  ('00000000-0000-4000-8000-000000920004', 'SQL',                                 'tech_stack'),
  ('00000000-0000-4000-8000-000000920005', 'Tech Troubleshooting',                'tech_stack'),
  ('00000000-0000-4000-8000-000000920006', 'Database Management',                 'tech_stack'),

  -- Communication -------------------------------------------------
  ('00000000-0000-4000-8000-000000920007', 'Written Communication',               'communication'),
  ('00000000-0000-4000-8000-000000920008', 'Verbal Communication',                'communication'),
  ('00000000-0000-4000-8000-000000920009', 'Business Writing',                    'communication'),
  ('00000000-0000-4000-8000-000000920010', 'Email Etiquette',                     'communication'),
  ('00000000-0000-4000-8000-000000920011', 'Presentation Skills',                 'communication'),
  ('00000000-0000-4000-8000-000000920012', 'Active Listening',                    'communication'),
  ('00000000-0000-4000-8000-000000920013', 'Cross-Cultural Communication',        'communication'),

  -- Documentation & Knowledge -------------------------------------
  ('00000000-0000-4000-8000-000000920014', 'SOP Writing',                         'documentation'),
  ('00000000-0000-4000-8000-000000920015', 'Process Documentation',               'documentation'),
  ('00000000-0000-4000-8000-000000920016', 'Knowledge Base Management',           'documentation'),
  ('00000000-0000-4000-8000-000000920017', 'Technical Writing',                   'documentation'),

  -- Automation & AI -----------------------------------------------
  ('00000000-0000-4000-8000-000000920018', 'Workflow Automation',                 'automation'),
  ('00000000-0000-4000-8000-000000920019', 'AI Prompt Writing',                   'automation'),
  ('00000000-0000-4000-8000-000000920020', 'No-Code App Building',                'automation'),
  ('00000000-0000-4000-8000-000000920021', 'System Integration',                  'automation'),

  -- Design & Creative ---------------------------------------------
  ('00000000-0000-4000-8000-000000920022', 'Graphic Design',                      'design'),
  ('00000000-0000-4000-8000-000000920023', 'Video Editing',                       'design'),
  ('00000000-0000-4000-8000-000000920024', 'Photo Editing',                       'design'),
  ('00000000-0000-4000-8000-000000920025', 'Presentation Design',                 'design'),
  ('00000000-0000-4000-8000-000000920026', 'Brand & Visual Identity',             'design'),
  ('00000000-0000-4000-8000-000000920027', 'Social Media Graphics',               'design'),

  -- CRM & Sales ---------------------------------------------------
  ('00000000-0000-4000-8000-000000920028', 'Lead Generation',                     'crm'),
  ('00000000-0000-4000-8000-000000920029', 'Cold Outreach',                       'crm'),
  ('00000000-0000-4000-8000-000000920030', 'Appointment Setting',                 'crm'),
  ('00000000-0000-4000-8000-000000920031', 'Sales Pipeline Management',           'crm'),
  ('00000000-0000-4000-8000-000000920032', 'CRM Administration',                  'crm'),
  ('00000000-0000-4000-8000-000000920033', 'Proposal Writing',                    'crm'),
  ('00000000-0000-4000-8000-000000920034', 'Sales Reporting',                     'crm'),
  ('00000000-0000-4000-8000-000000920035', 'Prospect Research',                   'crm'),

  -- Marketing -----------------------------------------------------
  ('00000000-0000-4000-8000-000000920036', 'Email Marketing',                     'marketing'),
  ('00000000-0000-4000-8000-000000920037', 'Content Marketing',                   'marketing'),
  ('00000000-0000-4000-8000-000000920038', 'Search Engine Optimization (SEO)',    'marketing'),
  ('00000000-0000-4000-8000-000000920039', 'Paid Ads Management',                 'marketing'),
  ('00000000-0000-4000-8000-000000920040', 'Community Management',                'marketing'),
  ('00000000-0000-4000-8000-000000920041', 'Content Calendar Planning',           'marketing'),
  ('00000000-0000-4000-8000-000000920042', 'Influencer Outreach',                 'marketing'),

  -- Finance & Bookkeeping -----------------------------------------
  ('00000000-0000-4000-8000-000000920043', 'Accounts Payable',                    'finance'),
  ('00000000-0000-4000-8000-000000920044', 'Accounts Receivable',                 'finance'),
  ('00000000-0000-4000-8000-000000920045', 'Invoicing',                           'finance'),
  ('00000000-0000-4000-8000-000000920046', 'Payroll Processing',                  'finance'),
  ('00000000-0000-4000-8000-000000920047', 'Expense Management',                  'finance'),
  ('00000000-0000-4000-8000-000000920048', 'Financial Reporting',                 'finance'),
  ('00000000-0000-4000-8000-000000920049', 'Budget Management',                   'finance'),
  ('00000000-0000-4000-8000-000000920050', 'Bank Reconciliation',                 'finance'),

  -- Administrative & Executive Support ----------------------------
  ('00000000-0000-4000-8000-000000920051', 'Travel Coordination',                 'administrative'),
  ('00000000-0000-4000-8000-000000920052', 'Expense Reporting',                   'administrative'),
  ('00000000-0000-4000-8000-000000920053', 'Meeting Minutes & Notes',             'administrative'),
  ('00000000-0000-4000-8000-000000920054', 'Data Entry',                          'administrative'),
  ('00000000-0000-4000-8000-000000920055', 'Document Preparation',                'administrative'),
  ('00000000-0000-4000-8000-000000920056', 'Executive Support',                   'administrative'),
  ('00000000-0000-4000-8000-000000920057', 'File & Records Management',           'administrative'),
  ('00000000-0000-4000-8000-000000920058', 'Event Coordination',                  'administrative'),

  -- Operations ----------------------------------------------------
  ('00000000-0000-4000-8000-000000920059', 'Process Improvement',                 'operations'),
  ('00000000-0000-4000-8000-000000920060', 'Vendor Management',                   'operations'),
  ('00000000-0000-4000-8000-000000920061', 'Quality Assurance',                   'operations'),
  ('00000000-0000-4000-8000-000000920062', 'Resource Planning',                   'operations'),
  ('00000000-0000-4000-8000-000000920063', 'Workflow Design',                     'operations'),
  ('00000000-0000-4000-8000-000000920064', 'Inventory Management',                'operations'),
  ('00000000-0000-4000-8000-000000920065', 'Task Prioritization',                 'operations'),

  -- Client Experience ---------------------------------------------
  ('00000000-0000-4000-8000-000000920066', 'Client Onboarding',                   'client_experience'),
  ('00000000-0000-4000-8000-000000920067', 'Account Management',                  'client_experience'),
  ('00000000-0000-4000-8000-000000920068', 'Client Retention',                    'client_experience'),
  ('00000000-0000-4000-8000-000000920069', 'Escalation Handling',                 'client_experience'),
  ('00000000-0000-4000-8000-000000920070', 'Live Chat Support',                   'client_experience'),
  ('00000000-0000-4000-8000-000000920071', 'Customer Success',                    'client_experience'),
  ('00000000-0000-4000-8000-000000920072', 'Relationship Building',               'client_experience'),

  -- Analytics & Reporting -----------------------------------------
  ('00000000-0000-4000-8000-000000920073', 'Reporting & Dashboards',              'analytical'),
  ('00000000-0000-4000-8000-000000920074', 'KPI Tracking',                        'analytical'),
  ('00000000-0000-4000-8000-000000920075', 'Market Research',                     'analytical'),
  ('00000000-0000-4000-8000-000000920076', 'Data Visualization',                  'analytical'),
  ('00000000-0000-4000-8000-000000920077', 'Forecasting',                         'analytical'),
  ('00000000-0000-4000-8000-000000920078', 'Competitive Analysis',                'analytical'),

  -- Leadership ----------------------------------------------------
  ('00000000-0000-4000-8000-000000920079', 'Team Leadership',                     'leadership'),
  ('00000000-0000-4000-8000-000000920080', 'People Management',                   'leadership'),
  ('00000000-0000-4000-8000-000000920081', 'Coaching & Mentoring',                'leadership'),
  ('00000000-0000-4000-8000-000000920082', 'Delegation',                          'leadership'),
  ('00000000-0000-4000-8000-000000920083', 'Hiring & Interviewing',               'leadership'),
  ('00000000-0000-4000-8000-000000920084', 'Onboarding & Training',               'leadership'),
  ('00000000-0000-4000-8000-000000920085', 'Performance Management',              'leadership'),
  ('00000000-0000-4000-8000-000000920086', 'Conflict Resolution',                 'leadership'),
  ('00000000-0000-4000-8000-000000920087', 'Strategic Planning',                  'leadership'),
  ('00000000-0000-4000-8000-000000920088', 'Change Management',                   'leadership'),
  ('00000000-0000-4000-8000-000000920089', 'Remote Team Management',              'leadership'),
  ('00000000-0000-4000-8000-000000920090', 'Meeting Facilitation',                'leadership')
on conflict do nothing;
