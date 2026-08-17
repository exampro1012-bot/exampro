-- =============================================================================
-- ExamPro — Seed (Migration 0008)
-- Platform tenant, exams, exam patterns, question sources, and the standard
-- JEE Main / JEE Advanced / NEET syllabus structure (verified public syllabus).
-- Idempotent. No fabricated PYQs — the question bank itself is imported via the
-- import pipeline (see supabase/import-dataset.mjs).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Platform tenant (shared verified question bank)
-- ----------------------------------------------------------------------------
insert into tenants (id, name, slug, status)
values ('00000000-0000-0000-0000-000000000001', 'ExamPro Platform', 'exampro-platform', 'ACTIVE')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Exams (codes match the dataset shards)
-- ----------------------------------------------------------------------------
insert into exams (tenant_id, code, name, exam_type, display_order, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'jee-main',     'JEE Main',     'ENGINEERING', 1, true),
  ('00000000-0000-0000-0000-000000000001', 'jeeadvanced',  'JEE Advanced', 'ENGINEERING', 2, true),
  ('00000000-0000-0000-0000-000000000001', 'neet',         'NEET',         'MEDICAL',     3, true),
  ('00000000-0000-0000-0000-000000000001', 'cuet',         'CUET',         'UNDERGRAD',   4, true),
  ('00000000-0000-0000-0000-000000000001', 'mhtcet',       'MHT CET',      'ENGINEERING', 5, true),
  ('00000000-0000-0000-0000-000000000001', 'wbjee',        'WBJEE',        'ENGINEERING', 6, true),
  ('00000000-0000-0000-0000-000000000001', 'ts-eamcet',    'TS EAMCET',    'ENGINEERING', 7, true),
  ('00000000-0000-0000-0000-000000000001', 'gujcet',       'GUJCET',       'ENGINEERING', 8, true),
  ('00000000-0000-0000-0000-000000000001', 'kcet',         'KCET',         'ENGINEERING', 9, true),
  ('00000000-0000-0000-0000-000000000001', 'apeamcet',     'AP EAMCET',    'ENGINEERING', 10, true),
  ('00000000-0000-0000-0000-000000000001', 'comedk',       'COMEDK',       'ENGINEERING', 11, true)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Question sources (provenance; the imported set is a labeled SAMPLE set)
-- ----------------------------------------------------------------------------
insert into question_sources (code, name, source_type, license_status, source_url) values
  ('sample-qa', 'ExamPro Synthetic QA Set', 'SAMPLE', 'PERMITTED', ''),
  ('institution', 'Institution Upload', 'INSTITUTION', 'PERMITTED', ''),
  ('teacher', 'Teacher Upload', 'TEACHER', 'PERMITTED', ''),
  ('ncert', 'NCERT', 'OFFICIAL', 'PERMITTED', 'https://ncert.nic.in')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 4. Subjects + standard syllabus chapters/topics (verified public syllabus)
-- ----------------------------------------------------------------------------
do $$
declare
  rec record;
  ch record;
  v_exam uuid; v_subj uuid; v_chap uuid; v_subj_code text;
  v_platenant uuid := '00000000-0000-0000-0000-000000000001';
