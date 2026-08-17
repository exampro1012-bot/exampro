-- =============================================================================
-- ExamPro — Schema completion (Migration 0005)
-- Adds the tables/columns the application, edge functions, and import pipeline
-- require, plus unique constraints, indexes, and full-text search. Idempotent.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Question provenance & bank-quality tables
-- ----------------------------------------------------------------------------
create table if not exists question_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  source_type text not null default 'OFFICIAL',   -- OFFICIAL | AUTHORIZED | LICENSED | INSTITUTION | TEACHER | SAMPLE
  source_url text,
  license_status text default 'UNKNOWN',          -- UNKNOWN | PERMITTED | LICENSED
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists question_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  reviewer_id uuid references auth.users(id),
  decision verification_status,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists question_duplicates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_a_id uuid not null references questions(id) on delete cascade,
  question_b_id uuid not null references questions(id) on delete cascade,
  match_type text not null default 'HASH',
  confidence numeric(5,2),
  status text not null default 'OPEN',            -- OPEN | CONFIRMED | DISMISSED
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists question_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  used_in_type text not null,                     -- PAPER | DPP | PRACTICE | EXAM
  used_in_id uuid,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Exam patterns (scoring lives here, never hardcoded in the frontend)
-- ----------------------------------------------------------------------------
create table if not exists exam_patterns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  exam_id uuid not null references exams(id) on delete cascade,
  name text not null,
  version int not null default 1,
  is_active boolean not null default true,
  duration_minutes int not null default 180,
  total_questions int,
  total_marks numeric(10,2),
  default_marks numeric(10,2) not null default 4,
  default_negative_marks numeric(10,2) not null default 1,
  sections jsonb not null default '[]',           -- [{name, subject_id, question_type_ids[], marks, negative_marks, count}]
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, exam_id, version)
);

create table if not exists exam_pattern_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  exam_pattern_id uuid not null references exam_patterns(id) on delete cascade,
  name text not null,
  subject_id uuid references subjects(id) on delete set null,
  question_type_ids uuid[] not null default '{}',
  question_count int not null default 0,
  marks_per_question numeric(10,2) not null default 4,
  negative_marks_per_question numeric(10,2) not null default 1,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- (idempotent) ensure tenant_id exists even if the table was created earlier
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='exam_pattern_sections' and column_name='session') then
    alter table exam_pattern_sections add column session text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='exam_pattern_sections' and column_name='shift') then
    alter table exam_pattern_sections add column shift text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='exam_pattern_sections' and column_name='subtopic_id') then
    alter table exam_pattern_sections add column subtopic_id uuid references subtopics(id) on delete set null;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Columns the application / edge functions / import pipeline need
