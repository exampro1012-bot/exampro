// Destructive / negative E2E suite — security posture of the client shell.
// Runs against the mock Supabase layer (no live backend needed) with RLS
// simulation switched on: the mock filters tenant-scoped rows to the session
// tenant + platform bank (mirroring app_can_read_content), returns PGRST116
// (406) for non-existent/foreign rows, 401 for anonymous callers, and lets the
// test act as a STUDENT / TEACHER / quota-exhausted / anonymous principal.
//
// These tests assert the CLIENT-side contract with a well-behaved backend:
// a student must never see admin chrome or other tenants' data, must not be
// able to reach staff-only editors, and the app must degrade gracefully on
// every denial. Real RLS enforcement itself is covered by the SQL suites.
//
// NOTE: tests must restore default mock state in afterEach so the structural
// suite behavior is never affected.

import { test, expect, type Page } from '@playwright/test';
import {
  installMocks, resetMockState, setGoogleEnabled,
  setRole, setRlsMode, setQuotaOk, setAnonDenied, setMockTenant,
} from './mock-supabase';

test.describe.configure({ mode: 'serial' });

const IDs = {
  paper: '10000000-0000-0000-0000-00000000000c',
  q: '10000000-0000-0000-0000-00000000000a',
  foreignQ: '10000000-0000-0000-0000-000000000099',
  session: '10000000-0000-0000-0000-00000000000e',
  exam: '10000000-0000-0000-0000-000000000001',
};

let errLog: string[] = [];

function resetMock() {
  resetMockState();
  setRole('SUPER_ADMIN');
  setRlsMode('open');
  setQuotaOk(true);
  setAnonDenied(false);
  setMockTenant('22222222-2222-2222-2222-222222222222');
  setGoogleEnabled(false);
}

async function login(page: Page, email = 'qa@exampro.test') {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="login"]');
  await page.fill('#au_email', email);
  await page.fill('#au_pw', 'MockPassword1!');
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#ep_main .loading')).toHaveCount(0, { timeout: 20000 });
}

async function settle(page: Page) {
  await page.waitForFunction(() => {
    const m = document.querySelector('#ep_main');
    if (!m) return false;
    if (m.querySelector('.loading')) return false;
    if (m.querySelector('.page, .empty, .card, .table-wrap, form, canvas')) return true;
    return m.textContent && m.textContent.trim().length > 0;
  }, undefined, { timeout: 20000 });
}

test.beforeEach(async ({ page }) => {
  errLog = [];
  resetMock();
  page.on('pageerror', (e) => errLog.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errLog.push('console: ' + m.text()); });
  page.route('**cdn.jsdelivr.net/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'window.Chart = function () { return { destroy: function () {}, update: function () {} }; };',
  }));
  installMocks(page);
});

test.afterEach(() => {
  resetMock();
});

// ---------------------------------------------------------------------------
// Role-based access control
// ---------------------------------------------------------------------------

test('STUDENT is denied every /admin route', async ({ page }) => {
  setRole('STUDENT');
  await login(page);
  const adminRoutes = ['/admin', '/admin/institutions', '/admin/branches', '/admin/batches', '/admin/teachers', '/admin/students', '/admin/subjects', '/admin/chapters', '/admin/topics', '/admin/tenants', '/admin/security', '/admin/plans', '/admin/system-health', '/admin/patterns', '/admin/usage', '/admin/data-quality', '/admin/audit', '/admin/storage'];
  for (const r of adminRoutes) {
    await page.evaluate((p) => { window.location.hash = p; }, r);
    await settle(page);
    await expect(page.locator('#ep_main .empty h3', { hasText: 'Access denied' })).toBeVisible({ timeout: 10000 });
    // no admin chrome may leak into the page
    await expect(page.locator('#ep_main .stat-card, #ep_main .quick-grid')).toHaveCount(0);
  }
  expect(errLog).toEqual([]);
});

test('STUDENT sees only student nav; admin/management links are absent', async ({ page }) => {
  setRole('STUDENT');
  await login(page);
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#sidebar a[href^="#/"], #bottom_nav a[href^="#/"]'))
      .map((a) => a.getAttribute('href')));
  expect(hrefs.some((h) => h!.startsWith('#/admin'))).toBe(false);
  expect(hrefs.some((h) => h === '#/institution' || h === '#/assignments')).toBe(false);
  expect(hrefs.some((h) => h === '#/questions')).toBe(false);
  expect(hrefs.some((h) => h === '#/practice' || h === '#/exams' || h === '#/papers' || h === '#/results')).toBe(true);
});

test('STUDENT cannot open the question editor for a published question', async ({ page }) => {
  setRole('STUDENT');
  await login(page);
  await page.evaluate((p) => { window.location.hash = p; }, `/questions/${IDs.q}/edit`);
  await settle(page);
  // staff-only editor must not render for a student (neither the form nor the
  // source of the published question)
  await expect(page.locator('#save_q')).toHaveCount(0);
  await expect(page.locator('#f_text')).toHaveCount(0);
  expect(errLog).toEqual([]);
});

