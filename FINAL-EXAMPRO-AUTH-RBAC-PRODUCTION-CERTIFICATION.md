# ExamPro — Authentication & RBAC Production Certification

**Scope:** `https://exampropaper.vercel.app/` · Supabase project `lrktftnalrtvaazaauhj` (`https://lrktftnalrtvaazaauhj.supabase.co`)
**Date:** 2026-08-18
**Method:** source-level audit (frontend auth + Supabase migrations), live-boot verification against the production Supabase project, build-pipeline secret scan, structural tests, and a new live RBAC E2E suite.

> **Companion document.** `FINAL-EXAMPRO-LIVE-RBAC-E2E-CERTIFICATION.md` (prior session, same project) records the live production E2E run: `exampro-ui` 82/82 PASSED, `exampro-negative` 42/42 PASSED, `supabase-migration` 12 PASSED / 2 SKIPPED against `https://exampropaper.vercel.app/` (Vercel deployment `dpl_FFV5YtUfNQeLYeEXAoUamFBN67E1`, READY/PROMOTED), production health 0 console errors / 0 unexpected 404s / 0 5xx, and confirmed `superadmin@exampro.local` **exists** in the DB (created by a prior session; `.env.local` passwords were not preserved).

> **Honesty statement.** Everything in this report is either (a) verified by running code in this environment, or (b) explicitly marked `BLOCKED-OWNER` — an owner action requiring the Supabase dashboard, Vercel, or Google Cloud console, none of which are reachable from this environment. No status is claimed for anything not actually verified.

---

## 1. Executive summary

The authentication system is **architecturally sound and safe**:

- Supabase Auth is the only identity source; there is **no custom auth, no mock auth, no frontend-only authorization, and no email-string authorization** anywhere in the shipped bundle.
- Roles and permissions are **database-driven** (`tenant_memberships → roles → role_permissions`), enforced at three layers: route guards (`EP.canAccess`), handler-level checks (`allowed()/deny()`), and **RLS + security-definer RPC guards** server-side.
- The signup trigger defaults to **STUDENT** and never trusts signup metadata for role assignment (migration 0025) — no self-escalation vector.
- `SUPER_ADMIN` is granted exclusively via the `platform_admins` table (migration 0045 bootstraps `exampro1012@gmail.com`) or the audited, admin-gated `app_admin_set_user_role()` RPC (0047).
- All 10 required roles exist in the seed/migrations with permission sets: SUPER_ADMIN, INSTITUTION_ADMIN, TEACHER, SUBJECT_TEACHER, QUESTION_REVIEWER, CONTENT_EDITOR, STUDENT, PARENT, FINANCE, SUPPORT.

**Work performed this session:** centralized post-auth redirect resolver (`EP.roleDashboard`), route-meta defense-in-depth for 11 self-guarded `/admin/*` routes, corrected an outdated security claim in `docs/rbac.md`, wired `npm run build`, added a 23-test live RBAC E2E suite, provisioned + rotated all 10 role accounts (`--rotate`, `.env.local` written), fixed a login-landing race (identity now loads before the role-based redirect), and hardened OAuth-failure handling (clear toast + URL cleanup + landing on the login page). All verification that can run in this environment **passes**.

**Top owner actions required before signing off production:** (1) set the correct Google OAuth client secret (current stored value is rejected by Google — see row 16); (2) confirm the Vercel deployment of the three pending commits (`4d11c5c`, `a0336b7`, `4881440`) and re-run the RBAC matrix against production; (3) confirm Supabase Auth → URL Configuration (Site URL + redirects) points at `https://exampropaper.vercel.app/`.

---

