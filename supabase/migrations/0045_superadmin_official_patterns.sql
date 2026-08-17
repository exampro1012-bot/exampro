-- =============================================================================
-- ExamPro — 0045: SUPER_ADMIN bootstrap + official verified exam patterns
-- Additive only. Nothing dropped, nothing truncated.
--
-- 1. exampro1012@gmail.com resolves to SUPER_ADMIN through database RBAC
--    (platform_admins + tenant_memberships), not frontend email checks.
-- 2. exam_patterns gains provenance columns (academic year, effective window,
--    official source, verification metadata) per the exam-configuration spec.
-- 3. Versioned official patterns (v1 preserved for history, v2 active):
--      - JEE Main 2026   : NTA bulletin — 75 attempted (20 MCQ + 5 numerical
--                          per subject), 300 marks, 180 min, +4/−1.
--      - NEET UG 2026    : NTA bulletin — 180 compulsory MCQs, 720 marks,
--                          200 minutes, +4/−1, Physics/Chemistry/Botany/Zoology.
--      - JEE Advanced 2026: IIT brochure — two compulsory papers, each 3 h;
--                          per-paper frame stored (counts/marking not fixed by
--                          the brochure → verified_at left NULL, honest).
-- 4. First patterns for CUET / MHT CET / TS EAMCET / WBJEE from official
--    sources (verified_at NULL where the 2026 notification is not yet final).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SUPER_ADMIN bootstrap (database-level, idempotent)
-- -----------------------------------------------------------------------------
insert into platform_admins (user_id)
select u.id from auth.users u
where lower(u.email) = 'exampro1012@gmail.com'
on conflict (user_id) do nothing;

insert into tenant_memberships (tenant_id, user_id, role_id, status, joined_at)
select t.id, u.id, r.id, 'ACTIVE', now()
from auth.users u
cross join roles r
cross join tenants t
where lower(u.email) = 'exampro1012@gmail.com'
  and r.code = 'SUPER_ADMIN'
  and t.id = '00000000-0000-0000-0000-000000000001'
  and not exists (
    select 1 from tenant_memberships tm
    where tm.user_id = u.id and tm.tenant_id = t.id
  );

-- -----------------------------------------------------------------------------
-- 2. exam_patterns provenance columns (additive)
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'academic_year') then
    alter table exam_patterns add column academic_year int;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'effective_from') then
    alter table exam_patterns add column effective_from date;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'effective_to') then
    alter table exam_patterns add column effective_to date;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'official_source_url') then
    alter table exam_patterns add column official_source_url text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'official_document_title') then
    alter table exam_patterns add column official_document_title text;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'official_document_year') then
    alter table exam_patterns add column official_document_year int;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'verified_at') then
    alter table exam_patterns add column verified_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'verified_by') then
    alter table exam_patterns add column verified_by uuid;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'exam_patterns'
                   and column_name = 'notes') then
    alter table exam_patterns add column notes text;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Versioned official patterns. v1 rows stay in place (historical); only the
--    active flag moves. One active pattern per exam (engine picks the highest
--    active version).
-- -----------------------------------------------------------------------------

-- 3a. JEE Main 2026 (official NTA Information Bulletin)
update exam_patterns set is_active = false, updated_at = now()
where exam_id = (select id from exams where name = 'JEE Main') and is_active;

insert into exam_patterns (
  tenant_id, exam_id, name, version, is_active, duration_minutes,
  total_questions, total_marks, default_marks, default_negative_marks,
  sections, academic_year, effective_from, effective_to,
  official_source_url, official_document_title, official_document_year,
  verified_at, verified_by, notes, created_by
)
select p.tenant_id, e.id, 'JEE Main 2026 (Official NTA Bulletin)', 2, true, 180,
  75, 300, 4, 1,
  '[
    {"name":"Physics — Section A (MCQ)","count":20,"marks":4,"negative_marks":1,"subject_code":"physics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Physics — Section B (Numerical)","count":5,"marks":4,"negative_marks":1,"subject_code":"physics","question_type_codes":["NUMERICAL"]},
    {"name":"Chemistry — Section A (MCQ)","count":20,"marks":4,"negative_marks":1,"subject_code":"chemistry","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Chemistry — Section B (Numerical)","count":5,"marks":4,"negative_marks":1,"subject_code":"chemistry","question_type_codes":["NUMERICAL"]},
    {"name":"Mathematics — Section A (MCQ)","count":20,"marks":4,"negative_marks":1,"subject_code":"mathematics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Mathematics — Section B (Numerical)","count":5,"marks":4,"negative_marks":1,"subject_code":"mathematics","question_type_codes":["NUMERICAL"]}
  ]'::jsonb,
  2026, '2026-01-01', '2026-12-31',
  'https://jeemain.nta.nic.in/information-bulletin/',
  'JEE (Main) 2026 Information Bulletin', 2026,
  now(), (select id from auth.users where lower(email) = 'exampro1012@gmail.com'),
  'Paper 1 (B.E./B.Tech): 75 questions to be attempted — 25 per subject (Section A: 20 MCQs; Section B: 5 numerical out of 10 offered). +4 correct, −1 incorrect, 0 unattempted. 300 maximum marks, 180 minutes.',
  (select id from auth.users where lower(email) = 'exampro1012@gmail.com')
