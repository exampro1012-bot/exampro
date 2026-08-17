// Temp E2E probe: drive connection state (rewritten as canonical state probe)
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
await sb.auth.signInWithPassword({
  email: process.env.SUPABASE_TEST_EMAIL,
  password: process.env.SUPABASE_TEST_PASSWORD,
});

const uid = (await sb.auth.getUser()).data.user.id;

const probe = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`\n===== ${name} =====`);
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.log(`\n===== ${name} (ERROR) =====`);
    console.log(e.message);
  }
};

await probe('drive-health (authed)', async () => {
  const r = await sb.functions.invoke('drive-health', {
    headers: { Authorization: `Bearer ${(await sb.auth.getSession()).data.session.access_token}` },
  });
  return { status: r.status, data: r.data };
});

await probe('google-drive-oauth status', async () => {
  const r = await sb.functions.invoke('google-drive-oauth', {
    headers: { Authorization: `Bearer ${(await sb.auth.getSession()).data.session.access_token}` },
    body: { action: 'status' },
  });
  return { status: r.status, data: r.data };
});

await probe('tokens table', async () => {
  const { data, error } = await sb.from('google_drive_oauth_tokens')
    .select('id, tenant_id, provider, account, scope, created_at, updated_at');
  return { data, error: error?.message };
});

await probe('profile/default tenant', async () => {
  const { data, error } = await sb.from('profiles')
    .select('auth_user_id, email, default_tenant_id')
    .eq('email', process.env.SUPABASE_TEST_EMAIL);
  return { uid, data, error: error?.message };
});