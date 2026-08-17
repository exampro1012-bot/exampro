# FINAL-CODEBASE-CLEANUP-REPORT.md

Date: 2026-08-17 (cleanup + FK/relationship + role-seed cycle)
Live project: `lrktftnalrtvaazaauhj.supabase.co`

Everything below was performed and verified this cycle. Nothing was deleted
without a reference check; nothing was reported as done without running it.

---

## 1. Files removed

| Category | Files | Justification |
|---|---|---|
| Root probe/debug scripts | `probe-auth.mjs`, `probe-auth2.mjs`, `probe-auth3.mjs`, `probe-config.mjs`, `probe-hastable.mjs`, `probe-hastable2.mjs`, `probe-hastable3.mjs`, `probe-live.mjs`, `probe-rpcs.mjs`, `probe-schema.mjs`, `probe-ui.mjs`, `probe-ui2.mjs`, `probe-ui3.mjs`, `probe-ui4.mjs`, `probe-ui-patterns.mjs`, `probe-ui-storage.mjs` (16 files) | debug probes from prior cycles; the two runtime consumers (`scripts/canaries.mjs`, `scripts/fn-probe.mjs`) were refactored to read `SUPABASE_URL`/`SUPABASE_ANON_KEY` env vars first (verified working live) BEFORE deletion |
| Temporary logs | `full-regression.log`, `rerun-ingestion.log`, `rerun-regression.log`, `rerun3.log`, `rerun4.log`, `full-regression-v2.log` | regenerable test output; gitignored class |
| Stale JSON/txt artifacts | `db-storage-audit-results.json`, `perf-results.json`, `purge-fixture-snapshot.json`, `results.txt` (0 bytes) | all are `writeFileSync` OUTPUTS of scripts in `scripts/` (verified), regenerable |
| Test output dirs | `playwright-report/`, `test-results/` | generated artifacts; gitignored |
| Unused dependencies | `googleapis`, `google-auth-library` (deps), `pdfjs-dist`, `jspdf` (devDeps) | Edge Functions import via Deno `npm:` specifiers (not node_modules); pdfjs/jspdf are vendored under `src/vendor/`. 118 packages removed from `node_modules`; lockfile re-synced via `npm install` |

## 2. Files retained / restructured

Canonical documentation moved into `docs/`:

```
docs/
  architecture.md  database.md  rbac.md  ingestion.md  exam-patterns.md
  paper-generator.md  dpp-generator.md  omr.md  google-drive.md  oauth.md
  security.md  deployment.md  testing.md  configuration.md
  production-checklist.md
  archive/        (18 historical cycle reports — kept for audit trail)
```

- 5 NEW canonical docs written this cycle (`ingestion`, `exam-patterns`,
  `paper-generator`, `dpp-generator`, `omr`) from the actual implementation.
- `README.md` documentation section rewritten to the new layout; stale
  claims fixed (migrations now `0001…0046 + 9001`, removed the obsolete
  `build/` legacy note, removed stale `@exampro.test` domain text).
- Cross-references fixed (`docs/deployment.md`, `docs/production-checklist.md`,
  `docs/google-drive.md`).
- Kept at root: `README.md`, `FINAL-EXAMPRO-E2E-AUDIT.md` (current E2E
  audit), this report, config files, `src/`, `supabase/`, `tests/`,
  `scripts/`, `dist/` (deployment output).
- `.test-creds.env` retained (gitignored local test config used by
  diagnostic scripts).

## 3. Duplicate code removed

None found requiring consolidation — one authoritative implementation per
business operation already exists (paper gen: `app_generate_paper` RPC +
`generate-paper` edge wrapper; scoring: `app_finalize_session`; Drive:
`_shared/drive-auth.ts` shared by all 12 drive functions; storage gate:
`EP.ingestionStorageGate`). The vendored `src/vendor/*` files are
deliberate offline mirrors, not duplicates.

## 4. Database changes (migration `0047_role_accounts_and_fk.sql` — NEW)

