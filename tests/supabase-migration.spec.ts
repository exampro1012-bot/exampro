// ExamPro — structural / no-backend tests.
// These run WITHOUT any Supabase credentials: they verify the app boots,
// shows the real Supabase connect screen, contains no legacy Firebase/Code.gs
// dependencies, embeds no service-role secret, and is responsive (no overflow).
import { test, expect } from '@playwright/test';

const FORBIDDEN = [
  'firebase', 'code.gs', 'google.script', 'spreadsheetapp', 'workers.dev',
  'cloudflare', 'realtime database', 'firestore', 'FIREBASE_SECRET',
];

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

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
  const EMAIL = process.env.SUPABASE_TEST_EMAIL || `qa+${Date.now()}@gmail.com`;
  const PASS = process.env.SUPABASE_TEST_PASSWORD || '';
  await page.fill('#au_email', EMAIL);
  await page.fill('#au_pw', PASS);
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
}

test('app boots to the login screen when Supabase is configured', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('/');
  // env config (index.html) is baked in: the app must boot straight to auth,
  // never to the setup screen, and never with a page error.
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('#setup')).toHaveCount(0);
  expect(errors, 'boot errors: ' + errors.join(' | ')).toHaveLength(0);
});

test('Firebase / Code.gs / R2 dependencies are fully removed', async ({ page }) => {
  await page.goto('/');
  const html = await page.content();
  const lower = html.toLowerCase();
  for (const term of FORBIDDEN) {
    expect(lower, `forbidden backend dependency still present: ${term}`).not.toContain(term);
  }
});

test('service-role key is never embedded in the client', async ({ page }) => {
  await page.goto('/');
  const html = await page.content();
  const lower = html.toLowerCase();
  expect(lower).not.toContain('service_role');
  expect(lower).not.toContain('supabase_role');
});

test('no horizontal overflow on desktop and mobile viewports', async ({ page }) => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp);
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow at ${vp.width}px`).toBeLessThanOrEqual(1);
  }
});

test('storage settings page loads without error (Google Drive)', async ({ page }) => {
  if (!URL || !ANON) throw new Error('Missing E2E environment: set SUPABASE_URL + SUPABASE_ANON_KEY (see scripts/e2e-bootstrap.mjs).');
  if (!process.env.SUPABASE_TEST_EMAIL) throw new Error('Missing E2E environment: set SUPABASE_TEST_EMAIL (staff account) — see scripts/e2e-bootstrap.mjs.');
  await login(page);
  await page.goto('/#/admin/storage');
  await expect(page.locator('text=Storage Settings')).toBeVisible({ timeout: 10000 });
});

test('login without credentials is rejected gracefully', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('#au_login_btn');
  await expect(page.getByText('Enter email and password')).toBeVisible();
  expect(errors, 'save crashed: ' + errors.join(' | ')).toHaveLength(0);
});

test('app boots to the auth screen with the baked-in Supabase config', async ({ page }) => {
  // The Supabase config is baked into index.html — this structural check needs
  // no credentials at all.
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
});
