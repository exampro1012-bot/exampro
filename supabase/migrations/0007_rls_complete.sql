-- =============================================================================
-- ExamPro — RLS completion & security fixes (Migration 0006)
-- Fixes tables that were created without RLS (platform_admins, system_config),
-- adds policies for every new table, and grants the shared platform question
-- bank read access to all authenticated users (write stays tenant-scoped).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helper: read access to tenant content OR the shared platform bank
-- ----------------------------------------------------------------------------
create or replace function app_can_read_content(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.tenant_id = p_tenant_id and tm.status = 'ACTIVE'
  ) or p_tenant_id = '00000000-0000-0000-0000-000000000001';
$$;

-- ----------------------------------------------------------------------------
-- 1. CRITICAL: platform_admins had NO RLS (any user could self-promote).
-- ----------------------------------------------------------------------------
alter table platform_admins enable row level security;
drop policy if exists platform_admins_admin on platform_admins;
create policy platform_admins_admin on platform_admins for all to authenticated
  using (app_is_platform_admin()) with check (app_is_platform_admin());

-- system_config also had NO RLS. Reads for all authenticated (no secrets in it),
-- writes strictly for platform admins.
alter table system_config enable row level security;
drop policy if exists system_config_read on system_config;
create policy system_config_read on system_config for select to authenticated using (true);
drop policy if exists system_config_admin on system_config;
create policy system_config_admin on system_config for all to authenticated
  using (app_is_platform_admin()) with check (app_is_platform_admin());

-- question_types had RLS enabled but no policy -> DENY ALL for authenticated.
drop policy if exists question_types_read on question_types;
create policy question_types_read on question_types for select to authenticated using (true);
drop policy if exists question_types_admin on question_types;
create policy question_types_admin on question_types for all to authenticated
  using (app_is_platform_admin()) with check (app_is_platform_admin());

-- ----------------------------------------------------------------------------
-- 2. Enable RLS on every new table
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'question_sources','question_reviews','question_duplicates','question_usage',
    'exam_patterns','exam_pattern_sections','omr_templates','omr_sheets','omr_responses',
    'institutions','branches','batches','teachers','student_batches','teacher_assignments',
    'student_notes','dpp_templates'
  ] loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Shared platform-bank read: questions / options / answers / solutions
--    Reads: own tenant OR platform bank (authenticated). Writes: own tenant only.
-- ----------------------------------------------------------------------------
drop policy if exists questions_all on questions;
drop policy if exists questions_write on questions;
drop policy if exists questions_update on questions;
drop policy if exists questions_delete on questions;
create policy questions_all on questions for select to authenticated
  using (app_can_read_content(tenant_id));
create policy questions_write on questions for insert to authenticated
  with check (app_can_access_tenant(tenant_id));
create policy questions_update on questions for update to authenticated
  using (app_can_access_tenant(tenant_id)) with check (app_can_access_tenant(tenant_id));
create policy questions_delete on questions for delete to authenticated
  using (app_can_access_tenant(tenant_id));

do $$
declare t text;
begin
  foreach t in array array['question_options','question_answers','solutions'] loop
    execute format('drop policy if exists %1$I_all on %1$I;', t);
    execute format('drop policy if exists %1$I_read on %1$I;', t);
    execute format('drop policy if exists %1$I_write on %1$I;', t);
    execute format('drop policy if exists %1$I_update on %1$I;', t);
    execute format('drop policy if exists %1$I_delete on %1$I;', t);
    execute format('create policy %1$I_read on %1$I for select to authenticated
      using (app_can_read_content(tenant_id));', t);
    execute format('create policy %1$I_write on %1$I for insert to authenticated
      with check (app_can_access_tenant(tenant_id));', t);
    execute format('create policy %1$I_update on %1$I for update to authenticated
      using (app_can_access_tenant(tenant_id)) with check (app_can_access_tenant(tenant_id));', t);
    execute format('create policy %1$I_delete on %1$I for delete to authenticated
      using (app_can_access_tenant(tenant_id));', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Uniform tenant-scoped policies for every new tenant table
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'question_reviews','question_duplicates','question_usage',
    'exam_patterns','exam_pattern_sections','omr_templates','omr_sheets','omr_responses',
    'institutions','branches','batches','teachers','student_batches','teacher_assignments',
    'student_notes','dpp_templates'
  ] loop
    execute format('drop policy if exists %1$I_all on %1$I;', t);
    execute format('create policy %1$I_all on %1$I for all to authenticated
      using (app_can_access_tenant(tenant_id)) with check (app_can_access_tenant(tenant_id));', t);
  end loop;
end $$;

-- question_sources: global catalog — read for all authenticated, admin mutations.
drop policy if exists question_sources_read on question_sources;
create policy question_sources_read on question_sources for select to authenticated using (true);
drop policy if exists question_sources_admin on question_sources;
create policy question_sources_admin on question_sources for all to authenticated
  using (app_is_platform_admin()) with check (app_is_platform_admin());

-- notifications: recipient is either recipient_user_id or user_id (alias).
drop policy if exists notifications_recipient on notifications;
create policy notifications_recipient on notifications for all to authenticated
  using (recipient_user_id = auth.uid() or user_id = auth.uid())
  with check (recipient_user_id = auth.uid() or user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 5. Tenant auto-fill triggers for new child tables
-- ----------------------------------------------------------------------------
create or replace function trg_tenant_from_pattern() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from exam_patterns where id = NEW.exam_pattern_id; return NEW; end; $$;
create or replace function trg_tenant_from_omrsheet() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from omr_sheets where id = NEW.omr_sheet_id; return NEW; end; $$;
create or replace function trg_tenant_from_studentbatch() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from students where id = NEW.student_id; return NEW; end; $$;
create or replace function trg_tenant_from_teacherassign() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from teachers where id = NEW.teacher_id; return NEW; end; $$;
create or replace function trg_tenant_from_question_usage() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from questions where id = NEW.question_id; return NEW; end; $$;

drop trigger if exists omr_responses_tenant on omr_responses;
create trigger omr_responses_tenant before insert on omr_responses for each row execute function trg_tenant_from_omrsheet();
drop trigger if exists student_batches_tenant on student_batches;
create trigger student_batches_tenant before insert on student_batches for each row execute function trg_tenant_from_studentbatch();
drop trigger if exists teacher_assignments_tenant on teacher_assignments;
create trigger teacher_assignments_tenant before insert on teacher_assignments for each row execute function trg_tenant_from_teacherassign();
drop trigger if exists exam_pattern_sections_tenant on exam_pattern_sections;
create trigger exam_pattern_sections_tenant before insert on exam_pattern_sections for each row execute function trg_tenant_from_pattern();
drop trigger if exists question_usage_tenant on question_usage;
create trigger question_usage_tenant before insert on question_usage for each row execute function trg_tenant_from_question_usage();

-- ----------------------------------------------------------------------------
-- 6. Grants for new tables (matters when run outside the migration runner)
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on schema public to authenticated, anon;