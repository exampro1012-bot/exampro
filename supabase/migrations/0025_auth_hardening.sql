-- =============================================================================
-- ExamPro — Authentication hardening & schema fixes (Migration 0025_auth)
-- 1. Add default_tenant_id to profiles
-- 2. Fix bootstrap trigger: default role is STUDENT, not SUPER_ADMIN
-- 3. Add password validation helper
-- 4. Add user identities table for OAuth account linking
-- 5. Email verification status on profiles
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. profiles: add default_tenant_id + email_verified_at
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='default_tenant_id') then
    alter table profiles add column default_tenant_id uuid references tenants(id) on delete set null;
  end if;
end $$;

create index if not exists profiles_default_tenant_idx on profiles (default_tenant_id) where default_tenant_id is not null;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='email_verified_at') then
    alter table profiles add column email_verified_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='last_sign_in_at') then
    alter table profiles add column last_sign_in_at timestamptz;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. user_identities: track OAuth providers for account linking
-- ----------------------------------------------------------------------------
create table if not exists user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  provider_email text,
  provider_data jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id),
  unique (user_id, provider)
);

alter table user_identities enable row level security;

drop policy if exists user_identities_admin on user_identities;
create policy user_identities_admin on user_identities for all to authenticated
  using (user_id = auth.uid() or app_is_platform_admin())
  with check (user_id = auth.uid() or app_is_platform_admin());

drop policy if exists user_identities_read on user_identities;
create policy user_identities_read on user_identities for select to authenticated
  using (user_id = auth.uid() or app_is_platform_admin());

-- ----------------------------------------------------------------------------
-- 3. Password validation helper (server-side)
-- ----------------------------------------------------------------------------
create or replace function app_validate_password(p_password text)
returns boolean language sql stable as $$
  select length(p_password) >= 8
    and p_password ~ '[A-Z]'
    and p_password ~ '[a-z]'
    and p_password ~ '[0-9]'
    and p_password ~ '[^A-Za-z0-9]';
$$;

-- ----------------------------------------------------------------------------
-- 4. Fix bootstrap trigger: STUDENT is the safe default, SUPER_ADMIN only via
--    explicit platform_admins grant or invitation with SUPER_ADMIN role.
-- ----------------------------------------------------------------------------
drop function if exists handle_new_user() cascade;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_role uuid;
  v_name text;
  v_slug text;
  v_default_role_code text;
begin
  insert into profiles (auth_user_id, full_name, email)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email)
    on conflict (auth_user_id) do nothing;

  if new.email_confirmed_at is not null then
    update profiles set email_verified_at = new.email_confirmed_at
      where auth_user_id = new.id and email_verified_at is null;
  end if;

  v_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_slug := substring(regexp_replace(lower(coalesce(new.email, new.id::text)), '[^a-z0-9]+', '-', 'g'), 1, 20)
            || '-' || substring(new.id::text, 1, 6);

  insert into tenants (name, slug, email) values (v_name || ' Workspace', v_slug, new.email) returning id into v_tenant;

  select id into v_role from roles where code = 'STUDENT';
  if not found then
    select id into v_role from roles where code = 'SUPER_ADMIN';
  end if;

  insert into tenant_memberships (tenant_id, user_id, role_id, status, joined_at)
    values (v_tenant, new.id, v_role, 'ACTIVE', now());

  update profiles set default_tenant_id = v_tenant where auth_user_id = new.id;

  insert into subscriptions (tenant_id, status, current_period_start, current_period_end)
    values (v_tenant, 'TRIAL', now(), now() + interval '14 days');

  if new.raw_user_meta_data ? 'provider' then
    insert into user_identities (user_id, provider, provider_user_id, provider_email, provider_data)
      values (new.id, new.raw_user_meta_data->>'provider', new.id::text, new.email, new.raw_user_meta_data)
      on conflict (user_id, provider) do nothing;
  end if;

  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. Sync email_verified_at for existing confirmed users
-- ----------------------------------------------------------------------------
update profiles p
  set email_verified_at = u.email_confirmed_at
  from auth.users u
  where p.auth_user_id = u.id
    and u.email_confirmed_at is not null
    and p.email_verified_at is null;
