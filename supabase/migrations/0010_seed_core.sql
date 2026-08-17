-- =============================================================================
-- ExamPro — Core reference data seed (Migration 0009)
-- question_types, roles, permissions, role_permissions, plans, system_config.
-- Idempotent. This is the minimum reference data required for the application
-- to function (question creation, RBAC, quota, billing tiers).
-- NOTE: topics are intentionally NOT bulk-seeded — they are created through the
-- syllabus manager by institutions/teachers (no fabricated taxonomy data).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Question types (codes match exam_patterns.sections.question_type_codes)
-- ----------------------------------------------------------------------------
insert into question_types (code, name, description, is_active) values
  ('MCQ_SINGLE',   'Single Correct MCQ',    'One correct option among A/B/C/D', true),
  ('MCQ_MULTIPLE', 'Multiple Correct',      'Two or more correct options', true),
  ('NUMERICAL',    'Numerical Answer',      'Free numeric answer (no options)', true),
  ('INTEGER',      'Integer Answer',        'Integer value answer', true),
  ('ASSERTION_REASON','Assertion & Reason', 'Assertion + reason pairing', true),
  ('STATEMENT',    'Statement Based',       'Statement based MCQ', true),
  ('MATCH_FOLLOWING','Match the Following', 'Match columns', true),
  ('MATRIX',       'Matrix / Match',        'Matrix type matching', true),
  ('COMPREHENSION','Comprehension',         'Passage based questions', true),
  ('CASE_STUDY',   'Case Study',            'Case study based set', true),
  ('TRUE_FALSE',    'True / False',          'Boolean assertion', true),
  ('DIAGRAM',      'Diagram Based',         'Diagram driven question', true),
  ('IMAGE_BASED',  'Image Based',           'Image driven question', true),
  ('FILL_IN_BLANK','Fill in the Blank',     'Fill in the blank answer', true),
  ('SEQUENCING',   'Sequencing',            'Arrange in correct order', true),
  ('CUSTOM',       'Custom',                'Custom / future type', true)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Roles
-- ----------------------------------------------------------------------------
insert into roles (code, name, description) values
  ('SUPER_ADMIN',        'Super Admin',        'Global platform operator'),
  ('PLATFORM_ADMIN',     'Platform Admin',     'Platform-level administration'),
  ('INSTITUTION_ADMIN',  'Institution Admin',  'Owns an institution tenant'),
  ('ACADEMIC_ADMIN',     'Academic Admin',     'Academic operations within tenant'),
  ('TEACHER',            'Teacher',            'Creates content, papers, conducts exams'),
  ('SUBJECT_TEACHER',    'Subject Teacher',    'Teacher scoped to subjects'),
  ('PAPER_SETTER',       'Paper Setter',       'Generates and sets papers'),
  ('REVIEWER',           'Reviewer',           'Reviews/verifies questions'),
  ('STUDENT',            'Student',            'Takes tests, practices, views results'),
  ('PARENT',             'Parent',             'Views ward progress'),
  ('FINANCE',            'Finance',            'Billing, invoices, GST'),
  ('SALES',              'Sales',              'Leads, subscriptions, renewals'),
  ('SUPPORT',            'Support',            'User/tenant support'),
  ('DATA_OPERATOR',      'Data Operator',      'Bulk question import/operations')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Permissions
-- ----------------------------------------------------------------------------
insert into permissions (code, name) values
  ('questions.view',    'View questions'),
  ('questions.create',  'Create questions'),
  ('questions.edit',    'Edit questions'),
  ('questions.delete',  'Delete questions'),
  ('questions.review',  'Review/verify questions'),
  ('questions.import',  'Bulk import questions'),
  ('papers.generate',  'Generate papers'),
  ('papers.view',      'View papers'),
  ('papers.edit',      'Edit papers'),
  ('papers.publish',   'Publish papers'),
  ('papers.lock',      'Lock papers'),
  ('dpp.generate',     'Generate DPPs'),
  ('dpp.view',         'View DPPs'),
  ('dpp.assign',       'Assign DPPs'),
  ('exams.create',     'Create exams'),
  ('exams.assign',     'Assign exams'),
  ('exams.conduct',    'Conduct exams'),
  ('exams.view',       'View exams'),
  ('students.view',    'View students'),
  ('students.manage',  'Manage students'),
  ('teachers.view',    'View teachers'),
  ('teachers.manage',  'Manage teachers'),
  ('batches.manage',   'Manage batches'),
  ('branches.manage',  'Manage branches'),
  ('institutions.manage','Manage institutions'),
  ('tenants.manage',   'Manage tenants'),
  ('users.manage',     'Manage users'),
  ('roles.manage',     'Manage roles/permissions'),
  ('analytics.view',   'View analytics'),
  ('reports.view',     'View reports'),
  ('reports.export',   'Export reports'),
  ('subscriptions.manage','Manage subscriptions'),
  ('sales.manage',     'Manage sales'),
  ('invoices.manage',  'Manage invoices'),
  ('gst.manage',       'Manage GST records'),
  ('omr.manage',       'Manage OMR'),
  ('audit.view',       'View audit logs'),
  ('security.view',    'View security events'),
  ('system.config',    'Edit system config'),
  ('system.health',    'View system health'),
  ('branding.manage',  'Manage institution branding'),
  ('notifications.manage','Manage notifications')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Role -> permission mapping