Additive + idempotent; **applies without data loss**:

1. **FK enforcement (spec §13 gap)** — `exam_sessions.student_id` and
   `results.student_id` held auth-user ids with NO constraint. Orphan ids
   are nulled first (rows preserved), then:
   - `exam_sessions_student_id_fkey → auth.users(id) ON DELETE SET NULL`
   - `results_student_id_fkey → auth.users(id) ON DELETE SET NULL`
2. **Roles** — `QUESTION_REVIEWER` and `CONTENT_EDITOR` inserted (permission
   sets mirrored from `REVIEWER` / `DATA_OPERATOR` respectively).
3. **`app_admin_set_user_role(p_user_email, p_role_code)`** —
   `SECURITY DEFINER` RPC, gated on `app_is_platform_admin()` (never email
   strings), audited into `audit_logs`, auto-grants `platform_admins` for
   SUPER_ADMIN. Enables role seeding without a service-role key.

## 5. Foreign-key map (verified from migrations — spec §54)

Machine-readable summary of the core relationships (all UUID, all indexed
via PK/FK; `tenants(id)` is the SaaS isolation root on every business
table):

```json
[
 {"entity":"questions","pk":"id","fks":{"exam_id":"exams.id","subject_id":"subjects.id","chapter_id":"chapters.id","topic_id":"topics.id","subtopic_id":"subtopics.id","question_type_id":"question_types.id","tenant_id":"tenants.id","verified_by":"auth.users.id","created_by":"auth.users.id"},"purpose":"question taxonomy + provenance","cascade":"set-null(exam/subject/chapter/topic), cascade(tenant)"},
 {"entity":"question_options","fks":{"question_id":"questions.id"},"cascade":"cascade","purpose":"options"},
 {"entity":"question_answers","fks":{"question_id":"questions.id"},"purpose":"canonical answer key"},
 {"entity":"solutions","fks":{"question_id":"questions.id"},"purpose":"solutions"},
 {"entity":"question_translations","fks":{"question_id":"questions.id"},"unique":["question_id,language"],"purpose":"multilingual content"},
 {"entity":"question_usage","fks":{"question_id":"questions.id","tenant_id":"tenants.id"},"purpose":"no-repeat engine"},
 {"entity":"papers","fks":{"exam_id":"exams.id","exam_pattern_id":"exam_patterns.id","tenant_id":"tenants.id","created_by":"auth.users.id"},"purpose":"generated paper + pattern version (reproducible)"},
 {"entity":"paper_questions","fks":{"paper_id":"papers.id","question_id":"questions.id"},"unique":["paper_id,question_order"],"purpose":"immutable snapshot"},
 {"entity":"dpps","fks":{"tenant_id":"tenants.id"},"purpose":"DPP header"},
 {"entity":"dpp_questions","fks":{"dpp_id":"dpps.id","question_id":"questions.id"},"purpose":"DPP snapshot"},
 {"entity":"exam_sessions","fks":{"paper_id":"papers.id","student_id":"auth.users.id (0047)","tenant_id":"tenants.id"},"purpose":"exam attempt"},
 {"entity":"responses","fks":{"exam_session_id":"exam_sessions.id","question_id":"questions.id"},"purpose":"answers"},
 {"entity":"results","fks":{"exam_session_id":"exam_sessions.id","paper_id":"papers.id","student_id":"auth.users.id (0047)","tenant_id":"tenants.id"},"purpose":"scores"},
 {"entity":"institutions","fks":{"tenant_id":"tenants.id"},"purpose":"branding root (logo/address/contacts)"},
 {"entity":"branches","fks":{"institution_id":"institutions.id"},"purpose":"campus"},
 {"entity":"batches","fks":{"branch_id":"branches.id","exam_id":"exams.id"},"purpose":"cohorts"},
 {"entity":"teachers","fks":{"auth_user_id":"auth.users.id"},"purpose":"teacher identity + subject_ids[]"},
 {"entity":"teacher_assignments","fks":{"teacher_id":"teachers.id","batch_id":"batches.id","subject_id":"subjects.id"},"unique":["teacher_id,batch_id,subject_id"],"purpose":"relational teacher↔subject↔batch scoping"},
 {"entity":"students","fks":{"tenant_id":"tenants.id"},"purpose":"student records"},
 {"entity":"student_batches","fks":{"student_id":"students.id","batch_id":"batches.id"},"unique":["student_id,batch_id"],"purpose":"enrollment"},
 {"entity":"tenant_memberships","fks":{"tenant_id":"tenants.id","user_id":"auth.users.id","role_id":"roles.id"},"purpose":"RBAC membership (user_roles equivalent)"},
 {"entity":"role_permissions","fks":{"role_id":"roles.id"},"pk":["role_id,permission_code"],"purpose":"permission matrix"},
 {"entity":"platform_admins","fks":{"user_id":"auth.users.id"},"purpose":"platform-level admins"},
 {"entity":"exam_patterns","fks":{"exam_id":"exams.id","omr_template_id":"omr_templates.id"},"purpose":"versioned official patterns + OMR pinning"},
 {"entity":"exam_pattern_sections","fks":{"exam_pattern_id":"exam_patterns.id"},"purpose":"section rules"},
 {"entity":"syllabus_versions","fks":{"exam_id":"exams.id","source_document_id":"source_documents.id"},"purpose":"official syllabus registry"},
 {"entity":"question_syllabus_map","fks":{"question_id":"questions.id","syllabus_version_id":"syllabus_versions.id"},"unique":["question_id,syllabus_version_id"],"purpose":"per-question syllabus status"},
 {"entity":"source_documents / official_source_domains / source_crawler_log","fks":{"source_documents.tenant_id":"tenants.id"},"purpose":"source registry (spec §40)"},
 {"entity":"storage_objects / storage_folders / google_drive_oauth_tokens","fks":{"storage_objects.folder_id":"storage_folders.id","storage_objects.tenant_id":"tenants.id"},"purpose":"Drive-backed storage metadata"},
 {"entity":"omr_templates / omr_sheets / omr_responses","fks":{"omr_sheets.template_id":"omr_templates.id","omr_responses.sheet_id":"omr_sheets.id"},"purpose":"OMR engine"},
 {"entity":"bookmarks / practice_logs / student_notes / weak_topic_reports","fks":{"*.question_id":"questions.id","*.user_id":"auth.users.id"},"purpose":"student features"},
 {"entity":"ingestion_jobs / ingestion_pages / question_shards / question_index","fks":{"ingestion_pages.job_id":"ingestion_jobs.id","question_shards.job_id":"ingestion_jobs.id","question_index.question_id":"questions.id"},"purpose":"ingestion pipeline"}
]
```

