-- =============================================================================
-- ExamPro — Core schema (Migration 0001)
-- Tables are named to match the application's data layer (the app is the
-- consumer) while adding multi-tenant isolation, audit, and the production
-- modules (DPP, blueprints, storage metadata, payments/invoices, imports, etc.).
-- Idempotent: safe to re-run. For a full reset, drop schema public first.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type tenant_status as enum ('TRIAL','ACTIVE','SUSPENDED','CANCELLED');
  exception when duplicate_object then null;
end $$;
do $$ begin
  create type subscription_status as enum ('TRIAL','ACTIVE','PAST_DUE','CANCELLED');
  exception when duplicate_object then null;
end $$;
do $$ begin
  create type verification_status as enum ('PENDING_REVIEW','VERIFIED','REJECTED','NEEDS_EDIT');
  exception when duplicate_object then null;
end $$;
do $$ begin
  create type question_difficulty as enum ('EASY','MEDIUM','HARD');
  exception when duplicate_object then null;
end $$;
do $$ begin
  create type assignment_status as enum ('ACTIVE','INVITED','SUSPENDED','ASSIGNED','IN_PROGRESS','DONE','OVERDUE');
  exception when duplicate_object then null;
end $$;
do $$ begin
  create type import_job_status as enum ('PENDING','PROCESSING','DONE','FAILED');
  exception when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- Multi-tenancy / identity
-- ----------------------------------------------------------------------------
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  country text default 'India',
  website text,
  gstin text,
  status tenant_status not null default 'TRIAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_code text not null references permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table if not exists tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role_id uuid not null references roles(id),
  status assignment_status not null default 'ACTIVE',
  invited_email text,
  joined_at timestamptz,
  created_at timestamptz not null default now()
);

-- Platform administrators (ExamPro operators). Distinct from per-tenant
-- SUPER_ADMIN. Gate global catalog mutation / cross-tenant admin on this, never
-- on per-tenant SUPER_ADMIN (which every institution owner holds).
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Billing (optional SaaS module; free core unaffected)
-- ----------------------------------------------------------------------------
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_monthly numeric(10,2) not null default 0,
  price_yearly numeric(10,2) not null default 0,
  features jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan_id uuid references plans(id),
  status subscription_status not null default 'TRIAL',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists usage (
  tenant_id uuid not null references tenants(id) on delete cascade,
  metric text not null,
  period text not null,            -- e.g. '2026-08'
  count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, metric, period)
);

-- ----------------------------------------------------------------------------
-- Academic taxonomy
-- ----------------------------------------------------------------------------
create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  code text,
  exam_type text,
  is_active boolean not null default true,
  display_order int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  name text not null,
  code text,
  display_order int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  name text not null,
  code text,
  display_order int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  chapter_id uuid not null references chapters(id) on delete cascade,
  name text not null,
  code text,
  display_order int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subtopics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  name text not null,
  code text,
  display_order int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists question_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true
);

-- ----------------------------------------------------------------------------
-- Questions + supporting data
-- ----------------------------------------------------------------------------
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  exam_id uuid references exams(id) on delete set null,
  subject_id uuid references subjects(id) on delete set null,
  chapter_id uuid references chapters(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  subtopic_id uuid references subtopics(id) on delete set null,
  question_type_id uuid references question_types(id),
  question_text text not null,
  year int,
  difficulty question_difficulty,
  source text,
  verification_status verification_status not null default 'PENDING_REVIEW',
  verified_by uuid references auth.users(id),
  is_deleted boolean not null default false,
  image_object_key text,
  content_object_key text,
  fingerprint text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists question_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  option_key text not null,
  option_text text not null,
  is_correct boolean not null default false,
  display_order int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists question_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  correct_option_keys text[] not null default '{}',
  explanation text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists solutions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  solution_text text,
  concept text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists question_images (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  image_url text,
  image_type text,
  display_order int,
  created_at timestamptz not null default now()
);

create table if not exists practice_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  question_id uuid references questions(id) on delete cascade,
  correct boolean,
  time_spent int,
  confidence text,
  created_at timestamptz not null default now()
);

create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  question_id uuid references questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, question_id)
);

create table if not exists question_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid references questions(id) on delete cascade,
  reporter_id uuid references auth.users(id),
  report_type text,
  detail text,
  status text not null default 'OPEN',
  created_at timestamptz not null default now()
);

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'GENERIC',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists question_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  tagged_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (question_id, tag_id)
);

