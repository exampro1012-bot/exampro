create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;

do $$
declare v_user uuid:='11111111-1111-1111-1111-111111111111';
  v_tenant uuid:='22222222-2222-2222-2222-222222222222';
  v_exam uuid; v_subj uuid; v_cnt int;
begin
  select id into v_exam from exams where code='jee-main';
  select id into v_subj from subjects where exam_id=v_exam and code='physics';

  -- exact replica of app_generate_paper pool WHERE (subject filter)
  select count(*) into v_cnt from questions q
  where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
    and q.verification_status='VERIFIED' and q.is_deleted=false
    and (jsonb_build_object('subject_ids', jsonb_build_array(v_subj))->>'subject_ids' is null
         or q.subject_id = any (array(select (x)::uuid from jsonb_array_elements_text(jsonb_build_object('subject_ids', jsonb_build_array(v_subj))->'subject_ids') x)));
  raise notice 'POOL COUNT (subject filter) = %', v_cnt;

  -- without filter
  select count(*) into v_cnt from questions q
  where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
    and q.verification_status='VERIFIED' and q.is_deleted=false;
  raise notice 'POOL COUNT (no filter) = %', v_cnt;
end $$;
