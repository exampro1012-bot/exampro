-- =============================================================================
-- ExamPro — Security hardening + engine completion (Migration 0010)
-- 1. Student-level data isolation (RLS): students may only ever see their own
--    sessions/responses/results; staff still see the tenant scope.
-- 2. Server-controlled exam timing: response saves go through app_save_response
--    which rejects writes after ends_at; finalization ignores late responses.
-- 3. Paper engine: exam-scoped eligibility pool, deterministic seeding,
--    exam-pattern section distribution (subject + question types + per-section
--    marks/negative marks), advisory-lock quota enforcement.
-- 4. Server-side DPP generator (chapter / topic / PYQ / weak-topic / custom).
-- 5. Practice logging, question_hash maintenance, data-quality + system-health
--    RPCs, question_types cleanup.
-- Idempotent. Safe to re-run.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helpers
-- ----------------------------------------------------------------------------
-- True when the caller's ACTIVE roles contain only STUDENT / PARENT
-- (i.e. a learner). Used to scope RLS to "own rows" for learners while
-- teachers/admins keep the tenant scope.
create or replace function app_user_has_student_only_role() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE'
  ) and not exists (
    select 1 from tenant_memberships tm
    join roles r on r.id = tm.role_id
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE'
      and r.code not in ('STUDENT','PARENT')
  );
$$;

-- Immutable snapshot of a question (options / answer / solution) used by the
-- paper + DPP engines.
create or replace function app_question_snapshot(p_qid uuid, p_marks numeric, p_neg numeric)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'question_id', q.id, 'question_text', q.question_text, 'question_html', q.question_html,
    'year', q.year, 'session', q.session, 'shift', q.shift, 'difficulty', q.difficulty,
    'subject_id', q.subject_id, 'chapter_id', q.chapter_id, 'topic_id', q.topic_id,
    'marks', coalesce(p_marks, q.marks), 'negative_marks', coalesce(p_neg, q.negative_marks),
    'options', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'option_key', o.option_key, 'option_text', o.option_text, 'display_order', o.display_order)
        order by o.display_order, o.option_key), '[]'::jsonb)
      from question_options o where o.question_id = q.id
    ),
    'answer', (
      select jsonb_build_object('correct_option_keys', coalesce(qa.correct_option_keys, '{}'::text[]),
                                'numerical_answer', qa.numerical_answer, 'explanation', qa.explanation)
      from question_answers qa where qa.question_id = q.id limit 1
    ),
    'solution', (
      select jsonb_build_object('solution_text', s.solution_text, 'short_solution', s.short_solution,
                                'detailed_solution', s.detailed_solution, 'concept', s.concept,
                                'formula', s.formula, 'hint', s.hint, 'solution_type', s.solution_type)
      from solutions s where s.question_id = q.id limit 1
    )
  ) from questions q where q.id = p_qid;
$$;

-- ----------------------------------------------------------------------------
-- 1. Student-level RLS isolation
-- ----------------------------------------------------------------------------
-- Student-only membership must be judged WITHIN the tenant being accessed:
-- a user may be SUPER_ADMIN of their own workspace and a STUDENT in an
-- institution tenant; the student restriction must not leak across tenants.
drop function if exists app_user_has_student_only_role() cascade;
create or replace function app_user_has_student_only_role(p_tenant_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from tenant_memberships tm
            where tm.user_id = auth.uid() and tm.tenant_id = p_tenant_id and tm.status = 'ACTIVE')
    and not exists (
      select 1 from tenant_memberships tm
      join roles r on r.id = tm.role_id
      where tm.user_id = auth.uid() and tm.tenant_id = p_tenant_id and tm.status = 'ACTIVE'
        and r.code not in ('STUDENT', 'PARENT')
    );
$$;

drop policy if exists exam_sessions_all on exam_sessions;
drop policy if exists exam_sessions_select on exam_sessions;
drop policy if exists exam_sessions_write on exam_sessions;
create policy exam_sessions_select on exam_sessions for select to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or student_id = auth.uid()));
create policy exam_sessions_write on exam_sessions for all to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or student_id = auth.uid()))
  with check (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or student_id = auth.uid()));

drop policy if exists responses_all on responses;
drop policy if exists responses_select on responses;
drop policy if exists responses_write on responses;
create policy responses_select on responses for select to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id)
              or exists (select 1 from exam_sessions es
                         where es.id = responses.exam_session_id and es.student_id = auth.uid())));
