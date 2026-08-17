-- Engine test: 0015 production-hardening features.
-- 1. verified_at provenance (trigger + app_verify_question)
-- 2. app_save_response: upsert + marked_for_review + server-side guards
-- 3. app_log_security_event
-- 4. app_evaluate_omr_sheet: scoring, negative marks, unanswered, numerical
-- 5. language filter in app_generate_paper
-- 6. indexes / columns / reactivated question types
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, role text);
create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;

drop function if exists ep_setup_0015() cascade;
create or replace function ep_setup_0015() returns uuid language plpgsql as $$
declare v_user uuid:='11111111-1111-1111-1111-111111111111';
  v_tenant uuid; v_exam uuid; v_subj uuid; v_qtype uuid; v_num uuid; i int;
  v_q uuid;
begin
  insert into auth.users (id,email) values (v_user,'teacher@test.edu') on conflict do nothing;
  update system_config set value = jsonb_build_object('PAPERS_GENERATED', 100, 'DPP_GENERATED', 100)
    where key = 'free_quota';
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = v_user order by tm.created_at limit 1;
  if v_tenant is null then raise exception 'bootstrap did not create workspace'; end if;
  select id into v_exam from exams where code='jee-main';
  select id into v_subj from subjects where exam_id=v_exam and code='physics';
  select id into v_qtype from question_types where code='MCQ_SINGLE';
  select id into v_num from question_types where code='NUMERICAL';
  -- English MCQs
  for i in 1..10 loop
    insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by,language)
      values (v_tenant,v_exam,v_subj,v_qtype,'ENQ '||i,2024,'MEDIUM','VERIFIED',false,v_user,'EN')
      on conflict do nothing;
    insert into question_options (tenant_id,question_id,option_key,option_text,is_correct,display_order)
      select v_tenant,q.id,k,'Opt '||k,(k='A'),n from questions q,(values('A',1),('B',2),('C',3),('D',4)) o(k,n) where q.question_text='ENQ '||i
      on conflict do nothing;
    insert into question_answers (tenant_id,question_id,correct_option_keys)
      select v_tenant,q.id,array['A'] from questions q where q.question_text='ENQ '||i
      on conflict do nothing;
  end loop;
  -- Hindi MCQs
  for i in 1..10 loop
    insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by,language)
      values (v_tenant,v_exam,v_subj,v_qtype,'HIQ '||i,2024,'MEDIUM','VERIFIED',false,v_user,'HI')
      on conflict do nothing;
    insert into question_options (tenant_id,question_id,option_key,option_text,is_correct,display_order)
      select v_tenant,q.id,k,'Opt '||k,(k='A'),n from questions q,(values('A',1),('B',2),('C',3),('D',4)) o(k,n) where q.question_text='HIQ '||i
      on conflict do nothing;
    insert into question_answers (tenant_id,question_id,correct_option_keys)
      select v_tenant,q.id,array['A'] from questions q where q.question_text='HIQ '||i
      on conflict do nothing;
  end loop;
  -- one numerical question
  insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by,language)
    values (v_tenant,v_exam,v_subj,v_num,'NUMQ 1',2024,'MEDIUM','VERIFIED',false,v_user,'EN')
    on conflict do nothing;
  select id into v_q from questions where question_text='NUMQ 1';
  insert into question_answers (tenant_id,question_id,correct_option_keys,numerical_answer)
    values (v_tenant,v_q,'{}',42) on conflict do nothing;
  -- a pending question for verified_at transition tests
  insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by)
    values (v_tenant,v_exam,v_subj,v_qtype,'PENDQ 1',2024,'MEDIUM','PENDING_REVIEW',false,v_user)
    on conflict do nothing;
  -- a second pending question (never eligible for generation) for negative tests
  insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,year,difficulty,verification_status,is_deleted,created_by)
    values (v_tenant,v_exam,v_subj,v_qtype,'PENDQ 2',2024,'MEDIUM','PENDING_REVIEW',false,v_user)
    on conflict do nothing;
  return v_tenant;
