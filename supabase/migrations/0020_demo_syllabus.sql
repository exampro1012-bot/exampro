-- =============================================================================
-- ExamPro — Demo syllabus for the JEE Main demo exam (Migration 0020)
--
-- Completes the 0017 demo seed: the demo questions reference chapter codes
-- (kinematics, units-dimensions, ...) that were intentionally never bulk-seeded
-- (0010). This migration creates that small demo taxonomy for the JEE Main demo
-- exam only, links the 8 demo questions to their chapters/topics, and makes the
-- chapter/topic drill, weak-topics, and revision workflows usable out of the
-- box on a fresh project. Clearly labeled demo scaffolding — production
-- syllabus data comes through the syllabus manager / import pipeline.
-- Idempotent: looks up by code before inserting; skips silently if the demo
-- exam is absent.
-- =============================================================================

do $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_exam uuid; v_subj uuid; v_chap uuid; v_topic uuid;
  rec record;
  q_rec record;
begin
  select id into v_exam from exams where code = 'jee-main' limit 1;
  if v_exam is null then
    raise notice 'Demo exam (jee-main) not found; skipping demo syllabus seed.';
  else

  for rec in select * from (values
    ('physics',    'kinematics',         'Kinematics',         'motion-1d',     'Motion in 1D'),
    ('physics',    'units-dimensions',   'Units & Dimensions', 'dimensional',   'Dimensional Analysis'),
    ('physics',    'work-energy-power',  'Work, Energy, Power','work-energy',   'Work-Energy Theorem'),
    ('physics',    'current-electricity','Current Electricity','ohm-resistance','Ohm Law & Resistance'),
    ('chemistry',  'basic-concepts',     'Some Basic Concepts','mole-concept',  'Mole Concept'),
    ('chemistry',  'chemical-bonding',   'Chemical Bonding',   'vsepr',         'VSEPR Theory'),
    ('mathematics','quadratic-equations','Quadratic Equations','nature-of-roots','Nature of Roots'),
    ('mathematics','trigonometry',       'Trigonometry',       'identities',    'Trigonometric Identities')
  ) as t(subj_code, chap_code, chap_name, topic_code, topic_name) loop

    select id into v_subj from subjects where exam_id = v_exam and code = rec.subj_code limit 1;
    continue when v_subj is null;

    select id into v_chap from chapters where subject_id = v_subj and code = rec.chap_code limit 1;
    if v_chap is null then
      insert into chapters (tenant_id, subject_id, name, code, display_order)
      values (v_tenant, v_subj, rec.chap_name, rec.chap_code, 0)
      returning id into v_chap;
    end if;

    select id into v_topic from topics where chapter_id = v_chap and code = rec.topic_code limit 1;
    if v_topic is null then
      insert into topics (tenant_id, chapter_id, name, code, display_order)
      values (v_tenant, v_chap, rec.topic_name, rec.topic_code, 0)
      returning id into v_topic;
    end if;
  end loop;

  -- Link the 8 demo questions to their chapter/topic (they were seeded with
  -- NULL chapter_id because the chapters did not exist yet).
  for q_rec in select * from (values
    ('a1000000-0000-0000-0000-000000000001'::uuid, 'kinematics',          'motion-1d'),
    ('a1000000-0000-0000-0000-000000000002'::uuid, 'units-dimensions',    'dimensional'),
    ('a1000000-0000-0000-0000-000000000003'::uuid, 'work-energy-power',   'work-energy'),
    ('a1000000-0000-0000-0000-000000000004'::uuid, 'current-electricity', 'ohm-resistance'),
    ('a1000000-0000-0000-0000-000000000005'::uuid, 'basic-concepts',      'mole-concept'),
    ('a1000000-0000-0000-0000-000000000006'::uuid, 'chemical-bonding',    'vsepr'),
    ('a1000000-0000-0000-0000-000000000007'::uuid, 'quadratic-equations', 'nature-of-roots'),
    ('a1000000-0000-0000-0000-000000000008'::uuid, 'trigonometry',        'identities')
  ) as t(qid, chap_code, topic_code) loop
    select c.id, tp.id into v_chap, v_topic
    from questions q
    join chapters c on c.subject_id = q.subject_id and c.code = q_rec.chap_code
    left join topics tp on tp.chapter_id = c.id and tp.code = q_rec.topic_code
    where q.id = q_rec.qid
    limit 1;
    continue when v_chap is null;
    update questions
    set chapter_id = v_chap, topic_id = v_topic, updated_at = now()
    where id = q_rec.qid;
  end loop;
  end if;
end $$;