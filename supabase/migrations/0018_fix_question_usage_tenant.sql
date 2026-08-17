-- =============================================================================
-- ExamPro — Fix question_usage tenant semantics (Migration 0018)
--
-- The 0007 trigger trg_tenant_from_question_usage unconditionally overwrote
-- question_usage.tenant_id with the QUESTION's owning tenant. For questions in
-- the shared platform bank (tenant 00000000-...-0001) that meant every usage
-- row was recorded under the platform tenant, so the no-repeat engine's
-- exclusion (question_usage WHERE tenant_id = <generating tenant>) could
-- never see platform-bank usage and re-used questions across papers.
--
-- Fix: the trigger now only supplies tenant_id as a defensive default when the
-- insert does not provide one. Generators keep recording the USING tenant,
-- which restores per-tenant no-repeat for the shared bank while still
-- preventing null/cross-tenant writes.
-- =============================================================================

create or replace function trg_tenant_from_question_usage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.tenant_id is null then
    select tenant_id into NEW.tenant_id from questions where id = NEW.question_id;
  end if;
  return NEW;
end; $$;