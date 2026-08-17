-- =============================================================================
-- ExamPro — Storage alerts & health tracking (Migration 0023)
-- Tracks Drive API errors, quota warnings, upload/download failures, and
-- storage capacity warnings. Used by the Storage Health Dashboard.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. storage_alerts — records storage-related warnings/errors
-- ----------------------------------------------------------------------------
create table if not exists storage_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  alert_type text not null,          -- QUOTA, API_ERROR, UPLOAD_FAILED, DOWNLOAD_FAILED, CONNECTION, ORPHAN, DUPLICATE, WARNING
  severity text not null default 'WARNING',  -- INFO, WARNING, CRITICAL
  message text not null,
  details jsonb,
  drive_file_id text,
  storage_object_id uuid references storage_objects(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists storage_alerts_tenant_idx on storage_alerts (tenant_id) where tenant_id is not null;
create index if not exists storage_alerts_type_idx on storage_alerts (alert_type);
create index if not exists storage_alerts_created_idx on storage_alerts (created_at desc);
create index if not exists storage_alerts_resolved_idx on storage_alerts (resolved_at) where resolved_at is null;

-- ----------------------------------------------------------------------------
-- 2. RLS policies
-- ----------------------------------------------------------------------------
alter table storage_alerts enable row level security;

drop policy if exists storage_alerts_admin on storage_alerts;
create policy storage_alerts_admin on storage_alerts
  for all to authenticated
  using (app_is_platform_admin())
  with check (app_is_platform_admin());

drop policy if exists storage_alerts_read on storage_alerts;
create policy storage_alerts_read on storage_alerts
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

-- ----------------------------------------------------------------------------
-- 3. Helper: log a storage alert
-- ----------------------------------------------------------------------------
create or replace function app_log_storage_alert(
  p_alert_type text,
  p_message text,
  p_severity text default 'WARNING',
  p_details jsonb default null,
  p_tenant_id uuid default null,
  p_drive_file_id text default null,
  p_storage_object_id uuid default null
) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  insert into storage_alerts (tenant_id, alert_type, severity, message, details, drive_file_id, storage_object_id)
  values (p_tenant_id, p_alert_type, p_severity, p_message, p_details, p_drive_file_id, p_storage_object_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Helper: resolve an alert
-- ----------------------------------------------------------------------------
create or replace function app_resolve_storage_alert(p_alert_id uuid)
returns void
language plpgsql security definer as $$
begin
  update storage_alerts set resolved_at = now(), updated_at = now() where id = p_alert_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Storage health summary function
-- ----------------------------------------------------------------------------
-- storage_objects.object_type is added here (0023) because app_storage_health
-- reads it; the idempotent DO block in 0024 then no-ops.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='storage_objects' and column_name='object_type') then
    alter table storage_objects add column object_type text;
  end if;
end $$;

create index if not exists storage_objects_object_type_idx on storage_objects (object_type) where object_type is not null and is_deleted = false;

create or replace function app_storage_health()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when app_is_platform_admin() then (
    select jsonb_build_object(
      'total_files', (select count(*) from storage_objects where is_deleted = false),
      'total_size_bytes', (select coalesce(sum(size_bytes), 0) from storage_objects where is_deleted = false),
      'source_documents', (select count(*) from storage_objects where is_deleted = false and object_type = 'SOURCE_DOCUMENT'),
      'question_images', (select count(*) from storage_objects where is_deleted = false and object_type = 'QUESTION_IMAGE'),
      'generated_papers', (select count(*) from storage_objects where is_deleted = false and object_type = 'GENERATED_PAPER'),
      'answer_keys', (select count(*) from storage_objects where is_deleted = false and object_type = 'ANSWER_KEY'),
      'solutions', (select count(*) from storage_objects where is_deleted = false and object_type = 'SOLUTION'),
      'omr', (select count(*) from storage_objects where is_deleted = false and object_type = 'OMR'),
      'reports', (select count(*) from storage_objects where is_deleted = false and object_type = 'REPORT'),
      'duplicates', (select count(*) from (
        select sha256 from storage_objects where is_deleted = false and sha256 is not null group by sha256 having count(*) > 1
      ) d),
      'orphan_records', (select count(*) from storage_objects where is_deleted = false and drive_file_id is null),
      'missing_files', (select count(*) from storage_objects where is_deleted = false and drive_file_id is not null and exists (
        select 1 from storage_alerts sa where sa.storage_object_id = storage_objects.id and sa.alert_type = 'ORPHAN' and sa.resolved_at is null
      )),
      'open_alerts', (select count(*) from storage_alerts where resolved_at is null),
      'critical_alerts', (select count(*) from storage_alerts where resolved_at is null and severity = 'CRITICAL'),
      'checked_at', now()
    )
  ) else jsonb_build_object('error', 'forbidden') end;
$$;