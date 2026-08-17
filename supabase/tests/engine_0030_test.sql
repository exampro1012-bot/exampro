-- 0030 regression: question-bank ingestion engine.
-- Covers app_import_questions_v2 (idempotent dedupe, taxonomy codes, confidence
-- review, provenance), app_get_eligible_questions (eligibility + rejection
-- reasons + breakdowns), ingestion job lifecycle, shard registration + index
-- resync, answer-key matching (matched/conflict/not_found), storage + corpus
-- dashboards, and the is_pyq / ncert filters on app_generate_paper/dpp.

create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, role text);
create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;

insert into auth.users (id,email) values ('11111111-1111-1111-1111-111111111111','ep30-owner@test.edu') on conflict do nothing;

-- ---------------------------------------------------------------------------
-- SETUP: tenant, SUPER_ADMIN role (needed for import), quota, exam + subject
-- ---------------------------------------------------------------------------
do $$
declare
  v_user uuid := '11111111-1111-1111-1111-111111111111';
  v_tenant uuid; v_role uuid; v_exam uuid; v_qtype uuid; v_subj uuid; i int;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = v_user order by tm.created_at limit 1;
  if v_tenant is null then raise exception 'bootstrap did not create workspace'; end if;

  -- ensure a non-student role so import is permitted
  select id into v_role from roles where code = 'SUPER_ADMIN';
  if v_role is not null then
    update tenant_memberships set role_id = v_role where tenant_id = v_tenant and user_id = v_user;
  end if;

  update system_config set value = jsonb_build_object('PAPERS_GENERATED', 100, 'DPP_GENERATED', 100)
    where key = 'free_quota';

  select id into v_exam from exams where code = 'jee-main';
  select id into v_qtype from question_types where code = 'MCQ_SINGLE';

  -- a platform-bank VERIFIED question to prove cross-tenant dedupe
  if not exists (select 1 from questions q
                 where q.tenant_id = '00000000-0000-0000-0000-000000000001'
                   and q.content_hash = 'ch-platform-dedupe') then
    insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,
                           content_hash,question_hash,year,difficulty,verification_status,
                           is_deleted,created_by)
      values ('00000000-0000-0000-0000-000000000001', v_exam, null, v_qtype,
              'Platform canonical question for dedupe test',
              'ch-platform-dedupe', app_question_hash('Platform canonical question for dedupe test'),
              2024, 'MEDIUM', 'VERIFIED', false, v_user);
  end if;

  raise notice 'SETUP OK: tenant=%', v_tenant;
end $$;

-- ---------------------------------------------------------------------------
-- 1. app_import_questions_v2 — import, taxonomy auto-create, options/answers/solutions
-- ---------------------------------------------------------------------------
do $$
declare
  v_exam uuid; v_tenant uuid; r jsonb; q text;
  v_subj uuid; v_chap uuid; v_topic uuid;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() order by tm.created_at limit 1;
  select id into v_exam from exams where code = 'jee-main';

  r := app_import_questions_v2(jsonb_build_array(
    jsonb_build_object(
      'question_text', 'What is 2+2 in ep30?',
      'content_hash', 'ch-ep30-a',
      'exam_code', 'jee-main', 'subject_code', 'ep30-phy',
      'chapter_code', 'ep30-ch1', 'topic_code', 'ep30-t1',
      'question_type_code', 'MCQ_SINGLE',
      'year', 2025, 'session', 'S1', 'shift', '2', 'question_number', 1,
      'difficulty', 'EASY', 'is_pyq', true, 'ncert', true,
      'marks', 4, 'negative_marks', 1,
      'parse_confidence', 95,
      'options', jsonb_build_array(
        jsonb_build_object('option_key','A','option_text','4','is_correct',true,'display_order',1),
        jsonb_build_object('option_key','B','option_text','5','is_correct',false,'display_order',2)),
      'answer', jsonb_build_object('answer_type','MCQ','correct_option_keys',jsonb_build_array('A'),'confidence',98),
      'solution_text', '2 plus 2 equals four.',
      'solution', jsonb_build_object('solution_method','STEPWISE','concept','arithmetic'))
    ), null, null, 'batch-ep30-1', '{}'::jsonb, 'VERIFIED');

  if r->>'imported' <> '1' then raise exception 'expected 1 import, got %', r->>'imported'; end if;
  if r->>'failed' <> '0' then raise exception 'expected 0 failures, got %', r->>'failed'; end if;
  if r->>'duplicates' <> '0' then raise exception 'expected 0 dupes, got %', r->>'duplicates'; end if;

  select id into v_subj from subjects where tenant_id = v_tenant and code = 'ep30-phy';
  select id into v_chap from chapters where tenant_id = v_tenant and code = 'ep30-ch1';
  select id into v_topic from topics where tenant_id = v_tenant and code = 'ep30-t1';
  if v_subj is null then raise exception 'subject code not auto-created'; end if;
  if v_chap is null then raise exception 'chapter code not auto-created'; end if;
  if v_topic is null then raise exception 'topic code not auto-created'; end if;

  select question_text into q from questions q where tenant_id = v_tenant and content_hash = 'ch-ep30-a';
  if q is null then raise exception 'question not found by content_hash'; end if;
  if not exists (select 1 from question_options o join questions q on q.id = o.question_id
                 where q.content_hash = 'ch-ep30-a') then
    raise exception 'options missing';
  end if;
  if not exists (select 1 from question_answers a join questions q on q.id = a.question_id
                 where q.content_hash = 'ch-ep30-a') then
    raise exception 'answer missing';
  end if;
  if not exists (select 1 from solutions s join questions q on q.id = s.question_id
                 where q.content_hash = 'ch-ep30-a') then
    raise exception 'solution missing';
  end if;
  if not exists (select 1 from questions q
                 where q.content_hash = 'ch-ep30-a' and q.solution_status = 'AVAILABLE'
                   and q.is_pyq and q.ncert and q.question_visibility = 'TENANT'
                   and q.parse_confidence = 95 and q.source = 'IMPORT') then
    raise exception 'provenance/confidence/flags not persisted';
  end if;

  raise notice 'OK 1: import + taxonomy auto-create + options/answers/solutions';
