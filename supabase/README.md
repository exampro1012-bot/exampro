# ExamPro — Supabase Backend Reference

Free-first, multi-tenant, examination platform. PostgreSQL is the authoritative database; Auth, Realtime, and Edge Functions complete the platform. No Firebase, no Firestore, no Google Apps Script, no Cloudflare R2.

## 1. Apply the schema (reproducible)
Run migrations in order in the Supabase SQL Editor (or `supabase db push`).
`0001`–`0020`, applied in filename order (renumbered so every version prefix
is unique — required for `db push`):

- `0001_schema.sql` — extensions, enums, all tables, FKs, indexes, generated `search_vector`.
- `0002_helpers.sql` — shared helpers/utilities.
- `0003_rls.sql` — performance indexes, `updated_at` trigger, auto-profile trigger, RLS policies, Realtime publication.
- `0004_functions.sql` — assessment engine, quota, active-pattern lookup, weak-topic detection, question hash.
- `0005_storage.sql` — buckets + storage policies.
- `0006_complete_schema.sql` — remaining tables (question sources, DPP/OMR, institutions, notifications, audit, plans, subscriptions, usage).
- `0007_rls_complete.sql` — RLS for all remaining tables + access helpers (`app_can_read_content`, …).
- `0008_functions.sql` — generators (paper/DPP), snapshots, session finalize.
- `0009_seed.sql` / `0010_seed_core.sql` — platform tenant, exams/subjects/chapters/topics, question types, roles/permissions/grants, plans, `system_config`.
- `0011_security_engine.sql` — hardened engine RPCs, quota gates, audit, verify flow.
- `0012_saas_modules.sql` / `0013_*` / `0014_*` — SaaS modules (institutions/roster, DPP, blueprints).
- `0015_engine_parity.sql` — no-repeat (`exclude_used`), `exclude_paper_ids`, batch import, security events.
- `0016_production_hardening.sql` — verified_at provenance, server-side exam guards, OMR scoring, hardening.
- `0017_demo_seed.sql` — 8 original self-authored demo MCQs (JEE Main), `license_status='DEMO'`, VERIFIED, platform tenant, idempotent.
- `0018_fix_question_usage_tenant.sql` — `question_usage.tenant_id` defaults to the using tenant (no-repeat works for shared platform bank).
- `0019_fix_no_repeat_default.sql` — no-repeat gate no longer NULL-poisoned when `exclude_used` is absent.
- `0020_demo_syllabus.sql` — demo chapters/topics for the JEE Main demo exam + links the 8 demo questions to them (chapter/topic drill, weak-topics, revision work out of the box).

Validate locally: `npm run db:test` (five SQL suites on fresh databases).

## 2. Key tables
- **Identity/tenancy:** `tenants`, `profiles` (Supabase Auth owns credentials), `roles`, `permissions`, `role_permissions`, `tenant_memberships`.
- **Academic master data:** `exams`, `exam_patterns` (scoring lives here, never the frontend), `subjects`, `chapters`, `topics`, `subtopics`, `question_types`, `question_sources`.
- **Question bank (normalized):** `questions`, `question_options`, `question_answers`, `solutions`, `tags`/`question_tags`, `question_usage`, `question_reports`, `question_reviews`, `question_duplicates`.
- **Papers/DPP:** `paper_blueprints`/`blueprint_rules`, `papers`, `paper_questions` (immutable `snapshot` once locked), `dpp_templates`, `dpps`, `dpp_questions`.
- **Exam/results:** `exam_sessions` (server `ends_at`), `exam_assignments`, `submissions`, `responses`, `results` (immutable `snapshot`), `result_details`.
- **OMR:** `omr_templates`, `omr_sheets` (image path only), `omr_responses`.
- **Orgs:** `institutions`, `branches`, `students`, `student_batches`, `enrollments`, `teachers`, `teacher_assignments`, `batches`, `batch_students`, `batch_teachers`, `assignments`.
- **Personalization:** `bookmarks`, `student_notes`, `practice_logs` (user-scoped).
- **Platform:** `notifications`, `audit_logs`, `security_events`, `import_jobs`, `system_config`, `plans`, `subscriptions`, `usage`.

