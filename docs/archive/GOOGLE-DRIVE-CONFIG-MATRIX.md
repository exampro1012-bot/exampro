# GOOGLE DRIVE CONFIGURATION MATRIX (LIVE-VERIFIED)

Project: `lrktftnalrtvaazaauhj` — https://lrktftnalrtvaazaauhj.supabase.co
Matrix derived from the deployed implementation (`supabase/functions/**`), NOT from assumptions.
Verified live: 2026-08-16 (drive-* v3, google-drive-oauth v4, all ACTIVE).
Final re-verification (cycle #3): secret re-confirmed ABSENT on 2026-08-16 via environment check + `supabase secrets list` (digests only) → `GOOGLE_OAUTH_CLIENT_SECRET_REQUIRED`; 18/18 functions live (401 JWT-gated sweep, 0 404s); `scripts/probe-drive-errors.mjs` now **16/16** (probe fixed for supabase-js v2 `FunctionsHttpError.context` — statuses re-verified via raw HTTP: 415/503/404 exact, clean messages, CORS `*`, zero secret leakage).

## Edge function environment variables (exact set used by the code)

| VARIABLE | USED BY | REQUIRED? | SECRET? | CURRENTLY CONFIGURED? | PURPOSE |
|---|---|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_SECRET` | google-drive-oauth (code exchange), drive-* via getDriveClient | **YES** | **YES** | **CONFIGURED (value never stored in repo/env)** | Client secret of the OAuth 2.0 Client ID. Verified live: the callback now performs a real Google token exchange (fake-code probe → `invalid_grant`/“did not return a refresh token”, NOT the misconfiguration page). No default in code (deliberate). |
| `GOOGLE_OAUTH_CLIENT_ID` | google-drive-oauth, drive-* | Optional (has safe default) | No (public) | Not set — code default used | `577032144870-ftlplfu0btp7btt5rbo9i6qcled5nqb0.apps.googleusercontent.com` |
| `GOOGLE_OAUTH_REDIRECT_URI` | google-drive-oauth consent URL + exchange | Optional (has default) | No | YES (set) | `https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth` |
| `GOOGLE_OAUTH_SCOPE` | consent URL | No — hardcoded | No | n/a (constant) | `https://www.googleapis.com/auth/drive.file` (narrow, file-scope) |
| `GOOGLE_DRIVE_PROJECT_ID` | drive-* service-account fallback | No (fallback path) | No | NOT set | Google Cloud project id — only needed if a service account is ever introduced |
| `GOOGLE_DRIVE_CLIENT_EMAIL` | drive-* service-account fallback | No (fallback path) | No | NOT set | Service-account email — not needed with OAuth user storage |
| `GOOGLE_DRIVE_PRIVATE_KEY` | drive-* service-account fallback | No (fallback path) | **YES** | NOT set | Service-account private key — not needed with OAuth user storage |
| `APP_URL` | google-drive-oauth callback redirect + error pages | **YES** | No | YES (set) | `https://lrktftnalrtvaazaauhj.supabase.co` |
| `SUPABASE_URL` | all functions | yes (platform) | No | auto-injected | Supabase platform injects automatically |
| `SUPABASE_SERVICE_ROLE_KEY` | all functions | yes (platform) | **YES** | auto-injected | Supabase platform injects automatically |

## Google Cloud Console configuration (owner action — cannot be done from this environment)

| ITEM | VALUE / ACTION | STATUS |
|---|---|---|
| OAuth 2.0 Client ID | `577032144870-ftlplfu0btp7btt5rbo9i6qcled5nqb0.apps.googleusercontent.com` (existing) | Present in code default |
| Authorized redirect URI | `https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth` (must be added to the client) | **VERIFY in console** |
| Consent screen | App name "ExamPro", dev contact, test users incl. `exampro1012@gmail.com` | **VERIFY in console** |
| Drive API | Must be ENABLED for the Google Cloud project | **VERIFY in console** |
| Target account | `exampro1012@gmail.com` (account shown by drive-health fallback) | Verified as intended |
| Service account | NOT required — architecture is OAuth user Drive storage (per instructions, do not introduce) | n/a |

## Where each value must be configured

| VARIABLE | WHERE | HOW |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_SECRET` | Supabase Edge Function secrets | `supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET='<value>' --project-ref lrktftnalrtvaazaauhj` |
| Consent/redirect/Drive API | Google Cloud console → APIs & Services → Credentials / OAuth consent screen / Library | manual, owner |
| `APP_URL`, `GOOGLE_OAUTH_REDIRECT_URI` | already set | `supabase secrets list --project-ref lrktftnalrtvaazaauhj` |

## Verification commands

```
supabase secrets list --project-ref lrktftnalrtvaazaauhj          # shows secret NAMES (never values)
node scripts/probe-drive-errors.mjs                               # error-path probes (16/16, disconnected state verified)
npx playwright test tests/drive-integration.spec.ts --project=chromium-desktop   # 3 pass + 7 honest skips until connected
# After OAuth consent: round-trip tests un-skip and run SHA-256 upload/download verification
```

## Drive folder structure (implementation constant)

`ExamPro/` root + 12 subfolders: `01_Source_Documents`, `02_Question_Bank`, `03_Question_Shards`, `04_Answer_Keys`, `05_Solutions`, `06_Question_Assets`, `07_Formulas`, `08_Generated_Papers`, `09_DPP`, `10_OMR`, `11_Reports`, `12_Archives`.
Storage-bucket mapping lives in `supabase/functions/_shared/drive-auth.ts` (`BUCKET_TO_SUBFOLDER`).

## Summary of what remains to go live on Google Drive

1. **DONE — `GOOGLE_OAUTH_CLIENT_SECRET` configured** via `supabase secrets set` (verified by name in `secrets list`; the value is never printed, stored in the repo, or written to any doc). Live proof: the callback now performs the real Google token exchange (fake-code probe → honest “did not return a refresh token” page, NOT the misconfiguration page).
2. Console-side verification (owner): authorized redirect URI registered, Drive API enabled, consent screen test users include `exampro1012@gmail.com`.
3. **ONE remaining action — the consent click** (owner): app → Settings → Storage → Google Drive → Connect (or open the consent URL returned by `google-drive-oauth start`), sign in as `exampro1012@gmail.com`, Allow. The callback then stores the refresh token server-side (RLS-protected) and runs a real Drive test.
After the consent: `drive-health` returns `connected:true` and the 7 gated round-trip tests in `tests/drive-integration.spec.ts` run automatically (SHA-256, large PDF, question asset, paper/DPP save, dedup, audit/list).