create policy responses_write on responses for all to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id)
              or exists (select 1 from exam_sessions es
                         where es.id = responses.exam_session_id and es.student_id = auth.uid())))
  with check (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id)
              or exists (select 1 from exam_sessions es
                         where es.id = responses.exam_session_id and es.student_id = auth.uid())));

drop policy if exists results_all on results;
drop policy if exists results_select on results;
drop policy if exists results_write on results;
create policy results_select on results for select to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or student_id = auth.uid()));
create policy results_write on results for all to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or student_id = auth.uid()))
  with check (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or student_id = auth.uid()));

-- student_notes: learners see only their own notes; staff see tenant notes.
drop policy if exists student_notes_all on student_notes;
drop policy if exists student_notes_select on student_notes;
drop policy if exists student_notes_write on student_notes;
create policy student_notes_select on student_notes for select to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or user_id = auth.uid()));
create policy student_notes_write on student_notes for all to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or user_id = auth.uid()))
  with check (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id) or user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. Server-controlled response saving + timing enforcement
-- ----------------------------------------------------------------------------
create or replace function app_save_response(p_session_id uuid, p_question_id uuid, p_options text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_session record;
  v_paper_q record;
  v_ok boolean;
begin
  select id, tenant_id, paper_id, student_id, status, started_at, ends_at into v_session
    from exam_sessions where id = p_session_id;
  if v_session.id is null then
    return jsonb_build_object('error', 'session not found');
  end if;

  -- the response must belong to a question that is part of the session's paper
  select question_id into v_paper_q from paper_questions
    where paper_id = v_session.paper_id and question_id = p_question_id limit 1;
  if v_paper_q.question_id is null then
    return jsonb_build_object('error', 'question not part of this exam');
  end if;

  -- only the student owner may answer
  v_ok := v_session.student_id = auth.uid();
  if not v_ok then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_session.status = 'SUBMITTED' then
    return jsonb_build_object('error', 'exam already submitted');
  end if;

  -- server-side time enforcement (the browser timer is only cosmetic)
  if v_session.ends_at is not null and now() > v_session.ends_at then
    return jsonb_build_object('error', 'exam time is over');
  end if;

  insert into responses (tenant_id, exam_session_id, question_id, selected_options, answered_at)
  values (v_session.tenant_id, p_session_id, p_question_id, coalesce(p_options, '{}'::text[]), now())
  on conflict (exam_session_id, question_id)
  do update set selected_options = excluded.selected_options, answered_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- ----------------------------------------------------------------------------
-- 3. app_finalize_session: clamp responses saved after ends_at
--    (a response recorded later than the server deadline is treated as absent)
-- ----------------------------------------------------------------------------
create or replace function app_finalize_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_session record;
  v_result record;
  v_res_id uuid;
  v_paper record;
  v_total_marks numeric := 0;
  v_marks numeric := 0;
  v_correct int := 0;
  v_incorrect int := 0;
  v_answered int := 0;
  v_total_q int := 0;
  v_snapshot jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_acc numeric; v_pct numeric;
  r record;
  v_ok boolean;
begin
  select id, tenant_id, paper_id, student_id, status, ends_at into v_session
    from exam_sessions where id = p_session_id;
  if v_session.id is null then
    return jsonb_build_object('error', 'session not found');
  end if;

  v_ok := (v_session.student_id = auth.uid())
    or exists (select 1 from tenant_memberships tm
               where tm.user_id = auth.uid() and tm.tenant_id = v_session.tenant_id and tm.status = 'ACTIVE');
  if not v_ok then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- idempotency: an existing result is returned unchanged
  select id, correct, incorrect, unanswered, marks, total_marks, accuracy, percentage, snapshot
    into v_result from results where exam_session_id = p_session_id;
  if v_result.id is not null then
    return jsonb_build_object('result_id', v_result.id, 'already', true,
      'correct', v_result.correct, 'incorrect', v_result.incorrect,
      'unanswered', v_result.unanswered, 'marks', v_result.marks,
      'total_marks', v_result.total_marks, 'accuracy', v_result.accuracy,
      'percentage', v_result.percentage, 'snapshot', v_result.snapshot);
  end if;

  select id, title, total_questions, total_marks, exam_pattern_id, duration_minutes
    into v_paper from papers where id = v_session.paper_id;

  for r in
    select pq.question_id, pq.question_order, pq.marks, pq.negative_marks,
           pq.snapshot,
           resp.selected_options,
           resp.answered_at
    from paper_questions pq
    left join responses resp
      on resp.question_id = pq.question_id
     and resp.exam_session_id = p_session_id
     and (v_session.ends_at is null or resp.answered_at <= v_session.ends_at)
    where pq.paper_id = v_session.paper_id
    order by pq.question_order
  loop
    v_total_q := v_total_q + 1;
    v_total_marks := v_total_marks + coalesce(r.marks, 0);
    v_items := v_items || jsonb_build_object(
      'question_id', r.question_id, 'order', r.question_order,
      'marks', r.marks, 'negative_marks', r.negative_marks,
      'answered', r.selected_options is not null and array_length(r.selected_options, 1) > 0,
      'selected', coalesce(r.selected_options, '{}'::text[]),
      'correct', false
    );
    if r.selected_options is not null and array_length(r.selected_options, 1) > 0 then
      v_answered := v_answered + 1;
      if r.snapshot is not null then
        if (r.snapshot->'answer'->>'numerical_answer') is not null then
          if app_numeric_equal(r.selected_options[1], r.snapshot->'answer'->>'numerical_answer') then
            v_correct := v_correct + 1;
            v_marks := v_marks + coalesce(r.marks, 0);
            v_items := jsonb_set(v_items, array[(v_total_q - 1)::text, 'correct'], 'true');
          else
            v_incorrect := v_incorrect + 1;
            v_marks := v_marks - coalesce(r.negative_marks, 0);
          end if;
        else
          if r.selected_options @> (
                select coalesce(array_agg(k), '{}'::text[]) from jsonb_array_elements_text(
                  coalesce(r.snapshot->'answer'->'correct_option_keys', '[]'::jsonb)) k)
             and r.selected_options <@ (
                select coalesce(array_agg(k), '{}'::text[]) from jsonb_array_elements_text(
                  coalesce(r.snapshot->'answer'->'correct_option_keys', '[]'::jsonb)) k) then
            v_correct := v_correct + 1;
            v_marks := v_marks + coalesce(r.marks, 0);
            v_items := jsonb_set(v_items, array[(v_total_q - 1)::text, 'correct'], 'true');
          else
            v_incorrect := v_incorrect + 1;
            v_marks := v_marks - coalesce(r.negative_marks, 0);
          end if;
        end if;
      else
        if exists (
          select 1 from question_answers qa
          where qa.question_id = r.question_id
            and ((r.selected_options @> qa.correct_option_keys and r.selected_options <@ qa.correct_option_keys)
                 or (qa.numerical_answer is not null
                     and app_numeric_equal(r.selected_options[1], qa.numerical_answer)))
        ) then
          v_correct := v_correct + 1;
          v_marks := v_marks + coalesce(r.marks, 0);
          v_items := jsonb_set(v_items, array[(v_total_q - 1)::text, 'correct'], 'true');
        else
          v_incorrect := v_incorrect + 1;
          v_marks := v_marks - coalesce(r.negative_marks, 0);
        end if;
      end if;
    end if;
  end loop;

  v_acc := case when v_answered > 0 then round(v_correct::numeric / v_answered * 100, 2) else 0 end;
  v_pct := case when v_total_marks > 0 then round(v_marks / v_total_marks * 100, 2) else 0 end;

  v_snapshot := jsonb_build_object(
    'paper_id', v_session.paper_id,
    'paper_title', v_paper.title,
    'exam_pattern_id', v_paper.exam_pattern_id,
    'total_questions', v_total_q,
    'total_marks', v_total_marks,
    'scoring', jsonb_build_object('marks_per_question', v_paper.total_marks, 'duration_minutes', v_paper.duration_minutes),
    'items', v_items,
    'finalized_at', now()
  );

  insert into results (tenant_id, exam_session_id, student_id, paper_id, total_marks, marks,
                       correct, incorrect, unanswered, accuracy, percentage, snapshot)
  values (v_session.tenant_id, p_session_id, v_session.student_id, v_session.paper_id,
          v_total_marks, v_marks, v_correct, v_incorrect, v_total_q - v_answered, v_acc, v_pct, v_snapshot)
  on conflict (exam_session_id) where exam_session_id is not null do nothing
  returning id into v_res_id;

  if v_res_id is null then
    select id into v_res_id from results where exam_session_id = p_session_id;
  end if;

  update exam_sessions set status = 'SUBMITTED',
    submitted_at = coalesce(submitted_at, now())
    where id = p_session_id;

  return jsonb_build_object('result_id', v_res_id, 'correct', v_correct, 'incorrect', v_incorrect,
    'unanswered', v_total_q - v_answered, 'marks', v_marks, 'total_marks', v_total_marks,
    'accuracy', v_acc, 'percentage', v_pct);
end; $$;

-- ----------------------------------------------------------------------------
-- 4. Paper generation engine v2
--    - eligibility pool is scoped to the requested exam (plus unassigned)
--    - deterministic when p_seed is provided (setseed)
--    - when the active exam pattern defines sections, questions are selected
--      per section (subject_code + question_type_codes + per-section marks)
--    - quota check is serialized with an advisory lock (no concurrent races)
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
  v_snap jsonb;
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
  v_reason text;
  v_missing jsonb := '[]'::jsonb;
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

  -- deterministic ordering when a seed is supplied
  if p_seed is not null then
    perform setseed(p_seed);
  end if;

  -- quota gate (serialized per tenant + period)
  select value->>'PAPERS_GENERATED' into v_limit from system_config where key = 'free_quota';
  v_limit := coalesce(v_limit::int, 5);
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':PAPERS_GENERATED:' || v_period, 0));
  select app_quota_available(v_tenant, 'PAPERS_GENERATED', v_limit, v_period) into v_quota_ok;
  if not v_quota_ok then
    return jsonb_build_object('error', 'Free paper quota reached (' || v_limit || '/month). Upgrade plan to generate more.');
  end if;

  -- section mode: pattern sections drive per-subject / per-type distribution
  v_sections := coalesce(v_pattern.sections, '[]'::jsonb);
  v_section_mode := jsonb_array_length(v_sections) > 0
    and (
      p_spec->'filters' is null
      or jsonb_typeof(p_spec->'filters') = 'null'
      or (jsonb_typeof(p_spec->'filters') = 'array' and jsonb_array_length(p_spec->'filters') = 0)
      or (jsonb_typeof(p_spec->'filters') = 'object'
          and (select count(*) from jsonb_object_keys(p_spec->'filters')) = 0)
    );

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
    -- uniform mode with the requested filters (all enforced server-side)
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

  -- transactional insert
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
      jsonb_build_object('tenant_id', v_tenant, 'questions', jsonb_array_length(v_selected), 'seed', p_seed));
  exception when others then
    return jsonb_build_object('error', 'paper generation failed: ' || sqlerrm);
  end;

  return jsonb_build_object('paper_id', v_paper_id, 'questions', jsonb_array_length(v_selected),
    'total_marks', v_total_marks, 'already', false);
