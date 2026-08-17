# EXAMPRO — FINAL AUDIT REPORT (2026-08-16, integrity & official-configuration cycle #5)

Independent verification of the master-prompt acceptance criteria against the live system
(`lrktftnalrtvaazaauhj.supabase.co`), correcting four systemic gaps that earlier cycles had
mis-reported as complete. Nothing was fabricated to make checks pass; every claim below was
verified live this cycle.

---

## Verdict

The platform is now **genuinely data-driven with an honestly empty verified corpus**. Four
findings of the prior "complete" claims were false and are now fixed: the SUPER_ADMIN
bootstrap did not exist, the "official corpus" was 100% fabricated test data, the exam
patterns were stale/wrong/incomplete, and a prior hardcoded-data edit had silently broken
the answer-key engine while a live DB password sat in a repo file.

---

## 1. Files changed (this cycle)

| File | Change |
|---|---|
| `supabase/migrations/0045_superadmin_official_patterns.sql` | **NEW** — SUPER_ADMIN bootstrap + pattern provenance columns + versioned official 2026 patterns + 4 new exam patterns (additive, idempotent) |
| `src/ingestion-center.js` | Fixed answer-key apply regression: `AK_QUESTIONS` now caches the DB-fetched rows between preview and apply (was reset to `[]`, making apply permanently a no-op) |
| `src/pages.js` | CSV-template button now emits non-importable placeholder tokens instead of a fake "What is 2+2?" question |
| `scripts/purge-fixture-questions.mjs` | **NEW** — categorized purge of fixture-signature questions (dry-run + snapshot) |
| `tests/supabase-e2e.spec.ts` | Paper-gen test self-sufficient (subject-filtered path) |
| `tests/supabase-repair.spec.ts` | Paper-PDF + DPP tests self-sufficient (`seedVerifiedProbes` helper) |
| `tests/supabase-features.spec.ts` | OMR, param-routing, practice drill, weak-topics, revision tests self-sufficient; routing question now cleaned up |
| `tests/drive-e2e.spec.ts` | Paper-view Drive test self-sufficient |
| `tests/supabase-ai-solutions.spec.ts` | Fixture CSV explanation emptied so the question actually enters the solution queue |
| `seed-questions.mjs` | **DELETED** — fabricated-question seeder containing the live postgres password |
| `sample-questions/questions.json` | **DELETED** — orphan demo question corpus (unreferenced by runtime/importer) |
| `AUDIT-MATRIX.md`, `DEPLOYMENT-STATUS.md` | Corrected the false corpus claim; documented cycle #5 |
| `dist/` | Rebuilt (16 files, 0 issues) |

## 2. Migrations created / applied

- **0045_superadmin_official_patterns** — applied live and recorded in remote migration
  history (`0045`). Applied via one-off direct SQL because the Supabase CLI token had
  expired (401) — **owner: re-auth CLI for future pushes/deploys**.
  1. `platform_admins` + `tenant_memberships`(SUPER_ADMIN, platform tenant) for
     `exampro1012@gmail.com` — verified live (`is_platform_admin=1`, `sa_memberships=1`).
     Authorization is DB-level (`app_is_platform_admin`); the frontend only renders by role.
  2. `exam_patterns` += `academic_year, effective_from, effective_to, official_source_url,
     official_document_title, official_document_year, verified_at, verified_by, notes`
     + index `(exam_id, is_active, version desc)`.
  3. Pattern data (v1 rows preserved inactive for history; one active per exam):
     - **JEE Main v2** (active, verified): 75 attempted / 300 marks / 180 min; per subject
       Section A 20 MCQ + Section B 5 NUMERICAL, +4/−1. Source: NTA Information Bulletin
       (jeemain.nta.nic.in).
     - **NEET v2** (active, verified): 180 compulsory MCQs / 720 / **200 min** (was wrongly
       180), Physics/Chemistry/Botany/Zoology 45 each, +4/−1. Source: NTA NEET bulletin.
     - **JEE Advanced v2** (active, honestly unverified): two compulsory 3-hour papers per
       the official brochure — stored as a per-paper frame (54 Q / 180 marks, MCQ_SINGLE +
       MCQ_MULTIPLE + NUMERICAL + MATRIX); `verified_at` NULL because the brochure does not
       fix counts/marking (published per paper). Source: jeeadv.ac.in IBEnglish_2026.pdf.
     - **CUET** (per-subject slot 50 Q / 60 min / +5/−1), **MHT CET** (PCM 150 Q / 200 M /
       180 min, no negative), **TS EAMCET** (160 Q / 160 M / 180 min), **WBJEE** (155 Q /
       200 M / 240 min, category marking −0.25/−0.5, multiple-correct Cat III).
     - All **11 exams** now have an active, editable pattern; zero exam logic in JS.

