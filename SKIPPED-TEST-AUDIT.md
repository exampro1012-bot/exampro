# SKIPPED-TEST-AUDIT.md

**Repo:** ExamPro — `C:\Users\Dell\Downloads\ExamPro`
**Baseline (pre-fix full run):** 322 passed / 0 failed / 20 skipped
**Final (2026-08-17 full run):** 350 passed / 0 failed / 0 skipped
**Date of audit:** 2026-08-17
**Method:** grep of every skip site in `tests/`, live probes of `drive-health`,
`google-drive-oauth`, Supabase auth, and the deployed edge-function behavior.

The 20 baseline skips were captured from the live run report
(`docs/archive/FINAL-EXAMPRO-E2E-AUDIT.md` §11: "326 passed / 0 failed /
20 skipped (skips = 7 Drive-consent-gated × 2 projects + 6 policy-sensitive
mobile toggles)") and cross-checked against the exact `test.skip(...)` sites.

## Resolution status — all 20 skips eliminated

| # | Test | File | Project | Reason (baseline) | Resolution |
|---|------|------|---------|-------------------|------------|
| 1 | real round-trip: upload → DB record → metadata → download (SHA-256) → delete | tests/drive-integration.spec.ts | desktop + mobile | Drive not connected (deployed drive-health `connected:false`) | OAuth refresh token aligned with the test admin's resolved tenant; `drive-health` now reports `connected:true`. Real config fix, no credentials faked. |
| 2 | large PDF round-trip (~3 MB synthetic) | tests/drive-integration.spec.ts | desktop + mobile | same as #1 | #1 fix + drive-download streaming rewrite (see below). Test timeout raised to 180 s; completes in 16–18 s. |
| 3 | drive-audit and drive-list respond safely | tests/drive-integration.spec.ts | desktop + mobile | same as #1 | #1 fix |
| 4 | question asset canary: upload → DB asset ref → download → byte-identical → delete | tests/drive-integration.spec.ts | desktop + mobile | same as #1 | #1 fix; assertions corrected to the real upload contract (`object_key` = sanitized filename + timestamp suffix, `drive_parent_id`), byte-identity via SHA-256 |
| 5 | paper save canary: drive-save-paper stores drive_file_id and downloads byte-valid HTML | tests/drive-integration.spec.ts | desktop + mobile | same as #1 | #1 fix; tenant resolution fixed (see #6) |
| 6 | DPP save canary: drive-save-dpp stores drive_file_id and downloads byte-valid HTML | tests/drive-integration.spec.ts | desktop + mobile | same as #1 | #1 fix + tenant resolution: tests resolve the tenant via `tenant_memberships` (platform tenant `00000000-…-0001`), not `profiles.default_tenant_id` (no membership → RLS 42501) |
| 7 | dedup canary: same bytes twice → one canonical asset, second upload returns existing | tests/drive-integration.spec.ts | desktop + mobile | same as #1 | #1 fix; upload payload made unique per run to avoid cross-project dedup races |
| 8 | storage policy GOOGLE_DRIVE_REQUIRED gates ingestion on Drive connection state | tests/supabase-ingestion.spec.ts | mobile only | policy toggles restricted to desktop to avoid cross-project races | Real fix: cross-project atomic FS lock (`tests/helpers/policy-lock.ts`) serializes all policy-toggling tests across desktop + mobile workers; skip removed, both projects execute the real flows |
| 9 | upload CSV → parse → preview → start ingestion job | tests/supabase-ingestion.spec.ts | mobile only | same as #8 | same fix as #8 |
| 10 | ingestion job is recorded and verification queue shows the new questions | tests/supabase-ingestion.spec.ts | mobile only | same as #8 | same fix as #8 |
| 11 | answer-key auto-matching: sets valid answers, routes invalid to conflict | tests/supabase-ingestion.spec.ts | mobile only | same as #8 | same fix as #8 |
| 12 | ingestion persists source file and question shard to real object storage | tests/supabase-ingestion.spec.ts | mobile only | same as #8 | same fix as #8 |
| 13 | AI solution engine: generate → validate → expert review | tests/supabase-ai-solutions.spec.ts | mobile only | same as #8 | same fix as #8 |

## Key engineering fixes (not test-only changes)

1. **drive-download gateway streaming rewrite** (`supabase/functions/drive-download/index.ts`,
   `_shared/drive-auth.ts`): the googleapis buffered `files.get({ responseType: 'arraybuffer' })`
   path intermittently returned 200 + headers with zero body bytes (reproduced on 2 KB files).
   Replaced with a direct `fetch` of the Drive media URL
   (`https://www.googleapis.com/drive/v3/files/{id}?alt=media&supportsAllDrives=true`)
   under `AbortSignal.timeout(30000)` with a streaming `Response(res.body, …)` pass-through.
   Byte-identical downloads verified for a 39 B and a 3,145,728 B payload.
2. **OAuth token retrieval on frozen client** (`_shared/drive-auth.ts`): the googleapis Drive
   client is a frozen object, so attaching `_examproAuth` threw and the function silently fell
   back to a missing service-account credential. Now a `WeakMap` keyed by the client resolves the
   per-request token (refresh token + OAuth client id/secret), with a real 401 path for invalid
   credentials.
3. **Cross-project policy lock** (`tests/helpers/policy-lock.ts`): atomic `fs.mkdir`-based lock in
   `os.tmpdir()` with a 4-minute acquire timeout and a 15-minute stale-lock break, so global
   storage-policy toggles never race between parallel workers. Both projects now run the 6
   policy-sensitive tests.
4. **Correct tenant resolution in canaries**: tests use `tenant_memberships` instead of the
   default-tenant profile field (which resolves to a tenant the test admin cannot access).
5. **Branding assertion made provider-aware**: logo src may be served from
   `/storage/v1/object/` or `drive.google.com`.

## How the 14 Drive skips were counted (baseline)

`drive-integration.spec.ts` executes on both Playwright projects; 7 tests gated on
`driveConnected()` (live `drive-health`) → 7 × 2 = 14 skips. All 14 now run and pass.

## How the 6 mobile skips were counted (baseline)

Six tests skipped on `chromium-mobile` due to the policy-toggle race. All 6 now run and pass on
both projects (12 executions total).

## Classification (final)

- #1–#7 (14 skips): **C. TEST ENVIRONMENT ISSUE + D. EXTERNAL AUTHENTICATION** → resolved by
  real configuration + gateway fix; no credentials faked, no assertions weakened.
- #8–#13 (6 skips): **I. TEST DESIGN PROBLEM** → resolved by the cross-project lock; skips removed.

## Verification

- `node scripts/enforce-zero-skip.mjs test-results/results.json` → **ZERO-SKIP GATE PASSED — all
  350 tests ran and passed** (after updating the gate for Playwright 1.49's JSON vocabulary where
  a test that matches its expected status is reported as `expected`, not `passed`; gate semantics
  unchanged: 0 failed / 0 skipped required).
- Post-run data audit: 90/90 tables readable, 0 FK orphans, 0 duplicate-content problems,
  0 orphaned storage objects; 7 leftover NCERT test rows and all test papers removed.
