# ExamPro — Drive Function Inventory (2026-08-16, final go-live certification)

All 18 functions are **DEPLOYED and ACTIVE** on project `lrktftnalrtvaazaauhj` (verified via `supabase functions list` and HTTP probes: 401 without JWT = deployed + JWT-gated; no 404s). Final regression: **322 passed / 0 failed / 14 honest skips**. Gated Drive canaries (7 tests in `tests/drive-integration.spec.ts`) auto-run on connection: round-trip SHA-256, large PDF, question asset, paper save, DPP save, dedup, audit/list. Certificate: `FINAL-GO-LIVE-CERTIFICATION.md`.

**Secret configuration (2026-08-16 #4):** `GOOGLE_OAUTH_CLIENT_SECRET` **CONFIGURED** via `supabase secrets set` (verified by name only — value never printed/stored). Live proof: the callback now performs the real Google token exchange — a fake-code probe returns the honest "Google did not return a refresh token" page (NOT the misconfiguration page). OAuth `status` → `{"connected":false,"account":null}` (honest, pre-consent). Drive-integration spec re-run: 3 pass / 7 honest skips — no regression. The ONLY remaining action is the owner's one-time consent click (consent URL generated correctly; after consent the 7 gated canaries auto-run → 10/10).

Deployment status: **PASS** · Health status: ✅ verified reachable / ⛔ runtime-blocked on missing Drive credential / 🟡 partially verified

| Function | Source | Frontend caller | Required secrets | Deploy | Health |
|---|---|---|---|---|---|
| `google-drive-oauth` | `supabase/functions/google-drive-oauth/` | `src/app.js` (start/status/disconnect via `sb.functions.invoke`) + Google callback redirect | `GOOGLE_OAUTH_CLIENT_ID` (has safe default), `GOOGLE_OAUTH_CLIENT_SECRET` (**CONFIGURED** — live exchange verified), `GOOGLE_OAUTH_REDIRECT_URI` (set), `APP_URL` (set), `SUPABASE_SERVICE_ROLE_KEY` (auto) | ✅ ACTIVE v4 | ✅ start 200 (valid consent URL); status 200 honest (`connected:false`, pre-consent); callback reachable without JWT + performs real token exchange; disconnected actions → clean `503 {"error":"Google Drive is not connected."}`; account email resolved via userinfo on connect — awaiting the ONE owner consent click |
| `drive-health` | `supabase/functions/drive-health/` | `src/app.js` storage settings probe | OAuth token row or service-account env | ✅ ACTIVE v3 | ✅ 200 — folder registry + stats; `connected:false` with clean `lastError: "Google Drive is not connected."` until credential set |
| `drive-init` | `supabase/functions/drive-init/` | storage settings "Initialize folders" | Drive credential (see above) | ✅ ACTIVE v3 | ✅ 503 clean "Google Drive is not connected." (was 500) |
| `drive-upload` | `supabase/functions/drive-upload/` | question asset / logo uploads (storage shim) | Drive credential | ✅ ACTIVE v3 | ✅ 401/400/415 gates verified live; `text/plain` added to MIME whitelist (round-trip fixture); disconnected → 503 clean |
| `drive-download` | `supabase/functions/drive-download/` | asset fetch (binary; CORS verified live: ACAO `*`) | Drive credential | ✅ ACTIVE v3 | ✅ 400/404 verified live (DB-first, pre-Drive); disconnected → 503 clean |
| `drive-metadata` | `supabase/functions/drive-metadata/` | asset metadata display | Drive credential | ✅ ACTIVE v3 | ✅ 400/404 verified live (DB-first, pre-Drive); disconnected → 503 clean |
| `drive-delete` | `supabase/functions/drive-delete/` | asset removal | Drive credential | ✅ ACTIVE v3 | ✅ gates verified; disconnected → 503 clean |
| `drive-list` | `supabase/functions/drive-list/` | storage folder listing | Drive credential | ✅ ACTIVE v3 | ✅ gates verified; disconnected → 503 clean |
| `drive-audit` | `supabase/functions/drive-audit/` | admin storage audit | Drive credential | ✅ ACTIVE v3 | ✅ gates verified; disconnected → 503 clean |
| `drive-track` | `supabase/functions/drive-track/` | storage tracking | — (DB only) | ✅ ACTIVE v2 | ✅ 401 gate reachable; DB path |
| `drive-save-paper` | `supabase/functions/drive-save-paper/` | paper "Save to Drive" (XSS fixed) | Drive credential | ✅ ACTIVE v3 | ✅ gates verified; disconnected → 503 clean |
| `drive-save-dpp` | `supabase/functions/drive-save-dpp/` | DPP "Save to Drive" (XSS fixed) | Drive credential | ✅ ACTIVE v3 | ✅ gates verified; disconnected → 503 clean |
| `generate-paper` | `supabase/functions/generate-paper/` | paper generation button | `SUPABASE_SERVICE_ROLE_KEY` (auto) | ✅ ACTIVE | ✅ gate reachable; RPC engine verified live (exam_id scoping fixed) |
| `generate-report` | `supabase/functions/generate-report/` | report generation (authz fixed) | `SUPABASE_SERVICE_ROLE_KEY` (auto) | ✅ ACTIVE | ✅ gate reachable |
| `finalize-exam` | `supabase/functions/finalize-exam/` | exam finalize | `SUPABASE_SERVICE_ROLE_KEY` (auto) | ✅ ACTIVE | ✅ gate reachable |
| `send-notification` | `supabase/functions/send-notification/` | notification send (authz fixed) | `SUPABASE_SERVICE_ROLE_KEY` (auto) | ✅ ACTIVE | ✅ gate reachable |
| `admin-import` | `supabase/functions/admin-import/` | admin import (gate fixed) | `SUPABASE_SERVICE_ROLE_KEY` (auto) | ✅ ACTIVE | ✅ gate reachable |
| `admin-import-source` | `supabase/functions/admin-import-source/` | official-source import | `SUPABASE_SERVICE_ROLE_KEY` (auto) | ✅ ACTIVE | ✅ gate reachable |

## Secrets status (set via `supabase secrets set` / `list` — values never printed)

| Secret | Status |
|---|---|
| `APP_URL` | ✅ SET — `https://lrktftnalrtvaazaauhj.supabase.co` |
| `GOOGLE_OAUTH_REDIRECT_URI` | ✅ SET — `https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth` |
| `GOOGLE_OAUTH_CLIENT_ID` | 🟡 not set (safe public default baked in: `577032144870-ftlplfu0btp7btt5rbo9i6qcled5nqb0.apps.googleusercontent.com`); override optional |
| `GOOGLE_OAUTH_CLIENT_SECRET` | ✅ **CONFIGURED** (set via `supabase secrets set`; verified by name only — value never printed/stored). Live proof: callback performs the real Google token exchange (fake-code probe → honest "did not return a refresh token" page, not the misconfiguration page) |
| `GOOGLE_DRIVE_PROJECT_ID` / `GOOGLE_DRIVE_CLIENT_EMAIL` / `GOOGLE_DRIVE_PRIVATE_KEY` | ⛔ MISSING — service-account fallback; **NOT required** for the OAuth architecture (refresh-token storage is primary; per spec, do not introduce the service account) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | ✅ auto-injected by the platform (never set manually) |

## OAuth topology (verified)

- Redirect URI (Google): `https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth` — matches the `GOOGLE_OAUTH_REDIRECT_URI` secret and the `drive-auth.ts` default.
- Scope: `https://www.googleapis.com/auth/drive.file` (narrow, per-file).
- Flow: `start` (JWT) → consent URL → Google → callback (no JWT allowed; `verify_jwt=false` for this function only) → code exchange → refresh token stored server-side in `google_drive_oauth_tokens` → real Drive test → redirect to `APP_URL/#/admin/ingestion?drive=connected`.
- Secrets/refresh tokens never reach the browser; no tokens in localStorage (client only stores the Supabase session).

## Folder architecture

`ExamPro/` root + 12 subfolders (`01_Source_Documents` … `12_Archives`) auto-created on first connect; registry rows already present in `storage_folders` (drive-health returns them).