## 3. Multi-tenancy & RLS
- Every tenant record carries `tenant_id`. Access is derived from the caller's `tenant_memberships` (ACTIVE) via `app_user_tenant_ids()` / `app_can_access_tenant()` — **never trust a client-supplied tenant id**.
- Super Admin: `app_is_super_admin()` (server-side membership only).
- Questions: readable by any authenticated user (shared verified PYQ bank); writes require tenant membership. All sensitive tables are strictly scoped.
- `tenant_memberships` grants are server/DB-enforced (policy `with check (app_is_super_admin())`).

## 4. RBAC
Roles (§15): SUPER_ADMIN, PLATFORM_ADMIN, INSTITUTION_ADMIN, ACADEMIC_ADMIN, TEACHER, SUBJECT_TEACHER, PAPER_SETTER, REVIEWER, STUDENT, PARENT, FINANCE, SALES, SUPPORT, DATA_OPERATOR. Permissions (§16) are granted per role in `seed.sql`. Enforcement is in **RLS + Edge Functions**, not only in JS.

## 5. Assessment engine (`app_evaluate_session`)
Server-authoritative scoring using the locked paper `snapshot` (or live answer key). Computes attempted/correct/incorrect/unanswered, marks, negative marks, percentage, accuracy. Result is **immutable** (upsert idempotent; `result_details` rebuilt on re-eval). `app_finalize_session` marks submitted + evaluates — called by the `finalize-exam` Edge Function so the browser timer can never tamper with scoring.

## 6. Edge Functions (service-role only)
| Function | Purpose |
|----------|---------|
| `generate-paper` | Blueprint → eligible pool (tenant + shared platform bank) → balance → select → **fail loudly** if insufficient (returns required/available/missing) → immutable snapshot → free-quota gate → save. |
| `finalize-exam` | Verify ownership, finalize session, evaluate server-side. |
| `generate-report` | Aggregate student/tenant analytics via indexed queries (no full scans). |
| `admin-import` | Chunked, validated, FK-resolved, deduped bulk question import. |
| `send-notification` | Create in-app notification (Realtime delivers it). |

Each reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` from Function secrets and verifies the caller via the user JWT — it never trusts a client tenant id.

## 7. Storage
Large files (question images, PDFs, generated papers, OMR scans, reports) are stored in **Google Drive** via the centralized ExamPro account. PostgreSQL tracks metadata (`storage_objects`, `storage_folders`). Binary files are never stored in PostgreSQL.

## 8. Free-first architecture
- Core works with **no paid service**. AI / payments are optional adapters.
- Free quotas tracked atomically in `usage` (`app_increment_usage` / `app_quota_available`) to avoid races.
- Large question content stays in PostgreSQL metadata + Storage; offline practice caches selected sets in IndexedDB (app shell cached by the service worker). System health screen shows real usage — never claims unlimited free.

## 9. Migrating the question bank
`supabase/import-dataset.mjs` streams the bundled `build/dataset/v1/shards/*.json.gz` into Supabase (resolving exams/subjects/chapters/topics by code, mapping options/answers/solutions, deduping by `question_hash`). Idempotent.
```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/import-dataset.mjs
```

## 10. Testing
- `tests/supabase-migration.spec.ts` — structural: boots without Firebase/Code.gs/R2, no service-role key in client, no boot errors.
- `tests/supabase-e2e.spec.ts` — student (practice → mock → result) and teacher (paper generation) journeys; gated by `SUPABASE_URL` / `SUPABASE_ANON_KEY`.
- `tests/drive-e2e.spec.ts` — Google Drive integration (storage settings, connection test, paper save to Drive).
- Security/RLS tests should be added against a dedicated test project (cross-tenant read/write, role escalation, student-to-student, anonymous access must all fail).
