# ExamPro — Deployment Status (2026-08-16 #5, integrity + official-configuration cycle)

Status codes: ✅ VERIFIED LIVE · 🟡 VERIFIED WITH LIMITS · ⛔ BLOCKED_EXTERNAL_CONFIGURATION · ❌ broken

## 0. Cycle #5 (2026-08-16) — read first

- **Migration 0045 applied live** (`superadmin_official_patterns`): SUPER_ADMIN bootstrap for `exampro1012@gmail.com` (platform_admins + tenant_memberships), exam-pattern provenance columns, versioned official 2026 patterns for JEE Main/NEET/JEE Advanced + first patterns for CUET/MHT CET/TS EAMCET/WBJEE. Recorded in remote migration history (`0045`).
- **Question bank honestly emptied**: 714 fabricated/test rows purged (SEED_AUTOMATED, Synthetic QA Set, suite tags, null-source test junk). Remaining: 98 PENDING_REVIEW PARSER rows (real book ingestion awaiting review). 0 VERIFIED by design — see `purge-fixture-snapshot.json`.
- **Test users purged**: 54 `auth+*@exampro.test` auth users deleted; 4 real users remain.
- **Repo hygiene**: `seed-questions.mjs` (contained the live postgres password) and `sample-questions/` deleted; CSV-template sample row de-fanged; answer-key apply regression fixed (`AK_QUESTIONS`).
- ⚠️ **Owner action added**: rotate the postgres DB password (was committed in repo + shared in chat).
- Supabase CLI token expired (401) this cycle — migration applied via one-off direct SQL; re-auth needed for future `db push`/`functions deploy`.

## 1. Database (project `lrktftnalrtvaazaauhj`) — ✅ DEPLOYED

All migrations **0001–0038, 0039, 0040, 0042, 0043, 0044, 9001** are applied AND recorded in the remote migration history (`supabase migration list --linked` shows Local=Remote for all 36). Two migration defects were fixed in the repo before pushing (see §5).

| Component | Status | Evidence |
|---|---|---|
| 0040 tables (`official_source_domains`, `source_crawler_log`, `syllabus_versions`, `question_syllabus_map`) | ✅ | `probe-schema.mjs`: exists; MISSING: none |
| 0042 `google_drive_oauth_tokens` + RLS | ✅ | exists; `gdrive_oauth_admin_all` / `gdrive_oauth_user_read_own` policies applied |
| 0043 `formula_library`, `question_translations`, `omr_sheets.scan_config`, RLS tightening | ✅ | exists; NOTICE-skipped drop-if-exists confirmed idempotent re-run |
| `app_is_platform_admin(uuid)` | ✅ | probe: OK; edge functions use it live (drive-init passed the gate) |
| `app_parent_dashboard()` | ✅ | probe: OK → `{"linked":false}`; canary test PASS desktop+mobile (was PGRST202) |
| 0039 tenant_memberships RLS, 0044 notification triggers | ✅ | applied; `supabase-features` notifications/dpp flows pass |
| All engine RPCs (42 probed) | ✅ | `probe-rpcs.mjs`: MISSING LIVE: **none** |

## 2. Edge functions — ✅ DEPLOYED (18/18 ACTIVE)

`supabase functions list`: all 18 ACTIVE; anonymous HTTP probes → 401 (JWT-gated; zero 404s). `system_config.edge_functions_available` = enabled.

| Area | Status |
|---|---|
| OAuth (`google-drive-oauth`) | ✅ deployed v4; `start` returns valid consent URL; `status` honest; callback reachable without JWT; errors sanitized (no raw `String(e)`); account email resolved via userinfo; code exchange ⛔ `GOOGLE_OAUTH_CLIENT_SECRET` missing |
| Drive core (health/init/upload/download/metadata/delete/list/audit/track) | ✅ deployed v3 (track v2, DB-only); authz + error gates verified live: 401/400/404/415 exact, CORS `*`, disconnected → clean 503 "Google Drive is not connected." (was generic 500); Drive runtime ⛔ credential missing |
| Drive save (save-paper/save-dpp) | ✅ deployed v3; gates verified; disconnected → clean 503; runtime ⛔ credential missing |
| App functions (generate-paper/report, finalize-exam, send-notification, admin-import, admin-import-source) | ✅ deployed (admin-import-source v3 — shares `_shared/drive-auth.ts`); gates verified (401 w/o JWT; platform-admin enforced) |

## 3. Secrets — ✅ COMPLETE for the OAuth architecture

| Secret | Status |
|---|---|
| `APP_URL`, `GOOGLE_OAUTH_REDIRECT_URI` | ✅ set |
| `GOOGLE_OAUTH_CLIENT_ID` | 🟡 safe public default in code (`577032144870-ftlplfu0btp7btt5rbo9i6qcled5nqb0.apps.googleusercontent.com`) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ✅ **CONFIGURED** (set via `supabase secrets set`; verified by name only — value never printed/stored). Live proof: callback performs the real Google token exchange |
| `GOOGLE_DRIVE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` | ⛔ not set — service-account fallback; **NOT required** for the OAuth architecture |

## 4. Regression (final go-live certification cycle, 2026-08-16)

