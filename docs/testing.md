# Testing

Test pyramid (all runnable locally, no cloud required):

1. **UI regression** — mock-Supabase Playwright suite (no backend)
2. **Structural** — static frontend Playwright suite (no backend)
3. **Database** — SQL suites against local PostgreSQL (engine, parity, RLS)
4. **E2E** — live Supabase, env-gated

## 1. UI regression (no backend required)

`tests/exampro-ui.spec.ts` + `tests/mock-supabase.ts` — a mock Supabase HTTP
layer (auth, PostgREST, storage, incl. the CORS `Expose-Headers` that the
Supabase client needs for `Content-Range` counts) serves canned data, so the
full SPA boots, logs in, and every route renders. Covers:

- Setup → login → full role-aware nav.
- **Every registered route** renders with zero page errors / console errors
  (catches async race bugs — e.g. a page writing to a node after the user
  navigated away).
- **Responsive browser matrix** 360×800 → 1920×1080 (360/390/412/768/1024/
  1280/1366/1440/1920): no horizontal overflow, bottom-nav on ≤900px, sidebar
  on >900px, and the sidebar never covers the main content
  (`main.left >= sidebar.right` on desktop).
- Every sidebar/bottom-nav anchor resolves to a registered route; every route
  render is swept for failed HTTP requests (any 4xx/5xx fails the test, except
  the documented PGRST116 "0 rows" signal).
- Feature routes registered (`/questions/import`, `/admin/patterns`,
  `/admin/tenants`, `/admin/security`, `/admin/plans`, `/institution`, …).
- Paper view: printable sheet, solutions toggle, PPTX export, `@media print`
  hides chrome.
- OMR sheet scan upload controls; logout returns to the auth screen.
- **Auth flows**: sign-up provisions a session and lands on the dashboard;
  forgot-password sends the reset email; the reset screen updates the password
  (works because the recovery link arrives with an active session); the
  session persists across a full page reload.
- **Google OAuth**: when the deployment reports Google disabled (probed via
  GoTrue `GET /auth/v1/settings`), the button shows actionable guidance and
  does NOT navigate away; when enabled, it redirects to the authorize
  endpoint; and a redirect-back with `error`/`error_description` params
  surfaces a clear toast instead of a silent bounce to the login form.
- **Drill/revision pages**: chapter practice renders questions with options
  and a working answer reveal; topic practice renders; revision renders
  bookmarked questions with options; weak-topics lists mistakes grouped by
  topic. These pages regressed when they selected non-existent `questions`
  columns — the mock now also fails the walk if a route 400s, and the live
  suite covers chapter drill, weak-topics, and revision end-to-end.

```bash
npm run playwright:install      # once
npm run serve                   # http://localhost:3000 (webServer in config)
npx playwright test tests/exampro-ui.spec.ts
```

- **Exam flow** (start → answer → mark for review → submit → result), question
  review (verify / reject / needs-edit per status), invoice create/print/CSV,
  assignment modal save/close, OMR server-side evaluation score card, system
  health live-RPC badge, language filter on paper generation, results CSV
  export.

The suite runs on both Playwright projects (desktop + mobile profile).

## 2. Structural tests (no backend required)

`tests/supabase-migration.spec.ts` — runs against the static frontend:

- Boots and shows the **Connect your Supabase project** screen.
- No console / page errors on boot.
- No legacy backend dependencies (`firebase`, `code.gs`, `workers.dev`,
  `cloudflare`, `firestore`, …).
- No `service_role` / `supabase_role` secret embedded in the client.
- **No horizontal overflow** at desktop (1280×800) and mobile (390×844).
- Saving config with empty fields is rejected gracefully (toast, no crash).
- (env-gated) entering a real URL + anon key transitions to the auth screen.

```bash
npm run test:structural
```

## 3. Database validation (local PostgreSQL)

Requires a local PostgreSQL (validated on 18). Five suites:

| Suite | File | Verifies |
|---|---|---|
| Engine | `supabase/tests/engine_test2.sql` | paper generation, scoring, finalize |
| Parity | `supabase/tests/engine_parity_test.sql` | no-repeat, exclude_paper_ids, batch import, tenant mgmt, security events |
| Hardening | `supabase/tests/engine_0015_test.sql` | verified_at provenance, app_save_response (marked-for-review, upsert, deadline/submitted guards), security-event logging, OMR server-side scoring (incl. negative marks + numerical answers), language filter, trgm/index/column hardening |
| No-repeat default (0019 regression) | `supabase/tests/engine_0019_test.sql` | without `exclude_used` the generator reuses used questions; with the flag it still excludes |
| RLS | `supabase/tests/rls_isolation_test.sql` | tenant isolation, cross-tenant writes blocked, student-only isolation, FK integrity, quota gate, hash/verify, RPC surface |