## 3. RPCs / Edge Functions changed

- **None modified.** All 42 engine RPCs verified deployed by prior cycle; edge functions
  untouched (18/18 ACTIVE). Pattern-driven generation works through the existing
  `app_generate_paper` section engine reading `exam_patterns.sections`.

## 4. Hardcoded data removed

| Item | Count | Evidence |
|---|---|---|
| `SEED_AUTOMATED` fabricated questions (marked VERIFIED) | 285 | `"APEAMCET physics seed Q1 <ts>-<hex>"` placeholders |
| "ExamPro Synthetic QA Set" | 8 | synthetic demo set, marked VERIFIED |
| Suite-tagged leftovers (`INGEST/AKQ/VQ/STORE/AISOL<ts>`) | 374 | Playwright `Date.now()` tags, "what is 2+2?" junk |
| Null-source test junk ("Routing test question", "PaperGen probe") | 46 | incl. one VERIFIED probe in AP EAMCET |
| `QA_REPAIR` leftover | 1 | import-repair spec residue |
| **Total purged from live DB** | **714** | `purge-fixture-snapshot.json`; `question_index` cascaded 714→0 |
| Test auth users (`auth+*@exampro.test`) | 54 + 12 post-suite | 4 real users remain |
| Test papers / DPPs / OMR artifacts | 71 + 5 post-suite | papers 0, dpps 0 after cleanup |
| Repo fixtures | `seed-questions.mjs`, `sample-questions/`, CSV-template sample row | no runtime references remained |