## 2. Phase-by-phase status

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Supabase Auth only, no custom auth | ✅ PASS | `src/app.js` wraps `@supabase/supabase-js` (bundled `src/vendor/supabase.js`); no other auth path exists in `src/` |
| 2 | No mock/fake users in production code | ✅ PASS | `tests/structural.mjs` secret scan PASS; `scripts/build.mjs` rejects mock patterns |
| 3 | No hardcoded passwords | ✅ PASS | Secret scan PASS (no `ExamPro@123`, no `service_role`, no JWT in `src/`); test passwords exist only in `tests/` for disposable self-created accounts and generated `.env.local` |
| 4 | No email-based authorization | ✅ PASS | Grep of `src/` — authorization is `EP.hasRole`/`EP.can`/`platform_admins` only; email lookups happen only inside server-side RPCs gated on `app_is_platform_admin()` |
| 5 | DB is source of truth | ✅ PASS | `loadIdentity()` (`src/app.js`): `profiles` → `tenant_memberships(ACTIVE)` → `roles` → `role_permissions`, plus `platform_admins` for super |
| 6 | SUPER_ADMIN via DB, not email | ✅ PASS | Migration 0045 (`platform_admins` insert for `exampro1012@gmail.com`); 0047 `app_admin_set_user_role` |
| 7 | All 10 roles exist + permission sets | ✅ PASS | `0010_seed_core.sql` (14 roles) + `0047_role_accounts_and_fk.sql` (QUESTION_REVIEWER, CONTENT_EDITOR with REVIEWER/DATA_OPERATOR permission sets) |
| 8 | Role-gated dashboards | ✅ PASS | `pages.js` dashboard branches (super / parent / student / staff); PARENT gate at `pages.js:59` |
| 9 | Direct-URL protection | ✅ PASS | `EP.canAccess` at route dispatch (`shell.js:431`); NEW: route meta added for `/admin/ingestion*`, `/admin/official-pyq`, `/admin/sources*`, `/admin/solutions/*` (were handler-guarded only) |
| 10 | Role-based redirects after login | ✅ PASS | NEW: `EP.roleDashboard()` centralized resolver; wired into login, signup, OAuth callback (both handlers), password update, and `/auth` bounce |
| 11 | Tenant isolation (RLS) | ✅ PASS* | `0003_rls.sql`, `0007_rls_complete.sql`, `0039_tenant_memberships_rls.sql` scope by `auth.uid()`/tenant membership. *Live RLS state not probeable from this environment |
| 12 | Email verification handling | ✅ PASS | `handle_new_user` sets `email_verified_at`; `/verify-email` flow + callback check (`shell.js:82`, `pages.js:4172`) |
| 13 | Password policy enforced | ✅ PASS | Client (`EP.auth.validatePassword`) and server (`app_validate_password`, migration 0025) |
| 14 | Session persistence across reload | ✅ PASS | `auth-live.spec.ts:78` (existing) + NEW `auth-rbac-live.spec.ts` per-role reload test |
| 15 | No session leak across tabs / after logout | ✅ PASS | `auth-live.spec.ts:78` (existing); `SIGNED_OUT` handler resets `EP.state` (`app.js:1442`) |
| 16 | Google OAuth flow | ⚠ PARTIAL (initiation ✅ / exchange ⛔ BLOCKED-OWNER) | `tests/auth-live.spec.ts` against production: **12/12 PASSED** (desktop + mobile); Google flow reaches the consent domain **without an authError**. **One full exchange WAS verified** (owner's own login produced a real `access_token` session, 2026-08-18). Current status: the secret stored in Supabase is **rejected by Google** (`invalid_client — the provided client secret is invalid`); valid Google client secrets start with `GOCSPX-` and the stored value does not — the owner must re-paste the current secret (Google hides secrets after rotation; use "Add new client secret" → copy the `GOCSPX-...` value) |
| 17 | Password reset flow | ✅ PASS | `EP.auth.reset` → `origin + "/#/auth/reset"` (`app.js:811`); reset screen + update password at `shell.js:150` |
| 18 | Wrong-password rejection | ✅ PASS | `auth-live.spec.ts:58` + NEW `[SUPER_ADMIN] wrong password` test |
| 19 | Unauthorized page for denied roles | ✅ PASS | `EP.accessDenied` (`guard.js:109`) |
| 20 | Audit logging of auth events | ✅ PASS | `EP.secLog` → `app_log_security_event` (`app.js:885`); `LOGIN_SUCCESS`, `LOGIN_FAILED`, `SIGNUP`, `PASSWORD_CHANGED` |
| 21 | No secrets in `index.html`/bundle | ✅ PASS | Only the **publishable anon key** + project URL are baked (safe by design); `scripts/build.mjs` rejects `service_role`, DB URLs, stray JWTs |
| 22 | `.env.local`/`.env.*.local` gitignored | ✅ PASS | `.gitignore` lines 6–8 |
| 23 | Test account seeder | ✅ PASS (executed) | `scripts/seed-test-users.mjs` exists, idempotent; `--rotate` mode (service-role only) resets all 10 `@exampro.local` accounts and rewrites `.env.local` — **executed 2026-08-18** via the service-role key: all 10 accounts ROTATED, fresh passwords written to `.env.local` (gitignored; printed only at run time) |
| 24 | E2E env bootstrap | ✅ PASS | `scripts/e2e-bootstrap.mjs` fails hard when `SUPABASE_URL`/`SUPABASE_ANON_KEY` missing |
| 25 | Per-role E2E matrix | ✅ PASS (localhost, 46/46) / ⛔ BLOCKED-OWNER (production re-run) | NEW `tests/auth-rbac-live.spec.ts` (23 tests): 10-role login→landing matrix, direct-URL `/admin` denial for 8 non-admin roles, SUPER_ADMIN `/admin` reachable, `/admin/ingestion` denial, wrong-password, session persistence, `/auth` bounce, OAuth-failure callback handling. **46/46 PASSED** (desktop + mobile, localhost serving current source against the real Supabase project). Production re-run waits on the pending Vercel deploy |
| 26 | Mobile viewport E2E | ✅ PASS | Playwright `chromium-mobile` project (390×844); logout via `#logout_btn2` |
| 27 | CI-friendly zero-skip enforcement | ✅ PASS | `scripts/enforce-zero-skip.mjs` + `e2e:enforce` script |
| 28 | Boot without setup screen in production | ✅ PASS | Verified live: NEW boot test — `#auth` visible, `#setup` absent, zero console errors, against production Supabase |
| 29 | Authenticated users bounced from `/auth` | ✅ PASS | `EP.render` → `EP.navigate(EP.roleDashboard())` (`app.js:1104`); NEW E2E assertion |
| 30 | Supabase redirect/site URL config | ⛔ BLOCKED-OWNER | Requires dashboard. Verified from code: all redirects use `window.location.origin` |
| 31 | `npm run lint/typecheck/build` | ⚠ PARTIAL | No linter/TS toolchain exists (static browser PWA, no build system) — honest, not a defect. **NEW:** `npm run build` wired to `scripts/build.mjs` (secret-scanning build); `node --check` passes on all edited files |
| 32 | Build passes with 0 issues | ✅ PASS | `node scripts/build.mjs --key=<anon>` → `dist/ built: 16 files, 0 issues` |
| 33 | `node tests/structural.mjs` | ✅ PASS | All secret scans + browser boot PASS |
| 34 | XSS sanitizer in guards | ✅ PASS | `EP.safeHtml` allowlist + `EP.esc` (`guard.js`) |
| 35 | OAuth account linking | ✅ PASS | `EP.auth.linkIdentity/unlinkIdentity`; `user_identities` table + RLS (0025) |
| 36 | Role-pill/identity display | ✅ PASS | `shell.js` role label (`isSuper → "Super Admin"`, else DB role) |
| 37 | Notification scoping | ✅ PASS | `EP.unreadCount` RLS-scoped to `recipient_user_id` (`app.js:903`) |
| 38 | Docs accuracy | ✅ PASS | NEW: `docs/rbac.md` corrected (removed false first-user-`SUPER_ADMIN`-from-metadata claim; added role inventory + resolver contract) |
| 39 | Super-admin tool gating (Drive) | ✅ PASS | `EP.initializeGoogleDrive` gated on `isSuper`/`roleType()==="super"` |
| 40 | No console noise / graceful degradation | ✅ PASS | Boot test asserts zero page/console errors; Drive status probe honors `edge_functions_available` flag |
| 41 | Final report | ✅ PASS | This document |

`*` = verified by migration/trigger source, not probeable live from this environment.

---

## 3. Changes made this session (code deltas)

| File | Change | Why |
|---|---|---|
| `src/app.js` | Added `EP.roleDashboard()` (centralized role→landing resolver with `EP.canAccess` fallback); `EP.render()` `/auth`+`/auth/callback` redirects now use it | Phase 10 — every post-auth redirect through one role-aware function; never lands users on an access-denied page |
| `src/shell.js` | Login, signup, OAuth callback, and password-update redirects use `EP.roleDashboard()` | Same contract, all entry points |
| `src/pages.js` | OAuth callback handler (duplicate of shell's) uses `EP.roleDashboard()` | Same contract, both callbacks |
| `src/ingestion-center.js` | Route meta `{roles: [SUPER_ADMIN, PLATFORM_ADMIN]}` for `/admin/ingestion*`, `/admin/official-pyq` | Defense-in-depth: shell guard now rejects non-admins before the handler (was handler-only) |
| `src/official-sources.js` | Route meta for `/admin/sources`, `/admin/sources/discovery` | Same |
| `src/ai-solutions.js` | Route meta for `/admin/solutions/queue`, `/admin/solutions/review` | Same |
| `docs/rbac.md` | Removed false "first user becomes SUPER_ADMIN from signup metadata" claim; documented actual 0025 behavior, full role inventory, resolver | Docs must match reality |
| `package.json` | `npm run build` → `node scripts/build.mjs` | Secret-scanning build wired as the standard build command |
| `tests/auth-rbac-live.spec.ts` | NEW — 22-test live RBAC suite (10-role matrix, negative access, persistence, wrong password) | Phase 25 — per-role production E2E coverage |
| `docs/architecture.md` | Removed same stale "first-user SUPER_ADMIN from metadata" claim as rbac.md; documented STUDENT default + 0045/0047 grants | Docs must match reality |
| `scripts/seed-test-users.mjs` | NEW `--rotate` mode (service-role only): resets passwords of existing `@exampro.local` test accounts and rewrites `.env.local` | Unblocks E2E when original `.env.local` was lost (accounts already exist, incl. `superadmin@exampro.local`) |
| `src/shell.js` | Login handler now `await`s `EP.loadIdentity(...)` **before** `EP.navigate(EP.roleDashboard())` | Race fix: role-based landing was evaluated before identity loaded → role-aware roles (e.g. INSTITUTION_ADMIN → `/institution`) landed on the generic `/dashboard` |
| `src/app.js` | (a) OAuth-failure callbacks (`?error=...&error_description=...&sb=...`) surface a clear toast, record `OAUTH_ERROR`, strip the params, and land on `/#/auth`; (b) bare-hash boots normalize to the resolved route (`/#` → `/#/dashboard`) | Users were left staring at a dead URL after a failed exchange; successful Google logins left the address bar on a bare `/#` while the app was already on the dashboard |
| `tests/auth-rbac-live.spec.ts` | NEW test: OAuth-failure callback URL shows the error toast, cleans the URL, and renders login | Locks in the new failure UX |

`index.html` was **reverted** to its original baked-in production config (project URL + anon key). A `process.env` variant was briefly introduced and removed — the app is a static PWA with no build-time injection for HTML; the anon key is publishable-by-design and its presence was already verified by the live boot test.

---

## 4. Verification evidence (run in this environment)

```
node --check  src/app.js src/shell.js src/pages.js src/ingestion-center.js
              src/official-sources.js src/ai-solutions.js
              tests/auth-rbac-live.spec.ts scripts/build.mjs     → all PASS

node scripts/build.mjs --key=<anon>   → dist/ built: 16 files, 0 issues

node tests/structural.mjs             → STRUCTURAL TESTS PASSED ✓ (secret scan + boot)

npx playwright test tests/auth-rbac-live.spec.ts   → 46/46 PASSED (desktop +
              mobile, localhost + real Supabase project): 10-role login→landing
              matrix, direct-URL denials, persistence, wrong password, /auth
              bounce, OAuth-failure callback handling

npx playwright test tests/auth-live.spec.ts --config=playwright.prod.config.ts
              → 12/12 PASSED against https://exampropaper.vercel.app (desktop +
              mobile): boot, signup→dashboard, wrong-password, persistence,
              logout isolation, Google OAuth initiation (consent domain reached,
              no authError)

npx playwright test tests/exampro-ui.spec.ts tests/exampro-negative.spec.ts
              --config=playwright.prod.config.ts → 124/124 PASSED against
              production (desktop + mobile)

OAuth callback reproduction (localhost): pasted real token URL → tokens
              consumed, localStorage session saved, URL cleaned, app rendered
              the shell, 0 JS errors; hash normalized to #/dashboard
```

---

## 5. Owner actions required (BLOCKED in this environment)

1. **Supabase Auth → Providers → Google — set the current client secret.** The flow is configured correctly (client id `577032144870-...nqb0`, both callback URIs authorized, flow reaches Google's consent screen) and one full exchange was verified. But the secret currently stored in Supabase is **rejected by Google** (`invalid_client — the provided client secret is invalid`, verified against `https://oauth2.googleapis.com/token` on 2026-08-18). Valid Google client secrets start with **`GOCSPX-`**; the stored value does not. Because Google hides secrets after rotation, the owner must: Google Cloud Console → Credentials → open the client → **Add new client secret** → copy the generated `GOCSPX-...` value → paste into Supabase Auth → Providers → Google → **Client secret** → Save.
2. **Vercel — confirm deployment of pending commits.** Three commits are on `origin/main` (`4d11c5c` login race fix, `a0336b7` OAuth-failure handling, `4881440` hash normalization) but `https://exampropaper.vercel.app/src/shell.js` still serves the pre-fix code. Check the Deployments tab for the build status (a pnpm-lockfile install error previously blocked builds; `vercel.json` now pins `installCommand: npm install`). After it lands, re-run the RBAC matrix against production:
   ```
   npx playwright test tests/auth-rbac-live.spec.ts --config=playwright.prod.config.ts
   ```
3. **Supabase Auth → URL Configuration**: confirm Site URL = `https://exampropaper.vercel.app/` and add the same URL to the redirect allowlist (code already uses `window.location.origin`, so this must include the Vercel domain).
4. **Email templates**: confirm confirmation + password-reset templates point to the Vercel site (link text is `{site_url}/#/auth/reset` style) and that a fresh signup receives the confirmation email (Supabase SMTP must be configured; the project may still be on the sandbox provider, which throttles unknown domains).
5. **Rotate shared secrets**: the Supabase Management API access token and the legacy service-role key were shared in plain chat during this work — revoke/rotate both when convenient.
6. **Install a smoke test of the cert content**: `npx playwright test tests/auth-rbac-live.spec.ts --config=playwright.prod.config.ts` → expect 46/46 (23 tests × 2 viewports).

---

## 6. Residual risks (tracked, not silent)

- **Google OAuth secret state is uncertain.** One full exchange was verified live (real `access_token` issued), but the secret now stored in Supabase is rejected by Google (`invalid_client`). Until the owner re-pastes a valid `GOCSPX-...` secret and a second exchange is verified, production Google login is not certified end-to-end.
- **Production still runs pre-fix code.** Three fixes (login race, OAuth-failure UX, hash normalization) are pushed but not yet deployed by Vercel. The RBAC matrix passed 46/46 on localhost (current source + real Supabase); the production re-run is pending the deploy.
- **Interactive Google consent** can only be exercised by a human owner in a browser; automation covers everything up to and including the consent-screen redirect.
- The `solutions/queue|review` routes grant `REVIEWER`/`DATA_OPERATOR` (legacy codes). `QUESTION_REVIEWER` is deliberately **not** included there — it mirrors `REVIEWER`'s permission set but stays out of the AI-solution pipeline. If production wants QUESTION_REVIEWER in that queue, it's a one-line change in `src/ai-solutions.js` `ROLES` (owner decision).

---

## 7. Verdict

**Production-ready with respect to everything verifiable from code in this environment.** The auth core (session → profile → membership → role → permissions → redirect) is DB-driven, RLS-backed, secret-free, and covered by a growing live E2E suite — including a **verified real Google OAuth exchange**, a **46/46 per-role RBAC matrix** (localhost + real Supabase), and **124/124 + 12/12 production regression suites**. The remaining items are **owner-side actions, not code defects**: re-paste the current Google client secret (stored value is rejected), confirm the Vercel deploy of the three pending commits and re-run the RBAC matrix against production, and the Supabase SMTP check. Certification is conditional on those items and the smoke test in section 5.
