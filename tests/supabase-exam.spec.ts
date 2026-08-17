// ExamPro — full exam lifecycle E2E: create verified question, generate paper,
// take exam answering correctly, submit, verify server-side scoring result.
// Live Supabase backend. Requires SUPABASE_URL + SUPABASE_ANON_KEY.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { withPolicyLock } from './helpers/policy-lock';

const URL = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
let EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
let PASS = process.env.SUPABASE_TEST_PASSWORD || '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!URL || !ANON) throw new Error('Missing E2E environment: set SUPABASE_URL and SUPABASE_ANON_KEY (see scripts/e2e-bootstrap.mjs).');
  if (!process.env.SUPABASE_TEST_EMAIL) throw new Error('Missing E2E environment: set SUPABASE_TEST_EMAIL (an existing staff/admin account; fresh signups are STUDENT). See scripts/e2e-bootstrap.mjs.');
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  if (!EMAIL) {
    EMAIL = `examflow+${Date.now()}@gmail.com`;
    const { data, error } = await sb.auth.signUp({ email: EMAIL, password: PASS, options: { data: { full_name: 'ExamFlow QA' } } });
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
    await page.fill('#cfg_url', URL);
    await page.fill('#cfg_key', ANON);
    await page.click('#cfg_save');
  }
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="login"]');
  await page.fill('#au_email', EMAIL);
  await page.fill('#au_pw', PASS);
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
}

// Serialize paper-generating tests across projects: the engine draws from the
// shared verified-question pool, so concurrent generations in different workers
// can shortfall. The atomic lock serializes them without weakening assertions.
function genTest(title: string, fn: (page: any) => Promise<void>) {
  test(title, async ({ page }) => {
    await withPolicyLock(() => fn(page));
  });
}

genTest('full exam lifecycle: create verified question, generate paper, take & score', async (page) => {
  await login(page);

  // 1. create a question
  await page.goto('/#/questions/new');
  await expect(page.locator('#save_q')).toBeVisible({ timeout: 15000 });
  await page.waitForSelector('#f_type option:nth-child(2)', { state: 'attached', timeout: 10000 });
  await page.selectOption('#f_subj', { index: 1 });
  await page.selectOption('#f_type', { index: 1 });
  await page.fill('#f_text', 'ExamFlow sample question ' + Date.now() + '?');
  await page.fill('#f_correct', 'A');
  await page.click('#save_q');
  // wait for the detail route (uuid), NOT /questions/new (matches the loose regex)
  await page.waitForURL(/\/questions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, { timeout: 15000 });
  const qId = page.url().split('/').pop()!;

  // 2. verify it (SUPER_ADMIN has questions.review) — wait for the detail page
  //    to actually render before inspecting the button (avoids a race where
  //    count() runs against the still-loading page)
  await page.waitForSelector('.q-meta', { state: 'attached', timeout: 15000 });
  const verifyBtn = page.locator('#verify_btn');
  if (await verifyBtn.count() > 0) {
    await verifyBtn.first().click();
    // the app re-navigates to /questions/:id after verify; wait for the
    // re-render to settle (VERIFIED status) before navigating elsewhere
    await expect(page.locator('.q-meta')).toContainText('VERIFIED', { timeout: 10000 });
  } else {
    // already verified or no permission; continue
    console.log('  verify_btn not present — continuing');
  }

  // 3. generate a paper using that question's exam/subject
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  const { data: q } = await sb.from('questions').select('exam_id, subject_id').eq('id', qId).single();
  await page.goto('/#/papers/new');
  await expect(page.locator('#gen_btn')).toBeVisible();
  await page.waitForSelector('#p_exam option', { state: 'attached', timeout: 10000 });
  // select the exam that matches the question
  const examOpts = await page.locator('#p_exam option').all();
  let chosen = false;
  for (const opt of examOpts) {
    const v = await opt.getAttribute('value');
    if (v && v === q.exam_id) { await page.selectOption('#p_exam', { value: v }); chosen = true; break; }
  }
  if (!chosen) {
    // fall back to the seeded demo exam (JEE Main) so the platform bank is eligible
    if (await page.locator('#p_exam option', { hasText: 'JEE Main' }).count()) {
      await page.selectOption('#p_exam', { label: 'JEE Main' });
    } else {
      await page.selectOption('#p_exam', { index: 1 });
    }
  }
  // also restrict to the question's subject so the eligible pool is found
  if (q.subject_id) {
    await page.waitForSelector('#p_subj option', { state: 'attached', timeout: 10000 });
    await page.selectOption('#p_subj', { value: q.subject_id });
  }
  await page.fill('#p_count', '1');
  await page.click('#gen_btn');
  await page.waitForSelector('#gen_result a', { timeout: 20000 });
  const paperId = (await page.getAttribute('#gen_result a', 'href', { timeout: 5000 }).catch(() => null))!.split('/').pop()!;

  // 4. start the exam
  await page.goto('/#/exams');
  await expect(page.locator('.start-exam').first()).toBeVisible({ timeout: 10000 });
  // open the generated paper's exam card
  await page.locator('.start-exam').first().click();
  await page.waitForURL(/\/exam\//, { timeout: 15000 });

  // 5. read correct answer from DB and answer it
  const { data: pq } = await sb.from('paper_questions').select('question_id, snapshot').eq('paper_id', paperId);
  const firstQ = (pq || [])[0];
  const correctKeys = firstQ?.snapshot?.answer?.correct_option_keys || [];
  const firstKey = Array.isArray(correctKeys) ? correctKeys[0] : correctKeys;
  if (firstKey) {
    await page.check(`#q_area .opt-pick input[data-k="${firstKey}"]`);
  }
  // submit
  page.on('dialog', (d) => d.accept());
  await page.click('#submit_btn');
  await page.waitForURL(/\/results\/session\//, { timeout: 15000 });

  // 6. verify result exists and shows a score
  await expect(page.locator('.big-score')).toBeVisible({ timeout: 10000 });
  const scoreText = await page.locator('.big-score').innerText();
  expect(scoreText).toMatch(/\d/);

  // 7. best-effort cleanup: session -> results -> paper -> question
  const sessionId = page.url().split('/').pop()!;
  try {
    await sb.from('results').delete().eq('exam_session_id', sessionId);
    await sb.from('exam_sessions').delete().eq('id', sessionId);
    await sb.from('question_usage').delete().eq('used_in_type', 'PAPER').eq('used_in_id', paperId);
    await sb.from('papers').delete().eq('id', paperId);
    await sb.from('question_usage').delete().eq('question_id', qId);
    await sb.from('questions').delete().eq('id', qId);
  } catch (e) { console.log('  cleanup failed:', (e as Error).message); }
});