end; $$;

-- ----------------------------------------------------------------------------
-- 5. Server-side DPP generator
--    modes: DAILY | CHAPTER | TOPIC | PYQ | REVISION | WEAK_TOPIC | CUSTOM
--    weak-topic mode uses real practice history (no AI required)
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
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  if v_exam is null then
    return jsonb_build_object('error', 'exam_id required');
  end if;

  -- weak-topic mode needs the caller to be the learner (own history)
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
      -- mode-specific filters (all server-side)
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
      jsonb_build_object('tenant_id', v_tenant, 'mode', v_mode, 'questions', jsonb_array_length(v_selected)));
  exception when others then
    return jsonb_build_object('error', 'dpp generation failed: ' || sqlerrm);
  end;

  return jsonb_build_object('dpp_id', v_dpp_id, 'questions', jsonb_array_length(v_selected));
end; $$;

-- ----------------------------------------------------------------------------
-- 6. Practice logging (learner self-service)
-- ----------------------------------------------------------------------------
create or replace function app_log_practice(p_question_id uuid, p_correct boolean, p_time_spent int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_q_ok boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'unauthenticated');
  end if;
  -- question must be readable (own tenant or shared platform bank)
  select exists (
    select 1 from questions q
    where q.id = p_question_id and q.is_deleted = false
      and (app_can_read_content(q.tenant_id))
  ) into v_q_ok;
  if not v_q_ok then
    return jsonb_build_object('error', 'question not accessible');
  end if;
  insert into practice_logs (user_id, question_id, correct, time_spent)
  values (auth.uid(), p_question_id, p_correct, p_time_spent);
  return jsonb_build_object('ok', true);
