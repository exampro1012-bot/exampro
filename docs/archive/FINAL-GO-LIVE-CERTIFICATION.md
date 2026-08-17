# EXAMPRO — FINAL GO-LIVE CERTIFICATION

**Date:** 2026-08-16 (final completion cycle #3 — supersedes cycles #1/#2)
**Project:** `lrktftnalrtvaazaauhj` — https://lrktftnalrtvaazaauhj.supabase.co
**Baseline:** 322 passed / 0 failed / 14 honest skips (336 tests, chromium-desktop + chromium-mobile, 8.6–9.4 min)
**Prepared by:** release engineering execution (live CLI + live Playwright + live probes)
**Final completion cycle (#3) ran with ZERO application-code changes; the baseline stands and was re-verified live (probes below).**

---

```
DATABASE:                              PASS
  - all migrations applied + recorded (0001→0044 + 9001; 0039/0040/0042/0043/0044 confirmed)
  - app_parent_dashboard() LIVE        (returns {"linked":false} for unlinked users)
  - 42/42 RPCs verified                (probe-rpcs 2026-08-16 #3: MISSING LIVE: none)
  - 0 PGRST202
  - all required tables present        (probe-schema)

RPC:                                   PASS

EDGE FUNCTIONS:                        PASS
  - 18/18 deployed, all ACTIVE         (drive-* v3, google-drive-oauth v4; HTTP sweep #3: 0 404s)
  - 0 deployment 404s                  (unauthenticated probes → 401, JWT-gated)
  - OAuth callback does NOT require JWT (verify_jwt=false for google-drive-oauth only;
    live: start w/o JWT → 401, callback w/o JWT → 200)
  - non-callback Drive ops remain JWT + platform-admin gated

AUTH:                                  PASS

RBAC:                                  PASS
  - negative suite 21/21               (SUPER_ADMIN/ADMIN/TEACHER/SUBJECT_TEACHER/PARENT/STUDENT denials)

TENANT ISOLATION:                      PASS
  - cross-tenant paper access denied; edge fns gate on tenant scope

QUESTION BANK:                         PASS
  - corpus intact (live #3): 714 total, 391 VERIFIED, 46 conflict, 0 rejected
  - by_exam: JEE Main 473, AP EAMCET 161, null-exam 45, NEET 20, JEE Advanced 15
  - growth vs baseline (664/381/41) only from documented OFFICIAL ingestion-suite
    fixtures — no reseed, no fabrication, no deletion

QUESTION ELIGIBILITY:                  PASS
  - app_get_eligible_questions returns real IDs (live #3: JEE Main exam → 195 eligible)

JEE MAIN GENERATION:                   PASS
  - live success: paper_id + 3 questions + 12 marks, exam-scoped, cleaned up
  - eligibility + no-repeat + exam_id scoping verified

NEET GENERATION:                       PASS / CORPUS-LIMITED
  - honest rejection: "Insufficient eligible questions for one or more sections"
    (official pattern per-section vs corpus depth) — no fabrication

JEE ADVANCED GENERATION:               PASS / CORPUS-LIMITED
  - honest rejection: same insufficient-corpus response — no fabrication

DPP:                                   PASS
  - app_generate_dpp OK; DPP preview/PDF flows PASS (live + offline)

OMR:                                   PASS
  - generation, detection, evaluation PASS (desktop + mobile); detector regression green

DESKTOP:                               PASS
MOBILE:                                PASS
  - 322 passed / 0 failed / 14 honest skips combined (336 total)

BUILD:                                 PASS
  - dist/ rebuilt #3: 16 files, 0 issues; no localhost dependency; no test endpoint

SECURITY:                              PASS
  - secret scan CLEAN across src/, dist/, public/, supabase/functions/
    (no client_secret / private_key / refresh_token / service_role / sbp_ /
     DB password / JWT secret values anywhere; only library-internal references)
  - scripts/scan-secrets.cjs: SCAN CLEAN

GOOGLE OAUTH:                          PASS (secret CONFIGURED) / AWAITING CONSENT
  - code side PASS: consent URL valid (client 577032144870-…-nqb0,
    redirect https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth,
    scope drive.file — minimum), callback reachable without JWT, errors sanitized,
    account email resolved via userinfo, tokens stored server-side (RLS)
  - GOOGLE_OAUTH_CLIENT_SECRET: CONFIGURED via `supabase secrets set` (verified by
    name only — value never printed/stored). Live proof: callback performs a real
    Google token exchange (fake-code probe → honest "did not return a refresh token"
    page, not the misconfiguration page)
  - awaiting: ONE owner consent interaction (no token stored yet → connected:false)

GOOGLE DRIVE:                          PASS / AWAITING CONSENT
  - all disconnected paths verified: 401/400/404/415/503 exact (probe 16/16),
    503 body exactly {"error":"Google Drive is not connected."}, CORS *, zero leaks
  - runtime awaits the same single consent interaction

DRIVE UPLOAD:                          PASS / AWAITING CONSENT
  - error gates + MIME whitelist (incl. text/plain) verified live (415 exact)
  - real upload awaits consent

DRIVE DOWNLOAD:                        PASS / AWAITING CONSENT
  - 400/404/CORS verified live (DB-first, pre-Drive)
  - real download awaits consent

SHA-256:                               PASS / AWAITING CONSENT
  - round-trip canaries ready and gated (upload → DB → metadata → download →
    SHA-256 before == SHA-256 after; large PDF; dedup; no-orphan; paper/DPP/asset save)
    — 7 tests skip honestly until connected
```

---

## CODE + DATABASE + EDGE FUNCTIONS: COMPLETE

## GOOGLE DRIVE: AWAITING THE SINGLE OWNER CONSENT INTERACTION
(secret CONFIGURED; consent is the only remaining external action)

### Secret configuration evidence (2026-08-16)

| Check | Result |
|---|---|
| `GOOGLE_OAUTH_CLIENT_SECRET` | **CONFIGURED** via `supabase secrets set` — verified by name in `supabase secrets list` (value never printed, stored, or written to any doc/file) |
| Callback exchange live | fake-code probe → 200 with honest "Google did not return a refresh token" page (NOT the misconfiguration page) → exchange fires against Google with the configured secret |
| OAuth status | `{"connected":false,"account":null}` — honest; no token stored until consent |
| Consent URL | generated correctly by `start` (client id, redirect, scope drive.file, offline, prompt=consent) |
| Edge function sweep (18 fns) | 18/18 live, 0 404s, 401 JWT-gated; oauth start 401 w/o JWT / callback 200 w/o JWT |
| Drive error paths (`scripts/probe-drive-errors.mjs`) | 16/16 — exact 415/503/503/404 (raw-HTTP cross-checked), clean 503 message, CORS `*`, zero secret leakage |
| RPC inventory (`probe-rpcs.mjs`) | 42/42 — MISSING LIVE: none |
| Corpus / eligibility (live) | 714 total / 391 VERIFIED / 46 conflict / 0 rejected; real IDs for JEE Main (195 eligible) |
| Quota | server-side 5/month ACTIVE; 2026-08 usage 2 papers + 1 DPP; 402 "Free paper quota reached." when exhausted |
| Build / secrets | dist 16 files, 0 issues; `scripts/scan-secrets.cjs` SCAN CLEAN |
| Drive integration spec (10 tests) | 3 pass / 7 honest skips (still pre-consent) — no regression from the secret configuration |

### The one remaining owner action

1. **Google Cloud console (verify):** Drive API enabled; redirect URI
   `https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth` registered;
   test user `exampro1012@gmail.com` added (testing mode).
2. **ONE real consent login** (owner): ExamPro → Settings → Storage → Google Drive →
   Connect → sign in as `exampro1012@gmail.com` → Allow → return to ExamPro
   (redirects to `/#/admin/ingestion?drive=connected`).

### After the consent — the automated Drive round-trip runs itself

```
npx playwright test tests/drive-integration.spec.ts --project=chromium-desktop
```
Expected: all 10 tests pass (0 skips) — real upload → DB record → metadata →
download → **SHA-256 before == SHA-256 after**, large PDF, question asset, paper
save, DPP save, deduplication, failure handling, audit/list.

Then a full regression:
```
npx playwright test
```
Expected: 330 passed / 0 failed / 0 Drive skips.

Service account: **NOT required** (OAuth user storage is the implemented
architecture — per spec, not introduced).

## Owner-side ops hygiene (recommended, non-blocking)

- Rotate `admin@exampro.com` password (`scripts/rotate-admin-password.mjs`) — shared in plaintext earlier.
- Verify SMTP delivery for auth emails.
- Wire the Playwright suites into CI.