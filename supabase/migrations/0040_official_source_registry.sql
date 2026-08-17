-- =============================================================================
-- ExamPro — Official Source Registry + Syllabus Registry (Migration 0040/0041)
-- Enables Super-Admin management of allowed official crawl domains, crawler
-- logs, and syllabus versioning for historical vs current question mapping.
-- Apply with: supabase db push  (or the project's migration runner).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. official_source_domains  (the Official Source Registry)
-- -----------------------------------------------------------------------------
create table if not exists official_source_domains (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references tenants(id) on delete cascade,
  domain          text not null,
  exam            text not null,                       -- JEE_MAIN | JEE_ADVANCED | NEET | CUET | ...
  authority       text not null default 'OFFICIAL',   -- OFFICIAL | SECONDARY
  allowed         boolean not null default true,
  crawl_policy    text not null default 'RESPECTFUL', -- RESPECTFUL | DISABLED | ARCHIVE_ONLY
  last_checked    timestamptz,
  last_status     int,                                -- last HTTP status seen
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, domain, exam)
);

create index if not exists official_source_domains_domain_idx on official_source_domains (domain);
create index if not exists official_source_domains_exam_idx   on official_source_domains (exam);

alter table official_source_domains enable row level security;

drop policy if exists official_source_domains_admin on official_source_domains;
create policy official_source_domains_admin on official_source_domains
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists official_source_domains_read on official_source_domains;
create policy official_source_domains_read on official_source_domains
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

-- Seed the canonical NTA / NMC / JEE Advanced official domains from the spec
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'nta.ac.in',            'JEE_MAIN',      'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='nta.ac.in' and exam='JEE_MAIN');
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'jeemain.nta.nic.in',   'JEE_MAIN',      'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='jeemain.nta.nic.in' and exam='JEE_MAIN');
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'neet.nta.nic.in',      'NEET',          'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='neet.nta.nic.in' and exam='NEET');
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'jeeadv.ac.in',         'JEE_ADVANCED',  'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='jeeadv.ac.in' and exam='JEE_ADVANCED');
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'nmc.org.in',           'NEET',          'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='nmc.org.in' and exam='NEET');

-- -----------------------------------------------------------------------------
-- 2. source_crawler_log  (respectful discovery audit trail)
-- -----------------------------------------------------------------------------
create table if not exists source_crawler_log (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references tenants(id) on delete cascade,
  domain_id       uuid references official_source_domains(id) on delete set null,
  domain          text,
  url             text,
  checked_at      timestamptz not null default now(),
  http_status     int,
  document_found  boolean,
  document_hash   text,
  download_status text,     -- NOT_ATTEMPTED | SKIPPED | DOWNLOADED | FAILED
  parse_status    text,
  error           text,
  created_by      uuid references auth.users(id) on delete set null
);

create index if not exists source_crawler_log_domain_idx on source_crawler_log (domain);
create index if not exists source_crawler_log_checked_idx on source_crawler_log (checked_at desc);

alter table source_crawler_log enable row level security;

drop policy if exists source_crawler_log_admin on source_crawler_log;
create policy source_crawler_log_admin on source_crawler_log
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists source_crawler_log_read on source_crawler_log;
create policy source_crawler_log_read on source_crawler_log
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

-- -----------------------------------------------------------------------------
-- 3. syllabus_versions  (historical vs current syllabus mapping)
-- -----------------------------------------------------------------------------
create table if not exists syllabus_versions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references tenants(id) on delete cascade,
  exam_id           uuid references exams(id) on delete set null,
  authority         text not null,     -- NTA | NMC | JEE_ADVANCED | ...
  year              int not null,
  effective_date    date,
  version           text,
  source_url        text,
  source_document_id uuid references source_documents(id) on delete set null,
  can_lookup         boolean not null default false,
  status            text not null default 'DRAFT',  -- DRAFT | ACTIVE | ARCHIVED
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, exam_id, authority, year, version)
);

create index if not exists syllabus_versions_exam_idx on syllabus_versions (exam_id);
create index if not exists syllabus_versions_year_idx on syllabus_versions (year);

alter table syllabus_versions enable row level security;

drop policy if exists syllabus_versions_admin on syllabus_versions;
create policy syllabus_versions_admin on syllabus_versions
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists syllabus_versions_read on syllabus_versions;
create policy syllabus_versions_read on syllabus_versions
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

-- -----------------------------------------------------------------------------
-- 4. question_syllabus_map  (per-question syllabus version linkage)
-- -----------------------------------------------------------------------------
create table if not exists question_syllabus_map (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references tenants(id) on delete cascade,
  question_id       uuid references questions(id) on delete cascade,
  syllabus_version_id uuid references syllabus_versions(id) on delete set null,
  syllabus_status   text not null default 'UNCERTAIN', -- CURRENT | HISTORICAL | REMOVED | MODIFIED | NOT_IN_CURRENT_SYLLABUS | UNCERTAIN
  mapped_by         uuid references auth.users(id) on delete set null,
  mapped_at         timestamptz not null default now(),
  unique (question_id, syllabus_version_id)
);

create index if not exists question_syllabus_map_q_idx on question_syllabus_map (question_id);
create index if not exists question_syllabus_map_sv_idx on question_syllabus_map (syllabus_version_id);

alter table question_syllabus_map enable row level security;

drop policy if exists question_syllabus_map_admin on question_syllabus_map;
create policy question_syllabus_map_admin on question_syllabus_map
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists question_syllabus_map_read on question_syllabus_map;
create policy question_syllabus_map_read on question_syllabus_map
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());
