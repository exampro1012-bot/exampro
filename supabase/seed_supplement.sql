-- =============================================================================
-- ExamPro supplemental seed: academic cascade completeness + section-wise patterns
-- Idempotent: skips if already present.
-- =============================================================================

-- 1) Subtopics: 2 structural nodes per topic (Concepts / Applications)
--    Enables the exam -> subject -> chapter -> topic -> subtopic cascade filter.
insert into subtopics (id, tenant_id, topic_id, name, code, display_order, created_at, updated_at)
select gen_random_uuid(),
       '00000000-0000-0000-0000-000000000001',
       t.id,
       t.name || ' — Concepts',
       'concepts',
       1,
       now(),
       now()
from topics t
where not exists (
  select 1 from subtopics s where s.topic_id = t.id and s.code = 'concepts'
);

insert into subtopics (id, tenant_id, topic_id, name, code, display_order, created_at, updated_at)
select gen_random_uuid(),
       '00000000-0000-0000-0000-000000000001',
       t.id,
       t.name || ' — Applications',
       'applications',
       2,
       now(),
       now()
from topics t
where not exists (
  select 1 from subtopics s where s.topic_id = t.id and s.code = 'applications'
);

-- 2) exam_pattern_sections: section-wise blueprints for the 3 default patterns.
--    JEE Main / JEE Advanced: Physics, Chemistry, Mathematics.
--    NEET: Botany, Zoology, Physics, Chemistry.
create temporary table _pat (pid uuid, exam_id uuid, total int, marks numeric, neg numeric);
insert into _pat values
  ('3bd79620-df5b-4d8e-8d08-ab812aee8ca0', '147ccb51-ec96-4cca-9a6e-c70221dec656', 90, 4, 1),   -- JEE Main
  ('954c040c-70ed-46e0-8e03-c99188cfc7cc', 'a4d6b045-9189-4330-9817-a26d7dcef81b', 66, 3, 1),   -- JEE Advanced
  ('597d2af7-1709-4d4d-bc1a-dbe05d8ed3c6', '48ecb056-f537-4d60-93fc-4bd11668a637', 180, 4, 1);   -- NEET

do $$
declare r record; s record; subs text[]; cnt int; per int; i int;
begin
  for r in select * from _pat loop
    -- subject names per exam
    if r.exam_id = '48ecb056-f537-4d60-93fc-4bd11668a637' then
      subs := array['Botany','Zoology','Physics','Chemistry'];
    else
      subs := array['Physics','Chemistry','Mathematics'];
    end if;
    cnt := array_length(subs, 1);
    per := r.total / cnt;
    i := 1;
    foreach s.name in array subs loop
      insert into exam_pattern_sections
        (id, exam_pattern_id, name, subject_id, question_count, marks_per_question, negative_marks_per_question, display_order, tenant_id, created_at)
      select gen_random_uuid(), r.pid, s.name, sub.id, per, r.marks, r.neg, i,
             '00000000-0000-0000-0000-000000000001', now()
      from subjects sub
      where sub.exam_id = r.exam_id and sub.name = s.name
        and not exists (
          select 1 from exam_pattern_sections eps
          where eps.exam_pattern_id = r.pid and eps.subject_id = sub.id
        );
      i := i + 1;
    end loop;
  end loop;
end $$;

drop table if exists _pat;

select 'subtopics=' || count(*) from subtopics;
select 'exam_pattern_sections=' || count(*) from exam_pattern_sections;
