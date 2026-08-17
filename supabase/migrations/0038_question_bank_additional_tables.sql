-- =============================================================================
-- ExamPro — Question Bank Augmentations & Additional Tables (Migration 0038)
--
-- This migration AUGMENTS tables that already exist (source_documents,
-- question_usage, solutions) and CREATES only genuinely new tables
-- (question_diagrams, question_topic_mapping). It does NOT recreate existing
-- tables, so it is safe to apply on top of 0001/0006/0024/0030.
--
-- All statements are idempotent and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Augment source_documents (created in 0024) with book-provenance columns
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='source_type') then
    alter table source_documents add column source_type text not null default 'QUESTION_BOOK'; -- QUESTION_BOOK | ANSWER_KEY | SOLUTION_BOOK | IMAGE_BATCH | DATA_FILE
  end if;
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
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='drive_folder_id') then
    alter table source_documents add column drive_folder_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='mime_type') then
    alter table source_documents add column mime_type text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='file_size_bytes') then
    alter table source_documents add column file_size_bytes bigint;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='checksum') then
    alter table source_documents add column checksum text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='external_source_id') then
    alter table source_documents add column external_source_id text; -- external reference id
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='isbn') then
    alter table source_documents add column isbn text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='publication_year') then
    alter table source_documents add column publication_year int;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='description') then
    alter table source_documents add column description text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='source_documents' and column_name='is_deleted') then
    alter table source_documents add column is_deleted boolean not null default false;
  end if;
end $$;

create index if not exists source_documents_type_idx on source_documents (source_type);
create index if not exists source_documents_sha256_idx on source_documents (sha256) where sha256 is not null;
create index if not exists source_documents_is_deleted_idx on source_documents (is_deleted) where is_deleted = false;

-- ---------------------------------------------------------------------------
-- 2. Augment question_usage (created in 0006) with rich tracking
--    Keep existing used_in_type / used_in_id (used by frontend) and add columns.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_usage' and column_name='used_by') then
    alter table question_usage add column used_by uuid references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_usage' and column_name='used_at') then
    alter table question_usage add column used_at timestamptz not null default now();
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_usage' and column_name='session_id') then
    alter table question_usage add column session_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_usage' and column_name='meta') then
    alter table question_usage add column meta jsonb;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='question_usage' and column_name='is_deleted') then
    alter table question_usage add column is_deleted boolean not null default false;
  end if;
end $$;

create index if not exists question_usage_tenant_question_idx on question_usage (tenant_id, question_id) where is_deleted = false;
create index if not exists question_usage_used_in_idx on question_usage (used_in_type, used_in_id) where is_deleted = false;

-- ---------------------------------------------------------------------------
-- 3. Augment solutions (created in 0001) with rich solution fields
--    Keep existing solution_text / concept (used by frontend) and add columns.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='solution_html') then
    alter table solutions add column solution_html text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='solution_latex') then
    alter table solutions add column solution_latex text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='solution_method') then
    alter table solutions add column solution_method text; -- STEPWISE | CONCEPTUAL | SHORTCUT | FULL
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='formula') then
    alter table solutions add column formula text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='diagram_required') then
    alter table solutions add column diagram_required boolean not null default false;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='solution_type') then
    alter table solutions add column solution_type text; -- THEORETICAL | STEPWISE | SHORTCUT | CONCEPTUAL
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='difficulty') then
    alter table solutions add column difficulty text; -- EASY | MEDIUM | HARD
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='marks') then
    alter table solutions add column marks int;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='time_to_solve_minutes') then
    alter table solutions add column time_to_solve_minutes int;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='hints') then
    alter table solutions add column hints text[];
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='key_concepts') then
    alter table solutions add column key_concepts text[];
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='source') then
    alter table solutions add column source text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='verification_status') then
    alter table solutions add column verification_status text not null default 'PENDING_REVIEW'; -- PENDING_REVIEW | VERIFIED | REJECTED
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='confidence') then
    alter table solutions add column confidence numeric(5,2); -- 0-100
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='solutions' and column_name='quality_score') then
    alter table solutions add column quality_score numeric(5,2); -- 0-100
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. New table: question_diagrams — images (diagrams, graphs, etc.)
-- ---------------------------------------------------------------------------
create table if not exists question_diagrams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  solution_id uuid references solutions(id) on delete set null,
  asset_type text not null default 'DIAGRAM', -- DIAGRAM | GRAPH | CHEMICAL_STRUCTURE | BIOLOGICAL_DIAGRAM | FORMULA | TABLE | OTHER_REQUIRED_VISUAL
  asset_hash text, -- sha256 of the image content
  perceptual_hash text, -- perceptual hash for visual similarity
  drive_file_id text not null,
  storage_object_id uuid,
  mime_type text not null default 'image/webp',
  width int,
  height int,
  file_size bigint,
  compression text not null default 'WEBP', -- WEBP | PNG | SVG
  description text,
  diagram_category text, -- PHYSICS | CHEMISTRY | MATHEMATICS | BIOLOGY | etc.
  is_deleted boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists question_diagrams_hash_idx on question_diagrams (asset_hash) where asset_hash is not null and is_deleted = false;