-- ----------------------------------------------------------------------------
do $$
begin
  -- questions
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='marks') then
    alter table questions add column marks numeric(10,2) not null default 4;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='negative_marks') then
    alter table questions add column negative_marks numeric(10,2) not null default 1;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='question_hash') then
    alter table questions add column question_hash text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='session') then
    alter table questions add column session text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='shift') then
    alter table questions add column shift text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='language') then
    alter table questions add column language text not null default 'EN';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_id') then
    alter table questions add column source_id uuid references question_sources(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_url') then
    alter table questions add column source_url text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_type') then
    alter table questions add column source_type text default 'OFFICIAL';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='license_status') then
    alter table questions add column license_status text default 'UNKNOWN';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='import_date') then
    alter table questions add column import_date timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='quality_score') then
    alter table questions add column quality_score numeric(5,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='question_html') then
    alter table questions add column question_html text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='search_vector') then
    alter table questions add column search_vector tsvector;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='ncert') then
    alter table questions add column ncert boolean not null default false;
  end if;

  -- papers
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='exam_pattern_id') then
    alter table papers add column exam_pattern_id uuid references exam_patterns(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='paper_code') then
    alter table papers add column paper_code text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='status') then
    alter table papers add column status text not null default 'DRAFT';  -- DRAFT | VALIDATED | LOCKED | PUBLISHED | ARCHIVED
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='total_questions') then
    alter table papers add column total_questions int;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='instructions') then
    alter table papers add column instructions text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='answer_key_json') then
    alter table papers add column answer_key_json jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tenants' and column_name='watermark_url') then
    alter table tenants add column watermark_url text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tenants' and column_name='header_text') then
    alter table tenants add column header_text text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='tenants' and column_name='footer_text') then
    alter table tenants add column footer_text text;
  end if;

  -- paper_questions: immutable snapshot once locked
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='paper_questions' and column_name='snapshot') then
    alter table paper_questions add column snapshot jsonb;
  end if;

  -- exam_sessions
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='exam_sessions' and column_name='ends_at') then
    alter table exam_sessions add column ends_at timestamptz;
  end if;

  -- results
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='results' and column_name='correct') then
    alter table results add column correct int not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='results' and column_name='incorrect') then
    alter table results add column incorrect int not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='results' and column_name='unanswered') then
    alter table results add column unanswered int not null default 0;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='results' and column_name='snapshot') then
    alter table results add column snapshot jsonb;
  end if;

  -- question_answers: numerical answers for NUMERICAL/INTEGER types
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_answers' and column_name='numerical_answer') then
    alter table question_answers add column numerical_answer text;
  end if;

  -- solutions: rich fields used by the dataset import
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='solution_type') then
    alter table solutions add column solution_type text default 'TEACHER';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='short_solution') then
    alter table solutions add column short_solution text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='detailed_solution') then
    alter table solutions add column detailed_solution text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='formula') then
    alter table solutions add column formula text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='hint') then
    alter table solutions add column hint text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='language') then
    alter table solutions add column language text default 'EN';
  end if;

  -- notifications: alias column used by edge functions
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='notifications' and column_name='user_id') then
    alter table notifications add column user_id uuid;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Unique constraints (dedup + idempotent upserts)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname='exams_code_key') then
    alter table exams add constraint exams_code_key unique (code);
  end if;
  if not exists (select 1 from pg_constraint where conname='subjects_exam_code_key') then
    alter table subjects add constraint subjects_exam_code_key unique (exam_id, code);
  end if;
  if not exists (select 1 from pg_constraint where conname='chapters_subject_code_key') then
    alter table chapters add constraint chapters_subject_code_key unique (subject_id, code);
  end if;
  if not exists (select 1 from pg_constraint where conname='topics_chapter_code_key') then
    alter table topics add constraint topics_chapter_code_key unique (chapter_id, code);
  end if;
  if not exists (select 1 from pg_constraint where conname='responses_session_question_key') then
    alter table responses add constraint responses_session_question_key unique (exam_session_id, question_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='question_options_question_key_key') then
    alter table question_options add constraint question_options_question_key_key unique (question_id, option_key);
  end if;
  if not exists (select 1 from pg_constraint where conname='question_answers_question_key') then
    alter table question_answers add constraint question_answers_question_key unique (question_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='solutions_question_key') then
    alter table solutions add constraint solutions_question_key unique (question_id);
  end if;
end $$;

-- question_hash must be unique (duplicate detection); ON CONFLICT needs a
-- plain (non-partial) unique index. Drop any legacy partial variant first.
drop index if exists questions_hash_unique_idx;
create unique index questions_hash_unique_idx on questions (question_hash);

-- ----------------------------------------------------------------------------
-- 5. Indexes for 250k+ question scale
-- ----------------------------------------------------------------------------
create index if not exists questions_exam_idx on questions (exam_id);
create index if not exists questions_subject_idx on questions (subject_id);
create index if not exists questions_chapter_idx on questions (chapter_id);
create index if not exists questions_topic_idx on questions (topic_id);
create index if not exists questions_type_idx on questions (question_type_id);
create index if not exists questions_year_idx on questions (year);
create index if not exists questions_difficulty_idx on questions (difficulty);
create index if not exists questions_verification_idx on questions (verification_status);
create index if not exists questions_tenant_idx on questions (tenant_id);
create index if not exists questions_tenant_verified_idx on questions (tenant_id, verification_status, is_deleted);
create index if not exists questions_exam_verified_idx on questions (exam_id, verification_status, is_deleted);
create index if not exists questions_subject_chapter_idx on questions (subject_id, chapter_id, verification_status, is_deleted);
create index if not exists questions_search_vector_idx on questions using gin (search_vector);
create index if not exists question_options_question_idx on question_options (question_id);
create index if not exists question_answers_question_idx on question_answers (question_id);
create index if not exists solutions_question_idx on solutions (question_id);
create index if not exists paper_questions_paper_idx on paper_questions (paper_id, question_order);
create index if not exists responses_session_idx on responses (exam_session_id);
create index if not exists results_session_idx on results (exam_session_id);
create index if not exists results_student_idx on results (student_id, created_at desc);
create index if not exists practice_logs_user_idx on practice_logs (user_id, created_at desc);
create index if not exists usage_tenant_metric_idx on usage (tenant_id, metric, period);