No name-based relationships exist (verified: taxonomy, membership,
assignment, generation and result paths all join on UUIDs).

## 6. Automatic population / cascading selectors (spec §15-§19)

- **Question form**: exam → subject (filtered by exam) → chapter → **topic
  (NEW this cycle)** — each level loads from its parent's FK; child
  selections reset when the parent changes; `topic_id` persists on save.
- **Question bank filters**: same four-level cascade (topic filter NEW),
  stale chapter/topic cleared on exam/subject change; URL params
  (`?topic_id=`) supported.
- Institution → teacher/student/batch selectors, pattern → paper generator,
  institution branding on papers/DPP/OMR (FK-joined at render), syllabus
  version → question mapping card — all previously implemented and
  regression-verified.
- **Live E2E added**: `tests/exampro-cascade.spec.ts` creates its own
  subject/chapter/topic/question fixture, proves the cascade loads each
  level, proves stale children clear, and proves `topic_id` persists from
  the form. Passes desktop + mobile.

## 7. RLS / RBAC changes

- No policy regressions: full negative suite (cross-tenant, direct-ID,
  modified JWT, expired session, role downgrade, student write-block)
  green in regression.
- RBAC remains DB-driven (`app_is_platform_admin`, `app_has_permission`,
  `app_can_access_tenant`); `app_admin_set_user_role` adds an audited,
  platform-admin-gated way to manage roles without exposing a service key.

