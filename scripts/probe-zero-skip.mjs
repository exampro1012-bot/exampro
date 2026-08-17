import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL || 'admin@exampro.com';
const PASS = process.env.SUPABASE_TEST_PASSWORD || 'Admin@123';

if (!ANON) { console.error('SUPABASE_ANON_KEY required'); process.exit(2); }

const sb = createClient(URL, ANON, { auth: { persistSession: false } });

const { data: signIn, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
console.log('AUTH:', authErr ? 'FAIL ' + authErr.message : 'OK ' + signIn.user.id + ' role=' + signIn.user.role);

const { data: health, error: healthErr } = await sb.functions.invoke('drive-health');
console.log('DRIVE-HEALTH:', healthErr ? 'ERROR ' + JSON.stringify(healthErr) : JSON.stringify(health));

const { data: me, error: meErr } = await sb.from('profiles').select('*').eq('auth_user_id', signIn.user.id).maybeSingle();
console.log('PROFILE:', meErr ? 'ERROR ' + JSON.stringify(meErr) : JSON.stringify(me));

const { data: tokens, error: tokErr } = await sb.from('google_drive_oauth_tokens').select('id, tenant_id, email, created_at, updated_at').order('created_at', { ascending: false }).limit(10);
console.log('OAUTH TOKENS:', tokErr ? 'ERROR ' + JSON.stringify(tokErr) : JSON.stringify(tokens));

const { data: memberships, error: memErr } = await sb.from('tenant_memberships').select('tenant_id, role').eq('user_id', signIn.user.id);
console.log('MEMBERSHIPS:', memErr ? 'ERROR ' + JSON.stringify(memErr) : JSON.stringify(memberships));

const { data: policies, error: polErr } = await sb.from('storage_policies').select('*').order('updated_at', { ascending: false }).limit(5);
console.log('STORAGE POLICIES:', polErr ? 'ERROR ' + JSON.stringify(polErr) : JSON.stringify(policies));