-- ----------------------------------------------------------------------------
-- 6. Full-text search: populate + maintain search_vector
-- ----------------------------------------------------------------------------
create or replace function questions_search_vector() returns trigger
language plpgsql as $$
begin
  new.search_vector := to_tsvector('simple', coalesce(new.question_text, '') || ' ' || coalesce(new.question_html, ''));
  return new;
end; $$;

drop trigger if exists questions_search_vector_trigger on questions;
create trigger questions_search_vector_trigger before insert or update of question_text, question_html on questions
  for each row execute function questions_search_vector();

update questions set search_vector = to_tsvector('simple', coalesce(question_text, '')) where search_vector is null;

-- ----------------------------------------------------------------------------
-- 7. OMR module
-- ----------------------------------------------------------------------------
create table if not exists omr_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  exam_id uuid references exams(id) on delete set null,
  total_questions int not null default 100,
  options_per_question int not null default 4,
  template_config jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists omr_sheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  template_id uuid references omr_templates(id) on delete set null,
  paper_id uuid references papers(id) on delete set null,
  student_id uuid,
  roll_number text,
  image_object_key text,
  status text not null default 'SCANNED',         -- SCANNED | EVALUATED | REJECTED
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists omr_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  omr_sheet_id uuid not null references omr_sheets(id) on delete cascade,
  question_no int not null,
  selected_options text[],
  evaluated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (omr_sheet_id, question_no)
);

-- ----------------------------------------------------------------------------
-- 8. Institution organisation (roster management)
-- ----------------------------------------------------------------------------
create table if not exists institutions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  code text,
  logo_object_key text,
  email text,
  phone text,
  address text,
  status text not null default 'ACTIVE',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  institution_id uuid not null references institutions(id) on delete cascade,
  name text not null,
  city text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  name text not null,
  exam_id uuid references exams(id) on delete set null,
  start_date date,
  status text not null default 'ACTIVE',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teachers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  subject_ids uuid[] not null default '{}',
  status text not null default 'ACTIVE',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists student_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (student_id, batch_id)
);

create table if not exists teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  teacher_id uuid not null references teachers(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (teacher_id, batch_id, subject_id)
);

create table if not exists student_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid references questions(id) on delete cascade,
  note_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 9. DPP templates (reusable DPP definitions)
-- ----------------------------------------------------------------------------
create table if not exists dpp_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  dpp_type text not null default 'CHAPTER',       -- DAILY | CHAPTER | TOPIC | PYQ | REVISION | WEAK_TOPIC | CUSTOM
  exam_id uuid references exams(id) on delete set null,
  subject_id uuid references subjects(id) on delete set null,
  chapter_id uuid references chapters(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  question_count int not null default 15,
  filters jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 10. Legacy artifact cleanup
-- ----------------------------------------------------------------------------
drop table if exists _trigger_err;

-- ----------------------------------------------------------------------------
-- 11. Deduplicate plans (the original seed had no unique constraint) + protect
-- ----------------------------------------------------------------------------
delete from plans a using plans b
  where a.name = b.name and a.created_at > b.created_at;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='plans_name_key') then
    alter table plans add constraint plans_name_key unique (name);
  end if;
end $$;

-- subscriptions could also have duplicates from repeated seeding; keep one per tenant.
delete from subscriptions a using subscriptions b
  where a.tenant_id = b.tenant_id and a.created_at > b.created_at;