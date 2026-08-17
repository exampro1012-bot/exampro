-- =============================================================================
-- 0047 — Role test accounts support + FK enforcement on student references
-- Additive and idempotent. Safe on a live database with production data.
--
-- 1. exam_sessions.student_id / results.student_id held auth-user ids with
--    NO foreign key (spec §13). Orphan ids are nulled (preserving rows),
--    then FKs to auth.users are added with ON DELETE SET NULL.
-- 2. QUESTION_REVIEWER and CONTENT_EDITOR roles (spec §30/§33) with the
--    permission sets of the existing REVIEWER / DATA_OPERATOR roles.
-- 3. app_admin_set_user_role() — platform-admin-gated, audited RPC used by
--    scripts/seed-test-users.mjs to assign roles to test accounts without a
--    service-role key. Never trusts email strings for authorization.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a. Null out orphan student references (rows preserved, references honest)
-- -----------------------------------------------------------------------------
update exam_sessions
   set student_id = null
 where student_id is not null
   and not exists (select 1 from auth.users u where u.id = exam_sessions.student_id);

update results
   set student_id = null
 where student_id is not null
   and not exists (select 1 from auth.users u where u.id = results.student_id);

-- 1b. Add the FKs (idempotent via pg_constraint check)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_sessions_student_id_fkey') then
    alter table exam_sessions
      add constraint exam_sessions_student_id_fkey
      foreign key (student_id) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'results_student_id_fkey') then
    alter table results
      add constraint results_student_id_fkey
      foreign key (student_id) references auth.users(id) on delete set null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. QUESTION_REVIEWER + CONTENT_EDITOR roles + permission grants
--    (permissions mirror REVIEWER and DATA_OPERATOR respectively)
-- -----------------------------------------------------------------------------
insert into roles (code, name, description) values
  ('QUESTION_REVIEWER', 'Question Reviewer', 'Reviews/verifies questions, keys and solutions'),
  ('CONTENT_EDITOR',   'Content Editor',    'Content ingestion, editing and classification')
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, rp.permission_code
  from roles r
  join role_permissions rp on rp.role_id = (
        select id from roles where code = 'REVIEWER' limit 1)
 where r.code = 'QUESTION_REVIEWER'
on conflict (role_id, permission_code) do nothing;

insert into role_permissions (role_id, permission_code)
select r.id, rp.permission_code
  from roles r
  join role_permissions rp on rp.role_id = (
        select id from roles where code = 'DATA_OPERATOR' limit 1)
 where r.code = 'CONTENT_EDITOR'
on conflict (role_id, permission_code) do nothing;

-- -----------------------------------------------------------------------------
-- 3. app_admin_set_user_role — audited role assignment (platform admins only)
-- -----------------------------------------------------------------------------
create or replace function app_admin_set_user_role(p_user_email text, p_role_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid;
  v_role uuid;
  v_role_code text;
  v_membership record;
  v_before jsonb;
begin
  if not app_is_platform_admin() then
    raise exception 'Platform admin required';
  end if;

  select u.id into v_user from auth.users u
   where lower(u.email) = lower(p_user_email) limit 1;
  if v_user is null then
    raise exception 'User not found: %', p_user_email;
  end if;

  select r.id, r.code into v_role, v_role_code
    from roles r where r.code = upper(p_role_code) limit 1;
  if v_role is null then
    raise exception 'Unknown role code: %', p_role_code;
  end if;

  -- The user's own (auto-provisioned workspace) membership is the default
  -- target; institutions can later invite the same user into their tenants.
  select m.id, m.tenant_id, m.role_id into v_membership
    from tenant_memberships m
   where m.user_id = v_user
   order by m.created_at asc
   limit 1;
  if v_membership is null then
    raise exception 'User has no tenant membership: %', p_user_email;
  end if;

  select jsonb_build_object('role_id', v_membership.role_id) into v_before;

  update tenant_memberships
     set role_id = v_role, status = 'ACTIVE', joined_at = coalesce(joined_at, now())
   where id = v_membership.id;

  if v_role_code = 'SUPER_ADMIN' then
    insert into platform_admins (user_id, granted_by)
    values (v_user, auth.uid())
    on conflict (user_id) do nothing;
  end if;

  insert into audit_logs (tenant_id, user_id, action, entity, entity_id, before, after)
  values (v_membership.tenant_id, auth.uid(), 'ROLE_SET', 'tenant_memberships',
          v_membership.id, v_before,
          jsonb_build_object('role_code', v_role_code, 'user_id', v_user));

  return jsonb_build_object(
    'user_id', v_user,
    'role_code', v_role_code,
    'tenant_id', v_membership.tenant_id
  );
end $$;

revoke all on function app_admin_set_user_role(text, text) from public, anon;
grant execute on function app_admin_set_user_role(text, text) to authenticated;
