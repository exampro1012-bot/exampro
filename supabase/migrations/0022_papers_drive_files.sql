-- =============================================================================
-- ExamPro — Add Drive file IDs to papers and DPPs (Migration 0022)
-- =============================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='drive_file_id') then
    alter table papers add column drive_file_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='drive_answer_key_file_id') then
    alter table papers add column drive_answer_key_file_id text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='drive_solution_file_id') then
    alter table papers add column drive_solution_file_id text;
  end if;
end $$;

drop index if exists papers_drive_file_idx;
create index if not exists papers_drive_file_idx on papers (drive_file_id) where drive_file_id is not null;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='dpps' and column_name='drive_file_id') then
    alter table dpps add column drive_file_id text;
  end if;
end $$;

drop index if exists dpps_drive_file_idx;
create index if not exists dpps_drive_file_idx on dpps (drive_file_id) where drive_file_id is not null;