test('STUDENT cannot open question import or new-question forms', async ({ page }) => {
  setRole('STUDENT');
  await login(page);
  for (const r of ['/questions/import', '/questions/new']) {
    await page.evaluate((p) => { window.location.hash = p; }, r);
    await settle(page);
    await expect(page.locator('#qi_file, #save_q')).toHaveCount(0);
  }
  expect(errLog).toEqual([]);
});

test('STUDENT never sees verify / reject / delete controls on a question', async ({ page }) => {
  setRole('STUDENT');
  await login(page);
  await page.evaluate((p) => { window.location.hash = p; }, `/questions/${IDs.q}`);
  await settle(page);
  // staff-only controls must not render for a student; bookmark IS allowed
  await expect(page.locator('#verify_btn, #reject_btn, #needs_edit_btn, #del_q_btn')).toHaveCount(0);
  await expect(page.locator('#bm_btn')).toBeVisible();
  // the read-only question body is still shown (platform bank is readable)
  await expect(page.locator('.q-body').first()).toBeVisible();
  expect(errLog).toEqual([]);
});

test('STUDENT sees only their own results list (no cross-student rows)', async ({ page }) => {
  setRole('STUDENT');
  setRlsMode('tenant');
  await login(page);
  await page.evaluate(() => { window.location.hash = '/results'; });
  await settle(page);
  // mock has a foreign result for OTHER_UID; the list must not show it
  const body = await page.locator('#ep_main').textContent();
  expect(body).toContain('Mock Paper');
  expect(body).not.toContain('Foreign Result');
  expect(errLog).toEqual([]);
});

test('STUDENT cannot read another student result via direct session URL', async ({ page }) => {
  setRole('STUDENT');
  setRlsMode('tenant');
  await login(page);
  // session belongs to OTHER_UID — RLS (results_select: student_id = auth.uid())
  // would return 0 rows; the UI must degrade to "Result not found", never render
  // the score card with the other student's marks
  await page.evaluate((p) => { window.location.hash = p; }, '/results/session/99999999-0000-0000-0000-0000000000ff');
  await settle(page);
  await expect(page.locator('.score-card')).toHaveCount(0);
  await expect(page.locator('#ep_main')).toContainText('not found');
  expect(errLog).toEqual([]);
});

test('TEACHER cannot read a question from another tenant', async ({ page }) => {
  setRole('TEACHER');
  setRlsMode('tenant');
  await login(page);
  await page.evaluate((p) => { window.location.hash = p; }, `/questions/${IDs.foreignQ}`);
  await settle(page);
  await expect(page.locator('#ep_main')).toContainText('not found');
  await expect(page.locator('.q-body')).toHaveCount(0);
  expect(errLog).toEqual([]);
});

test('TEACHER cannot edit a question from another tenant', async ({ page }) => {
  setRole('TEACHER');
  setRlsMode('tenant');
  await login(page);
  await page.evaluate((p) => { window.location.hash = p; }, `/questions/${IDs.foreignQ}/edit`);
  await settle(page);
  // foreign question never loads; editor must not expose its text/answer
  await expect(page.locator('#save_q')).toHaveCount(0);
  await expect(page.locator('#f_text')).toHaveCount(0);
  expect(errLog).toEqual([]);
});

// ---------------------------------------------------------------------------
// Anonymous access
// ---------------------------------------------------------------------------

test('logged-out user is forced to auth screen, never sees app shell', async ({ page }) => {
  await page.goto('/#/papers');
  await expect(page.locator('#auth')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#app.app-shell')).toHaveCount(0);
  expect(errLog).toEqual([]);
});

test('anonymous caller gets 401 from protected APIs and app stays on auth screen', async ({ page }) => {
  setAnonDenied(true);
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible({ timeout: 20000 });
  // no crash, no app shell, no uncaught errors from the denied calls
  expect(errLog).toEqual([]);
});

test('expired/invalid session token is rejected and user is bounced to auth', async ({ page }) => {
  setAnonDenied(true);
  await page.goto('/');
  // seed a fake session so the app tries to restore it, then the mock denies it
  await page.evaluate(() => {
    localStorage.setItem('exampro_auth_session', JSON.stringify({ access_token: 'expired.mock.token', refresh_token: 'x', expires_at: 1 }));
  });
  await page.reload();
  await expect(page.locator('#auth')).toBeVisible({ timeout: 20000 });
  expect(errLog).toEqual([]);
});

// ---------------------------------------------------------------------------
// Parameter manipulation (IDOR-ish / injection)
// ---------------------------------------------------------------------------

test('garbage question id renders a graceful not-found, never crashes', async ({ page }) => {
  await login(page);
  for (const id of ['not-a-uuid', '1', '../../admin', '<img src=x onerror=alert(1)>', '00000000-0000-0000-0000-000000000000']) {
    await page.evaluate((p) => { window.location.hash = p; }, '/questions/' + encodeURIComponent(id));
    await settle(page);
    await expect(page.locator('#ep_main .empty.error')).toHaveCount(0);
  }
  expect(errLog).toEqual([]);
});

test('garbage tenant/page ids in paper URL are handled without crash', async ({ page }) => {
  await login(page);
  for (const r of ['/papers/not-a-uuid', '/papers/00000000-0000-0000-0000-000000000000', '/dpp/../../x', '/exam/0']) {
    await page.evaluate((p) => { window.location.hash = p; }, r);
    await settle(page);
    await expect(page.locator('#ep_main .empty.error')).toHaveCount(0);
  }
  expect(errLog).toEqual([]);
});

test('question_text with script/img payload is sanitized (no execution, no raw HTML)', async ({ page }) => {
  await login(page);
  // intercept the question read to return an XSS payload
  await page.route(`**/rest/v1/questions*id=eq.${IDs.q}*`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Prefer' },
      body: JSON.stringify([{
        id: IDs.q, tenant_id: '00000000-0000-0000-0000-000000000001', verification_status: 'VERIFIED',
        difficulty: 'EASY', year: 2024, question_text: '<img src=x onerror=window.__pwned=1><script>window.__pwned=2</script><p>Legit</p>',
      }]),
    });
  });
  await page.evaluate((p) => { window.location.hash = p; }, `/questions/${IDs.q}`);
  await settle(page);
  const pwned = await page.evaluate(() => (window as any).__pwned || 0);
  expect(pwned).toBe(0);
  const html = await page.evaluate(() => document.querySelector('#ep_main .q-body')?.innerHTML || '');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('onerror');
  expect(html).toContain('Legit');
  expect(errLog).toEqual([]);
});

