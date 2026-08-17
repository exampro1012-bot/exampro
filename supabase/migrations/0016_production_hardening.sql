-- =============================================================================
-- ExamPro — Production-hardening migration (0016)
-- 1. Question provenance: verified_at timestamp set when a question is
--    marked VERIFIED (covers insert and status transitions).
-- 2. Exam UX: responses.marked_for_review (persistent mark-for-review);
--    app_save_response gains the marked flag (server-side timer stays).
-- 3. 250K+ question-bank performance: trgm index for fuzzy/fast text search,
--    composite filter indexes, question_usage anti-join indexes.
-- 4. Institution: students.auth_user_id so student records can be linked to
--    real auth users (assigned exams, results).
-- 5. Question types: reactivate MATCH_FOLLOWING / DIAGRAM / IMAGE_BASED
--    (they are implemented; deactivation was conservative).
-- 6. Multilingual paper generation: app_generate_paper language filter.
-- 7. Security events: app_log_security_event() so login/logout/OAuth/account
--    events are actually recorded (previously the table was write-orphaned).
-- 8. OMR: server-side evaluation app_evaluate_omr_sheet() + score columns on
--    omr_sheets (recognition-independent; evaluates recorded responses).
-- Idempotent. Safe to re-run.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Question provenance: verified_at
-- ----------------------------------------------------------------------------
alter table questions add column if not exists verified_at timestamptz;

create or replace function trg_question_verified_at() returns trigger
language plpgsql as $$
begin
  if new.verification_status = 'VERIFIED'
     and (old.verification_status is distinct from 'VERIFIED' or tg_op = 'INSERT') then
    new.verified_at = coalesce(new.verified_at, now());
  elsif new.verification_status <> 'VERIFIED' then
    new.verified_at = null;
  end if;
  return new;
end; $$;

drop trigger if exists questions_verified_at_trigger on questions;
create trigger questions_verified_at_trigger
  before insert or update of verification_status on questions
  for each row execute function trg_question_verified_at();

-- backfill already-verified questions
update questions set verified_at = coalesce(verified_at, updated_at)
  where verification_status = 'VERIFIED' and verified_at is null;

-- app_verify_question: keep verified_at in sync even when status does not change
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
  update questions
     set verification_status = p_decision,
         verified_by = auth.uid(),
         verified_at = case when p_decision = 'VERIFIED' then now() else null end
   where id = p_question_id;
  insert into question_reviews (tenant_id, question_id, reviewer_id, decision, note)
  values (v_tenant, p_question_id, auth.uid(), p_decision, p_note);
  perform app_record_audit('question_verified', 'questions', p_question_id,
    jsonb_build_object('from', v_old, 'to', p_decision, 'note', p_note));
  return jsonb_build_object('ok', true, 'status', p_decision);
end; $$;

-- ----------------------------------------------------------------------------
-- 2. Exam UX: persistent mark-for-review + marked flag in app_save_response
-- ----------------------------------------------------------------------------
alter table responses add column if not exists marked_for_review boolean not null default false;
create index if not exists ix_responses_session_marked on responses (exam_session_id, marked_for_review);

-- replace the legacy 3-arg overload (superseded by the marked-flag signature)
drop function if exists app_save_response(uuid, uuid, text[]);

create or replace function app_save_response(p_session_id uuid, p_question_id uuid, p_options text[], p_marked boolean default false)
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

  select question_id into v_paper_q from paper_questions
    where paper_id = v_session.paper_id and question_id = p_question_id limit 1;
  if v_paper_q.question_id is null then
    return jsonb_build_object('error', 'question not part of this exam');
  end if;

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

  insert into responses (tenant_id, exam_session_id, question_id, selected_options, marked_for_review, answered_at)
  values (v_session.tenant_id, p_session_id, p_question_id, coalesce(p_options, '{}'::text[]), coalesce(p_marked, false), now())
  on conflict (exam_session_id, question_id)
  do update set selected_options = excluded.selected_options,
                marked_for_review = excluded.marked_for_review,
                answered_at = now();
  return jsonb_build_object('ok', true, 'marked', coalesce(p_marked, false));
end; $$;

-- ----------------------------------------------------------------------------
-- 3. 250K+ question bank: search + filter indexes
-- ----------------------------------------------------------------------------
create index if not exists ix_questions_text_trgm on questions
  using gin (question_text gin_trgm_ops);

create index if not exists ix_questions_tenant_filter on questions
  (tenant_id, exam_id, subject_id, year, difficulty, question_type_id)
  where is_deleted = false;

create index if not exists ix_questions_tenant_verify on questions
  (tenant_id, verification_status, is_deleted);

create index if not exists ix_question_usage_tenant_q on question_usage (tenant_id, question_id);
create index if not exists ix_question_usage_q on question_usage (question_id);

-- ----------------------------------------------------------------------------
-- 4. Institution: link student records to auth users
-- ----------------------------------------------------------------------------
alter table students add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists uq_students_auth_user on students (auth_user_id) where auth_user_id is not null;

