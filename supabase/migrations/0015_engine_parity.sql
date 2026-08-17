-- ----------------------------------------------------------------------------
-- 0015_engine_parity.sql
-- 1. No-repeat engine: paper/DPP generators honour exclude_used and
--    exclude_paper_ids so repeat revisions never re-test the same questions.
-- 2. Batch question import RPC (taxonomy resolution + hash dedupe), powering
--    the in-app import wizard.
-- 3. Super-admin tenant management RPCs + scoped security-events read.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. app_generate_paper with no-repeat support
--    New filters (uniform mode): filters.exclude_used ('true'),
--    filters.exclude_paper_ids (uuid[]).
--    New top-level flag (section mode): p_spec->>'exclude_used'.
-- ----------------------------------------------------------------------------
create or replace function app_generate_paper(p_spec jsonb, p_seed double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_pattern record;
  v_limit int := 5;
  v_quota_ok boolean;
  v_exam uuid := (p_spec->>'exam_id')::uuid;
  v_count int := coalesce((p_spec->>'count')::int, 30);
  v_title text := coalesce(p_spec->>'title', 'Generated Paper');
  v_code text := p_spec->>'paper_code';
  v_duration int := coalesce((p_spec->>'duration_minutes')::int, 180);
  v_marks numeric := coalesce((p_spec->>'marks')::numeric, 4);
  v_neg numeric := coalesce((p_spec->>'negative_marks')::numeric, 1);
  v_paper_id uuid;
  v_existing uuid;
  v_period text := to_char(now(),'YYYY-MM');
  v_selected jsonb := '[]'::jsonb;
  v_q record;
  v_opt jsonb;
  v_total_marks numeric := 0;
  v_used_hashes text[] := '{}'::text[];
  v_row int := 0;
  v_sections jsonb;
  v_sec jsonb;
  v_sec_count int;
  v_sec_marks numeric;
  v_sec_neg numeric;
  v_sec_subj uuid;
  v_sec_types jsonb;
  v_section_mode boolean := false;
  v_filled int := 0;
  v_missing jsonb := '[]'::jsonb;
  v_no_repeat boolean := (p_spec->'filters'->>'exclude_used') = 'true' or (p_spec->>'exclude_used') = 'true';
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  if v_exam is null then
    return jsonb_build_object('error', 'exam_id required');
  end if;

  if v_code is not null then
    select id into v_existing from papers where tenant_id = v_tenant and paper_code = v_code;
    if v_existing is not null then
      return jsonb_build_object('paper_id', v_existing, 'already', true);
    end if;
  end if;

  select * into v_pattern from exam_patterns
    where exam_id = v_exam and (tenant_id is null or tenant_id = v_tenant) and is_active
    order by version desc limit 1;
  if v_pattern.id is not null then
    v_duration := coalesce(v_duration, v_pattern.duration_minutes);
    v_marks := coalesce(v_marks, v_pattern.default_marks);
    v_neg := coalesce(v_neg, v_pattern.default_negative_marks);
  end if;

  if p_seed is not null then
    perform setseed(p_seed);
  end if;

  select value->>'PAPERS_GENERATED' into v_limit from system_config where key = 'free_quota';
  v_limit := coalesce(v_limit::int, 5);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':PAPERS_GENERATED:' || v_period, 0));
  select app_quota_available(v_tenant, 'PAPERS_GENERATED', v_limit, v_period) into v_quota_ok;
  if not v_quota_ok then
    return jsonb_build_object('error', 'Free paper quota reached (' || v_limit || '/month). Upgrade plan to generate more.');
  end if;

    v_sections := coalesce(v_pattern.sections, '[]'::jsonb);
    v_section_mode := jsonb_array_length(v_sections) > 0
      and (
        p_spec->'filters' is null
        or jsonb_typeof(p_spec->'filters') = 'null'
        or (jsonb_typeof(p_spec->'filters') = 'array' and jsonb_array_length(p_spec->'filters') = 0)
        or (jsonb_typeof(p_spec->'filters') = 'object'
            and (select count(*) from jsonb_object_keys(p_spec->'filters')) = 0)
      );

    -- Enhance section-level filtering with session/shift/subtopic
    if v_section_mode then
      for v_sec in select value from jsonb_array_elements(v_sections) loop
        v_sec_count := coalesce((v_sec->>'count')::int, 0);
        v_sec_marks := coalesce((v_sec->>'marks')::numeric, v_marks);
        v_sec_neg := coalesce((v_sec->>'negative_marks')::numeric, v_neg);
        select id into v_sec_subj from subjects
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_sec->>'subject_code'
            and (exam_id is null or exam_id = v_exam)
          order by (exam_id is null), exam_id desc
          limit 1;
        select coalesce(jsonb_agg(id), '[]'::jsonb) into v_sec_types
          from question_types
          where code in (select x from jsonb_array_elements_text(coalesce(v_sec->'question_type_codes', '[]'::jsonb)) x);

        -- Add session/shift/subtopic filters for sections
        v_filled := 0;
        for v_q in
          select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
                 q.difficulty, q.year, q.session, q.shift, q.question_text, q.question_hash,
                 q.marks, q.negative_marks
          from questions q
          where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and q.verification_status = 'VERIFIED' and q.is_deleted = false
            and (q.exam_id = v_exam or q.exam_id is null)
            and (v_sec_subj is null or q.subject_id = v_sec_subj)
            and (jsonb_array_length(v_sec_types) = 0
                 or q.question_type_id in (select (x)::uuid from jsonb_array_elements_text(v_sec_types) x))
            and (not v_no_repeat
                 or not exists (select 1 from question_usage qu
                                where qu.question_id = q.id and qu.tenant_id = v_tenant))
            and (p_spec->'filters'->>'language' is null or upper(q.language) = upper(p_spec->'filters'->>'language'))
            and (p_spec->'filters'->>'session' is null or q.session = p_spec->'filters'->>'session')
            and (p_spec->'filters'->>'shift' is null or q.shift = p_spec->'filters'->>'shift')
            and (p_spec->'filters'->>'subtopic_id' is null or q.subtopic_id = (p_spec->'filters'->>'subtopic_id')::uuid)
            and (p_spec->'filters'->'exclude_paper_ids' is null
                 or not exists (select 1 from paper_questions pq
                                where pq.question_id = q.id and pq.paper_id = any (array(
                                  select (x)::uuid
                                  from jsonb_array_elements_text(p_spec->'filters'->'exclude_paper_ids') x))))
        order by random()
      loop
        if v_filled >= v_sec_count then exit; end if;
        if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
          continue;
        end if;
        v_selected := v_selected || app_question_snapshot(v_q.id, v_sec_marks, v_sec_neg);
        if v_q.question_hash is not null then
          v_used_hashes := v_used_hashes || v_q.question_hash;
        end if;
        v_filled := v_filled + 1;
      end loop;

      if v_filled < v_sec_count then
        v_missing := v_missing || jsonb_build_object(
          'section', v_sec->>'name', 'required', v_sec_count, 'available', v_filled);
      end if;
    end loop;

    if jsonb_array_length(v_missing) > 0 then
      return jsonb_build_object(
        'error', 'Insufficient eligible questions for one or more sections',
        'missing', v_missing::text);
    end if;
    v_count := jsonb_array_length(v_selected);
  else
    for v_q in
      select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
             q.difficulty, q.year, q.session, q.shift, q.question_text, q.question_hash,
             q.marks, q.negative_marks
      from questions q
      where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
        and q.verification_status = 'VERIFIED' and q.is_deleted = false
        and (q.exam_id = v_exam or q.exam_id is null)
        and (p_spec->'filters'->>'subject_ids' is null or q.subject_id = any (array(
              select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'subject_ids') x)))
        and (p_spec->'filters'->>'chapter_ids' is null or q.chapter_id = any (array(
              select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'chapter_ids') x)))
        and (p_spec->'filters'->>'topic_ids' is null or q.topic_id = any (array(
              select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'topic_ids') x)))
        and (p_spec->'filters'->>'difficulties' is null or q.difficulty = any (array(
              select x from jsonb_array_elements_text(p_spec->'filters'->'difficulties') x)::question_difficulty[]))
        and (p_spec->'filters'->>'years' is null or q.year = any (array(
              select (x)::int from jsonb_array_elements_text(p_spec->'filters'->'years') x)))
        and (p_spec->'filters'->>'question_type_ids' is null or q.question_type_id = any (array(
              select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'question_type_ids') x)))
        and (p_spec->'filters'->>'session' is null or q.session = p_spec->'filters'->>'session')
        and (p_spec->'filters'->>'shift' is null or q.shift = p_spec->'filters'->>'shift')
        and (p_spec->'filters'->>'language' is null or upper(q.language) = upper(p_spec->'filters'->>'language'))
        and (not v_no_repeat
             or not exists (select 1 from question_usage qu
                            where qu.question_id = q.id and qu.tenant_id = v_tenant))
        and (p_spec->'filters'->'exclude_paper_ids' is null
             or not exists (select 1 from paper_questions pq
                            where pq.question_id = q.id and pq.paper_id = any (array(
                              select (x)::uuid
                              from jsonb_array_elements_text(p_spec->'filters'->'exclude_paper_ids') x))))
      order by random()
    loop
      if jsonb_array_length(v_selected) >= v_count then exit; end if;
      if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
        continue;
      end if;
      v_selected := v_selected || app_question_snapshot(v_q.id, v_marks, v_neg);
      if v_q.question_hash is not null then
        v_used_hashes := v_used_hashes || v_q.question_hash;
      end if;
    end loop;

    if jsonb_array_length(v_selected) < v_count then
      return jsonb_build_object(
        'error', 'Insufficient eligible questions',
        'required', v_count,
        'available', jsonb_array_length(v_selected),
        'missing', 'Only ' || jsonb_array_length(v_selected) || ' verified questions match the selected constraints.');
    end if;
  end if;

  if jsonb_array_length(v_selected) = 0 then
    return jsonb_build_object('error', 'No eligible questions match the selected constraints.');
  end if;

  begin
    insert into papers (tenant_id, exam_id, exam_pattern_id, title, paper_code, duration_minutes,
                        total_questions, total_marks, status, instructions, answer_key_json, created_by)
    values (v_tenant, v_exam, v_pattern.id, v_title, v_code, v_duration,
            jsonb_array_length(v_selected), 0, 'LOCKED',
            p_spec->>'instructions',
            jsonb_build_object('marks', v_marks, 'negative_marks', v_neg, 'generated_by', auth.uid()),
            auth.uid())
    returning id into v_paper_id;

    v_row := 0;
    for v_opt in select value from jsonb_array_elements(v_selected)
    loop
      v_row := v_row + 1;
      insert into paper_questions (tenant_id, paper_id, question_id, question_order,
                                   marks, negative_marks, snapshot)
      values (v_tenant, v_paper_id, (v_opt->>'question_id')::uuid, v_row::int,
              coalesce((v_opt->>'marks')::numeric, v_marks),
              coalesce((v_opt->>'negative_marks')::numeric, v_neg),
              v_opt);
      insert into question_usage (tenant_id, question_id, used_in_type, used_in_id)
      values (v_tenant, (v_opt->>'question_id')::uuid, 'PAPER', v_paper_id);
      v_total_marks := v_total_marks + coalesce((v_opt->>'marks')::numeric, v_marks);
    end loop;

    update papers set total_marks = v_total_marks where id = v_paper_id;
    perform app_increment_usage(v_tenant, 'PAPERS_GENERATED', v_period, 1);
    perform app_record_audit('paper_generated', 'papers', v_paper_id,
      jsonb_build_object('tenant_id', v_tenant, 'questions', jsonb_array_length(v_selected),
                         'no_repeat', v_no_repeat, 'seed', p_seed));
  exception when others then
    return jsonb_build_object('error', 'paper generation failed: ' || sqlerrm);
  end;

  return jsonb_build_object('paper_id', v_paper_id, 'questions', jsonb_array_length(v_selected),
    'total_marks', v_total_marks, 'already', false);
