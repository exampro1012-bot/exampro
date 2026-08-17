-- =============================================================================
-- rls_isolation_test.sql — run against a FRESH local database after applying
-- _local_stubs.sql + all migrations (0014 included), with NO other test files.
--
--   createdb exampro_rls   (or drop/recreate exampro_test)
--   psql -d exampro_rls -f _local_stubs.sql   (roles + auth.stubs)
--   psql -d exampro_rls -f 0014...            (all migrations in order)
--   psql -d exampro_rls -f rls_isolation_test.sql
--
-- RLS is exercised for real: queries run as role `authenticated` (never the
-- table owner), while auth.uid() is driven by the app.test_uid setting.
-- =============================================================================
\timing off

-- 0. Auth stub that follows a per-transaction setting so we can impersonate
--    different users in one session.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.test_uid', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select 'authenticated'
$$;

-- Grant table access to the `authenticated` role (mimics Supabase grants).
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;
do $$
declare r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public' and tablename not like 'pg_%'
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tablename);
  end loop;
  for r in
    select sequence_name from information_schema.sequences where sequence_schema = 'public'
  loop
    execute format('grant usage, select on public.%I to authenticated', r.sequence_name);
  end loop;
  grant execute on all functions in schema public to authenticated;
end $$;

-- 1. Provision users + tenants (run as owner; engine functions are SECURITY
--    DEFINER so they follow auth.uid() while the direct-table tests run as
--    `authenticated`).
create or replace function rls_provision() returns void language plpgsql as $$
declare
  u_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  u_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  u_std uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  t_a uuid; t_b uuid;
  role_staff uuid; role_std uuid; role_sa uuid;
  v_exam uuid; v_subj uuid; v_qtype uuid;
  q_a uuid; q_b uuid;
  r_a uuid;
begin
  insert into auth.users (id, email) values (u_a, 'a@t1.edu'), (u_b, 'b@t2.edu'), (u_std, 'std@t1.edu')
    on conflict do nothing;

  -- tenants A and B with distinct staff memberships
  insert into tenants (id, name, slug, status) values
    (gen_random_uuid(), 'Tenant A', 'tenant-a', 'ACTIVE'),
    (gen_random_uuid(), 'Tenant B', 'tenant-b', 'ACTIVE');
  select id into t_a from tenants where slug = 'tenant-a';
  select id into t_b from tenants where slug = 'tenant-b';
  select id into role_sa from roles where code = 'SUPER_ADMIN';
  select id into role_staff from roles where code = 'TEACHER';
  select id into role_std from roles where code = 'STUDENT';
  insert into tenant_memberships (tenant_id, user_id, role_id, status) values
    (t_a, u_a, role_sa, 'ACTIVE'),
    (t_b, u_b, role_sa, 'ACTIVE'),
    (t_a, u_std, role_std, 'ACTIVE');

  -- per-tenant question banks
  select id into v_exam from exams where code = 'jee-main' and tenant_id = '00000000-0000-0000-0000-000000000001';
  select id into v_subj from subjects where code = 'physics' and tenant_id = '00000000-0000-0000-0000-000000000001' limit 1;
  select id into v_qtype from question_types where code = 'MCQ_SINGLE';

  insert into questions (id, tenant_id, exam_id, subject_id, question_type_id, question_text, difficulty, verification_status, is_deleted, created_by)
  values (gen_random_uuid(), t_a, v_exam, v_subj, v_qtype, 'RLS QUESTION OF TENANT A', 'EASY', 'VERIFIED', false, u_a)
  returning id into q_a;
  insert into questions (id, tenant_id, exam_id, subject_id, question_type_id, question_text, difficulty, verification_status, is_deleted, created_by)
  values (gen_random_uuid(), t_b, v_exam, v_subj, v_qtype, 'RLS QUESTION OF TENANT B', 'EASY', 'VERIFIED', false, u_b)
  returning id into q_b;
  insert into questions (tenant_id, exam_id, subject_id, question_type_id, question_text, difficulty, verification_status, is_deleted, created_by)
  values ('00000000-0000-0000-0000-000000000001', v_exam, v_subj, v_qtype, 'PLATFORM SHARED QUESTION', 'EASY', 'VERIFIED', false, null);

  -- one exam session + result for the student
  insert into papers (id, tenant_id, exam_id, title, duration_minutes, total_questions, total_marks, status, created_by)
  values (gen_random_uuid(), t_a, v_exam, 'RLS Paper A', 60, 1, 4, 'LOCKED', u_a) returning id into r_a;
  insert into exam_sessions (id, tenant_id, paper_id, student_id, status)
  values (gen_random_uuid(), t_a, r_a, u_std, 'SUBMITTED');
  insert into results (tenant_id, exam_session_id, student_id, marks, total_marks, percentage)
  select t_a, id, u_std, 4, 4, 100 from exam_sessions where student_id = u_std and tenant_id = t_a;

  raise notice 'PROVISION: tenantA=% tenantB=% qA=% qB=%', t_a, t_b, q_a, q_b;
