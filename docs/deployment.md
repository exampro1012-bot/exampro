# Deployment

ExamPro is a static frontend + Supabase backend. No application server to run.

## 1. Database (Supabase)

- Create a Supabase project.
- Apply migrations in order: `0001_schema` → … → `0019_fix_no_repeat_default`
  (SQL editor, or `supabase db push` if you use the Supabase CLI with this
  folder as a project).
- The seed (`0009_seed`, `0010_seed_core`) populates exams/subjects, question
  types, roles, permissions, role→permission grants, plans, and
  `system_config` (free quota). `0017_demo_seed` adds a small clearly-labelled
  demo question set (JEE Main, `license_status='DEMO'`) so generation and OMR
  flows work out of the box.
- (Optional) bulk-import questions via `node supabase/import-dataset.mjs`.

## 2. Auth / OAuth

- Enable Email auth; optionally Google (see `docs/oauth.md`).
- Set **Site URL** and **Redirect URLs** to your production origin
  (and `http://localhost:3000/**` for local dev).

## 3. Frontend hosting (static)

Build output is just static files: `index.html`, `src/*`, `manifest.json`,
`sw.js`. Host on any static host:

- **Cloudflare Pages / Netlify / Vercel / GitHub Pages / S3 + CloudFront**.

Example (Cloudflare Pages / Netlify): root directory = repo root, build command
= _none_ (pre-built), publish = `.` (the folder containing `index.html`).

For GitHub Pages (no custom domain HTTPS of `supabase.co` needed): enable in
repo Settings → Pages → source branch. The app loads Supabase over HTTPS
regardless of the host.

## 4. Runtime configuration

The app needs exactly two values at runtime, supplied by the **end user** in
the connect screen (stored in their browser): Supabase **Project URL** and
**anon key**. Optionally, bake defaults for a managed deployment:

```html
<script>
  window.EXAMPRO_CONFIG = { url: "https://xxxx.supabase.co", anonKey: "eyJ..." };
</script>
```

If `window.EXAMPRO_CONFIG` is present, the connect screen is skipped and the app
goes straight to Auth. Keep the key to the **anon/publishable** key only.

## 5. Storage buckets

`0005_storage.sql` creates buckets: `institution-logos` (public) and
`question-images`, `question-documents`, `omr-images`, `generated-papers`,
`reports`, `user-uploads` (private, tenant-scoped). Ensure the Storage policies
remain enabled.

## 6. PWA

`manifest.json` + `sw.js` provide offline app-shell caching. The SW is
registered only over `http(s)` (not `file:`). Update the cache name in `sw.js`
(`exampro-v1`) on app changes.
