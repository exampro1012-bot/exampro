// One-time cleanup of rows created by the QA suite against the live DB.
// Deletes only rows matching the suite's own artifact patterns:
//   - papers: title 'Generated Paper' (exam-lifecycle test) or 'perf-test-%'
//   - questions: question_text 'ExamFlow sample question %' / 'E2E sample question %'
//   - OMR: templates named 'QA OMR %' (and their sheets)
//   - question_usage rows referencing the deleted papers
// Child rows are removed first where the FK does not cascade, then the roots
// (paper_questions / practice_logs / bookmarks / question_reviews /
//  question_duplicates cascade automatically).
// Uses the same RLS-scoped admin session as the app. Dry-run with DRY_RUN=1.

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASSWORD = process.env.SUPABASE_TEST_PASSWORD;
if (!URL || !ANON || !EMAIL || !PASSWORD) { console.error('set SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_TEST_EMAIL/SUPABASE_TEST_PASSWORD'); process.exit(2); }
const DRY = process.env.DRY_RUN === '1';

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) { console.error('login failed:', authErr.message); process.exit(2); }

const log = (msg) => console.log((DRY ? '[DRY] ' : '') + msg);
const del = async (table, filter) => {
  if (DRY) { log(`would delete from ${table}`); return 0; }
  const { count, error } = await sb.from(table).delete(filter, { count: 'exact' });
  if (error) throw new Error(`${table} delete: ${error.message}`);
  return count;
};

const totals = { papers: 0, sessions: 0, usage: 0, questions: 0, templates: 0, sheets: 0 };

// ---- 1. test papers ----
const { data: papers, error: pe } = await sb.from('papers').select('id,title').or('title.eq.Generated Paper,title.like.perf-test-%');
if (pe) throw new Error('papers select: ' + pe.message);
if (papers.length) {
  const ids = papers.map(p => p.id);
  const { count: sc, error: se } = await sb.from('exam_sessions').delete().in('paper_id', ids, { count: 'exact' });
  if (se) throw new Error('exam_sessions delete: ' + se.message);
  totals.sessions = sc || 0;
  const { count: uc, error: ue } = await sb.from('question_usage').delete().eq('used_in_type', 'PAPER').in('used_in_id', ids, { count: 'exact' });
  if (ue) throw new Error('question_usage delete: ' + ue.message);
  totals.usage = uc || 0;
  const { count: dc, error: de } = await sb.from('papers').delete().in('id', ids, { count: 'exact' });
  if (de) throw new Error('papers delete: ' + de.message);
  totals.papers = dc || 0;
  log(`papers deleted: ${dc} (${papers.map(p => p.title).join(', ')})`);
} else log('no test papers found');

// ---- 2. test questions (cascade cleans practice_logs/bookmarks/reviews/duplicates/usage/paper_questions) ----
const { data: questions, error: qe } = await sb.from('questions').select('id,question_text').or('question_text.like.ExamFlow sample question %,question_text.like.E2E sample question %');
if (qe) throw new Error('questions select: ' + qe.message);
if (questions.length) {
  const ids = questions.map(q => q.id);
  const { count: dc, error: de } = await sb.from('questions').delete().in('id', ids, { count: 'exact' });
  if (de) throw new Error('questions delete: ' + de.message);
  totals.questions = dc || 0;
  log(`questions deleted: ${dc}`);
} else log('no test questions found');

// ---- 3. OMR test templates + their sheets ----
const { data: tpls, error: te } = await sb.from('omr_templates').select('id,name').like('name', 'QA OMR %');
if (te) throw new Error('omr_templates select: ' + te.message);
if (tpls.length) {
  const ids = tpls.map(t => t.id);
  const { count: shc, error: she } = await sb.from('omr_sheets').delete().in('template_id', ids, { count: 'exact' });
  if (she) throw new Error('omr_sheets delete: ' + she.message);
  totals.sheets = shc || 0;
  const { count: dc, error: de } = await sb.from('omr_templates').delete().in('id', ids, { count: 'exact' });
  if (de) throw new Error('omr_templates delete: ' + de.message);
  totals.templates = dc || 0;
  log(`omr templates deleted: ${dc}, sheets: ${shc}`);
} else log('no QA OMR templates found');

// ---- 4. empty result husks (rows whose session+paper were both deleted) ----
if (DRY) {
  log('would delete result husks (exam_session_id + paper_id both null)');
} else {
  const { count: hc, error: he } = await sb.from('results').delete().is('exam_session_id', null).is('paper_id', null, { count: 'exact' });
  if (he) throw new Error('results husks delete: ' + he.message);
  if (hc) { totals.results = hc; log(`result husks deleted: ${hc}`); } else log('no result husks found');
}

console.log('cleanup totals:', JSON.stringify(totals));
console.log(DRY ? '(dry run — nothing changed)' : 'done');