begin
  for rec in select * from (values
    ('jee-main', 'physics',     'Physics'),
    ('jee-main', 'chemistry',   'Chemistry'),
    ('jee-main', 'mathematics', 'Mathematics'),
    ('jeeadvanced', 'physics',     'Physics'),
    ('jeeadvanced', 'chemistry',   'Chemistry'),
    ('jeeadvanced', 'mathematics', 'Mathematics'),
    ('neet', 'physics',     'Physics'),
    ('neet', 'chemistry',   'Chemistry'),
    ('neet', 'botany',      'Botany'),
    ('neet', 'zoology',     'Zoology')
  ) as t(exam_code, subj_code, subj_name) loop
    select id into v_exam from exams where code = rec.exam_code;
    continue when v_exam is null;

    insert into subjects (tenant_id, exam_id, code, name, display_order)
    values (v_platenant, v_exam, rec.subj_code, rec.subj_name, 0)
    on conflict (exam_id, code) do update set name = excluded.name
    returning id into v_subj;
    v_subj_code := rec.subj_code;

    -- chapters per subject (standard NTA / board syllabus structure)
    for ch in select * from (values
      -- Physics
      ('physics', 'units-dimensions', 'Units & Dimensions', 1), ('physics', 'kinematics', 'Kinematics', 2),
      ('physics', 'laws-of-motion', 'Laws of Motion', 3), ('physics', 'work-energy-power', 'Work, Energy & Power', 4),
      ('physics', 'rotational-motion', 'Rotational Motion', 5), ('physics', 'gravitation', 'Gravitation', 6),
      ('physics', 'properties-of-matter', 'Properties of Solids & Liquids', 7), ('physics', 'thermodynamics', 'Thermodynamics', 8),
      ('physics', 'ktg', 'Kinetic Theory of Gases', 9), ('physics', 'oscillations', 'Oscillations', 10),
      ('physics', 'waves', 'Waves', 11), ('physics', 'electrostatics', 'Electrostatics', 12),
      ('physics', 'current-electricity', 'Current Electricity', 13), ('physics', 'magnetism', 'Magnetic Effects of Current & Magnetism', 14),
      ('physics', 'emi-ac', 'EMI & AC', 15), ('physics', 'em-waves', 'Electromagnetic Waves', 16),
      ('physics', 'optics', 'Optics', 17), ('physics', 'dual-nature', 'Dual Nature of Matter', 18),
      ('physics', 'atoms-nuclei', 'Atoms & Nuclei', 19), ('physics', 'semiconductors', 'Electronic Devices', 20),
      -- Chemistry
      ('chemistry', 'basic-concepts', 'Some Basic Concepts of Chemistry', 1), ('chemistry', 'structure-of-atom', 'Structure of Atom', 2),
      ('chemistry', 'periodicity', 'Classification of Elements & Periodicity', 3), ('chemistry', 'chemical-bonding', 'Chemical Bonding & Molecular Structure', 4),
      ('chemistry', 'states-of-matter', 'States of Matter', 5), ('chemistry', 'chemical-thermodynamics', 'Thermodynamics', 6),
      ('chemistry', 'equilibrium', 'Equilibrium', 7), ('chemistry', 'redox', 'Redox Reactions', 8),
      ('chemistry', 'hydrogen', 'Hydrogen', 9), ('chemistry', 's-block', 's-Block Elements', 10),
      ('chemistry', 'p-block', 'p-Block Elements', 11), ('chemistry', 'organic-basics', 'Organic Chemistry: Basic Principles', 12),
      ('chemistry', 'hydrocarbons', 'Hydrocarbons', 13), ('chemistry', 'environmental-chemistry', 'Environmental Chemistry', 14),
      ('chemistry', 'solid-state', 'Solid State', 15), ('chemistry', 'solutions', 'Solutions', 16),
      ('chemistry', 'electrochemistry', 'Electrochemistry', 17), ('chemistry', 'chemical-kinetics', 'Chemical Kinetics', 18),
      ('chemistry', 'surface-chemistry', 'Surface Chemistry', 19), ('chemistry', 'metallurgy', 'Metallurgy', 20),
      ('chemistry', 'd-f-block', 'd & f Block Elements', 21), ('chemistry', 'coordination', 'Coordination Compounds', 22),
      ('chemistry', 'haloalkanes', 'Haloalkanes & Haloarenes', 23), ('chemistry', 'alcohols-ethers', 'Alcohols, Phenols & Ethers', 24),
      ('chemistry', 'aldehydes-acids', 'Aldehydes, Ketones & Carboxylic Acids', 25), ('chemistry', 'amines', 'Amines', 26),
      ('chemistry', 'biomolecules', 'Biomolecules', 27), ('chemistry', 'polymers', 'Polymers', 28),
      -- Mathematics
      ('mathematics', 'sets-relations', 'Sets & Relations', 1), ('mathematics', 'complex-numbers', 'Complex Numbers', 2),
      ('mathematics', 'quadratic-equations', 'Quadratic Equations', 3), ('mathematics', 'permutations', 'Permutations & Combinations', 4),
      ('mathematics', 'binomial', 'Binomial Theorem', 5), ('mathematics', 'sequences', 'Sequences & Series', 6),
      ('mathematics', 'matrices-determinants', 'Matrices & Determinants', 7), ('mathematics', 'limits', 'Limits & Continuity', 8),
      ('mathematics', 'differentiation', 'Differentiation', 9), ('mathematics', 'applications-derivatives', 'Applications of Derivatives', 10),
      ('mathematics', 'integrals', 'Integrals', 11), ('mathematics', 'differential-equations', 'Differential Equations', 12),
      ('mathematics', 'coordinate-geometry', 'Coordinate Geometry', 13), ('mathematics', 'vectors-3d', 'Vectors & 3D Geometry', 14),
      ('mathematics', 'probability', 'Statistics & Probability', 15), ('mathematics', 'trigonometry', 'Trigonometry', 16),
      -- Botany
      ('botany', 'diversity-life', 'Diversity in Living World', 1), ('botany', 'plant-structure', 'Structural Organisation in Plants', 2),
      ('botany', 'cell-biology', 'Cell Structure & Function', 3), ('botany', 'plant-physiology', 'Plant Physiology', 4),
      ('botany', 'plant-reproduction', 'Reproduction in Plants', 5), ('botany', 'genetics-evolution', 'Genetics & Evolution', 6),
      ('botany', 'human-welfare', 'Biology in Human Welfare', 7), ('botany', 'biotechnology', 'Biotechnology', 8),
      ('botany', 'ecology', 'Ecology', 9),
      -- Zoology
      ('zoology', 'animal-diversity', 'Animal Diversity', 1), ('zoology', 'animal-structure', 'Structural Organisation in Animals', 2),
      ('zoology', 'human-physiology', 'Human Physiology', 3), ('zoology', 'human-reproduction', 'Human Reproduction', 4),
      ('zoology', 'genetics-evolution', 'Genetics & Evolution', 5), ('zoology', 'human-welfare', 'Biology in Human Welfare', 6),
      ('zoology', 'biotechnology', 'Biotechnology', 7), ('zoology', 'ecology', 'Ecology', 8)
    ) as s(subj_code, chap_code, chap_name, chap_order)
    where s.subj_code = v_subj_code loop
      insert into chapters (tenant_id, subject_id, code, name, display_order)
      values (v_platenant, v_subj, ch.chap_code, ch.chap_name, ch.chap_order)
      on conflict (subject_id, code) do update set name = excluded.name
      returning id into v_chap;
    end loop;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Exam patterns (scoring configuration — versioned, not hardcoded)
