-- =============================================================================
-- ExamPro — Application functions (Migration 0007)
-- Server-authoritative: quota gate, paper generation engine, exam finalization,
-- verification, audit. All functions validate authorization internally and are
-- callable by `authenticated` (RLS stays authoritative).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Free-quota availability (alias of app_quota_ok, callable by clients)
-- ----------------------------------------------------------------------------
create or replace function app_quota_available(
  p_tenant_id uuid, p_metric text, p_limit int, p_period text default to_char(now(),'YYYY-MM')
) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select count from usage
    where tenant_id = p_tenant_id and metric = p_metric and period = p_period), 0) < p_limit;
$$;

-- ----------------------------------------------------------------------------
-- 2. Idempotent server-side exam finalization + scoring
-- Scores strictly from the immutable paper_questions.snapshot (falls back to
-- live question_answers). Never trusts the browser timer or client data.
-- ----------------------------------------------------------------------------
create unique index if not exists results_session_unique_idx on results (exam_session_id)
  where exam_session_id is not null;
create unique index if not exists papers_tenant_code_unique_idx on papers (tenant_id, paper_code)
  where paper_code is not null;

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
  select id, tenant_id, paper_id, student_id, status into v_session
    from exam_sessions where id = p_session_id;
  if v_session.id is null then
    return jsonb_build_object('error', 'session not found');
  end if;

  -- authorization: the session owner, or any ACTIVE member of the session tenant
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
    left join responses resp on resp.question_id = pq.question_id and resp.exam_session_id = p_session_id
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
        -- immutable snapshot scoring
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
        -- fallback: live answer key
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

-- numeric/text answer comparison helper
create or replace function app_numeric_equal(a text, b text) returns boolean
language sql immutable as $$
  select case
    when a is null or b is null then false
    when a = b then true
    else
      case when a ~ '^[0-9eE+-\.]+$' and b ~ '^[0-9eE+-\.]+$'
        then abs(a::numeric - b::numeric) < 0.0001
        else lower(trim(a)) = lower(trim(b))
      end
  end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Paper generation engine (blueprint -> pool -> balance -> snapshot -> lock)