create index if not exists question_diagrams_question_idx on question_diagrams (question_id) where is_deleted = false;
create index if not exists question_diagrams_solution_idx on question_diagrams (solution_id) where solution_id is not null;

-- ---------------------------------------------------------------------------
-- 5. New table: question_topic_mapping — additional subject/topic/subtopic mapping
-- ---------------------------------------------------------------------------
create table if not exists question_topic_mapping (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  topic_type text not null, -- SUBJECT | CHAPTER | TOPIC | SUBTOPIC
  topic_id uuid, -- references appropriate taxonomy table based on topic_type
  topic_text text not null, -- human-readable name
  topic_code text, -- standard code
  is_primary boolean not null default false, -- whether this is the main topic for the question
  confidence numeric(5,2), -- 0-100
  source text,
  is_deleted boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists question_topic_mapping_question_idx on question_topic_mapping (question_id);
create index if not exists question_topic_mapping_topic_idx on question_topic_mapping (topic_id) where topic_id is not null;
create index if not exists question_topic_mapping_primary_idx on question_topic_mapping (is_primary) where is_primary = true;

-- ---------------------------------------------------------------------------
-- 6. Enable RLS on NEW tables only.
--    source_documents already has RLS (0024). question_usage and solutions are
--    currently open-access (no RLS) and the frontend relies on that, so we must
--    NOT enable RLS on them here or all SELECTs would be blocked.
-- ---------------------------------------------------------------------------
alter table question_diagrams enable row level security;
alter table question_topic_mapping enable row level security;

drop policy if exists question_diagrams_admin on question_diagrams;
create policy question_diagrams_admin on question_diagrams
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists question_diagrams_read on question_diagrams;
create policy question_diagrams_read on question_diagrams
  for select to authenticated
  using (
    app_is_platform_admin()
    or tenant_id = app_current_tenant_id()
    or exists (
      select 1 from questions q
      where q.id = question_diagrams.question_id
        and (q.verification_status = 'VERIFIED' or q.tenant_id = '00000000-0000-0000-0000-000000000001')
        and q.is_deleted = false
    )
  );

drop policy if exists question_topic_mapping_admin on question_topic_mapping;
create policy question_topic_mapping_admin on question_topic_mapping
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists question_topic_mapping_read on question_topic_mapping;
create policy question_topic_mapping_read on question_topic_mapping
  for select to authenticated
  using (
    app_is_platform_admin()
    or tenant_id = app_current_tenant_id()
    or exists (
      select 1 from questions q
      where q.id = question_topic_mapping.question_id
        and (q.verification_status = 'VERIFIED' or q.tenant_id = '00000000-0000-0000-0000-000000000001')
        and q.is_deleted = false
    )
  );

-- ---------------------------------------------------------------------------
-- 7. app_get_eligible_questions — enhanced eligibility engine (superset of 0030)
--    Adds: subtopic filter, topic/subtopic breakdowns, is_deleted-aware usage,
--    and extra diagnostics. Keeps all 0030 return fields for backward compat.
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
  v_base bigint;
  v_by_verification bigint;
  v_by_exam bigint;
  v_by_filters bigint;
  v_by_used bigint;
  v_difficulty jsonb;
  v_subject jsonb;
  v_chapter jsonb;
  v_topic jsonb;
  v_subtopic jsonb;
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
      and (p_spec->>'subtopic_id' is null or q.subtopic_id = (p_spec->>'subtopic_id')::uuid)
      and (p_spec->>'year' is null or q.year = (p_spec->>'year')::int)
      and (p_spec->>'session' is null or q.session = p_spec->>'session')
      and (p_spec->>'shift' is null or q.shift = p_spec->>'shift')
      and (p_spec->>'difficulty' is null or q.difficulty = (p_spec->>'difficulty')::question_difficulty)
      and (p_spec->>'question_type_id' is null or q.question_type_id = (p_spec->>'question_type_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (p_spec->>'is_deleted' is null or q.is_deleted = (p_spec->>'is_deleted')::boolean);

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
        and (p_spec->>'subtopic_id' is null or q.subtopic_id = (p_spec->>'subtopic_id')::uuid)
        and (p_spec->>'year' is null or q.year = (p_spec->>'year')::int)
        and (p_spec->>'session' is null or q.session = p_spec->>'session')
        and (p_spec->>'shift' is null or q.shift = p_spec->>'shift')
        and (p_spec->>'difficulty' is null or q.difficulty = (p_spec->>'difficulty')::question_difficulty)
        and (p_spec->>'question_type_id' is null or q.question_type_id = (p_spec->>'question_type_id')::uuid)
        and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
        and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
        and exists (select 1 from question_usage qu
                    where qu.question_id = q.id and qu.tenant_id = v_tenant and qu.is_deleted = false);
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
      and (p_spec->>'subtopic_id' is null or q.subtopic_id = (p_spec->>'subtopic_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (not coalesce((p_spec->>'exclude_used')::boolean, false)
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant and qu.is_deleted = false))
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
      and (p_spec->>'subtopic_id' is null or q.subtopic_id = (p_spec->>'subtopic_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (not coalesce((p_spec->>'exclude_used')::boolean, false)
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant and qu.is_deleted = false))
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
      and (p_spec->>'subtopic_id' is null or q.subtopic_id = (p_spec->>'subtopic_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (not coalesce((p_spec->>'exclude_used')::boolean, false)
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant and qu.is_deleted = false))
    group by q.chapter_id, c.name order by count desc
  ) x;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_topic from (
    select q.topic_id, t.name, count(*)::int as count
    from questions q left join topics t on t.id = q.topic_id
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false and q.verification_status = any (v_statuses)
      and (q.exam_id = v_exam or q.exam_id is null)
      and (p_spec->>'subject_id' is null or q.subject_id = (p_spec->>'subject_id')::uuid)
      and (p_spec->>'chapter_id' is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
      and (p_spec->>'subtopic_id' is null or q.subtopic_id = (p_spec->>'subtopic_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (not coalesce((p_spec->>'exclude_used')::boolean, false)
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant and qu.is_deleted = false))
    group by q.topic_id, t.name order by count desc
  ) x;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_subtopic from (
    select q.subtopic_id, st.name, count(*)::int as count
    from questions q left join subtopics st on st.id = q.subtopic_id
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.is_deleted = false and q.verification_status = any (v_statuses)
      and (q.exam_id = v_exam or q.exam_id is null)
      and (p_spec->>'subject_id' is null or q.subject_id = (p_spec->>'subject_id')::uuid)
      and (p_spec->>'chapter_id' is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
      and (p_spec->>'topic_id' is null or q.topic_id = (p_spec->>'topic_id')::uuid)
      and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
      and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
      and (not coalesce((p_spec->>'exclude_used')::boolean, false)
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant and qu.is_deleted = false))
    group by q.subtopic_id, st.name order by count desc
  ) x;

  -- eligible question ids (bounded) — superset of the 0030 canonical engine
  select array(select q.id from questions q
               where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
                 and q.is_deleted = false and q.verification_status = any (v_statuses)
                 and (q.exam_id = v_exam or q.exam_id is null)
                 and (p_spec->>'subject_id' is null or q.subject_id = (p_spec->>'subject_id')::uuid)
                 and (p_spec->>'chapter_id' is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
                 and (p_spec->>'topic_id' is null or q.topic_id = (p_spec->>'topic_id')::uuid)
                 and (p_spec->>'subtopic_id' is null or q.subtopic_id = (p_spec->>'subtopic_id')::uuid)
                 and (p_spec->>'year' is null or q.year = (p_spec->>'year')::int)
                 and (p_spec->>'session' is null or q.session = p_spec->>'session')
                 and (p_spec->>'shift' is null or q.shift = p_spec->>'shift')
                 and (p_spec->>'difficulty' is null or q.difficulty = (p_spec->>'difficulty')::question_difficulty)
                 and (p_spec->>'question_type_id' is null or q.question_type_id = (p_spec->>'question_type_id')::uuid)
                 and (p_spec->>'is_pyq' is null or q.is_pyq = (p_spec->>'is_pyq')::boolean)
                 and (p_spec->>'ncert' is null or q.ncert = (p_spec->>'ncert')::boolean)
                 and (not coalesce((p_spec->>'exclude_used')::boolean, false)
                      or not exists (select 1 from question_usage qu
                                     where qu.question_id = q.id and qu.tenant_id = v_tenant and qu.is_deleted = false))
               order by random()
               limit v_limit offset (v_page - 1) * v_limit) into v_ids;

  return jsonb_build_object(
    'tenant_id', v_tenant,
    'exam_id', v_exam,
    'eligible_count', v_eligible,
    'question_ids', coalesce(v_ids, '{}'::uuid[]),
    'base_count', v_base,
    'by_verification', v_by_verification,
    'by_exam', v_by_exam,
    'by_filters', v_by_filters,
    'by_used', v_by_used,
    'difficulty_breakdown', v_difficulty,
    'subject_breakdown', v_subject,
    'chapter_breakdown', v_chapter,
    'topic_breakdown', v_topic,
    'subtopic_breakdown', v_subtopic,
    'rejection_reasons', jsonb_build_object(
      'by_verification', v_by_verification,
      'by_exam_scope', v_by_exam,
      'by_usage', v_by_used,
      'base_pool', v_base
    )
  );
end; $$;

grant execute on function app_get_eligible_questions(jsonb) to authenticated;
