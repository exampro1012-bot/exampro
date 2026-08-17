// ExamPro — multilingual + syllabus-mapping E2E (migrations 0040 + 0043).
// Live Supabase backend. Requires SUPABASE_URL + SUPABASE_ANON_KEY +
// SUPABASE_TEST_EMAIL/PASSWORD (an existing staff/admin account).
// Covers: question_translations add/view/verify/delete, syllabus_versions
// CRUD (/admin/syllabus) and question_syllabus_map lifecycle. All fixtures
// are created and cleaned up by this suite itself.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
let EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
let PASS = process.env.SUPABASE_TEST_PASSWORD || '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!URL || !ANON) throw new Error('Missing E2E environment: set SUPABASE_URL and SUPABASE_ANON_KEY (see scripts/e2e-bootstrap.mjs).');
  if (!process.env.SUPABASE_TEST_EMAIL) throw new Error('Missing E2E environment: set SUPABASE_TEST_EMAIL (an existing staff/admin account; fresh signups are STUDENT). See scripts/e2e-bootstrap.mjs.');
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error) throw new Error('supplied SUPABASE_TEST_EMAIL/PASSWORD failed to sign in: ' + error.message + ' — see scripts/e2e-bootstrap.mjs.');
});

async function authedClient() {
  const c = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error || !data.session) throw new Error('re-login failed: ' + (error ? error.message : 'no session'));
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
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="login"]');
  await page.fill('#au_email', EMAIL);
  await page.fill('#au_pw', PASS);
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
}