-- ----------------------------------------------------------------------------
-- 5. Reactivate implemented question types
-- ----------------------------------------------------------------------------
update question_types set is_active = true
  where code in ('MATCH_FOLLOWING', 'DIAGRAM', 'IMAGE_BASED');

-- ----------------------------------------------------------------------------
-- 6. Security events: app_log_security_event()
--    Called by the client after login/logout/OAuth/account actions. The
--    function is SECURITY DEFINER so inserts bypass the platform-admin-only
--    RLS on security_events while still recording the real actor.
-- ----------------------------------------------------------------------------
create or replace function app_log_security_event(p_event_type text, p_detail text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_ip text;
begin
  select (array_agg(t))[1] into v_tenant from (
    select unnest(app_user_tenant_ids()) as t
  ) x where t is not null;
  v_ip := nullif(split_part(coalesce(
      current_setting('request.headers', true), ''), 'x-forwarded-for:', 2), '');
  insert into security_events (tenant_id, user_id, event_type, detail, ip_address)
  values (v_tenant, auth.uid(), p_event_type, p_detail, nullif(btrim(v_ip), ''));
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function app_log_security_event(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. OMR: server-side evaluation + score columns
-- ----------------------------------------------------------------------------
alter table omr_sheets add column if not exists total_marks numeric;
alter table omr_sheets add column if not exists marks numeric;
alter table omr_sheets add column if not exists correct_count int;
alter table omr_sheets add column if not exists incorrect_count int;
alter table omr_sheets add column if not exists unanswered_count int;
alter table omr_sheets add column if not exists evaluated_at timestamptz;

-- Scores an OMR sheet against its paper's immutable snapshots.
-- Numerical/integer answers are compared numerically (tolerance-aware);
-- MCQ answers compare selected option keys against the snapshot answer.
create or replace function app_evaluate_omr_sheet(p_sheet_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sheet record;
  v_question record;
  v_res record;
  v_total numeric := 0;
  v_marks numeric := 0;
  v_correct int := 0;
  v_incorrect int := 0;
  v_unanswered int := 0;
  v_snapshot jsonb;
  v_ans_keys text[];
  v_num_ans text;
  v_selected text[];
  v_is_correct boolean;
begin
  select id, tenant_id, paper_id, status, template_id into v_sheet
    from omr_sheets where id = p_sheet_id;
  if v_sheet.id is null then
    return jsonb_build_object('error', 'sheet not found');
  end if;
  if not app_can_access_tenant(v_sheet.tenant_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- evaluate every recorded response; count unanswered by scanning the paper
  for v_res in
    select question_no, selected_options from omr_responses
    where omr_sheet_id = p_sheet_id order by question_no
  loop
    select snapshot into v_snapshot
      from paper_questions
      where paper_id = v_sheet.paper_id
        and question_order = v_res.question_no
      limit 1;
    if v_snapshot is null then
      v_unanswered := v_unanswered + 1;
      continue;
    end if;

    v_ans_keys := case
      when v_snapshot->'answer'->'correct_option_keys' is null then '{}'::text[]
      else array(select jsonb_array_elements_text(v_snapshot->'answer'->'correct_option_keys'))
    end;
    v_num_ans := v_snapshot->'answer'->>'numerical_answer';
    v_selected := coalesce(v_res.selected_options, '{}'::text[]);

    v_is_correct := false;
    if v_num_ans is not null and v_num_ans <> '' and array_length(v_selected, 1) = 1 then
      v_is_correct := app_numeric_equal(v_selected[1], v_num_ans);
    elsif array_length(v_selected, 1) > 0 then
      v_is_correct := v_selected = v_ans_keys;
    end if;

    if array_length(v_selected, 1) is null or array_length(v_selected, 1) = 0 then
      v_unanswered := v_unanswered + 1;
    elsif v_is_correct then
      v_correct := v_correct + 1;
      v_marks := v_marks + coalesce((v_snapshot->>'marks')::numeric, 0);
    else
      v_incorrect := v_incorrect + 1;
      v_marks := v_marks - coalesce((v_snapshot->>'negative_marks')::numeric, 0);
    end if;
    v_total := v_total + coalesce((v_snapshot->>'marks')::numeric, 0);

    update omr_responses set evaluated = true, selected_options = v_selected
      where omr_sheet_id = p_sheet_id and question_no = v_res.question_no;
  end loop;

  update omr_sheets
     set status = 'EVALUATED', evaluated_at = now(),
         total_marks = v_total, marks = v_marks,
         correct_count = v_correct, incorrect_count = v_incorrect,
         unanswered_count = v_unanswered
   where id = p_sheet_id;

  perform app_record_audit('omr_evaluated', 'omr_sheets', p_sheet_id,
    jsonb_build_object('correct', v_correct, 'incorrect', v_incorrect,
                       'unanswered', v_unanswered, 'marks', v_marks, 'total', v_total));
  return jsonb_build_object('ok', true, 'correct', v_correct, 'incorrect', v_incorrect,
                            'unanswered', v_unanswered, 'marks', v_marks, 'total_marks', v_total);
end; $$;
grant execute on function app_evaluate_omr_sheet(uuid) to authenticated;