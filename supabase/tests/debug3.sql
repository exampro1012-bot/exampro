create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
select ep_setup();
-- show what the function returns (it returns jsonb, does not raise on quota/pool errors)
do $$
declare v_exam uuid; v_subj uuid; v_paper jsonb;
begin
  select id into v_exam from exams where code='jee-main';
  select id into v_subj from subjects where exam_id=v_exam and code='physics';
  v_paper := app_generate_paper(jsonb_build_object(
    'exam_id', v_exam, 'count', 10, 'title', 'Test Paper',
    'paper_code', 'TEST-PAPER-001', 'marks', 4, 'negative_marks', 1,
    'filters', jsonb_build_object('subject_ids', jsonb_build_array(v_subj))
  ));
  raise notice 'RESULT JSON = %', v_paper;
end $$;
-- sanity: raw counts
select 'questions_in_tenant' as k, count(*) from questions where tenant_id='22222222-2222-2222-2222-222222222222'
union all select 'verified', count(*) from questions where tenant_id='22222222-2222-2222-2222-222222222222' and verification_status='VERIFIED' and is_deleted=false
union all select 'memberships_for_user', count(*) from tenant_memberships where user_id='11111111-1111-1111-1111-111111111111';