end $$;
select rls_provision();

-- =============================================================================
-- 1. Tenant isolation: staff of A must NOT see questions of B
-- =============================================================================
do $$
declare v_count int; v_q text;
begin
  set role authenticated;
  perform set_config('app.test_uid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

  select count(*) into v_count from questions where question_text = 'RLS QUESTION OF TENANT B';
  if v_count <> 0 then raise exception 'TENANT A SEES TENANT B QUESTION (RLS leak)'; end if;

  select count(*) into v_count from questions where question_text = 'RLS QUESTION OF TENANT A';
  if v_count <> 1 then raise exception 'TENANT A CANNOT SEE OWN QUESTION'; end if;

  -- platform bank readable by everyone
  select count(*) into v_count from questions where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v_count = 0 then raise exception 'PLATFORM BANK NOT READABLE'; end if;

  -- switch to B: B must not see A's question
  perform set_config('app.test_uid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
  select count(*) into v_count from questions where question_text = 'RLS QUESTION OF TENANT A';
  if v_count <> 0 then raise exception 'TENANT B SEES TENANT A QUESTION (RLS leak)'; end if;

  reset role;
  raise notice 'OK 1: tenant isolation (A<->B) verified';
end $$;

-- =============================================================================
-- 2. Cross-tenant writes blocked by RLS
-- =============================================================================
do $$
declare v_count int;
begin
  set role authenticated;
  perform set_config('app.test_uid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);

  begin
    insert into questions (tenant_id, exam_id, question_text, verification_status, is_deleted, created_by)
    values ((select id from tenants where slug = 'tenant-b'),
            (select id from exams where code = 'jee-main' limit 1),
            'INTRUSION FROM A', 'VERIFIED', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    raise exception 'CROSS-TENANT INSERT ALLOWED (RLS write leak)';
  exception when insufficient_privilege then
    null; -- expected: policy denies
  end;

  reset role;
  raise notice 'OK 2: cross-tenant write blocked';
end $$;

-- =============================================================================
-- 3. Student-only users: own results/sessions only, staff sees tenant-wide
-- =============================================================================
do $$
declare
  v_n_own int; v_n_all int;
  v_uid_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_uid_std uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_std uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
begin
  set role authenticated;

  perform set_config('app.test_uid', v_uid_std::text, false);
  select count(*) into v_n_own from results;
  if v_n_own <> 1 then raise exception 'STUDENT SEES % RESULTS (expected own only=1)', v_n_own; end if;

  perform set_config('app.test_uid', v_uid_staff::text, false);
  select count(*) into v_n_all from results;
  if v_n_all <> 1 then raise exception 'STAFF SEES % RESULTS (expected tenant-wide=1)', v_n_all; end if;

  -- student cannot create a result row for another user (switch back to student)
  perform set_config('app.test_uid', v_uid_std::text, false);
  begin
    insert into results (tenant_id, exam_session_id, student_id, marks, total_marks, percentage)
    select tenant_id, id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 4, 4, 100
    from exam_sessions limit 1;
    raise exception 'STUDENT WROTE RESULT FOR ANOTHER USER';
  exception when insufficient_privilege then
    null;
  end;

  reset role;
  raise notice 'OK 3: student-only isolation + staff tenant-wide visibility verified';
end $$;

-- =============================================================================
-- 4. FK integrity: dangling taxonomy references rejected
-- =============================================================================
do $$
declare v_ok boolean := false;
begin
  set role authenticated;
  perform set_config('app.test_uid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
  begin
    insert into questions (tenant_id, subject_id, question_text, verification_status, is_deleted, created_by)
    values ((select id from tenants where slug = 'tenant-a'),
            '00000000-0000-0000-0000-00000000dead', 'FK TEST', 'PENDING_REVIEW', false,
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  exception when foreign_key_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception 'FK VIOLATION NOT REJECTED'; end if;
  reset role;
  raise notice 'OK 4: foreign key integrity enforced';
end $$;

-- =============================================================================
-- 5. Engine is server-authoritative: quota enforced
-- =============================================================================
do $$
declare
  v_res jsonb; v_i int; v_exam uuid; v_tenant uuid; v_uid uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
begin
  select id into v_exam from exams where code = 'jee-main' limit 1;
  select tm.tenant_id into v_tenant from tenant_memberships tm where tm.user_id = v_uid limit 1;

  -- force tiny quota
  update system_config set value = jsonb_build_object('PAPERS_GENERATED', 1, 'DPP_GENERATED', 1)
    where key = 'free_quota';

  -- seed one eligible question in tenant A so generation can succeed once
  insert into questions (tenant_id, exam_id, subject_id, question_type_id, question_text, difficulty, verification_status, is_deleted, created_by)
  select v_tenant, v_exam,
         (select id from subjects where code='physics' and tenant_id='00000000-0000-0000-0000-000000000001' limit 1),
         (select id from question_types where code='MCQ_SINGLE'), 'QUOTA QUESTION', 'EASY', 'VERIFIED', false, v_uid
  where not exists (select 1 from questions where question_text = 'QUOTA QUESTION');

  set role authenticated;
  perform set_config('app.test_uid', v_uid::text, false);

  v_res := app_generate_paper(jsonb_build_object('exam_id', v_exam, 'count', 1, 'title', 'Quota 1', 'marks', 4, 'negative_marks', 1));
  if v_res ? 'error' then raise exception 'QUOTA OK RUN FAILED: %', v_res; end if;

  v_res := app_generate_paper(jsonb_build_object('exam_id', v_exam, 'count', 1, 'title', 'Quota 2', 'marks', 4, 'negative_marks', 1));
  if not (v_res ? 'error' and v_res->>'error' like 'Free paper quota reached%') then
    raise exception 'QUOTA NOT ENFORCED: %', v_res;
  end if;
  reset role;

  -- restore quota
  update system_config set value = jsonb_build_object('PAPERS_GENERATED', 5, 'DPP_GENERATED', 10)
    where key = 'free_quota';
  raise notice 'OK 5: quota gate enforced server-side';
end $$;

-- =============================================================================
-- 6. Hash auto-maintenance + verify flow
-- =============================================================================
do $$
declare
  v_id uuid; v_hash text; v_uid uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; v_res jsonb;
begin
  set role authenticated;
  perform set_config('app.test_uid', v_uid::text, false);

  insert into questions (tenant_id, question_text, verification_status, is_deleted, created_by)
  select id, 'HASHED QUESTION TEXT', 'PENDING_REVIEW', false, v_uid from tenants where slug = 'tenant-a'
  returning id into v_id;
  select question_hash into v_hash from questions where id = v_id;
  if v_hash is null or length(v_hash) <> 32 then raise exception 'question_hash NOT auto-set (got %)', v_hash; end if;

  v_res := app_verify_question(v_id, 'VERIFIED', 'auto test');
  if v_res ? 'error' then raise exception 'VERIFY FAILED: %', v_res; end if;

  reset role;
  raise notice 'OK 6: hash maintenance + verify flow verified';
end $$;

-- =============================================================================
-- 7. Engine grants + rpc surface sanity
-- =============================================================================
do $$
declare v_ok boolean;
begin
  select count(*) > 0 into v_ok from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('app_generate_paper','app_generate_dpp','app_finalize_session','app_save_response',
       'app_import_questions_batch','app_create_tenant','app_update_tenant_status','app_security_events');
  if not v_ok then raise exception 'ENGINE SURFACE INCOMPLETE'; end if;
  raise notice 'OK 7: engine RPC surface present';
end $$;

-- =============================================================================
-- 8. Student-only members cannot write management/content tables (0026)
-- =============================================================================
do $$
declare
  v_t uuid; v_tbl text; v_wrote boolean; v_denied int := 0;
  v_check text;
begin
  select id into v_t from tenants where slug = 'tenant-a';

  set role authenticated;
  perform set_config('app.test_uid', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);

  -- attempt writes as the student-only member of tenant-a
  v_check := 'insert into institutions (tenant_id, name, status) values (' || quote_literal(v_t) || ', ''X'', ''ACTIVE'')';
  begin
    execute v_check;
    raise exception 'STUDENT WROTE institutions (0026 not applied)';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  v_check := 'insert into questions (tenant_id, question_text, verification_status) values (' || quote_literal(v_t) || ', ''X'', ''PENDING_REVIEW'')';
  begin
    execute v_check;
    raise exception 'STUDENT WROTE questions (0026 not applied)';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  v_check := 'insert into papers (tenant_id, title) values (' || quote_literal(v_t) || ', ''X'')';
  begin
    execute v_check;
    raise exception 'STUDENT WROTE papers (0026 not applied)';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  v_check := 'insert into omr_templates (tenant_id, name, options_per_question) values (' || quote_literal(v_t) || ', ''X'', 4)';
  begin
    execute v_check;
    raise exception 'STUDENT WROTE omr_templates (0026 not applied)';
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  reset role;

  if v_denied < 4 then raise exception '0026 student write block incomplete (denied=%)', v_denied; end if;
  raise notice 'OK 8: student-only write block enforced (0026)';
end $$;