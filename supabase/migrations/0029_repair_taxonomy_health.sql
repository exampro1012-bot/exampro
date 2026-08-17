-- 0029: production repair — subject integrity, import ncert support, question-bank health.
--
--  1) Subjects: the taxonomy is exam-scoped by design (each exam owns its subject
--     tree). Seed drift created duplicate subject rows *within* an exam. Dedupe
--     (keep earliest id, re-point chapters/questions) and lock integrity with a
--     UNIQUE (tenant_id, exam_id, name) constraint. Dropdowns that list subjects
--     without exam scoping (Question Bank, DPP, question form) are fixed in the UI.
--  2) app_import_questions_batch: persist the `ncert` boolean column from
--     imported rows (CSV/JSON) instead of silently defaulting to false.
--  3) app_question_bank_health: tenant-scoped per-exam eligibility diagnostics
--     for the Question Bank Health panel.

-- ---------------------------------------------------------------------------
-- 1. Subject integrity
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_keep uuid;
begin
  for r in
    select tenant_id, exam_id, name,
           array_agg(id order by created_at, id) as ids
    from subjects
    group by tenant_id, exam_id, name
    having count(*) > 1
  loop
    v_keep := r.ids[1];
    update chapters set subject_id = v_keep where subject_id = any(r.ids[2:]);
    update questions set subject_id = v_keep where subject_id = any(r.ids[2:]);
    delete from subjects where id = any(r.ids[2:]);
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subjects_tenant_exam_name_key'
  ) then
    alter table subjects add constraint subjects_tenant_exam_name_key
      unique (tenant_id, exam_id, name);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Import: persist ncert boolean
