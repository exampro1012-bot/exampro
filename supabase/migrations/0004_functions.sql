-- =============================================================================
-- ExamPro — Secure business functions (Migration 0003)
-- Bootstrap (auto-create tenant + membership on signup), quota gate,
-- server-side session evaluation, audit helpers. SECURITY DEFINER + safe
-- search_path so RLS policies and triggers can rely on them safely.
-- =============================================================================

-- Auto-bootstrap: every new auth user gets a personal tenant, a SUPER_ADMIN
-- membership, a profile, and a trial subscription. This makes the app usable
-- immediately after signup without a separate provisioning step.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_role uuid; v_name text; v_slug text;
begin
  insert into profiles (auth_user_id, full_name, email)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email)
    on conflict (auth_user_id) do nothing;

  v_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  v_slug := substring(regexp_replace(lower(coalesce(new.email, new.id::text)), '[^a-z0-9]+', '-', 'g'), 1, 20)
            || '-' || substring(new.id::text, 1, 6);
  insert into tenants (name, slug, email) values (v_name || ' Workspace', v_slug, new.email) returning id into v_tenant;
  select id into v_role from roles where code = 'SUPER_ADMIN';
  insert into tenant_memberships (tenant_id, user_id, role_id, status, joined_at)
    values (v_tenant, new.id, v_role, 'ACTIVE', now());
  insert into subscriptions (tenant_id, status, current_period_start, current_period_end)
    values (v_tenant, 'TRIAL', now(), now() + interval '14 days');
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Generic updated_at maintenance.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

do $$
declare
  t text;
  cols text[];
  has boolean;