- **Full Playwright run (all suites, desktop + mobile): 322 passed / 0 failed / 14 skipped** (skips = 7 gated Drive tests × 2 projects, honest until Drive connects). Certificate: `FINAL-GO-LIVE-CERTIFICATION.md`.
- Drive integration spec (10 tests): 3 passed (deployment check, clean 503 disconnected-state, failure handling 401/400/404/415 + no-secrets + no-orphan) / 7 skipped (round-trip SHA-256, large PDF, question asset, paper save, DPP save, dedup, audit/list — auto-run on connect).
- Canaries: corpus 684 total / 385 verified / 43 conflict / 0 rejected (delta +20 = ingestion-suite OFFICIAL fixtures, verified origin — nothing reseeded/deleted); eligibility real ids; **JEE Main generation live OK (3q/12m, cleaned up)**; NEET/Adv honest CORPUS-LIMITED; `app_quota_ok` true again (2026-08 usage counter reset by suites' documented fixture cleanup — enforcement untouched); parent dashboard `{"linked":false}`.
- Error-path probes: 401/400/404/415/503 exact + CORS `*` + zero credential leakage (**16/16** after probe update for the supabase-js v2 `FunctionsHttpError` shape; statuses independently cross-checked via raw HTTP).
- Build: dist 16 files, 0 issues; secret scan CLEAN (src + dist + public + functions).
- **Final completion cycle (2026-08-16 #3, zero app-code changes)**: secret re-confirmed ABSENT (`supabase secrets list` — names only) → `GOOGLE_OAUTH_CLIENT_SECRET_REQUIRED`; 18/18 function sweep 0 404s; `probe-rpcs.mjs` 42/42 MISSING none; corpus live 714/391 VERIFIED/46 conflict (fixture-grown only); eligibility real IDs (JEE Main 195); quota 2026-08 = 2 papers + 1 DPP used (gate ACTIVE).

- **Secret configuration (2026-08-16 #4)**: `GOOGLE_OAUTH_CLIENT_SECRET` **CONFIGURED** via `supabase secrets set` (verified by name only). Callback now performs the real Google token exchange — fake-code probe returns the honest "Google did not return a refresh token" page (NOT the misconfiguration page). OAuth `status` → `{"connected":false,"account":null}` (honest, pre-consent). Drive-integration spec re-run: 3 pass / 7 honest skips — no regression.

## 5. Owner actions still required (ONE interactive action + console verification)

1. **Google Cloud console (verify):** Drive API enabled; redirect URI `https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth` registered; test user `exampro1012@gmail.com` added (testing mode). Consent screen shows app name "ExamPro".
2. **ONE manual consent click** (owner): ExamPro → Settings → Storage → Google Drive → Connect → sign in as `exampro1012@gmail.com` → Allow. The callback stores the refresh token server-side and runs a real Drive test → round-trip tests auto-run (10/10).
3. Service-account secrets: **NOT required** (OAuth user storage is the architecture; per spec, do not introduce).
4. **SMTP delivery** verification for Auth emails.
5. **Rotate QA admin password** (`admin@exampro.com` shared in chat — treat as compromised; `scripts/rotate-admin-password.mjs`).
6. **CI pipeline** for the Playwright suites.
7. Security note: the OAuth client secret was shared in this chat channel — if the channel is not private/encrypted at rest, consider rotating it in Google Cloud console and re-running the `secrets set` command.
8. Note: the free quota (5 papers/month) for tenant `00000000-0000-0000-0000-000000000001` — server-side gate ACTIVE; live 2026-08 usage = 2 papers + 1 DPP (headroom remains; exhausted → HTTP 402 "Free paper quota reached."). Resets in September or via plan upgrade.

## 6. Deployment artifacts

- `supabase/migrations/0042_google_drive_oauth.sql` — now self-contained (uuid overload moved in; dependency-ordered).
- `supabase/migrations/0043_features_and_hardening.sql` — `app_parent_dashboard()` uses `uuid` + `search_path = public, auth` (applies under any session search_path).
- `supabase/config.toml` — `[functions.google-drive-oauth] verify_jwt = false` (callback has no JWT).
- `supabase/functions/google-drive-oauth/index.ts` — unauthenticated callback path (code exchange via `state`); JWT+admin still required for start/status/test/disconnect; sanitized errors; userinfo account email.
- `supabase/functions/_shared/drive-auth.ts` — explicit `EXAMPRO_DRIVE_*` markers for missing/incomplete credentials.
- All 11 drive-* functions — clear 503 "Google Drive is not connected." on disconnected paths; `drive-upload` MIME whitelist now includes `text/plain`.
- `scripts/deploy-edge-functions.ps1` — 18 functions; documents all secrets.
- `scripts/fn-probe.mjs` / `scripts/canaries.mjs` / `scripts/probe-drive-errors.mjs` / `scripts/probe-drive-statuses.mjs` — live diagnostics.
- `tests/drive-integration.spec.ts` — honest deployment/disconnected/failure tests + round-trip (SHA-256) gated on real connection.
- `GOOGLE-DRIVE-CONFIG-MATRIX.md`, `GOOGLE-DRIVE-GO-LIVE.md` — exact config inventory + go-live checklist.
- `supabase/deploy/apply-missing-0040-0042-0043.sql` — retained as an idempotent fallback for partial states (contains the same two fixes).