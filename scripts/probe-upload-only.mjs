import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL || 'admin@exampro.com';
const PASS = process.env.SUPABASE_TEST_PASSWORD || 'Admin@123';

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: s } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
const token = s.session.access_token;

const pdf = Buffer.alloc(3 * 1024 * 1024, 0x61);
pdf.write('%PDF-1.7\n', 0);

const { data: up } = await sb.functions.invoke('drive-upload', {
  body: { file: { name: 'probe-large3.pdf', content: pdf.toString('base64'), mimeType: 'application/pdf' }, folderPath: 'imports' },
});
const fileId = up?.object?.drive_file_id;
console.log('fileId=' + fileId);
console.log('TOKEN=' + token);