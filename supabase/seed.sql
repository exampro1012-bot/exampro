-- =============================================================================
-- ExamPro — Seed data (reference / master data only)
-- No fabricated analytics. Bulk question import is handled by the import
-- pipeline, not here. All rows are FK-safe and tenant-independent.
-- =============================================================================

-- Question types (§26)
insert into question_types (code, name, description) values
  ('MCQ_SINGLE','MCQ (Single Correct)','Exactly one correct option'),
  ('MCQ_MULTIPLE','MCQ (Multiple Correct)','One or more correct options'),
  ('NUMERICAL','Numerical','Numeric answer'),
  ('INTEGER','Integer','Integer answer'),
  ('ASSERTION_REASON','Assertion & Reason','Assertion + reason'),
  ('STATEMENT','Statement Based','Statement based'),
  ('MATCHING','Match the Following','Match columns'),
  ('MATRIX','Matrix','Matrix type'),
  ('CASE_STUDY','Case Study','Case study based'),
  ('COMPREHENSION','Comprehension','Comprehension passage'),
  ('DIAGRAM','Diagram Based','Diagram based'),
  ('IMAGE','Image Based','Image based'),
  ('TRUE_FALSE','True / False','True/false'),
  ('CUSTOM','Custom','Custom type')
on conflict (code) do nothing;

-- Roles (§15)
insert into roles (code, name, description) values
  ('SUPER_ADMIN','Super Admin','Platform-wide control'),
  ('PLATFORM_ADMIN','Platform Admin','Platform operations'),
  ('INSTITUTION_ADMIN','Institution Admin','Manages one institution/tenant'),
  ('ACADEMIC_ADMIN','Academic Admin','Academic oversight'),
  ('TEACHER','Teacher','Creates content, assigns work'),
  ('SUBJECT_TEACHER','Subject Teacher','Per-subject teacher'),
  ('PAPER_SETTER','Paper Setter','Generates papers'),
  ('REVIEWER','Reviewer','Reviews questions'),
  ('STUDENT','Student','Learns and practices'),
  ('PARENT','Parent','Views ward progress'),
  ('FINANCE','Finance','Billing & invoices'),
  ('SALES','Sales','Leads & conversions'),
  ('SUPPORT','Support','Helpdesk'),
  ('DATA_OPERATOR','Data Operator','Imports/manages data')
on conflict (code) do nothing;

-- Permissions (§16)
insert into permissions (code, name) values
  ('questions.read','Read questions'),
  ('questions.create','Create questions'),
  ('questions.update','Update questions'),
  ('questions.delete','Delete questions'),
  ('questions.review','Review questions'),
  ('papers.read','Read papers'),
  ('papers.create','Create papers'),
  ('papers.generate','Generate papers'),
  ('papers.update','Update papers'),
  ('papers.publish','Publish papers'),
  ('papers.delete','Delete papers'),
  ('dpp.read','Read DPP'),
  ('dpp.create','Create DPP'),
  ('dpp.assign','Assign DPP'),
  ('students.read','Read students'),
  ('students.create','Create students'),
  ('students.update','Update students'),
  ('students.delete','Delete students'),
  ('teachers.read','Read teachers'),
  ('teachers.create','Create teachers'),
  ('teachers.update','Update teachers'),
  ('teachers.delete','Delete teachers'),
  ('reports.read','Read reports'),
  ('reports.export','Export reports'),
  ('finance.read','Read finance'),
  ('payments.read','Read payments'),
  ('invoices.create','Create invoices'),
  ('gst.read','Read GST'),
  ('admin.manage_users','Manage users'),
  ('admin.manage_roles','Manage roles'),
  ('admin.manage_tenants','Manage tenants')
on conflict (code) do nothing;

-- Role -> permission grants.
-- SUPER_ADMIN and all staff roles get full access; STUDENT/PARENT are read-only.
insert into role_permissions (role_id, permission_code)
select r.id, p.code
from roles r cross join permissions p
where r.code <> 'STUDENT' and r.code <> 'PARENT'
   or (r.code in ('STUDENT','PARENT') and p.code like '%.read')
on conflict (role_id, permission_code) do nothing;

-- Plans (free by default) (§99)
insert into plans (name, price_monthly, price_yearly, features) values
  ('Free',0,0,'{"papers":5,"mock":true,"dpp":true,"ai":false}'::jsonb),
  ('Teacher',0,0,'{"papers":50,"mock":true,"dpp":true,"ai":false}'::jsonb),
  ('Pro',499,4990,'{"papers":500,"mock":true,"dpp":true,"ai":true}'::jsonb),
  ('Institute',1999,19990,'{"papers":5000,"mock":true,"dpp":true,"ai":true,"branding":true}'::jsonb),
  ('Enterprise',9999,99990,'{"papers":-1,"mock":true,"dpp":true,"ai":true,"branding":true,"sso":true}'::jsonb)
on conflict do nothing;

-- System config (free quotas + flags)
insert into system_config (key, value) values
  ('free_quota', '{"PAPERS_GENERATED":5,"MOCKS_TAKEN":100,"DPP_GENERATED":100,"IMPORT_ROWS":5000}'::jsonb),
  ('app_version', '"1.0.0"'),
  ('question_target', '250000')
on conflict (key) do nothing;
