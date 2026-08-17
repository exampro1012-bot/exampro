-- Probe: can a STUDENT-only user write to management tables?
-- Runs as role `authenticated` with auth.uid() = student uid.
\set ON_ERROR_STOP off
set role authenticated;
select set_config('app.test_uid', 'cccccccc-cccc-cccc-cccc-cccccccccccc', false);

-- student is member of tenant t_a (from rls_provision) — find it
do $$
declare
  t_a uuid;
  v_role text;
  ins_ok boolean := false;
  upd_ok boolean := false;
  del_ok boolean := false;
begin
  select tenant_id into t_a from tenant_memberships
    where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and status = 'ACTIVE' limit 1;

  begin
    insert into institutions (tenant_id, name, status)
    values (t_a, 'Student-Injected Institution', 'ACTIVE');
    ins_ok := true;
  exception when others then
    raise notice 'INSERT institutions: DENIED (%)', sqlerrm;
  end;
  if ins_ok then
    raise notice 'INSERT institutions: ALLOWED (student wrote institution!)';
  end if;

  begin
    insert into batches (tenant_id, name)
    values (t_a, 'Student-Injected Batch');
    upd_ok := true;
  exception when others then
    raise notice 'INSERT batches: DENIED (%)', sqlerrm;
  end;
  if upd_ok then
    raise notice 'INSERT batches: ALLOWED (student wrote batch!)';
  end if;

  begin
    insert into teachers (tenant_id, full_name, email)
    values (t_a, 'Student-Injected Teacher', 'fake@t1.edu');
    del_ok := true;
  exception when others then
    raise notice 'INSERT teachers: DENIED (%)', sqlerrm;
  end;
  if del_ok then
    raise notice 'INSERT teachers: ALLOWED (student wrote teacher!)';
  end if;
end $$;

reset role;