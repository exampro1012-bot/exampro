-- =============================================================================
-- ExamPro — Source documents + storage object type (Migration 0024)
-- Completes schema gaps left by earlier Drive migrations.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. source_documents table
-- ----------------------------------------------------------------------------
create table if not exists source_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  exam_id uuid references exams(id) on delete set null,
  year int,
  session text,
  shift text,
  title text not null,
  source_url text,
  drive_file_id text not null unique,
  sha256 text,
  page_count int default 0,
  language text not null default 'EN',
  status text not null default 'INGESTED',       -- INGESTED | PARSING | PARSED | VERIFIED | REJECTED
  parser_version text,
  ocr_version text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists source_documents_exam_idx on source_documents (exam_id);
create index if not exists source_documents_year_idx on source_documents (year);
create index if not exists source_documents_status_idx on source_documents (status);
create index if not exists source_documents_drive_file_idx on source_documents (drive_file_id);

-- storage_objects.source_document_id FK was intentionally added without the
-- reference in 0021 (table did not exist yet); wire it up now that it does.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'storage_objects_source_document_id_fkey'
      and conrelid = 'storage_objects'::regclass
  ) then
    alter table storage_objects
      add constraint storage_objects_source_document_id_fkey
      foreign key (source_document_id) references source_documents(id) on delete set null;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. storage_objects.object_type
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='storage_objects' and column_name='object_type') then
    alter table storage_objects add column object_type text;
  end if;
end $$;

create index if not exists storage_objects_object_type_idx on storage_objects (object_type) where object_type is not null and is_deleted = false;

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------
alter table source_documents enable row level security;

drop policy if exists source_documents_admin on source_documents;
create policy source_documents_admin on source_documents
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists source_documents_read on source_documents;
create policy source_documents_read on source_documents
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

-- ----------------------------------------------------------------------------
-- 4. Seed sample source document types
-- ----------------------------------------------------------------------------
insert into source_documents (tenant_id, exam_id, year, session, shift, title, source_url, drive_file_id, sha256, status)
select null, null, 2024, null, null, 'JEE Main 2024 Session 1 Shift 2', null, 'sample-jee-main-2024-s1-sh2', 'samplehash1', 'INGESTED'
where not exists (select 1 from source_documents where drive_file_id = 'sample-jee-main-2024-s1-sh2');

insert into source_documents (tenant_id, exam_id, year, session, shift, title, source_url, drive_file_id, sha256, status)
select null, null, 2024, null, null, 'NEET 2024 Official Paper', null, 'sample-neet-2024', 'samplehash2', 'INGESTED'
where not exists (select 1 from source_documents where drive_file_id = 'sample-neet-2024');
