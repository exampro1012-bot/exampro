-- Engine test: commit setup, then call the REAL function.
-- The migrations include a bootstrap trigger that auto-creates a workspace
-- tenant + membership when an auth user is inserted. We target THAT tenant.
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, role text);
create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;

drop function if exists ep_setup() cascade;
create or replace function ep_setup() returns uuid language plpgsql as $$
declare v_user uuid:='11111111-1111-1111-1111-111111111111';
  v_tenant uuid; v_exam uuid; v_subj uuid; v_qtype uuid; i int;
begin
  insert into auth.users (id,email) values (v_user,'teacher@test.edu') on conflict do nothing;
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = v_user order by tm.created_at limit 1;
  if v_tenant is null then raise exception 'bootstrap did not create workspace'; end if;
  select id into v_exam from exams where code='jee-main';
  select id into v_subj from subjects where exam_id=v_exam and code='physics';
  select id into v_qtype from question_types where code='MCQ_SINGLE';
  for i in 1..40 loop
    insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by)
      values (v_tenant,v_exam,v_subj,v_qtype,'TQ '||i,2024,'MEDIUM','VERIFIED',false,v_user)
      on conflict do nothing;
    insert into question_options (tenant_id,question_id,option_key,option_text,is_correct,display_order)
      select v_tenant,q.id,k,'Opt '||k,(k='A'),n from questions q,(values('A',1),('B',2),('C',3),('D',4)) o(k,n) where q.question_text='TQ '||i
      on conflict do nothing;
    insert into question_answers (tenant_id,question_id,correct_option_keys)
      select v_tenant,q.id,array['A'] from questions q where q.question_text='TQ '||i
      on conflict do nothing;
  end loop;
  return v_tenant;
end $$;
select ep_setup();

do $$
declare v_exam uuid; v_subj uuid; v_paper jsonb; v_paper_id uuid;
  v_session uuid:='33333333-3333-3333-3333-333333333333';
  v_res jsonb; v_correct int; v_incorrect int; v_unans int; v_marks numeric; v_tenant uuid;
begin
  select id into v_exam from exams where code='jee-main';
  select id into v_subj from subjects where exam_id=v_exam and code='physics';
  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 10, 'title', 'Test Paper',
    'paper_code', 'TEST-PAPER-001', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj))
  ));
  if v_paper ? 'error' then raise exception 'generate failed: %', v_paper->>'error'; end if;
  v_paper_id := (v_paper->>'paper_id')::uuid;
  raise notice 'GENERATE OK: questions=% total_marks=%', v_paper->>'questions', v_paper->>'total_marks';

  select tenant_id into v_tenant from papers where id=v_paper_id;
  insert into exam_sessions (id, tenant_id, paper_id, student_id, status)
    values (v_session, v_tenant, v_paper_id, '11111111-1111-1111-1111-111111111111', 'IN_PROGRESS');
  insert into responses (tenant_id, exam_session_id, question_id, selected_options)
    select v_tenant, v_session, pq.question_id, qa.correct_option_keys
    from paper_questions pq join question_answers qa on qa.question_id=pq.question_id
    where pq.paper_id=v_paper_id and pq.question_order<=8;
  insert into responses (tenant_id, exam_session_id, question_id, selected_options)
    select v_tenant, v_session, pq.question_id, array['B']
    from paper_questions pq where pq.paper_id=v_paper_id and pq.question_order=9;

  v_res := app_finalize_session(v_session);
  if v_res ? 'error' then raise exception 'finalize failed: %', v_res->>'error'; end if;
  v_correct:=(v_res->>'correct')::int; v_incorrect:=(v_res->>'incorrect')::int;
  v_unans:=(v_res->>'unanswered')::int; v_marks:=(v_res->>'marks')::numeric;
  raise notice 'FINALIZE OK: correct=% incorrect=% unanswered=% marks=%', v_correct, v_incorrect, v_unans, v_marks;
  if v_correct<>8 or v_incorrect<>1 or v_unans<>1 or v_marks<>31 then
    raise exception 'scoring mismatch c=% i=% u=% m=%', v_correct, v_incorrect, v_unans, v_marks;
  end if;
  v_res := app_finalize_session(v_session);
  if (v_res->>'already')::bool<>true then raise exception 'idempotency broken'; end if;
  if (select count(*) from results where exam_session_id=v_session) <> 1 then raise exception 'duplicate result'; end if;
  raise notice 'ALL ENGINE TESTS PASSED';
end $$;