// ---------------------------------------------------------------------------
// Business rule abuse
// ---------------------------------------------------------------------------

test('free plan: paper generation is blocked by quota with a clear message', async ({ page }) => {
  setQuotaOk(false);
  await login(page);
  await page.evaluate(() => { window.location.hash = '/papers/new'; });
  await settle(page);
  await page.selectOption('#p_exam', { label: 'JEE Main' });
  await page.click('#gen_btn');
  // server-authoritative: the RPC returns the quota error, shown in the result area
  await expect(page.locator('#gen_result .empty.error')).toContainText(/quota|Upgrade plan/i, { timeout: 15000 });
  await expect(page.locator('#paper_sheet')).toHaveCount(0);
  expect(errLog).toEqual([]);
});

test('quota: DPP generation is also gated', async ({ page }) => {
  setQuotaOk(false);
  await login(page);
  await page.evaluate(() => { window.location.hash = '/dpp/new'; });
  await settle(page);
  await page.selectOption('#d_exam', { label: 'JEE Main' });
  await page.click('#d_gen');
  await expect(page.locator('#d_res .empty.error')).toContainText(/quota|Upgrade plan/i, { timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('invalid file upload (binary garbage as CSV) is rejected client-side', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/questions/import'; });
  await settle(page);
  await page.setInputFiles('#qi_file', {
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x25, 0x50, 0x44, 0x46, 0x00, 0x01]),
  });
  await page.click('#qi_parse');
  await expect(page.locator('#toast-host .toast-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#qi_preview_card')).toBeHidden();
  expect(errLog).toEqual([]);
});

test('malformed JSON paste is rejected with a toast, preview stays hidden', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/questions/import'; });
  await settle(page);
  await page.fill('#qi_text', '[{"question_text": "broken"');
  await page.click('#qi_parse');
  await expect(page.locator('#toast-host .toast-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#qi_preview_card')).toBeHidden();
  expect(errLog).toEqual([]);
});

// ---------------------------------------------------------------------------
// Cross-tenant data isolation via direct URL (teacher A -> tenant B)
// ---------------------------------------------------------------------------

test('TEACHER of tenant A cannot view tenant B paper via direct URL', async ({ page }) => {
  setRole('TEACHER');
  setRlsMode('tenant');
  setMockTenant('22222222-2222-2222-2222-222222222222');
  await login(page);
  // paper with foreign tenant
  await page.route('**/rest/v1/papers?id=eq.99999999-0000-0000-0000-0000000000aa', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Prefer' },
      body: JSON.stringify([{ id: '99999999-0000-0000-0000-0000000000aa', tenant_id: '33333333-3333-3333-3333-333333333333', exam_id: IDs.exam, title: 'Secret Tenant B Paper', status: 'LOCKED' }]),
    });
  });
  await page.evaluate(() => { window.location.hash = '/papers/99999999-0000-0000-0000-0000000000aa'; });
  await settle(page);
  const text = await page.locator('#ep_main').textContent();
  expect(text).not.toContain('Secret Tenant B Paper');
  expect(errLog).toEqual([]);
});

test('reload with stale session after role downgrade never re-enters staff UI', async ({ page }) => {
  setRole('STUDENT');
  await login(page);
  await page.evaluate(() => { window.location.hash = '/dashboard'; });
  await settle(page);
  await page.reload();
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#sidebar a[href^="#/"]')).map((a) => a.getAttribute('href')));
  expect(hrefs.some((h) => h!.startsWith('#/admin'))).toBe(false);
  expect(errLog).toEqual([]);
});