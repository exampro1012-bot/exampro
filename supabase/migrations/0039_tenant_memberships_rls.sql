-- Fix: tenant_memberships had RLS enabled but no policies, so the
-- authenticated client could not read its own row. This broke identity
-- resolution (EP.state.tenantId stayed null) and every tenant-scoped write.
-- Allow each user to manage only their own membership rows.

alter table public.tenant_memberships enable row level security;

drop policy if exists tm_user_select on public.tenant_memberships;
drop policy if exists tm_user_insert on public.tenant_memberships;
drop policy if exists tm_user_update on public.tenant_memberships;
drop policy if exists tm_user_delete on public.tenant_memberships;

create policy tm_user_select on public.tenant_memberships
  for select using (user_id = auth.uid());

create policy tm_user_insert on public.tenant_memberships
  for insert with check (user_id = auth.uid());

create policy tm_user_update on public.tenant_memberships
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy tm_user_delete on public.tenant_memberships
  for delete using (user_id = auth.uid());
