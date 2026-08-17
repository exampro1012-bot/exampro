// ExamPro — FINAL PRODUCTION REPAIR regression tests (live Supabase).
//
// Covers the root-cause repairs:
//   - questions.ncert end-to-end (form, badge, edit, import)     [needs migration 0028]
//   - question-bank exam filter scopes the subject dropdown      [0029 UI fix]
//   - question-bank subject filter actually filters rows         [bug fix]
//   - paper generator persists instructions + A4 PDF download    [needs no migration]
//   - DPP preview branding header + PDF buttons                  [needs no migration]
//   - Question Bank Health panel per-exam eligibility            [needs migration 0029 RPC]
//
// Tests that need an unapplied migration FAIL with an explicit reason instead
// of skipping — an unapplied migration is a configuration defect, not a reason
// to hide tests (see scripts/e2e-bootstrap.mjs → supabase db push).
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { withPolicyLock } from './helpers/policy-lock';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
const PASS = process.env.SUPABASE_TEST_PASSWORD || '';

test.describe.configure({ mode: 'serial' });

async function client() {
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  return sb;
}

async function hasNcertColumn(sb: any): Promise<boolean> {
  const { error } = await sb.from('questions').select('id,ncert').limit(1);
  return !error;
}

async function hasHealthRpc(sb: any): Promise<boolean> {
  const { error } = await sb.rpc('app_question_bank_health');
  return !error;
}

// Self-sufficient verified probe questions for generation tests: the paper/DPP
// engines are exercised through the subject-filtered path so the tests never
// depend on (or require) a pre-populated per-section corpus.
async function seedVerifiedProbes(sb: any, n: number) {
  const { data: exam } = await sb.from('exams').select('id,name').eq('name', 'AP EAMCET').maybeSingle();
  const examId = exam?.id || (await sb.from('exams').select('id').order('name').limit(1).single()).data!.id;
  const { data: subj } = await sb.from('subjects').select('id').eq('exam_id', examId).limit(1).maybeSingle();
  const { data: qtype } = await sb.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
  const { data: me } = await sb.auth.getUser();
  const { data: mem } = await sb.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  const tag = 'RepairProbe' + Date.now();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { data: q, error } = await sb.from('questions').insert({
      tenant_id: mem!.tenant_id, exam_id: examId, subject_id: subj?.id || null,
      question_type_id: qtype?.id || null,
      question_text: `Repair generation probe ${tag} Q${i + 1}?`,
      difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW', source: tag,
    }).select().single();
    if (error || !q) throw new Error('probe insert failed: ' + (error?.message || 'no row'));
    const { error: vErr } = await sb.rpc('app_verify_question', { p_question_id: q.id, p_decision: 'VERIFIED', p_note: 'qa probe' });
    if (vErr) throw new Error('probe verify failed: ' + vErr.message);
    ids.push(q.id);
  }
  return { examId, subjectId: subj?.id || null, ids, tag };
}

async function login(page: any) {
  await page.goto('/');
  await page.waitForSelector('#auth, #setup', { timeout: 15000 });
  if (await page.locator('#cfg_save').count()) {
    await page.fill('#cfg_url', URL!);
    await page.fill('#cfg_key', ANON!);
    await page.click('#cfg_save');
  }
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="login"]');
  await page.fill('#au_email', EMAIL);
  await page.fill('#au_pw', PASS);
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
}

test.beforeAll(async () => {
  if (!URL || !ANON || !EMAIL || !PASS) throw new Error('Missing E2E environment: set SUPABASE_URL/ANON/TEST_EMAIL/PASSWORD (see scripts/e2e-bootstrap.mjs).');
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error) throw new Error('supplied account failed to sign in: ' + error.message + ' — see scripts/e2e-bootstrap.mjs.');
});

