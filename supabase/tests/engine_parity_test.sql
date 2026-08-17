-- 0014 parity tests: no-repeat engine, batch import, tenant admin, security events
-- Uses the bootstrap trigger workspace of the stub auth user (like engine_test2.sql).
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, role text);
create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;

insert into auth.users (id,email) values ('11111111-1111-1111-1111-111111111111','owner@test.edu') on conflict do nothing;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_tenant uuid;
  v_exam uuid; v_subj uuid; v_qtype uuid; v_chap uuid; i int;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = v_user order by tm.created_at limit 1;
  if v_tenant is null then raise exception 'bootstrap did not create workspace'; end if;

  -- promote to platform admin so tenant-management RPCs can be exercised
  insert into platform_admins (user_id) values (v_user) on conflict do nothing;

  -- 0025 auth hardening makes STUDENT the safe default bootstrap role; the
  -- import RPC correctly requires a non-student role, so promote the test
  -- user's membership in the bootstrap workspace to SUPER_ADMIN.
  update tenant_memberships tm set role_id = r.id
    from roles r where r.code = 'SUPER_ADMIN'
    and tm.user_id = v_user and tm.status = 'ACTIVE';

  select id into v_exam from exams where code='jee-main';
  select id into v_subj from subjects where exam_id=v_exam and code='physics';
  select id into v_chap from chapters where subject_id=v_subj and code='kinematics';
  select id into v_qtype from question_types where code='MCQ_SINGLE';
  for i in 1..40 loop
    insert into questions (tenant_id,exam_id,subject_id,chapter_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by)
      values (v_tenant,v_exam,v_subj,v_chap,v_qtype,'TQ '||i,2024,'MEDIUM','VERIFIED',false,v_user)
      on conflict do nothing;
    insert into question_options (tenant_id,question_id,option_key,option_text,is_correct,display_order)
      select v_tenant,q.id,k,'Opt '||k,(k='A'),n from questions q,(values('A',1),('B',2),('C',3),('D',4)) o(k,n) where q.question_text='TQ '||i
      on conflict do nothing;
    insert into question_answers (tenant_id,question_id,correct_option_keys)
      select v_tenant,q.id,array['A'] from questions q where q.question_text='TQ '||i
      on conflict do nothing;
  end loop;
  raise notice 'SETUP OK: tenant=%', v_tenant;
end $$;

-- ---------------------------------------------------------------------------
-- 1. No-repeat engine
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; r2 jsonb; r3 jsonb;
  paper1 uuid; paper2 uuid;
begin
  r := app_generate_paper(jsonb_build_object(
    'exam_id', (select id from exams where code = 'jee-main' limit 1),
    'count', 10, 'title', 'NR-Test-A', 'marks', 4, 'negative_marks', 1));
  if r ? 'error' then raise exception 'paper1 generation failed: %', r->>'error'; end if;
  raise notice 'NR PAPER1: %', r;
  paper1 := (r->>'paper_id')::uuid;

  r2 := app_generate_paper(jsonb_build_object(
    'exam_id', (select id from exams where code = 'jee-main' limit 1),
    'count', 10, 'title', 'NR-Test-B', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('exclude_used', 'true')));
  if r2 ? 'error' then raise exception 'paper2 generation failed: %', r2->>'error'; end if;
  raise notice 'NR PAPER2 (no-repeat): %', r2;
  paper2 := (r2->>'paper_id')::uuid;

  if exists (
    select 1 from paper_questions a join paper_questions b on a.question_id = b.question_id
    where a.paper_id = paper1 and b.paper_id = paper2
  ) then
    raise exception 'no-repeat violated: overlapping questions between paper1 and paper2';
  end if;
  raise notice 'NR: no overlap confirmed';

  r3 := app_generate_paper(jsonb_build_object(
    'exam_id', (select id from exams where code = 'jee-main' limit 1),
    'count', 10, 'title', 'NR-Test-C', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('exclude_paper_ids', jsonb_build_array(paper1))));
  if r3 ? 'error' then raise exception 'paper3 generation failed: %', r3->>'error'; end if;
  if exists (
    select 1 from paper_questions a join paper_questions b on a.question_id = b.question_id
    where a.paper_id = paper1 and b.paper_id = (r3->>'paper_id')::uuid
  ) then
    raise exception 'exclude_paper_ids violated';
  end if;
  raise notice 'NR: exclude_paper_ids confirmed';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Batch import RPC
