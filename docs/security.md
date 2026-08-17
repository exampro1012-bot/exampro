# Security

ExamPro is built so that **the database is the security boundary**. A client
can be tampered with; the server (PostgreSQL + RLS + SECURITY DEFINER
functions) cannot.

## Row-Level Security (RLS)

- Every business table has RLS **enabled** (64 tables) with policies that
  resolve the caller's tenants via `auth_tenant_ids()` (helper in
  `0002_helpers.sql` / `0004_functions.sql`).
- A shared **platform bank** (`tenant_id =
  00000000-0000-0000-0000-000000000001`) is readable by all tenants but only
  writable by the platform role.
- Storage policies restrict object access to the caller's tenant folder
  (`storage_obj_tenant(name)` extracts the first path segment as a tenant uuid).

## Secrets

- **Never** put a `service_role` or database key in the browser. The connect
  screen accepts only the **anon / publishable** key and validates that.
- The structural test (`tests/supabase-migration.spec.ts`) fails the build if
  `service_role` / `supabase_role` appear in the served HTML.
- Google OAuth uses Supabase's hosted flow — no client secret in the SPA.

## Untrusted client input

| Server computes (trusted) | Client may send (untrusted) |
|---------------------------|------------------------------|
| paper question selection  | a generation **spec** (intent) |
| scores, marks, percentage | nothing — `results` are written by `app_finalize_session` |
| usage / quota counters    | nothing |
| tenant resolution         | nothing (derived from `auth.uid()`) |

Because scoring is `SECURITY DEFINER` and idempotent, re-submitting or forging a
response payload cannot inflate a score or create duplicate results.

## Input handling

- All user-facing output is HTML-escaped (`EP.esc`) to prevent stored/reflected
  XSS in question text, names, etc.
- Question text is stored as provided HTML; render it with care (the app
  escapes where it shows previews, and the printable sheet strips tags for the
  raw text view).

## Audit

- `audit_logs` records privileged actions via `app_record_audit(...)`.
- Sensitive mutations (verify question, role changes, billing) should call it
  from the relevant functions/triggers.

## Recommendations before go-live

1. Confirm RLS is enabled on **all** tables (it is in migrations; verify in the
   dashboard). 2. Rotate any leaked keys; ensure only anon key ships to the
   client. 3. Enable email confirmation / MFA for admin roles. 4. Restrict
   Storage bucket policies and set object size/type limits. 5. Add rate limits
   on Auth (Supabase project settings). 6. Review `platform_admins` entries.