**Key admission corrected:** the prior corpus claim ("714 live, 391 VERIFIED, official
fixture origin") was false — the table decomposed *exactly* into fixture sources and
`is_pyq=true` was **0**. The 160-question AP EAMCET seed existed specifically so
section-mode paper generation would pass tests — a forbidden fallback. It is gone, and the
tests now create, verify, and clean up their own probe questions.

## 5. Question tables, foreign keys, RLS — verified

- Question model intact: `questions` (+`question_options`, `question_answers`, `solutions`,
  `question_index` (FK cascade verified live), `question_shards`, `question_usage`,
  `paper_questions`, `dpps`, …) with UUID PKs and FK joins; no name-based keys.
- Deletion cascades exercised for real: purging 714 questions cleanly removed
  index/options/answers/usage/paper_questions and left 0 orphans (papers/dpps counted 0).
- RLS unchanged and previously verified (negative suite 21/21 re-passed this cycle).
- Corpus state after purge: **98 questions, all `PENDING_REVIEW`, all source=PARSER**
  (real uploaded-book parse output awaiting human review — kept, not fabricated),
  **0 VERIFIED** by design.

## 6. Roles verified

- `exampro1012@gmail.com` → SUPER_ADMIN via `platform_admins` + `tenant_memberships`
  (migration 0045) — **live-verified**.
- Role-aware login redirects, per-role dashboards, 403 guard: re-verified by the full
  Playwright run (negative suite 21/21, ui suite, auth-live suite — all green).
- `admin@exampro.com` remains the second platform admin (QA).

## 7. Exam patterns verified (live state)

| Exam | Active pattern | Status |
|---|---|---|
| JEE Main | v2 — 75/300/180min, 6 sections | ✅ verified vs NTA 2026 bulletin |
| NEET UG | v2 — 180/720/**200min**, 4 sections | ✅ verified vs NTA 2026 bulletin |
| JEE Advanced | v2 — per-paper frame 180min | 🟡 official 2×3h structure stored; counts/marking need per-paper verification before official use (`verified_at` NULL by design) |
| AP EAMCET / GUJCET / KCET / COMEDK | v1 (pre-existing, matches official) | ✅ active |
| CUET / MHT CET / TS EAMCET / WBJEE | v1 (new) | 🟡 from official sources; `verified_at` NULL until 2026 notifications finalize |

Historical versions preserved (v1 rows inactive) — papers remain reproducible.

## 8. Generators / OMR / PDF status

- **Paper generator:** section engine reads the active pattern; live canary now returns the
  honest refusal — `"Insufficient eligible questions for one or more sections", missing:
  [{section: "Physics — Section A (MCQ)", required: 20, available: 0}, …]` — proving the
  JEE Main 2026 configuration drives generation and no fabrication occurs.
- **DPP generator:** PASS (self-sufficient test creates + verifies its own pool).
- **Answer key / solutions:** answer-key apply regression fixed (`AK_QUESTIONS`); the
  ingestion answer-key suite re-passed ("set 1 / conflicts 1"). AI-solution queue test now
  genuinely exercises generate→validate→expert-review with its own solution-less question.
- **OMR:** template/sheet/evaluate suite green (self-sufficient paper source).
- **PDF/A4/print:** paper PDF download, answer-key, solutions, OMR sheets — green on
  desktop + mobile.

## 9. Google Drive status

Unchanged from cycle #4: OAuth secret CONFIGURED; **awaiting the single owner consent
click** (Settings → Storage → Google Drive → Connect as exampro1012@gmail.com). 7
round-trip tests skip honestly until then (×2 projects = the 14 skips in the final run).
All disconnected-path behavior (401/400/404/415/503, CORS, zero leakage) previously
verified 16/16.

## 10. Test / scan results (final state, this cycle)

| Check | Result |
|---|---|
| Playwright full run (desktop + mobile) | **322 passed / 0 failed / 14 skipped** (336 total; skips = Drive-consent-gated) |
| §40 static hardcoded-data scan (src, index.html, functions, dist) | CLEAN — remaining `questions` identifiers are DB-query accumulators, not content |
| Secret scan (`scan-secrets.cjs` + `structural.mjs`) | CLEAN (incl. the deleted password pattern; app boots with 0 page errors) |
| Build | dist 16 files, 0 issues |
| Live canaries | corpus 98/0-verified honest; eligibility 0 across JEE Main/Adv/NEET; generation honest-refusal with per-section missing; SUPER_ADMIN resolves |

## 11. Remaining blockers / owner actions

1. **Rotate the postgres DB password** — it was committed in repo history and shared in
   chat (`seed-questions.mjs` is deleted, but rotation is still required).
2. **Google Drive consent click** — the only remaining functional gap (7 gated tests).
3. **Re-auth the Supabase CLI** (token expired) for future `db push` / function deploys.
4. **Populate the real question bank** — ingest actual official PYQ documents through the
   Ingestion Center and verify them (98 PENDING_REVIEW parser fragments of one uploaded
   book await review; 0 verified questions by design). The platform is intentionally
   empty-first: every surface shows honest empty states and refuses to fabricate.
5. Pre-existing owner hygiene: rotate `admin@exampro.com` password, SMTP verification,
   CI wiring; consider rotating the OAuth client secret (shared in chat).

## 12. Acceptance-criteria deltas (vs master prompt §47)

All previously-green criteria remain green (verified by the full suite). Criteria that
were FAILING before this cycle and are now PASSING: SUPER_ADMIN DB bootstrap; no fake
question fallback (in DB *and* tests); no fabricated verified corpus; official current
exam configurations (JEE Main 300-mark fix, NEET 200-min fix, JEE Adv two-paper structure,
4 new exams); no hardcoded answer-key engine breakage; no credential in repo.
**Intentionally open:** verified-corpus population (owner ingestion), Drive consent,
DB-password rotation.

---

## 13. Addendum — cycle #6 (same date): exam-configuration admin UI (§11/§37/§38)

Closed the remaining UI gaps the master prompt requires around the (already data-driven)
pattern engine — all in `src/pages.js`, verified live by `probe-ui-patterns.mjs`
(0 console/page errors):

- **§37 Exam Configuration admin UI** (`/admin/patterns`): create form now captures
  academic year, official source URL, official document title and effective from/to;
  new patterns start honestly **unverified**; the table shows Structure (Q/marks),
  Official source (linked) and Verification columns; **"Verify Official Pattern"**
  action stamps `verified_at`/`verified_by` (requires a recorded official source URL);
  toggle renamed **Activate/Archive**; Delete warns to prefer Archive for
  reproducibility. **Single-active invariant enforced** — both on activate (archives
  sibling versions of the exam) and on create (previously activating a new version left
  the old one active).
- **§38 latest-pattern safety**: administrative warnings render for active patterns past
  `effective_to` ("Official pattern verification required before generating a
  current-year paper") and for active exams with no active pattern.
- **§11 pattern transparency in the generator** (`/papers/new`): selecting an exam shows
  "Pattern: <name> · v<n> (<year>) · Q/marks · duration", "Pattern source: <official
  document + link>" and "Last verified: <date>" — or an honest **Unverified** badge
  (JEE Advanced today). Expired patterns show the §38 warning inline.
- **RLS visibility fix**: the four cycle-#5 patterns (CUET/MHT CET/TS EAMCET/WBJEE) were
  inserted with `tenant_id = null` and were invisible to the tenant-scoped admin RLS
  policy (the security-definer engine still saw them). Live rows moved to the platform
  tenant and migration 0045 updated to match — admin page now lists **14/14 patterns,
  0 false warnings**.
- Regression after the UI work: 124 passed / 0 failed across the affected specs
  (ui, negative, features, e2e, repair); build 16 files 0 issues; secret scan CLEAN;
  structural boot test PASSED.
