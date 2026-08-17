# Architecture

ExamPro is a **single-page app + Supabase backend**. There is no custom API
server: the browser talks directly to Supabase (PostgreSQL via PostgREST, Auth,
Storage, Realtime). All business-critical logic that must be trusted lives in
**PostgreSQL functions guarded by Row-Level Security**, so a malicious or
buggy client cannot bypass quotas, forge scores, or read another tenant's data.

## Layers

```
Browser (src/*)
  └─ @supabase/supabase-js  (vendored: src/vendor/supabase.js)
       └─ Supabase
            ├─ PostgREST  → tables (RLS enforced)
            ├─ Auth       → users, sessions, OAuth
            ├─ Storage    → logos / OMR / papers / uploads
            └─ PostgreSQL functions (SECURITY DEFINER)
                 app_generate_paper(jsonb)
                 app_finalize_session(uuid)
                 app_quota_available(...) / app_increment_usage(...)
                 app_verify_question(...) / app_weak_topics(...)
```

## Frontend (`src/`)

- **`app.js`** — `EP` namespace. Config load/save (localStorage
  `exampro_config_v2` or `window.EXAMPRO_CONFIG`), lazy `supabase.createClient`,
  `EP.auth` (signUp/signIn/signInWithGoogle/signOut/reset/updatePassword),
  `EP.loadIdentity` (resolves tenant + role + permissions from
  `tenant_memberships → roles → role_permissions`, plus super-admin via
  `platform_admins`), `EP.can/hasRole`, router (`EP.router`, hash `#/route`),
  and DOM helpers (`qs`, `esc`, `toast`, `modal`, `spinner`).
- **`shell.js`** — three top-level views: `renderSetup` (enter Supabase URL +
  anon key), `renderAuth` (login / signup / reset / Google), `renderShell`
  (responsive: desktop CSS-grid sidebar; mobile off-canvas drawer + bottom nav).
  The sidebar is a **real grid column**, so it never overlaps content.
- **`pages.js`** — every route registered with `EP.register`. Each page reads
 /writes through `EP.getClient()` (Supabase) with server-side filtering,
  pagination and search. Paper generation calls `sb.rpc('app_generate_paper')`;
  DPP reuses the engine then copies the snapshot into `dpps`/`dpp_questions`;
  online exams use `exam_sessions` + `responses` + `sb.rpc('app_finalize_session')`.

## Multi-tenancy

- Every business row carries `tenant_id`.
- RLS policies restrict rows to `auth_tenant_ids()` (all tenants the caller
  belongs to). A shared **platform question bank** (`tenant_id =
  00000000-0000-0000-0000-000000000001`) is readable by everyone but only the
  platform can write.
- Workspace tenants are **auto-provisioned**: a DB trigger on `auth.users`
  insert creates a tenant + `tenant_memberships` row (role from
  `raw_user_meta_data.role` or `SUPER_ADMIN` for the first user).

## Trust boundary

| Trusted in DB (SECURITY DEFINER) | Never trusted from client |
|----------------------------------|---------------------------|
| paper question selection         | which questions appear    |
| scoring / marks / percentage     | submitted score           |
| monthly quota counters           | usage counts              |
| tenant membership resolution     | tenant_id in a query      |

The client only sends **intent** (e.g. a generation spec); the server computes
the result and writes immutable snapshots.