-- ----------------------------------------------------------------------------
insert into exam_patterns (tenant_id, exam_id, name, version, is_active, duration_minutes, total_questions, total_marks, default_marks, default_negative_marks, sections)
select p.id, e.id, 'JEE Main Pattern (Default)', 1, true, 180, 90, 360, 4, 1,
  jsonb_build_array(
    jsonb_build_object('name', 'Physics', 'subject_code', 'physics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE','NUMERICAL'), 'count', 30, 'marks', 4, 'negative_marks', 1),
    jsonb_build_object('name', 'Chemistry', 'subject_code', 'chemistry', 'question_type_codes', jsonb_build_array('MCQ_SINGLE','NUMERICAL'), 'count', 30, 'marks', 4, 'negative_marks', 1),
    jsonb_build_object('name', 'Mathematics', 'subject_code', 'mathematics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE','NUMERICAL'), 'count', 30, 'marks', 4, 'negative_marks', 1)
  )
from tenants p, exams e where p.id = '00000000-0000-0000-0000-000000000001' and e.code = 'jee-main'
on conflict (tenant_id, exam_id, version) do nothing;

insert into exam_patterns (tenant_id, exam_id, name, version, is_active, duration_minutes, total_questions, total_marks, default_marks, default_negative_marks, sections)
select p.id, e.id, 'JEE Advanced Pattern (Default)', 1, true, 180, 66, 198, 3, 1,
  jsonb_build_array(
    jsonb_build_object('name', 'Physics', 'subject_code', 'physics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE','NUMERICAL'), 'count', 22, 'marks', 3, 'negative_marks', 1),
    jsonb_build_object('name', 'Chemistry', 'subject_code', 'chemistry', 'question_type_codes', jsonb_build_array('MCQ_SINGLE','NUMERICAL'), 'count', 22, 'marks', 3, 'negative_marks', 1),
    jsonb_build_object('name', 'Mathematics', 'subject_code', 'mathematics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE','NUMERICAL'), 'count', 22, 'marks', 3, 'negative_marks', 1)
  )
from tenants p, exams e where p.id = '00000000-0000-0000-0000-000000000001' and e.code = 'jeeadvanced'
on conflict (tenant_id, exam_id, version) do nothing;

