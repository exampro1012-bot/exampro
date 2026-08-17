// ExamPro — cascading selector E2E (spec §15/§16 of the cleanup prompt).
// Live Supabase backend: exam → subject → chapter → topic selectors
// populate from real FK data, stale child selections are cleared, and the
// question form persists topic_id. Fixtures are self-created and cleaned up.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
let EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
let PASS = process.env.SUPABASE_TEST_PASSWORD || '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!URL || !ANON) throw new Error('Missing E2E environment: set SUPABASE_URL and SUPABASE_ANON_KEY (see scripts/e2e-bootstrap.mjs).');
  if (!process.env.SUPABASE_TEST_EMAIL) throw new Error('Missing E2E environment: set SUPABASE_TEST_EMAIL (see scripts/e2e-bootstrap.mjs).');
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error) throw new Error('supplied credentials failed: ' + error.message + ' — see scripts/e2e-bootstrap.mjs.');
});

async function authedClient() {
  const c = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error || !data.session) throw new Error('re-login failed');
  return c;
}

async function login(page: any) {
  await page.goto('/');
  await page.waitForSelector('#auth, #setup', { timeout: 15000 });
  if (await page.locator('#cfg_save').count()) {
    await page.fill('#cfg_url', URL!);
    await page.fill('#cfg_key', ANON!);
    await page.click('#cfg_save');
  }
  await page.click('[data-tab="login"]');
  await page.fill('#au_email', EMAIL);
  await page.fill('#au_pw', PASS);
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
}

test('question bank: exam→subject→chapter→topic cascade filters and clears stale children', async ({ page }) => {
  const sb = await authedClient();
  const tag = 'CASC' + Date.now();
  // fixture: subject (own) → chapter → topic + one question on that topic
  const { data: exam } = await sb.from('exams').select('id,name').eq('name', 'AP EAMCET').maybeSingle();
  const examId = exam?.id || (await sb.from('exams').select('id').order('name').limit(1).single()).data!.id;
  const { data: me } = await sb.auth.getUser();
  const { data: mem } = await sb.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  const { data: subj, error: se } = await sb.from('subjects')
    .insert({ tenant_id: mem!.tenant_id, exam_id: examId, name: 'Cascade Subject ' + tag })
    .select().single();
  expect(se?.message || '').toBe('');
  const { data: chap, error: ce } = await sb.from('chapters')
    .insert({ tenant_id: mem!.tenant_id, subject_id: subj.id, name: 'Cascade Chapter ' + tag })
    .select().single();
  expect(ce?.message || '').toBe('');
  const { data: top, error: te } = await sb.from('topics')
    .insert({ tenant_id: mem!.tenant_id, chapter_id: chap.id, name: 'Cascade Topic ' + tag })
    .select().single();
  expect(te?.message || '').toBe('');
  const { data: qtype } = await sb.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
  const { data: q, error: qe } = await sb.from('questions').insert({
    tenant_id: mem!.tenant_id, exam_id: examId, subject_id: subj.id, chapter_id: chap.id,
    topic_id: top.id, question_type_id: qtype?.id || null,
    question_text: 'Cascade probe ' + tag + '?', difficulty: 'EASY', year: 2026,
    verification_status: 'PENDING_REVIEW', source: tag,
  }).select().single();
  expect(qe?.message || '').toBe('');
  try {
    await login(page);
    await page.evaluate(() => { window.location.hash = '/questions'; });
    await page.waitForSelector('#qb_topic', { timeout: 15000 });

    // subject → chapters load → topic options load for that chapter
    await page.selectOption('#qb_subj', subj.id);
    await page.waitForSelector('#qb_chap option[value="' + chap.id + '"]', { state: 'attached', timeout: 10000 });
    await page.selectOption('#qb_chap', chap.id);
    await page.waitForSelector('#qb_topic option[value="' + top.id + '"]', { state: 'attached', timeout: 10000 });
    await page.selectOption('#qb_topic', top.id);
    await expect(page.locator('#qb_list')).toContainText('Cascade probe ' + tag, { timeout: 15000 });

    // changing subject clears chapter + topic (stale children)
    await page.selectOption('#qb_subj', '');
    await page.waitForTimeout(400);
    expect(await page.inputValue('#qb_chap')).toBe('');
    expect(await page.inputValue('#qb_topic')).toBe('');
    await expect(page.locator('#qb_list')).toContainText('Cascade probe ' + tag, { timeout: 15000 }); // list resets to all

    // question form: topic selector persists topic_id
    await page.evaluate(() => { window.location.hash = '/questions/new'; });
    await page.waitForSelector('#f_topic', { timeout: 15000 });
    await page.selectOption('#f_subj', subj.id);
    await page.waitForSelector('#f_chap option[value="' + chap.id + '"]', { state: 'attached', timeout: 10000 });
    await page.selectOption('#f_chap', chap.id);
    await page.waitForSelector('#f_topic option[value="' + top.id + '"]', { state: 'attached', timeout: 10000 });
    await page.selectOption('#f_topic', top.id);
    await page.fill('#f_text', 'Cascade form question ' + tag + '?');
    await page.selectOption('#f_type', qtype?.id || '');
    await page.click('#save_q');
    await page.waitForTimeout(1500);
    const { data: saved } = await sb.from('questions')
      .select('topic_id, chapter_id').eq('question_text', 'Cascade form question ' + tag + '?').maybeSingle();
    expect(saved?.topic_id).toBe(top.id);
    expect(saved?.chapter_id).toBe(chap.id);
    if (saved) await sb.from('questions').delete().eq('id', saved.id);
  } finally {
    await sb.from('questions').delete().eq('id', q.id);
    await sb.from('topics').delete().eq('id', top.id);
    await sb.from('chapters').delete().eq('id', chap.id);
    await sb.from('subjects').delete().eq('id', subj.id);
  }
});