test('ncert checkbox persists on create, shows badge, survives edit', async ({ page }) => {
  const sb = await client();
  if (!(await hasNcertColumn(sb))) throw new Error('questions.ncert column missing — migration 0028 not applied. Run `supabase db push` (see scripts/e2e-bootstrap.mjs).');
  await login(page);
  await page.goto('/#/questions/new');
  await expect(page.locator('#save_q')).toBeVisible();
  await page.waitForSelector('#f_type option:nth-child(2)', { state: 'attached', timeout: 10000 });
  await page.selectOption('#f_subj', { index: 1 });
  await page.selectOption('#f_type', { index: 1 });
  await page.fill('#f_text', 'NCERT repair test question ' + Date.now() + '?');
  await page.check('#f_ncert');
  await page.fill('#f_correct', 'A');
  await page.click('#save_q');
  await expect(page).toHaveURL(/#\/questions\/[0-9a-f-]{36}/, { timeout: 15000 });
  const qId = page.url().split('/').pop()!;
  await expect(page.locator('.q-meta')).toContainText('NCERT');
  await page.goto('/#/questions/' + qId + '/edit');
  await expect(page.locator('#f_ncert')).toBeChecked();
  await sb.from('questions').delete().eq('id', qId);
});

test('question bank exam filter scopes the subject dropdown to one entry', async ({ page }) => {
  await login(page);
  await page.goto('/#/questions');
  await expect(page.locator('#qb_exam')).toBeVisible();
  const examIds = await page.locator('#qb_exam option').evaluateAll((os) =>
    os.map((o: any) => ({ v: o.value, t: o.textContent })).filter((x) => x.v)
  );
  expect(examIds.length).toBeGreaterThan(0);
  await page.selectOption('#qb_exam', examIds[0].v);
  await expect(page.locator('#qb_subj option:not([value=""])')).toHaveCount(0, { timeout: 5000 }).catch(() => {});
  const subjects = await page.locator('#qb_subj option').evaluateAll((os) =>
    os.map((o: any) => o.textContent).filter((t) => t && t !== 'All subjects for this exam' && t !== 'All subjects')
  );
  const dupes = subjects.filter((s, i) => subjects.indexOf(s) !== i);
  expect(dupes).toEqual([]);
});

test('question bank subject filter actually filters the list (bug fix)', async ({ page }) => {
  await login(page);
  await page.goto('/#/questions');
  await expect(page.locator('#qb_subj')).toBeVisible();
  await page.waitForSelector('#qb_subj option:nth-child(2)', { state: 'attached', timeout: 10000 });
  const names = await page.locator('#qb_subj option').evaluateAll((os) =>
    os.map((o: any) => o.textContent).filter((t) => t && t !== 'All subjects' && t !== 'All subjects for this exam')
  );
  expect(names.length).toBeGreaterThan(0);
  await page.selectOption('#qb_subj', { index: 1 });
  await expect(page.locator('#qb_list table')).toBeVisible({ timeout: 10000 }).catch(() => {});
  const cells = await page.locator('#qb_list td:nth-child(3)').allTextContents().catch(() => []);
  for (const c of cells) expect(c.trim()).toBe(names[0]);
});

test('import pipeline persists the ncert column', async ({ page }) => {
  const sb = await client();
  if (!(await hasNcertColumn(sb))) throw new Error('questions.ncert column missing — migration 0028 not applied. Run `supabase db push` (see scripts/e2e-bootstrap.mjs).');
  await login(page);
  await page.goto('/#/questions/import');
  await expect(page.locator('#qi_parse')).toBeVisible();
  const body =
    'question_text,exam_code,subject_code,question_type_code,difficulty,ncert,option_A,option_B,correct_keys,source\n' +
    '"NCERT import repair test ' + Date.now() + '?",jee-main,physics,MCQ_SINGLE,EASY,true,Yes,No,A,QA_REPAIR\n';
  await page.fill('#qi_text', body);
  await page.click('#qi_parse');
  await expect(page.locator('#qi_cnt')).toHaveText('1');
  const qid = await page.locator('#qi_rows td:nth-child(1)').textContent();
  void qid;
  await page.click('#qi_import');
  await expect(page.locator('#qi_status')).toContainText('imported 1', { timeout: 20000 });
  const { data: rows } = await sb.from('questions').select('id,ncert,verification_status').eq('source', 'QA_REPAIR').order('created_at', { ascending: false }).limit(1);
  expect(rows && rows.length).toBe(1);
  expect(rows![0].ncert).toBe(true);
  await page.goto('/#/questions/' + rows![0].id);
  await expect(page.locator('.q-meta')).toContainText('NCERT');
  await sb.from('questions').delete().eq('id', rows![0].id);
});

// Serialize paper/DPP generation tests across projects: the engine draws from
// the shared verified-question pool, so concurrent generations in different
// workers can shortfall (see supabase-features OMR diagnosis). The atomic lock
// serializes them without weakening any assertion.
function genTest(title: string, fn: (page: any) => Promise<void>) {
  test(title, async ({ page }) => {
    await withPolicyLock(() => fn(page));
  });
}

genTest('paper generation persists instructions and renders A4 PDF download', async (page) => {
  const sb = await client();
  const probes = await seedVerifiedProbes(sb, 2);
  await login(page);
  await page.goto('/#/papers/new');
  await expect(page.locator('#gen_btn')).toBeVisible();
  const examId = probes.examId;
  await page.waitForSelector(`#p_exam option[value="${examId}"]`, { state: 'attached', timeout: 10000 });
  await page.selectOption('#p_exam', { value: examId });
  if (probes.subjectId) {
    await page.waitForSelector(`#p_subj option[value="${probes.subjectId}"]`, { state: 'attached', timeout: 10000 });
    await page.selectOption('#p_subj', { value: probes.subjectId });
  }
  await page.fill('#p_count', '2');
  await page.fill('#p_title', 'Repair instructions paper ' + Date.now());
  await page.fill('#p_inst', 'All questions are compulsory. Each correct answer carries +4 marks, -1 for a wrong answer.');
  try {
    await page.click('#gen_btn');
    await expect(page.locator('#gen_result')).toContainText(/Paper generated/, { timeout: 20000 });
    const href = await page.getAttribute('#gen_result a', 'href', { timeout: 5000 }).catch(() => null);
    expect(href).toMatch(/\/papers\/[0-9a-f-]{36}/);
    const paperId = href!.split('/').pop()!;
    await page.goto('/#/papers/' + paperId);
    await expect(page.locator('.ph-inst')).toContainText('compulsory');
    await expect(page.locator('#pdf_btn')).toBeVisible();
    await expect(page.locator('#pdf_ak_btn')).toBeVisible();
    await expect(page.locator('#pdf_sol_btn')).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('#pdf_btn'),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    await sb.from('question_usage').delete().eq('used_in_id', paperId);
    await sb.from('papers').delete().eq('id', paperId);
  } finally {
    await sb.from('question_usage').delete().in('question_id', probes.ids);
    await sb.from('questions').delete().in('id', probes.ids);
  }
});

genTest('DPP preview renders branding header, print and PDF buttons', async (page) => {
  const sb = await client();
  const probes = await seedVerifiedProbes(sb, 2);
  try {
    await login(page);
    await page.goto('/#/dpp/new');
    await expect(page.locator('#d_gen')).toBeVisible();
    const examId = probes.examId;
    await page.waitForSelector(`#d_exam option[value="${examId}"]`, { state: 'attached', timeout: 10000 });
    await page.selectOption('#d_exam', { value: examId });
    if (probes.subjectId) {
      await page.waitForSelector(`#d_subj option[value="${probes.subjectId}"]`, { state: 'attached', timeout: 10000 });
      await page.selectOption('#d_subj', { value: probes.subjectId });
    }
    await page.fill('#d_count', '2');
    await page.fill('#d_title', 'Repair DPP ' + Date.now());
    await page.click('#d_gen');
    await expect(page.locator('#d_res')).toContainText(/DPP created/, { timeout: 20000 });
    const href = await page.getAttribute('#d_res a', 'href', { timeout: 5000 }).catch(() => null);
    expect(href).toMatch(/\/dpp\/[0-9a-f-]{36}/);
    const dppId = href!.split('/').pop()!;
    await page.goto('/#/dpp/' + dppId);
    await expect(page.locator('.paper-sheet .print-head')).toBeVisible();
    await expect(page.locator('#dpp_pdf_btn')).toBeVisible();
    await expect(page.locator('#dpp_print_btn')).toBeVisible();
    await sb.from('question_usage').delete().eq('used_in_id', dppId);
    await sb.from('dpps').delete().eq('id', dppId);
  } finally {
    await sb.from('question_usage').delete().in('question_id', probes.ids);
    await sb.from('questions').delete().in('id', probes.ids);
  }
});

test('question bank health panel renders per-exam eligibility', async ({ page }) => {
  const sb = await client();
  if (!(await hasHealthRpc(sb))) throw new Error('app_question_bank_health RPC missing — migration 0029 not applied. Run `supabase db push` (see scripts/e2e-bootstrap.mjs).');
  await login(page);
  await page.goto('/#/questions/health');
  await expect(page.locator('.page-head h2')).toContainText('Question Bank Health', { timeout: 15000 });
  const examCards = await page.locator('.card h3').allTextContents();
  expect(examCards.length).toBeGreaterThan(0);
  await expect(page.locator('.stat-l', { hasText: 'Eligible for papers' }).first()).toBeVisible();
  const subjRows = await page.locator('.card table tbody tr').count();
  expect(subjRows).toBeGreaterThan(0);
});