insert into exam_patterns (tenant_id, exam_id, name, version, is_active, duration_minutes, total_questions, total_marks, default_marks, default_negative_marks, sections)
select p.id, e.id, 'NEET Pattern (Default)', 1, true, 180, 180, 720, 4, 1,
  jsonb_build_array(
    jsonb_build_object('name', 'Physics', 'subject_code', 'physics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 45, 'marks', 4, 'negative_marks', 1),
    jsonb_build_object('name', 'Chemistry', 'subject_code', 'chemistry', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 45, 'marks', 4, 'negative_marks', 1),
    jsonb_build_object('name', 'Botany', 'subject_code', 'botany', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 45, 'marks', 4, 'negative_marks', 1),
    jsonb_build_object('name', 'Zoology', 'subject_code', 'zoology', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 45, 'marks', 4, 'negative_marks', 1)
  )
from tenants p, exams e where p.id = '00000000-0000-0000-0000-000000000001' and e.code = 'neet'
on conflict (tenant_id, exam_id, version) do nothing;

insert into exam_patterns (tenant_id, exam_id, name, version, is_active, duration_minutes, total_questions, total_marks, default_marks, default_negative_marks, sections)
select p.id, e.id, 'GUJCET Pattern (Default)', 1, true, 180, 120, 240, 2, 0.5,
  jsonb_build_array(
    jsonb_build_object('name', 'Physics', 'subject_code', 'physics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 30, 'marks', 2, 'negative_marks', 0.5),
    jsonb_build_object('name', 'Chemistry', 'subject_code', 'chemistry', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 30, 'marks', 2, 'negative_marks', 0.5),
    jsonb_build_object('name', 'Mathematics', 'subject_code', 'mathematics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 30, 'marks', 2, 'negative_marks', 0.5),
    jsonb_build_object('name', 'Biology', 'subject_code', 'botany', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 30, 'marks', 2, 'negative_marks', 0.5)
  )
from tenants p, exams e where p.id = '00000000-0000-0000-0000-000000000001' and e.code = 'gujcet'
on conflict (tenant_id, exam_id, version) do nothing;

insert into exam_patterns (tenant_id, exam_id, name, version, is_active, duration_minutes, total_questions, total_marks, default_marks, default_negative_marks, sections)
select p.id, e.id, 'KCET Pattern (Default)', 1, true, 180, 180, 180, 1, 0,
  jsonb_build_array(
    jsonb_build_object('name', 'Physics', 'subject_code', 'physics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 60, 'marks', 1, 'negative_marks', 0),
    jsonb_build_object('name', 'Chemistry', 'subject_code', 'chemistry', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 60, 'marks', 1, 'negative_marks', 0),
    jsonb_build_object('name', 'Mathematics', 'subject_code', 'mathematics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 60, 'marks', 1, 'negative_marks', 0)
  )
from tenants p, exams e where p.id = '00000000-0000-0000-0000-000000000001' and e.code = 'kcet'
on conflict (tenant_id, exam_id, version) do nothing;

insert into exam_patterns (tenant_id, exam_id, name, version, is_active, duration_minutes, total_questions, total_marks, default_marks, default_negative_marks, sections)
select p.id, e.id, 'AP EAMCET Pattern (Default)', 1, true, 180, 160, 160, 1, 0,
  jsonb_build_array(
    jsonb_build_object('name', 'Physics', 'subject_code', 'physics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 40, 'marks', 1, 'negative_marks', 0),
    jsonb_build_object('name', 'Chemistry', 'subject_code', 'chemistry', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 40, 'marks', 1, 'negative_marks', 0),
    jsonb_build_object('name', 'Mathematics', 'subject_code', 'mathematics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 40, 'marks', 1, 'negative_marks', 0),
    jsonb_build_object('name', 'Biology', 'subject_code', 'botany', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 40, 'marks', 1, 'negative_marks', 0)
  )
from tenants p, exams e where p.id = '00000000-0000-0000-0000-000000000001' and e.code = 'apeamcet'
on conflict (tenant_id, exam_id, version) do nothing;

insert into exam_patterns (tenant_id, exam_id, name, version, is_active, duration_minutes, total_questions, total_marks, default_marks, default_negative_marks, sections)
select p.id, e.id, 'COMEDK Pattern (Default)', 1, true, 180, 180, 180, 1, 0,
  jsonb_build_array(
    jsonb_build_object('name', 'Physics', 'subject_code', 'physics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 60, 'marks', 1, 'negative_marks', 0),
    jsonb_build_object('name', 'Chemistry', 'subject_code', 'chemistry', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 60, 'marks', 1, 'negative_marks', 0),
    jsonb_build_object('name', 'Mathematics', 'subject_code', 'mathematics', 'question_type_codes', jsonb_build_array('MCQ_SINGLE'), 'count', 60, 'marks', 1, 'negative_marks', 0)
  )
from tenants p, exams e where p.id = '00000000-0000-0000-0000-000000000001' and e.code = 'comedk'
on conflict (tenant_id, exam_id, version) do nothing;

-- ----------------------------------------------------------------------------
-- 6. Free-plan records (FREE is the default plan for every tenant)
-- ----------------------------------------------------------------------------
insert into subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
select id, (select id from plans where name = 'Free' limit 1), 'TRIAL', now(), now() + interval '14 days'
from tenants on conflict do nothing;