-- Returns {paper_id, questions, total_marks} or {error, required, available}.
-- Idempotent: a caller-provided paper_code is stored per tenant and re-used.
-- ----------------------------------------------------------------------------
create or replace function app_generate_paper(p_spec jsonb, p_seed double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_role uuid;
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
  v_pool jsonb := '[]'::jsonb;
  v_q record;
  v_selected jsonb := '[]'::jsonb;
  v_opt jsonb;
  v_snap jsonb;
  v_total_marks numeric := 0;
  v_used_hashes text[] := '{}'::text[];
  v_row int := 0;
begin
  -- resolve caller tenant from membership (never trust client tenant_id)
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;
  if v_exam is null then
    return jsonb_build_object('error', 'exam_id required');
  end if;

  -- idempotency: same paper_code returns the existing paper
  if v_code is not null then
    select id into v_existing from papers where tenant_id = v_tenant and paper_code = v_code;
    if v_existing is not null then
      return jsonb_build_object('paper_id', v_existing, 'already', true);
    end if;
  end if;

  -- active exam pattern drives defaults
  select * into v_pattern from exam_patterns
    where exam_id = v_exam and (tenant_id is null or tenant_id = v_tenant) and is_active
    order by version desc limit 1;
  if v_pattern.id is not null then
    v_count := coalesce(v_count, v_pattern.total_questions);
    v_duration := coalesce(v_duration, v_pattern.duration_minutes);
    v_marks := coalesce(v_marks, v_pattern.default_marks);
    v_neg := coalesce(v_neg, v_pattern.default_negative_marks);
  end if;

  -- free quota gate (server-side, transactional)
  select value->>'PAPERS_GENERATED' into v_limit from system_config where key = 'free_quota';
  v_limit := coalesce(v_limit::int, 5);
  select app_quota_available(v_tenant, 'PAPERS_GENERATED', v_limit, v_period) into v_quota_ok;
  if not v_quota_ok then
    return jsonb_build_object('error', 'Free paper quota reached (' || v_limit || '/month). Upgrade plan to generate more.');
  end if;

  -- eligible pool: own tenant + shared platform bank
  for v_q in
    select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
           q.difficulty, q.year, q.session, q.shift, q.question_text, q.question_hash,
           q.marks, q.negative_marks, q.verification_status, q.is_deleted
    from questions q
    where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and q.verification_status = 'VERIFIED' and q.is_deleted = false
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
    order by random()
  loop
    -- duplicate exclusion by hash within the same paper
    if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
      continue;
    end if;
    if jsonb_array_length(v_selected) >= v_count then exit; end if;

    -- snapshot the question (immutable)
    v_snap := jsonb_build_object(
      'question_id', v_q.id, 'question_text', v_q.question_text, 'year', v_q.year,
      'session', v_q.session, 'shift', v_q.shift, 'difficulty', v_q.difficulty,
      'subject_id', v_q.subject_id, 'chapter_id', v_q.chapter_id, 'topic_id', v_q.topic_id,
      'marks', coalesce(v_q.marks, v_marks), 'negative_marks', coalesce(v_q.negative_marks, v_neg),
      'options', (
        select coalesce(jsonb_agg(jsonb_build_object('option_key', o.option_key, 'option_text', o.option_text, 'display_order', o.display_order) order by o.display_order, o.option_key), '[]'::jsonb)
        from question_options o where o.question_id = v_q.id
      ),
      'answer', (
        select jsonb_build_object('correct_option_keys', coalesce(qa.correct_option_keys, '{}'::text[]), 'numerical_answer', qa.numerical_answer)
        from question_answers qa where qa.question_id = v_q.id limit 1
      ),
      'solution', (
        select jsonb_build_object('solution_text', s.solution_text, 'short_solution', s.short_solution,
                                  'detailed_solution', s.detailed_solution, 'concept', s.concept,
                                  'formula', s.formula, 'hint', s.hint, 'solution_type', s.solution_type)
        from solutions s where s.question_id = v_q.id limit 1
      )
    );
    v_selected := v_selected || v_snap;
    if v_q.question_hash is not null then
      v_used_hashes := v_used_hashes || v_q.question_hash;
    end if;
  end loop;

  if jsonb_array_length(v_selected) < v_count then
    return jsonb_build_object(
      'error', 'Insufficient eligible questions',
      'required', v_count,
      'available', jsonb_array_length(v_selected),
      'missing', 'Only ' || jsonb_array_length(v_selected) || ' verified questions match the selected constraints.'
    );
  end if;

  -- transactional insert
  begin
    insert into papers (tenant_id, exam_id, exam_pattern_id, title, paper_code, duration_minutes,
                        total_questions, total_marks, status, instructions, answer_key_json, created_by)
    values (v_tenant, v_exam, v_pattern.id, v_title, v_code, v_duration,
            v_count, v_count * v_marks, 'LOCKED',
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
      jsonb_build_object('tenant_id', v_tenant, 'questions', v_count));
  exception when others then
    return jsonb_build_object('error', 'paper generation failed: ' || sqlerrm);
  end;

  return jsonb_build_object('paper_id', v_paper_id, 'questions', v_count,
    'total_marks', v_total_marks, 'already', false);
end; $$;

-- ----------------------------------------------------------------------------
-- 4. Question verification (review workflow)
-- ----------------------------------------------------------------------------
create or replace function app_verify_question(p_question_id uuid, p_decision verification_status, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_allowed boolean; v_old verification_status;
begin
  select tenant_id, verification_status into v_tenant, v_old from questions where id = p_question_id;
  if v_tenant is null then return jsonb_build_object('error', 'question not found'); end if;
  v_allowed := app_is_platform_admin() or (
    exists (select 1 from tenant_memberships tm where tm.user_id = auth.uid()
            and tm.tenant_id = v_tenant and tm.status = 'ACTIVE')
    and (v_tenant = '00000000-0000-0000-0000-000000000001' or app_has_permission('questions.review'))
  );
  if not v_allowed then return jsonb_build_object('error', 'forbidden'); end if;
  update questions set verification_status = p_decision, verified_by = auth.uid() where id = p_question_id;
  insert into question_reviews (tenant_id, question_id, reviewer_id, decision, note)
  values (v_tenant, p_question_id, auth.uid(), p_decision, p_note);
  perform app_record_audit('question_verified', 'questions', p_question_id,
    jsonb_build_object('from', v_old, 'to', p_decision, 'note', p_note));
  return jsonb_build_object('ok', true, 'status', p_decision);
end; $$;

-- ----------------------------------------------------------------------------
-- 5. Audit helper + automatic audit trigger on key tables
-- ----------------------------------------------------------------------------
create or replace function app_record_audit(p_action text, p_entity text, p_entity_id uuid, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (tenant_id, user_id, action, entity, entity_id, after)
  select (select tm.tenant_id from tenant_memberships tm
          where tm.user_id = auth.uid() and tm.status = 'ACTIVE' limit 1),
         auth.uid(), p_action, p_entity, p_entity_id, p_detail;
$$;

create or replace function trg_audit_questions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    perform app_record_audit('question_create', 'questions', NEW.id,
      jsonb_build_object('tenant_id', NEW.tenant_id));
  elsif TG_OP = 'UPDATE' then
    perform app_record_audit('question_update', 'questions', NEW.id,
      jsonb_build_object('tenant_id', NEW.tenant_id, 'verification_status', NEW.verification_status));
  elsif TG_OP = 'DELETE' then
    perform app_record_audit('question_delete', 'questions', OLD.id,
      jsonb_build_object('tenant_id', OLD.tenant_id));
  end if;
  return null;
end; $$;

drop trigger if exists questions_audit on questions;
create trigger questions_audit after insert or update or delete on questions
  for each row execute function trg_audit_questions();

-- ----------------------------------------------------------------------------
-- 6. Grants for client-callable functions
-- ----------------------------------------------------------------------------
grant execute on function app_quota_available(uuid, text, int, text) to authenticated;
grant execute on function app_finalize_session(uuid) to authenticated;
grant execute on function app_generate_paper(jsonb, double precision) to authenticated;
grant execute on function app_verify_question(uuid, verification_status, text) to authenticated;
grant execute on function app_record_audit(text, text, uuid, jsonb) to authenticated;
grant execute on function app_weak_topics(uuid, int) to authenticated;
grant execute on function app_question_hash(text) to authenticated, anon;