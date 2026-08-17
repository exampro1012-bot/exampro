import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL || 'admin@exampro.com';
const PASS = process.env.SUPABASE_TEST_PASSWORD || 'Admin@123';

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: s } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
const token = s.session.access_token;

for (const sizeKB of [64, 256, 512, 1024, 1536, 2048, 2560, 3072]) {
  const buf = Buffer.alloc(sizeKB * 1024, 0x61);
  buf.write('%PDF-1.7\n', 0);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const { data: up } = await sb.functions.invoke('drive-upload', {
    body: { file: { name: `probe-${sizeKB}.pdf`, content: buf.toString('base64'), mimeType: 'application/pdf' }, folderPath: 'imports' },
  });
  const fileId = up?.object?.drive_file_id;
  const t0 = Date.now();
  let ok = false;
  let got = 0;
  let err = '';
  let timer = null;
  try {
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort(), 45000);
    const r = await fetch(`${URL}/functions/v1/drive-download?fileId=${fileId}`, {
      headers: { authorization: `Bearer ${token}`, apikey: ANON },
      signal: ctrl.signal,
    });
    const body = Buffer.from(await r.arrayBuffer());
    clearTimeout(timer);
    got = body.length;
    ok = body.length === buf.length && crypto.createHash('sha256').update(body).digest('hex') === sha;
    if (body.length < 100) err = ' body=' + body.toString();
  } catch (e) {
    if (timer) clearTimeout(timer);
    err = ' ' + (e.message || e);
  }
  console.log(`${sizeKB}KB: roundtrip-ok=${ok} got=${got} expected=${buf.length} ms=${Date.now() - t0}${err}`);
  await sb.functions.invoke('drive-delete', { body: { fileId, permanent: true } });
  await sb.from('storage_objects').delete().eq('drive_file_id', fileId);
}
console.log('done');