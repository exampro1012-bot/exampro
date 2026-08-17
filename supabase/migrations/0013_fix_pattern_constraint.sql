-- =============================================================================
-- ExamPro — hotfix (Migration 0012)
-- exam_patterns unique constraint was global (exam_id, version); per-tenant
-- pattern versions are the whole point of the feature, so scope it by tenant.
-- =============================================================================
alter table exam_patterns drop constraint if exists exam_patterns_exam_id_version_key;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exam_patterns_tenant_exam_version_unique'
  ) then
    alter table exam_patterns
      add constraint exam_patterns_tenant_exam_version_unique unique (tenant_id, exam_id, version);
  end if;
end $$;