-- ---------------------------------------------------------------------------
do $$
declare
  res jsonb;
  v_tenant uuid;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;

  res := app_import_questions_batch(jsonb_build_array(
    jsonb_build_object(
      'question_text', 'Batch import question 1: value of g?',
      'exam_code', 'jee-main', 'subject_code', 'physics', 'chapter_code', 'kinematics',
      'topic_code', 'KINEMATICS', 'question_type_code', 'MCQ_SINGLE',
      'difficulty', 'EASY', 'marks', 4, 'negative_marks', 1, 'year', 2024,
      'source', 'SAMPLE',
      'options', jsonb_build_array(
        jsonb_build_object('option_key', 'A', 'option_text', '9.8', 'is_correct', true),
        jsonb_build_object('option_key', 'B', 'option_text', '10', 'is_correct', false),
        jsonb_build_object('option_key', 'C', 'option_text', '8', 'is_correct', false)),
      'answer', jsonb_build_object('correct_option_keys', jsonb_build_array('A'),
                                    'explanation', 'standard value')),
    jsonb_build_object(
      'question_text', 'Batch import question 2: heat capacity units?',
      'exam_code', 'neet', 'subject_code', 'physics', 'question_type_code', 'MCQ_SINGLE',
      'difficulty', 'MEDIUM',
      'solution_text', 'J/kg.K'),
    jsonb_build_object('question_text', 'Batch import question 1: value of g?',
      'exam_code', 'jee-main', 'subject_code', 'physics'),
    jsonb_build_object('question_text', 'Batch import question 2: heat capacity units?',
      'exam_code', 'neet', 'subject_code', 'physics')
  ));
  raise notice 'IMPORT RESULT: %', res;
  if (res->>'imported')::int <> 2 then raise exception 'expected 2 imported, got %', res; end if;
  if (res->>'duplicates')::int <> 2 then raise exception 'expected 2 duplicates, got %', res; end if;
  if (res->>'failed')::int <> 0 then raise exception 'expected 0 failed, got %', res; end if;

  -- taxonomy resolved against platform bank; imported questions must carry it
  if not exists (select 1 from questions q
                 where q.question_text like 'Batch import question 1:%'
                   and q.subject_id = (select id from subjects s
                                       where s.tenant_id = '00000000-0000-0000-0000-000000000001'
                                         and s.code = 'physics' and s.exam_id = (select id from exams where code='jee-main'))) then
    raise exception 'taxonomy not resolved for imported question';
  end if;
  raise notice 'IMPORT: taxonomy resolution OK';

  res := app_import_questions_batch('[]'::jsonb);
  if res->>'error' is null then raise exception 'empty batch should error'; end if;
  raise notice 'IMPORT: empty batch rejected OK';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tenant management (platform admin only)
-- ---------------------------------------------------------------------------
do $$
declare
  res jsonb;
begin
  res := app_create_tenant('Alpha Coaching', 'alpha-coaching', 'INSTITUTION');
  raise notice 'TENANT CREATE: %', res;
  if res->>'error' is not null then raise exception 'tenant create failed: %', res; end if;

  res := app_update_tenant_status((res->>'tenant_id')::uuid, 'ACTIVE');
  raise notice 'TENANT STATUS: %', res;
  if res->>'error' is not null then raise exception 'tenant status failed: %', res; end if;

  res := app_create_tenant('Alpha Again', 'alpha-coaching', 'INSTITUTION');
  raise notice 'TENANT DUP SLUG: %', res;
  if res->>'error' is null then raise exception 'duplicate slug should error'; end if;

  if not exists (select 1 from subscriptions s join tenants t on t.id = s.tenant_id
                 where t.slug = 'alpha-coaching') then
    raise exception 'subscription row missing for new tenant';
  end if;
  raise notice 'TENANT: subscription seeded OK';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Security events (platform admin view)
-- ---------------------------------------------------------------------------
do $$
declare
  res jsonb;
begin
  insert into security_events (tenant_id, event_type, detail, ip_address)
  values ('00000000-0000-0000-0000-000000000001', 'LOGIN_FAILED',
          jsonb_build_object('ip', '10.0.0.1'), '10.0.0.1');
  res := app_security_events(null, 50);
  raise notice 'SEC EVENTS: %', res;
  if jsonb_typeof(res) <> 'array' then raise exception 'expected array, got %', res; end if;
  if jsonb_array_length(res) = 0 then raise exception 'expected at least one event'; end if;
  raise notice 'SEC: platform admin read OK';
end $$;