end $$;

-- ---------------------------------------------------------------------------
-- 2. app_import_questions_v2 — dedupe by content_hash (in-batch, against
--    tenant, and against the platform bank) + low-confidence review
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant uuid; r jsonb;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() order by tm.created_at limit 1;

  -- same content_hash again in one batch -> duplicate
  r := app_import_questions_v2(jsonb_build_array(
    jsonb_build_object('question_text','What is 2+2 in ep30?','content_hash','ch-ep30-a',
      'exam_code','jee-main','subject_code','ep30-phy'),
    jsonb_build_object('question_text','What is 2+2 in ep30?','content_hash','ch-ep30-a',
      'exam_code','jee-main','subject_code','ep30-phy')
  ));
  if r->>'duplicates' <> '2' then raise exception 'in-batch dedupe failed: %', r->>'duplicates'; end if;

  -- content_hash already exists in tenant -> duplicate
  r := app_import_questions_v2(jsonb_build_array(
    jsonb_build_object('question_text','What is 2+2 in ep30?','content_hash','ch-ep30-a',
      'exam_code','jee-main','subject_code','ep30-phy')));
  if r->>'duplicates' <> '1' then raise exception 'tenant dedupe failed: %', r->>'duplicates'; end if;

  -- content_hash already exists in the PLATFORM bank -> duplicate (canonical wins)
  r := app_import_questions_v2(jsonb_build_array(
    jsonb_build_object('question_text','Platform canonical question for dedupe test',
      'content_hash','ch-platform-dedupe','exam_code','jee-main','subject_code','ep30-phy')));
  if r->>'duplicates' <> '1' then raise exception 'platform-bank dedupe failed: %', r->>'duplicates'; end if;

  -- missing question_text -> failed entry recorded
  r := app_import_questions_v2(jsonb_build_array(
    jsonb_build_object('content_hash','ch-ep30-empty')));
  if r->>'failed' <> '1' then raise exception 'missing-text failure not recorded: %', r->>'failed'; end if;

  -- low parse confidence -> pipeline_status REVIEW_REQUIRED + review counter
  r := app_import_questions_v2(jsonb_build_array(
    jsonb_build_object('question_text','Low confidence parse of an ep30 question',
      'content_hash','ch-ep30-low','exam_code','jee-main','subject_code','ep30-phy',
      'parse_confidence', 40)));
  if r->>'review' <> '1' then raise exception 'low-confidence review not flagged: %', r->>'review'; end if;
  if not exists (select 1 from questions q
                 where q.content_hash = 'ch-ep30-low' and q.pipeline_status = 'REVIEW_REQUIRED') then
    raise exception 'REVIEW_REQUIRED not set';
  end if;

  raise notice 'OK 2: dedupe (in-batch/tenant/platform) + failure + confidence review';
end $$;

