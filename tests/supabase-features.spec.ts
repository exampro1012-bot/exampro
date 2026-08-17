// ExamPro — feature E2E: admin CRUD, OMR, param routing, storage upload.
// Live Supabase backend. Requires SUPABASE_URL + SUPABASE_ANON_KEY.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { withPolicyLock } from './helpers/policy-lock';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
let EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
let PASS = process.env.SUPABASE_TEST_PASSWORD || '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!URL || !ANON) throw new Error('Missing E2E environment: set SUPABASE_URL and SUPABASE_ANON_KEY (see scripts/e2e-bootstrap.mjs).');
  if (!process.env.SUPABASE_TEST_EMAIL) throw new Error('Missing E2E environment: set SUPABASE_TEST_EMAIL (an existing staff/admin account; fresh signups are STUDENT). See scripts/e2e-bootstrap.mjs.');
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  if (!EMAIL) {
    EMAIL = `qa+${Date.now()}@gmail.com`;
    const { data, error } = await sb.auth.signUp({ email: EMAIL, password: PASS, options: { data: { full_name: 'QA User' } } });
    if (error && /signups? not allowed|not allowed for this instance|domain|invalid/i.test(error.message)) {
      throw new Error('sign-up blocked: ' + error.message + ' — enable "Allow new users to sign up" or provide SUPABASE_TEST_EMAIL/PASSWORD.');
    }
    if (!data || !data.session) throw new Error('email confirmation enabled — disable it or provide SUPABASE_TEST_EMAIL/PASSWORD.');
  } else {
    const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
    if (error) throw new Error('supplied SUPABASE_TEST_EMAIL/PASSWORD failed to sign in: ' + error.message + ' — see scripts/e2e-bootstrap.mjs.');
    // reset monthly generation quota so the suite is repeatable
    const { data: me } = await sb.auth.getUser();
    const { data: mem } = await sb.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
    if (mem) await sb.from('usage').delete().eq('tenant_id', mem.tenant_id);
  }
});

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

