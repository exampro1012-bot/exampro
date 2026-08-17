// Live go-live canaries: corpus, eligibility, generation, quota, parent.
// Usage: node scripts/canaries.mjs
// Config: SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_TEST_EMAIL/PASSWORD
// (env vars; falls back to .test-creds.env for the credentials).
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

function loadCreds() {
  if (process.env.SUPABASE_TEST_EMAIL && process.env.SUPABASE_TEST_PASSWORD) {
    return { SUPABASE_TEST_EMAIL: process.env.SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD: process.env.SUPABASE_TEST_PASSWORD };
  }
  return Object.fromEntries(
    fs.readFileSync('.test-creds.env', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
  );
}
const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const anon = process.env.SUPABASE_ANON_KEY;
if (!anon) { console.error('Set SUPABASE_ANON_KEY (see .env.example)'); process.exit(1); }
const creds = loadCreds();

const sb = createClient(URL, anon, { auth: { persistSession: false } });
const { data: s, error: se } = await sb.auth.signInWithPassword({
  email: creds.SUPABASE_TEST_EMAIL,
  password: creds.SUPABASE_TEST_PASSWORD,
});
if (se) { console.error('signin ERR', se.message); process.exit(1); }

const exams = await sb.from('exams').select('id, name').order('name');
if (exams.error) { console.error('exams ERR', exams.error.message); process.exit(1); }
const byName = Object.fromEntries(exams.data.map((e) => [e.name, e.id]));
console.log('EXAMS:', exams.data.map((e) => e.name).join(', '));

const corpus = await sb.rpc('app_question_corpus_stats');
console.log('CORPUS:', corpus.error ? 'ERR ' + corpus.error.message : JSON.stringify(corpus.data));

for (const name of ['JEE Main', 'NEET', 'JEE Advanced']) {
  const id = byName[name];
  if (!id) { console.log(`${name}: exam not found`); continue; }
  const el = await sb.rpc('app_get_eligible_questions', { p_spec: { exam_id: id, count: 5 } });
  const ids = el.data?.question_ids || el.data?.ids || [];
  console.log(`ELIGIBLE ${name}:`, el.error ? 'ERR ' + el.error.message : `${ids.length} ids`);
  if (!el.error && ids.length) {
    const gen = await sb.rpc('app_generate_paper', { p_spec: { exam_id: id, count: 3, title: `Canary ${name} ${Date.now()}` } });
    const d = gen.data;
    if (gen.error || d?.error) {
      console.log(`GEN ${name}: BLOCKED: ${(d?.error || gen.error.message).slice(0, 140)}`);
    } else {
      const pid = d?.paper_id;
      console.log(`GEN ${name}: OK paper=${pid} questions=${d?.questions} marks=${d?.total_marks}`);
      if (pid) {
        await sb.from('paper_questions').delete().eq('paper_id', pid);
        await sb.from('papers').delete().eq('id', pid);
      }
    }
  }
}

const quota = await sb.rpc('app_quota_ok', { p_tenant_id: '00000000-0000-0000-0000-000000000001', p_metric: 'PAPERS_GENERATED', p_limit: 5 });
console.log('QUOTA ok(5):', quota.error ? 'ERR ' + quota.error.message : quota.data);

const parent = await sb.rpc('app_parent_dashboard');
console.log('PARENT:', parent.error ? 'ERR ' + parent.error.message : JSON.stringify(parent.data).slice(0, 120));