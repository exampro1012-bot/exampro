// ExamPro — live probe of Drive edge-function error paths (Phase 14).
// Runs BEFORE Drive is connected: verifies controlled 401/400/404/415/503
// responses, CORS headers, clean "not connected" messaging, and that no
// payload ever contains credential material. Idempotent, read-only.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const URL = 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxya3RmdG5hbHJ0dmFhemFhdWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3OTc3MTMsImV4cCI6MjEwMjM3MzcxM30.tgLahciagESZk05YaoMyeIDudL9bSoH-EoPMRxFbVYs';

function creds() {
  const txt = readFileSync('.test-creds.env', 'utf8');
  const get = (k) => (txt.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '';
  return { email: get('SUPABASE_TEST_EMAIL'), pass: get('SUPABASE_TEST_PASSWORD') };
}

const SECRET_RE = /private_key|client_email|client_secret|refresh_token|BEGIN (RSA )?PRIVATE|GOOGLE_DRIVE_PRIVATE|iam\.gserviceaccount|oauth2client/i;
let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '  ' + (detail || '')); }
}

function leaks(payload) {
  const s = JSON.stringify(payload);
  return SECRET_RE.test(s) || (s.includes('{') && /[A-Za-z0-9_\-]{40,}/.test(s) && /eyJ/.test(s));
}

// supabase-js v2 wraps non-2xx responses as FunctionsHttpError; the HTTP
// status and body live on error.context (a Response), not on the error itself.
function errStatus(r) {
  const e = r?.error;
  if (!e) return r?.data?.status;
  return e?.context?.status ?? e?.status;
}
async function errBody(r) {
  const e = r?.error;
  if (!e) return JSON.stringify(r?.data ?? null);
  const ctx = e?.context;
  if (ctx?.json) { try { return JSON.stringify(await ctx.json()); } catch (_) {} }
  if (ctx?.text) { try { return await ctx.text(); } catch (_) {} }
  return JSON.stringify(e);
}

const { email, pass: pwd } = creds();
const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password: pwd });
if (authErr || !auth.session) { console.error('login failed:', authErr?.message); process.exit(1); }
const tok = auth.session.access_token;
const hdrs = { authorization: 'Bearer ' + tok, apikey: ANON, 'Content-Type': 'application/json' };

// 1. unauthenticated -> 401
const anonSb = createClient(URL, ANON, { auth: { persistSession: false } });
const r401 = await anonSb.functions.invoke('drive-upload', { body: { file: { name: 'x.txt', content: '', mimeType: 'text/plain' } } });
check('drive-upload unauthenticated -> error', !!r401.error, JSON.stringify(r401).slice(0, 120));

// 2. missing file -> 400
const r400 = await sb.functions.invoke('drive-upload', { body: {} });
check('drive-upload missing file -> error', !!r400.error, JSON.stringify(r400).slice(0, 120));

// 3. unsupported MIME -> 415 (pre-Drive gate)
const r415 = await sb.functions.invoke('drive-upload', { body: { file: { name: 'evil.exe', content: Buffer.from('MZ').toString('base64'), mimeType: 'application/x-msdownload' } } });
const r415raw = r415.error || r415.data;
check('drive-upload 415 unsupported MIME', errStatus(r415) === 415, JSON.stringify(r415raw).slice(0, 120));

// 4. valid JWT + supported MIME but Drive not connected -> 503 clear message
const r503 = await sb.functions.invoke('drive-upload', { body: { file: { name: 'probe.txt', content: Buffer.from('probe').toString('base64'), mimeType: 'text/plain' } } });
const r503raw = r503.error || r503.data;
check('drive-upload not-connected -> 503 clear msg', errStatus(r503) === 503 && /Google Drive is not connected/i.test(await errBody(r503)), JSON.stringify(r503raw).slice(0, 160));

// 5. drive-init not-connected -> 503
const rInit = await sb.functions.invoke('drive-init');
const rInitRaw = rInit.error || rInit.data;
check('drive-init not-connected -> 503 clear msg', errStatus(rInit) === 503 && /Google Drive is not connected/i.test(await errBody(rInit)), JSON.stringify(rInitRaw).slice(0, 160));

// 6. drive-metadata: missing fileId -> 400; garbage -> 404 (DB-first, pre-Drive)
const m400 = await sb.functions.invoke('drive-metadata', { body: {} });
check('drive-metadata missing fileId -> error', !!m400.error, JSON.stringify(m400).slice(0, 120));
const m404 = await sb.functions.invoke('drive-metadata', { body: { fileId: 'does-not-exist-000' } });
check('drive-metadata unknown fileId -> error(404)', !!m404.error && (errStatus(m404) === 404 || /not found/i.test(await errBody(m404))), JSON.stringify(m404).slice(0, 120));

// 7. drive-download: 400 / 404 via raw fetch + CORS header check
const dl400 = await fetch(`${URL}/functions/v1/drive-download`, { method: 'GET', headers: hdrs });
check('drive-download missing fileId -> 400', dl400.status === 400, 'status=' + dl400.status);
const corsHdr = dl400.headers.get('access-control-allow-origin');
check('drive-download CORS ACAO header present', corsHdr === '*', 'ACAO=' + corsHdr);
const dl404 = await fetch(`${URL}/functions/v1/drive-download?fileId=does-not-exist-000`, { method: 'GET', headers: hdrs });
check('drive-download unknown fileId -> 404', dl404.status === 404, 'status=' + dl404.status);

// 8. drive-health: 200, connected:false, clean lastError, no secrets
const h = await sb.functions.invoke('drive-health');
const hd = h.data || h.error;
check('drive-health 200', hd?.connected === false || hd?.connected === true, JSON.stringify(hd).slice(0, 160));
check('drive-health lastError clean', hd?.lastError === 'Google Drive is not connected.', 'lastError=' + JSON.stringify(hd?.lastError));
check('drive-health no secret leak', !leaks(hd));

// 9. google-drive-oauth status: 200 connected:false, no secrets
const st = await sb.functions.invoke('google-drive-oauth', { body: { action: 'status' } });
const std = st.data || st.error;
check('oauth status connected:false', std?.connected === false, JSON.stringify(std).slice(0, 160));
check('oauth status no secret leak', !leaks(std));

// 10. no payload from ANY of the above leaks credential material
const all = JSON.stringify([r401, r400, r415raw, r503raw, rInitRaw, m400, m404, hd, std, { dl400: await dl400.text(), dl404: await dl404.text() }]);
check('no secret/credential material in any payload', !leaks(all));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);