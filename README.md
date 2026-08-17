# ExamPro

Free-first, multi-tenant examination-management SaaS for JEE / NEET / CET and
generic exam prep: **question bank (PYQ + custom), paper generator, DPP,
mock/online exams, OMR, and analytics**.

Backend is **Supabase** (PostgreSQL + Row-Level Security + Auth + Storage +
Realtime). The paper-generation and scoring engine runs **server-side as
PostgreSQL functions** so results are deterministic, tamper-resistant, and
quotas are enforced in the database — not the client.

## Status of this build

- **Database engine: verified.** All migrations (`supabase/migrations/0001`–
  `0020`) apply cleanly to PostgreSQL 18 (and to a hosted Supabase project),
  and five SQL suites pass on fresh databases:
  - `engine_test2.sql` — generation, scoring, finalize, idempotency;
  - `engine_parity_test.sql` — no-repeat generation, exclude_paper_ids,
    batch question import (taxonomy + dedupe), tenant management RPCs,
    security-events read;
  - `engine_0015_test.sql` — verified_at provenance, marked-for-review
    persistence + server-side exam guards, security-event logging, OMR
    server-side scoring (negative marks, numerical answers, idempotent
    re-eval), multilingual language filter, index/column hardening;
  - `engine_0019_test.sql` — regression: the no-repeat default path reuses
    used questions (0019 fix) while the explicit `exclude_used` flag still
    excludes;
  - `rls_isolation_test.sql` — tenant isolation, cross-tenant write denial,
    student-only isolation, FK integrity, server-side quota gate, hash
    maintenance + verify flow, RPC surface (7 checks).
- **Demo seed (clearly labelled).** `0017_demo_seed.sql` inserts eight
  original, self-authored, textbook-level MCQs (Physics/ Chemistry/
  Mathematics on JEE Main) owned by the platform tenant, marked
  `license_status='DEMO'`, `source='ExamPro Synthetic QA Set'`,
  `VERIFIED`+`verified_at` — so paper generation/OMR/demo flows have a
  lawful pool out of the box. Fixed ids, idempotent. `0020_demo_syllabus.sql`
  adds the matching demo chapters/topics and links the eight demo questions
  to them, so chapter/topic drill, weak-topics, and revision work
  immediately on a fresh project.
- **Frontend: rebuilt as a real Supabase SPA** (`index.html` + `src/app.js`,
  `src/shell.js`, `src/pages.js`, `src/vendor/supabase.js`). It boots to a
  "Connect your Supabase project" screen, then Auth, then a responsive
  shell. Two Playwright suites verify it without any backend:
  - `tests/exampro-ui.spec.ts` (mock-Supabase HTTP layer) — logs in, walks
    **every** route with zero page/console errors, checks the responsive
    browser matrix 360–1920 for overflow, nav-link integrity, print CSS,
    and the feature pages (import, admin patterns/tenants/security/plans,
    institution dashboard, OMR scan upload + server-side evaluation, PPTX
    export, full exam flow with mark-for-review, question review decisions,
    invoices/print/CSV, assignments, system-health badge).
  - `tests/supabase-migration.spec.ts` — boot, no console errors, no
    legacy dependencies, no embedded secrets, no overflow.
- **Full end-to-end (live Auth + CRUD + RLS) is env-gated** and requires a
  real Supabase project URL + anon key (see `docs/testing.md`). Provide
  `SUPABASE_URL` / `SUPABASE_ANON_KEY` to run it — validated green against
  a hosted project (desktop + mobile).
- **OAuth + drill pages hardened.** Chapter/topic practice, revision, and
  weak-topics previously selected non-existent `questions` columns
  (`marks`/`options`/`answer`) and broke against a real PostgREST backend
  (masked by the shallow mock). They now fetch `question_options` /
  `question_answers` explicitly and are covered by mock AND live E2E.
  Google sign-in probes GoTrue `/settings` first: a disabled provider shows
  actionable guidance instead of a dead redirect, and OAuth callback
  failures (cancelled/denied) surface as a clear toast instead of a silent
  bounce back to the login form. OMR sheets print with tenant branding.

## Quick start

```bash
# 1. Point the app at your Supabase project
#    Open the app, paste Project URL + anon key in the connect screen
#    (stored only in this browser), OR set window.EXAMPRO_CONFIG / localStorage.

# 2. Apply the database
#    In the Supabase dashboard SQL editor, run migrations in order:
#    supabase/migrations/0001_schema.sql ... 0046_storage_policy_and_omr_template.sql
#    (+ 9001_live_fix_current_tenant.sql)

# 3. (optional) Validate the engine + RLS locally against PostgreSQL
#    See docs/testing.md -> "Database validation (local PostgreSQL)".

# 4. Serve the frontend
npm run serve        # http://localhost:3000
```

## Project layout

```
index.html                  # app entry (loads vendored supabase-js + src/*)
src/vendor/supabase.js      # @supabase/supabase-js (UMD, vendored offline)
src/app.js                  # config, supabase client, auth, identity, router, utils
src/shell.js                # setup screen, auth screen, responsive shell
src/pages.js                # all routes (dashboard, questions, papers, dpp,
                            #   exams, results, analytics, admin, settings)
supabase/migrations/        # 0001..0046 + 9001 (schema, RLS, functions, engine,
                            #   hardening, Drive storage, ingestion, patterns)
supabase/functions/         # 18 Edge Functions (Drive OAuth + core, JWT-gated)
supabase/tests/             # engine, parity, and RLS integration suites (SQL)
tests/                      # Playwright: UI-regression (mock backend) +
                            #   structural (no backend) + e2e (env-gated)
manifest.json, sw.js        # PWA (offline app-shell)
```

## Documentation

All documentation lives in `docs/`:

- `docs/architecture.md` — components, data flow, multi-tenancy.
- `docs/database.md` — schema, the paper-generation/scoring engine, quotas.
- `docs/rbac.md` — auth, auto-provisioned workspace tenant, roles & permissions.
- `docs/ingestion.md` — ingestion pipeline, job states, storage gate.
- `docs/exam-patterns.md` — pattern engine, versioning, verified 2026 patterns.
- `docs/paper-generator.md` — server-authoritative paper generation.
- `docs/dpp-generator.md` — DPP generation and assignment lifecycle.
- `docs/omr.md` — OMR templates, sheets, detection, evaluation.
- `docs/google-drive.md` — Drive storage architecture and setup.
- `docs/oauth.md` — Google OAuth setup.
- `docs/security.md` — RLS, secrets, client hardening.
- `docs/deployment.md` — hosting, migrations, environment.
- `docs/testing.md` — how to run structural + e2e tests and the local engine check.
- `docs/configuration.md` — app configuration reference.
- `docs/production-checklist.md` — go-live gates.

Historical engineering reports are archived under `docs/archive/` (not part
of current documentation). Current audit reports at the root:
`FINAL-EXAMPRO-E2E-AUDIT.md`, `FINAL-CODEBASE-CLEANUP-REPORT.md`.
