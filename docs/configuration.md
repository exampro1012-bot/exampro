# ExamPro — Configuration Reference

All configuration is environment / property driven so the architecture can
migrate providers without code changes. **No secrets ever live in `index.html`.**

## 1. Frontend (`window.EXAMPRO_CONFIG`)

Set before the app bundle runs (e.g. in `index.html`):

| Key | Values | Meaning |
|-----|--------|---------|
| `QUESTION_STORAGE_PROVIDER` | `supabase` | Storage provider (always Supabase) |
| `SUPABASE_URL` | URL | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | string | Supabase anon/publishable key (safe for browser) |

Example:

```html
<script>
  window.EXAMPRO_CONFIG = {
    SUPABASE_URL: 'https://xxxx.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'eyJ...',
  };
</script>
```

The app also supports interactive configuration via the Setup screen, which
stores the URL and anon key in `localStorage` under `exampro_config_v2`.

## 2. Supabase Environment (server-side / Edge Functions)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Publishable anon key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | **PRIVATE** — never expose to browser |
| `SUPABASE_DB_PASSWORD` | **PRIVATE** — database password for migrations |

## 3. Google Drive (file / object storage)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_DRIVE_PROJECT_ID` | Google Cloud project ID |
| `GOOGLE_DRIVE_CLIENT_EMAIL` | Service account email (server-side only) |
| `GOOGLE_DRIVE_PRIVATE_KEY` | **PRIVATE** — never expose to browser |
| `GOOGLE_DRIVE_ROOT_FOLDER` | Root folder name in Drive (e.g. `ExamPro`) |
| `GOOGLE_DRIVE_SCOPES` | OAuth scopes for Drive API |

Google Drive credentials are used only in secure backend contexts (Supabase Edge Functions).
The browser never sees them. The application connects to the centralized ExamPro
Drive account (`exampro1012@gmail.com`) through server-side OAuth / service-account
authorization. Tenant isolation is enforced via database records, not per-user Drive access.

## 4. Free-tier safety thresholds

| Setting | Purpose |
|---------|---------|
| `MAX_DAILY_IMPORT` | cap daily import volume |
| `MAX_DAILY_EXPORT` | cap daily export volume |
| `MAX_REQUESTS_PER_USER` | rate-limit users |
| `MAX_REQUESTS_PER_TENANT` | rate-limit tenants |

## 5. Single-project setup

This codebase is configured for **one Supabase project**. All migrations,
Edge Functions, and tests target the same project.

| Context | How to configure |
|---------|-----------------|
| Browser app | Inject `window.EXAMPRO_CONFIG` in `index.html` with your project URL + publishable key |
| Edge Functions | Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` as Function secrets |
| Direct DB scripts | Set `SUPABASE_DB_HOST` (or use the default pointing to the single project) + `SUPABASE_DB_PASSWORD` |
| Tests | Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and optional `SUPABASE_TEST_EMAIL` / `SUPABASE_TEST_PASSWORD` |

Copy `.env.example` to `.env` and fill in your single project's credentials.
