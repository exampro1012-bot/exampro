# EXAMPRO — "Not connected / Redirecting…" ROOT-CAUSE REPORT (2026-08-17)

## ROOT CAUSE (two defects, both fixed)

1. **Stale service-worker cache served the OLD application.** `sw.js` cached every
   app asset **cache-first** under `exampro-v2` — a version that was never bumped
   across the last two feature cycles. The server serves the new code (verified:
   0 occurrences of the old "falls back to Supabase Storage" sentence, current
   policy text present), but the user's browser replayed the old cached
   `pages.js`/`ingestion-center.js` indefinitely. That is why the reported UI
   showed text that no longer exists in the source.
2. **"Redirecting…" could persist forever.** Every Connect-button handler set the
   label to "Redirecting…" and only recovered on success: no reset on failure, no
   timeout on the `google-drive-oauth start` invoke, no single-flight guard.
   A failed/hung start (or returning via Back) left "Redirecting…" on screen
   permanently — exactly the reported symptom. The OAuth **callback** itself was
   verified loop-free (failures render an honest 200 page with a manual "Back to
   ExamPro" link; success 302s once to `#/admin/ingestion?drive=connected`, which
   the app re-probes via drive-health before ever claiming connected).

## FILES CHANGED

- `sw.js` — cache bumped to `exampro-v3` and app assets switched to
  **network-first with cache fallback** (fresh code always wins; offline still
  served). This eliminates the stale-app class of bugs permanently.
- `src/app.js` — `EP.connectGoogleDrive`: 10s timeout (Promise.race),
  single-flight `oauthStartInFlight` guard, try/catch/finally, honest toasts;
  still only ever invoked from an explicit click (page loads never start OAuth).
- `src/ingestion-center.js` — Connect + banner-Connect buttons restore their
  label and re-enable when the start fails/times out; `?drive=connected`
  handling already re-probes and cleans the URL via history.replaceState.
- `src/pages.js` — storage-page Connect button gets the same reset behavior.
- `tests/supabase-ingestion.spec.ts` — two §28 tests:
  "Drive status page must not redirect automatically" (waits 10.5s; URL must be
  unchanged, never accounts.google.com, no "Redirecting" visible, status badge
  resolves to a defined state) and "Connect button resets Redirecting when the
  OAuth start fails" (start stubbed to fail — proves the reset path without
  navigating to Google). Both run on desktop AND mobile.

## DATABASE CHANGES / EDGE FUNCTION CHANGES

None required — the token table (0 rows), OAuth code path, and callback were
verified correct; the defects were entirely client-side (cache + button state).

## STATUS

- OAUTH STATUS: code side PASS (callback 200, exchange fires, secret configured).
- DRIVE STATUS: **NOT CONNECTED — truthfully** (consent not yet completed; 0
  refresh tokens). Not faked; the 7 round-trip tests remain honestly gated.
- DRIVE ACCOUNT / DRIVE HEALTH: honest (`{"connected":false,"account":null}`;
  drive-health reports not_connected with lastError "Google Drive is not
  connected.").
- INGESTION: gate + policy intact (GOOGLE_DRIVE_REQUIRED live); counters
  DB-driven (re-verified this cycle: the UI's 98/0/98… + 258 jobs / 169 sources /
  214 shards all match live SQL — growth is the QA suites' own documented
  fixtures; post-run purge restores the preserved 98).
- QUESTION BANK / PAPER GENERATOR / DPP / OMR / PDF: unchanged, verified by the
  full regression (below).
- PLAYWRIGHT (desktop + mobile): **322 passed / 0 failed / 20 skipped**
  (skips: 7 Drive-consent-gated ×2 projects + 6 policy-sensitive mobile, all
  with explicit reasons; both new §28 tests execute and pass on desktop AND
  mobile).
- CONSOLE ERRORS: 0 (live probe + console-network-audit suite).
- NETWORK ERRORS: 0; no infinite requests (the no-auto-redirect test asserts a
  stable URL after 10.5s).

## USER ACTION

One **hard refresh** (Ctrl+Shift+R) on the already-open tab — the new service
worker (`exampro-v3`, network-first) installs on the next navigation and purges
the stale v2 cache automatically.

## REMAINING BLOCKERS (owner, unchanged)

1. Google Drive consent click (then 7 round-trip tests execute automatically).
2. Rotate the postgres DB password. 3. Re-auth Supabase CLI + redeploy
drive-health (new `status` field). 4. Review the 98 pending questions; ingest
real official PYQs.
