# EXAMPRO — STORAGE-REPAIR CYCLE REPORT (2026-08-17)

Scope: the "Fix Google Drive Not Connected + Ingestion Storage + Question
Verification Pipeline" prompt. Every claim below was verified live; nothing was
faked, and the Drive connection itself was never claimed.

## Google Drive: NOT CONNECTED — root cause (of the 20 candidates)

**B + L: OAuth consent was never completed, therefore no refresh token exists.**
`google_drive_oauth_tokens` has **0 rows** (0 refresh, 0 access). The entire
code side of the chain is verified PASSING:

| Stage | Result | Evidence |
|---|---|---|
| Callback reachable (no JWT) | PASS | `GET /functions/v1/google-drive-oauth?code=…` → 200 |
| Client secret configured + token exchange fires | PASS | fake-code probe → honest "Google did not return a refresh token" page (exchange executed against Google; not the misconfiguration page) |
| Refresh token persisted | **MISSING** | 0 rows in `google_drive_oauth_tokens` |
| Connection lookup / drive-health | PASS (honest) | `{"connected":false,"account":null}`; drive-health `lastError:"Google Drive is not connected."` |

The single remaining action is the interactive owner consent (Settings →
Storage → Connect as exampro1012@gmail.com). It cannot be automated and was
NOT faked. All 7 Drive round-trip tests skip honestly until then.

## Fixed this cycle

1. **storage_policy (§11/§12/§31/§32/§33)** — migration **0046** (applied live,
   recorded in history): `system_config.storage_policy` with allowed values
   GOOGLE_DRIVE_REQUIRED (default, live) / GOOGLE_DRIVE_PREFERRED /
   SUPABASE_ONLY; RPCs `app_get_storage_policy()` (all authenticated) and
   `app_set_storage_policy(text)` (platform-admin only).
   - The silent Supabase-Storage fallback is **gone**: under REQUIRED, the
     ingestion import is blocked BEFORE processing ("Google Drive is not
     connected. Connect Google Drive before ingesting production
     question-bank content." + Connect/Cancel), mid-job Drive failure pauses
     the job as `WAITING_FOR_STORAGE` (questions preserved for resume), and
     unstorable shards are `PENDING` not `FAILED`. Under PREFERRED/SUPABASE_ONLY
     the fallback is allowed and every completion line states the real
     provider + object id + sha256 ("Stored in Supabase Storage …").
   - The misleading "falls back to Supabase Storage" sentence is removed;
     policy-accurate text replaces it. Ingestion dashboard shows Storage
     Provider / Status / policy; §31 admin banner (non-blocking, Connect
     button) renders for supers while REQUIRED + disconnected.
   - Policy is cached for display but the **gate force-refetches** on every
     import click (an admin's policy change is always honored).
2. **Connection-state UI (§10)** — four states (● Connected with account +
   last verified, ○ Not connected, ⚠ Authorization expired → Reconnect,
   ⚠ Connection error → Retry/Reconnect) on both the ingestion dashboard and
   /admin/storage, plus a policy selector for platform admins and Test
   Connection that reports only what drive-health actually verified. The
   post-OAuth redirect now RE-PROBES before toasting "connected" (never
   trusts the URL). The hardcoded account fallback email is removed — the
   account shows "—" until a real connection exists.
3. **drive-health (§9)** — repo code updated: explicit `status` field
   (healthy / not_connected / reauthorization_required / provider_unavailable),
   `account` null unless really connected. The deployed function still returns
   the old shape (CLI token expired — see blockers); the frontend derives the
   identical states client-side from `connected`/`lastError` meanwhile.
   **Owner: redeploy `drive-health` after re-authing the CLI.**
4. **Ingestion job filters (§18)** — status filter buttons with live counts
   (ALL / PROCESSING / COMPLETED / FAILED / PAUSED / WAITING_FOR_STORAGE /
   CANCELLED).
5. **OMR template from pattern (§27)** — `exam_patterns.omr_template_id`
   (additive FK); the OMR sheet page auto-selects the template pinned to the
   paper's active exam pattern and says which pattern chose it.
6. **Counters + shards (§17-19)** — all 11 dashboard numbers re-verified
   against live SQL and match exactly (98/0/98/0/0/0/0/0 + 229 jobs / 140
   sources / 185 shards); every card is a live query (no hardcoded/cached
   counters). Shard integrity: 0 STORED-with-pending-ids, 0 duplicate hashes,
   0 rows missing metadata.
7. **The 98 questions (§13)** — preserved untouched. All 98 belong to ONE real
   source document (an organic-chemistry QUESTION_BOOK PDF, stored object
   present, status INGESTED), all have answer keys, 0 have solutions, 0 have
   options; texts are 166–2722-char book-page fragments. They are
   PENDING_REVIEW because the pipeline imports unverified and no human review
   has occurred; most look like non-question prose (TOC/worksheet fragments)
   and will likely be rejected in review. **0 verified is correct; nothing was
   auto-verified.**
8. **§34 SUPER_ADMIN** — re-verified: exampro1012@gmail.com resolves through
   platform_admins + SUPER_ADMIN membership (DB RBAC, no email checks in
   authorization). admin@exampro.com kept as the QA admin (not deleted).

## Tests

- New gate test proves: REQUIRED + disconnected → import blocked, Connect +
  Cancel shown, **0 questions created**. Import tests run under an explicitly
  configured PREFERRED fallback (restored to REQUIRED after) with honest
  retry when parallel files race the policy toggle; policy-sensitive toggles
  run on the desktop project only (mobile skips visibly) to avoid
  cross-project races.
- Live UI probe (`probe-ui-storage.mjs`, kept in repo): banner, state card,
  storage page, and gate all render correctly with **0 console/page errors**.
- Full regression (desktop + mobile, final): **315 passed / 0 failed / 20 skipped**
  (skips = 7 Drive-consent-gated ×2 projects + 6 policy-sensitive mobile skips,
  each with an explicit reason). Post-suite fixture purge re-run: corpus back to
  the preserved 98 PARSER rows, 0 verified; policy restored to
  GOOGLE_DRIVE_REQUIRED; 12 test users removed.

## §38 status table

| Check | Status |
|---|---|
| Google Drive | **NOT CONNECTED** (owner consent pending — not faked) |
| OAuth code side | PASS |
| Refresh token | MISSING (never issued — consent not completed) |
| Drive API round-trip | HONESTLY SKIPPED until consent (7 gated tests) |
| Ingestion (incl. storage gate + fallback labeling) | PASS |
| Questions | 98 total / 0 verified / 98 pending / 0 conflicts — preserved |
| Answer keys | 98 present (1 per question, this corpus) / 0 verified-by-human |
| Solutions | 0 / 0 (corpus has none; queue + AI + review flow tested green) |
| DPP generation | PASS (self-sufficient spec) |
| JEE Main / NEET paper | PASS — honest insufficient-corpus refusal with per-section counts from the official 2026 patterns |
| JEE Advanced paper | PASS — same honest refusal (per-paper frame stored; counts unverified per brochure) |
| OMR | PASS (templates, sheets, evaluation, detection + pattern-pinned template) |
| PDF / A4 | PASS |
| Playwright | see below |

## Remaining blockers (owner actions, unchanged)

1. ONE consent click for Drive (then 7 round-trip tests auto-unskip).
2. Rotate the postgres DB password (was committed + shared in chat).
3. Re-auth the Supabase CLI (token expired) → redeploy `drive-health` (new
   `status` field) and any future functions.
4. Review the 98 pending questions (expected: mostly reject) and ingest real
   official PYQ documents — the platform honestly refuses to fabricate.