from exams e
cross join (select tenant_id from exam_patterns
            where exam_id = (select id from exams where name = 'JEE Main')
            order by created_at limit 1) p
where e.name = 'JEE Main'
  and not exists (
    select 1 from exam_patterns ep
    where ep.exam_id = e.id and ep.version = 2
      and ep.tenant_id is not distinct from p.tenant_id
  );

-- 3b. NEET UG 2026 (official NTA Information Bulletin; 200 minutes)
update exam_patterns set is_active = false, updated_at = now()
where exam_id = (select id from exams where name = 'NEET') and is_active;

insert into exam_patterns (
  tenant_id, exam_id, name, version, is_active, duration_minutes,
  total_questions, total_marks, default_marks, default_negative_marks,
  sections, academic_year, effective_from, effective_to,
  official_source_url, official_document_title, official_document_year,
  verified_at, verified_by, notes, created_by
)
select p.tenant_id, e.id, 'NEET UG 2026 (Official NTA Bulletin)', 2, true, 200,
  180, 720, 4, 1,
  '[
    {"name":"Physics","count":45,"marks":4,"negative_marks":1,"subject_code":"physics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Chemistry","count":45,"marks":4,"negative_marks":1,"subject_code":"chemistry","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Botany","count":45,"marks":4,"negative_marks":1,"subject_code":"botany","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Zoology","count":45,"marks":4,"negative_marks":1,"subject_code":"zoology","question_type_codes":["MCQ_SINGLE"]}
  ]'::jsonb,
  2026, '2026-01-01', '2026-12-31',
  'https://neet.nta.nic.in/',
  'NEET (UG) 2026 Information Bulletin', 2026,
  now(), (select id from auth.users where lower(email) = 'exampro1012@gmail.com'),
  '180 compulsory MCQs (no optional questions): Physics 45, Chemistry 45, Botany 45, Zoology 45. +4 correct, −1 incorrect. 720 marks, 200 minutes (3 h 20 m), offline OMR.',
  (select id from auth.users where lower(email) = 'exampro1012@gmail.com')
from exams e
cross join (select tenant_id from exam_patterns
            where exam_id = (select id from exams where name = 'NEET')
            order by created_at limit 1) p
where e.name = 'NEET'
  and not exists (
    select 1 from exam_patterns ep
    where ep.exam_id = e.id and ep.version = 2
      and ep.tenant_id is not distinct from p.tenant_id
  );

-- 3c. JEE Advanced 2026 (official IIT brochure: two compulsory papers, each 3 h)
update exam_patterns set is_active = false, updated_at = now()
where exam_id = (select id from exams where name = 'JEE Advanced') and is_active;