end; $$;

-- ----------------------------------------------------------------------------
-- 7. Data quality dashboard (platform admins only)
-- ----------------------------------------------------------------------------
create or replace function app_data_quality() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when app_is_platform_admin() then (
    select jsonb_build_object(
      'total', count(*),
      'verified', count(*) filter (where verification_status = 'VERIFIED'),
      'pending', count(*) filter (where verification_status = 'PENDING_REVIEW'),
      'rejected', count(*) filter (where verification_status = 'REJECTED'),
      'needs_edit', count(*) filter (where verification_status = 'NEEDS_EDIT'),
      'deleted', count(*) filter (where is_deleted),
      'no_exam', count(*) filter (where exam_id is null),
      'no_chapter', count(*) filter (where chapter_id is null),
      'no_topic', count(*) filter (where topic_id is null),
      'no_type', count(*) filter (where question_type_id is null),
      'missing_answer', count(*) filter (where not exists (select 1 from question_answers a where a.question_id = questions.id)),
      'missing_solution', count(*) filter (where not exists (select 1 from solutions s where s.question_id = questions.id)),
      'duplicate_pairs_open', (select count(*) from question_duplicates where status = 'OPEN'),
      'recent_reviews', (select count(*) from question_reviews where created_at > now() - interval '30 days')
    ) from questions
  ) else jsonb_build_object('error', 'forbidden') end;
