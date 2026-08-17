// ExamPro — live performance measurement (Phase 13).
// Measures API-level query latency (filters, search, pagination) and paper
// generation timing against the real Supabase backend. Uses the admin test
// account. Writes results to perf-results.json. Never loads questions into a
// browser.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASS = process.env.SUPABASE_TEST_PASSWORD;
if (!URL || !ANON || !EMAIL || !PASS) { console.error('env vars required'); process.exit(1); }

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
if (error) { console.error('login failed:', error.message); process.exit(1); }

const results = { at: new Date().toISOString(), queries: [], generations: [] };

async function timed(name, fn) {
  const t0 = performance.now();
  const out = await fn();
  const ms = Math.round(performance.now() - t0);
  results.queries.push({ name, ms, rows: out?.rows ?? null, count: out?.count ?? null });
  console.log(`${name.padEnd(46)} ${String(ms).padStart(6)} ms  ${out?.count !== undefined ? 'count=' + out.count : ''}`);
  return out;
}

const page = (n) => ({ range: { from: (n - 1) * 20, to: n * 20 - 1 }, count: 'exact' });

const examId = (await sb.from('exams').select('id').limit(1)).data[0].id;
const subjectId = (await sb.from('subjects').select('id').limit(1)).data[0].id;
const chapterId = (await sb.from('chapters').select('id').limit(1)).data[0].id;

await timed('list questions page 1 (20 rows, exact count)', () => sb.from('questions').select('*', page(1)).order('created_at', { ascending: false }));
await timed('filter: exam_id', () => sb.from('questions').select('*', page(1)).eq('exam_id', examId));
await timed('filter: subject_id', () => sb.from('questions').select('*', page(1)).eq('subject_id', subjectId));
await timed('filter: chapter_id', () => sb.from('questions').select('*', page(1)).eq('chapter_id', chapterId));
await timed('filter: difficulty=MEDIUM', () => sb.from('questions').select('*', page(1)).eq('difficulty', 'MEDIUM'));
await timed('filter: verification=VERIFIED', () => sb.from('questions').select('*', page(1)).eq('verification_status', 'VERIFIED'));
await timed('filter: year=2024', () => sb.from('questions').select('*', page(1)).eq('year', 2024));
await timed('filter: exam+subject+chapter composite', () => sb.from('questions').select('*', page(1)).eq('exam_id', examId).eq('subject_id', subjectId).eq('chapter_id', chapterId));
await timed('search: text ilike %vector%', () => sb.from('questions').select('*', page(1)).ilike('question_text', '%vector%'));
await timed('pagination: page 5', () => sb.from('questions').select('*', page(5)).order('created_at', { ascending: false }));
await timed('count only', () => sb.from('questions').select('*', { count: 'exact', head: true }));
await timed('question detail + options + answer (3 queries)', async () => {
  const q = (await sb.from('questions').select('*').limit(1)).data[0];
  const [o, a] = await Promise.all([
    sb.from('question_options').select('*').eq('question_id', q.id),
    sb.from('question_answers').select('*').eq('question_id', q.id),
  ]);
  return { rows: (o.data?.length || 0) + (a.data?.length || 0) };
});

// paper generation timing (respects quota — usage was reset per-run by specs).
// Dataset is small (53 questions total, 8 verified in jee-main), so realistic
// counts are used; the RPC path (advisory lock, quota gate, reservoir sampling)
// is identical at larger scale.
for (const count of [5, 8]) {
  const spec = {
    exam_id: examId,
    count,
    title: `perf-test-${count}-${Date.now()}`,
    marks: 4, negative_marks: 1, duration_minutes: 180,
    filters: { language: 'EN' },
  };
  const t0 = performance.now();
  const { data, error: genErr } = await sb.rpc('app_generate_paper', { p_spec: spec });
  const ms = Math.round(performance.now() - t0);
  results.generations.push({ count, ms, error: genErr?.message ?? data?.error ?? null });
  console.log(`generate paper (${count}q)${' '.repeat(28 - String(count).length)} ${String(ms).padStart(6)} ms  ${genErr || data?.error ? 'ERR: ' + (genErr?.message || data?.error) : 'OK'}`);
}

// question-bank aggregate query used by analytics
await timed('analytics: questions by subject (grouped)', () => sb.from('questions').select('subject_id, subject:subjects(code)').neq('is_deleted', true));

await import('fs').then(fs => fs.writeFileSync('perf-results.json', JSON.stringify(results, null, 2)));
console.log('\nwrote perf-results.json');