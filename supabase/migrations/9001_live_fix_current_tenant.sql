-- add missing helper from 0002_helpers.sql
create or replace function app_current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tm.tenant_id
  from tenant_memberships tm
  where tm.user_id = auth.uid() and tm.status = 'ACTIVE'
  order by tm.created_at
  limit 1;
$$;
