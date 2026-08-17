-- 0019: fix no-repeat default (NULL-poisoned gate made no-repeat always-on).
-- The v_no_repeat gate evaluated (NULL or not exists(...)) -> NULL when filters.exclude_used
-- was ABSENT, silently excluding every question used by earlier papers/DPPs even when
-- the caller did NOT request no-repeat. Coalesce both lookups to false.
-- Body is byte-identical to the previously applied 0015 definition except that line.

 CREATE OR REPLACE FUNCTION public.app_generate_paper(p_spec jsonb, p_seed double precision DEFAULT NULL::double precision)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
 AS $function$
 declare
   v_tenant uuid;
   v_pattern record;
   v_limit int := 5;
   v_quota_ok boolean;
   v_exam uuid := (p_spec->>'exam_id')::uuid;
   v_count int := coalesce((p_spec->>'count')::int, 30);
   v_title text := coalesce(p_spec->>'title', 'Generated Paper');
   v_code text := p_spec->>'paper_code';
   v_duration int := coalesce((p_spec->>'duration_minutes')::int, 180);
   v_marks numeric := coalesce((p_spec->>'marks')::numeric, 4);
   v_neg numeric := coalesce((p_spec->>'negative_marks')::numeric, 1);
   v_paper_id uuid;
   v_existing uuid;
   v_period text := to_char(now(),'YYYY-MM');
   v_selected jsonb := '[]'::jsonb;
   v_q record;
   v_opt jsonb;
   v_total_marks numeric := 0;
   v_used_hashes text[] := '{}'::text[];
   v_row int := 0;
   v_sections jsonb;
   v_sec jsonb;
   v_sec_count int;
   v_sec_marks numeric;
   v_sec_neg numeric;
   v_sec_subj uuid;
   v_sec_types jsonb;
   v_section_mode boolean := false;
   v_filled int := 0;
   v_missing jsonb := '[]'::jsonb;
   v_no_repeat boolean := coalesce((p_spec->'filters'->>'exclude_used'), '') = 'true' or coalesce((p_spec->>'exclude_used'), '') = 'true';
 begin
   select tm.tenant_id into v_tenant from tenant_memberships tm
     where tm.user_id = auth.uid() and tm.status = 'ACTIVE' order by tm.created_at limit 1;
   if v_tenant is null then
     return jsonb_build_object('error', 'no tenant membership');
   end if;
   if v_exam is null then
     return jsonb_build_object('error', 'exam_id required');
   end if;

   if v_code is not null then
     select id into v_existing from papers where tenant_id = v_tenant and paper_code = v_code;
     if v_existing is not null then
       return jsonb_build_object('paper_id', v_existing, 'already', true);
     end if;
   end if;

   select * into v_pattern from exam_patterns
     where exam_id = v_exam and (tenant_id is null or tenant_id = v_tenant) and is_active
     order by version desc limit 1;
   if v_pattern.id is not null then
     v_duration := coalesce(v_duration, v_pattern.duration_minutes);
     v_marks := coalesce(v_marks, v_pattern.default_marks);
     v_neg := coalesce(v_neg, v_pattern.default_negative_marks);
   end if;

   if p_seed is not null then
     perform setseed(p_seed);
   end if;

   select value->>'PAPERS_GENERATED' into v_limit from system_config where key = 'free_quota';
   v_limit := coalesce(v_limit::int, 5);
   perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':PAPERS_GENERATED:' || v_period, 0));
   select app_quota_available(v_tenant, 'PAPERS_GENERATED', v_limit, v_period) into v_quota_ok;
   if not v_quota_ok then
     return jsonb_build_object('error', 'Free paper quota reached (' || v_limit || '/month). Upgrade plan to generate more.');
   end if;

   v_sections := coalesce(v_pattern.sections, '[]'::jsonb);
   v_section_mode := jsonb_array_length(v_sections) > 0
     and (
       p_spec->'filters' is null
       or jsonb_typeof(p_spec->'filters') = 'null'
       or (jsonb_typeof(p_spec->'filters') = 'array' and jsonb_array_length(p_spec->'filters') = 0)
       or (jsonb_typeof(p_spec->'filters') = 'object'
           and (select count(*) from jsonb_object_keys(p_spec->'filters')) = 0)
     );

   if v_section_mode then
     for v_sec in select value from jsonb_array_elements(v_sections) loop
       v_sec_count := coalesce((v_sec->>'count')::int, 0);
       v_sec_marks := coalesce((v_sec->>'marks')::numeric, v_marks);
       v_sec_neg := coalesce((v_sec->>'negative_marks')::numeric, v_neg);
       select id into v_sec_subj from subjects
         where tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
           and code = v_sec->>'subject_code'
           and (exam_id is null or exam_id = v_exam)
         order by (exam_id is null), exam_id desc
         limit 1;
       select coalesce(jsonb_agg(id), '[]'::jsonb) into v_sec_types
         from question_types
         where code in (select x from jsonb_array_elements_text(coalesce(v_sec->'question_type_codes', '[]'::jsonb)) x);

       v_filled := 0;
       for v_q in
         select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
                q.difficulty, q.year, q.session, q.shift, q.question_text, q.question_hash,
                q.marks, q.negative_marks
         from questions q
         where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
           and q.verification_status = 'VERIFIED' and q.is_deleted = false
           and (q.exam_id = v_exam or q.exam_id is null)
           and (v_sec_subj is null or q.subject_id = v_sec_subj)
           and (jsonb_array_length(v_sec_types) = 0
                or q.question_type_id in (select (x)::uuid from jsonb_array_elements_text(v_sec_types) x))
           and (not v_no_repeat
                or not exists (select 1 from question_usage qu
                               where qu.question_id = q.id and qu.tenant_id = v_tenant))
           and (p_spec->'filters'->>'language' is null or upper(q.language) = upper(p_spec->'filters'->>'language'))
           and (p_spec->'filters'->'exclude_paper_ids' is null
                or not exists (select 1 from paper_questions pq
                               where pq.question_id = q.id and pq.paper_id = any (array(
                                 select (x)::uuid
                                 from jsonb_array_elements_text(p_spec->'filters'->'exclude_paper_ids') x))))
         order by random()
       loop
         if v_filled >= v_sec_count then exit; end if;
         if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
           continue;
         end if;
         v_selected := v_selected || app_question_snapshot(v_q.id, v_sec_marks, v_sec_neg);
         if v_q.question_hash is not null then
           v_used_hashes := v_used_hashes || v_q.question_hash;
         end if;
         v_filled := v_filled + 1;
       end loop;

       if v_filled < v_sec_count then
         v_missing := v_missing || jsonb_build_object(
           'section', v_sec->>'name', 'required', v_sec_count, 'available', v_filled);
       end if;
     end loop;

     if jsonb_array_length(v_missing) > 0 then
       return jsonb_build_object(
         'error', 'Insufficient eligible questions for one or more sections',
         'missing', v_missing::text);
     end if;
     v_count := jsonb_array_length(v_selected);
   else
     for v_q in
       select q.id, q.exam_id, q.subject_id, q.chapter_id, q.topic_id, q.question_type_id,
              q.difficulty, q.year, q.session, q.shift, q.question_text, q.question_hash,
              q.marks, q.negative_marks
       from questions q
       where q.tenant_id in (v_tenant, '00000000-0000-0000-0000-000000000001')
         and q.verification_status = 'VERIFIED' and q.is_deleted = false
         and (q.exam_id = v_exam or q.exam_id is null)
         and (p_spec->'filters'->>'subject_ids' is null or q.subject_id = any (array(
               select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'subject_ids') x)))
         and (p_spec->'filters'->>'chapter_ids' is null or q.chapter_id = any (array(
               select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'chapter_ids') x)))
         and (p_spec->'filters'->>'topic_ids' is null or q.topic_id = any (array(
               select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'topic_ids') x)))
         and (p_spec->'filters'->>'difficulties' is null or q.difficulty = any (array(
               select x from jsonb_array_elements_text(p_spec->'filters'->'difficulties') x)::question_difficulty[]))
         and (p_spec->'filters'->>'years' is null or q.year = any (array(
               select (x)::int from jsonb_array_elements_text(p_spec->'filters'->'years') x)))
         and (p_spec->'filters'->>'question_type_ids' is null or q.question_type_id = any (array(
               select (x)::uuid from jsonb_array_elements_text(p_spec->'filters'->'question_type_ids') x)))
         and (p_spec->'filters'->>'session' is null or q.session = p_spec->'filters'->>'session')
         and (p_spec->'filters'->>'shift' is null or q.shift = p_spec->'filters'->>'shift')
         and (p_spec->'filters'->>'language' is null or upper(q.language) = upper(p_spec->'filters'->>'language'))
         and (not v_no_repeat
              or not exists (select 1 from question_usage qu
                             where qu.question_id = q.id and qu.tenant_id = v_tenant))
         and (p_spec->'filters'->'exclude_paper_ids' is null
              or not exists (select 1 from paper_questions pq
                             where pq.question_id = q.id and pq.paper_id = any (array(
                               select (x)::uuid
                               from jsonb_array_elements_text(p_spec->'filters'->'exclude_paper_ids') x))))
       order by random()
     loop
       if jsonb_array_length(v_selected) >= v_count then exit; end if;
       if v_q.question_hash is not null and v_q.question_hash = any (v_used_hashes) then
         continue;
       end if;
       v_selected := v_selected || app_question_snapshot(v_q.id, v_marks, v_neg);
       if v_q.question_hash is not null then
         v_used_hashes := v_used_hashes || v_q.question_hash;
       end if;
     end loop;

     if jsonb_array_length(v_selected) < v_count then
       return jsonb_build_object(
         'error', 'Insufficient eligible questions',
         'required', v_count,
         'available', jsonb_array_length(v_selected),
         'missing', 'Only ' || jsonb_array_length(v_selected) || ' verified questions match the selected constraints.');
     end if;
   end if;

   if jsonb_array_length(v_selected) = 0 then
     return jsonb_build_object('error', 'No eligible questions match the selected constraints.');
   end if;

   begin
     insert into papers (tenant_id, exam_id, exam_pattern_id, title, paper_code, duration_minutes,
                         total_questions, total_marks, status, instructions, answer_key_json, created_by)
     values (v_tenant, v_exam, v_pattern.id, v_title, v_code, v_duration,
             jsonb_array_length(v_selected), 0, 'LOCKED',
             p_spec->>'instructions',
             jsonb_build_object('marks', v_marks, 'negative_marks', v_neg, 'generated_by', auth.uid()),
             auth.uid())
     returning id into v_paper_id;

     v_row := 0;
     for v_opt in select value from jsonb_array_elements(v_selected)
     loop
       v_row := v_row + 1;
       insert into paper_questions (tenant_id, paper_id, question_id, question_order,
                                    marks, negative_marks, snapshot)
       values (v_tenant, v_paper_id, (v_opt->>'question_id')::uuid, v_row::int,
               coalesce((v_opt->>'marks')::numeric, v_marks),
               coalesce((v_opt->>'negative_marks')::numeric, v_neg),
               v_opt);
       insert into question_usage (tenant_id, question_id, used_in_type, used_in_id)
       values (v_tenant, (v_opt->>'question_id')::uuid, 'PAPER', v_paper_id);
       v_total_marks := v_total_marks + coalesce((v_opt->>'marks')::numeric, v_marks);
     end loop;

     update papers set total_marks = v_total_marks where id = v_paper_id;
     perform app_increment_usage(v_tenant, 'PAPERS_GENERATED', v_period, 1);
     perform app_record_audit('paper_generated', 'papers', v_paper_id,
       jsonb_build_object('tenant_id', v_tenant, 'questions', jsonb_array_length(v_selected),
                          'no_repeat', v_no_repeat, 'seed', p_seed));
   exception when others then
     return jsonb_build_object('error', 'paper generation failed: ' || sqlerrm);
   end;

   return jsonb_build_object('paper_id', v_paper_id, 'questions', jsonb_array_length(v_selected),
     'total_marks', v_total_marks, 'already', false);
end; $function$


