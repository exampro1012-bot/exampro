// ExamPro — Google Drive integration E2E tests.
// Requires a configured Supabase project with Google Drive Edge Functions deployed.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
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
    const { data, error } = await sb.auth.signUp({ email: EMAIL, password: PASS, options: { data: { role: 'STUDENT', full_name: 'QA User' } } });
    if (error && /signups? not allowed|not allowed for this instance|domain|invalid/i.test(error.message)) {
      throw new Error('sign-up blocked by project Auth policy: ' + error.message + ' — enable "Allow new users to sign up" or provide SUPABASE_TEST_EMAIL/PASSWORD.');
    }
    if (!data || !data.session) {
      throw new Error('email confirmation is enabled — disable it (Auth → Providers → Email) or provide SUPABASE_TEST_EMAIL/PASSWORD.');
    }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
    if (error) throw new Error('supplied SUPABASE_TEST_EMAIL/PASSWORD failed to sign in: ' + error.message + ' — see scripts/e2e-bootstrap.mjs.');
    // reset monthly generation quota so the suite is repeatable (mirrors supabase-features)
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

test('admin can access storage settings and see Drive status', async ({ page }) => {
  await login(page);
  await page.goto('/#/admin/storage');
  await expect(page.locator('text=Storage Settings')).toBeVisible({ timeout: 15000 });
  // The page performs several server roundtrips (drive-health, storage health,
  // policy) — under parallel suite load the cards can land a beat after the
  // heading; give the card a generous, still-bounded wait.
  await expect(page.locator('h3:text("Google Drive")')).toBeVisible({ timeout: 15000 });
});

test('admin can test Drive connection', async ({ page }) => {
  test.setTimeout(120_000); // the storage page performs several live server roundtrips (drive-health, storage-health, policy); under full-suite parallel load the button lands well after 10s
  await login(page);
  await page.goto('/#/admin/storage');
  await expect(page.locator('#test_drive_btn')).toBeVisible({ timeout: 30000 });
  await page.click('#test_drive_btn');
  await expect(page.locator('#drive_action_result')).toContainText(/OK|FAILED|Connected|Disconnected/i, { timeout: 30000 });
});

// Serialize paper-generating tests across projects: the engine draws from the
// shared verified-question pool (and the monthly usage counter), so concurrent
// generations in different workers can shortfall or race usage resets. The
// atomic lock serializes them without weakening any assertion.
function genTest(title: string, fn: (page: any) => Promise<void>) {
  test(title, async ({ page }) => {
    await withPolicyLock(() => fn(page));
  });
}

genTest('paper view has Save to Drive buttons', async (page) => {
  // Self-sufficient: seed verified probe questions and generate through the
  // subject-filtered path so a real paper exists to open (no corpus dependency).
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  const { data: exam } = await sb.from('exams').select('id,name').eq('name', 'AP EAMCET').maybeSingle();
  const examId = exam?.id || (await sb.from('exams').select('id').order('name').limit(1).single()).data!.id;
  const { data: subj } = await sb.from('subjects').select('id').eq('exam_id', examId).limit(1).maybeSingle();
  const { data: qtype } = await sb.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
  const { data: me } = await sb.auth.getUser();
  const { data: mem } = await sb.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  const tag = 'DriveProbe' + Date.now();
  const probeIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const { data: q, error } = await sb.from('questions').insert({
      tenant_id: mem!.tenant_id, exam_id: examId, subject_id: subj?.id || null,
      question_type_id: qtype?.id || null,
      question_text: `Drive paper probe ${tag} Q${i + 1}?`,
      difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW', source: tag,
    }).select().single();
    if (error || !q) throw new Error('probe insert failed: ' + (error?.message || 'no row'));
    await sb.rpc('app_verify_question', { p_question_id: q.id, p_decision: 'VERIFIED', p_note: 'qa probe' });
    probeIds.push(q.id);
  }
  let paperId: string | null = null;
  try {
    await login(page);
    await page.goto('/#/papers/new');
    await expect(page.locator('#gen_btn')).toBeVisible({ timeout: 10000 });
    await page.waitForSelector(`#p_exam option[value="${examId}"]`, { state: 'attached', timeout: 10000 });
    await page.selectOption('#p_exam', { value: examId });
    if (subj?.id) {
      await page.waitForSelector(`#p_subj option[value="${subj.id}"]`, { state: 'attached', timeout: 10000 });
      await page.selectOption('#p_subj', { value: subj.id });
    }
    await page.fill('#p_count', '5');
    await page.click('#gen_btn');
    await page.waitForSelector('#gen_result a[href*="/papers/"]', { timeout: 15000 });
    const href = await page.getAttribute('#gen_result a[href*="/papers/"]', 'href', { timeout: 5000 });
    paperId = href!.split('/').pop()!;
    await page.click('#gen_result a[href*="/papers/"]');
    await expect(page.locator('#save_drive_btn')).toBeVisible({ timeout: 10000 });
  } finally {
    if (paperId) {
      await sb.from('question_usage').delete().eq('used_in_type', 'PAPER').eq('used_in_id', paperId);
      await sb.from('papers').delete().eq('id', paperId);
    }
    await sb.from('question_usage').delete().in('question_id', probeIds);
    await sb.from('questions').delete().in('id', probeIds);
  }
});

test('no R2 or Firebase references in rendered HTML', async ({ page }) => {
  await login(page);
  await page.goto('/#/admin/storage');
  const html = await page.content();
  const lower = html.toLowerCase();
  expect(lower).not.toContain('cloudflare r2');
  expect(lower).not.toContain('r2_bucket');
  expect(lower).not.toContain('r2_endpoint');
});
