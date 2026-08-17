// ExamPro — AI Solution Engine E2E (mandatory test 9).
// Live Supabase backend. Requires SUPABASE_URL + SUPABASE_ANON_KEY + test creds.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { withPolicyLock } from './helpers/policy-lock';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL || '';
const PASS = process.env.SUPABASE_TEST_PASSWORD || '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  if (!URL || !ANON) throw new Error('Missing E2E environment: set SUPABASE_URL and SUPABASE_ANON_KEY (see scripts/e2e-bootstrap.mjs).');
  if (!EMAIL) throw new Error('Missing E2E environment: set SUPABASE_TEST_EMAIL (see scripts/e2e-bootstrap.mjs).');
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error) throw new Error('Test account login failed: ' + error.message + ' — verify SUPABASE_TEST_EMAIL/PASSWORD (see scripts/e2e-bootstrap.mjs).');
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

// QA storage-policy switch: this spec ingests through the ingestion center,
// which blocks under GOOGLE_DRIVE_REQUIRED while Drive is disconnected.
// Ingest under the explicitly-configured fallback, then restore. Runs inside
// the cross-project policy lock so toggles never race another worker's.
async function setPolicy(policy: string) {
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  const { error } = await sb.rpc('app_set_storage_policy', { p_policy: policy });
  if (error) throw new Error('set policy failed: ' + error.message);
}

function csvNoSol(tag: string) {
  const rows = [
    'question_text,exam_code,subject_code,question_type_code,difficulty,year,option_A,option_B,option_C,option_D,correct_keys,explanation,source',
    `"${tag} what is 5 plus 5?","jee-main","physics","MCQ_SINGLE","EASY","2025","9","10","11","12","B","","${tag}"`,
  ];
  return { name: 'nosol.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) };
}

test('AI solution engine: generate -> validate -> expert review', async ({ page }) => {
  await withPolicyLock(async () => {
  const tag = 'AISOL' + Date.now();
  await setPolicy('GOOGLE_DRIVE_PREFERRED');
  try {
  await login(page);

  // 1) ingest a VERIFIED question WITHOUT a solution
  await page.goto('/#/admin/ingestion/upload');
  await expect(page.locator('h2')).toContainText('Upload', { timeout: 15000 });
  await page.setInputFiles('#up_file', csvNoSol(tag));
  await page.click('#up_parse');
  await expect(page.locator('#up_cnt')).toHaveText('1', { timeout: 20000 });
  // Retry honestly if a parallel file's policy restore raced us into a
  // transient REQUIRED window (the real gate fired — redo under PREFERRED).
  let importedTxt = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    await setPolicy('GOOGLE_DRIVE_PREFERRED');
    await page.click('#up_import');
    importedTxt = await page.locator('#up_status').innerText().catch(() => '');
    if (importedTxt.includes('Ingestion complete')) break;
    if (!importedTxt.includes('Google Drive is not connected')) break;
  }
  await expect(page.locator('#up_status')).toContainText('Ingestion complete', { timeout: 30000 });

  await page.goto('/#/admin/ingestion/review');
  const row = page.locator('.data-table tbody tr', { hasText: tag }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.locator('button:has-text("Approve")').click();
  await expect(page.locator('.data-table tbody tr', { hasText: tag })).toHaveCount(0, { timeout: 15000 });

  // 2) solution queue offers AI generation (generate first queued VERIFIED question)
  await page.goto('/#/admin/solutions/queue');
  await expect(page.locator('h2')).toContainText('AI Solution Queue', { timeout: 15000 });
  const qrow = page.locator('tr[data-id]').first();
  await expect(qrow).toBeVisible({ timeout: 15000 });
  const qBefore = await page.locator('tr[data-id]').count();
  await qrow.locator('button.gen-one').click();
  await expect(page.locator('tr[data-id]')).toHaveCount(qBefore - 1, { timeout: 15000 });

  // 3) AI-generated solution routed to review queue (AI_GENERATED + validation)
  await page.goto('/#/admin/solutions/review');
  await expect(page.locator('h2')).toContainText('AI Solution Review Queue', { timeout: 15000 });
  const card = page.locator('.sol-card').first();
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card.locator('text=AI_GENERATED')).toBeVisible();
  await expect(card.locator('text=validation:')).toBeVisible();

  const before = await page.locator('.sol-card').count();
  await card.locator('button.approve').click();
  await expect(page.locator('.sol-card')).toHaveCount(before - 1, { timeout: 15000 });

  // 4) persisted as AI source + VERIFIED (expert reviewed)
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  const { data } = await sb.from('solutions').select('verification_status, source')
    .eq('source', 'AI').order('created_at', { ascending: false }).limit(1);
  expect(data && data.length).toBeTruthy();
  expect(data![0].source).toBe('AI');
  expect(data![0].verification_status).toBe('VERIFIED');
  } finally {
    await setPolicy('GOOGLE_DRIVE_REQUIRED');
  }
  });
});
