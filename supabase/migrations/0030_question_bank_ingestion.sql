-- =============================================================================
-- ExamPro — Question Bank ingestion engine (Migration 0030)
--
-- Adds the production question-bank ingestion pipeline on top of the existing
-- schema:
--   * questions  : provenance + classification + confidence + visibility cols
--   * question_options / question_answers / solutions : html/latex + confidence
--   * question_assets  : cropped/compressed/deduped diagrams (Drive canonical)
--   * question_shards  : gzipped JSONL shard manifests (Drive canonical)
--   * question_index   : lightweight searchable index (Supabase = index, Drive = data)
--   * ingestion_jobs / ingestion_pages : resumable, page-failure-tolerant jobs
--   * source_documents : full provenance fields (book, publisher, edition)
--   * RPCs: app_import_questions_v2, app_get_eligible_questions,
--           app_ingestion_job_*, app_shard_register, app_question_index_resync,
--           app_match_answer_key, app_storage_dashboard, app_question_corpus_stats
--   * app_generate_paper / app_generate_dpp extended with is_pyq + ncert filters
--   * app_question_snapshot extended with question_assets
--
-- Every statement is idempotent and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. questions — provenance / classification / confidence / visibility
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='question_number') then
    alter table questions add column question_number int;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='question_text_latex') then
    alter table questions add column question_text_latex text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='content_hash') then
    alter table questions add column content_hash text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='is_pyq') then
    alter table questions add column is_pyq boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='pipeline_status') then
    alter table questions add column pipeline_status text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='question_visibility') then
    alter table questions add column question_visibility text not null default 'TENANT'; -- GLOBAL | TENANT | PRIVATE
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_document_id') then
    alter table questions add column source_document_id uuid references source_documents(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_page_start') then
    alter table questions add column source_page_start int;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_page_end') then
    alter table questions add column source_page_end int;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_question_number') then
    alter table questions add column source_question_number text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_book') then
    alter table questions add column source_book text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_publisher') then
    alter table questions add column source_publisher text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='source_edition') then
    alter table questions add column source_edition text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='import_batch') then
    alter table questions add column import_batch text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='solution_status') then
    alter table questions add column solution_status text not null default 'NOT_AVAILABLE'; -- AVAILABLE | NOT_AVAILABLE | PENDING_REVIEW
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='parse_confidence') then
    alter table questions add column parse_confidence numeric(5,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='subject_confidence') then
    alter table questions add column subject_confidence numeric(5,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='chapter_confidence') then
    alter table questions add column chapter_confidence numeric(5,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='topic_confidence') then
    alter table questions add column topic_confidence numeric(5,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='questions' and column_name='answer_confidence') then
    alter table questions add column answer_confidence numeric(5,2);
  end if;
end $$;

comment on column questions.pipeline_status is
  'Ingestion lifecycle: IMPORTED|PARSED|REVIEW_REQUIRED|SOURCE_VERIFIED|ANSWER_VERIFIED|EXPERT_VERIFIED|PUBLISHED|REJECTED|CONFLICT (mirrors verification_status for reporting; engine reads verification_status)';
comment on column questions.question_visibility is 'GLOBAL (platform-shared) | TENANT (own workspace) | PRIVATE (creator only)';
comment on column questions.solution_status is 'AVAILABLE | NOT_AVAILABLE | PENDING_REVIEW';
comment on column questions.is_pyq is 'Previous-Year Question flag (used by paper/DPP PYQ filters)';

-- provenance + dedup indexes
create index if not exists questions_source_document_idx on questions (source_document_id) where source_document_id is not null and is_deleted = false;
create index if not exists questions_is_pyq_idx on questions (tenant_id, is_pyq) where is_deleted = false;
create index if not exists questions_pipeline_status_idx on questions (pipeline_status) where pipeline_status is not null and is_deleted = false;
create index if not exists questions_year_idx on questions (tenant_id, year) where is_deleted = false;
create index if not exists questions_session_shift_idx on questions (tenant_id, session, shift) where is_deleted = false;
create unique index if not exists questions_content_hash_idx on questions (tenant_id, content_hash) where content_hash is not null and is_deleted = false;

-- ---------------------------------------------------------------------------
-- 2. options / answers / solutions — rich representation + confidence
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_options' and column_name='option_html') then
    alter table question_options add column option_html text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_options' and column_name='option_latex') then
    alter table question_options add column option_latex text;
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_answers' and column_name='answer_type') then
    alter table question_answers add column answer_type text not null default 'MCQ'; -- MCQ | MULTIPLE | INTEGER | NUMERICAL | TEXT | MATCHING | ASSERTION_REASON
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_answers' and column_name='numeric_value') then
    alter table question_answers add column numeric_value numeric;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_answers' and column_name='numeric_tolerance') then
    alter table question_answers add column numeric_tolerance numeric;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_answers' and column_name='answer_text') then
    alter table question_answers add column answer_text text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_answers' and column_name='source') then
    alter table question_answers add column source text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_answers' and column_name='confidence') then
    alter table question_answers add column confidence numeric(5,2);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_answers' and column_name='verification_status') then
    alter table question_answers add column verification_status text not null default 'PENDING_REVIEW';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='solution_html') then
    alter table solutions add column solution_html text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='solution_latex') then
    alter table solutions add column solution_latex text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='solution_method') then
    alter table solutions add column solution_method text; -- STEPWISE | CONCEPTUAL | SHORTCUT | FULL
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='source') then
    alter table solutions add column source text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='verification_status') then
    alter table solutions add column verification_status text not null default 'PENDING_REVIEW';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. source_documents — full provenance
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='book_name') then
    alter table source_documents add column book_name text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='publisher') then
    alter table source_documents add column publisher text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='edition') then
    alter table source_documents add column edition text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='original_filename') then
    alter table source_documents add column original_filename text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='mime_type') then
    alter table source_documents add column mime_type text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='file_size_bytes') then
    alter table source_documents add column file_size_bytes bigint;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='kind') then
    alter table source_documents add column kind text not null default 'QUESTION_BOOK'; -- QUESTION_BOOK | ANSWER_KEY | SOLUTION_BOOK | IMAGE_BATCH | DATA_FILE
  end if;
end $$;

create index if not exists source_documents_kind_idx on source_documents (kind) where kind is not null;

-- ---------------------------------------------------------------------------
-- 4. question_assets — cropped, compressed, deduplicated diagrams
--    (Supabase = metadata; Google Drive = canonical bytes)
-- ---------------------------------------------------------------------------
create table if not exists question_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid references questions(id) on delete cascade,
  asset_hash text,
  perceptual_hash text,
  drive_file_id text,
  storage_object_id uuid,
  mime_type text not null default 'image/webp',
  width int,
  height int,
  file_size bigint,
  asset_type text not null default 'DIAGRAM', -- DIAGRAM | GRAPH | CHEMICAL_STRUCTURE | BIOLOGICAL_DIAGRAM | FORMULA | TABLE | OTHER_REQUIRED_VISUAL
  compression text not null default 'WEBP',    -- WEBP | PNG | SVG
  object_key text,
  display_order int not null default 1,
  is_deleted boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists question_assets_hash_idx on question_assets (asset_hash) where asset_hash is not null and is_deleted = false;
create index if not exists question_assets_question_idx on question_assets (question_id) where is_deleted = false;
create index if not exists question_assets_phash_idx on question_assets (perceptual_hash) where perceptual_hash is not null and is_deleted = false;

alter table question_assets enable row level security;

drop policy if exists question_assets_admin on question_assets;
create policy question_assets_admin on question_assets
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists question_assets_read on question_assets;
create policy question_assets_read on question_assets
  for select to authenticated
  using (
    app_is_platform_admin()
    or tenant_id = app_current_tenant_id()
    or exists (
      select 1 from questions q
      where q.id = question_assets.question_id
        and q.verification_status = 'VERIFIED' and q.is_deleted = false
    )
  );

-- ---------------------------------------------------------------------------
-- 5. question_shards — gzipped JSONL shard manifests
-- ---------------------------------------------------------------------------
create table if not exists question_shards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  exam_id uuid references exams(id) on delete set null,
  subject_id uuid references subjects(id) on delete set null,
  year_start int,
  year_end int,
  question_count int not null default 0,
  compressed_size bigint not null default 0,
  uncompressed_size bigint not null default 0,
  sha256 text,
  drive_file_id text,
  drive_folder_id text,
  format text not null default 'JSONL',
  compression text not null default 'GZIP',
  status text not null default 'UPLOADED', -- PENDING | UPLOADED | VERIFIED | FAILED
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists question_shards_exam_idx on question_shards (exam_id) where exam_id is not null;
create index if not exists question_shards_subject_idx on question_shards (subject_id) where subject_id is not null;

alter table question_shards enable row level security;

