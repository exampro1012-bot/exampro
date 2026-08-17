-- 0028: Schema drift repair.
--
-- The live project's schema drifted from the migration history in three
-- places (columns/features the app reads but that were added to migrations
-- AFTER the live project applied them, or that exist only in app code):
--
--   1. questions.ncert       — Question Bank list/filter/CSV (src/pages.js)
--   2. batches.academic_year — Institution dashboard stats (src/pages.js)
--   3. teachers.is_deleted   — Institution dashboard stats (src/pages.js)
--   4. results.marks_obtained — Institution dashboard recent-results (src/pages.js)
--
-- All repairs are idempotent (guarded ALTERs) and safe to run repeatedly.
-- Apply with:  supabase db push        (or paste into the project SQL editor)

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'questions' and column_name = 'ncert'
  ) then
    alter table questions add column ncert boolean not null default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'batches' and column_name = 'academic_year'
  ) then
    alter table batches add column academic_year text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'is_deleted'
  ) then
    alter table teachers add column is_deleted boolean not null default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'results' and column_name = 'marks_obtained'
  ) then
    alter table results add column marks_obtained numeric(10,2);
  end if;
end $$;

comment on column questions.ncert is 'NCERT official-syllabus flag (Question Bank NCERT filter)';
comment on column batches.academic_year is 'Academic year label for the batch';
comment on column teachers.is_deleted is 'Soft-delete flag (institution dashboard counts active teachers)';
comment on column results.marks_obtained is 'Marks obtained (institution dashboard recent-results table)';