insert into exam_patterns (
  tenant_id, exam_id, name, version, is_active, duration_minutes,
  total_questions, total_marks, default_marks, default_negative_marks,
  sections, academic_year, effective_from, effective_to,
  official_source_url, official_document_title, official_document_year,
  verified_at, verified_by, notes, created_by
)
select p.tenant_id, e.id, 'JEE Advanced 2026 (per-paper frame, Official Brochure)', 2, true, 180,
  54, 180, 3, 1,
  '[
    {"name":"Physics","count":18,"marks":3,"negative_marks":1,"subject_code":"physics","question_type_codes":["MCQ_SINGLE","MCQ_MULTIPLE","NUMERICAL","MATRIX"]},
    {"name":"Chemistry","count":18,"marks":3,"negative_marks":1,"subject_code":"chemistry","question_type_codes":["MCQ_SINGLE","MCQ_MULTIPLE","NUMERICAL","MATRIX"]},
    {"name":"Mathematics","count":18,"marks":3,"negative_marks":1,"subject_code":"mathematics","question_type_codes":["MCQ_SINGLE","MCQ_MULTIPLE","NUMERICAL","MATRIX"]}
  ]'::jsonb,
  2026, '2026-01-01', '2026-12-31',
  'https://jeeadv.ac.in/documents/IBEnglish_2026.pdf',
  'JEE (Advanced) 2026 Information Brochure', 2026,
  null, null,
  'Two compulsory papers (Paper 1 and Paper 2), each 3 hours, computer-based, PCM. The brochure does NOT fix per-section counts or marking (published in the examination instructions per paper); totals reflect recent official papers (54 Q / 180 marks per paper). verified_at intentionally NULL — run "Verify Official Pattern" against the per-paper instructions before official use.',
  (select id from auth.users where lower(email) = 'exampro1012@gmail.com')
from exams e
cross join (select tenant_id from exam_patterns
            where exam_id = (select id from exams where name = 'JEE Advanced')
            order by created_at limit 1) p
where e.name = 'JEE Advanced'
  and not exists (
    select 1 from exam_patterns ep
    where ep.exam_id = e.id and ep.version = 2
      and ep.tenant_id is not distinct from p.tenant_id
  );

-- -----------------------------------------------------------------------------
-- 4. First patterns for the remaining exams (global tenant_id = null)
-- -----------------------------------------------------------------------------

-- 4a. CUET UG (NTA) — per-subject slot frame
insert into exam_patterns (
  tenant_id, exam_id, name, version, is_active, duration_minutes,
  total_questions, total_marks, default_marks, default_negative_marks,
  sections, academic_year, effective_from, effective_to,
  official_source_url, official_document_title, official_document_year,
  verified_at, verified_by, notes, created_by
)
select '00000000-0000-0000-0000-000000000001', e.id, 'CUET UG (per-subject slot, NTA)', 1, true, 60,
  50, 250, 5, 1,
  '[
    {"name":"Subject test (compulsory MCQs)","count":50,"marks":5,"negative_marks":1,"subject_code":null,"question_type_codes":["MCQ_SINGLE"]}
  ]'::jsonb,
  2026, '2026-01-01', '2026-12-31',
  'https://cuet.nta.nic.in/',
  'CUET (UG) — NTA official site', 2026,
  null, null,
  'CUET UG is multi-subject (languages + domains + General Aptitude Test). This frame models ONE subject slot: 50 compulsory MCQs, 60 minutes, +5/−1. Duplicate this pattern per subject once the CUET UG 2026 notification finalises subject-wise structure; verified_at NULL until then.',
  (select id from auth.users where lower(email) = 'exampro1012@gmail.com')
from exams e
where e.name = 'CUET'
  and not exists (select 1 from exam_patterns ep where ep.exam_id = e.id);

-- 4b. MHT CET (Maharashtra State CET Cell) — PCM group
insert into exam_patterns (
  tenant_id, exam_id, name, version, is_active, duration_minutes,
  total_questions, total_marks, default_marks, default_negative_marks,
  sections, academic_year, effective_from, effective_to,
  official_source_url, official_document_title, official_document_year,
  verified_at, verified_by, notes, created_by
)
select '00000000-0000-0000-0000-000000000001', e.id, 'MHT CET PCM (State CET Cell)', 1, true, 180,
  150, 200, 1, 0,
  '[
    {"name":"Mathematics (Paper 1)","count":50,"marks":2,"negative_marks":0,"subject_code":"mathematics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Physics (Paper 2)","count":50,"marks":1,"negative_marks":0,"subject_code":"physics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Chemistry (Paper 2)","count":50,"marks":1,"negative_marks":0,"subject_code":"chemistry","question_type_codes":["MCQ_SINGLE"]}
  ]'::jsonb,
  2026, '2026-01-01', '2026-12-31',
  'https://cetcell.mahacet.org/',
  'MHT-CET 2026 Syllabus & Marking Scheme (CET Cell)', 2026,
  null, null,
  'PCM group: Paper 1 Mathematics (50 × 2 = 100 marks), Paper 2 Physics + Chemistry (50 × 1 each). No negative marking. 180 minutes composite. PCB group uses 200 questions — add a separate pattern if needed.',
  (select id from auth.users where lower(email) = 'exampro1012@gmail.com')
