-- =============================================================================
-- ExamPro — Management-table write hardening (Migration 0026_student_write)
-- A user whose ONLY role in a tenant is STUDENT/PARENT must not be able to
-- write (insert/update/delete) management or content tables:
--   institutions, branches, batches, students, teachers, exam_patterns,
--   questions (+options/answers/solutions/reviews/duplicates),
--   papers, paper_questions, dpps, dpp_questions, omr_templates, omr_sheets,
--   import_jobs, source_documents, storage_objects, subscriptions, invoices.
-- Reads stay open via app_can_read_content / app_can_access_tenant.
-- Student-owned tables (bookmarks, practice_logs, notifications,
-- exam_sessions/responses/results with owner rules) are untouched.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. helper: is the current user student-only IN the target tenant?
--    (exists 0011; referenced here for readability)
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 2. admin/organization tables
-- ----------------------------------------------------------------------------
drop policy if exists institutions_all on institutions;
create policy institutions_select on institutions for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy institutions_write on institutions for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists branches_all on branches;
create policy branches_select on branches for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy branches_write on branches for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists batches_all on batches;
create policy batches_select on batches for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy batches_write on batches for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists students_all on students;
create policy students_select on students for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy students_write on students for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists teachers_all on teachers;
create policy teachers_select on teachers for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy teachers_write on teachers for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists exam_patterns_all on exam_patterns;
create policy exam_patterns_select on exam_patterns for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy exam_patterns_write on exam_patterns for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

-- ----------------------------------------------------------------------------
-- 3. question content (writes are staff-only; reads via app_can_read_content)
-- ----------------------------------------------------------------------------
drop policy if exists questions_write on questions;
drop policy if exists questions_update on questions;
drop policy if exists questions_delete on questions;
create policy questions_write on questions for insert to authenticated
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));
create policy questions_update on questions for update to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));
create policy questions_delete on questions for delete to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists question_options_write on question_options;
drop policy if exists question_options_update on question_options;
drop policy if exists question_options_delete on question_options;
create policy question_options_write on question_options for insert to authenticated
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));
create policy question_options_update on question_options for update to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));
create policy question_options_delete on question_options for delete to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists question_answers_write on question_answers;
drop policy if exists question_answers_update on question_answers;
drop policy if exists question_answers_delete on question_answers;
create policy question_answers_write on question_answers for insert to authenticated
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));
create policy question_answers_update on question_answers for update to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));
create policy question_answers_delete on question_answers for delete to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists solutions_write on solutions;
drop policy if exists solutions_update on solutions;
drop policy if exists solutions_delete on solutions;
create policy solutions_write on solutions for insert to authenticated
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));
create policy solutions_update on solutions for update to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));
create policy solutions_delete on solutions for delete to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists question_reviews_all on question_reviews;
create policy question_reviews_select on question_reviews for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy question_reviews_write on question_reviews for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists question_duplicates_all on question_duplicates;
create policy question_duplicates_select on question_duplicates for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy question_duplicates_write on question_duplicates for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

-- ----------------------------------------------------------------------------
-- 4. papers / dpps / omr (students consume via RPCs, never write rows directly)
-- ----------------------------------------------------------------------------
drop policy if exists papers_all on papers;
create policy papers_select on papers for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy papers_write on papers for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists paper_questions_all on paper_questions;
create policy paper_questions_select on paper_questions for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy paper_questions_write on paper_questions for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists dpps_all on dpps;
create policy dpps_select on dpps for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy dpps_write on dpps for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists dpp_questions_all on dpp_questions;
create policy dpp_questions_select on dpp_questions for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy dpp_questions_write on dpp_questions for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists omr_templates_all on omr_templates;
create policy omr_templates_select on omr_templates for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy omr_templates_write on omr_templates for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists omr_sheets_all on omr_sheets;
create policy omr_sheets_select on omr_sheets for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy omr_sheets_write on omr_sheets for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

-- ----------------------------------------------------------------------------
-- 5. imports / source documents / storage / billing
-- ----------------------------------------------------------------------------
drop policy if exists import_jobs_all on import_jobs;
create policy import_jobs_select on import_jobs for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy import_jobs_write on import_jobs for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists source_documents_admin on source_documents;
create policy source_documents_admin on source_documents for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or (tenant_id = app_current_tenant_id() and not app_user_has_student_only_role(tenant_id)));

drop policy if exists storage_objects_admin on storage_objects;
drop policy if exists storage_objects_all on storage_objects;
create policy storage_objects_admin on storage_objects for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or (tenant_id = app_current_tenant_id() and not app_user_has_student_only_role(tenant_id)));
create policy storage_objects_all on storage_objects for all to authenticated
  using (app_can_access_tenant(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists subscriptions_all on subscriptions;
create policy subscriptions_select on subscriptions for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy subscriptions_write on subscriptions for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));

drop policy if exists invoices_all on invoices;
create policy invoices_select on invoices for select to authenticated
  using (app_can_access_tenant(tenant_id));
create policy invoices_write on invoices for all to authenticated
  using (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id))
  with check (app_can_access_tenant(tenant_id) and not app_user_has_student_only_role(tenant_id));