$$;

-- ----------------------------------------------------------------------------
-- 8. System health (platform admins only)
-- ----------------------------------------------------------------------------
create or replace function app_system_health() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when app_is_platform_admin() then (
    select jsonb_build_object(
      'auth_users', (select count(*) from auth.users),
      'tenants', (select count(*) from tenants),
      'questions', (select count(*) from questions where is_deleted = false),
      'papers', (select count(*) from papers),
      'dpps', (select count(*) from dpps),
      'results', (select count(*) from results),
      'exam_sessions', (select count(*) from exam_sessions),
      'responses', (select count(*) from responses),
      'omr_sheets', (select count(*) from omr_sheets),
      'students_roster', (select count(*) from students where is_deleted = false),
      'teachers', (select count(*) from teachers),
      'import_jobs', (select count(*) from import_jobs),
      'notifications', (select count(*) from notifications),
      'storage_objects', (select count(*) from storage_objects where is_deleted = false),
      'audit_logs', (select count(*) from audit_logs),
      'security_events', (select count(*) from security_events),
      'usage_rows', (select count(*) from usage),
      'active_sessions_24h', (select count(*) from exam_sessions where started_at > now() - interval '24 hours'),
      'subscriptions_trial', (select count(*) from subscriptions where status = 'TRIAL'),
      'subscriptions_active', (select count(*) from subscriptions where status = 'ACTIVE'),
      'checked_at', now()
    )
  ) else jsonb_build_object('error', 'forbidden') end;
$$;

-- ----------------------------------------------------------------------------
-- 9. question_hash maintenance (auto-set on insert / text change)
-- ----------------------------------------------------------------------------
create or replace function trg_question_hash() returns trigger
language plpgsql as $$
begin
  if NEW.question_hash is null then
    NEW.question_hash := app_question_hash(NEW.question_text);
  end if;
  return NEW;
end; $$;

drop trigger if exists questions_hash_trigger on questions;
create trigger questions_hash_trigger before insert or update of question_text on questions
  for each row execute function trg_question_hash();

-- backfill existing null hashes one at a time; rows whose hash collides with
-- an existing question are skipped (surfaced in the data-quality dashboard)
do $$
declare r record;
begin
  for r in select id, app_question_hash(question_text) as h from questions where question_hash is null
  loop
    begin
      update questions set question_hash = r.h where id = r.id;
    exception when unique_violation then
      null; -- genuine duplicate text already present in the bank
    end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 10. question_types cleanup (deactivate duplicate / unused codes)
-- ----------------------------------------------------------------------------
update question_types set is_active = false
  where code in ('MATCH_FOLLOWING', 'IMAGE')
    and not exists (select 1 from questions q where q.question_type_id = question_types.id);

-- ----------------------------------------------------------------------------
-- 11. Grants
-- ----------------------------------------------------------------------------
grant execute on function app_save_response(uuid, uuid, text[]) to authenticated;
grant execute on function app_generate_paper(jsonb, double precision) to authenticated;
grant execute on function app_generate_dpp(jsonb, double precision) to authenticated;
grant execute on function app_log_practice(uuid, boolean, int) to authenticated;
grant execute on function app_data_quality() to authenticated;
grant execute on function app_system_health() to authenticated;
grant execute on function app_question_snapshot(uuid, numeric, numeric) to authenticated;
