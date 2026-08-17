-- Local validation stubs for PostgreSQL (NOT for production).
-- Mirrors the parts of Supabase's auth/storage/roles that the migrations assume.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- The fake authenticated user returned by auth.uid() below must exist so the
-- automatic audit triggers (audit_logs.user_id FK) can fire during migrations.
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-000000000002', 'stub@exampro.test')
on conflict (id) do nothing;

create or replace function auth.uid() returns uuid language sql stable as $$
  select '00000000-0000-0000-0000-000000000002'::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select 'authenticated'::text
$$;
create or replace function auth.email() returns text language sql stable as $$
  select 'test@exampro.test'::text
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean, owner uuid, created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text, name text, owner uuid, metadata jsonb, updated_at timestamptz default now()
);