-- ----------------------------------------------------------------------------
create table if not exists _rp_stage (role text, perms text[]);
truncate _rp_stage;
insert into _rp_stage values
  ('SUPER_ADMIN', array(select code from permissions)),
  ('PLATFORM_ADMIN', array['tenants.manage','users.manage','questions.view','questions.edit','questions.review','questions.import',
     'analytics.view','reports.view','reports.export','audit.view','security.view','system.config','system.health',
     'subscriptions.manage','sales.manage','invoices.manage','gst.manage','papers.view','dpp.view','exams.view','omr.manage','notifications.manage']),
  ('INSTITUTION_ADMIN', array['students.manage','students.view','teachers.manage','teachers.view','batches.manage','branches.manage',
     'institutions.manage','papers.generate','papers.view','papers.edit','papers.publish','papers.lock',
     'dpp.generate','dpp.view','dpp.assign','exams.create','exams.assign','exams.conduct','exams.view',
     'questions.view','questions.create','questions.edit','questions.import','questions.review',
     'analytics.view','reports.view','reports.export','branding.manage','notifications.manage','omr.manage']),
  ('ACADEMIC_ADMIN', array['students.view','students.manage','teachers.view','batches.manage','branches.manage',
     'papers.generate','papers.view','papers.edit','papers.publish','papers.lock','dpp.generate','dpp.view','dpp.assign',
     'exams.create','exams.assign','exams.conduct','exams.view','questions.view','questions.create','questions.edit','questions.review',
     'analytics.view','reports.view','reports.export','branding.manage','notifications.manage']),
  ('TEACHER', array['questions.view','questions.create','questions.edit','questions.import','questions.review',
     'papers.generate','papers.view','papers.edit','papers.lock','dpp.generate','dpp.view','dpp.assign',
     'exams.create','exams.assign','exams.conduct','exams.view','students.view','batches.manage',
     'analytics.view','reports.view','notifications.manage']),
  ('SUBJECT_TEACHER', array['questions.view','questions.create','questions.edit',
     'papers.generate','papers.view','dpp.generate','dpp.view','exams.view','students.view','analytics.view']),
  ('PAPER_SETTER', array['questions.view','papers.generate','papers.view','papers.edit','papers.lock','dpp.generate','dpp.view']),
  ('REVIEWER', array['questions.view','questions.review','papers.view','dpp.view']),
  ('STUDENT', array['exams.view','papers.view','dpp.view','analytics.view','reports.view']),
  ('PARENT', array['analytics.view','reports.view']),
  ('FINANCE', array['subscriptions.manage','sales.manage','invoices.manage','gst.manage','reports.view','analytics.view']),
  ('SALES', array['sales.manage','subscriptions.manage','reports.view','analytics.view']),
  ('SUPPORT', array['users.manage','tenants.manage','students.view','teachers.view','exams.view','papers.view','dpp.view','notifications.manage']),
  ('DATA_OPERATOR', array['questions.view','questions.create','questions.edit','questions.import']);

insert into role_permissions (role_id, permission_code)
select r.id, p from _rp_stage _rp
join roles r on r.code = _rp.role
join lateral unnest(_rp.perms) as t(p) on true
join permissions perm on perm.code = t.p
on conflict (role_id, permission_code) do nothing;

drop table if exists _rp_stage;

-- ----------------------------------------------------------------------------
-- 5. Plans (billing tiers; Free is the default for every tenant)
-- ----------------------------------------------------------------------------
insert into plans (name, price_monthly, price_yearly, features, is_active) values
  ('Free',        0,    0,   '{"paper_generations_per_month":5,"dpp_per_month":10,"students":25}', true),
  ('Teacher',     499,  4990,'{"paper_generations_per_month":100,"dpp_per_month":200,"students":100}', true),
  ('Pro',         1999, 19990,'{"paper_generations_per_month":1000,"dpp_per_month":2000,"students":1000}', true),
  ('Institute',   9999, 99990,'{"paper_generations_per_month":-1,"dpp_per_month":-1,"students":-1}', true),
  ('Enterprise',  -1,  -1,  '{"paper_generations_per_month":-1,"dpp_per_month":-1,"students":-1,"custom":true}', true)
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- 6. System config (server-side quota source of truth)
-- ----------------------------------------------------------------------------
insert into system_config (key, value) values
  ('free_quota', '{"PAPERS_GENERATED":5,"DPP_GENERATED":10}'::jsonb),
  ('app_version', '"1.0.0"'::jsonb)
on conflict (key) do nothing;
