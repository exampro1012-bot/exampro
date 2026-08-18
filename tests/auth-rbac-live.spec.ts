// ExamPro — live RBAC E2E against the REAL Supabase project (production auth).
//
// Prerequisites:
//   - index.html must carry the production EXAMPRO_CONFIG (it does by default)
//   - 10 role accounts must exist: run scripts/seed-test-users.mjs (writes
//     TEST_*_EMAIL / TEST_*_PASSWORD into .env.local, gitignored). For
//     pre-existing accounts the seeder does NOT print passwords — rotate or
//     re-create them if TEST_*_PASSWORD is empty.
//
// Covers per role: login -> landing route (EP.roleDashboard), direct-URL
// guards (negative access to /admin), logout, session persistence, and the
// authenticated /#/auth bounce. Skips role cases whose credentials are absent.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader (seed-test-users.mjs format: KEY=value lines).
function loadEnvLocal() {
  const env: Record<string, string> = {};
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) return env;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return env;
}

test.describe.configure({ mode: 'serial' });

// role code -> { envKey, landing }  (landing = EP.roleDashboard() contract)
const ROLES: Record<string, { envKey: string; landing: string }> = {
  SUPER_ADMIN:       { envKey: 'SUPER_ADMIN',       landing: '/dashboard' },
  INSTITUTION_ADMIN: { envKey: 'INSTITUTION_ADMIN', landing: '/institution' },
  TEACHER:           { envKey: 'TEACHER',           landing: '/dashboard' },
  SUBJECT_TEACHER:   { envKey: 'SUBJECT_TEACHER',   landing: '/dashboard' },
  QUESTION_REVIEWER: { envKey: 'QUESTION_REVIEWER', landing: '/questions' },
  CONTENT_EDITOR:    { envKey: 'CONTENT_EDITOR',    landing: '/dashboard' },
  STUDENT:           { envKey: 'STUDENT',           landing: '/dashboard' },
  PARENT:            { envKey: 'PARENT',            landing: '/dashboard' },
  FINANCE:           { envKey: 'FINANCE',           landing: '/reports' },
  SUPPORT:           { envKey: 'SUPPORT',           landing: '/dashboard' },
};

const env = loadEnvLocal();

function creds(role: string): { email: string; password: string } | null {
  const cfg = ROLES[role];
  const email = env[`TEST_${cfg.envKey}_EMAIL`];
  const password = env[`TEST_${cfg.envKey}_PASSWORD`];
  return email && password ? { email, password } : null;
}

async function logout(page: any) {
  const mobile = (page.viewportSize()?.width ?? 999) < 640;
  await page.click(mobile ? '#logout_btn2' : '#logout_btn');
}

test('boots to login with baked-in production config (no setup screen)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#setup')).toHaveCount(0);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  expect(errors).toEqual([]);
});

test('OAuth failure callback (error params) surfaces a clear toast, cleans the URL, and shows login', async ({ page }) => {
  const bad =
    '/?error=server_error&error_code=unexpected_failure' +
    '&error_description=Unable%20to%20exchange%20external%20code%3A%204%2F0A&sb=';
  await page.goto(bad);
  await expect(page.locator('.toast-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.toast-error')).toContainText(/Sign-in failed|exchange external code/i);
  await expect(page).toHaveURL(/#\/auth$/); // error params stripped, login page shown
  await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
});

for (const [role, cfg] of Object.entries(ROLES)) {
  test(`[${role}] login -> landing ${cfg.landing}; reload keeps session; logout returns to login`, async ({ page }) => {
    test.setTimeout(60_000);
    const c = creds(role);
    test.skip(!c, `No TEST_${cfg.envKey}_EMAIL/PASSWORD in .env.local — run scripts/seed-test-users.mjs`);

    await page.goto('/');
    await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
    await page.fill('#au_email', c!.email);
    await page.fill('#au_pw', c!.password);
    await page.click('#au_login_btn');

    // landing per EP.roleDashboard() (resolver contract)
    await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 30000 });
    await expect(page).toHaveURL(new RegExp('#' + cfg.landing), { timeout: 15000 });

    // session persists across reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(new RegExp('#' + cfg.landing), { timeout: 15000 });

    // authenticated users never see the login screen
    await page.goto('/#/auth');
    await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 15000 });

    // logout returns to login
    await logout(page);
    await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
    await page.goto('/#/dashboard');
    await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
  });
}

const ADMIN_ONLY = ['STUDENT', 'PARENT', 'FINANCE', 'SUPPORT', 'TEACHER', 'SUBJECT_TEACHER', 'CONTENT_EDITOR', 'QUESTION_REVIEWER'];

for (const role of ADMIN_ONLY) {
  test(`[${role}] direct URL /#/admin is denied (guard + resolver)`, async ({ page }) => {
    const c = creds(role);
    test.skip(!c, `No TEST_${ROLES[role].envKey}_EMAIL/PASSWORD in .env.local — run scripts/seed-test-users.mjs`);

    await page.goto('/');
    await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
    await page.fill('#au_email', c!.email);
    await page.fill('#au_pw', c!.password);
    await page.click('#au_login_btn');
    await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 30000 });

    await page.goto('/#/admin');
    await expect(page.getByText('Access denied', { exact: false }).first()).toBeVisible({ timeout: 15000 });
  });
}

test('[SUPER_ADMIN] direct URL /#/admin is reachable', async ({ page }) => {
  const c = creds('SUPER_ADMIN');
  test.skip(!c, 'No TEST_SUPER_ADMIN_EMAIL/PASSWORD in .env.local — run scripts/seed-test-users.mjs');

  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
  await page.fill('#au_email', c!.email);
  await page.fill('#au_pw', c!.password);
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 30000 });

  await page.goto('/#/admin');
  await expect(page.getByText('Access denied', { exact: false })).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator('.page')).toBeVisible({ timeout: 15000 });
});

test('[STUDENT] role-scoped route /#/practice works; guarded /#/admin/ingestion is denied', async ({ page }) => {
  const c = creds('STUDENT');
  test.skip(!c, 'No TEST_STUDENT_EMAIL/PASSWORD in .env.local — run scripts/seed-test-users.mjs');

  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
  await page.fill('#au_email', c!.email);
  await page.fill('#au_pw', c!.password);
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 30000 });

  await page.goto('/#/practice');
  await expect(page.getByText('Access denied', { exact: false })).toHaveCount(0, { timeout: 15000 });
  await page.goto('/#/admin/ingestion');
  await expect(page.getByText('Access denied', { exact: false }).first()).toBeVisible({ timeout: 15000 });
});

test('[SUPER_ADMIN] wrong password is rejected; login stays on the auth screen', async ({ page }) => {
  const c = creds('SUPER_ADMIN');
  test.skip(!c, 'No TEST_SUPER_ADMIN_EMAIL/PASSWORD in .env.local — run scripts/seed-test-users.mjs');

  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
  await page.fill('#au_email', c!.email);
  await page.fill('#au_pw', 'DefinitelyWrong#2026');
  await page.click('#au_login_btn');
  await expect(page.locator('.toast-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#app.app-shell')).toHaveCount(0);
});