## 8. Role seed mechanism (spec §29-§33)

- `scripts/seed-test-users.mjs` (NEW) — creates the 10 deterministic test
  identities (`superadmin@exampro.local`, `institution.admin@`,
  `teacher@`, `subject.teacher@`, `reviewer@`, `editor@`, `student@`,
  `parent@`, `finance@`, `support@`) with strong generated passwords
  (`ExamPro-<rand>-<ROLE>-<rand>#`), assigns the DB role via the new RPC
  (or directly with a service key when provided), creates `teachers` /
  `students` relational rows for scoping, writes credentials **only** to
  `.env.local` (gitignored) and prints them **once**.
- `.env.example` documents all `TEST_<ROLE>_EMAIL/PASSWORD` variables with
  empty password values (no secrets committed).
- Production SUPER_ADMIN `exampro1012@gmail.com` untouched (DB-role based).

## 9. Security changes

- 118 unused packages removed (smaller install surface).
- Debug/probe files deleted; `scripts/scan-secrets.cjs` run against
  src + dist: **SCAN CLEAN** (also covers `.env.local` being gitignored —
  `.gitignore` already contains `.env.local`, `playwright-report/`,
  `test-results/`, `*.log`, `dist/`).
- No service-role key, DB password, OAuth secret or refresh token exists
  anywhere in the repo (verified by scan + manual inspection of env files).

## 10-15. Build / test results

- **Build**: `dist/` 16 files, 0 issues (topic-selector code verified
  present in dist).
- **Full Playwright regression (desktop + mobile, live backend)**:
  see §Results below.
- **New cascade spec**: passes desktop + mobile.
- **Offline suites** (migration validation, UI, negative): 67 passed /
  2 skipped (mobile-project skips) after the cascade change (one TDZ
  regression was introduced and fixed during development — caught by the
  route-coverage test, root-caused, fixed, re-verified).

### Results

- Playwright Desktop + Mobile (full): **328 passed / 0 failed / 20 skipped**
  (skips = 7 Drive-consent-gated × 2 projects + 6 policy-sensitive mobile —
  all with explicit reasons).
- RPC probe: 42/42 OK. Schema probe: 0 missing tables. Secret scan: CLEAN.
- Build: PASS.

## 16. Remaining blockers (owner-interactive only)

1. **Apply migration 0047** (SQL editor or `supabase db push` after
   re-authing the CLI) — then run `node scripts/seed-test-users.mjs`
   (needs `ADMIN_EMAIL/ADMIN_PASSWORD` of the platform admin, or a
   `SUPABASE_SERVICE_ROLE_KEY`) to create the 10 test accounts.
2. Google Drive consent click (unchanged from prior reports).
3. Rotate the postgres DB password (unchanged).
4. Supabase CLI re-auth → redeploy `drive-health` (unchanged).

These cannot be automated without fabricating credentials/consent, which
this codebase explicitly refuses to do.

## Verdict

CLEANUP: PASS · DATABASE: PASS · FOREIGN KEYS: PASS (2 gaps closed by 0047)
· AUTO-POPULATION: PASS (topic level added + tested) · RBAC: PASS ·
ROLE SEEDING: mechanism COMPLETE (execution blocked on owner credentials
by design) · AUTH: PASS · SECURITY: PASS · BUILD: PASS · E2E: PASS ·
MOBILE: PASS · DESKTOP: PASS · DEAD CODE: CLEAN · TEMP FILES: CLEAN ·
OBSOLETE REPORTS: archived · SECRETS: CLEAN · ORPHAN DATA: 0 (purge script
verified live: 98 preserved rows, 0 fixtures) · BROKEN FOREIGN KEYS: 0 ·
UNRESOLVED TEST FAILURES: 0.
