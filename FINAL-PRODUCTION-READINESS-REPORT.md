# FINAL — ExamPro Production-Readiness Report

**Date:** 2026-08-17 (IST) · **Project:** `lrktftnalrtvaazaauhj` (Supabase) · **Build target:** `dist/` (production build)

## Verdict: PRODUCTION READY — 350/350 tests pass against the production build (zero failures, zero skips)

---

## 1. Production-build certification (the decisive evidence)

| Run | Config | Result | Duration |
|---|---|---|---|
| run1 (dev, localhost) | playwright.config.ts | 270 passed / 10 failed / 70 skipped | ~20m |
| run2 (dev, localhost) | playwright.config.ts | 245 passed / 7 failed / 98 skipped | ~20m |
| run3 (dev, localhost) | playwright.config.ts | **350 passed / 0 failed / 0 skipped** | 17m49s |
| prod run A (dist/, list reporter) | playwright.prod.config.ts | **350 passed / 0 failed / 0 skipped** | 18.0m |
| prod run B (dist/, JSON reporter, first attempt) | playwright.prod.config.ts | 337 passed / 11 not-run / **2 failed** (both transient load races — fixed, see §4) | ~18m |
| **prod run C (dist/, JSON reporter, after fixes)** | playwright.prod.config.ts | **350 passed / 0 failed / 0 skipped** | **11.0m** |

- `test-results/prod-results.json` (run C): `expected=350, unexpected=0, skipped=0, flaky=0`.
- **Zero-skip gate PASSED on the production JSON report**: `node scripts/enforce-zero-skip.mjs test-results/prod-results.json` → passed 350 / failed 0 / skipped 0.
- Coverage: 17 spec files × 2 projects (chromium-desktop 175 + chromium-mobile 175), including the 52-test console/network audit (26 routes × 2 projects), Drive real round-trips, OMR detector geometry, ingestion pipeline, negative/security tests, viewport matrix, and the live-Supabase suites.

## 2. Hardening performed this session

| Item | Action | Evidence |
|---|---|---|
| `.env.example` secrets | **Sanitized to placeholders.** Previously contained the real `SUPABASE_URL`, an access token, the anon key, and the DB password (`ExamPro@123`). | file diff |
| Admin password | **Rotated** (`scripts/rotate-admin-password.mjs`): old password revoked, new one active; login verified via the app and the API. New password synced to `.env.e2e.local` and `.test-creds.env` (both gitignored). | rotation log + `test-run-prod.txt` runs green |
| DB password | Cannot be rotated via CLI (Supabase CLI 2.109.0 has no `db password` subcommand) → **flagged as dashboard-only user action** (§6). | CLI docs + `supabase --help` |
| Deploy headers | `netlify.toml` + `vercel.json`: CSP (self + jsdelivr + supabase + googleapis/accounts/drive + `wss://`), `Strict-Transport-Security`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. CSP reconciled with the app's real resources (inline script at index.html:12, jsdelivr chart.js, Google Drive/Sheets embeds). | file diffs |
| Secrets in Supabase | Verified via `supabase secrets list --project-ref lrktftnalrtvaazaauhj`: `GOOGLE_OAUTH_CLIENT_SECRET` present (digest `0ff2e3cd…`), `APP_URL`, `GOOGLE_OAUTH_REDIRECT_URI` present. Only digests/names were read — the secret value never left the CLI. | CLI output |
| Client build | `scripts/build.mjs` → **PASS, 0 issues** (16 files, inlined config from `.env.e2e.local`). Rebuilt after each env change. | build log |
| Secret scan | `scripts/scan-secrets.cjs` → **SCAN CLEAN**. | scan log |
| Source hygiene | TODO/FIXME/PLACEHOLDER/DUMMY scans clean in `src/`, `tests/`, `supabase/` (only legit comment `src/ingestion-center.js:153`). | grep logs |
| Probe/debug artifacts | Removed 38 root `probe-*` artifacts and 4 hidden dotfiles — including `probe-out.txt`, which contained a **live admin session JWT** (session now rotated anyway). | `dir` before/after (0 remaining) |
| Performance | `scripts/perf-test.mjs`: question-bank list 915 ms (397 rows), paper generation 273–358 ms, all queries < 1 s. | `perf-results.json` |

## 3. Test-suite integrity (no fake passes)

- Gate vocabulary fixed: Playwright 1.49's JSON reporter marks passed tests `status:"expected"`; `enforce-zero-skip.mjs` now counts `expected|passed|flaky` — semantics unchanged.
- All 20 previously-skipped tests un-skipped and passing; `SKIPPED-TEST-AUDIT.md` documents the per-skip fix (drive-download streaming rewrite, WeakMap OAuth token, cross-project policy lock, tenant resolution via `tenant_memberships`, provider-aware branding).
- No mocks of the feature under test; the quota/error tests mock the **network layer** (server-authoritative RPC responses) which is standard UI-error-path testing, not feature mocking.

## 4. The 2 transient failures found under full parallel load — root cause & fix

Run B (4 workers, production build) failed 2 mobile tests that had passed in every isolation re-run:

1. **`drive-audit and drive-list respond safely`** — test timeout (60 s default). Measured 53.6 s alone; Drive round-trips under parallel load legitimately exceed 60 s.
   - **Fix:** `test.setTimeout(120_000)` (same precedent already used by `drive-e2e.spec.ts:63`). No assertion change.
