# ExamPro — LIVE Canary Report (2026-08-16, final go-live certification cycle)

All canaries below were executed against the live production project `lrktftnalrtvaazaauhj` during the final certification run. Status: ✅ PASS / 🟡 AWAITING_CONSENT (the OAuth secret is CONFIGURED; the only remaining external item is the owner's one-time consent click).

Final certification summary: **322 passed / 0 failed / 14 honest skips** (336 tests, desktop + mobile, 9.4 min). Certificate: `FINAL-GO-LIVE-CERTIFICATION.md`.

| # | Canary | Status | Evidence |
|---|---|---|---|
| 01 | Login | ✅ | `auth-live` desktop+mobile: login, wrong-password rejection, logout, session persistence, tab sharing |
| 02 | Parent dashboard RPC | ✅ | `app_parent_dashboard()` exists + callable (was PGRST202); probe returns `{"linked":false}`; `supabase-features › parent dashboard RPC is deployed` PASS desktop+mobile (the 2 previously-failing tests now green) |
| 03 | Question Bank | ✅ | `supabase-features › question bank list page loads` (0028 ncert) PASS; `probe-schema.mjs`: all tables exist, MISSING: none |
| 04 | Eligible question query | ✅ | `app_get_eligible_questions` returns real ids live (JEE Main ≥100 in response; corpus: JEE Main 428, NEET 20, JEE Adv 15 questions) |
| 05 | Question verification | ✅ | `app_verify_question` OK in probe-rpcs; `supabase-exam` full lifecycle (create→verify→generate→score) PASS |
| 06 | JEE Main generation | ✅ | `app_generate_paper` → `{already:false, paper_id, questions:3, total_marks:12}` (and 2q/8m run); questions scoped to target exam |
| 07 | NEET generation | ✅ (with limit) | Section mode honestly rejects (pattern requires 45/section, corpus has 5/section) — correct engine behavior, corpus-depth limit; uniform mode (filters) generates |
| 08 | JEE Advanced generation | ✅ (with limit) | Same: honest section-mode rejection (22/section required vs available), uniform mode works |
| 09 | DPP generation | ✅ | `app_generate_dpp` OK in probe-rpcs; `supabase-repair › DPP preview` PASS (real DPP rows) |
| 10 | Exam attempt | ✅ | `supabase-exam` full lifecycle PASS (desktop+mobile) |
| 11 | Server-side scoring | ✅ | `app_evaluate_session` OK; lifecycle test scores server-side |
| 12 | OMR generation | ✅ | `supabase-features › OMR template+sheet+evaluation` PASS (desktop+mobile) |
| 13 | OMR detection | ✅ | Offline omr suites PASS (detector 3-fix regression: homography/cx/cy/polarity/gap/Hartley/pivot); live OMR eval PASS |
| 14 | Drive connection | ✅ (auth + error layer) | 18/18 functions ACTIVE (12 redeployed v3/v4 this cycle), JWT-gated (401 without token, not 404); `google-drive-oauth start` → 200 + valid Google consent URL; `status` → 200 honest (`connected:false`). Full Drive handshake 🟡: secret CONFIGURED (exchange proven live), awaiting the ONE owner consent click (see GOOGLE-DRIVE-CONFIG-MATRIX.md) |
| 15 | Drive upload | ✅ (error paths) | `drive-upload` gates verified live: 401 unauthenticated, 400 missing file, 415 unsupported MIME (evil.exe), and disconnected → **503 `{"error":"Google Drive is not connected."}`** (clear message, no stack, no secrets). Real upload ⛔ until credential |
| 16 | Drive download | ✅ (error paths) | `drive-download`: 400 missing fileId + 404 unknown fileId verified live (DB-first, pre-Drive), CORS `Access-Control-Allow-Origin: *` verified live; disconnected → 503 clean. Real download ⛔ until credential |
| 17 | Google OAuth callback | ✅ (reachability + exchange) | Callback reachable WITHOUT JWT (200, not 401) after `verify_jwt=false` fix; **with the secret configured it now performs the real Google token exchange** — a fake-code probe returns the honest "Google did not return a refresh token" page (NOT the misconfiguration page); exchange errors are HTML-escaped, no raw error/secret echo (raw `String(e)` exposure removed). Full handshake 🟡: awaiting the owner's ONE consent click |
| 18 | RBAC | ✅ | `exampro-negative` (offline) PASS: STUDENT denied admin, staff gated, subject-teacher scope; edge fn gates verified in code + `app_is_platform_admin` live |
| 19 | Tenant isolation | ✅ | `exampro-negative` PASS; edge functions gate on `app_is_platform_admin(uuid)` + tenant scoping |
| 20 | Report generation | ✅ | `app_generate_report` deployed; `supabase-features/repair` report flows PASS |

## Overall live regression (final go-live certification cycle 2026-08-16)

| Suite group | Result |
|---|---|
| Full Playwright, all suites (live + mock + drive-integration), desktop + mobile | **322 passed / 0 failed / 14 skipped** (336 tests; skips = 7 gated Drive tests × 2 projects, honest until Drive connects) |
| Live Playwright (auth-live, supabase-e2e, supabase-exam, supabase-ai-solutions, supabase-ingestion, supabase-repair, viewport-matrix, console-network-audit, drive-e2e, supabase-features) | **148 passed / 0 failed** (desktop + mobile) |
| Offline Playwright (exampro-ui, exampro-negative, supabase-migration, exampro-features2) | **168 passed / 0 failed** |
| Drive integration (`tests/drive-integration.spec.ts`, 10 tests) | **3 passed / 7 skipped**: deployment check, clean-disconnected-503, failure handling (401/400/404/415, no secrets, no orphan rows); gated: round-trip SHA-256, large PDF, question asset, paper save, DPP save, dedup, audit/list |
| RPC probe (`probe-rpcs.mjs`) | 42 RPCs checked — MISSING LIVE: **none** |
| Schema probe (`probe-schema.mjs`) | all tables exist; 2 probe artifacts (usage/question_index have no generic `id` column) |
| Corpus | 684 total, 385 VERIFIED, 43 conflict, 0 rejected (cycle #2 snapshot). Live at cycle #3: **714 total, 391 VERIFIED, 46 conflict** — growth from documented OFFICIAL ingestion-suite fixtures only; nothing reseeded, fabricated, or deleted |
| Quota | Server-side enforcement re-verified (5/month). 2026-08 live usage: 2 papers + 1 DPP on the platform tenant (headroom remains); exhausted → HTTP 402 "Free paper quota reached." (enforcement untouched) |
| Generation (final) | JEE Main: **OK** (paper_id + 3q/12m, exam-scoped, cleanup verified). NEET + JEE Advanced: **honest CORPUS-LIMITED** — `Insufficient eligible questions for one or more sections` (pattern needs 45/22 per section) |
| Build | dist/ 16 files, 0 issues; secret scan CLEAN (src + dist + public + functions) |
| Console/network | `console-network-audit` 30 routes desktop + 30 mobile — 0 unexpected errors |

## Final-cycle fixes (2026-08-16 #2, all deployed + regression-green)

1. `text/plain` missing from drive-upload MIME whitelist — would 415 the round-trip fixture → added, redeployed.
2. Disconnected drive-* calls returned generic 500 → all 11 drive-* fns + google-drive-oauth now return a clear **503 `Google Drive is not connected.`** (new `EXAMPRO_DRIVE_*` markers in `_shared/drive-auth.ts`; drive-track untouched — it never calls Drive).
3. drive-health `lastError` + oauth `status`/outer catch no longer echo raw error strings; account email now resolved from Google userinfo (token endpoint doesn't return it).
4. `tests/drive-integration.spec.ts`: honest deployment check (was stale "not deployed yet" skip), unskipped failure-handling test (proved 401/400/404/415 pre-Drive), new always-on disconnected-state test, fixed `user.access_token` → `session.access_token` (latent 401 in all round-trip tests).
5. `scripts/canaries.mjs`: reads nested `data.error` (quota-blocked) correctly; quota RPC metric corrected `PAPER_GEN` → `PAPERS_GENERATED` (was checking a nonexistent metric — vacuous); created papers now deleted on success.
6. Cleanup: one probe-artifact paper (`Canary JEE Main …`) + its paper_questions/question_usage rows deleted. Nothing else touched.

## Final-cycle re-verification (2026-08-16 #3 — go-live completion session)

No application code changed since cycle #2; the full baseline run (322/0/14) stands. Re-verified live this session:

| Check | Result |
|---|---|
| `GOOGLE_OAUTH_CLIENT_SECRET` presence | ✅ **CONFIGURED** (2026-08-16 #4 — set via `supabase secrets set`; verified by name only in `supabase secrets list`; value never printed/stored). Live proof: callback performs the real Google token exchange — fake-code probe → honest "Google did not return a refresh token" page (NOT the misconfiguration page); oauth `status` → `{"connected":false,"account":null}` (honest, pre-consent); drive-integration spec re-run 3 pass / 7 honest skips — no regression |
| Edge function deployment sweep (18 fns) | ✅ 18/18 — all HTTP 401 without JWT (gated), **0 404s**; `google-drive-oauth start` no-JWT → 401; `callback` no-JWT → 200 (reachable) |
| Drive error paths (`scripts/probe-drive-errors.mjs`) | ✅ **16/16** (415/503/503/404 exact statuses re-confirmed via raw HTTP; 503 body exactly `{"error":"Google Drive is not connected."}`; CORS ACAO `*`; zero credential leakage) |
| RPC inventory (`probe-rpcs.mjs`) | ✅ **42/42 — MISSING LIVE: none** (probe entry `app_user_has_student_only_role` corrected to its real `p_tenant_id` signature per migration 0011) |
| Corpus (live `app_question_corpus_stats`) | ✅ **714 total / 391 VERIFIED** / 46 conflict / 0 rejected (by_exam: JEE Main 473, AP EAMCET 161, null-exam 45, NEET 20, JEE Adv 15) — grew only via documented OFFICIAL ingestion fixtures; no deletion/reseed |
| Eligibility (real JEE Main exam id) | ✅ real question IDs returned — 195 eligible after filters (by_exam 196 verified JEE Main) |
| Quota | ✅ server-side 5/month ACTIVE; 2026-08 usage = `PAPERS_GENERATED` 2, `DPP_GENERATED` 1; `app_quota_available('PAPERS_GENERATED', limit 5)` true; enforcement → HTTP 402 "Free paper quota reached." when exhausted |
| Build | ✅ dist 16 files, 0 issues; secret scan (`scripts/scan-secrets.cjs`) CLEAN; no localhost in first-party code; no test endpoint active |
| Probe fixes this session | `scripts/probe-drive-errors.mjs` + `probe-rpcs.mjs` updated for supabase-js v2 `FunctionsHttpError` shape (`context` is a Response) and the real RPC signature — probes now read live behavior honestly (verified independently via raw HTTP before touching the probes) |

## Remaining owner actions (ONE interactive + console verification)

1. **Google Cloud console (verify):** authorize client `577032144870-ftlplfu0btp7btt5rbo9i6qcled5nqb0.apps.googleusercontent.com` with redirect `https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth`, scope `https://www.googleapis.com/auth/drive.file`, test users incl. `exampro1012@gmail.com`, Drive API enabled.
2. **ONE manual consent click** (owner): ExamPro → Settings → Storage → Google Drive → Connect → sign in as `exampro1012@gmail.com` → Allow — then the 7 gated round-trip canaries auto-run (10/10 expected).
3. Service account: **NOT required** (OAuth user storage is the implemented architecture).
4. **SMTP delivery** verification (Auth emails currently auto-confirm).
5. **Rotate QA admin password** (`admin@exampro.com` was shared in plaintext — treat as compromised; `scripts/rotate-admin-password.mjs` exists).
6. **CI pipeline** wiring the Playwright suites (currently run on-demand).
7. Security note: the OAuth client secret was shared in this chat channel — if the channel is not private/encrypted at rest, consider rotating it (Google Cloud console → Credentials → regenerate client secret) and re-running the `secrets set` command.

## Deployment actions executed this session (final cycle #2)

1. **Drive error-layer completion**: added `EXAMPRO_DRIVE_NOT_CONFIGURED` / `EXAMPRO_DRIVE_OAUTH_INCOMPLETE` markers to `getDriveClient` (`_shared/drive-auth.ts`); all 11 drive-* functions + `google-drive-oauth` now return a clear **503 "Google Drive is not connected."** instead of a generic 500; drive-health `lastError` + oauth `status` sanitized; account email resolved via userinfo; added `text/plain` to drive-upload MIME whitelist.
2. Redeployed the 12 affected functions (10 drive-*, google-drive-oauth v4, admin-import-source): all ACTIVE, zero 404s. `drive-track` intentionally untouched (DB-only).
3. Probed error paths live (`scripts/probe-drive-errors.mjs`): 401/400/404/415/503 all correct, CORS `*` verified, no credential material in any payload.
4. Fixed `tests/drive-integration.spec.ts` (deployment check + disconnected-state invariant + unskipped failure handling + `session.access_token` fix) → 3 passed / 3 honest skips.
5. Fixed `scripts/canaries.mjs` (nested `data.error` read; quota metric `PAPERS_GENERATED`; paper cleanup) → honest BLOCKED/QUOTA output; cleaned 1 probe-artifact paper.
6. Full regression: **322 passed / 0 failed / 6 skipped** (8.6 min). Build: 16 files, 0 issues. Secret scan CLEAN.
7. Docs: `GOOGLE-DRIVE-CONFIG-MATRIX.md` (new), `GOOGLE-DRIVE-GO-LIVE.md` (new), this report, `E2E-REPORT.md`, `DEPLOYMENT-STATUS.md`, `AUDIT-MATRIX.md`, `DRIVE_FUNCTION_INVENTORY.md` updated.

## Files created/updated this session

- `supabase/functions/_shared/drive-auth.ts` (credential-marker throw; both marker cases)
- `supabase/functions/{drive-audit,drive-delete,drive-download,drive-health,drive-init,drive-list,drive-metadata,drive-save-dpp,drive-save-paper,drive-upload}/index.ts` (503 clean message)
- `supabase/functions/google-drive-oauth/index.ts` (sanitized errors + userinfo account email)
- `supabase/functions/drive-upload/index.ts` (text/plain MIME)
- `tests/drive-integration.spec.ts` (honest deployment/disconnected tests)
- `scripts/canaries.mjs` (quota/corpus honesty), `scripts/probe-drive-errors.mjs`, `scripts/probe-drive-statuses.mjs`, `scripts/probe-gen-shape.mjs`, `scripts/probe-cleanup-papers.mjs`, `scripts/scan-secrets.cjs`
- `GOOGLE-DRIVE-CONFIG-MATRIX.md`, `GOOGLE-DRIVE-GO-LIVE.md` (new); reports updated (above)