-- ----------------------------------------------------------------------------
-- Test / exam engine
-- ----------------------------------------------------------------------------
create table if not exists papers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  exam_id uuid references exams(id) on delete set null,
  title text not null,
  description text,
  duration_minutes int,
  total_marks numeric(10,2),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists paper_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  question_order int not null,
  marks numeric(10,2) not null default 4,
  negative_marks numeric(10,2) not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists exam_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  paper_id uuid references papers(id) on delete set null,
  student_id uuid,
  status text not null default 'IN_PROGRESS',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  exam_session_id uuid not null references exam_sessions(id) on delete cascade,
  question_id uuid references questions(id) on delete cascade,
  selected_options text[],
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  exam_session_id uuid references exam_sessions(id) on delete set null,
  student_id uuid,
  paper_id uuid references papers(id) on delete set null,
  total_marks numeric(10,2),
  marks numeric(10,2),
  accuracy numeric(5,2),
  percentage numeric(5,2),
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Students roster (distinct from auth users)
-- ----------------------------------------------------------------------------
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  full_name text not null,
  roll_number text,
  email text,
  phone text,
  class_level text,
  status text not null default 'ACTIVE',
  is_deleted boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists student_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists student_group_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  student_group_id uuid not null references student_groups(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- DPP (Daily Practice Problems)
-- ----------------------------------------------------------------------------
create table if not exists dpps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  description text,
  exam_id uuid references exams(id) on delete set null,
  subject_id uuid references subjects(id) on delete set null,
  chapter_id uuid references chapters(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  target_date date,
  status text not null default 'DRAFT',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dpp_questions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  dpp_id uuid not null references dpps(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  question_order int,
  created_at timestamptz not null default now()
);

create table if not exists dpp_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  dpp_id uuid not null references dpps(id) on delete cascade,
  assignee_type text not null,
  assignee_id uuid not null,
  assigned_by uuid references auth.users(id),
  due_date timestamptz,
  status assignment_status not null default 'ASSIGNED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Exam blueprint rules
-- ----------------------------------------------------------------------------
create table if not exists blueprint_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  exam_id uuid references exams(id) on delete cascade,
  subject_id uuid references subjects(id) on delete cascade,
  chapter_id uuid references chapters(id) on delete cascade,
  topics_count int,
  total_questions int,
  marks_per_question numeric(10,2),
  difficulty_mix jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Notifications / audit / security
-- ----------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create table if not exists security_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  detail text,
  ip_address text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Imports
-- ----------------------------------------------------------------------------
create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  filename text,
  format text not null,
  status import_job_status not null default 'PENDING',
  total int not null default 0,
  processed int not null default 0,
  imported int not null default 0,
  duplicates int not null default 0,
  failed int not null default 0,
  error_summary jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists import_job_items (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references import_jobs(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  row_index int not null,
  status text not null default 'PENDING',
  error text,
  raw jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Storage object metadata (bytes live in provider; Postgres is source of truth)
-- ----------------------------------------------------------------------------
create table if not exists storage_objects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete set null,
  bucket text not null,
  object_key text not null,
  mime_type text,
  size_bytes bigint,
  checksum text,
  created_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  unique (bucket, object_key)
);

create table if not exists question_pack_manifests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  exam_id uuid references exams(id) on delete cascade,
  subject_id uuid references subjects(id) on delete cascade,
  chapter_id uuid references chapters(id) on delete cascade,
  version text not null,
  object_key text not null,
  checksum text,
  question_count int,
  size_bytes bigint,
  status verification_status not null default 'VERIFIED',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Payments / invoices (optional GST module)
-- ----------------------------------------------------------------------------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  amount numeric(10,2) not null default 0,
  currency text not null default 'INR',
  status text not null default 'PENDING',
  gateway text,
  gateway_reference text,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_no text not null unique default 'INV-' || substring(replace(gen_random_uuid()::text,'-',''),1,8),
  customer_name text,
  amount numeric(10,2) not null default 0,
  cgst numeric(10,2) not null default 0,
  sgst numeric(10,2) not null default 0,
  igst numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  gstin text,
  status text not null default 'DRAFT',
  issued_at date not null default current_date,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- System config (kill-switch, feature flags)
-- ----------------------------------------------------------------------------
create table if not exists system_config (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- One profile per auth user (required by the bootstrap trigger's ON CONFLICT).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_auth_user_unique') then
    alter table profiles add constraint profiles_auth_user_unique unique (auth_user_id);
  end if;
end $$;
