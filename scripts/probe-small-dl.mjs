import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL || 'admin@exampro.com';
const PASS = process.env.SUPABASE_TEST_PASSWORD || 'Admin@123';

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: s } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
const token = s.session.access_token;

for (const sizeKB of [1, 4, 8, 16, 32]) {
  const buf = Buffer.alloc(sizeKB * 1024, 0x62);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const { data: up } = await sb.functions.invoke('drive-upload', {
    body: { file: { name: `probe-small-${sizeKB}.bin`, content: buf.toString('base64'), mimeType: 'application/octet-stream' }, folderPath: 'imports' },
  });
  const fileId = up?.object?.drive_file_id;
  const t0 = Date.now();
  let result = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const r = await fetch(`${URL}/functions/v1/drive-download?fileId=${fileId}`, {
      headers: { authorization: `Bearer ${token}`, apikey: ANON },
      signal: ctrl.signal,
    });
    const body = Buffer.from(await r.arrayBuffer());
    clearTimeout(timer);
    const ok = body.length === buf.length && crypto.createHash('sha256').update(body).digest('hex') === sha;
    result = `status=${r.status} got=${body.length} ok=${ok}`;
    if (body.length < 50) result += ' body=' + JSON.stringify(body.toString());
  } catch (e) {
    result = 'ERR ' + (e.message || e);
  }
  console.log(`${sizeKB}KB: ${result} ms=${Date.now() - t0}`);
  await sb.functions.invoke('drive-delete', { body: { fileId, permanent: true } });
  await sb.from('storage_objects').delete().eq('drive_file_id', fileId);
}
console.log('done');