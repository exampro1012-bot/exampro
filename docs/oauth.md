# Google OAuth (Supabase)

The login screen includes a **Continue with Google** button
(`EP.auth.signInWithGoogle()`). It uses Supabase's hosted OAuth flow, so no
Google client secret ever touches the browser.

**Behavior when the provider is not configured:** the app probes the public
GoTrue endpoint `GET /auth/v1/settings` before redirecting. If Google is not
enabled, it shows an explanatory toast instead of dumping the user on a bare
"Provider is not enabled" page. If the provider flow still fails (user
cancels, account denied, PKCE error), the redirect-back carries
`error`/`error_description` params and the app shows a clear toast
("Google sign-in failed: …") and logs a `OAUTH_ERROR` security event —
it never silently bounces back to the login form.

## 1. Create OAuth credentials in Google Cloud

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. **Create Project** (or pick one).
3. **APIs & Services → OAuth consent screen**: set app name, user support
   email, authorized domains (`supabase.co`), and add test users if in
   "Testing" mode.
4. **Credentials → Create Credentials → OAuth client ID** → Application type
   **Web application**.
5. Add an **Authorized redirect URI**:
   `https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback`

## 2. Configure Supabase

1. Supabase dashboard → **Authentication → Providers → Google**.
2. Toggle **Enable**.
3. Paste the **Client ID** and **Client Secret** from Google.
4. (Optional) set **Authorized Client IDs** if you restrict by audience.
5. Save.

## 3. App side

No code change is required — `signInWithGoogle()` redirects to Supabase's
`/auth/v1/authorize?provider=google`. After consent, Supabase redirects back to
the callback and the session is established; the app then routes into the shell.

## 4. Local dev / preview

If you serve the app from a non-`localhost` origin and want Google to work
there too, add that origin's callback handling via Supabase's
**Site URL / Redirect URLs** (Authentication → URL Configuration):

- Site URL: `http://localhost:3000` (or your deployed origin)
- Redirect URLs: add `http://localhost:3000/**` and your production URL.

## Troubleshooting

- `redirect_uri_mismatch`: the Google credential's authorized redirect URI
  must exactly equal the Supabase callback URL above.
- "OAuth not enabled": enable the Google provider in Supabase.
- Email confirmation required: if your project enforces email confirmation,
  the first Google account still signs in (Google is pre-verified); email/password
  sign-ups will need confirmation before they can log in.