begin
  cols := array[
    'tenants','profiles','subscriptions','exams','subjects','chapters','topics','subtopics',
    'questions','solutions','papers','exam_sessions','students','student_groups','dpps',
    'blueprint_rules','import_jobs','system_config'
  ];
  foreach t in array cols loop
    select exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=t and c.column_name='updated_at'
    ) into has;
    if has then
      execute format('drop trigger if exists %I_updated on %I;', t, t);
      execute format('create trigger %I_updated before update on %I
        for each row execute function set_updated_at();', t, t);
    end if;
  end loop;
end $$;

-- Atomic usage increment (avoids race conditions on the free quota).
create or replace function app_increment_usage(
  p_tenant_id uuid, p_metric text, p_period text, p_n int default 1
) returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into usage (tenant_id, metric, period, count)
  values (p_tenant_id, p_metric, p_period, p_n)
  on conflict (tenant_id, metric, period)
  do update set count = usage.count + p_n, updated_at = now()
  returning count into v_count;
  return v_count;
end; $$;

-- Free-quota gate. Returns true if usage is still under the limit.
create or replace function app_quota_ok(
  p_tenant_id uuid, p_metric text, p_limit int, p_period text default to_char(now(),'YYYY-MM')
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  select count into v_count from usage where tenant_id = p_tenant_id and metric = p_metric and period = p_period;
  return coalesce(v_count, 0) < p_limit;
end; $$;

-- Stable question fingerprint (duplicate detection).
create or replace function app_question_hash(p_text text) returns text
language sql immutable as $$
  select md5(lower(regexp_replace(coalesce(p_text,''), '\s+', ' ', 'g')));
$$;

-- Personalized weak-topic detection (no AI required).
create or replace function app_weak_topics(p_user_id uuid, p_limit int default 10)
returns table (topic_id uuid, topic_name text, accuracy numeric, attempts int) language sql
security definer set search_path = public as $$
  select t.id, t.name,
    round(coalesce(sum(case when pl.correct then 1 else 0 end)::numeric / nullif(count(*),0),0) * 100, 2) as accuracy,
    count(*)::int as attempts
  from practice_logs pl
  join questions q on q.id = pl.question_id
  join topics t on t.id = q.topic_id
  where pl.user_id = p_user_id
  group by t.id, t.name
  order by accuracy asc
  limit p_limit;
$$;

-- Server-side session evaluation (privileged; invoked by service role only).
-- Scores a session from responses + question_answers + paper_questions and
-- writes a results row. Keeps grading logic server-side (never trust the client).
create or replace function app_evaluate_session(p_session_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; v_paper uuid; v_student uuid;
  v_total numeric := 0; v_marks numeric := 0; v_correct int := 0; v_attempted int := 0;
  v_acc numeric; v_pct numeric; v_res uuid;
  r record;
begin
  select tenant_id, paper_id, student_id into v_tenant, v_paper, v_student
    from exam_sessions where id = p_session_id;
  if v_tenant is null then return null; end if;

  for r in
    select resp.selected_options, qa.correct_option_keys, pq.marks, pq.negative_marks
    from responses resp
    join question_answers qa on qa.question_id = resp.question_id
    join paper_questions pq on pq.question_id = resp.question_id and pq.paper_id = v_paper
    where resp.exam_session_id = p_session_id
  loop
    v_total := v_total + coalesce(r.marks, 0);
    v_attempted := v_attempted + 1;
    if r.selected_options is not null and r.selected_options::text = r.correct_option_keys::text then
      v_marks := v_marks + coalesce(r.marks, 0);
      v_correct := v_correct + 1;
    else
      v_marks := v_marks - coalesce(r.negative_marks, 0);
    end if;
  end loop;

  v_acc := case when v_attempted > 0 then round(v_correct::numeric / v_attempted * 100, 2) else 0 end;
  v_pct := case when v_total > 0 then round(v_marks / v_total * 100, 2) else 0 end;

  insert into results (tenant_id, exam_session_id, student_id, paper_id, total_marks, marks, accuracy, percentage)
  values (v_tenant, p_session_id, v_student, v_paper, v_total, v_marks, v_acc, v_pct)
  on conflict (id) do nothing
  returning id into v_res;

  update exam_sessions set status = 'SUBMITTED', submitted_at = now() where id = p_session_id;
  return v_res;
end; $$;

-- -----------------------------------------------------------------------------
-- Tenant denormalization triggers: copy tenant_id from the parent row on INSERT
-- so child tables satisfy uniform RLS even though the client does not send
-- tenant_id for them. SECURITY DEFINER (safe search_path) so the parent lookup
-- inside the trigger is not blocked by RLS on the parent table.
-- -----------------------------------------------------------------------------
create or replace function trg_tenant_from_question() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from questions where id = NEW.question_id; return NEW; end; $$;
create or replace function trg_tenant_from_paper() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from papers where id = NEW.paper_id; return NEW; end; $$;
create or replace function trg_tenant_from_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from exam_sessions where id = NEW.exam_session_id; return NEW; end; $$;
create or replace function trg_tenant_from_dpp() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from dpps where id = NEW.dpp_id; return NEW; end; $$;
create or replace function trg_tenant_from_group() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from student_groups where id = NEW.student_group_id; return NEW; end; $$;
create or replace function trg_tenant_from_importjob() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from import_jobs where id = NEW.import_job_id; return NEW; end; $$;

drop trigger if exists question_options_tenant on question_options;
create trigger question_options_tenant before insert on question_options for each row execute function trg_tenant_from_question();
drop trigger if exists question_answers_tenant on question_answers;
create trigger question_answers_tenant before insert on question_answers for each row execute function trg_tenant_from_question();
drop trigger if exists solutions_tenant on solutions;
create trigger solutions_tenant before insert on solutions for each row execute function trg_tenant_from_question();
drop trigger if exists question_images_tenant on question_images;
create trigger question_images_tenant before insert on question_images for each row execute function trg_tenant_from_question();
drop trigger if exists question_tags_tenant on question_tags;
create trigger question_tags_tenant before insert on question_tags for each row execute function trg_tenant_from_question();
drop trigger if exists paper_questions_tenant on paper_questions;
create trigger paper_questions_tenant before insert on paper_questions for each row execute function trg_tenant_from_paper();
drop trigger if exists responses_tenant on responses;
create trigger responses_tenant before insert on responses for each row execute function trg_tenant_from_session();
drop trigger if exists results_tenant on results;
create trigger results_tenant before insert on results for each row execute function trg_tenant_from_session();
drop trigger if exists dpp_questions_tenant on dpp_questions;
create trigger dpp_questions_tenant before insert on dpp_questions for each row execute function trg_tenant_from_dpp();
drop trigger if exists dpp_assignments_tenant on dpp_assignments;
create trigger dpp_assignments_tenant before insert on dpp_assignments for each row execute function trg_tenant_from_dpp();
drop trigger if exists student_group_members_tenant on student_group_members;
create trigger student_group_members_tenant before insert on student_group_members for each row execute function trg_tenant_from_group();
drop trigger if exists import_job_items_tenant on import_job_items;
create trigger import_job_items_tenant before insert on import_job_items for each row execute function trg_tenant_from_importjob();

-- Restrict privileged mutating functions so they can only be invoked by the
-- service role (Edge Functions). RLS helper functions must remain executable by
-- `authenticated` (they are used inside policies) — do NOT revoke those.
revoke execute on function app_evaluate_session(uuid) from anon, authenticated;
revoke execute on function app_increment_usage(uuid, text, text, int) from anon, authenticated;
revoke execute on function app_quota_ok(uuid, text, int, text) from anon, authenticated;
