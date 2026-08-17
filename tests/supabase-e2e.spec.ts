// ExamPro — end-to-end journey against a LIVE Supabase project.
// Requires migrations + seed applied, and these env vars:
//   SUPABASE_URL, SUPABASE_ANON_KEY  (required; tests skip without them)
// The first signed-up user becomes a platform admin in a fresh project.
//
// NOTE: automated sign-up requires email confirmation to be DISABLED in the
// Supabase project (Authentication → Providers → Email → "Confirm email"),
// or supply SUPABASE_TEST_EMAIL/PASSWORD for a pre-confirmed account.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { withPolicyLock } from './helpers/policy-lock';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
// One account is created up-front and reused (avoids Supabase sign-up rate limits).
let EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
let PASS = process.env.SUPABASE_TEST_PASSWORD || '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!URL || !ANON) throw new Error('Missing E2E environment: set SUPABASE_URL and SUPABASE_ANON_KEY (see scripts/e2e-bootstrap.mjs).');
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  // Use a supplied account if given; otherwise create one shared QA account.
  if (!EMAIL) {
    EMAIL = `qa+${Date.now()}@gmail.com`;
    const { data, error } = await sb.auth.signUp({ email: EMAIL, password: PASS, options: { data: { role: 'STUDENT', full_name: 'QA User' } } });
    if (error && /signups? not allowed|not allowed for this instance|domain|invalid/i.test(error.message)) {
      throw new Error('sign-up blocked by project Auth policy: ' + error.message + ' — enable "Allow new users to sign up" or provide SUPABASE_TEST_EMAIL/PASSWORD.');
    }
    if (!data || !data.session) {
      throw new Error('email confirmation is enabled — disable it (Auth → Providers → Email) or provide a pre-confirmed SUPABASE_TEST_EMAIL/PASSWORD.');
    }
  } else {
    // Verify a supplied account can actually authenticate.
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

test('authenticated shell renders (sidebar desktop, bottom nav mobile)', async ({ page, isMobile }) => {
  await login(page);
  await expect(page.locator('.sidebar')).toBeVisible();
  if (isMobile) await expect(page.locator('.bottom-nav')).toBeVisible();
});

test('user can create a question via the Supabase backend', async ({ page }) => {
  if (!process.env.SUPABASE_TEST_EMAIL) throw new Error('Missing E2E environment: set SUPABASE_TEST_EMAIL (staff account) — see scripts/e2e-bootstrap.mjs.');
  await login(page);
  await page.goto('/#/questions/new');
  await expect(page.locator('#save_q')).toBeVisible();
  await page.waitForSelector('#f_type option:nth-child(2)', { state: 'attached', timeout: 10000 });
  await page.selectOption('#f_subj', { index: 1 });
  await page.selectOption('#f_type', { index: 1 });
  await page.fill('#f_text', 'E2E sample question ' + Date.now() + '?');
  await page.fill('#f_correct', 'A');
  await page.click('#save_q');
  await expect(page).toHaveURL(/#\/questions\/[0-9a-f-]{36}/, { timeout: 15000 });
  // best-effort cleanup: remove the created question (cascades usage/logs)
  const qId = page.url().split('/').pop()!;
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  try {
    await sb.from('question_usage').delete().eq('question_id', qId);
    await sb.from('questions').delete().eq('id', qId);
  } catch (e) { console.log('  cleanup failed (question):', (e as Error).message); }
});

// Serialize paper-generating tests across projects: the engine draws from the
// shared verified-question pool, so concurrent generations in different workers
// can shortfall. The atomic lock serializes them without weakening assertions.
function genTest(title: string, fn: (page: any) => Promise<void>) {
  test(title, async ({ page }) => {
    await withPolicyLock(() => fn(page));
  });
}

genTest('paper generation engine is callable (rpc app_generate_paper)', async (page) => {
  if (!process.env.SUPABASE_TEST_EMAIL) throw new Error('Missing E2E environment: set SUPABASE_TEST_EMAIL (staff account) — see scripts/e2e-bootstrap.mjs.');
  // self-sufficient: create + verify one question via API so generation has an
  // eligible pool regardless of other tests' cleanup (no leftover dependency)
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  const { data: exam } = await sb.from('exams').select('id,name').eq('name', 'AP EAMCET').maybeSingle();
  const examId = exam?.id || (await sb.from('exams').select('id').order('name').limit(1).single()).data!.id;
  const { data: subj } = await sb.from('subjects').select('id').eq('exam_id', examId).limit(1).maybeSingle();
  const { data: qtype } = await sb.from('question_types').select('id').limit(1).maybeSingle();
  const { data: me } = await sb.auth.getUser();
  const { data: mem } = await sb.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  const { data: q, error: insErr } = await sb.from('questions').insert({
    tenant_id: mem!.tenant_id, exam_id: examId, subject_id: subj?.id || null,
    question_type_id: qtype?.id || null, question_text: 'PaperGen probe question ' + Date.now() + '?',
    difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW',
  }).select().single();
  if (insErr || !q) throw new Error('probe question insert failed: ' + (insErr?.message || 'no row'));
  const { error: vErr } = await sb.rpc('app_verify_question', { p_question_id: q.id, p_decision: 'VERIFIED', p_note: 'qa probe' });
  if (vErr) throw new Error('probe verify failed: ' + vErr.message);

  await login(page);
  await page.goto('/#/papers/new');
  await expect(page.locator('#gen_btn')).toBeVisible();
  await page.waitForSelector(`#p_exam option[value="${examId}"]`, { state: 'attached', timeout: 10000 });
  await page.selectOption('#p_exam', { value: examId });
  // Wait until the exam-change handlers have settled (the pattern info box
  // fills asynchronously). Selecting the subject before this completes races
  // the form's syncSubjects() reset, silently dropping the filter — which
  // flips generation into pattern section mode and fails for the wrong reason.
  await page.waitForFunction(
    () => ((document.querySelector('#p_pattern_info') as HTMLElement)?.textContent || '').trim().length > 0,
    undefined, { timeout: 10000 });
  // Scope to the probe question's subject: this exercises the subject-filtered
  // generation path (section mode off), so the test needs only its own verified
  // probe question instead of a full per-section corpus.
  if (subj?.id) {
    await page.waitForSelector(`#p_subj option[value="${subj.id}"]`, { state: 'attached', timeout: 10000 });
    await page.selectOption('#p_subj', { value: subj.id });
    // Prove the selection stuck before generating (guards the async-reset race).
    expect(await page.inputValue('#p_subj')).toBe(subj.id);
  }
  await page.fill('#p_count', '1');
  await page.click('#gen_btn');
  await expect(page.locator('#gen_result')).toContainText(/Paper generated/, { timeout: 20000 });

  // best-effort cleanup: delete the generated paper + usage rows + probe question
  try {
    const href = await page.getAttribute('#gen_result a', 'href', { timeout: 5000 }).catch(() => null);
    if (href) {
      const paperId = href.split('/').pop()!;
      await sb.from('question_usage').delete().eq('used_in_type', 'PAPER').eq('used_in_id', paperId);
      await sb.from('papers').delete().eq('id', paperId);
    }
    await sb.from('question_usage').delete().eq('question_id', q.id);
    await sb.from('questions').delete().eq('id', q.id);
  } catch (e) { console.log('  cleanup failed (paper):', (e as Error).message); }
});
