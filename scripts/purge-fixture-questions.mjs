// Purge fabricated/demo/test questions from the live question bank.
//
// The bank must contain only real ingestion output (any verification status)
// and genuinely verified content — never fabricated placeholder rows marked
// VERIFIED (which can silently flow into generated papers).
//
// Deletes ONLY rows matching unambiguous fixture signatures:
//   - source = 'SEED_AUTOMATED'                       (root seed-questions.mjs output: "seed Q1 …")
//   - source = 'ExamPro Synthetic QA Set'              (labeled synthetic demo set)
//   - source = 'QA_REPAIR'                            (import-repair spec leftovers)
//   - source IS NULL                                  ("Routing test question …", "PaperGen probe …")
//   - source ~ '^(INGEST|AKQ|VQ|STORE|AISOL)[0-9]+$'  (Playwright suite Date.now() tags)
//   - question_text like 'RepairProbe%' / 'ExamFlow sample question %' / 'E2E sample question %'
//
// question_index, paper_questions, question_usage, practice_logs, bookmarks,
// question_reviews and question_duplicates cascade on question delete.
// Dry-run with DRY_RUN=1. Writes a before/after snapshot to stdout.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASSWORD = process.env.SUPABASE_TEST_PASSWORD;
if (!URL || !ANON || !EMAIL || !PASSWORD) {
  console.error('set SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_TEST_EMAIL/SUPABASE_TEST_PASSWORD');
  process.exit(2);
}
const DRY = process.env.DRY_RUN === '1';

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) { console.error('login failed:', authErr.message); process.exit(2); }

const FIXTURE_SOURCES = ['SEED_AUTOMATED', 'ExamPro Synthetic QA Set', 'QA_REPAIR'];
const SUITE_TAG_RE = /^(INGEST|AKQ|VQ|STORE|AISOL|GATEGUARD|FeatProbe|DriveProbe|RepairProbe|PracticeProbe)[0-9]+$/;
const FIXTURE_TEXT_RE = /^(RepairProbe|ExamFlow sample question |E2E sample question )/;

// ---- snapshot ----
const { data: all } = await sb.from('questions').select('id, source, question_text, verification_status').limit(5000);
const categorize = (q) => {
  if (q.source && FIXTURE_SOURCES.includes(q.source)) return 'named-fixture-source';
  if (SUITE_TAG_RE.test(q.source || '')) return 'suite-tag';
  if (!q.source) return 'null-source';
  if (FIXTURE_TEXT_RE.test(q.question_text || '')) return 'fixture-text';
  return 'keep';
};
const buckets = { 'named-fixture-source': [], 'suite-tag': [], 'null-source': [], 'fixture-text': [], keep: [] };
for (const q of all || []) buckets[categorize(q)].push(q);

const stats = await sb.rpc('app_question_corpus_stats');
console.log('BEFORE corpus stats:', JSON.stringify(stats.data));
for (const [k, rows] of Object.entries(buckets)) {
  const verified = rows.filter((r) => r.verification_status === 'VERIFIED').length;
  console.log(`bucket ${k}: ${rows.length} rows (${verified} marked VERIFIED)`);
}
fs.writeFileSync('purge-fixture-snapshot.json', JSON.stringify({
  at: new Date().toISOString(),
  dryRun: DRY,
  before: { total: (all || []).length, buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])) },
  deleted: { ids: Object.entries(buckets).filter(([k]) => k !== 'keep').flatMap(([, v]) => v.map((r) => r.id)) },
}, null, 2));

const doomed = [...buckets['named-fixture-source'], ...buckets['suite-tag'], ...buckets['null-source'], ...buckets['fixture-text']];
if (!doomed.length) { console.log('nothing to purge'); process.exit(0); }
if (DRY) { console.log(`[DRY] would delete ${doomed.length} fixture questions`); process.exit(0); }

// delete in chunks of 200 (URL length safety)
let deleted = 0;
for (let i = 0; i < doomed.length; i += 200) {
  const chunk = doomed.slice(i, i + 200).map((q) => q.id);
  const { count, error } = await sb.from('questions').delete().in('id', chunk, { count: 'exact' });
  if (error) { console.error(`delete chunk failed: ${error.message}`); process.exit(1); }
  deleted += count || 0;
}
console.log(`deleted ${deleted} fixture questions`);

const after = await sb.rpc('app_question_corpus_stats');
console.log('AFTER corpus stats:', JSON.stringify(after.data));
const { data: remaining } = await sb.from('questions').select('source, verification_status').limit(5000);
const bySource = {};
for (const r of remaining || []) { const k = r.source || '(null)'; bySource[k] = (bySource[k] || 0) + 1; }
console.log('remaining by source:', JSON.stringify(bySource));
