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
console.log('sha:', sha);

let t0 = Date.now();
const { data: up, error: upErr } = await sb.functions.invoke('drive-upload', {
  body: {
    file: { name: 'probe-large.pdf', content: pdf.toString('base64'), mimeType: 'application/pdf' },
    folderPath: 'imports',
  },
});
console.log('upload ms:', Date.now() - t0, 'error:', upErr ? upErr.message : 'none', 'created:', up?.created, 'existing:', up?.existing);
const fileId = up?.object?.drive_file_id;
if (!fileId) { console.log('no fileId'); process.exit(1); }

t0 = Date.now();
const r = await fetch(`${URL}/functions/v1/drive-download?fileId=${fileId}`, {
  headers: { authorization: `Bearer ${token}`, apikey: ANON },
});
console.log('download headers ms:', Date.now() - t0, 'status:', r.status, 'len:', r.headers.get('content-length'));
t0 = Date.now();
const body = Buffer.from(await r.arrayBuffer());
console.log('download body ms:', Date.now() - t0, 'bytes:', body.length, 'sha match:', crypto.createHash('sha256').update(body).digest('hex') === sha);

const { data: del, error: delErr } = await sb.functions.invoke('drive-delete', { body: { fileId, permanent: true } });
console.log('delete:', del?.deleted, delErr?.message || 'ok');
await sb.from('storage_objects').delete().eq('drive_file_id', fileId);
console.log('cleanup done');