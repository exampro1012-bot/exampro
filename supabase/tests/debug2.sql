create or replace function auth.uid() returns uuid language sql stable as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
do $$
declare v_user uuid:='11111111-1111-1111-1111-111111111111';
  v_tenant uuid; v_exam uuid; v_subj uuid; v_cnt int;
begin
  -- replicate function's tenant resolution
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status='ACTIVE' order by tm.created_at limit 1;
  raise notice 'RESOLVED v_tenant = %', v_tenant;

  select id into v_exam from exams where code='jee-main';
  select id into v_subj from subjects where exam_id=v_exam and code='physics';
  raise notice 'v_exam=% v_subj=%', v_exam, v_subj;

  select count(*) into v_cnt from questions q
  where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
    and q.verification_status='VERIFIED' and q.is_deleted=false
    and (jsonb_build_object('subject_ids', jsonb_build_array(v_subj))->>'subject_ids' is null
         or q.subject_id = any (array(select (x)::uuid from jsonb_array_elements_text(jsonb_build_object('subject_ids', jsonb_build_array(v_subj))->'subject_ids') x)));
  raise notice 'REPLICA POOL COUNT = %', v_cnt;

  -- also raw count for v_tenant
  select count(*) into v_cnt from questions where tenant_id=v_tenant;
  raise notice 'raw questions for v_tenant = %', v_cnt;
  select count(*) into v_cnt from questions where tenant_id=v_tenant and verification_status='VERIFIED' and is_deleted=false;
  raise notice 'VERIFIED+notdeleted for v_tenant = %', v_cnt;
end $$;