end; $$;

-- ----------------------------------------------------------------------------
-- 2. app_generate_dpp with no-repeat support (p_spec->>'exclude_used')
-- ----------------------------------------------------------------------------
create or replace function app_generate_dpp(p_spec jsonb, p_seed double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_limit int := 10;
  v_quota_ok boolean;
  v_exam uuid := (p_spec->>'exam_id')::uuid;
  v_count int := coalesce((p_spec->>'count')::int, 15);
  v_title text := coalesce(p_spec->>'title', 'Daily DPP');
  v_mode text := coalesce(p_spec->>'mode', 'DAILY');
  v_period text := to_char(now(),'YYYY-MM');
  v_dpp_id uuid;
  v_selected jsonb := '[]'::jsonb;
  v_q record;
  v_item jsonb;
  v_used_hashes text[] := '{}'::text[];
  v_row int := 0;
  v_weak_topics uuid[];
  v_marks numeric := coalesce((p_spec->>'marks')::numeric, 4);
  v_neg numeric := coalesce((p_spec->>'negative_marks')::numeric, 1);
  v_no_repeat boolean := coalesce((p_spec->>'exclude_used')::boolean, false);
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  if v_exam is null then
    return jsonb_build_object('error', 'exam_id required');
  end if;

  if v_mode = 'WEAK_TOPIC' then
    select array_agg(topic_id) into v_weak_topics from app_weak_topics(auth.uid(), 5);
    if v_weak_topics is null or array_length(v_weak_topics, 1) = 0 then
      return jsonb_build_object('error', 'No practice history yet — attempt questions first to unlock weak-topic DPP.');
    end if;
  end if;

  if p_seed is not null then
    perform setseed(p_seed);
  end if;

  select value->>'DPP_GENERATED' into v_limit from system_config where key = 'free_quota';
  v_limit := coalesce(v_limit::int, 10);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':DPP_GENERATED:' || v_period, 0));
  select app_quota_available(v_tenant, 'DPP_GENERATED', v_limit, v_period) into v_quota_ok;
  if not v_quota_ok then
    return jsonb_build_object('error', 'Free DPP quota reached (' || v_limit || '/month). Upgrade plan to generate more.');
  end if;

  for v_q in
    select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
           q.difficulty, q.year, q.question_text, q.question_hash, q.marks, q.negative_marks
    from questions q
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.verification_status = 'VERIFIED' and q.is_deleted = false
      and (q.exam_id = v_exam or q.exam_id is null)
      and (v_mode <> 'CHAPTER' or (p_spec->>'chapter_id')::uuid is null or q.chapter_id = (p_spec->>'chapter_id')::uuid)
      and (v_mode <> 'TOPIC' or (p_spec->>'topic_id')::uuid is null or q.topic_id = (p_spec->>'topic_id')::uuid)
      and (v_mode <> 'WEAK_TOPIC' or (v_weak_topics is not null and array_length(v_weak_topics,1) > 0 and q.topic_id = any (v_weak_topics)))
      and (v_mode <> 'PYQ' or q.year in (
            select (x)::int from jsonb_array_elements_text(
              coalesce(p_spec->'filters'->'years', '[2025,2024,2023,2022,2021,2020]'::jsonb)) x))
      and (p_spec->'filters'->>'subject_ids' is null or q.subject_id = any (array(
            select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'subject_ids') x)))
      and (p_spec->'filters'->>'difficulties' is null or q.difficulty = any (array(
            select x from jsonb_array_elements_text(p_spec->'filters'->'difficulties') x)::question_difficulty[]))
      and (p_spec->'filters'->>'language' is null or upper(q.language) = upper(p_spec->'filters'->>'language'))
      and (not v_no_repeat
           or not exists (select 1 from question_usage qu
                          where qu.question_id = q.id and qu.tenant_id = v_tenant))
    order by random()
  loop
    if jsonb_array_length(v_selected) >= v_count then exit; end if;
    if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
      continue;
    end if;
    v_selected := v_selected || app_question_snapshot(v_q.id, v_marks, v_neg);
    if v_q.question_hash is not null then
      v_used_hashes := v_used_hashes || v_q.question_hash;
    end if;
  end loop;

  if jsonb_array_length(v_selected) = 0 then
    return jsonb_build_object('error', 'No eligible questions match the DPP constraints.');
  end if;

  begin
    insert into dpps (tenant_id, title, exam_id, subject_id, chapter_id, topic_id,
                      status, created_by, target_date)
    values (v_tenant, v_title, v_exam,
            (p_spec->>'subject_id')::uuid, (p_spec->>'chapter_id')::uuid, (p_spec->>'topic_id')::uuid,
            'PUBLISHED', auth.uid(), coalesce((p_spec->>'target_date')::date, current_date))
    returning id into v_dpp_id;

    v_row := 0;
    for v_item in select value from jsonb_array_elements(v_selected)
    loop
      v_row := v_row + 1;
      insert into dpp_questions (tenant_id, dpp_id, question_id, question_order)
      values (v_tenant, v_dpp_id, (v_item->>'question_id')::uuid, v_row::int);
      insert into question_usage (tenant_id, question_id, used_in_type, used_in_id)
      values (v_tenant, (v_item->>'question_id')::uuid, 'DPP', v_dpp_id);
    end loop;

    perform app_increment_usage(v_tenant, 'DPP_GENERATED', v_period, 1);
    perform app_record_audit('dpp_generated', 'dpps', v_dpp_id,
      jsonb_build_object('tenant_id', v_tenant, 'mode', v_mode,
                         'questions', jsonb_array_length(v_selected), 'no_repeat', v_no_repeat));
  exception when others then
    return jsonb_build_object('error', 'dpp generation failed: ' || sqlerrm);
  end;

  return jsonb_build_object('dpp_id', v_dpp_id, 'questions', jsonb_array_length(v_selected));
