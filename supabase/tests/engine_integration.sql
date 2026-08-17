-- ExamPro engine integration test (run against local Postgres validation DB)
-- Validates the REAL server functions: app_generate_paper + app_finalize_session.
-- Not a mock: this calls the actual SQL functions with real data.

\set ON_ERROR_STOP 1

-- 1. Test identity + tenant membership (simulates a logged-in teacher)
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, role text);
-- override auth.uid() to return our test user for this session
create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;

do $$
declare v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_tenant uuid := '22222222-2222-2222-2222-222222222222';
  v_exam uuid; v_subj uuid; v_chap uuid; v_qtype uuid;
  v_role uuid; i int; v_paper jsonb; v_paper_id uuid;
  v_session uuid; v_res jsonb; v_correct int; v_incorrect int; v_unans int; v_marks numeric;
begin
  insert into auth.users (id, email) values (v_user, 'teacher@test.edu') on conflict (id) do nothing;
  insert into tenants (id, name, slug, status) values (v_tenant, 'Test Institute', 'test-inst', 'ACTIVE') on conflict (id) do nothing;
  select id into v_role from roles where code = 'TEACHER';
  insert into tenant_memberships (tenant_id, user_id, role_id, status)
    values (v_tenant, v_user, v_role, 'ACTIVE') on conflict do nothing;

  select id into v_exam from exams where code = 'jee-main';
  select id into v_subj from subjects where exam_id = v_exam and code = 'physics';
  select id into v_chap from chapters where subject_id = v_subj order by display_order limit 1;
  select id into v_qtype from question_types where code = 'MCQ_SINGLE';

  -- 2. Seed 40 verified MCQ questions (physics, jee-main) with options + answers + solutions
  for i in 1..40 loop
    insert into questions (tenant_id, exam_id, subject_id, chapter_id, question_type_id, question_text, year, difficulty, verification_status, is_deleted, created_by)
      values (v_tenant, v_exam, v_subj, v_chap, v_qtype, 'Test question '||i, 2024, 'MEDIUM', 'VERIFIED', false, v_user);
    insert into question_options (tenant_id, question_id, option_key, option_text, is_correct, display_order)
      select v_tenant, q.id, k, 'Option '||k, (k='A'), n from questions q,
        (values ('A',1),('B',2),('C',3),('D',4)) as o(k,n) where q.question_text='Test question '||i;
    insert into question_answers (tenant_id, question_id, correct_option_keys)
      select v_tenant, q.id, array['A'] from questions q where q.question_text='Test question '||i;
    insert into solutions (tenant_id, question_id, solution_text)
      select v_tenant, q.id, 'Solution '||i from questions q where q.question_text='Test question '||i;
  end loop;

  -- 3. Generate a 10-question physics paper via the REAL engine
  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 10, 'title', 'Test Paper',
    'paper_code', 'TEST-PAPER-001', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj))
  ));
  if v_paper ? 'error' then raise exception 'generate failed: %', v_paper->>'error'; end if;
  v_paper_id := (v_paper->>'paper_id')::uuid;
  raise notice 'GENERATE OK: questions=% total_marks=%', v_paper->>'questions', v_paper->>'total_marks';
  if (v_paper->>'questions')::int <> 10 then raise exception 'expected 10 questions, got %', v_paper->>'questions'; end if;

  -- 4. Create an exam session + responses (8 correct, 1 incorrect, 1 unanswered)
  insert into exam_sessions (id, tenant_id, paper_id, student_id, status)
    values ('33333333-3333-3333-3333-333333333333', v_tenant, v_paper_id, v_user, 'IN_PROGRESS');
  insert into responses (tenant_id, exam_session_id, question_id, selected_options)
    select v_tenant, '33333333-3333-3333-3333-333333333333', pq.question_id, qa.correct_option_keys
    from paper_questions pq
    join question_answers qa on qa.question_id = pq.question_id
    where pq.paper_id = v_paper_id and pq.question_order <= 8;
  insert into responses (tenant_id, exam_session_id, question_id, selected_options)
    select v_tenant, '33333333-3333-3333-3333-333333333333', pq.question_id, array['B']
    from paper_questions pq where pq.paper_id = v_paper_id and pq.question_order = 9;
  -- question 10 left unanswered

  -- 5. Finalize + verify scoring
  v_res := app_finalize_session('33333333-3333-3333-3333-333333333333');
  if v_res ? 'error' then raise exception 'finalize failed: %', v_res->>'error'; end if;
  v_correct := (v_res->>'correct')::int; v_incorrect := (v_res->>'incorrect')::int;
  v_unans := (v_res->>'unanswered')::int; v_marks := (v_res->>'marks')::numeric;
  raise notice 'FINALIZE OK: correct=% incorrect=% unanswered=% marks=%', v_correct, v_incorrect, v_unans, v_marks;
  if v_correct <> 8 then raise exception 'expected 8 correct, got %', v_correct; end if;
  if v_incorrect <> 1 then raise exception 'expected 1 incorrect, got %', v_incorrect; end if;
  if v_unans <> 1 then raise exception 'expected 1 unanswered, got %', v_unans; end if;
  -- 8 correct * 4 = 32 ; 1 incorrect * -1 = -1 => 31
  if v_marks <> 31 then raise exception 'expected marks 31, got %', v_marks; end if;

  -- 6. Idempotency: second finalize returns same result, no duplicate
  v_res := app_finalize_session('33333333-3333-3333-3333-333333333333');
  if (v_res->>'already')::bool <> true then raise exception 'expected idempotent already=true'; end if;
  if (select count(*) from results where exam_session_id='33333333-3333-3333-3333-333333333333') <> 1
    then raise exception 'duplicate result created'; end if;

  raise notice 'ALL ENGINE TESTS PASSED';
end $$;