-- ---------------------------------------------------------------------------
create or replace function app_import_questions_batch(
  p_items jsonb,
  p_create_taxonomy boolean default true,
  p_verification verification_status default 'PENDING_REVIEW'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_item jsonb;
  v_imported int := 0;
  v_duplicates int := 0;
  v_failed int := 0;
  v_total int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_exam_id uuid;
  v_subject_id uuid;
  v_chapter_id uuid;
  v_topic_id uuid;
  v_type_id uuid;
  v_qid uuid;
  v_hash text;
  v_text text;
  v_ncert boolean;
  v_seen_hashes text[] := '{}'::text[];
  v_opt jsonb;
  v_opt_i int := 0;
  v_perm_ok boolean;
  v_clean bool;
  v_mark numeric;
  v_neg numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('error', 'p_items must be a non-empty jsonb array');
  end if;

  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;

  -- students must never mutate the question bank
  select not app_user_has_student_only_role(v_tenant) into v_perm_ok;
  if not v_perm_ok then
    return jsonb_build_object('error', 'forbidden: question import requires a non-student role');
  end if;

  v_total := jsonb_array_length(p_items);

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_clean := true;
    begin
      v_text := v_item->>'question_text';
      if v_text is null or length(btrim(v_text)) = 0 then
        v_errors := v_errors || jsonb_build_object('index', v_imported + v_duplicates + v_failed, 'error', 'missing question_text');
        v_failed := v_failed + 1;
        v_clean := false;
        continue;
      end if;

      v_hash := app_question_hash(v_text);
      if v_hash = any (v_seen_hashes) then
        v_duplicates := v_duplicates + 1;
        v_clean := false;
        continue;
      end if;
      if exists (select 1 from questions q
                 where q.tenant_id = v_tenant and q.question_hash = v_hash and q.is_deleted = false) then
        v_duplicates := v_duplicates + 1;
        v_clean := false;
        continue;
      end if;

      -- resolve / create taxonomy
      v_exam_id := null;
      if v_item->>'exam_code' is not null then
        select id into v_exam_id from exams
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'exam_code' order by (tenant_id = v_tenant) desc limit 1;
        if v_exam_id is null and p_create_taxonomy then
          insert into exams (tenant_id, name, code, exam_type, created_by)
          values (v_tenant, v_item->>'exam_code', v_item->>'exam_code', 'GENERIC', auth.uid())
          returning id into v_exam_id;
        end if;
      end if;

      v_subject_id := null;
      if v_item->>'subject_code' is not null then
        select id into v_subject_id from subjects
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'subject_code'
            and (v_exam_id is null or exam_id = v_exam_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_subject_id is null and p_create_taxonomy then
          insert into subjects (tenant_id, exam_id, name, code, created_by)
          values (v_tenant, v_exam_id, v_item->>'subject_code', v_item->>'subject_code', auth.uid())
          returning id into v_subject_id;
        end if;
      end if;

      v_chapter_id := null;
      if v_item->>'chapter_code' is not null then
        select id into v_chapter_id from chapters
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'chapter_code'
            and (v_subject_id is null or subject_id = v_subject_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_chapter_id is null and p_create_taxonomy then
          insert into chapters (tenant_id, subject_id, name, code, created_by)
          values (v_tenant, v_subject_id, v_item->>'chapter_code', v_item->>'chapter_code', auth.uid())
          returning id into v_chapter_id;
        end if;
      end if;

      v_topic_id := null;
      if v_item->>'topic_code' is not null then
        select id into v_topic_id from topics
          where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
            and code = v_item->>'topic_code'
            and (v_chapter_id is null or chapter_id = v_chapter_id)
          order by (tenant_id = v_tenant) desc limit 1;
        if v_topic_id is null and p_create_taxonomy then
          insert into topics (tenant_id, chapter_id, name, code, created_by)
          values (v_tenant, v_chapter_id, v_item->>'topic_code', v_item->>'topic_code', auth.uid())
          returning id into v_topic_id;
        end if;
      end if;

      v_type_id := null;
      if v_item->>'question_type_code' is not null then
        select id into v_type_id from question_types
          where code = v_item->>'question_type_code' and is_active limit 1;
      end if;

      v_mark := coalesce((v_item->>'marks')::numeric, 4);
      v_neg := coalesce((v_item->>'negative_marks')::numeric, 1);
      v_ncert := coalesce((v_item->>'ncert')::boolean, false);

      insert into questions (tenant_id, exam_id, subject_id, chapter_id, topic_id,
                             question_type_id, question_text, year, difficulty,
                             source, verification_status, question_hash, ncert, created_by)
      values (v_tenant, v_exam_id, v_subject_id, v_chapter_id, v_topic_id, v_type_id,
              v_text, (v_item->>'year')::int,
              coalesce((v_item->>'difficulty')::question_difficulty, 'MEDIUM'),
              coalesce(v_item->>'source', 'IMPORT'),
              p_verification, v_hash, v_ncert, auth.uid())
      returning id into v_qid;

      if v_item->'options' is not null and jsonb_typeof(v_item->'options') = 'array' then
        v_opt_i := 0;
        for v_opt in select value from jsonb_array_elements(v_item->'options') loop
          v_opt_i := v_opt_i + 1;
          insert into question_options (tenant_id, question_id, option_key, option_text,
                                        is_correct, display_order)
          values (v_tenant, v_qid,
                  coalesce(v_opt->>'option_key', 'OPT' || v_opt_i),
                  v_opt->>'option_text',
                  coalesce((v_opt->>'is_correct')::boolean, false),
                  coalesce((v_opt->>'display_order')::int, v_opt_i));
        end loop;
      end if;

      insert into question_answers (tenant_id, question_id, correct_option_keys, explanation, created_by)
      values (v_tenant, v_qid,
              coalesce((select array(select x from jsonb_array_elements_text(
                          coalesce(v_item->'answer'->'correct_option_keys', '[]'::jsonb)) x)),
                       '{}'::text[]),
              v_item->'answer'->>'explanation', auth.uid());

      if v_item->>'solution_text' is not null or v_item->'solution' is not null then
        insert into solutions (tenant_id, question_id, solution_text, concept, created_by)
        values (v_tenant, v_qid,
                coalesce(v_item->>'solution_text', v_item->'solution'->>'solution_text'),
                v_item->'solution'->>'concept', auth.uid());
      end if;

      v_seen_hashes := v_seen_hashes || v_hash;
      v_imported := v_imported + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('index', v_imported + v_duplicates + v_failed - 1,
                                                 'error', sqlerrm);
    end;
  end loop;

  if v_imported > 0 then
    perform app_record_audit('questions_imported', 'questions', null,
      jsonb_build_object('tenant_id', v_tenant, 'imported', v_imported,
                         'duplicates', v_duplicates, 'failed', v_failed));
  end if;

  return jsonb_build_object('imported', v_imported, 'duplicates', v_duplicates,
                            'failed', v_failed, 'total', v_total,
                            'errors', coalesce(v_errors, '[]'::jsonb));
end; $$;

grant execute on function app_import_questions_batch(jsonb, boolean, verification_status) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Question Bank Health (tenant-scoped eligibility diagnostics)
-- ---------------------------------------------------------------------------
create or replace function app_question_bank_health()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_out jsonb := '[]'::jsonb;
begin
  select tm.tenant_id into v_tenant from tenant_memberships tm
    where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
  if v_tenant is null then
    return jsonb_build_object('error', 'no tenant membership');
  end if;

  select coalesce(jsonb_agg(row_json order by e_name), '[]'::jsonb) into v_out
  from (
    select e.name as e_name,
      jsonb_build_object(
        'exam_id', e.id,
        'exam_name', e.name,
        'total', q.total,
        'verified', q.verified,
        'eligible', q.eligible,
        'pending_review', q.pending,
        'rejected', q.rejected,
        'needs_edit', q.needs_edit,
        'deleted', q.deleted,
        'ncert', q.ncert,
        'subjects', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'subject_id', s.id,
                   'name', s.name,
                   'verified', ssv.verified,
                   'total', ssv.total)
                 order by s.name)
          from subjects s
          left join lateral (
            select count(*) filter (where qs.verification_status = 'VERIFIED')::int as verified,
                   count(*) filter (where qs.is_deleted = false)::int as total
            from questions qs
            where qs.subject_id = s.id
          ) ssv on true
          where s.exam_id = e.id
            and s.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
        ), '[]'::jsonb)
      ) as row_json
    from exams e
    left join lateral (
      select
        count(*) filter (where q.is_deleted = false)::int as total,
        count(*) filter (where q.verification_status = 'VERIFIED' and q.is_deleted = false)::int as verified,
        count(*) filter (where q.verification_status = 'VERIFIED' and q.is_deleted = false
                          and not exists (
                            select 1 from question_usage u
                            where u.tenant_id = v_tenant and u.question_id = q.id))::int as eligible,
        count(*) filter (where q.verification_status = 'PENDING_REVIEW')::int as pending,
        count(*) filter (where q.verification_status = 'REJECTED')::int as rejected,
        count(*) filter (where q.verification_status = 'NEEDS_EDIT')::int as needs_edit,
        count(*) filter (where q.is_deleted)::int as deleted,
        count(*) filter (where q.ncert and q.is_deleted = false)::int as ncert
      from questions q
      where q.exam_id = e.id
        and q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
    ) q on true
    where e.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
      and e.is_active
  ) t;

  return jsonb_build_object('tenant_id', v_tenant, 'exams', v_out);
end; $$;

grant execute on function app_question_bank_health() to authenticated;