end $$;
select ep_setup_0015();

do $$
declare v_exam uuid; v_subj uuid; v_num uuid; v_tenant uuid;
  v_paper jsonb; v_paper_id uuid; v_session uuid:='44444444-4444-4444-4444-444444444444';
  v_res jsonb; v_q uuid; v_q2 uuid; v_opt text[]; v_sheet uuid; v_c int; v_w int; v_u int; v_m numeric; v_t numeric;
  v_qid uuid; v_cnt int; v_qno int; v_pq record; v_status text;
begin
  select id into v_exam from exams where code='jee-main';
  select id into v_subj from subjects where exam_id=v_exam and code='physics';
  select id into v_num from question_types where code='NUMERICAL';

  -- 1. verified_at provenance ------------------------------------------------
  select id, tenant_id into v_q, v_tenant from questions where question_text='PENDQ 1' limit 1;
  if (select verified_at from questions where id=v_q) is not null then
    raise exception 'PENDING question should have verified_at null';
  end if;
  update questions set verification_status='VERIFIED' where id=v_q;
  if (select verified_at from questions where id=v_q) is null then
    raise exception 'trigger did not stamp verified_at on VERIFIED';
  end if;
  update questions set verification_status='NEEDS_EDIT' where id=v_q;
  if (select verified_at from questions where id=v_q) is not null then
    raise exception 'verified_at should clear when leaving VERIFIED';
  end if;
  v_res := app_verify_question(v_q, 'VERIFIED', 'prov test');
  if v_res->>'error' is not null then raise exception 'verify failed: %', v_res->>'error'; end if;
  if (select verified_at from questions where id=v_q) is null then
    raise exception 'app_verify_question did not stamp verified_at';
  end if;
  v_res := app_verify_question(v_q, 'REJECTED', null);
  if (select verified_at from questions where id=v_q) is not null then
    raise exception 'app_verify_question did not clear verified_at on REJECTED';
  end if;
  update questions set verification_status='VERIFIED' where id=v_q;
  raise notice '1. verified_at OK';

  -- 5. language filter -------------------------------------------------------
  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 5, 'title', 'HI Paper', 'paper_code', 'TEST-HI-001',
    'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj), 'language', 'HI')
  ));
  if v_paper ? 'error' then raise exception 'hi generate failed: %', v_paper->>'error'; end if;
  v_paper_id := (v_paper->>'paper_id')::uuid;
  select count(*) into v_cnt from paper_questions pq
    join questions q on q.id=pq.question_id where pq.paper_id=v_paper_id and upper(q.language)<>'HI';
  if v_cnt<>0 then raise exception 'language filter leaked % non-HI questions', v_cnt; end if;
  -- case-insensitive filter value
  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 2, 'title', 'HI Paper 2', 'paper_code', 'TEST-HI-002',
    'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('language', 'hi')
  ));
  if v_paper ? 'error' then raise exception 'lowercase language filter failed: %', v_paper->>'error'; end if;
  raise notice '5. language filter OK';

  -- 2. app_save_response -----------------------------------------------------
  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 10, 'title', 'Sav Paper', 'paper_code', 'TEST-SAV-001',
    'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj))
  ));
  if v_paper ? 'error' then raise exception 'generate failed: %', v_paper->>'error'; end if;
  v_paper_id := (v_paper->>'paper_id')::uuid;
  insert into exam_sessions (id, tenant_id, paper_id, student_id, status, started_at, ends_at)
    values (v_session, v_tenant, v_paper_id, '11111111-1111-1111-1111-111111111111', 'IN_PROGRESS',
            now() - interval '5 minutes', now() + interval '25 minutes');

  select question_id into v_qid from paper_questions where paper_id=v_paper_id and question_order=1 limit 1;
  v_res := app_save_response(v_session, v_qid, array['A'], true);
  if v_res->>'error' is not null then raise exception 'save failed: %', v_res->>'error'; end if;
  if (select marked_for_review from responses where exam_session_id=v_session and question_id=v_qid) <> true then
    raise exception 'marked_for_review not persisted';
  end if;
  -- upsert: same (session, question) must stay a single row
  v_res := app_save_response(v_session, v_qid, array['B'], false);
  if (select count(*) from responses where exam_session_id=v_session and question_id=v_qid) <> 1 then
    raise exception 'app_save_response upsert duplicated the row';
  end if;
  if (select selected_options from responses where exam_session_id=v_session and question_id=v_qid) <> array['B'] then
    raise exception 'app_save_response did not update options';
  end if;
  if (select marked_for_review from responses where exam_session_id=v_session and question_id=v_qid) <> false then
    raise exception 'marked flag did not clear on re-save';
  end if;
  -- question not in paper
  select id into v_q2 from questions where question_text='PENDQ 2' limit 1;
  v_res := app_save_response(v_session, v_q2, array['A']);
  if v_res->>'error' is null then raise exception 'non-paper question accepted'; end if;
  -- expired session must reject
  update exam_sessions set ends_at = now() - interval '1 minute' where id=v_session;
  v_res := app_save_response(v_session, v_qid, array['A']);
  if v_res->>'error' is null then raise exception 'expired session accepted a response';
  elsif position('time is over' in v_res->>'error') = 0 then
    raise exception 'unexpected expired error: %', v_res->>'error';
  end if;
  update exam_sessions set ends_at = now() + interval '25 minutes' where id=v_session;
  -- submitted session must reject
  v_res := app_finalize_session(v_session);
  if v_res ? 'error' then raise exception 'finalize failed: %', v_res->>'error'; end if;
  v_res := app_save_response(v_session, v_qid, array['A']);
  if v_res->>'error' is null then raise exception 'submitted session accepted a response'; end if;
  raise notice '2. app_save_response OK';

  -- 3. app_log_security_event ------------------------------------------------
  v_res := app_log_security_event('LOGIN_SUCCESS', '{"email":"teacher@test.edu"}');
  if v_res->>'error' is not null then raise exception 'sec event failed: %', v_res->>'error'; end if;
  if (select count(*) from security_events where user_id='11111111-1111-1111-1111-111111111111' and event_type='LOGIN_SUCCESS') <> 1 then
    raise exception 'security event not recorded';
  end if;
  raise notice '3. app_log_security_event OK';

  -- 4. app_evaluate_omr_sheet ------------------------------------------------
  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 4, 'title', 'OMR Paper', 'paper_code', 'TEST-OMR-001',
    'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj), 'question_type_ids', jsonb_build_array((select id from question_types where code='MCQ_SINGLE')))
  ));
  if v_paper ? 'error' then raise exception 'omr generate failed: %', v_paper->>'error'; end if;
  v_paper_id := (v_paper->>'paper_id')::uuid;
  -- append the numerical question as question 5 (marks 4, neg 1)
  select id into v_q2 from questions where question_text='NUMQ 1' limit 1;
  insert into paper_questions (tenant_id, paper_id, question_id, question_order, marks, negative_marks, snapshot)
  values (v_tenant, v_paper_id, v_q2, 5, 4, 1, app_question_snapshot(v_q2, 4, 1));
  if (select count(*) from paper_questions where paper_id=v_paper_id) <> 5 then
    raise exception 'omr paper should have 5 questions';
  end if;

  insert into omr_sheets (tenant_id, paper_id, roll_number, status)
    values (v_tenant, v_paper_id, 'OMR-TEST-1', 'PENDING') returning id into v_sheet;
  -- Q1 correct, Q2 wrong (neg -1), Q3 unanswered (empty), Q4 correct, Q5 numerical correct (42)
  for v_pq in
    select pq.question_order, pq.snapshot from paper_questions pq
    where pq.paper_id=v_paper_id order by pq.question_order
  loop
    v_qno := v_pq.question_order;
    if v_qno = 2 then
      -- deliberately wrong: pick a letter that is not the correct one
      v_opt := array[
        (select x from unnest(array['A','B','C','D']) x
         where x <> all (coalesce((select array(select jsonb_array_elements_text(v_pq.snapshot->'answer'->'correct_option_keys'))), '{}'::text[]))
         limit 1)
      ];
    elsif v_qno = 3 then
      v_opt := '{}'::text[];
    elsif v_qno = 5 then
      v_opt := array['42'];
    else
      v_opt := array(select jsonb_array_elements_text(v_pq.snapshot->'answer'->'correct_option_keys'));
    end if;
    insert into omr_responses (tenant_id, omr_sheet_id, question_no, selected_options)
    values (v_tenant, v_sheet, v_qno, v_opt);
  end loop;

  v_res := app_evaluate_omr_sheet(v_sheet);
  if v_res->>'error' is not null then raise exception 'omr eval failed: %', v_res->>'error'; end if;
  v_c := (v_res->>'correct')::int; v_w := (v_res->>'incorrect')::int;
  v_u := (v_res->>'unanswered')::int; v_m := (v_res->>'marks')::numeric; v_t := (v_res->>'total_marks')::numeric;
  raise notice 'OMR eval: correct=% incorrect=% unanswered=% marks=% total=%', v_c, v_w, v_u, v_m, v_t;
  if v_c<>3 or v_w<>1 or v_u<>1 or v_m<>11 or v_t<>20 then
    raise exception 'OMR scoring mismatch c=% w=% u=% m=% t=%', v_c, v_w, v_u, v_m, v_t;
  end if;
  -- persisted score columns
  select correct_count, incorrect_count, unanswered_count, marks, total_marks, status
    into v_c, v_w, v_u, v_m, v_t, v_status from omr_sheets where id=v_sheet;
  if v_c<>3 or v_w<>1 or v_u<>1 or v_m<>11 or v_t<>20 or v_status <> 'EVALUATED' then
    raise exception 'omr_sheets score columns not persisted';
  end if;
  -- re-evaluation is idempotent (same numbers)
  v_res := app_evaluate_omr_sheet(v_sheet);
  if (v_res->>'correct')::int <> 3 then raise exception 'omr re-eval changed scores'; end if;
  raise notice '4. app_evaluate_omr_sheet OK';

  -- 6. schema hardening -------------------------------------------------------
  if not exists (select 1 from pg_indexes where indexname='ix_questions_text_trgm') then
    raise exception 'trgm index missing';
  end if;
  if not exists (select 1 from pg_indexes where indexname='ix_questions_tenant_filter') then
    raise exception 'tenant filter index missing';
  end if;
  if not exists (select 1 from pg_indexes where indexname='ix_question_usage_tenant_q') then
    raise exception 'question_usage index missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_name='students' and column_name='auth_user_id') then
    raise exception 'students.auth_user_id missing';
  end if;
  if not exists (select 1 from pg_indexes where indexname='uq_students_auth_user') then
    raise exception 'students auth unique index missing';
  end if;
  if not exists (select 1 from question_types where code='MATCH_FOLLOWING' and is_active) then
    raise exception 'MATCH_FOLLOWING not reactivated';
  end if;
  if not exists (select 1 from question_types where code='DIAGRAM' and is_active) then
    raise exception 'DIAGRAM not reactivated';
  end if;
  if not exists (select 1 from question_types where code='IMAGE_BASED' and is_active) then
    raise exception 'IMAGE_BASED not reactivated';
  end if;
  select count(*) into v_cnt from questions where question_text % 'ENQ 3';
  if v_cnt<1 then raise exception 'trgm similarity search returned nothing'; end if;
  raise notice '6. schema hardening OK';

  raise notice 'ALL 0015 TESTS PASSED';
end $$;
