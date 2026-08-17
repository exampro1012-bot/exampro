-- =============================================================================
-- ExamPro — Manual paper creation hardening (Migration 0027_manual_paper)
-- The manual paper route previously checked quota client-side only, letting
-- staff bypass the free-plan limit via direct inserts. This migration moves
-- the whole manual-paper transaction server-side:
--   app_create_manual_paper(p_tenant_id, p_exam_id, p_title, p_duration,
--     p_marks, p_neg, p_questions jsonb[]) -> jsonb
-- Server-side enforcement:
--   1. caller must be an ACTIVE member of p_tenant_id (RLS-safe check)
--   2. student-only members are rejected (0026 parity)
--   3. PAPERS_GENERATED quota is checked AND incremented atomically
--      (advisory xact lock, same pattern as app_generate_paper)
--   4. paper + paper_questions + question_usage rows are written with the
--      caller as created_by; question snapshots come from app_question_snapshot
-- =============================================================================

create or replace function app_create_manual_paper(
  p_tenant_id uuid,
  p_exam_id uuid,
  p_title text,
  p_duration int,
  p_marks numeric,
  p_neg numeric,
  p_questions uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_member boolean;
  v_pattern uuid;
  v_limit int;
  v_period text := to_char(now(), 'YYYY-MM');
  v_quota_ok boolean;
  v_paper uuid;
  v_snap jsonb;
  v_i int;
  v_q record;
begin
  -- 1. tenant membership (no cross-tenant writes)
  select exists (
    select 1 from tenant_memberships tm
    where tm.user_id = v_uid and tm.tenant_id = p_tenant_id and tm.status = 'ACTIVE'
  ) into v_member;
  if not v_member then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- 2. student-only members cannot author papers
  if app_user_has_student_only_role(p_tenant_id) then
    return jsonb_build_object('error', 'only staff can create papers');
  end if;

  -- 3. atomic quota gate (same pattern as app_generate_paper)
  select value->>'PAPERS_GENERATED' into v_limit from system_config where key = 'free_quota';
  v_limit := coalesce(v_limit::int, 5);
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':PAPERS_GENERATED:' || v_period, 0));
  select app_quota_available(p_tenant_id, 'PAPERS_GENERATED', v_limit, v_period) into v_quota_ok;
  if not v_quota_ok then
    return jsonb_build_object('error', 'Free paper quota reached (' || v_limit || '/month). Upgrade plan to generate more.');
  end if;

  -- 4. write paper + questions atomically
  select id into v_pattern from exam_patterns
    where exam_id = p_exam_id and (tenant_id is null or tenant_id = p_tenant_id)
      and is_active order by version desc limit 1;

  insert into papers (tenant_id, exam_id, exam_pattern_id, title, duration_minutes,
                      total_questions, total_marks, status, created_by)
  values (p_tenant_id, p_exam_id, v_pattern, coalesce(nullif(p_title, ''), 'Manual Paper'),
          coalesce(p_duration, 180), coalesce(array_length(p_questions, 1), 0),
          coalesce(array_length(p_questions, 1), 0) * coalesce(p_marks, 4),
          'LOCKED', v_uid)
  returning id into v_paper;

  v_i := 0;
  for v_q in
    select id from questions q
    where q.id = any(p_questions)
      and (q.tenant_id = p_tenant_id or q.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)
      and q.is_deleted = false
  loop
    v_i := v_i + 1;
    select app_question_snapshot(v_q.id, coalesce(p_marks, 4), coalesce(p_neg, 0)) into v_snap;
    insert into paper_questions (tenant_id, paper_id, question_id, question_order, marks, negative_marks, snapshot)
    values (p_tenant_id, v_paper, v_q.id, v_i, coalesce(p_marks, 4), coalesce(p_neg, 0), v_snap);
    insert into question_usage (tenant_id, question_id, used_in_type, used_in_id)
    values (p_tenant_id, v_q.id, 'PAPER', v_paper);
  end loop;

  update papers set total_marks = v_i * coalesce(p_marks, 4) where id = v_paper;

  perform app_increment_usage(p_tenant_id, 'PAPERS_GENERATED', v_period, 1);

  return jsonb_build_object('paper_id', v_paper, 'questions', v_i);
end; $$;

revoke all on function app_create_manual_paper(uuid, uuid, text, int, numeric, numeric, uuid[]) from public;
grant execute on function app_create_manual_paper(uuid, uuid, text, int, numeric, numeric, uuid[]) to authenticated;