async function navHash(page: any, hash: string) {
  await page.evaluate((h: string) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(500);
}

// One probe question owned by this suite (hard-deleted in finally).
async function seedProbe(sb: any, tag: string) {
  const { data: exam } = await sb.from('exams').select('id,name').eq('name', 'AP EAMCET').maybeSingle();
  const examId = exam?.id || (await sb.from('exams').select('id').order('name').limit(1).single()).data!.id;
  const { data: qtype } = await sb.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
  const { data: me } = await sb.auth.getUser();
  const { data: mem } = await sb.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  const { data: q, error } = await sb.from('questions').insert({
    tenant_id: mem!.tenant_id, exam_id: examId,
    question_type_id: qtype?.id || null,
    question_text: `Multilingual probe ${tag}?`,
    difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW', source: tag,
  }).select().single();
  if (error || !q) throw new Error('probe insert failed: ' + (error?.message || 'no row'));
  return q.id;
}

async function cleanupProbe(sb: any, qid: string) {
  await sb.from('question_translations').delete().eq('question_id', qid);
  await sb.from('question_syllabus_map').delete().eq('question_id', qid);
  await sb.from('question_usage').delete().eq('question_id', qid);
  await sb.from('questions').delete().eq('id', qid);
}

test('question detail: translation add → view → verify → delete (spec §51)', async ({ page }) => {
  const sb = await authedClient();
  const tag = 'MLNG' + Date.now();
  const qid = await seedProbe(sb, tag);
  page.on('dialog', (d) => d.accept());
  try {
    await login(page);
    await navHash(page, '/questions/' + qid);
    await expect(page.locator('#q_view_body')).toContainText('Multilingual probe');
    await expect(page.locator('h3', { hasText: 'Translations' })).toBeVisible();

    // -- add a Hindi translation through the modal
    await page.click('#tr_add');
    await expect(page.locator('.modal-overlay #tr_m_lang')).toBeVisible();
    await page.selectOption('.modal-overlay #tr_m_lang', 'HI');
    await page.fill('.modal-overlay #tr_m_text', 'बहुभाषी जांच प्रश्न ' + tag);
    await page.fill('.modal-overlay #tr_m_sol', 'यह एक परीक्षण अनुवाद है।');
    await page.click('.modal-overlay #tr_m_save');
    await expect(page.locator('table.data-table tbody tr', { hasText: 'Hindi' })).toHaveCount(1, { timeout: 10000 });

    // -- view switcher renders the translated body + badge
    await page.selectOption('#q_view_lang', 'HI');
    await expect(page.locator('#q_view_body')).toContainText('बहुभाषी जांच प्रश्न');
    await expect(page.locator('#q_view_sol')).toContainText('यह एक परीक्षण अनुवाद है।');
    await expect(page.locator('#q_view_lang_badge')).toContainText('Hindi');
    await expect(page.locator('#q_view_lang_badge')).toContainText('unverified');

    // -- verify the translation (review permission)
    await page.click('[data-tr-verify="HI"]');
    await expect(page.locator('table.data-table tbody tr', { hasText: 'Hindi' }).locator('.badge.b-ok')).toBeVisible({ timeout: 10000 });
    // DB confirms the verified flag
    const { data: tr } = await sb.from('question_translations').select('is_verified').eq('question_id', qid).eq('language', 'HI').maybeSingle();
    expect(tr?.is_verified).toBe(true);

    // -- delete the translation (confirm dialog auto-accepted)
    await page.click('[data-tr-del="HI"]');
    await expect(page.locator('table.data-table tbody tr', { hasText: 'Hindi' })).toHaveCount(0, { timeout: 10000 });
    const { count } = await sb.from('question_translations').select('id', { count: 'exact', head: true }).eq('question_id', qid);
    expect(count).toBe(0);
  } finally {
    await cleanupProbe(sb, qid);
  }
});

test('admin: syllabus version CRUD + question mapping lifecycle (spec §39)', async ({ page }) => {
  const sb = await authedClient();
  const tag = 'SYL' + Date.now();
  const qid = await seedProbe(sb, tag);
  const { data: exam } = await sb.from('exams').select('id,name').eq('name', 'AP EAMCET').maybeSingle();
  page.on('dialog', (d) => d.accept());
  let svId = '';
  try {
    await login(page);

    // -- create a syllabus version on /admin/syllabus
    await navHash(page, '/admin/syllabus');
    await expect(page.locator('#c_authority')).toBeVisible();
    if (exam) {
      await page.waitForSelector('#c_exam_id option[value="' + exam.id + '"]', { timeout: 10000, state: 'attached' });
      await page.selectOption('#c_exam_id', exam.id);
    }
    await page.fill('#c_authority', 'QA_AUTHORITY');
    await page.fill('#c_year', '2026');
    await page.fill('#c_version', 'qa-v' + tag);
    await page.click('#c_save');
    await expect(page.locator('table.data-table tbody tr', { hasText: 'qa-v' + tag })).toHaveCount(1, { timeout: 10000 });
    const { data: sv } = await sb.from('syllabus_versions').select('id').eq('version', 'qa-v' + tag).maybeSingle();
    expect(sv?.id).toBeTruthy();
    svId = sv!.id;

    // -- map the probe question to it from the question page
    await navHash(page, '/questions/' + qid);
    // Wait for the question view to actually render (the page loads
    // asynchronously and can show "Loading question…" well past the assert)
    // before asserting on the Syllabus mapping panel below it.
    await expect(page.locator('#q_view_body')).toContainText('Multilingual probe', { timeout: 15000 });
    await expect(page.locator('h3', { hasText: 'Syllabus mapping' })).toBeVisible({ timeout: 15000 });
    await page.waitForSelector('#qsm_sv option[value="' + svId + '"]', { timeout: 10000, state: 'attached' });
    await page.selectOption('#qsm_sv', svId);
    await page.selectOption('#qsm_status', 'CURRENT');
    await page.click('#qsm_map');
    await expect(page.locator('table.data-table tbody tr', { hasText: 'CURRENT' })).toHaveCount(1, { timeout: 10000 });
    const { data: m } = await sb.from('question_syllabus_map').select('syllabus_status').eq('question_id', qid).eq('syllabus_version_id', svId).maybeSingle();
    expect(m?.syllabus_status).toBe('CURRENT');

    // -- remove the mapping
    await page.click('[data-qsm-del]');
    await expect(page.locator('table.data-table tbody tr', { hasText: 'CURRENT' })).toHaveCount(0, { timeout: 10000 });
    const { count } = await sb.from('question_syllabus_map').select('id', { count: 'exact', head: true }).eq('question_id', qid);
    expect(count).toBe(0);

    // -- delete the syllabus version from /admin/syllabus
    await navHash(page, '/admin/syllabus');
    await page.click('[data-del="' + svId + '"]');
    // Source of truth first (the CRUD table re-renders asynchronously and a
    // parallel project's load can delay it): poll the DB until the row is gone.
    await expect.poll(async () => {
      const { count } = await sb.from('syllabus_versions').select('id', { count: 'exact', head: true }).eq('id', svId);
      return count ?? -1;
    }, { timeout: 15000 }).toBe(0);
    // Then confirm the UI no longer lists it (re-navigate for a fresh render).
    await navHash(page, '/admin/syllabus');
    await expect(page.locator('table.data-table tbody tr', { hasText: 'qa-v' + tag })).toHaveCount(0, { timeout: 10000 });
    svId = '';
  } finally {
    if (svId) await sb.from('syllabus_versions').delete().eq('id', svId);
    await cleanupProbe(sb, qid);
  }
});