async function navHash(page: any, hash: string) {
  await page.evaluate((h: string) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(400);
}

test('admin: institution CRUD works', async ({ page }) => {
  await login(page);
  await page.goto('/#/admin/institutions');
  await expect(page.locator('#c_name')).toBeVisible();
  await page.fill('#c_name', 'QA Institute ' + Date.now());
  await page.fill('#c_email', 'qa@example.com');
  const instName = await page.inputValue('#c_name');
  await page.click('#c_save');
  await expect(page.locator('table.data-table tbody tr', { hasText: instName })).toHaveCount(1, { timeout: 10000 });
});

// Serialize paper/DPP generation tests across projects: the engine draws from
// the shared verified-question pool (and the monthly usage counter), so two
// concurrent generations in different workers can shortfall or race usage
// resets. The atomic lock serializes them without weakening any assertion.
function genTest(title: string, fn: (page: any) => Promise<void>) {
  test(title, async ({ page }) => {
    await withPolicyLock(() => fn(page));
  });
}

genTest('OMR: template + sheet generation + evaluation', async (page) => {
  const probes = await seedVerifiedProbes(5);
  try {
    await login(page);
    // template
    await page.goto('/#/omr/templates/new');
    await page.fill('#t_name', 'QA OMR ' + Date.now());
    await page.fill('#t_q', '10');
    const tplName = await page.inputValue('#t_name');
    await page.click('#t_save');
    await expect(page.locator('table.data-table tbody tr', { hasText: tplName })).toHaveCount(1, { timeout: 10000 });
    // generate a paper from the test's own verified probes (subject-filtered
    // path — no dependency on a pre-populated corpus)
    await page.goto('/#/papers/new');
    await page.waitForSelector('#p_exam option', { state: 'attached' });
    await page.selectOption('#p_exam', { value: probes.examId });
    if (probes.subjectId) {
      await page.waitForSelector(`#p_subj option[value="${probes.subjectId}"]`, { state: 'attached', timeout: 10000 });
      await page.selectOption('#p_subj', { value: probes.subjectId });
    }
    await page.fill('#p_count', '5');
    await page.click('#gen_btn');
    await page.waitForSelector('#gen_result a', { timeout: 15000 });
    const href = await page.getAttribute('#gen_result a', 'href', { timeout: 5000 });
    if (!href) throw new Error('paper generation link not found in #gen_result');
    const paperId = href.split('/').pop()!;
    // Self-diagnosis: the OMR layout derives its bubble count from
    // paper_questions, so verify the paper's row count right here. If this
    // ever fails, the defect is in paper generation (backend), not in the
    // sheet renderer — the error message includes the page's spec snapshot.
    {
      const { data: pq, error: pqErr } = await probes.sb.from('paper_questions').select('id').eq('paper_id', paperId);
      if (pqErr) throw new Error('paper_questions read failed: ' + pqErr.message);
      if ((pq || []).length !== 5) {
        const { data: spec } = await probes.sb.from('papers').select('p_spec').eq('id', paperId).maybeSingle();
        const { data: used } = await probes.sb.from('question_usage').select('used_in_type, used_in_id').eq('tenant_id', '00000000-0000-0000-0000-000000000001');
        throw new Error(`generated paper ${paperId} has ${(pq || []).length} paper_questions, expected 5 (p_spec=${JSON.stringify(spec?.p_spec)}, usage=${JSON.stringify(used?.length ?? 0)} rows)`);
      }
    }
    // sheet generation (param route /omr/sheets/:id must render, not dashboard)
    await page.goto('/#/omr/sheets/new');
    // Wait for the specific paper option (not just the placeholder) — mobile
    // rendering can be slow and the just-created paper may lag the SELECT.
    await page.waitForSelector(`#s_paper option[value="${paperId}"]`, { state: 'attached', timeout: 15000 });
    await page.selectOption('#s_paper', { value: paperId });
    await page.fill('#s_roll', 'ROLL-1');
    await page.click('#s_gen');
    await page.waitForSelector('#eval_btn', { timeout: 15000 });
    // verify the sheet page rendered (param routing fix) — scannable OMR layout
    await expect(page.locator('.omr-b')).toHaveCount(20); // 5 questions x 4 options
    // OMR bubble selects may need a tick on mobile before interaction is stable
    await page.waitForSelector('#omr_q_1', { state: 'attached', timeout: 5000 });
    await page.selectOption('#omr_q_1', { index: 1 });
    await page.selectOption('#omr_q_2', { index: 1 });
    await page.click('#eval_btn');
    // evaluation re-renders the sheet page with the server-computed Score card
    await expect(page.locator('.score-card')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.score-card')).toContainText(/Correct:/, { timeout: 5000 });

    // best-effort cleanup: sheets + template + generated paper + usage rows
    const c = probes.sb;
    try {
      const { data: tpl } = await c.from('omr_templates').select('id').eq('name', tplName).maybeSingle();
      if (tpl) {
        await c.from('omr_sheets').delete().eq('template_id', tpl.id);
        await c.from('omr_templates').delete().eq('id', tpl.id);
      }
    await c.from('question_usage').delete().eq('used_in_type', 'PAPER').eq('used_in_id', paperId);
    await c.from('papers').delete().eq('id', paperId);
  } catch (e) { console.log('  cleanup failed (OMR):', (e as Error).message); }
  } finally {
    await cleanupProbes(probes.sb, probes.ids);
  }
});

genTest('param routing: /papers/:id and /questions/:id render (not dashboard)', async (page) => {
  const probes = await seedVerifiedProbes(5);
  try {
    await login(page);
    // generate a paper from the test's own verified probes (subject-filtered
    // path — no dependency on a pre-populated corpus)
    await navHash(page, '/papers/new');
    await page.waitForSelector('#p_exam option', { state: 'attached' });
    await page.selectOption('#p_exam', { value: probes.examId });
    if (probes.subjectId) {
      await page.waitForSelector(`#p_subj option[value="${probes.subjectId}"]`, { state: 'attached', timeout: 10000 });
      await page.selectOption('#p_subj', { value: probes.subjectId });
    }
    await page.fill('#p_count', '5');
    // reset the monthly generation quota first so this suite is repeatable
    // even when other suites (drive-e2e) consumed papers in parallel
    const c0 = probes.sb;
    await c0.from('usage').delete().eq('tenant_id', '00000000-0000-0000-0000-000000000001');
    await page.click('#gen_btn');
    await page.waitForSelector('#gen_result a[href*="/papers/"]', { timeout: 15000 });
    await page.click('#gen_result a[href*="/papers/"]');
    await expect(page).toHaveURL(/\/papers\//, { timeout: 10000 });
    await expect(page.locator('#ep_main')).not.toContainText('Dashboard', { timeout: 5000 });
  // create a question, then open its edit route
  await navHash(page, '/questions/new');
  await page.waitForSelector('#f_type option:nth-child(2)', { state: 'attached' });
  await page.selectOption('#f_subj', { index: 1 });
  await page.selectOption('#f_type', { index: 1 });
  await page.fill('#f_text', 'Routing test question ' + Date.now() + '?');
  await page.fill('#f_correct', 'A');
  await page.click('#save_q');
  await page.waitForURL(/\/questions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, { timeout: 15000 });
  const qUrl = page.url();
  await navHash(page, qUrl.split('/#')[1] || '/questions'); // re-open via /questions/:id (param route)
  await expect(page.locator('#ep_main')).not.toContainText('Dashboard', { timeout: 5000 });
  // clean up the routing question so the live bank stays fixture-free
  const routedId = qUrl.split('/').pop()!;
  await probes.sb.from('questions').delete().eq('id', routedId);
  } finally {
    await cleanupProbes(probes.sb, probes.ids);
  }
});

test('storage: branding logo upload works', async ({ page }) => {
  await login(page);
  await page.goto('/#/settings');
  await expect(page.locator('#b_upload')).toBeVisible();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  await page.setInputFiles('#b_logo_file', { name: 'px.png', mimeType: 'image/png', buffer: png });
  await page.click('#b_upload');
  await expect(page.locator('#b_logo_preview img')).toBeVisible({ timeout: 10000 });
  const src = await page.getAttribute('#b_logo_preview img', 'src');
  expect(src).toMatch(/\/storage\/v1\/object\/|drive\.google\.com/);
});

// Signed-in client for server-side data setup (RLS applies to the test user).
async function authedClient() {
  const c = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error || !data.session) throw new Error('re-login failed: ' + (error ? error.message : 'no session'));
  return c;
}

// Self-sufficient verified probe questions: generation flows are exercised via
// the subject-filtered path so tests never depend on a pre-populated corpus.
async function seedVerifiedProbes(n: number) {
  const sb = await authedClient();
  const { data: exam } = await sb.from('exams').select('id,name').eq('name', 'AP EAMCET').maybeSingle();
  const examId = exam?.id || (await sb.from('exams').select('id').order('name').limit(1).single()).data!.id;
  const { data: subj } = await sb.from('subjects').select('id').eq('exam_id', examId).limit(1).maybeSingle();
  const { data: qtype } = await sb.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
  const { data: me } = await sb.auth.getUser();
  const { data: mem } = await sb.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  const tag = 'FeatProbe' + Date.now();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const { data: q, error } = await sb.from('questions').insert({
      tenant_id: mem!.tenant_id, exam_id: examId, subject_id: subj?.id || null,
      question_type_id: qtype?.id || null,
      question_text: `Feature generation probe ${tag} Q${i + 1}?`,
      difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW', source: tag,
    }).select().single();
    if (error || !q) throw new Error('probe insert failed: ' + (error?.message || 'no row'));
    const { error: vErr } = await sb.rpc('app_verify_question', { p_question_id: q.id, p_decision: 'VERIFIED', p_note: 'qa probe' });
    if (vErr) throw new Error('probe verify failed: ' + vErr.message);
    ids.push(q.id);
  }
  return { sb, examId, subjectId: subj?.id || null, ids, tag };
}

async function cleanupProbes(sb: any, ids: string[]) {
  if (!ids.length) return;
  await sb.from('question_usage').delete().in('question_id', ids);
  await sb.from('questions').delete().in('id', ids);
}

test('question bank list page loads (requires migration 0028: questions.ncert)', async ({ page }) => {
  await login(page);
  await page.goto('/#/questions');
  // Regression for schema drift: the list SELECTs questions.ncert; if the live
  // DB lacks the column (migration 0028 not applied), the list shows
  // "column questions.ncert does not exist" and rows never render.
  await expect(page.locator('#qb_list .qtxt').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#qb_list')).not.toContainText('does not exist');
});

// Seed one VERIFIED practice question (chapter + topic + 4 options + answer)
// so student-facing drills are testable without any pre-populated corpus.
async function seedPracticeQuestion() {
  const c = await authedClient();
  const { data: ch } = await c.from('chapters').select('id, subject_id, subjects(exam_id)').limit(1).maybeSingle();
  if (!ch) return null;
  const { data: topic } = await c.from('topics').select('id, name').eq('chapter_id', ch.id).limit(1).maybeSingle();
  const { data: qtype } = await c.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
  const { data: me } = await c.auth.getUser();
  const { data: mem } = await c.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  const tag = 'PracticeProbe' + Date.now();
  const { data: q, error } = await c.from('questions').insert({
    tenant_id: mem!.tenant_id, exam_id: (ch.subjects as any)?.exam_id || null, subject_id: ch.subject_id,
    chapter_id: ch.id, topic_id: topic?.id || null, question_type_id: qtype?.id || null,
    question_text: `Practice drill probe ${tag}: which option is A?`,
    difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW', source: tag,
  }).select().single();
  if (error || !q) throw new Error('practice probe insert failed: ' + (error?.message || 'no row'));
  await c.rpc('app_verify_question', { p_question_id: q.id, p_decision: 'VERIFIED', p_note: 'qa probe' });
  const optErrs: string[] = [];
  for (let i = 0; i < 4; i++) {
    const key = 'ABCD'[i];
    const { error: oErr } = await c.from('question_options').insert({
      question_id: q.id, option_key: key, option_text: `Option ${key} (${tag})`, display_order: i + 1, is_correct: key === 'A',
    });
    if (oErr) optErrs.push(oErr.message);
  }
  const { error: aErr } = await c.from('question_answers').insert({
    question_id: q.id, correct_option_keys: ['A'], answer_type: 'MCQ', source: 'QA_PROBE', verification_status: 'VERIFIED', confidence: 99,
  });
  if (optErrs.length || aErr) throw new Error('practice probe options/answer failed: ' + JSON.stringify({ optErrs, aErr: aErr?.message }));
  return { c, q, topicId: topic?.id || null, topicName: topic?.name || null, tag };
}

test('practice: chapter drill renders the demo question with options and answer', async ({ page }) => {
  const probe = await seedPracticeQuestion();
  if (!probe) throw new Error('No chapters configured for practice seeding — run scripts/e2e-bootstrap.mjs to seed the demo syllabus.');
  try {
    await login(page);
    await navHash(page, '/practice/chapter/' + probe.q.chapter_id);
    await page.waitForSelector('.pq', { timeout: 15000 });
    await expect(page.locator('.pq').first()).toBeVisible();
    await expect(page.locator('.pq .opts li').first()).toBeVisible();
    await page.locator('.pq [data-reveal]').first().click();
    await expect(page.locator('.answer-reveal').first()).toContainText(/Answer:/, { timeout: 5000 });
  } finally {
    await probe.c.from('questions').delete().eq('id', probe.q.id);
  }
});

test('practice: weak-topics surfaces a wrong-answer from history by topic', async ({ page }) => {
  const probe = await seedPracticeQuestion();
  if (!probe || !probe.topicId) throw new Error('No chapters/topics configured for weak-topic seeding — run scripts/e2e-bootstrap.mjs to seed the demo syllabus.');
  const c = probe.c;
  const { data: me } = await c.auth.getUser();
  const { data: inserted } = await c.from('practice_logs').insert({ user_id: me.user!.id, question_id: probe.q.id, correct: false, time_spent: 0 }).select().single();
  try {
    await login(page);
    await navHash(page, '/weak-topics');
    await page.waitForSelector('h3', { timeout: 15000 });
    await expect(page.locator('h3', { hasText: 'Topics to improve' })).toBeVisible();
    await expect(page.locator('.data-table tbody tr', { hasText: probe.topicName! }).first()).toBeVisible({ timeout: 10000 });
  } finally {
    if (inserted?.id) await c.from('practice_logs').delete().eq('id', inserted.id);
    await c.from('questions').delete().eq('id', probe.q.id);
  }
});

test('revision: bookmarked question renders with options', async ({ page }) => {
  const probe = await seedPracticeQuestion();
  if (!probe) throw new Error('No chapters configured for revision seeding — run scripts/e2e-bootstrap.mjs to seed the demo syllabus.');
  const c = probe.c;
  const { data: me } = await c.auth.getUser();
  await c.from('bookmarks').insert({ user_id: me.user!.id, question_id: probe.q.id });
  try {
    await login(page);
    await navHash(page, '/revision');
    await page.waitForSelector('.pq', { timeout: 15000 });
    await expect(page.locator('.pq .opts li').first()).toBeVisible({ timeout: 5000 });
  } finally {
    await c.from('bookmarks').delete().eq('question_id', probe.q.id);
    await c.from('questions').delete().eq('id', probe.q.id);
  }
});

test('parent dashboard RPC is deployed (migration 0043: app_parent_dashboard)', async ({ page }) => {
  await login(page);
  const c = await authedClient();
  const { data, error } = await c.rpc('app_parent_dashboard', {});
  // The admin account has no linked ward, so a correct deployment returns the
  // empty dashboard shape; a missing RPC returns 42801 "function not found".
  expect(error).toBeNull();
  expect(data).toBeDefined();
});