from exams e
where e.name = 'MHT CET'
  and not exists (select 1 from exam_patterns ep where ep.exam_id = e.id);

-- 4c. TS EAMCET / TG EAPCET (JNTU Hyderabad)
insert into exam_patterns (
  tenant_id, exam_id, name, version, is_active, duration_minutes,
  total_questions, total_marks, default_marks, default_negative_marks,
  sections, academic_year, effective_from, effective_to,
  official_source_url, official_document_title, official_document_year,
  verified_at, verified_by, notes, created_by
)
select '00000000-0000-0000-0000-000000000001', e.id, 'TS EAMCET (JNTUH)', 1, true, 180,
  160, 160, 1, 0,
  '[
    {"name":"Mathematics","count":80,"marks":1,"negative_marks":0,"subject_code":"mathematics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Physics","count":40,"marks":1,"negative_marks":0,"subject_code":"physics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Chemistry","count":40,"marks":1,"negative_marks":0,"subject_code":"chemistry","question_type_codes":["MCQ_SINGLE"]}
  ]'::jsonb,
  2026, '2026-01-01', '2026-12-31',
  'https://tseamcet.nic.in/',
  'TS EAMCET / TG EAPCET — official brochure', 2026,
  null, null,
  '160 MCQs: Mathematics 80, Physics 40, Chemistry 40. 1 mark each, no negative marking, 180 minutes, computer-based.',
  (select id from auth.users where lower(email) = 'exampro1012@gmail.com')
from exams e
where e.name = 'TS EAMCET'
  and not exists (select 1 from exam_patterns ep where ep.exam_id = e.id);

-- 4d. WBJEE (West Bengal Joint Entrance Examinations Board) — category marking
insert into exam_patterns (
  tenant_id, exam_id, name, version, is_active, duration_minutes,
  total_questions, total_marks, default_marks, default_negative_marks,
  sections, academic_year, effective_from, effective_to,
  official_source_url, official_document_title, official_document_year,
  verified_at, verified_by, notes, created_by
)
select '00000000-0000-0000-0000-000000000001', e.id, 'WBJEE (WBJEEB, category marking)', 1, true, 240,
  155, 200, 1, 0,
  '[
    {"name":"Mathematics — Category I","count":50,"marks":1,"negative_marks":0.25,"subject_code":"mathematics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Mathematics — Category II","count":15,"marks":2,"negative_marks":0.5,"subject_code":"mathematics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Mathematics — Category III","count":10,"marks":2,"negative_marks":0,"subject_code":"mathematics","question_type_codes":["MCQ_MULTIPLE"]},
    {"name":"Physics — Category I","count":30,"marks":1,"negative_marks":0.25,"subject_code":"physics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Physics — Category II","count":5,"marks":2,"negative_marks":0.5,"subject_code":"physics","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Physics — Category III","count":5,"marks":2,"negative_marks":0,"subject_code":"physics","question_type_codes":["MCQ_MULTIPLE"]},
    {"name":"Chemistry — Category I","count":30,"marks":1,"negative_marks":0.25,"subject_code":"chemistry","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Chemistry — Category II","count":5,"marks":2,"negative_marks":0.5,"subject_code":"chemistry","question_type_codes":["MCQ_SINGLE"]},
    {"name":"Chemistry — Category III","count":5,"marks":2,"negative_marks":0,"subject_code":"chemistry","question_type_codes":["MCQ_MULTIPLE"]}
  ]'::jsonb,
  2026, '2026-01-01', '2026-12-31',
  'https://wbjeeb.nic.in/',
  'WBJEE 2026 Information Bulletin (WBJEEB)', 2026,
  null, null,
  'Two OMR papers: Mathematics (75 Q, 2 h) then Physics + Chemistry (80 Q, 2 h). Category I +1/−0.25 single-correct; Category II +2/−0.5 single-correct; Category III +2/0 multiple-correct. Totals: 155 questions, 200 marks.',
  (select id from auth.users where lower(email) = 'exampro1012@gmail.com')
from exams e
where e.name = 'WBJEE'
  and not exists (select 1 from exam_patterns ep where ep.exam_id = e.id);

-- -----------------------------------------------------------------------------
-- 5. Indexes for the new provenance columns / frequent lookups (additive)
-- -----------------------------------------------------------------------------
create index if not exists exam_patterns_exam_active_idx
  on exam_patterns (exam_id, is_active, version desc);
