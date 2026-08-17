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

1. Creates a `tenants` row ("teacher Workspace" / first-user naming).
2. Inserts a `tenant_memberships` row linking the new user to that tenant with a
   role taken from `raw_user_meta_data -> 'role'`, defaulting to `SUPER_ADMIN`
   for the **first** user of a fresh project.
3. For subsequent users the role comes from signup metadata (e.g. `STUDENT`,
   `TEACHER`, `INSTITUTION_ADMIN`).

This means a brand-new project works immediately: the first sign-up owns a
workspace and can invite/manage members.

## Roles & permissions

- `roles`: SUPER_ADMIN, PLATFORM_ADMIN, INSTITUTION_ADMIN, TEACHER, STUDENT,
  CONTENT_REVIEWER, EXAM_COORDINATOR, etc. (14 seeded).
- `permissions`: granular keys such as `questions.create`, `papers.generate`,
  `dpp.generate`, `exams.create`, `results.view`, `branding.manage`,
  `billing.manage`, `admin.users`, `audit.view` (42 seeded).
- `role_permissions` maps them (191 seeded rows).
- `EP.can("papers.generate")` is checked both in the UI (button visibility) and
  enforced server-side by RLS / function guards.

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
