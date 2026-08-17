-- =============================================================================
-- ExamPro — Row Level Security (Migration 0003_rls)
-- Runs AFTER 0002_helpers (helper functions) and AFTER 0001 (tables).
-- Tenant-scoped tables carry tenant_id -> uniform policies.
-- A few tables are special (self-referencing, global catalogs, user-scoped).
-- =============================================================================

-- Enable RLS on every application table (idempotent).
do $$
declare
  t text;
  all_tables text[] := array[
    'tenants','profiles','roles','permissions','role_permissions','plans',
    'subscriptions','usage','exams','subjects','chapters','topics','subtopics',
    'question_types','questions','question_options','question_answers','solutions',
    'question_images','practice_logs','bookmarks','question_reports','tags','question_tags',
    'papers','paper_questions','exam_sessions','responses','results','students',
    'student_groups','student_group_members','dpps','dpp_questions','dpp_assignments',
    'blueprint_rules','notifications','audit_logs','security_events','import_jobs',
    'import_job_items','storage_objects','question_pack_manifests','payments','invoices'
  ];
begin
  foreach t in array all_tables loop
    execute format('alter table %I enable row level security;', t);
  end loop;
end $$;

-- Uniform tenant-scoped policies.
do $$
declare
  t text;
  gpol text[] := array[
    'subscriptions','usage','exams','subjects','chapters','topics','subtopics',
    'questions','question_options','question_answers','solutions','question_images',
    'question_tags','papers','paper_questions','exam_sessions','responses','results',
    'students','student_groups','student_group_members','dpps','dpp_questions',
    'dpp_assignments','blueprint_rules','import_jobs','import_job_items',
    'storage_objects','question_pack_manifests','payments','invoices','question_reports'
  ];
begin
  foreach t in array gpol loop
    execute format('drop policy if exists %1$I_all on %1$I;', t);
    execute format('create policy %1$I_all on %1$I for all to authenticated
      using (app_can_access_tenant(tenant_id)) with check (app_can_access_tenant(tenant_id));', t);
  end loop;
end $$;

-- tenants: members read their own tenant; only SUPER_ADMIN mutates.
drop policy if exists tenants_sel on tenants;
create policy tenants_sel on tenants for select to authenticated using (app_can_access_tenant(id));
drop policy if exists tenants_admin on tenants;
create policy tenants_admin on tenants for all to authenticated using (app_is_platform_admin()) with check (app_is_platform_admin());

-- profiles: own profile, tenant peers, or SUPER_ADMIN.
drop policy if exists profiles_sel on profiles;
create policy profiles_sel on profiles for select to authenticated
  using (auth_user_id = auth.uid() or app_is_platform_admin()
         or exists (select 1 from tenant_memberships tm
                    where tm.user_id = profiles.auth_user_id and app_user_belongs_to_tenant(tm.tenant_id)));
drop policy if exists profiles_ins on profiles;
create policy profiles_ins on profiles for insert to authenticated with check (auth_user_id = auth.uid() or app_is_platform_admin());
drop policy if exists profiles_upd on profiles;
create policy profiles_upd on profiles for update to authenticated
  using (auth_user_id = auth.uid() or app_is_platform_admin()) with check (auth_user_id = auth.uid() or app_is_platform_admin());
drop policy if exists profiles_del on profiles;
create policy profiles_del on profiles for delete to authenticated using (app_is_platform_admin());

-- roles / permissions / role_permissions: global config catalog.
do $$
declare t text;
begin
  foreach t in array array['roles','permissions','role_permissions'] loop
    execute format('drop policy if exists %1$I_read on %1$I;', t);
    execute format('create policy %1$I_read on %1$I for select to authenticated using (true);', t);
    execute format('drop policy if exists %1$I_admin on %1$I;', t);
    execute format('create policy %1$I_admin on %1$I for all to authenticated using (app_is_platform_admin()) with check (app_is_platform_admin());', t);
  end loop;
end $$;

-- plans: public catalog (read); only SUPER_ADMIN mutates.
drop policy if exists plans_read on plans;
create policy plans_read on plans for select to authenticated using (true);
drop policy if exists plans_admin on plans;
create policy plans_admin on plans for all to authenticated using (app_is_platform_admin()) with check (app_is_platform_admin());

-- tags: shared taxonomy. Any authenticated user may read and create; cleanup by SUPER_ADMIN.
drop policy if exists tags_read on tags;
create policy tags_read on tags for select to authenticated using (true);
drop policy if exists tags_write on tags;
create policy tags_write on tags for insert to authenticated with check (true);
drop policy if exists tags_admin on tags;
create policy tags_admin on tags for update to authenticated using (app_is_platform_admin()) with check (app_is_platform_admin());
drop policy if exists tags_del on tags;
create policy tags_del on tags for delete to authenticated using (app_is_platform_admin());

-- practice_logs / bookmarks: strictly the owning user.
do $$
declare t text;
begin
  foreach t in array array['practice_logs','bookmarks'] loop
    execute format('drop policy if exists %1$I_owner on %1$I;', t);
    execute format('create policy %1$I_owner on %1$I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
  end loop;
end $$;

-- notifications: only the recipient.
drop policy if exists notifications_recipient on notifications;
create policy notifications_recipient on notifications for all to authenticated
  using (recipient_user_id = auth.uid()) with check (recipient_user_id = auth.uid());

-- audit_logs / security_events: SUPER_ADMIN only.
drop policy if exists audit_logs_admin on audit_logs;
create policy audit_logs_admin on audit_logs for select to authenticated using (app_is_platform_admin());
drop policy if exists security_events_admin on security_events;
create policy security_events_admin on security_events for all to authenticated using (app_is_platform_admin()) with check (app_is_platform_admin());
