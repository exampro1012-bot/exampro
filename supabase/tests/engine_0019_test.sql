-- 0019 regression: no-repeat DEFAULT path must REUSE already-used questions.
-- Bug fixed by 0019: v_no_repeat evaluated to NULL when filters.exclude_used was
-- absent, so (not NULL or not exists(...)) -> NULL and used questions were
-- silently excluded even though no-repeat was not requested.
-- These tests also re-assert the explicit flag still excludes.

create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, role text);
create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;

insert into auth.users (id,email) values ('11111111-1111-1111-1111-111111111111','norepeat-owner@test.edu') on conflict do nothing;

do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_tenant uuid;
  v_exam uuid; v_subj1 uuid; v_subj2 uuid; v_qtype uuid; v_chap uuid; i int;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = v_user order by tm.created_at limit 1;
  if v_tenant is null then raise exception 'bootstrap did not create workspace'; end if;

  update system_config set value = jsonb_build_object('PAPERS_GENERATED', 100, 'DPP_GENERATED', 100)
    where key = 'free_quota';

  select id into v_exam from exams where code = 'jee-main';
  insert into subjects (tenant_id, exam_id, code, name, display_order)
    values (v_tenant, v_exam, 'nr19-s1', 'NR19 Subject 1', 1) on conflict do nothing;
  insert into subjects (tenant_id, exam_id, code, name, display_order)
    values (v_tenant, v_exam, 'nr19-s2', 'NR19 Subject 2', 2) on conflict do nothing;
  select id into v_subj1 from subjects where tenant_id = v_tenant and code = 'nr19-s1';
  select id into v_subj2 from subjects where tenant_id = v_tenant and code = 'nr19-s2';
  select id into v_qtype from question_types where code = 'MCQ_SINGLE';
  for i in 1..10 loop
    insert into questions (tenant_id,exam_id,subject_id,chapter_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by)
      values (v_tenant,v_exam,v_subj1,v_chap,v_qtype,'NR19-S1-'||i,2024,'MEDIUM','VERIFIED',false,v_user)
      on conflict do nothing;
    insert into question_options (tenant_id,question_id,option_key,option_text,is_correct,display_order)
      select v_tenant,q.id,k,'Opt '||k,(k='A'),n from questions q,(values('A',1),('B',2),('C',3),('D',4)) o(k,n)
      where q.question_text='NR19-S1-'||i on conflict do nothing;
    insert into question_answers (tenant_id,question_id,correct_option_keys)
      select v_tenant,q.id,array['A'] from questions q where q.question_text='NR19-S1-'||i on conflict do nothing;
    insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by)
      values (v_tenant,v_exam,v_subj2,v_qtype,'NR19-S2-'||i,2023,'EASY','VERIFIED',false,v_user)
      on conflict do nothing;
    insert into question_options (tenant_id,question_id,option_key,option_text,is_correct,display_order)
      select v_tenant,q.id,k,'Opt '||k,(k='A'),n from questions q,(values('A',1),('B',2),('C',3),('D',4)) o(k,n)
      where q.question_text='NR19-S2-'||i on conflict do nothing;
    insert into question_answers (tenant_id,question_id,correct_option_keys)
      select v_tenant,q.id,array['A'] from questions q where q.question_text='NR19-S2-'||i on conflict do nothing;
  end loop;
  raise notice 'SETUP OK: tenant=%', v_tenant;
end $$;

-- Test A: default path (no exclude_used) must be able to REUSE questions.
do $$
declare
  r jsonb; r2 jsonb;
  paper1 uuid; paper2 uuid; exam uuid; subj uuid; overlap int;
begin
  select id into exam from exams where code = 'jee-main' limit 1;
  select id into subj from subjects where code = 'nr19-s1' limit 1;

  r := app_generate_paper(jsonb_build_object(
    'exam_id', exam, 'count', 10, 'title', 'NR19-A', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(subj))));
  if r ? 'error' then raise exception 'A1 generation failed: %', r->>'error'; end if;
  paper1 := (r->>'paper_id')::uuid;

  r2 := app_generate_paper(jsonb_build_object(
    'exam_id', exam, 'count', 10, 'title', 'NR19-B', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(subj))));
  if r2 ? 'error' then
    raise exception 'default no-repeat must allow reuse; generation failed: %', r2->>'error';
  end if;
  paper2 := (r2->>'paper_id')::uuid;

  select count(*) into overlap from paper_questions a join paper_questions b on a.question_id = b.question_id
    where a.paper_id = paper1 and b.paper_id = paper2;
  if overlap <> 10 then raise exception 'expected full 10-question reuse without the flag, got %', overlap; end if;
  raise notice 'A OK: default path reuses (overlap=%)', overlap;
end $$;

-- Test B: explicit exclude_used=true must still exclude.
do $$
declare
  r jsonb; r2 jsonb; r3 jsonb;
  paper1 uuid; paper2 uuid; exam uuid; subj uuid; overlap int;
begin
  select id into exam from exams where code = 'jee-main' limit 1;
  select id into subj from subjects where code = 'nr19-s2' limit 1;

  r := app_generate_paper(jsonb_build_object(
    'exam_id', exam, 'count', 8, 'title', 'NR19-C', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(subj), 'exclude_used', 'true')));
  if r ? 'error' then raise exception 'B1 generation failed: %', r->>'error'; end if;
  paper1 := (r->>'paper_id')::uuid;

  -- only 2 remain in the subject pool -> requesting 8 with no-repeat must FAIL
  r2 := app_generate_paper(jsonb_build_object(
    'exam_id', exam, 'count', 8, 'title', 'NR19-D', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(subj), 'exclude_used', 'true')));
  if not (r2 ? 'error') then raise exception 'flag path should fail when the pool is exhausted'; end if;

  r3 := app_generate_paper(jsonb_build_object(
    'exam_id', exam, 'count', 2, 'title', 'NR19-E', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(subj), 'exclude_used', 'true')));
  if r3 ? 'error' then raise exception 'B3 generation failed: %', r3->>'error'; end if;
  paper2 := (r3->>'paper_id')::uuid;
  select count(*) into overlap from paper_questions a join paper_questions b on a.question_id = b.question_id
    where a.paper_id = paper1 and b.paper_id = paper2;
  if overlap <> 0 then raise exception 'no-repeat flag violated: overlap=%', overlap; end if;
  raise notice 'B OK: flag still excludes (overlap=%)', overlap;
end $$;