-- ---------------------------------------------------------------------------
-- 3. app_get_eligible_questions — eligibility engine, filters, breakdowns
-- ---------------------------------------------------------------------------
do $$
declare
  v_exam uuid; v_tenant uuid; v_subj uuid; v_chap uuid; r jsonb; c int;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() order by tm.created_at limit 1;
  select id into v_exam from exams where code = 'jee-main';
  select id into v_subj from subjects where tenant_id = v_tenant and code = 'ep30-phy';
  select id into v_chap from chapters where tenant_id = v_tenant and code = 'ep30-ch1';

  r := app_get_eligible_questions(jsonb_build_object('exam_id', v_exam));
  if r ? 'error' then raise exception 'eligibility errored: %', r->>'error'; end if;
  if (r->>'eligible_count')::int <= 0 then raise exception 'eligible_count should be positive: %', r->>'eligible_count'; end if;
  if r->'rejection_reasons'->>'base_pool' is null then raise exception 'base_pool missing'; end if;
  if r->'rejection_reasons'->>'by_verification' is null then raise exception 'by_verification missing'; end if;
  if r->'rejection_reasons'->>'by_exam_scope' is null then raise exception 'by_exam_scope missing'; end if;
  if jsonb_array_length(r->'difficulty_breakdown') = 0 then raise exception 'difficulty_breakdown empty'; end if;

  -- subject filter isolates our imported pool
  r := app_get_eligible_questions(jsonb_build_object('exam_id', v_exam, 'subject_id', v_subj));
  c := (r->>'eligible_count')::int;
  if c < 1 then raise exception 'subject-scoped eligibility empty: %', c; end if;

  -- is_pyq filter
  r := app_get_eligible_questions(jsonb_build_object('exam_id', v_exam, 'subject_id', v_subj, 'is_pyq', true));
  if (r->>'eligible_count')::int <> 1 then raise exception 'is_pyq eligibility should be 1, got %', r->>'eligible_count'; end if;

  -- chapter + topic + session + shift + year + difficulty narrow to our seeded question
  r := app_get_eligible_questions(jsonb_build_object('exam_id', v_exam, 'subject_id', v_subj,
    'chapter_id', v_chap, 'session', 'S1', 'shift', '2', 'year', 2025, 'difficulty', 'EASY'));
  if (r->>'eligible_count')::int <> 1 then raise exception 'full-filter eligibility should be 1, got %', r->>'eligible_count'; end if;

  raise notice 'OK 3: eligibility engine + rejection reasons + breakdowns + filters';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Ingestion job lifecycle (start -> pages -> retry -> finish)
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant uuid; r jsonb; v_job uuid;
  v_pages int; v_status text; v_cur int; v_imported int; v_failed int;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() order by tm.created_at limit 1;

  r := app_ingestion_job_start(jsonb_build_object('file_id', null, 'format', 'PDF',
       'metadata', jsonb_build_object('exam_id', null), 'total_pages', 3));
  if r ? 'error' then raise exception 'job start errored: %', r->>'error'; end if;
  v_job := (r->>'job_id')::uuid;

  r := app_ingestion_job_page(v_job, 1, 'OK', 5, 4);
  if r ? 'error' then raise exception 'page errored: %', r->>'error'; end if;
  r := app_ingestion_job_page(v_job, 2, 'FAILED', 0, 0, 'ocr timeout');
  r := app_ingestion_job_retry_page(v_job, 2);
  r := app_ingestion_job_page(v_job, 2, 'OK', 3, 3);
  r := app_ingestion_job_finish(v_job, 'COMPLETED', 8, 7, 1, 0, '[]'::jsonb);

  select status, current_page, questions_imported, failed_pages
    into v_status, v_cur, v_imported, v_failed
    from ingestion_jobs where id = v_job;
  if v_status <> 'COMPLETED' then raise exception 'job status wrong: %', v_status; end if;
  if v_cur <> 2 then raise exception 'current_page wrong: %', v_cur; end if;
  if v_imported <> 7 then raise exception 'imported wrong: %', v_imported; end if;
  if v_failed <> 0 then raise exception 'failed_pages should be 0 after retry: %', v_failed; end if;

  select count(*) into v_pages from ingestion_pages where ingestion_job_id = v_job;
  if v_pages <> 2 then raise exception 'expected 2 page rows, got %', v_pages; end if;

  raise notice 'OK 4: ingestion job lifecycle (start/page/retry/finish)';
end $$;

