-- =============================================================================
-- ExamPro — Google Drive storage metadata (Migration 0021)
-- Replaces R2-centric storage_objects with provider-agnostic schema.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. storage_folders — tracks ExamPro-managed Drive folder hierarchy
-- ----------------------------------------------------------------------------
create table if not exists storage_folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  provider text not null default 'GOOGLE_DRIVE',
  folder_type text not null,
  drive_folder_id text not null unique,
  parent_folder_id uuid references storage_folders(id) on delete set null,
  name text not null,
  path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider, folder_type)
);

-- ----------------------------------------------------------------------------
-- 2. Enhance storage_objects for Google Drive
-- ----------------------------------------------------------------------------
alter table storage_objects
  drop constraint if exists storage_objects_bucket_object_key_key;

alter table storage_objects
  add column if not exists provider text not null default 'GOOGLE_DRIVE',
  add column if not exists drive_file_id text,
  add column if not exists drive_parent_id text,
  add column if not exists object_key text,
  add column if not exists original_filename text,
  add column if not exists sha256 text,
  add column if not exists question_id uuid references questions(id) on delete set null,
  add column if not exists paper_id uuid references papers(id) on delete set null,
  add column if not exists source_document_id uuid,
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists web_view_link text,
  add column if not exists checksum text;

-- Make bucket optional for Drive (provider replaces bucket concept)
alter table storage_objects
  alter column bucket drop default;
alter table storage_objects
  alter column bucket drop not null;

-- Unique constraint: one Drive file per object key per tenant
drop index if exists storage_objects_drive_file_idx;
create unique index if not exists storage_objects_drive_file_idx
  on storage_objects (drive_file_id)
  where drive_file_id is not null and is_deleted = false;

drop index if exists storage_objects_key_idx;
create index if not exists storage_objects_key_idx
  on storage_objects (tenant_id, provider, object_key)
  where is_deleted = false;

drop index if exists storage_objects_question_idx;
create index if not exists storage_objects_question_idx
  on storage_objects (question_id)
  where question_id is not null and is_deleted = false;

drop index if exists storage_objects_paper_idx;
create index if not exists storage_objects_paper_idx
  on storage_objects (paper_id)
  where paper_id is not null and is_deleted = false;

drop index if exists storage_objects_source_doc_idx;
create index if not exists storage_objects_source_document_idx
  on storage_objects (source_document_id)
  where source_document_id is not null and is_deleted = false;

drop index if exists storage_objects_sha256_idx;
create index if not exists storage_objects_sha256_idx
  on storage_objects (sha256)
  where sha256 is not null and is_deleted = false;

-- ----------------------------------------------------------------------------
-- 3. Storage folder types enum
-- ----------------------------------------------------------------------------
do $$ begin
  create type storage_folder_type as enum (
    'ROOT',
    'SOURCE_DOCUMENTS',
    'QUESTION_ASSETS',
    'SOLUTION_ASSETS',
    'DIAGRAMS',
    'INSTITUTION_ASSETS',
    'GENERATED_PAPERS',
    'ANSWER_KEYS',
    'GENERATED_SOLUTIONS',
    'OMR',
    'REPORTS',
    'IMPORTS',
    'ARCHIVES'
  );
exception when duplicate_object then null;
end $$;

alter table storage_folders
  alter column folder_type type storage_folder_type
  using folder_type::storage_folder_type;

-- ----------------------------------------------------------------------------
-- 4. Seed root folder for ExamPro (if not exists)
-- ----------------------------------------------------------------------------
insert into storage_folders (tenant_id, provider, folder_type, drive_folder_id, name, path)
select null, 'GOOGLE_DRIVE', 'ROOT', 'exampro-root', 'ExamPro', 'ExamPro'
where not exists (
  select 1 from storage_folders where folder_type = 'ROOT' and provider = 'GOOGLE_DRIVE'
);

-- ----------------------------------------------------------------------------
-- 5. RLS policies
-- ----------------------------------------------------------------------------
alter table storage_folders enable row level security;
alter table storage_objects enable row level security;

drop policy if exists storage_folders_admin on storage_folders;
create policy storage_folders_admin on storage_folders
  for all to authenticated
  using (app_is_platform_admin())
  with check (app_is_platform_admin());

drop policy if exists storage_folders_read on storage_folders;
create policy storage_folders_read on storage_folders
  for select to authenticated
  using (true);

drop policy if exists storage_objects_admin on storage_objects;
create policy storage_objects_admin on storage_objects
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists storage_objects_read on storage_objects;
create policy storage_objects_read on storage_objects
  for select to authenticated
  using (
    app_is_platform_admin()
    or tenant_id = app_current_tenant_id()
    or exists (
      select 1 from questions q
      where q.id = storage_objects.question_id
        and q.verification_status = 'VERIFIED'
        and q.is_deleted = false
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Update app_system_health to include Drive stats
-- ----------------------------------------------------------------------------
create or replace function app_system_health()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_is_platform_admin() then (
    select jsonb_build_object(
      'auth_users', (select count(*) from auth.users),
      'tenants', (select count(*) from tenants),
      'questions', (select count(*) from questions where is_deleted = false),
      'papers', (select count(*) from papers),
      'dpps', (select count(*) from dpps),
      'results', (select count(*) from results),
      'exam_sessions', (select count(*) from exam_sessions),
      'responses', (select count(*) from responses),
      'omr_sheets', (select count(*) from omr_sheets),
      'students_roster', (select count(*) from students where is_deleted = false),
      'teachers', (select count(*) from teachers),
      'import_jobs', (select count(*) from import_jobs),
      'notifications', (select count(*) from notifications),
      'storage_objects', (select count(*) from storage_objects where is_deleted = false),
      'storage_folders', (select count(*) from storage_folders),
      'audit_logs', (select count(*) from audit_logs),
      'security_events', (select count(*) from security_events),
      'usage_rows', (select count(*) from usage),
      'active_sessions_24h', (select count(*) from exam_sessions where started_at > now() - interval '24 hours'),
      'subscriptions_trial', (select count(*) from subscriptions where status = 'TRIAL'),
      'subscriptions_active', (select count(*) from subscriptions where status = 'ACTIVE'),
      'checked_at', now()
    )
  ) else jsonb_build_object('error', 'forbidden') end;
$$;
