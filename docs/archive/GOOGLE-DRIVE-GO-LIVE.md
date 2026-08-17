# GOOGLE DRIVE — GO-LIVE CHECKLIST (ExamPro)

Project: `lrktftnalrtvaazaauhj` · Supabase URL: `https://lrktftnalrtvaazaauhj.supabase.co`
Companion doc: `GOOGLE-DRIVE-CONFIG-MATRIX.md` (full variable/secret inventory).
All secret NAMES only; values are never stored in this repo.

## State: everything code-side is DONE and VERIFIED (2026-08-16, final cycle)

- 18/18 edge functions ACTIVE (drive-* v3, google-drive-oauth v4, admin-import-source v3).
- All disconnected paths return a clear `503 {"error":"Google Drive is not connected."}` — verified live (401/400/404/415/503 exact, CORS `*`, zero secret leakage).
- `google-drive-oauth`: consent URL valid, callback reachable without JWT, errors sanitized, connected-account email resolved from userinfo.
- `tests/drive-integration.spec.ts` (10 tests): **3 pass now** (deployment, clean 503, failure handling incl. no-orphan); **7 honest skips** — round-trip (SHA-256), large PDF, audit/list, question asset, paper save, DPP save, dedup — they auto-run the moment Drive reports `connected:true`.
- Full regression: **322 passed / 0 failed / 14 honest skips** (desktop + mobile).
- **`GOOGLE_OAUTH_CLIENT_SECRET` is now CONFIGURED** (verified by name in `supabase secrets list`; value never printed/stored). Live proof: the callback performs a real Google token exchange — a fake-code probe returns the honest “Google did not return a refresh token” page instead of the misconfiguration page. Exchange fires; only consent tokens are missing.

## The remaining owner actions (only ONE is interactive)

### 1. ✅ DONE — OAuth client secret configured
Configured via `supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET='<value>' --project-ref lrktftnalrtvaazaauhj` and verified by name only.

### 2. Google Cloud console (OAuth consent screen / client)
- **Authorized redirect URI** (must be registered on the client):
  `https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth`
- **Consent screen**: app name "ExamPro", developer contact, **test users must include `exampro1012@gmail.com`** (or the account you will sign in with).
- **Drive API** must be enabled: APIs & Services → Library → Google Drive API → Enable.
- Scope used by the app: `https://www.googleapis.com/auth/drive.file` (narrow, per-file — no change needed).
- NOTE: the app stores tokens server-side per tenant in `google_drive_oauth_tokens` (RLS-protected). The client secret never reaches the browser.

### 3. ONE manual consent (owner)
1. Log into ExamPro as an admin (or the account with platform-admin role).
2. Storage settings → "Connect Google Drive" → sign in as `exampro1012@gmail.com` → Allow.
3. The callback redirects to `/#/admin/ingestion?drive=connected`.

## Verify after the consent

| Check | Command / expectation |
|---|---|
| Secret registered | ✅ already verified — `supabase secrets list` shows `GOOGLE_OAUTH_CLIENT_SECRET` |
| Connected | `drive-health` (JWT) → `connected:true`, `account` = `exampro1012@gmail.com` |
| Real Drive test | OAuth `test` action creates/reads/deletes a temp file in the ExamPro folder structure |
| Round trip | `npx playwright test tests/drive-integration.spec.ts --project=chromium-desktop` → **10 passed / 0 skipped** (SHA-256 upload/download round trip, large PDF, question asset, paper save, DPP save, dedup, failure handling) |
| Folders | Drive shows `ExamPro/` + 12 subfolders (`01_Source_Documents` … `12_Archives`) |
| Full regression | `npx playwright test` (env set) → expect **330 passed / 0 failed** (all 10 drive tests now run) |

## Explicitly NOT required

- Service-account secrets (`GOOGLE_DRIVE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`) — the architecture is OAuth user Drive storage; do not introduce a service account.
- Any code or migration change.

## Ops hygiene (recommended, separate from Drive)

- Rotate `admin@exampro.com` password (`scripts/rotate-admin-password.mjs`) — it was shared in plaintext earlier.
- Verify SMTP delivery for auth emails.
- Quota note (2026-08-16 #3, live): server-side 5/month gate ACTIVE — 2026-08 usage = 2 papers + 1 DPP on the platform tenant (headroom remains; enforcement verified in `generate-paper`/`generate-dpp`: HTTP 402 "Free paper quota reached." when exhausted).