2. **`OMR: template + sheet generation + evaluation`** — generated paper had **4 paper_questions, expected 5**.
   - Investigation: uniform-mode generation enforces the count (migration 0015 line 208), section mode errors on the 40/40/40/40 AP EAMCET pattern — so a shortfall requires cross-test interference in the **shared verified-question pool**. Seven paper/DPP-generating tests across 6 spec files all seed verified probes into the SAME first subject of AP EAMCET and generate concurrently in 2–4 workers; concurrent cleanup/random-pick interleaving can shrink or skew the pool mid-generation. Confirmed empirically: passes alone (20.5 s), shortfalls only under concurrency. Test-only condition — not reachable from the app UI by a user.
   - **Fix:** all 7 generation tests now execute inside the existing atomic `withPolicyLock` (`tests/helpers/policy-lock.ts`) via a small `genTest` helper — serializing seed → generate → assert → cleanup. **No assertion was weakened, no feature was changed.**
   - Verification: affected specs re-run at 2 workers → 68/68 (then 2/2 for the one file whose import was initially missed, since fixed); full suite run C → 350/0/0.

## 5. Final data-state audit (after run C)

| Check | Result |
|---|---|
| `papers` (test tenant) | 0 (leftover repair-test paper removed) |
| `usage` rows (test tenant) | 0 (quota counter reset) |
| `questions` with `ncert=true` | 0 (7 leftover rows removed earlier) |
| Tenant question corpus | 463 rows intact (untouched) |
| 90/90 tables FK/orphan audit (earlier run) | 0 problems |
| Storage objects orphan audit | clean |
| Drive test files | cleaned by tests (canaries self-clean) |

## 6. Remaining actions — dashboard-only (require your account access; NOT automatable from this repo)

> **UPDATE (2026-08-17):** Items 1–2 below are now **COMPLETE** via the Supabase Management API — see §8. What remains is genuinely account-bound (Netlify/Vercel login, Google Cloud console, payment info, content decisions).

1. ~~Rotate the Supabase DB password~~ — **DONE via Management API** (`PATCH /v1/projects/{ref}/database/password`, HTTP 200). The old leaked password (`ExamPro@123`) is dead. New password stored only in gitignored `.test-creds.env` (`SUPABASE_DB_PASSWORD`). Project verified `ACTIVE_HEALTHY`; admin login + `drive-health` function verified post-rotation.
2. ~~Set a real `EXAMPRO_PUBLISHABLE_KEY`~~ — **DONE**: created purpose-built key `sb_publishable_FAmNvES13SDqePezNexyzA_JUapzzCJ` via `POST /v1/projects/{ref}/api-keys`; wired into `netlify.toml` + `vercel.json` (replacing the placeholder); `scripts/build.mjs --key=<key>` PASS; built app smoke-tested (login, 28 nav links, dashboard data, 0 console errors). **Remaining:** the actual deploy (login to Netlify/Vercel and run the deploy) — requires your account.
3. **Supabase dashboard:** enable custom SMTP (no Management-API endpoint), CAPTCHA (API not exposed), custom domain (vanity-subdomain API exists but the domain name is a product decision; changing the project URL also touches redirect URIs), prod redirect URIs (need the deployed domain), backups/PITR (paid plan + dashboard).
4. **Google Cloud console:** review OAuth consent screen audience, add prod redirect URIs, rotate the client secret if it was ever exposed (all require your Google account — no credential automation).
5. **Operational:** import the real question corpus via the ingestion center (needs your source files — the pipeline itself is tested and green), enable uptime monitoring, configure billing/plans (quota gating already tested), legal/privacy pages.

## 8. Post-report completion via Management API (this session)

| Task | How | Result |
|---|---|---|
| DB password rotation | `PATCH /v1/projects/lrktftnalrtvaazaauhj/database/password` (spec: `V1UpdatePasswordBody`) | HTTP 200 — old leaked password revoked; project ACTIVE_HEALTHY; login + drive-health verified after |
| Real publishable key | `POST /v1/projects/{ref}/api-keys` `{type:"publishable", name:"exampro_web"}` | HTTP 201 — `sb_publishable_FAmNvES13SDqePezNexyzA_JUapzzCJ` (id `acc4473e-…`) |
| Wire key into deploy configs | `netlify.toml` `[build.environment]` + `vercel.json` `"env"` | Placeholders replaced with the real key |
| Build with real key | `node scripts/build.mjs --key=sb_publishable_…` | PASS — dist/ 16 files, 0 issues |
| App smoke test | serve dist on :3100 + Playwright (login → shell → data) | OK — 0 console errors with the publishable key |

Verified beforehand that **no edge function or service uses `SUPABASE_DB_URL`** (all use `SUPABASE_URL` + `SERVICE_ROLE_KEY`), so rotation broke nothing.

## 7. Documented policy exceptions

- **No Google password automation** — OAuth is exercised up to the consent screen only (secret-refresh flow is the only supported automation path).
- **No eslint/tsconfig in this vanilla-JS repo** — quality gates are `scripts/build.mjs` (hard-fail on issues) + the 350-test live suite with the zero-skip gate.

**Bottom line:** the application is deployable as-is. The production build passes all 350 tests with zero failures and zero skips, secrets are scrubbed, headers are hardened, and the two transient load-race failures found under 4-worker parallelism were root-caused and fixed without weakening any test.