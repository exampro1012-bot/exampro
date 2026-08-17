-- =============================================================================
-- ExamPro — 0046: storage policy + OMR template wiring
-- Additive only.
--
-- 1. storage_policy system configuration (§11 of the storage-repair spec):
--      GOOGLE_DRIVE_REQUIRED (default) — question-bank content must NOT be
--        uploaded anywhere but Google Drive; disconnected Drive BLOCKS
--        production ingestion (no silent Supabase Storage fallback).
--      GOOGLE_DRIVE_PREFERRED — Drive first; Supabase Storage fallback allowed
--        and must be labelled honestly as the actual storage provider.
--      SUPABASE_ONLY — never touch Drive.
-- 2. exam_patterns.omr_template_id — OMR layout selection from the exam
--    configuration (§27): the active pattern may pin the OMR template.
-- 3. RPCs: app_get_storage_policy() / app_set_storage_policy(text) — the
--    setter is platform-admin only; the getter is safe for all authenticated.
-- =============================================================================

insert into system_config (key, value)
values ('storage_policy', '{"default":"GOOGLE_DRIVE_REQUIRED"}'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'omr_template_id') then
    alter table exam_patterns add column omr_template_id uuid
      references omr_templates(id) on delete set null;
  end if;
end $$;

create or replace function app_get_storage_policy()
returns text language sql security definer set search_path = public as $$
  select coalesce(
    (select value->>'default' from system_config where key = 'storage_policy'),
    'GOOGLE_DRIVE_REQUIRED')
$$;

create or replace function app_set_storage_policy(p_policy text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not app_is_platform_admin(auth.uid()) then
    raise exception 'Access denied';
  end if;
  if p_policy not in ('GOOGLE_DRIVE_REQUIRED', 'GOOGLE_DRIVE_PREFERRED', 'SUPABASE_ONLY') then
    raise exception 'Invalid storage policy: %', p_policy;
  end if;
  insert into system_config (key, value) values ('storage_policy', jsonb_build_object('default', p_policy))
    on conflict (key) do update set value = jsonb_build_object('default', p_policy), updated_at = now();
  return p_policy;
end $$;

grant execute on function app_get_storage_policy() to authenticated;
grant execute on function app_set_storage_policy(text) to authenticated;
