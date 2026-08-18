// =============================================================================
// ExamPro — configure Google OAuth on the Supabase project (owner action).
//
// The Google client id/secret exist only in the owner's Google Cloud console,
// so this script requires the owner to supply them via environment variables
// (never committed, never logged). It updates the project auth config through
// the Supabase Management API and then verifies the provider from the
// public auth/settings endpoint.
//
// Usage:
//   $env:SUPABASE_ACCESS_TOKEN = "<personal access token>"   # dashboard/account/tokens
//   $env:GOOGLE_CLIENT_ID      = "577032144870-....apps.googleusercontent.com"
//   $env:GOOGLE_CLIENT_SECRET  = "<OAuth client secret>"
//   node scripts/configure-google-oauth.mjs
//
// Prerequisite (Google Cloud Console, owner): the OAuth client must list the
// redirect URI https://lrktftnalrtvaazaauhj.supabase.co/auth/v1/callback
// and authorized origin http://localhost:3000.
// =============================================================================

const REF = 'lrktftnalrtvaazaauhj';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

if (!TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing required environment variables:');
  console.error('  SUPABASE_ACCESS_TOKEN  (Supabase dashboard -> account -> access tokens)');
  console.error('  GOOGLE_CLIENT_ID       (Google Cloud console OAuth client)');
  console.error('  GOOGLE_CLIENT_SECRET   (Google Cloud console OAuth client secret)');
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`;

async function patch() {
  const res = await fetch(API, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_google_enabled: true,
      external_google_client_id: CLIENT_ID,
      external_google_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`PATCH ${res.status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  const cfg = await res.json();
  console.log('Auth config updated:');
  console.log(`  external_google_enabled = ${cfg.external_google_enabled}`);
  console.log(`  external_google_client_id = ${cfg.external_google_client_id}`);
  console.log(`  external_google_secret = ${cfg.external_google_secret ? '(set)' : '(EMPTY)'}`);
  if (!cfg.external_google_enabled || cfg.external_google_client_id !== CLIENT_ID || !cfg.external_google_secret) {
    console.error('Verification failed: the patch did not stick. Check the API response above.');
    process.exit(1);
  }
  return cfg;
}

async function verifyPublic() {
  // Public probe — proves the running project now serves the real client id.
  const res = await fetch(`https://${REF}.supabase.co/auth/v1/settings`, {
    headers: { apikey: process.env.EXAMPRO_PUBLISHABLE_KEY || '' },
  });
  if (!res.ok) { console.error(`settings probe ${res.status}`); return; }
  const j = await res.json();
  const g = (j.external && j.external.google) || {};
  console.log('Live probe /auth/v1/settings:');
  console.log(`  external.google.client_id = ${g.client_id || '(empty)'}`);
  console.log(g.client_id === CLIENT_ID
    ? '  OK — the running project now serves the real Google client id.'
    : '  MISMATCH — project is still serving the old value; wait a few seconds and re-run.');
}

await patch();
await verifyPublic();
