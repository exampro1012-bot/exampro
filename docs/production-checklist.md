# Production Readiness Checklist

Go-live gates. Items marked ✅ are implemented in this repo; ☐ need an
operator action on the hosted Supabase project.

## Database
- ✅ Migrations `0001`–`0020` apply cleanly (validated on PostgreSQL 18 and a
  hosted Supabase project; 20 migrations recorded).
- ✅ Engine test passes: generation, scoring, idempotency.
- ✅ No-repeat default regression covered (`engine_0019_test.sql`): used
  questions are reused unless `exclude_used` is requested.
- ✅ RLS enabled on all business tables (multi-tenant via `auth_tenant_ids()`).
- ✅ Seed data: exams/subjects, question types, roles, permissions, grants,
  plans, `system_config`, a clearly-labelled demo question set
  (`0017_demo_seed.sql`, `license_status='DEMO'`), and demo chapters/topics
  linking those questions (`0020_demo_syllabus.sql`).
- ☐ Run migrations on the **production** Supabase project (SQL editor / CLI).
- ☐ Verify RLS is ON for every table in the dashboard (defense in depth).
- ☐ Review/trim `platform_admins`; remove test entries.

## Auth & access
- ✅ Auto-provisioned workspace tenant on first sign-up.
- ✅ Roles + permissions enforced (UI + RLS + function guards).
- ✅ Google OAuth client implemented with provider pre-check (disabled →
  guidance toast; callback failures → clear error + `OAUTH_ERROR` audit log).
- ☐ Enable the **Google provider** in Supabase Auth (→ Providers → Google)
  with Google Cloud OAuth credentials — see `docs/oauth.md`. Until then the button
  explains that Google is not enabled instead of redirecting into an error page.
- ☐ Enable email confirmation (or disable for internal use).
- ☐ Configure MFA / SSO for admin roles.
- ☐ Set Auth **Site URL** + **Redirect URLs** to the production origin.

## Secrets
- ✅ Connect screen accepts only the **anon** key; rejects empty input.
- ✅ Structural test fails build if `service_role` appears in client HTML.
- ☐ Ensure only the anon key ships to the browser (no `.env` leakage in CI).
- ☐ Rotate any previously exposed keys.

## Storage
- ✅ Buckets + tenant-scoped policies created (`0005_storage.sql`).
- ☐ Confirm Storage policies are active and set object size/type limits.
- ☐ Set CORS / cache headers for `institution-logos` (public).

## Frontend
- ✅ Real Supabase SPA (`index.html` + `src/*`); boots to connect screen.
- ✅ Responsive shell (desktop grid sidebar; mobile drawer + bottom nav); no
  overlap, no horizontal overflow.
- ✅ PWA manifest + service worker (offline app-shell).
- ✅ No Firebase / Code.gs / Cloudflare-worker dependencies remain.
- ☐ Host statically (CF Pages / Netlify / Vercel / S3). Optionally bake
  `window.EXAMPRO_CONFIG` for a managed deployment (anon key only).
- ☐ Add CSP, HSTS, and SRI if serving at a custom domain.

## Billing (optional)
- ✅ `plans`, `subscriptions`, `usage_records`, `payment_transactions` tables
  and free-quota enforcement exist.
- ☐ Wire a payment provider (Stripe) webhook to update `subscriptions`/
  `usage_records` (out of scope of this repo; hook points are present).

## Monitoring
- ✅ `audit_logs` + `app_record_audit` for privileged actions.
- ☐ Enable Supabase Auth/DB logs + alerts; scrape `audit_logs` into SIEM.
- ☐ Add uptime + error monitoring for the static frontend.
