-- =============================================================================
-- ExamPro — Security / helper functions (Migration 0002_helpers)
-- IMPORTANT: created AFTER the tables (0001) because Postgres validates the body
-- of LANGUAGE sql functions at creation time. SECURITY DEFINER + safe search_path
-- so RLS policies can call them without recursive RLS.
-- =============================================================================

-- Current authenticated user id from Supabase Auth JWT.
create or replace function app_current_user_id() returns uuid
language sql stable as $$
  select auth.uid();
$$;

-- Tenant ids the current user belongs to (ACTIVE memberships only), plus the
-- shared platform bank so global reference data and the shared question bank
-- are readable by every authenticated user (matches the engine's
-- `in (v_tenant, platform_bank)` eligibility rule).
create or replace function app_user_tenant_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(tm.tenant_id), '{}'::uuid[])
         || '00000000-0000-0000-0000-000000000001'::uuid
  from tenant_memberships tm
  where tm.user_id = auth.uid() and tm.status = 'ACTIVE';
$$;

-- Does current user belong to a given tenant (ACTIVE)?
create or replace function app_user_belongs_to_tenant(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tenant_memberships tm
    where tm.user_id = auth.uid()
      and tm.tenant_id = p_tenant_id
      and tm.status = 'ACTIVE'
  );
$$;

-- Primary tenant of the current user (earliest ACTIVE membership, if any).
-- NULL when the user has no active membership; RLS compares tenant_id = NULL
-- are never true, so this fails closed rather than leaking data.
create or replace function app_current_tenant_id() returns uuid
language sql stable security definer set search_path = public as $$
  select tm.tenant_id
  from tenant_memberships tm
  where tm.user_id = auth.uid() and tm.status = 'ACTIVE'
  order by tm.created_at
  limit 1;
$$;

-- Is the current user a SUPER_ADMIN (owner) of ANY tenant? Use for in-tenant
-- permission/UI gating only — NEVER for cross-tenant data access.
create or replace function app_is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from tenant_memberships tm
    join roles r on r.id = tm.role_id
    where tm.user_id = auth.uid()
      and tm.status = 'ACTIVE'
      and r.code = 'SUPER_ADMIN'
  );
$$;

-- Is the current user a platform administrator (ExamPro operator)? Gates global
-- catalog mutation and cross-tenant administration.
create or replace function app_is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- Does current user have a permission code (across their active memberships)?
create or replace function app_has_permission(p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select app_is_super_admin() or exists (
    select 1
    from tenant_memberships tm
    join role_permissions rp on rp.role_id = tm.role_id
    where tm.user_id = auth.uid()
      and tm.status = 'ACTIVE'
      and rp.permission_code = p_perm
  );
$$;

-- True if current user is an ACTIVE member of the given tenant. NOTE: a SUPER_ADMIN
-- of one tenant must NOT gain access to other tenants' data, so this is strictly
-- membership-based (no global SUPER_ADMIN bypass). Use app_is_super_admin() only
-- for in-tenant permission/UI gating, not for cross-tenant data access.
create or replace function app_can_access_tenant(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.tenant_id = p_tenant_id and tm.status = 'ACTIVE'
  ) or p_tenant_id = '00000000-0000-0000-0000-000000000001'::uuid;
$$;
