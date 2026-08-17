import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL || 'admin@exampro.com';
const PASS = process.env.SUPABASE_TEST_PASSWORD || 'Admin@123';

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: s } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
const token = s.session.access_token;

const pdf = Buffer.alloc(3 * 1024 * 1024, 0x61);
pdf.write('%PDF-1.7\n', 0);
const sha = crypto.createHash('sha256').update(pdf).digest('hex');

const { data: up } = await sb.functions.invoke('drive-upload', {
  body: { file: { name: 'probe-large2.pdf', content: pdf.toString('base64'), mimeType: 'application/pdf' }, folderPath: 'imports' },
});
const fileId = up?.object?.drive_file_id;
console.log('uploaded:', fileId);

for (let attempt = 1; attempt <= 3; attempt++) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    const r = await fetch(`${URL}/functions/v1/drive-download?fileId=${fileId}`, {
      headers: { authorization: `Bearer ${token}`, apikey: ANON },
      signal: ctrl.signal,
      // disable HTTP/2+3 to rule out multiplexing/proxy quirks
      // (undici option below)
    });
    clearTimeout(timer);
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(`attempt ${attempt}: status=${r.status} len=${buf.length} ok=${crypto.createHash('sha256').update(buf).digest('hex') === sha} ms=${Date.now() - t0}`);
  } catch (e) {
    console.log(`attempt ${attempt}: FAILED after ${Date.now() - t0}ms:`, e.message || String(e));
  }
}

const { data: del } = await sb.functions.invoke('drive-delete', { body: { fileId, permanent: true } });
console.log('delete:', del?.deleted);
await sb.from('storage_objects').delete().eq('drive_file_id', fileId);
console.log('cleanup done');