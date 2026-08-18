# Authentication & Identity

ExamPro uses **Supabase Auth**. The client (`src/app.js`) wraps
`@supabase/supabase-js` so every page reads the authenticated user from the
Supabase session — there is no custom auth server and no hardcoded user.

## Sign up / sign in

- `EP.auth.signUp(email, password, fullName)` → creates an Auth user and fires
  the bootstrap trigger (below).
- `EP.auth.signIn(email, password)`, `EP.auth.signInWithGoogle()`,
  `EP.auth.reset(email)`, `EP.auth.updatePassword(pw)`, `EP.auth.signOut()`.

In the app, after a successful session the router calls `EP.loadIdentity()`,
which resolves the active tenant + role + permissions and stores them in
`EP.state` (used by `EP.can(...)` / `EP.hasRole(...)` for UI gating).

## Auto-provisioned workspace (multi-tenant bootstrap)

A database trigger on `auth.users` insert automatically:

1. Creates a `tenants` row ("<full name> Workspace").
2. Inserts a `tenant_memberships` row linking the new user to that tenant with
   the safe default role **`STUDENT`** (migration 0025; the pre-0025 behavior of
   deriving `SUPER_ADMIN` from signup metadata was removed — signup metadata is
   **never** trusted for authorization).

Super-admin is granted **only** by an explicit `platform_admins` row (inserted by
migration 0045 for `exampro1012@gmail.com`, or via the audited
`app_admin_set_user_role()` RPC from migration 0047, which is gated on
`app_is_platform_admin()`). Institutions later invite the same user into their
tenants with the desired role.

## Roles & permissions

- `roles`: SUPER_ADMIN, PLATFORM_ADMIN, INSTITUTION_ADMIN, ACADEMIC_ADMIN,
  TEACHER, SUBJECT_TEACHER, PAPER_SETTER, REVIEWER, QUESTION_REVIEWER,
  CONTENT_EDITOR, STUDENT, PARENT, FINANCE, SALES, SUPPORT, DATA_OPERATOR.
  (14 seeded in `0010_seed_core.sql`; QUESTION_REVIEWER + CONTENT_EDITOR added
  in `0047_role_accounts_and_fk.sql`.)
- `permissions`: granular keys such as `questions.create`, `papers.generate`,
  `dpp.generate`, `exams.create`, `results.view`, `branding.manage`,
  `billing.manage`, `admin.users`, `audit.view` (42 seeded).
- `role_permissions` maps them (191 seeded rows).
- `EP.can("papers.generate")` is checked both in the UI (button visibility) and
  enforced server-side by RLS / function guards.

## Post-auth redirects

All post-auth landings (login, signup, OAuth callback, password update) go
through the centralized `EP.roleDashboard()` resolver in `src/app.js`, which
maps the resolved DB role to its landing route and falls back to an accessible
route (never an access-denied page). Example: INSTITUTION_ADMIN →
`/institution`, FINANCE/SALES → `/reports`, PAPER_SETTER → `/papers`, all other
roles → `/dashboard` (role-aware).

## Super admin

`platform_admins` grants cross-tenant super-admin. `EP.isSuper` is true when
the authenticated user is listed; the Admin page (`/admin`) is gated on
`SUPER_ADMIN` / `PLATFORM_ADMIN`.

## Session storage

- The Supabase session lives in the browser's `localStorage` (managed by the
  supabase-js client). No session secrets are ever read by app code.
- The Supabase URL + anon key are stored **only in this browser**
  (`localStorage.exampro_config_v2`) and used solely to construct the client.
  They are never sent anywhere except your Supabase project.