```bash
# set your local superuser credentials
export PGPASSWORD=postgres

# fresh databases (migrations + stubs)
psql -h localhost -U postgres -c "drop database if exists exampro_test;"
psql -h localhost -U postgres -c "create database exampro_test;"
psql -h localhost -U postgres -c "drop database if exists exampro_rls;"
psql -h localhost -U postgres -c "create database exampro_rls;"

for db in exampro_test exampro_rls; do
  psql -h localhost -U postgres -d $db -v ON_ERROR_STOP=1 -f supabase/tests/_local_stubs.sql
  for f in supabase/migrations/*.sql; do
    psql -h localhost -U postgres -d $db -v ON_ERROR_STOP=1 -f "$f"
  done
done

psql -h localhost -U postgres -d exampro_test -v ON_ERROR_STOP=1 -f supabase/tests/engine_test2.sql
psql -h localhost -U postgres -d exampro_test -v ON_ERROR_STOP=1 -f supabase/tests/engine_parity_test.sql
psql -h localhost -U postgres -d exampro_test -v ON_ERROR_STOP=1 -f supabase/tests/engine_0015_test.sql
psql -h localhost -U postgres -d exampro_test -v ON_ERROR_STOP=1 -f supabase/tests/engine_0019_test.sql
psql -h localhost -U postgres -d exampro_rls -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation_test.sql
```

Expected ends:

```
GENERATE OK: questions=10 total_marks=40.00
FINALIZE OK: correct=8 incorrect=1 unanswered=1 marks=31.00
ALL ENGINE TESTS PASSED
...
NR: no overlap confirmed
IMPORT RESULT: {"total": 4, ... "imported": 2, "duplicates": 2}
...
OK 1: tenant isolation (A<->B) verified
... OK 7: engine RPC surface present
...
1. verified_at OK
5. language filter OK
2. app_save_response OK
3. app_log_security_event OK
OMR eval: correct=3 incorrect=1 unanswered=1 marks=11 total=20
4. app_evaluate_omr_sheet OK
6. schema hardening OK
ALL 0015 TESTS PASSED
...
A OK: default path reuses (overlap=10)
B OK: flag still excludes (overlap=0)
```

> Suites must run on **fresh databases**: no-repeat generation consumes the
> seeded question pool, and the RLS suite re-provisions its own tenants/users.
> `_local_stubs.sql` provides minimal `auth`/`storage` schemas and the
> `anon`/`authenticated`/`service_role` roles so migrations run on plain
> PostgreSQL. **Local validation only** — never apply stubs to a real project.
> The RLS suite redefines `auth.uid()` per-database to read the `app.test_uid`
> GUC, so run it in its own database (`exampro_rls`).

Everything above (drop/create, stubs, migrations, all suites) is automated:
`npm run db:test` (wraps `scripts/db-test.ps1`; set `PGPASSWORD` or you will be
prompted).

## 4. End-to-end tests (live Supabase required)

`tests/supabase-e2e.spec.ts` / `tests/supabase-exam.spec.ts` /
`tests/supabase-features.spec.ts` are **skipped** unless these env vars are
set:

```bash
export SUPABASE_URL=https://lrktftnalrtvaazaauhj.supabase.co
export SUPABASE_ANON_KEY=eyJ...            # anon / publishable key
export SUPABASE_TEST_EMAIL=qa@example.test # optional
export SUPABASE_TEST_PASSWORD='Exampro@1234' # optional
npm run test:e2e
```

All tests run against the **single production Supabase project**. No separate
test project is required.

Performs (desktop + mobile viewports, serial): connect → sign up/log in →
authenticated shell → create a question → verify → generate paper (server
RPC, JEE Main platform demo pool) → take the exam → server-side scoring →
institution CRUD → OMR template/sheet/evaluation → param routing → storage
upload → chapter drill (demo chapter with options + answer reveal) →
weak-topics (wrong-answer log grouped by topic) → revision (bookmarked
question with options). If email confirmation is enforced, sign-up falls
back to login (disable confirmation for the test project). Validated green
against a hosted project: 22/22 tests.

Notes for a fresh live project:
- Run `0017_demo_seed.sql` so the platform bank has verified questions for
  generation/OMR (the paper forms default to the JEE Main exam).
- `0019_fix_no_repeat_default.sql` is required: without it, used questions
  were excluded even when no-repeat was not requested, and second paper
  generations for the same tenant failed with "Only N verified questions…".
- `0020_demo_syllabus.sql` creates the demo chapters/topics and links the
  demo questions to them — the chapter-drill / weak-topics / revision live
  tests (and the pages themselves) depend on it.

## Test automation

```bash
npx playwright test                 # all suites (env-gated tests auto-skip)
npm run playwright:report           # HTML report of the last run
```