end; $$;

-- ----------------------------------------------------------------------------
-- 3. Batch question import (powers the in-app import wizard)
--    p_items: jsonb array of
--      { question_text, marks, negative_marks, difficulty,
--        exam_code, subject_code, chapter_code, topic_code, question_type_code,
--        year, session, shift, source, source_type,
--        options: [{option_key, option_text, is_correct}],
--        answer: {correct_option_keys[], numerical_answer, explanation},
--        solution_text, short_solution, detailed_solution, concept, formula, hint,
--        tags[] }
--    Taxonomy is resolved against the caller's tenant or the platform bank;
--    missing entries are auto-created in the caller's tenant when
--    p_create_taxonomy is true. Rows whose content hash already exists in the
--    tenant (or is a self-duplicate inside the batch) are skipped.
--    Returns { imported, duplicates, failed, total, errors[] }.
-- ----------------------------------------------------------------------------
create or replace function app_import_questions_batch(
  p_items jsonb,
  p_create_taxonomy boolean default true,
  p_verification verification_status default 'PENDING_REVIEW'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_item jsonb;
  v_imported int := 0;
  v_duplicates int := 0;
  v_failed int := 0;
  v_total int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_exam_id uuid;
  v_subject_id uuid;
  v_chapter_id uuid;
  v_topic_id uuid;
  v_type_id uuid;
  v_qid uuid;
  v_hash text;
  v_text text;
  v_seen_hashes text[] := '{}'::text[];
  v_opt jsonb;
  v_opt_i int := 0;
  v_perm_ok boolean;
  v_clean bool;
  v_mark numeric;
  v_neg numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'p_items must be a non-empty jsonb array');
  end if;

  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;

  -- students must never mutate the question bank
  select not app_user_has_student_only_role(v_tenant) into v_perm_ok;
  if not v_perm_ok then
    return jsonb_build_object('error', 'forbidden: question import requires a non-student role');
  end if;

  v_total := jsonb_array_length(p_items);

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_clean := true;
    begin
      v_text := v_item->>'question_text';
      if v_text is null or length(btrim(v_text)) = 0 then
        v_errors := v_errors || jsonb_build_object('index', v_imported + v_duplicates + v_failed, 'error', 'missing question_text');
        v_failed := v_failed + 1;
        v_clean := false;
        continue;
      end if;

      v_hash := app_question_hash(v_text);
      if v_hash = any (v_seen_hashes) then
        v_duplicates := v_duplicates + 1;
        v_clean := false;
        continue;
      end if;
      if exists (select 1 from questions q
                 where q.tenant_id = v_tenant and q.question_hash = v_hash and q.is_deleted = false) then
        v_duplicates := v_duplicates + 1;
        v_clean := false;
        continue;
      end if;

      -- resolve / create taxonomy
      v_exam_id := null;
      if v_item->>'exam_code' is not null then
        select id into v_exam_id from exams
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'exam_code' order by (tenant_id = v_tenant) desc limit 1;
        if v_exam_id is null and p_create_taxonomy then
          insert into exams (tenant_id, name, code, exam_type, created_by)
          values (v_tenant, v_item->>'exam_code', v_item->>'exam_code', 'GENERIC', auth.uid())
          returning id into v_exam_id;
        end if;
      end if;

      v_subject_id := null;
      if v_item->>'subject_code' is not null then
        select id into v_subject_id from subjects
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'subject_code'
            and (v_exam_id is null or exam_id = v_exam_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_subject_id is null and p_create_taxonomy then
          insert into subjects (tenant_id, exam_id, name, code, created_by)
          values (v_tenant, v_exam_id, v_item->>'subject_code', v_item->>'subject_code', auth.uid())
          returning id into v_subject_id;
        end if;
      end if;

      v_chapter_id := null;
      if v_item->>'chapter_code' is not null then
        select id into v_chapter_id from chapters
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'chapter_code'
            and (v_subject_id is null or subject_id = v_subject_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_chapter_id is null and p_create_taxonomy then
          insert into chapters (tenant_id, subject_id, name, code, created_by)
          values (v_tenant, v_subject_id, v_item->>'chapter_code', v_item->>'chapter_code', auth.uid())
          returning id into v_chapter_id;
        end if;
      end if;

      v_topic_id := null;
      if v_item->>'topic_code' is not null then
        select id into v_topic_id from topics
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'topic_code'
            and (v_chapter_id is null or chapter_id = v_chapter_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_topic_id is null and p_create_taxonomy then
          insert into topics (tenant_id, chapter_id, name, code, created_by)
          values (v_tenant, v_chapter_id, v_item->>'topic_code', v_item->>'topic_code', auth.uid())
          returning id into v_topic_id;
        end if;
      end if;

      v_type_id := null;
      if v_item->>'question_type_code' is not null then
        select id into v_type_id from question_types
          where code = v_item->>'question_type_code' and is_active limit 1;
      end if;

      v_mark := coalesce((v_item->>'marks')::numeric, 4);
      v_neg := coalesce((v_item->>'negative_marks')::numeric, 1);

      insert into questions (tenant_id, exam_id, subject_id, chapter_id, topic_id,
                             question_type_id, question_text, year, difficulty,
                             source, verification_status, question_hash, created_by)
      values (v_tenant, v_exam_id, v_subject_id, v_chapter_id, v_topic_id, v_type_id,
              v_text, (v_item->>'year')::int,
              coalesce((v_item->>'difficulty')::question_difficulty, 'MEDIUM'),
              coalesce(v_item->>'source', 'IMPORT'),
              p_verification, v_hash, auth.uid())
      returning id into v_qid;

      if v_item->'options' is not null and jsonb_typeof(v_item->'options') = 'array' then
        v_opt_i := 0;
        for v_opt in select value from jsonb_array_elements(v_item->'options') loop
          v_opt_i := v_opt_i + 1;
          insert into question_options (tenant_id, question_id, option_key, option_text,
                                        is_correct, display_order)
          values (v_tenant, v_qid,
                  coalesce(v_opt->>'option_key', 'OPT' || v_opt_i),
                  v_opt->>'option_text',
                  coalesce((v_opt->>'is_correct')::boolean, false),
                  coalesce((v_opt->>'display_order')::int, v_opt_i));
        end loop;
      end if;

      insert into question_answers (tenant_id, question_id, correct_option_keys, explanation, created_by)
      values (v_tenant, v_qid,
              coalesce((select array(select x from jsonb_array_elements_text(
                          coalesce(v_item->'answer'->'correct_option_keys', '[]'::jsonb)) x)),
                       '{}'::text[]),
              v_item->'answer'->>'explanation', auth.uid());

      if v_item->>'solution_text' is not null or v_item->'solution' is not null then
        insert into solutions (tenant_id, question_id, solution_text, concept, created_by)
        values (v_tenant, v_qid,
                coalesce(v_item->>'solution_text', v_item->'solution'->>'solution_text'),
                v_item->'solution'->>'concept', auth.uid());
      end if;

      v_seen_hashes := v_seen_hashes || v_hash;
      v_imported := v_imported + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('index', v_imported + v_duplicates + v_failed - 1,
                                                 'error', sqlerrm);
    end;
  end loop;

  if v_imported > 0 then
    perform app_record_audit('questions_imported', 'questions', null,
      jsonb_build_object('tenant_id', v_tenant, 'imported', v_imported,
                         'duplicates', v_duplicates, 'failed', v_failed));
  end if;

  return jsonb_build_object('imported', v_imported, 'duplicates', v_duplicates,
                            'failed', v_failed, 'total', v_total,
                            'errors', coalesce(v_errors, '[]'::jsonb));
end; $$;

-- ----------------------------------------------------------------------------
-- 4. Super-admin tenant management
-- ----------------------------------------------------------------------------
create or replace function app_create_tenant(p_name text, p_slug text, p_type text default 'INDIVIDUAL')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant_id uuid;
  v_role_id uuid;
  v_plan_id uuid;
begin
  if not app_is_platform_admin() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    return jsonb_build_object('error', 'name required');
  end if;
  if exists (select 1 from tenants where slug = p_slug) then
    return jsonb_build_object('error', 'slug already in use');
  end if;

  select id into v_role_id from roles where code = 'SUPER_ADMIN';
  select id into v_plan_id from plans where name ilike '%Free%' and is_active order by price_monthly limit 1;

  insert into tenants (name, slug, status)
  values (p_name, coalesce(p_slug, lower(regexp_replace(p_name, '[^a-z0-9]+', '-', 'g'))), 'TRIAL')
  returning id into v_tenant_id;

  insert into subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
  values (v_tenant_id, v_plan_id, 'TRIAL', now(), now() + interval '14 days');

  if v_role_id is not null and auth.uid() is not null then
    insert into tenant_memberships (tenant_id, user_id, role_id, status)
    values (v_tenant_id, auth.uid(), v_role_id, 'ACTIVE');
  end if;

  perform app_record_audit('tenant_created', 'tenants', v_tenant_id,
    jsonb_build_object('name', p_name, 'slug', p_slug, 'by', auth.uid()));

  return jsonb_build_object('tenant_id', v_tenant_id);
end; $$;

create or replace function app_update_tenant_status(p_tenant_id uuid, p_status tenant_status)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app_is_platform_admin() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  update tenants set status = p_status, updated_at = now() where id = p_tenant_id;
  perform app_record_audit('tenant_status_changed', 'tenants', p_tenant_id,
    jsonb_build_object('status', p_status, 'by', auth.uid()));
  return jsonb_build_object('ok', true);
end; $$;

-- ----------------------------------------------------------------------------
-- 5. Security events: platform admins see everything; tenant admins see
--    events scoped to their own tenant.
-- ----------------------------------------------------------------------------
create or replace function app_security_events(p_tenant_id uuid default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;

  if app_is_platform_admin() then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'tenant_id', tenant_id, 'event_type', event_type,
        'detail', detail, 'ip_address', ip_address, 'created_at', created_at)
        order by created_at desc)
      from security_events
      where p_tenant_id is null or tenant_id = p_tenant_id
      limit p_limit), '[]'::jsonb);
  end if;

  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;

  if exists (select 1 from tenant_memberships tm
             join roles r on r.id = tm.role_id
             where tm.user_id = auth.uid() and tm.tenant_id = v_tenant
               and tm.status = 'ACTIVE' and r.code in ('SUPER_ADMIN', 'INSTITUTION_ADMIN')) then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'tenant_id', tenant_id, 'event_type', event_type,
        'detail', detail, 'ip_address', ip_address, 'created_at', created_at)
        order by created_at desc)
      from security_events
      where (tenant_id = v_tenant or tenant_id = '00000000-0000-0000-0000-000000000001')
      limit p_limit), '[]'::jsonb);
  end if;

  return jsonb_build_object('error', 'forbidden');
end; $$;

-- ----------------------------------------------------------------------------
-- 6. Grants
-- ----------------------------------------------------------------------------
grant execute on function app_import_questions_batch(jsonb, boolean, verification_status) to authenticated;
grant execute on function app_create_tenant(text, text, text) to authenticated;
grant execute on function app_update_tenant_status(uuid, tenant_status) to authenticated;
grant execute on function app_security_events(uuid, int) to authenticated;