-- ---------------------------------------------------------------------------
-- 5. app_shard_register + app_question_index_resync
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant uuid; v_exam uuid; v_subj uuid; r jsonb; v_shard uuid;
  v_qids uuid[]; v_qid uuid;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() order by tm.created_at limit 1;
  select id into v_exam from exams where code = 'jee-main';
  select id into v_subj from subjects where tenant_id = v_tenant and code = 'ep30-phy';

  select array_agg(id) into v_qids from questions q
    where q.tenant_id = v_tenant and q.subject_id = v_subj and q.is_deleted = false;

  r := app_shard_register(v_exam, v_subj, 2024, 2025, coalesce(array_length(v_qids,1),0),
    1024, 4096, 'abc123sha', 'drive-shard-1', 'drive-folder-1',
    jsonb_build_array(jsonb_build_object('question_id', v_qids[1], 'record_locator', 'rec-1')));
  if r ? 'error' then raise exception 'shard register errored: %', r->>'error'; end if;
  v_shard := (r->>'shard_id')::uuid;
  if r->>'registered' <> '1' then raise exception 'shard registered count wrong: %', r->>'registered'; end if;

  if not exists (select 1 from question_shards qs where qs.id = v_shard and qs.sha256 = 'abc123sha') then
    raise exception 'shard row missing';
  end if;
  if not exists (select 1 from question_index qi where qi.question_id = v_qids[1] and qi.record_locator = 'rec-1') then
    raise exception 'index row missing';
  end if;

  r := app_question_index_resync();
  if r ? 'error' then raise exception 'resync errored: %', r->>'error'; end if;
  if not exists (select 1 from question_index qi where qi.question_id = v_qids[1]) then
    raise exception 'resync dropped indexed question';
  end if;

  raise notice 'OK 5: shard register + index resync (synced=%)', r->>'synced';
end $$;

-- ---------------------------------------------------------------------------
-- 6. app_match_answer_key — matched / conflict / not_found
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant uuid; v_exam uuid; v_subj uuid; v_qid uuid; r jsonb;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() order by tm.created_at limit 1;
  select id into v_exam from exams where code = 'jee-main';
  select id into v_subj from subjects where tenant_id = v_tenant and code = 'ep30-phy';

  select id into v_qid from questions q where q.tenant_id = v_tenant and q.content_hash = 'ch-ep30-a';

  -- correct match -> ANSWER_VERIFIED
  r := app_match_answer_key(jsonb_build_array(
    jsonb_build_object('exam_id', v_exam, 'year', 2025, 'session', 'S1', 'shift', '2',
      'subject_code', 'ep30-phy', 'question_number', 1, 'answer', 'A')));
  if r->>'matched' <> '1' then raise exception 'expected 1 match, got %', r->>'matched'; end if;
  if not exists (select 1 from questions q where q.id = v_qid
                 and q.pipeline_status = 'ANSWER_VERIFIED' and q.verification_status = 'VERIFIED') then
    raise exception 'matched question not verified';
  end if;

  -- wrong answer -> CONFLICT (never overwrites)
  r := app_match_answer_key(jsonb_build_array(
    jsonb_build_object('exam_id', v_exam, 'year', 2025, 'session', 'S1', 'shift', '2',
      'subject_code', 'ep30-phy', 'question_number', 1, 'answer', 'B')));
  if r->>'conflict' <> '1' then raise exception 'expected 1 conflict, got %', r->>'conflict'; end if;
  if exists (select 1 from question_answers a where a.question_id = v_qid and a.correct_option_keys = array['B']) then
    raise exception 'conflict must never overwrite the answer';
  end if;
  if not exists (select 1 from questions q where q.id = v_qid and q.pipeline_status = 'CONFLICT') then
    raise exception 'conflict flag not set';
  end if;

  -- unknown question -> not_found
  r := app_match_answer_key(jsonb_build_array(
    jsonb_build_object('exam_id', v_exam, 'year', 2025, 'session', 'S1', 'shift', '2',
      'subject_code', 'ep30-phy', 'question_number', 9999, 'answer', 'A')));
  if r->>'not_found' <> '1' then raise exception 'expected 1 not_found, got %', r->>'not_found'; end if;

  raise notice 'OK 6: answer-key matching (matched/conflict/not_found)';
end $$;

-- ---------------------------------------------------------------------------
-- 7. Dashboards — storage + corpus
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
begin
  r := app_storage_dashboard();
  if r ? 'error' then raise exception 'storage dashboard errored: %', r->>'error'; end if;
  if r->>'source_pdfs' is null or r->>'question_shards' is null or r->>'images' is null then
    raise exception 'storage dashboard missing keys';
  end if;

  r := app_question_corpus_stats();
  if r ? 'error' then raise exception 'corpus stats errored: %', r->>'error'; end if;
  if r->>'total' is null or r->>'published' is null or r->>'with_answer' is null then
    raise exception 'corpus stats missing keys';
  end if;
  if (r->>'total')::int <= 0 then raise exception 'corpus total should be positive: %', r->>'total'; end if;

  raise notice 'OK 7: storage + corpus dashboards';