drop policy if exists question_shards_admin on question_shards;
create policy question_shards_admin on question_shards
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists question_shards_read on question_shards;
create policy question_shards_read on question_shards
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------------------
-- 6. question_index — lightweight searchable index (1 row per question)
-- ---------------------------------------------------------------------------
create table if not exists question_index (
  question_id uuid primary key references questions(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  shard_id uuid references question_shards(id) on delete set null,
  record_locator text,
  exam_id uuid references exams(id) on delete set null,
  subject_id uuid references subjects(id) on delete set null,
  chapter_id uuid references chapters(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  year int,
  session text,
  shift text,
  difficulty text,
  question_type_id uuid references question_types(id) on delete set null,
  verification_status verification_status,
  question_hash text,
  content_hash text,
  is_pyq boolean not null default false,
  has_solution boolean not null default false,
  has_answer boolean not null default false,
  has_asset boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists question_index_tenant_exam_idx on question_index (tenant_id, exam_id) where exam_id is not null;
create index if not exists question_index_subject_idx on question_index (subject_id) where subject_id is not null;
create index if not exists question_index_chapter_idx on question_index (chapter_id) where chapter_id is not null;
create index if not exists question_index_topic_idx on question_index (topic_id) where topic_id is not null;
create index if not exists question_index_year_idx on question_index (year) where year is not null;
create index if not exists question_index_status_idx on question_index (verification_status);
create index if not exists question_index_shard_idx on question_index (shard_id) where shard_id is not null;

alter table question_index enable row level security;

drop policy if exists question_index_admin on question_index;
create policy question_index_admin on question_index
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists question_index_read on question_index;
create policy question_index_read on question_index
  for select to authenticated
  using (
    app_is_platform_admin()
    or tenant_id = app_current_tenant_id()
    or exists (
      select 1 from questions q
      where q.id = question_index.question_id
        and (q.verification_status = 'VERIFIED' or q.tenant_id = '00000000-0000-0000-0000-000000000001')
        and q.is_deleted = false
    )
  );

-- ---------------------------------------------------------------------------
-- 7. ingestion_jobs / ingestion_pages — resumable, page-failure-tolerant
-- ---------------------------------------------------------------------------
create table if not exists ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  file_id uuid references source_documents(id) on delete set null,
  status text not null default 'PENDING', -- PENDING | PROCESSING | PAUSED | COMPLETED | FAILED | CANCELLED
  format text not null default 'PDF',
  metadata jsonb not null default '{}'::jsonb, -- exam/subject/year/session/shift/language/source/book/publisher/edition
  current_page int not null default 0,
  total_pages int not null default 0,
  questions_detected int not null default 0,
  questions_imported int not null default 0,
  questions_review int not null default 0,
  duplicates int not null default 0,
  failed_pages int not null default 0,
  error_summary jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ingestion_jobs_tenant_status_idx on ingestion_jobs (tenant_id, status);
create index if not exists ingestion_jobs_file_idx on ingestion_jobs (file_id) where file_id is not null;

create table if not exists ingestion_pages (
  id uuid primary key default gen_random_uuid(),
  ingestion_job_id uuid not null references ingestion_jobs(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  page_number int not null,
  status text not null default 'PENDING', -- PENDING | OK | FAILED | RETRYING
  questions_detected int not null default 0,
  questions_imported int not null default 0,
  error text,
  processed_at timestamptz,
  unique (ingestion_job_id, page_number)
);

create index if not exists ingestion_pages_job_idx on ingestion_pages (ingestion_job_id);

alter table ingestion_jobs enable row level security;
alter table ingestion_pages enable row level security;

drop policy if exists ingestion_jobs_all on ingestion_jobs;
create policy ingestion_jobs_all on ingestion_jobs
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists ingestion_pages_all on ingestion_pages;
create policy ingestion_pages_all on ingestion_pages
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

-- ---------------------------------------------------------------------------
-- 8. Missing question types (idempotent)
-- ---------------------------------------------------------------------------
insert into question_types (code, name, description, is_active) values
  ('PASSAGE',        'Passage Based',          'Questions sharing a common passage', true),
  ('SUBJECTIVE',     'Subjective',             'Open-ended / long answer question', true),
  ('SHORT_ANSWER',   'Short Answer',           'Brief written answer', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Ingestion job lifecycle RPCs
-- ---------------------------------------------------------------------------
create or replace function app_ingestion_job_start(p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_file uuid := (p_meta->>'file_id')::uuid;
  v_job uuid;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  insert into ingestion_jobs (tenant_id, file_id, status, format, metadata,
                              total_pages, started_at, created_by)
  values (v_tenant, v_file, 'PROCESSING',
          coalesce(p_meta->>'format', 'PDF'),
          coalesce(p_meta->'metadata', '{}'::jsonb),
          coalesce((p_meta->>'total_pages')::int, 0), now(), auth.uid())
  returning id into v_job;
  return jsonb_build_object('job_id', v_job);
end; $$;

create or replace function app_ingestion_job_page(p_job_id uuid, p_page int, p_status text,
  p_questions_detected int default 0, p_questions_imported int default 0, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from ingestion_jobs where id = p_job_id;
  if v_tenant is null then
    return jsonb_build_object('error', 'job not found');
  end if;
  insert into ingestion_pages (ingestion_job_id, tenant_id, page_number, status,
                               questions_detected, questions_imported, error, processed_at)
  values (p_job_id, v_tenant, p_page, coalesce(p_status, 'OK'),
          coalesce(p_questions_detected, 0), coalesce(p_questions_imported, 0),
          p_error, now())
  on conflict (ingestion_job_id, page_number)
  do update set status = excluded.status,
                questions_detected = excluded.questions_detected,
                questions_imported = excluded.questions_imported,
                error = excluded.error,
                processed_at = now();
  update ingestion_jobs set current_page = greatest(current_page, p_page),
                            updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function app_ingestion_job_finish(p_job_id uuid, p_status text,
  p_questions_detected int default 0, p_questions_imported int default 0,
  p_questions_review int default 0, p_duplicates int default 0,
  p_errors jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_failed int;
begin
  select tenant_id into v_tenant from ingestion_jobs where id = p_job_id;
  if v_tenant is null then
    return jsonb_build_object('error', 'job not found');
  end if;
  select count(*) into v_failed from ingestion_pages where ingestion_job_id = p_job_id and status = 'FAILED';
  update ingestion_jobs set status = coalesce(p_status, 'COMPLETED'),
                            questions_detected = coalesce(p_questions_detected, 0),
                            questions_imported = coalesce(p_questions_imported, 0),
                            questions_review = coalesce(p_questions_review, 0),
                            duplicates = coalesce(p_duplicates, 0),
                            failed_pages = coalesce(v_failed, 0),
                            error_summary = coalesce(p_errors, '[]'::jsonb),
                            completed_at = now(),
                            updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('ok', true, 'failed_pages', coalesce(v_failed, 0));
end; $$;

create or replace function app_ingestion_job_retry_page(p_job_id uuid, p_page int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from ingestion_jobs where id = p_job_id;
  if v_tenant is null then
    return jsonb_build_object('error', 'job not found');
  end if;
  update ingestion_pages set status = 'RETRYING', error = null, processed_at = null
  where ingestion_job_id = p_job_id and page_number = p_page;
  update ingestion_jobs set status = 'PROCESSING', updated_at = now() where id = p_job_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ---------------------------------------------------------------------------
-- 10. app_import_questions_v2 — enhanced idempotent batch import
--     Adds provenance, confidence, PYQ/NCERT flags, visibility, solution_status.
--     Dedupe: content_hash when provided, else question_hash (canonical question,
--     multiple sources). Duplicates against the platform bank are skipped so the
--     shared bank stays canonical.
-- ---------------------------------------------------------------------------
create or replace function app_import_questions_v2(
  p_items jsonb,
  p_source_document_id uuid default null,
  p_job_id uuid default null,
  p_import_batch text default null,
  p_defaults jsonb default '{}'::jsonb,
  p_verification verification_status default 'PENDING_REVIEW'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_item jsonb;
  v_imported int := 0;
  v_duplicates int := 0;
  v_failed int := 0;
  v_review int := 0;
  v_total int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_inserted uuid[] := '{}'::uuid[];
  v_exam_id uuid;
  v_subject_id uuid;
  v_chapter_id uuid;
  v_topic_id uuid;
  v_subtopic_id uuid;
  v_type_id uuid;
  v_qid uuid;
  v_hash text;
  v_content_hash text;
  v_text text;
  v_ncert boolean;
  v_pyq boolean;
  v_perm_ok boolean;
  v_seen_hashes text[] := '{}'::text[];
  v_opt jsonb;
  v_opt_i int := 0;
  v_clean bool;
  v_mark numeric;
  v_neg numeric;
  v_conf numeric;
  v_visible text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'p_items must be a non-empty jsonb array');
  end if;

  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;

  select not app_user_has_student_only_role(v_tenant) into v_perm_ok;
  if not v_perm_ok then
    return jsonb_build_object('error', 'forbidden: question import requires a non-student role');
  end if;

  v_total := jsonb_array_length(p_items);

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_clean := true;
    begin
      v_text := coalesce(v_item->>'question_text', '');
      if length(btrim(v_text)) = 0 then
        v_errors := v_errors || jsonb_build_object('index', v_imported + v_duplicates + v_failed, 'error', 'missing question_text');
        v_failed := v_failed + 1;
        v_clean := false;
        continue;
      end if;

      v_hash := coalesce(v_item->>'question_hash', app_question_hash(v_text));
      v_content_hash := v_item->>'content_hash';

      if v_content_hash is not null and v_content_hash = any (v_seen_hashes) then
        v_duplicates := v_duplicates + 1; v_clean := false; continue;
      end if;
      if v_hash = any (v_seen_hashes) then
        v_duplicates := v_duplicates + 1; v_clean := false; continue;
      end if;
      if v_content_hash is not null then
        if exists (select 1 from questions q
                   where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
                     and q.content_hash = v_content_hash and q.is_deleted = false) then
          v_duplicates := v_duplicates + 1; v_clean := false; continue;
        end if;
      end if;
      if exists (select 1 from questions q
                 where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
                   and q.question_hash = v_hash and q.is_deleted = false
                   and (v_content_hash is null or q.content_hash is null or q.content_hash = v_content_hash)) then
        v_duplicates := v_duplicates + 1; v_clean := false; continue;
      end if;

      -- resolve / create taxonomy (codes preferred; falls back to defaults)
      v_exam_id := (p_defaults->>'exam_id')::uuid;
      if v_item->>'exam_code' is not null then
        select id into v_exam_id from exams
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'exam_code' order by (tenant_id = v_tenant) desc limit 1;
        if v_exam_id is null then
          insert into exams (tenant_id, name, code, exam_type, created_by)
          values (v_tenant, v_item->>'exam_code', v_item->>'exam_code', 'GENERIC', auth.uid())
          returning id into v_exam_id;
        end if;
      end if;

      v_subject_id := (p_defaults->>'subject_id')::uuid;
      if v_item->>'subject_code' is not null then
        select id into v_subject_id from subjects
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'subject_code'
            and (v_exam_id is null or exam_id = v_exam_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_subject_id is null then
          insert into subjects (tenant_id, exam_id, name, code, created_by)
          values (v_tenant, v_exam_id, v_item->>'subject_code', v_item->>'subject_code', auth.uid())
          returning id into v_subject_id;
        end if;
      end if;

      v_chapter_id := (p_defaults->>'chapter_id')::uuid;
      if v_item->>'chapter_code' is not null then
        select id into v_chapter_id from chapters
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'chapter_code'
            and (v_subject_id is null or subject_id = v_subject_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_chapter_id is null then
          insert into chapters (tenant_id, subject_id, name, code, created_by)
          values (v_tenant, v_subject_id, v_item->>'chapter_code', v_item->>'chapter_code', auth.uid())
          returning id into v_chapter_id;
        end if;
      end if;

      v_topic_id := (p_defaults->>'topic_id')::uuid;
      if v_item->>'topic_code' is not null then
        select id into v_topic_id from topics
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'topic_code'
            and (v_chapter_id is null or chapter_id = v_chapter_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_topic_id is null then
          insert into topics (tenant_id, chapter_id, name, code, created_by)
          values (v_tenant, v_chapter_id, v_item->>'topic_code', v_item->>'topic_code', auth.uid())
          returning id into v_topic_id;
        end if;
      end if;

      v_subtopic_id := null;
      if v_item->>'subtopic_code' is not null then
        select id into v_subtopic_id from subtopics
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'subtopic_code'
            and (v_topic_id is null or topic_id = v_topic_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_subtopic_id is null then
          insert into subtopics (tenant_id, topic_id, name, code, created_by)
          values (v_tenant, v_topic_id, v_item->>'subtopic_code', v_item->>'subtopic_code', auth.uid())
          returning id into v_subtopic_id;
        end if;
      end if;

      v_type_id := null;
      if v_item->>'question_type_code' is not null then
        select id into v_type_id from question_types
          where code = v_item->>'question_type_code' and is_active limit 1;
      end if;

      v_mark := coalesce((v_item->>'marks')::numeric, (p_defaults->>'marks')::numeric, 4);
      v_neg := coalesce((v_item->>'negative_marks')::numeric, (p_defaults->>'negative_marks')::numeric, 1);
      v_ncert := coalesce((v_item->>'ncert')::boolean, false);
      v_pyq := coalesce((v_item->>'is_pyq')::boolean, false);
      v_visible := coalesce(v_item->>'question_visibility', p_defaults->>'question_visibility', 'TENANT');
      v_conf := coalesce((v_item->>'parse_confidence')::numeric, 0);

      insert into questions (
        tenant_id, exam_id, subject_id, chapter_id, topic_id, subtopic_id,
        question_type_id, question_text, question_html, question_text_latex,
        year, session, shift, question_number, difficulty,
        source, source_id, source_document_id, source_page_start, source_page_end,
        source_question_number, source_book, source_publisher, source_edition,
        import_batch, verification_status, pipeline_status, question_hash, content_hash,
        is_pyq, ncert, solution_status, question_visibility,
        marks, negative_marks, language,
        parse_confidence, subject_confidence, chapter_confidence, topic_confidence, answer_confidence,
        quality_score, created_by)
      values (
        v_tenant, v_exam_id, v_subject_id, v_chapter_id, v_topic_id, v_subtopic_id,
        v_type_id, v_text,
        coalesce(v_item->>'question_html', v_text),
        v_item->>'question_text_latex',
        (v_item->>'year')::int, v_item->>'session', v_item->>'shift',
        (v_item->>'question_number')::int,
        coalesce((v_item->>'difficulty')::question_difficulty, (p_defaults->>'difficulty')::question_difficulty, 'MEDIUM'),
        coalesce(v_item->>'source', p_defaults->>'source', 'IMPORT'),
        (v_item->>'source_id')::uuid,
        coalesce(p_source_document_id, (p_defaults->>'source_document_id')::uuid),
        (v_item->>'source_page_start')::int, (v_item->>'source_page_end')::int,
        v_item->>'source_question_number',
        coalesce(v_item->>'source_book', p_defaults->>'source_book'),
        coalesce(v_item->>'source_publisher', p_defaults->>'source_publisher'),
        coalesce(v_item->>'source_edition', p_defaults->>'source_edition'),
        coalesce(p_import_batch, p_defaults->>'import_batch'),
        p_verification,
        coalesce(v_item->>'pipeline_status', 'IMPORTED'),
        v_hash, v_content_hash,
        v_pyq, v_ncert,
        coalesce(v_item->>'solution_status', 'NOT_AVAILABLE'),
        v_visible,
        v_mark, v_neg,
        coalesce(upper(v_item->>'language'), upper(p_defaults->>'language'), 'EN'),
        v_conf,
        coalesce((v_item->>'subject_confidence')::numeric, 0),
        coalesce((v_item->>'chapter_confidence')::numeric, 0),
        coalesce((v_item->>'topic_confidence')::numeric, 0),
        coalesce((v_item->>'answer_confidence')::numeric, 0),
        coalesce((v_item->>'quality_score')::numeric, null),
        auth.uid())
      returning id into v_qid;

      if v_item->'options' is not null and jsonb_typeof(v_item->'options') = 'array' then
        v_opt_i := 0;
        for v_opt in select value from jsonb_array_elements(v_item->'options') loop
          v_opt_i := v_opt_i + 1;
          insert into question_options (tenant_id, question_id, option_key, option_text,
                                        option_html, option_latex, is_correct, display_order)
          values (v_tenant, v_qid,
                  coalesce(v_opt->>'option_key', 'OPT' || v_opt_i),
                  v_opt->>'option_text',
                  v_opt->>'option_html',
                  v_opt->>'option_latex',
                  coalesce((v_opt->>'is_correct')::boolean, false),
                  coalesce((v_opt->>'display_order')::int, v_opt_i));
        end loop;
      end if;

      insert into question_answers (tenant_id, question_id, correct_option_keys,
                                    numerical_answer, answer_type, numeric_value,
                                    numeric_tolerance, answer_text, explanation,
                                    source, confidence, verification_status, created_by)
      values (v_tenant, v_qid,
              coalesce((select array(select x from jsonb_array_elements_text(
                          coalesce(v_item->'answer'->'correct_option_keys', '[]'::jsonb)) x)),
                       '{}'::text[]),
              v_item->'answer'->>'numerical_answer',
              coalesce(v_item->'answer'->>'answer_type', 'MCQ'),
              (v_item->'answer'->>'numeric_value')::numeric,
              (v_item->'answer'->>'numeric_tolerance')::numeric,
              v_item->'answer'->>'answer_text',
              v_item->'answer'->>'explanation',
              coalesce(v_item->'answer'->>'source', 'PARSER'),
              coalesce((v_item->'answer'->>'confidence')::numeric, 0),
              coalesce(v_item->'answer'->>'verification_status', 'PENDING_REVIEW'),
              auth.uid());

      if v_item->>'solution_text' is not null or v_item->'solution' is not null
         or v_item->'solution'->>'solution_text' is not null then
        insert into solutions (tenant_id, question_id, solution_text, solution_html,
                               solution_latex, solution_method, concept, source,
                               verification_status, created_by)
        values (v_tenant, v_qid,
                coalesce(v_item->>'solution_text', v_item->'solution'->>'solution_text'),
                coalesce(v_item->'solution'->>'solution_html', v_item->>'solution_html'),
                coalesce(v_item->'solution'->>'solution_latex', v_item->>'solution_latex'),
                coalesce(v_item->'solution'->>'solution_method', v_item->>'solution_method'),
                v_item->'solution'->>'concept',
                coalesce(v_item->'solution'->>'source', 'PARSER'),
                'VERIFIED',
                auth.uid());
        update questions set solution_status = 'AVAILABLE' where id = v_qid;
      end if;

      if p_job_id is not null then
        update ingestion_jobs set questions_imported = questions_imported + 1, updated_at = now()
        where id = p_job_id;
      end if;

      v_seen_hashes := v_seen_hashes || v_hash;
      if v_content_hash is not null then v_seen_hashes := v_seen_hashes || v_content_hash; end if;
      v_imported := v_imported + 1;
      v_inserted := v_inserted || v_qid;
      if v_conf < 80 or coalesce((v_item->>'review_required')::boolean, false) then
        v_review := v_review + 1;
        update questions set pipeline_status = 'REVIEW_REQUIRED' where id = v_qid;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('index', v_imported + v_duplicates + v_failed - 1,
                                                 'error', sqlerrm);
    end;
  end loop;

  if v_imported > 0 then
    perform app_record_audit('questions_imported_v2', 'questions', null,
      jsonb_build_object('tenant_id', v_tenant, 'imported', v_imported,
                         'duplicates', v_duplicates, 'failed', v_failed,
                         'source_document_id', p_source_document_id));
  end if;

  return jsonb_build_object('imported', v_imported, 'duplicates', v_duplicates,
                            'failed', v_failed, 'review', v_review, 'total', v_total,
                            'inserted_ids', v_inserted,
                            'errors', coalesce(v_errors, '[]'::jsonb));
end; $$;

grant execute on function app_import_questions_v2(jsonb, uuid, uuid, text, jsonb, verification_status) to authenticated;
grant execute on function app_ingestion_job_start(jsonb) to authenticated;
grant execute on function app_ingestion_job_page(uuid, int, text, int, int, text) to authenticated;
grant execute on function app_ingestion_job_finish(uuid, text, int, int, int, int, jsonb) to authenticated;
grant execute on function app_ingestion_job_retry_page(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. app_get_eligible_questions — canonical eligibility engine (Phase 47)
-- ---------------------------------------------------------------------------
create or replace function app_get_eligible_questions(p_spec jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_exam uuid := (p_spec->>'exam_id')::uuid;
  v_limit int := coalesce((p_spec->>'limit')::int, 100);
  v_page int := coalesce((p_spec->>'page')::int, 1);
  v_statuses verification_status[] := array['VERIFIED'::verification_status];
  v_eligible bigint;
  v_ids uuid[];
  v_reasons jsonb := '{}'::jsonb;
  v_base bigint;
  v_by_verification bigint;
  v_by_exam bigint;
  v_by_filters bigint;
  v_by_used bigint;
  v_difficulty jsonb;
  v_subject jsonb;
  v_chapter jsonb;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  if v_exam is null then
    return jsonb_build_object('error', 'exam_id required');
  end if;

  -- base pool: tenant + platform bank, not deleted
  select count(*) into v_base
    from questions q
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false;

  -- rejected by verification status
  select count(*) into v_by_verification
    from questions q
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false
      and q.verification_status <> all (v_statuses);

  -- rejected by exam scope
  select count(*) into v_by_exam
    from questions q
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false
      and q.verification_status = any (v_statuses)
      and not (q.exam_id = v_exam or q.exam_id is null);

  -- eligible before usage
  select count(*) into v_by_filters
    from questions q
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false
      and q.verification_status = any (v_statuses)
      and (q.exam_id = v_exam or q.exam_id is null)
      and (p_spec->>'subject_id' is null or q.subject_id = (p_spec->>'subject_id')::uuid)
      and (p_spec->>'chapter_id' is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
      and (p_spec->>'topic_id' is null or q.topic_id = (p_spec->>'topic_id')::uuid)
      and (p_spec->>'year' is null or q.year = (p_spec->>'year')::int)
      and (p_spec->>'session' is null or q.session = p_spec->>'session')
      and (p_spec->>'shift' is null or q.shift = p_spec->>'shift')
      and (p_spec->>'difficulty' is null or q.difficulty = (p_spec->>'difficulty')::question_difficulty)
      and (p_spec->>'question_type_id' is null or q.question_type_id = (p_spec->>'question_type_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean);

  if coalesce((p_spec->>'exclude_used')::boolean, false) then
    select count(*) into v_by_used
      from questions q
      where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
        and q.is_deleted = false
        and q.verification_status = any (v_statuses)
        and (q.exam_id = v_exam or q.exam_id is null)
        and (p_spec->>'subject_id' is null or q.subject_id = (p_spec->>'subject_id')::uuid)
        and (p_spec->>'chapter_id' is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
        and (p_spec->>'topic_id' is null or q.topic_id = (p_spec->>'topic_id')::uuid)
        and (p_spec->>'year' is null or q.year = (p_spec->>'year')::int)
        and (p_spec->>'session' is null or q.session = p_spec->>'session')
        and (p_spec->>'shift' is null or q.shift = p_spec->>'shift')
        and (p_spec->>'difficulty' is null or q.difficulty = (p_spec->>'difficulty')::question_difficulty)
        and (p_spec->>'question_type_id' is null or q.question_type_id = (p_spec->>'question_type_id')::uuid)
        and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
        and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
        and exists (select 1 from question_usage qu
                    where qu.question_id = q.id and qu.tenant_id = v_tenant);
  else
    v_by_used := 0;
  end if;

  v_eligible := greatest(v_by_filters - v_by_used, 0);

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_difficulty from (
    select q.difficulty, count(*)::int as count
    from questions q
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false and q.verification_status = any (v_statuses)
      and (q.exam_id = v_exam or q.exam_id is null)
      and (p_spec->>'subject_id' is null or q.subject_id = (p_spec->>'subject_id')::uuid)
      and (p_spec->>'chapter_id' is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
      and (p_spec->>'topic_id' is null or q.topic_id = (p_spec->>'topic_id')::uuid)
      and (p_spec->>'year' is null or q.year = (p_spec->>'year')::int)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (not coalesce((p_spec->>'exclude_used')::boolean, false)
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant))
    group by q.difficulty order by q.difficulty
  ) x;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_subject from (
    select q.subject_id, s.name, count(*)::int as count
    from questions q left join subjects s on s.id = q.subject_id
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false and q.verification_status = any (v_statuses)
      and (q.exam_id = v_exam or q.exam_id is null)
      and (p_spec->>'chapter_id' is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
      and (p_spec->>'topic_id' is null or q.topic_id = (p_spec->>'topic_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (not coalesce((p_spec->>'exclude_used')::boolean, false)
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant))
    group by q.subject_id, s.name order by count desc
  ) x;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_chapter from (
    select q.chapter_id, c.name, count(*)::int as count
    from questions q left join chapters c on c.id = q.chapter_id
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false and q.verification_status = any (v_statuses)
      and (q.exam_id = v_exam or q.exam_id is null)
      and (p_spec->>'subject_id' is null or q.subject_id = (p_spec->>'subject_id')::uuid)
      and (p_spec->>'topic_id' is null or q.topic_id = (p_spec->>'topic_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (not coalesce((p_spec->>'exclude_used')::boolean, false)
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant))
    group by q.chapter_id, c.name order by count desc
  ) x;

  select array(select q.id from questions q
               where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
                 and q.is_deleted = false and q.verification_status = any (v_statuses)
                 and (q.exam_id = v_exam or q.exam_id is null)
                 and (p_spec->>'subject_id' is null or q.subject_id = (p_spec->>'subject_id')::uuid)
                 and (p_spec->>'chapter_id' is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
                 and (p_spec->>'topic_id' is null or q.topic_id = (p_spec->>'topic_id')::uuid)
                 and (p_spec->>'year' is null or q.year = (p_spec->>'year')::int)
                 and (p_spec->>'session' is null or q.session = p_spec->>'session')
                 and (p_spec->>'shift' is null or q.shift = p_spec->>'shift')
                 and (p_spec->>'difficulty' is null or q.difficulty = (p_spec->>'difficulty')::question_difficulty)
                 and (p_spec->>'question_type_id' is null or q.question_type_id = (p_spec->>'question_type_id')::uuid)
                 and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
                 and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
                 and (not coalesce((p_spec->>'exclude_used')::boolean, false)
                      or not exists (select 1 from question_usage qu
                                     where qu.question_id = q.id and qu.tenant_id = v_tenant))
               order by random()
               limit v_limit offset (v_page - 1) * v_limit) into v_ids;

  v_reasons := jsonb_build_object(
    'by_verification', v_by_verification,
    'by_exam_scope', v_by_exam,
    'by_usage', v_by_used,
    'base_pool', v_base
  );

  return jsonb_build_object(
    'tenant_id', v_tenant, 'exam_id', v_exam,
    'eligible_count', v_eligible,
    'question_ids', coalesce(v_ids, '{}'::uuid[]),
    'difficulty_breakdown', v_difficulty,
    'subject_breakdown', v_subject,
    'chapter_breakdown', v_chapter,
    'rejection_reasons', v_reasons
  );
end; $$;

grant execute on function app_get_eligible_questions(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Shard registration + index sync
-- ---------------------------------------------------------------------------
create or replace function app_shard_register(
  p_exam_id uuid, p_subject_id uuid, p_year_start int, p_year_end int,
  p_question_count int, p_compressed_size bigint, p_uncompressed_size bigint,
  p_sha256 text, p_drive_file_id text, p_drive_folder_id text,
  p_records jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_shard uuid;
  r record;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  insert into question_shards (tenant_id, exam_id, subject_id, year_start, year_end,
                               question_count, compressed_size, uncompressed_size,
                               sha256, drive_file_id, drive_folder_id, created_by)
  values (v_tenant, p_exam_id, p_subject_id, p_year_start, p_year_end,
          p_question_count, p_compressed_size, p_uncompressed_size,
          p_sha256, p_drive_file_id, p_drive_folder_id, auth.uid())
  returning id into v_shard;

  for r in select (x->>'question_id')::uuid as qid, x->>'record_locator' as loc
           from jsonb_array_elements(p_records) x
  loop
    insert into question_index (question_id, tenant_id, shard_id, record_locator,
                                exam_id, subject_id, year, session, shift,
                                difficulty, question_type_id, verification_status,
                                question_hash, content_hash, is_pyq,
                                has_solution, has_answer, has_asset)
    select q.id, v_tenant, v_shard, r.loc, q.exam_id, q.subject_id, q.year, q.session, q.shift,
           q.difficulty, q.question_type_id, q.verification_status,
           q.question_hash, q.content_hash, q.is_pyq,
           (q.solution_status = 'AVAILABLE'),
           exists (select 1 from question_answers a where a.question_id = q.id),
           exists (select 1 from question_assets asst where asst.question_id = q.id and asst.is_deleted = false)
    from questions q where q.id = r.qid
    on conflict (question_id) do update set shard_id = excluded.shard_id,
      record_locator = excluded.record_locator, updated_at = now();
  end loop;

  return jsonb_build_object('shard_id', v_shard, 'registered', jsonb_array_length(p_records));
end; $$;

create or replace function app_question_index_resync()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_synced int;
  v_deleted int;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;

  insert into question_index (question_id, tenant_id, exam_id, subject_id, chapter_id,
                              topic_id, year, session, shift, difficulty,
                              question_type_id, verification_status,
                              question_hash, content_hash, is_pyq,
                              has_solution, has_answer, has_asset)
  select q.id, v_tenant, q.exam_id, q.subject_id, q.chapter_id, q.topic_id,
         q.year, q.session, q.shift, q.difficulty,
         q.question_type_id, q.verification_status,
         q.question_hash, q.content_hash, q.is_pyq,
         (q.solution_status = 'AVAILABLE'),
         exists (select 1 from question_answers a where a.question_id = q.id),
         exists (select 1 from question_assets asst where asst.question_id = q.id and asst.is_deleted = false)
  from questions q
  where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
    and q.is_deleted = false
  on conflict (question_id) do update set
    tenant_id = excluded.tenant_id, exam_id = excluded.exam_id, subject_id = excluded.subject_id,
    chapter_id = excluded.chapter_id, topic_id = excluded.topic_id, year = excluded.year,
    session = excluded.session, shift = excluded.shift, difficulty = excluded.difficulty,
    question_type_id = excluded.question_type_id, verification_status = excluded.verification_status,
    question_hash = excluded.question_hash, content_hash = excluded.content_hash,
    is_pyq = excluded.is_pyq, has_solution = excluded.has_solution,
    has_answer = excluded.has_answer, has_asset = excluded.has_asset, updated_at = now();

  select count(*) into v_synced from question_index qi
    where qi.tenant_id = v_tenant or exists (
      select 1 from questions q where q.id = qi.question_id
        and q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001'));

  delete from question_index qi where not exists (
    select 1 from questions q where q.id = qi.question_id and q.is_deleted = false);
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('synced', v_synced, 'pruned_deleted', v_deleted);
end; $$;

grant execute on function app_shard_register(uuid, uuid, int, int, int, bigint, bigint, text, text, text, jsonb) to authenticated;
grant execute on function app_question_index_resync() to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Answer-key matching (Phase 27) — never overwrites, flags conflicts
-- ---------------------------------------------------------------------------
create or replace function app_match_answer_key(p_entries jsonb, p_source_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  e jsonb;
  v_matched int := 0;
  v_conflict int := 0;
  v_not_found int := 0;
  v_q record;
  v_ans text;
  v_ok bool;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    return jsonb_build_object('error', 'p_entries must be a jsonb array');
  end if;

  for e in select value from jsonb_array_elements(p_entries) loop
    v_q := null;
    select q.* into v_q from questions q
      where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
        and q.is_deleted = false
        and (e->>'exam_id' is null or q.exam_id = (e->>'exam_id')::uuid)
        and (e->>'year' is null or q.year = (e->>'year')::int)
        and (e->>'session' is null or q.session = e->>'session')
        and (e->>'shift' is null or q.shift = e->>'shift')
        and (e->>'subject_code' is null or exists (
              select 1 from subjects s where s.id = q.subject_id and s.code = e->>'subject_code'))
        and (e->>'question_number' is null or q.question_number = (e->>'question_number')::int
             or q.source_question_number = e->>'question_number')
      order by (q.tenant_id = v_tenant) desc, q.created_at desc
      limit 1;
    if v_q is null then
      v_not_found := v_not_found + 1;
      continue;
    end if;
    v_ans := e->>'answer';
    v_ok := exists (select 1 from question_answers a
                    where a.question_id = v_q.id and a.correct_option_keys @> array[v_ans]);
    if v_ok then
      update question_answers set verification_status = 'ANSWER_VERIFIED', confidence = 100,
                                  source = coalesce(source, 'ANSWER_KEY')
      where question_id = v_q.id;
      update questions set answer_confidence = 100, verification_status = 'VERIFIED',
                           pipeline_status = 'ANSWER_VERIFIED', updated_at = now()
      where id = v_q.id;
      v_matched := v_matched + 1;
    else
      update questions set pipeline_status = 'CONFLICT', updated_at = now()
      where id = v_q.id;
      v_conflict := v_conflict + 1;
    end if;
  end loop;

  return jsonb_build_object('matched', v_matched, 'conflict', v_conflict,
                            'not_found', v_not_found, 'total', jsonb_array_length(p_entries));
end; $$;

grant execute on function app_match_answer_key(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Storage dashboard (Phase 44)
-- ---------------------------------------------------------------------------
create or replace function app_storage_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_out jsonb;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;

  select jsonb_build_object(
    'tenant_id', v_tenant,
    'source_pdfs', (select count(*) from source_documents sd
                    where sd.tenant_id = v_tenant and sd.kind = 'QUESTION_BOOK'),
    'source_pdf_size_bytes', (select coalesce(sum(sd.file_size_bytes),0) from source_documents sd
                              where sd.tenant_id = v_tenant and sd.kind = 'QUESTION_BOOK'),
    'question_shards', (select count(*) from question_shards qs where qs.tenant_id = v_tenant),
    'shard_size_bytes', (select coalesce(sum(qs.compressed_size),0) from question_shards qs
                         where qs.tenant_id = v_tenant),
    'shard_question_count', (select coalesce(sum(qs.question_count),0) from question_shards qs
                             where qs.tenant_id = v_tenant),
    'images', (select count(*) from question_assets a
               join questions q on q.id = a.question_id
               where (q.tenant_id = v_tenant or a.tenant_id = v_tenant) and a.is_deleted = false),
    'image_size_bytes', (select coalesce(sum(a.file_size),0) from question_assets a
                         where a.tenant_id = v_tenant and a.is_deleted = false),
    'image_dedup_savings_bytes', (select coalesce(sum(a.file_size),0) from question_assets a
                                  where a.tenant_id = v_tenant and a.asset_hash is not null
                                    and a.is_deleted = false),
    'solutions', (select count(*) from solutions s
                  join questions q on q.id = s.question_id
                  where (q.tenant_id = v_tenant or q.tenant_id = '00000000-0000-0000-0000-000000000001')),
    'generated_papers', (select count(*) from storage_objects so
                         where so.provider = 'GOOGLE_DRIVE' and so.paper_id is not null
                           and (so.tenant_id = v_tenant or so.tenant_id is null) and so.is_deleted = false),
    'generated_dpps', (select count(*) from storage_objects so
                       where so.provider = 'GOOGLE_DRIVE' and so.object_key like '%-dpp%'
                         and (so.tenant_id = v_tenant or so.tenant_id is null) and so.is_deleted = false),
    'generated_paper_size_bytes', (select coalesce(sum(so.size_bytes),0) from storage_objects so
                                   where so.provider = 'GOOGLE_DRIVE'
                                     and (so.tenant_id = v_tenant or so.tenant_id is null)
                                     and so.is_deleted = false),
    'drive_objects', (select count(*) from storage_objects so
                      where so.provider = 'GOOGLE_DRIVE' and (so.tenant_id = v_tenant or so.tenant_id is null)
                        and so.is_deleted = false),
    'checked_at', now()
  ) into v_out;

  return v_out;
end; $$;

grant execute on function app_storage_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- 15. Question corpus dashboard (Phase 45)
-- ---------------------------------------------------------------------------
create or replace function app_question_corpus_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_out jsonb;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;

  select jsonb_build_object(
    'tenant_id', v_tenant,
    'total', (select count(*) from questions q
              where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001') and q.is_deleted = false),
    'published', (select count(*) from questions q
                  where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                    and q.is_deleted = false and q.pipeline_status = 'PUBLISHED'),
    'expert_verified', (select count(*) from questions q
                        where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                          and q.is_deleted = false and q.pipeline_status = 'EXPERT_VERIFIED'),
    'answer_verified', (select count(*) from questions q
                        where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                          and q.is_deleted = false and q.pipeline_status = 'ANSWER_VERIFIED'),
    'source_verified', (select count(*) from questions q
                        where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                          and q.is_deleted = false and q.pipeline_status = 'SOURCE_VERIFIED'),
    'verified', (select count(*) from questions q
                 where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                   and q.is_deleted = false and q.verification_status = 'VERIFIED'),
    'review_required', (select count(*) from questions q
                        where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                          and q.is_deleted = false and q.pipeline_status = 'REVIEW_REQUIRED'),
    'rejected', (select count(*) from questions q
                 where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                   and q.is_deleted = false and q.verification_status = 'REJECTED'),
    'conflict', (select count(*) from questions q
                 where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                   and q.is_deleted = false and q.pipeline_status = 'CONFLICT'),
    'with_answer', (select count(*) from questions q
                    where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                      and q.is_deleted = false
                      and exists (select 1 from question_answers a where a.question_id = q.id)),
    'with_solution', (select count(*) from questions q
                      where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                        and q.is_deleted = false and q.solution_status = 'AVAILABLE'),
    'with_diagram', (select count(*) from questions q
                     where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                       and q.is_deleted = false
                       and exists (select 1 from question_assets a
                                   where a.question_id = q.id and a.is_deleted = false)),
    'by_exam', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select e.name as exam_name, count(*)::int as count
                  from questions q left join exams e on e.id = q.exam_id
                  where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                    and q.is_deleted = false group by e.name order by count desc) x),
    'by_subject', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                    select s.name as subject_name, count(*)::int as count
                    from questions q left join subjects s on s.id = q.subject_id
                    where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                      and q.is_deleted = false group by s.name order by count desc) x),
    'by_year', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                 select q.year, count(*)::int as count
                 from questions q
                 where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                   and q.is_deleted = false and q.year is not null group by q.year order by q.year desc) x),
    'chapters', (select count(distinct q.chapter_id) from questions q
                 where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                   and q.is_deleted = false and q.chapter_id is not null),
    'topics', (select count(distinct q.topic_id) from questions q
               where q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001')
                 and q.is_deleted = false and q.topic_id is not null),
    'index_count', (select count(*) from question_index qi
                    where qi.tenant_id = v_tenant
                       or exists (select 1 from questions q
                                  where q.id = qi.question_id and q.tenant_id in (v_tenant,'00000000-0000-0000-0000-000000000001'))),
    'shard_count', (select count(*) from question_shards qs where qs.tenant_id = v_tenant),
    'checked_at', now()
  ) into v_out;

  return v_out;
end; $$;

grant execute on function app_question_corpus_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- 16. app_question_snapshot — include diagrams/asset metadata
-- ---------------------------------------------------------------------------
create or replace function app_question_snapshot(p_qid uuid, p_marks numeric, p_neg numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_opt jsonb;
  v_ans jsonb;
  v_sol jsonb;
  v_img jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'option_key', o.option_key, 'option_text', o.option_text, 'option_html', o.option_html,
    'display_order', o.display_order) order by o.display_order), '[]'::jsonb)
  into v_opt from question_options o where o.question_id = p_qid;

  select jsonb_build_object(
    'correct_option_keys', coalesce(a.correct_option_keys, '{}'::text[]),
    'numerical_answer', a.numerical_answer, 'answer_type', a.answer_type,
    'numeric_value', a.numeric_value, 'answer_text', a.answer_text,
    'explanation', a.explanation, 'confidence', a.confidence)
  into v_ans from question_answers a where a.question_id = p_qid;

  select jsonb_build_object(
    'solution_text', s.solution_text, 'solution_html', s.solution_html,
    'solution_latex', s.solution_latex, 'short_solution', s.short_solution,
    'detailed_solution', s.detailed_solution, 'concept', s.concept,
    'formula', s.formula, 'hint', s.hint, 'solution_type', s.solution_type,
    'solution_method', s.solution_method)
  into v_sol from solutions s where s.question_id = p_qid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'asset_id', img.id, 'asset_type', img.asset_type, 'mime_type', img.mime_type,
    'drive_file_id', img.drive_file_id, 'object_key', img.object_key,
    'width', img.width, 'height', img.height, 'file_size', img.file_size,
    'display_order', img.display_order) order by img.display_order), '[]'::jsonb)
  into v_img from question_assets img
  where img.question_id = p_qid and img.is_deleted = false;

  return jsonb_build_object(
    'question_id', p_qid,
    'question_text', (select q.question_text from questions q where q.id = p_qid),
    'question_html', (select q.question_html from questions q where q.id = p_qid),
    'question_text_latex', (select q.question_text_latex from questions q where q.id = p_qid),
    'year', (select q.year from questions q where q.id = p_qid),
    'session', (select q.session from questions q where q.id = p_qid),
    'shift', (select q.shift from questions q where q.id = p_qid),
    'difficulty', (select q.difficulty from questions q where q.id = p_qid),
    'subject_id', (select q.subject_id from questions q where q.id = p_qid),
    'chapter_id', (select q.chapter_id from questions q where q.id = p_qid),
    'topic_id', (select q.topic_id from questions q where q.id = p_qid),
    'marks', p_marks, 'negative_marks', p_neg,
    'options', v_opt,
    'answer', v_ans,
    'solution', v_sol,
    'assets', v_img
  );
end; $$;

grant execute on function app_question_snapshot(uuid, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 17. app_generate_paper — add is_pyq / ncert filters (behaviour otherwise
--     byte-identical to 0019: quota, idempotent paper_code, section mode,
--     no-repeat, in-paper hash dedupe).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_generate_paper(p_spec jsonb, p_seed double precision DEFAULT NULL::double precision)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 declare
   v_tenant uuid;
   v_pattern record;
   v_limit int := 5;
   v_quota_ok boolean;
   v_exam uuid := (p_spec->>'exam_id')::uuid;
   v_count int := coalesce((p_spec->>'count')::int, 30);
   v_title text := coalesce(p_spec->>'title', 'Generated Paper');
   v_code text := p_spec->>'paper_code';
   v_duration int := coalesce((p_spec->>'duration_minutes')::int, 180);
   v_marks numeric := coalesce((p_spec->>'marks')::numeric, 4);
   v_neg numeric := coalesce((p_spec->>'negative_marks')::numeric, 1);
   v_paper_id uuid;
   v_existing uuid;
   v_period text := to_char(now(),'YYYY-MM');
   v_selected jsonb := '[]'::jsonb;
   v_q record;
   v_opt jsonb;
   v_total_marks numeric := 0;
   v_used_hashes text[] := '{}'::text[];
   v_row int := 0;
   v_sections jsonb;
   v_sec jsonb;
   v_sec_count int;
   v_sec_marks numeric;
   v_sec_neg numeric;
   v_sec_subj uuid;
   v_sec_types jsonb;
   v_section_mode boolean := false;
   v_filled int := 0;
   v_missing jsonb := '[]'::jsonb;
   v_no_repeat boolean := coalesce((p_spec->'filters'->>'exclude_used'), '') = 'true' or coalesce((p_spec->>'exclude_used'), '') = 'true';
 begin
   select tm.tenant_id into v_tenant from tenant_memberships tm
     where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
   if v_tenant is null then
     return jsonb_build_object('error', 'no tenant membership');
   end if;
   if v_exam is null then
     return jsonb_build_object('error', 'exam_id required');
   end if;

   if v_code is not null then
     select id into v_existing from papers where tenant_id = v_tenant and paper_code = v_code;
     if v_existing is not null then
       return jsonb_build_object('paper_id', v_existing, 'already', true);
     end if;
   end if;

   select * into v_pattern from exam_patterns
     where exam_id = v_exam and (tenant_id is null or tenant_id = v_tenant) and is_active
     order by version desc limit 1;
   if v_pattern.id is not null then
     v_duration := coalesce(v_duration, v_pattern.duration_minutes);
     v_marks := coalesce(v_marks, v_pattern.default_marks);
     v_neg := coalesce(v_neg, v_pattern.default_negative_marks);
   end if;

   if p_seed is not null then
     perform setseed(p_seed);
   end if;

   select value->>'PAPERS_GENERATED' into v_limit from system_config where key = 'free_quota';
   v_limit := coalesce(v_limit::int, 5);
   perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':PAPERS_GENERATED:' || v_period, 0));
   select app_quota_available(v_tenant, 'PAPERS_GENERATED', v_limit, v_period) into v_quota_ok;
   if not v_quota_ok then
     return jsonb_build_object('error', 'Free paper quota reached (' || v_limit || '/month). Upgrade plan to generate more.');
   end if;

   v_sections := coalesce(v_pattern.sections, '[]'::jsonb);
   v_section_mode := jsonb_array_length(v_sections) > 0
     and (
       p_spec->'filters' is null
       or jsonb_typeof(p_spec->'filters') = 'null'
       or (jsonb_typeof(p_spec->'filters') = 'array' and jsonb_array_length(p_spec->'filters') = 0)
       or (jsonb_typeof(p_spec->'filters') = 'object'
           and (select count(*) from jsonb_object_keys(p_spec->'filters')) = 0)
     );

   if v_section_mode then
     for v_sec in select value from jsonb_array_elements(v_sections) loop
       v_sec_count := coalesce((v_sec->>'count')::int, 0);
       v_sec_marks := coalesce((v_sec->>'marks')::numeric, v_marks);
       v_sec_neg := coalesce((v_sec->>'negative_marks')::numeric, v_neg);
       select id into v_sec_subj from subjects
         where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
           and code = v_sec->>'subject_code'
           and (exam_id is null or exam_id = v_exam)
         order by (exam_id is null), exam_id desc
         limit 1;
       select coalesce(jsonb_agg(id), '[]'::jsonb) into v_sec_types
         from question_types
         where code in (select x from jsonb_array_elements_text(coalesce(v_sec->'question_type_codes', '[]'::jsonb)) x);

       v_filled := 0;
       for v_q in
         select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
                q.difficulty, q.year, q.session, q.shift, q.question_text, q.question_hash,
                q.marks, q.negative_marks
         from questions q
         where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
           and q.verification_status = 'VERIFIED' and q.is_deleted = false
           and (q.exam_id = v_exam or q.exam_id is null)
           and (v_sec_subj is null or q.subject_id = v_sec_subj)
           and (jsonb_array_length(v_sec_types) = 0
                or q.question_type_id in (select (x)::uuid from jsonb_array_elements_text(v_sec_types) x))
           and (not v_no_repeat
                or not exists (select 1 from question_usage qu
                               where qu.question_id = q.id and qu.tenant_id = v_tenant))
           and (p_spec->'filters'->>'language' is null or upper(q.language) = upper(p_spec->'filters'->>'language'))
           and (p_spec->'filters'->>'is_pyq' is null or q.is_pyq = (p_spec->'filters'->>'is_pyq')::boolean)
           and (p_spec->'filters'->>'ncert' is null or q.ncert = (p_spec->'filters'->>'ncert')::boolean)
           and (p_spec->'filters'->'exclude_paper_ids' is null
                or not exists (select 1 from paper_questions pq
                               where pq.question_id = q.id and pq.paper_id = any (array(
                                 select (x)::uuid
                                 from jsonb_array_elements_text(p_spec->'filters'->'exclude_paper_ids') x))))
         order by random()
       loop
         if v_filled >= v_sec_count then exit; end if;
         if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
           continue;
         end if;
         v_selected := v_selected || app_question_snapshot(v_q.id, v_sec_marks, v_sec_neg);
         if v_q.question_hash is not null then
           v_used_hashes := v_used_hashes || v_q.question_hash;
         end if;
         v_filled := v_filled + 1;
       end loop;

       if v_filled < v_sec_count then
         v_missing := v_missing || jsonb_build_object(
           'section', v_sec->>'name', 'required', v_sec_count, 'available', v_filled);
       end if;
     end loop;

     if jsonb_array_length(v_missing) > 0 then
       return jsonb_build_object(
         'error', 'Insufficient eligible questions for one or more sections',
         'missing', v_missing::text);
     end if;
     v_count := jsonb_array_length(v_selected);
   else
     for v_q in
       select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
              q.difficulty, q.year, q.session, q.shift, q.question_text, q.question_hash,
              q.marks, q.negative_marks
       from questions q
       where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
         and q.verification_status = 'VERIFIED' and q.is_deleted = false
         and (q.exam_id = v_exam or q.exam_id is null)
         and (p_spec->'filters'->>'subject_ids' is null or q.subject_id = any (array(
               select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'subject_ids') x)))
         and (p_spec->'filters'->>'chapter_ids' is null or q.chapter_id = any (array(
               select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'chapter_ids') x)))
         and (p_spec->'filters'->>'topic_ids' is null or q.topic_id = any (array(
               select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'topic_ids') x)))
         and (p_spec->'filters'->>'difficulties' is null or q.difficulty = any (array(
               select x from jsonb_array_elements_text(p_spec->'filters'->'difficulties') x)::question_difficulty[]))
         and (p_spec->'filters'->>'years' is null or q.year = any (array(
               select (x)::int from jsonb_array_elements_text(p_spec->'filters'->'years') x)))
         and (p_spec->'filters'->>'question_type_ids' is null or q.question_type_id = any (array(
               select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'question_type_ids') x)))
         and (p_spec->'filters'->>'session' is null or q.session = p_spec->'filters'->>'session')
         and (p_spec->'filters'->>'shift' is null or q.shift = p_spec->'filters'->>'shift')
         and (p_spec->'filters'->>'language' is null or upper(q.language) = upper(p_spec->'filters'->>'language'))
         and (p_spec->'filters'->>'is_pyq' is null or q.is_pyq = (p_spec->'filters'->>'is_pyq')::boolean)
         and (p_spec->'filters'->>'ncert' is null or q.ncert = (p_spec->'filters'->>'ncert')::boolean)
         and (not v_no_repeat
              or not exists (select 1 from question_usage qu
                             where qu.question_id = q.id and qu.tenant_id = v_tenant))
         and (p_spec->'filters'->'exclude_paper_ids' is null
              or not exists (select 1 from paper_questions pq
                             where pq.question_id = q.id and pq.paper_id = any (array(
                               select (x)::uuid
                               from jsonb_array_elements_text(p_spec->'filters'->'exclude_paper_ids') x))))
       order by random()
     loop
       if jsonb_array_length(v_selected) >= v_count then exit; end if;
       if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
         continue;
       end if;
       v_selected := v_selected || app_question_snapshot(v_q.id, v_marks, v_neg);
       if v_q.question_hash is not null then
         v_used_hashes := v_used_hashes || v_q.question_hash;
       end if;
     end loop;

     if jsonb_array_length(v_selected) < v_count then
       return jsonb_build_object(
         'error', 'Insufficient eligible questions',
         'required', v_count,
         'available', jsonb_array_length(v_selected),
         'missing', 'Only ' || jsonb_array_length(v_selected) || ' verified questions match the selected constraints.');
     end if;
   end if;

   if jsonb_array_length(v_selected) = 0 then
     return jsonb_build_object('error', 'No eligible questions match the selected constraints.');
   end if;

   begin
     insert into papers (tenant_id, exam_id, exam_pattern_id, title, paper_code, duration_minutes,
                         total_questions, total_marks, status, instructions, answer_key_json, created_by)
     values (v_tenant, v_exam, v_pattern.id, v_title, v_code, v_duration,
             jsonb_array_length(v_selected), 0, 'LOCKED',
             p_spec->>'instructions',
             jsonb_build_object('marks', v_marks, 'negative_marks', v_neg, 'generated_by', auth.uid()),
             auth.uid())
     returning id into v_paper_id;

     v_row := 0;
     for v_opt in select value from jsonb_array_elements(v_selected)
     loop
       v_row := v_row + 1;
       insert into paper_questions (tenant_id, paper_id, question_id, question_order,
                                    marks, negative_marks, snapshot)
       values (v_tenant, v_paper_id, (v_opt->>'question_id')::uuid, v_row::int,
               coalesce((v_opt->>'marks')::numeric, v_marks),
               coalesce((v_opt->>'negative_marks')::numeric, v_neg),
               v_opt);
       insert into question_usage (tenant_id, question_id, used_in_type, used_in_id)
       values (v_tenant, (v_opt->>'question_id')::uuid, 'PAPER', v_paper_id);
       v_total_marks := v_total_marks + coalesce((v_opt->>'marks')::numeric, v_marks);
     end loop;

     update papers set total_marks = v_total_marks where id = v_paper_id;
     perform app_increment_usage(v_tenant, 'PAPERS_GENERATED', v_period, 1);
     perform app_record_audit('paper_generated', 'papers', v_paper_id,
       jsonb_build_object('tenant_id', v_tenant, 'questions', jsonb_array_length(v_selected),
                          'no_repeat', v_no_repeat, 'seed', p_seed));
   exception when others then
     return jsonb_build_object('error', 'paper generation failed: ' || sqlerrm);
   end;

   return jsonb_build_object('paper_id', v_paper_id, 'questions', jsonb_array_length(v_selected),
     'total_marks', v_total_marks, 'already', false);
 end; $function$;

-- ---------------------------------------------------------------------------
-- 18. app_generate_dpp — add is_pyq / ncert filters (behaviour otherwise
--     identical to 0015).
-- ---------------------------------------------------------------------------
create or replace function app_generate_dpp(p_spec jsonb, p_seed double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_exam uuid := (p_spec->>'exam_id')::uuid;
  v_count int := coalesce((p_spec->>'count')::int, 15);
  v_title text := coalesce(p_spec->>'title', 'Daily DPP');
  v_mode text := coalesce(p_spec->>'mode', 'DAILY');
  v_marks numeric := coalesce((p_spec->>'marks')::numeric, 4);
  v_neg numeric := coalesce((p_spec->>'negative_marks')::numeric, 1);
  v_period text := to_char(now(),'YYYY-MM');
  v_limit int := 10;
  v_quota_ok boolean;
  v_dpp_id uuid;
  v_selected jsonb := '[]'::jsonb;
  v_q record;
  v_item jsonb;
  v_total_marks numeric := 0;
  v_used_hashes text[] := '{}'::text[];
  v_row int := 0;
  v_target date := (p_spec->>'target_date')::date;
  v_no_repeat boolean := coalesce((p_spec->>'exclude_used'),'') = 'true' or coalesce((p_spec->'filters'->>'exclude_used'),'') = 'true';
  v_chapter uuid := (p_spec->'filters'->>'chapter_id')::uuid;
  v_topic uuid := (p_spec->'filters'->>'topic_id')::uuid;
  v_weak_topics uuid[];
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  if v_exam is null then
    return jsonb_build_object('error', 'exam_id required');
  end if;

  select value->>'DPP_GENERATED' into v_limit from system_config where key = 'free_quota';
  v_limit := coalesce(v_limit::int, 10);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':DPP_GENERATED:' || v_period, 0));
  select app_quota_available(v_tenant, 'DPP_GENERATED', v_limit, v_period) into v_quota_ok;
  if not v_quota_ok then
    return jsonb_build_object('error', 'Free DPP quota reached (' || v_limit || '/month). Upgrade plan to generate more.');
  end if;

  if v_mode = 'WEAK_TOPIC' then
    select count(*) into v_row from practice_logs pl
      where pl.user_id = auth.uid();
    if v_row = 0 then
      return jsonb_build_object('error', 'No practice history yet — complete a few practice sessions to enable weak-topic DPPs.');
    end if;
    select array_agg(topic_id) into v_weak_topics from app_weak_topics(auth.uid(), 5);
  end if;

  if p_seed is not null then
    perform setseed(p_seed);
  end if;

  for v_q in
    select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
           q.difficulty, q.year, q.session, q.shift, q.question_text, q.question_hash,
           q.marks, q.negative_marks
    from questions q
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.verification_status = 'VERIFIED' and q.is_deleted = false
      and (q.exam_id = v_exam or q.exam_id is null)
      and (v_chapter is null or q.chapter_id = v_chapter)
      and (v_topic is null or q.topic_id = v_topic)
      and (p_spec->'filters'->>'subject_ids' is null or q.subject_id = any (array(
            select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'subject_ids') x)))
      and (p_spec->'filters'->>'years' is null or q.year = any (array(
            select (x)::int from jsonb_array_elements_text(p_spec->'filters'->'years') x)))
      and (p_spec->'filters'->>'difficulties' is null or q.difficulty = any (array(
            select x from jsonb_array_elements_text(p_spec->'filters'->'difficulties') x)::question_difficulty[]))
      and (p_spec->'filters'->>'language' is null or upper(q.language) = upper(p_spec->'filters'->>'language'))
      and (p_spec->'filters'->>'is_pyq' is null or q.is_pyq = (p_spec->'filters'->>'is_pyq')::boolean)
      and (p_spec->'filters'->>'ncert' is null or q.ncert = (p_spec->'filters'->>'ncert')::boolean)
      and (v_mode <> 'PYQ' or q.year in (select (x)::int from jsonb_array_elements_text(
            coalesce(p_spec->'filters'->'years', '[2025,2024,2023,2022,2021,2020]'::jsonb)) x))
      and (v_mode <> 'WEAK_TOPIC'
           or (v_weak_topics is not null and array_length(v_weak_topics, 1) > 0
               and q.topic_id = any (v_weak_topics)))
      and (not v_no_repeat
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant))
    order by random()
  loop
    if jsonb_array_length(v_selected) >= v_count then exit; end if;
    if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
      continue;
    end if;
    v_selected := v_selected || app_question_snapshot(v_q.id, v_marks, v_neg);
    if v_q.question_hash is not null then
      v_used_hashes := v_used_hashes || v_q.question_hash;
    end if;
  end loop;

  if jsonb_array_length(v_selected) = 0 then
    return jsonb_build_object('error', 'No eligible questions match the DPP constraints.');
  end if;

  begin
    insert into dpps (tenant_id, title, description, exam_id, subject_id, chapter_id, topic_id,
                      target_date, status, created_by)
    values (v_tenant, v_title, null, v_exam, null, v_chapter, v_topic, v_target, 'PUBLISHED', auth.uid())
    returning id into v_dpp_id;

    v_row := 0;
    for v_item in select value from jsonb_array_elements(v_selected) loop
      v_row := v_row + 1;
      insert into dpp_questions (tenant_id, dpp_id, question_id, question_order)
      values (v_tenant, v_dpp_id, (v_item->>'question_id')::uuid, v_row);
      insert into question_usage (tenant_id, question_id, used_in_type, used_in_id)
      values (v_tenant, (v_item->>'question_id')::uuid, 'DPP', v_dpp_id);
      v_total_marks := v_total_marks + coalesce((v_item->>'marks')::numeric, v_marks);
    end loop;
    update dpps set description = 'Total marks: ' || v_total_marks where id = v_dpp_id;
    perform app_increment_usage(v_tenant, 'DPP_GENERATED', v_period, 1);
    perform app_record_audit('dpp_generated', 'dpps', v_dpp_id,
      jsonb_build_object('tenant_id', v_tenant, 'questions', jsonb_array_length(v_selected),
                         'mode', v_mode, 'seed', p_seed));
  exception when others then
    return jsonb_build_object('error', 'dpp generation failed: ' || sqlerrm);
  end;

  return jsonb_build_object('dpp_id', v_dpp_id, 'questions', jsonb_array_length(v_selected),
    'total_marks', v_total_marks);
end; $$;

grant execute on function app_generate_paper(jsonb, double precision) to authenticated;
grant execute on function app_generate_dpp(jsonb, double precision) to authenticated;