-- =============================================================================
-- ExamPro — Demo question seed (Migration 0017)
--
-- CLEARLY LABELED SAMPLE CONTENT — NOT official PYQs.
-- These are original, self-authored textbook-level MCQs so a fresh project is
-- immediately usable end-to-end (paper generation, online exams, OMR). They
-- are marked license_status = 'DEMO', source = 'ExamPro Synthetic QA Set',
-- verification_status = 'VERIFIED', and live in the shared platform bank so
-- every tenant can generate from them. Production question banks are built
-- through the import pipeline (see supabase/import-dataset.mjs).
-- Idempotent: fixed question ids, ON CONFLICT (id) DO NOTHING.
-- =============================================================================

do $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_exam uuid; v_subj uuid; v_chap uuid; v_type uuid;
  rec record; v_qid uuid; v_key text;
begin
  select id into v_type from question_types where code = 'MCQ_SINGLE' and is_active limit 1;

  for rec in select * from (values
    -- (qid, exam_code, subj_code, chap_code, difficulty, text, correct_key, solution, options jsonb)
    ('a1000000-0000-0000-0000-000000000001'::uuid, 'jee-main', 'physics', 'kinematics', 'MEDIUM'::question_difficulty,
     'A body starts from rest and moves with uniform acceleration of 2 m/s^2 along a straight line. What is the distance covered by the body in the 4th second of its motion?',
     'B',
     'Distance in the n-th second = u + a(2n - 1)/2 = 0 + 2(2*4 - 1)/2 = 7 m.',
     '[{"k":"A","t":"5 m"},{"k":"B","t":"7 m"},{"k":"C","t":"9 m"},{"k":"D","t":"11 m"}]'),
    ('a1000000-0000-0000-0000-000000000002'::uuid, 'jee-main', 'physics', 'units-dimensions', 'EASY',
     'Which of the following is the correct dimensional formula of force?',
     'C',
     'Force = mass x acceleration, so [F] = [M][L][T^-2].',
     '[{"k":"A","t":"[M L T]"},{"k":"B","t":"[M L^2 T^-2]"},{"k":"C","t":"[M L T^-2]"},{"k":"D","t":"[M L^-1 T^-2]"}]'),
    ('a1000000-0000-0000-0000-000000000003'::uuid, 'jee-main', 'physics', 'work-energy-power', 'EASY',
     'If the kinetic energy of a moving body is doubled, the speed of the body becomes approximately:',
     'A',
     'KE = (1/2)mv^2, so v = sqrt(2KE/m). Doubling KE multiplies speed by sqrt(2), about 1.41x.',
     '[{"k":"A","t":"1.41 times the original speed"},{"k":"B","t":"2 times the original speed"},{"k":"C","t":"4 times the original speed"},{"k":"D","t":"Half the original speed"}]'),
    ('a1000000-0000-0000-0000-000000000004'::uuid, 'jee-main', 'physics', 'current-electricity', 'MEDIUM',
     'A wire of uniform cross-section has resistance R. If the wire is stretched uniformly to double its length (volume unchanged), its new resistance is:',
     'D',
     'Volume is constant, so halving the cross-section area while doubling length gives R_new = rho(2L)/(A/2) = 4R.',
     '[{"k":"A","t":"2R"},{"k":"B","t":"R/2"},{"k":"C","t":"R/4"},{"k":"D","t":"4R"}]'),
    ('a1000000-0000-0000-0000-000000000005'::uuid, 'jee-main', 'chemistry', 'basic-concepts', 'EASY',
     'How many moles are present in 44 g of carbon dioxide (CO2)? (Atomic masses: C = 12, O = 16)',
     'B',
     'Molar mass of CO2 = 12 + 2*16 = 44 g/mol, so 44 g is exactly 1 mol.',
     '[{"k":"A","t":"0.5 mol"},{"k":"B","t":"1 mol"},{"k":"C","t":"2 mol"},{"k":"D","t":"44 mol"}]'),
    ('a1000000-0000-0000-0000-000000000006'::uuid, 'jee-main', 'chemistry', 'chemical-bonding', 'MEDIUM',
     'The shape of a water (H2O) molecule is best described as:',
     'C',
     'Oxygen in water has two bond pairs and two lone pairs (VSEPR), giving a bent shape.',
     '[{"k":"A","t":"Linear"},{"k":"B","t":"Trigonal planar"},{"k":"C","t":"Bent"},{"k":"D","t":"Tetrahedral"}]'),
    ('a1000000-0000-0000-0000-000000000007'::uuid, 'jee-main', 'mathematics', 'quadratic-equations', 'EASY',
     'The roots of the equation x^2 - 5x + 6 = 0 are:',
     'A',
     'x^2 - 5x + 6 = (x - 2)(x - 3) = 0, hence x = 2 and x = 3.',
     '[{"k":"A","t":"2 and 3"},{"k":"B","t":"-2 and -3"},{"k":"C","t":"5 and 6"},{"k":"D","t":"1 and 6"}]'),
    ('a1000000-0000-0000-0000-000000000008'::uuid, 'jee-main', 'mathematics', 'trigonometry', 'EASY',
     'For any real angle theta, the value of sin^2(theta) + cos^2(theta) is always equal to:',
     'D',
     'This is the fundamental Pythagorean identity, valid for every real theta.',
     '[{"k":"A","t":"sin(2 theta)"},{"k":"B","t":"0"},{"k":"C","t":"cos(2 theta)"},{"k":"D","t":"1"}]')
  ) as t(qid, exam_code, subj_code, chap_code, diff, qtext, key, sol, opts) loop

    select id into v_exam from exams where code = rec.exam_code limit 1;
    continue when v_exam is null;
    select id into v_subj from subjects where exam_id = v_exam and code = rec.subj_code limit 1;
    continue when v_subj is null;
    select id into v_chap from chapters where subject_id = v_subj and code = rec.chap_code limit 1;

    v_qid := rec.qid;
    if exists (select 1 from questions where id = v_qid) then
      continue;
    end if;

    insert into questions (id, tenant_id, exam_id, subject_id, chapter_id,
                           question_type_id, question_text, difficulty, source,
                           verification_status, verified_at, license_status,
                           question_hash, created_by)
    values (v_qid, v_tenant, v_exam, v_subj, v_chap, v_type, rec.qtext, rec.diff,
            'ExamPro Synthetic QA Set', 'VERIFIED', now(), 'DEMO',
            md5(rec.qtext), null);

    insert into question_options (tenant_id, question_id, option_key, option_text, display_order)
    select v_tenant, v_qid, x.o->>'k', x.o->>'t', row_number() over ()
    from jsonb_array_elements(rec.opts::jsonb) as x(o);

    insert into question_answers (tenant_id, question_id, correct_option_keys, explanation)
    values (v_tenant, v_qid, array[rec.key], rec.sol);

    insert into solutions (tenant_id, question_id, solution_text, concept)
    values (v_tenant, v_qid, rec.sol, rec.sol);
  end loop;
end $$;