end $$;

-- ---------------------------------------------------------------------------
-- 8. app_generate_paper — is_pyq + ncert filters (behaviour otherwise intact)
-- ---------------------------------------------------------------------------
do $$
declare
  v_exam uuid; v_tenant uuid; v_subj uuid; v_qtype uuid; i int;
  v_paper jsonb; v_paper_id uuid; v_pyq_count int; v_ncert_count int;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() order by tm.created_at limit 1;
  select id into v_exam from exams where code = 'jee-main';
  select id into v_subj from subjects where tenant_id = v_tenant and code = 'ep30-phy';
  select id into v_qtype from question_types where code = 'MCQ_SINGLE';

  -- seed a pyq-only pool (20 PYQ + 0 non-PYQ) to make filter assertions strict
  for i in 1..20 loop
    insert into questions (tenant_id,exam_id,subject_id,question_type_id,question_text,
                           content_hash,year,difficulty,verification_status,is_deleted,created_by,is_pyq,ncert)
      values (v_tenant,v_exam,v_subj,v_qtype,'EP30-PYQ-'||i,'ch-ep30-pyq-'||i,
              2020+(i%5),'MEDIUM','VERIFIED',false,auth.uid(),true,(i%2=0))
      on conflict do nothing;
    insert into question_options (tenant_id,question_id,option_key,option_text,is_correct,display_order)
      select v_tenant,q.id,k,'Opt '||k,(k='A'),n from questions q,(values('A',1),('B',2),('C',3),('D',4)) o(k,n)
      where q.content_hash='ch-ep30-pyq-'||i on conflict do nothing;
    insert into question_answers (tenant_id,question_id,correct_option_keys)
      select v_tenant,q.id,array['A'] from questions q where q.content_hash='ch-ep30-pyq-'||i on conflict do nothing;
  end loop;

  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 6, 'title', 'EP30 PYQ', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj), 'is_pyq', 'true')));
  if v_paper ? 'error' then raise exception 'PYQ paper generation failed: %', v_paper->>'error'; end if;
  v_paper_id := (v_paper->>'paper_id')::uuid;
  select count(*) into v_pyq_count from paper_questions pq join questions q on q.id = pq.question_id
    where pq.paper_id = v_paper_id and q.is_pyq;
  if v_pyq_count <> 6 then raise exception 'PYQ filter violated: %/6', v_pyq_count; end if;

  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 5, 'title', 'EP30 NCERT', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj), 'ncert', 'true')));
  if v_paper ? 'error' then raise exception 'NCERT paper generation failed: %', v_paper->>'error'; end if;
  v_paper_id := (v_paper->>'paper_id')::uuid;
  select count(*) into v_ncert_count from paper_questions pq join questions q on q.id = pq.question_id
    where pq.paper_id = v_paper_id and q.ncert;
  if v_ncert_count <> 5 then raise exception 'NCERT filter violated: %/5', v_ncert_count; end if;

  raise notice 'OK 8: paper generator is_pyq/ncert filters';
end $$;

-- ---------------------------------------------------------------------------
-- 9. app_generate_dpp — is_pyq filter (PYQ mode selects only previous years)
-- ---------------------------------------------------------------------------
do $$
declare
  v_exam uuid; v_tenant uuid; v_subj uuid; r jsonb; v_dpp uuid; c int;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() order by tm.created_at limit 1;
  select id into v_exam from exams where code = 'jee-main';
  select id into v_subj from subjects where tenant_id = v_tenant and code = 'ep30-phy';

  r := app_generate_dpp(jsonb_build_object(
    'exam_id', v_exam, 'count', 5, 'title', 'EP30 DPP PYQ', 'mode', 'PYQ', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj), 'is_pyq', 'true',
      'years', jsonb_build_array(2021, 2022, 2023, 2024, 2025))));
  if r ? 'error' then raise exception 'DPP generation failed: %', r->>'error'; end if;
  v_dpp := (r->>'dpp_id')::uuid;
  select count(*) into c from dpp_questions dq join questions q on q.id = dq.question_id
    where dq.dpp_id = v_dpp and not q.is_pyq;
  if c <> 0 then raise exception 'DPP PYQ filter violated: % non-PYQ', c; end if;

  raise notice 'OK 9: dpp generator is_pyq filter';
end $$;