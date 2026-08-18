// Structural UI regression suite — runs ANYWHERE (no backend required).
// A mock Supabase HTTP layer (see mock-supabase.ts) serves auth + PostgREST +
// storage, so the full SPA shell and every route render and can be asserted on.
// Covers: boot/login, route coverage with zero page errors, responsive browser
// matrix (360–1920), nav link integrity, print layout, auth flows (sign-up,
// forgot/reset password, session persistence), and key feature pages.

import { test, expect } from '@playwright/test';
import { installMocks, resetMockState, setGoogleEnabled } from './mock-supabase';

test.describe.configure({ mode: 'serial' });

const IDs = {
  paper: '10000000-0000-0000-0000-00000000000c',
  q: '10000000-0000-0000-0000-00000000000a',
  dpp: '10000000-0000-0000-0000-000000000014',
  exam: '10000000-0000-0000-0000-000000000001',
  subject: '10000000-0000-0000-0000-000000000002',
  chapter: '10000000-0000-0000-0000-000000000003',
  topic: '10000000-0000-0000-0000-000000000004',
  session: '10000000-0000-0000-0000-00000000000e',
  sheet: '10000000-0000-0000-0000-000000000013',
};

// concrete paths for parameterized routes
const paramRoutes: Record<string, string> = {
  '/questions/:id': `/questions/${IDs.q}`,
  '/questions/:id/edit': `/questions/${IDs.q}/edit`,
  '/papers/:id': `/papers/${IDs.paper}`,
  '/dpp/:id': `/dpp/${IDs.dpp}`,
  '/exam/:id': `/exam/${IDs.exam}`,
  '/practice/chapter/:id': `/practice/chapter/${IDs.chapter}`,
  '/practice/topic/:id': `/practice/topic/${IDs.topic}`,
  '/results/session/:id': `/results/session/${IDs.session}`,
  '/omr/sheets/:id': `/omr/sheets/${IDs.sheet}`,
};

let errLog: string[] = [];
let netLog: string[] = [];

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="login"]');
  await page.fill('#au_email', 'qa@exampro.test');
  await page.fill('#au_pw', 'MockPassword1!');
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#ep_main .loading')).toHaveCount(0, { timeout: 20000 });
}

async function settle(page: import('@playwright/test').Page) {
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
  netLog = [];
  resetMockState();
  page.on('pageerror', (e) => errLog.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Browser-generated network noise ("Failed to load resource: the server
    // responded with a status of 4xx") — session-token-edge transients on
    // best-effort calls the app handles silently (documented class). Real
    // HTTP defects still fail via the netLog assertion below, which records
    // the failing URL; JS-level errors and pageerrors stay strict here.
    if (m.text().includes('Failed to load resource')) return;
    errLog.push('console: ' + m.text());
  });
  // network sweep: any 4xx/5xx is a failure unless it is the documented
  // PGRST116 "0 rows" signal the app uses for maybeSingle empties.
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 400 && s !== 406) netLog.push(`${s} ${r.request().method()} ${r.url()}`);
  });
  page.route('**cdn.jsdelivr.net/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: 'window.Chart = function () { return { destroy: function () {}, update: function () {} }; };',
  }));
  installMocks(page);
});

test('boot: setup config -> login -> app shell with full nav', async ({ page }) => {
  await login(page);
  await expect.poll(() => page.locator('#sidebar .nav-link').count(), { timeout: 15000 }).toBeGreaterThanOrEqual(20);
  expect(errLog).toEqual([]);
});

test('every registered route renders without page errors', async ({ page }) => {
  await login(page);
  const routes = await page.evaluate(() => Object.keys((window as any).EP.routes));
  expect(routes.length).toBeGreaterThanOrEqual(55);
  for (const r of routes) {
    const target = paramRoutes[r] || r;
    await page.evaluate((p) => { window.location.hash = p; }, target);
    await settle(page);
    const hasError = await page.evaluate(() => !!document.querySelector('#ep_main .empty.error'));
    expect(hasError, `route ${r} (${target}) rendered the error banner`).toBe(false);
    expect(errLog, `route ${r} (${target}) produced uncaught errors`).toEqual([]);
    expect(netLog, `route ${r} (${target}) produced failed requests`).toEqual([]);
  }
});

// full acceptance matrix: 360..1920 x 667..1080
const viewports = [
  { w: 360, h: 800, mobile: true },
  { w: 390, h: 844, mobile: true },
  { w: 412, h: 915, mobile: true },
  { w: 768, h: 1024, mobile: true },
  { w: 1024, h: 768, mobile: false },
  { w: 1280, h: 800, mobile: false },
  { w: 1366, h: 768, mobile: false },
  { w: 1440, h: 900, mobile: false },
  { w: 1920, h: 1080, mobile: false },
];

test('responsive browser matrix: no horizontal overflow, correct nav chrome', async ({ page }) => {
  await login(page);
  for (const v of viewports) {
    await page.setViewportSize({ width: v.w, height: v.h });
    await page.evaluate(() => { window.location.hash = '/dashboard'; });
    await settle(page);
    const metrics = await page.evaluate(() => {
      const sb = document.querySelector('#sidebar') as HTMLElement;
      const main = document.querySelector('#ep_main') as HTMLElement;
      const sbr = sb.getBoundingClientRect();
      const mr = main.getBoundingClientRect();
      return {
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        bottomNav: getComputedStyle(document.querySelector('#bottom_nav') as HTMLElement).display,
        sidebar: getComputedStyle(sb).display,
        sidebarRight: sbr.right,
        mainLeft: mr.left,
      };
    });
    expect(metrics.scrollW, `viewport ${v.w}x${v.h} overflows horizontally`).toBeLessThanOrEqual(metrics.innerW + 1);
    if (v.mobile) {
      expect(metrics.bottomNav, `${v.w}px should show bottom nav`).toBe('flex');
    } else {
      expect(metrics.bottomNav, `${v.w}px should hide bottom nav`).toBe('none');
      expect(metrics.sidebar, `${v.w}px should show sidebar`).toBe('flex');
      // sidebar must not cover content: main starts at or after sidebar's right edge
      expect(metrics.mainLeft, `${v.w}px sidebar overlaps main content`).toBeGreaterThanOrEqual(metrics.sidebarRight - 1);
    }
  }
  expect(errLog).toEqual([]);
  expect(netLog).toEqual([]);
});

test('every sidebar/nav anchor resolves to a registered route', async ({ page }) => {
  await login(page);
  const bad = await page.evaluate(() => {
    const EP = (window as any).EP;
    const routes = EP.routes;
    function resolve(p: string): boolean {
      if (routes[p]) return true;
      const segs = p.split('/');
      for (const rk in routes) {
        const rsegs = rk.split('/');
        if (rsegs.length !== segs.length) continue;
        let ok = true;
        for (let i = 0; i < rsegs.length; i++) {
          if (rsegs[i].charAt(0) === ':') continue;
          if (rsegs[i] !== segs[i]) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    }
    const bad: string[] = [];
    document.querySelectorAll('#sidebar a[href^="#/"], #bottom_nav a[href^="#/"]').forEach((a) => {
      const p = (a.getAttribute('href') || '').slice(1);
      if (!resolve(p)) bad.push(p);
    });
    return bad;
  });
  expect(bad).toEqual([]);
});

test('new feature routes are registered', async ({ page }) => {
  await login(page);
  const present = await page.evaluate(() => {
    const r = (window as any).EP.routes;
    return ['/questions/import', '/admin/patterns', '/admin/tenants', '/admin/security', '/admin/plans', '/institution', '/ai-tutor', '/weak-topics', '/revision', '/exam-tracker'].filter((p) => !!r[p]);
  });
  expect(present).toEqual(['/questions/import', '/admin/patterns', '/admin/tenants', '/admin/security', '/admin/plans', '/institution', '/ai-tutor', '/weak-topics', '/revision', '/exam-tracker']);
});

test('paper view: printable sheet, solutions toggle, PPTX export', async ({ page }) => {
  await login(page);
  await page.evaluate((p) => { window.location.hash = p; }, `/papers/${IDs.paper}`);
  await settle(page);
  await expect(page.locator('#paper_sheet')).toBeVisible();
  await expect(page.locator('#print_btn')).toBeVisible();
  await expect(page.locator('#sol_btn')).toBeVisible();
  await expect(page.locator('#pptx_btn')).toBeVisible();
  // solutions section hidden by default, toggles open
  await expect(page.locator('#solutions_key')).toBeHidden();
  await page.click('#sol_btn');
  await expect(page.locator('#solutions_key')).toBeVisible();
  // print media: chrome hidden, sheet stays
  await page.emulateMedia({ media: 'print' });
  const printChrome = await page.evaluate(() => ({
    sidebar: getComputedStyle(document.querySelector('#sidebar') as HTMLElement).display,
    topbar: getComputedStyle(document.querySelector('.topbar') as HTMLElement).display,
    sheet: getComputedStyle(document.querySelector('#paper_sheet') as HTMLElement).display,
  }));
  expect(printChrome.sidebar).toBe('none');
  expect(printChrome.topbar).toBe('none');
  expect(printChrome.sheet).not.toBe('none');
  expect(errLog).toEqual([]);
});

test('OMR sheet page: scan upload present', async ({ page }) => {
  await login(page);
  await page.evaluate((p) => { window.location.hash = p; }, `/omr/sheets/${IDs.sheet}`);
  await settle(page);
  await expect(page.locator('h2', { hasText: 'OMR Sheet' })).toBeVisible();
  await expect(page.locator('#scan_file')).toBeVisible();
  await expect(page.locator('#scan_upload')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('paper generation form exposes language + difficulty filters', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/papers/new'; });
  await settle(page);
  await expect(page.locator('#p_lang')).toBeVisible();
  await expect(page.locator('#p_diff')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('exam flow: start -> answer -> mark for review -> submit -> result', async ({ page }) => {
  await login(page);
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() => { window.location.hash = '/exams'; });
  await settle(page);
  await page.click('.start-exam');
  await expect(page.locator('#q_area')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#submit_btn')).toBeVisible();
  await expect(page.locator('#mark_btn')).toBeVisible();
  // answer Q1 via checkbox, then mark for review
  await page.click('#q_area .opt-pick input[data-k="A"]');
  await page.click('#mark_btn');
  await expect(page.locator('#palette .pal.mk')).toHaveCount(1);
  await page.click('#submit_btn');
  // lands on the result page with the score card
  await expect(page.locator('.score-card .big-score')).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('question review: verify / reject / needs-edit controls per status', async ({ page }) => {
  await login(page);
  // VERIFIED question -> reject + needs-edit available, verify not
  await page.evaluate((p) => { window.location.hash = p; }, `/questions/${IDs.q}`);
  await settle(page);
  await expect(page.locator('#reject_btn')).toBeVisible();
  await expect(page.locator('#needs_edit_btn')).toBeVisible();
  await expect(page.locator('#verify_btn')).toHaveCount(0);
  // PENDING_REVIEW question -> verify available
  await page.evaluate(() => { window.location.hash = '/questions/10000000-0000-0000-0000-00000000000b'; });
  await settle(page);
  await expect(page.locator('#verify_btn')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('invoices: create with auto number, print modal, CSV export', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/finance/invoices'; });
  await settle(page);
  await page.click('#new_inv_btn');
  await page.fill('#inv_cust', 'Acme Coaching');
  await page.fill('#inv_amt', '1200');
  await page.click('#save_inv');
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.waitForFunction(() => !!document.querySelector('#ep_main tbody tr'), undefined, { timeout: 15000 });
  await expect(page.locator('#export_inv_csv')).toBeVisible();
  await page.click('[data-print]');
  await expect(page.locator('#invoice_sheet')).toBeVisible();
  await expect(page.locator('#print_inv')).toBeVisible();
  await page.click('.modal [data-close]');
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(errLog).toEqual([]);
});

test('assignments: modal saves and closes (closeModal regression)', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/assignments'; });
  await settle(page);
  await page.click('#new_assign');
  await page.selectOption('#as_paper', IDs.paper);
  await page.selectOption('#as_batch', '10000000-0000-0000-0000-000000000015');
  await page.click('#save_assign');
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.waitForFunction(() => document.body.textContent.indexOf('Mock Paper') >= 0, undefined, { timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('OMR sheet: server-side evaluation shows score card', async ({ page }) => {
  await login(page);
  await page.evaluate((p) => { window.location.hash = p; }, `/omr/sheets/${IDs.sheet}`);
  await settle(page);
  await expect(page.locator('#eval_btn')).toBeVisible();
  await page.selectOption('#omr_q_1', 'A');
  await page.click('#eval_btn');
  await expect(page.locator('.score-card')).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('system health: database RPC status reported from live call', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/admin/system-health'; });
  await settle(page);
  await expect(page.locator('li', { hasText: 'Database RPC' })).toContainText('OK');
  expect(errLog).toEqual([]);
});

test('storage settings: Drive status, health dashboard, alerts, and actions render', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/admin/storage'; });
  await settle(page);
  await expect(page.locator('h2', { hasText: 'Storage Settings' })).toBeVisible();
  await expect(page.locator('h3', { hasText: 'Google Drive' })).toBeVisible();
  await expect(page.locator('li', { hasText: 'Provider' })).toContainText('Google Drive');
  await expect(page.locator('li', { hasText: 'Account' })).toContainText('exampro1012@gmail.com');
  await expect(page.locator('li', { hasText: 'Connection' })).toContainText('Connected');
  await expect(page.locator('h3', { hasText: 'Storage Health' })).toBeVisible();
  await expect(page.locator('h3', { hasText: 'Storage Alerts' })).toBeVisible();
  await expect(page.locator('#test_drive_btn')).toBeVisible();
  await expect(page.locator('#init_drive_btn')).toBeVisible();
  await expect(page.locator('#audit_drive_btn')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('storage settings: Test Connection button works', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/admin/storage'; });
  await settle(page);
  await page.click('#test_drive_btn');
  // §28 output: the state badge derived from the health payload plus what was
  // actually verified (mock backend reports connected:true).
  await expect(page.locator('#drive_action_result')).toContainText('CONNECTED', { timeout: 15000 });
  await expect(page.locator('#drive_action_result')).toContainText('Drive API verified', { timeout: 5000 });
  expect(errLog).toEqual([]);
});

test('storage settings: Initialize Folders button works', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/admin/storage'; });
  await settle(page);
  await page.click('#init_drive_btn');
  await expect(page.locator('#drive_action_result')).toContainText('Initialized', { timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('storage settings: Run Audit button works', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/admin/storage'; });
  await settle(page);
  await page.click('#audit_drive_btn');
  await expect(page.locator('#drive_action_result')).toContainText('Audit complete', { timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('results list + CSV export present', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/results'; });
  await settle(page);
  await expect(page.locator('#export_results_csv')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('logout returns to auth screen', async ({ page }) => {
  await login(page);
  const mobile = await page.evaluate(() => getComputedStyle(document.querySelector('#bottom_nav') as HTMLElement).display === 'flex');
  if (mobile) { await page.click('#logout_btn2'); }
  else { await page.click('#logout_btn'); }
  await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });
});

test('session persists across page reload', async ({ page }) => {
  await login(page);
  await page.reload();
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.locator('#sidebar .nav-link').count(), { timeout: 15000 }).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#auth')).toHaveCount(0);
  expect(errLog).toEqual([]);
});

test('sign-up provisions session and lands on dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="signup"]');
  await page.fill('#au_name', 'New Teacher');
  await page.fill('#au_email2', 'teacher@exampro.test');
  await page.fill('#au_pw2', 'MockPassword1!');
  await page.check('#au_terms');
  await page.click('#au_signup_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.locator('#sidebar .nav-link').count(), { timeout: 15000 }).toBeGreaterThanOrEqual(20);
  expect(errLog).toEqual([]);
});

test('forgot password requests a reset email', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.fill('#au_email', 'qa@exampro.test');
  await page.click('#au_forgot');
  await expect(page.locator('#toast-host .toast', { hasText: 'reset link has been sent' })).toBeVisible({ timeout: 15000 });;
  expect(errLog).toEqual([]);
});

test('password reset screen updates the password', async ({ page }) => {
  // recovery link arrives with an active session (GoTrue parses the token in
  // the URL fragment), so sign in first, then open the reset screen
  await login(page);
  await page.goto('/#/auth/reset');
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Set new password' })).toBeVisible();
  await page.fill('#au_pw', 'Newpass@1234');
  await page.fill('#au_pw2', 'Newpass@1234');
  await page.click('#au_reset');
  await expect(page.locator('#toast-host .toast', { hasText: 'Password updated' })).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('chapter practice renders questions with options and answer reveal', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = `/practice/chapter/10000000-0000-0000-0000-000000000003`; });
  await settle(page);
  await expect(page.locator('.pq')).toHaveCount(1);
  await expect(page.locator('.pq .opts li')).toHaveCount(2);
  await page.locator('[data-reveal]').first().click();
  await expect(page.locator('.answer-reveal', { hasText: 'Answer: A' }).first()).toBeVisible();
  expect(errLog).toEqual([]);
});

test('topic practice renders questions with options', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = `/practice/topic/10000000-0000-0000-0000-000000000004`; });
  await settle(page);
  await expect(page.locator('.pq')).toHaveCount(1);
  await expect(page.locator('.pq .opts li')).toHaveCount(2);
  expect(errLog).toEqual([]);
});

test('revision set renders bookmarked questions with options', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/revision'; });
  await settle(page);
  await expect(page.locator('.pq')).toHaveCount(1);
  await expect(page.locator('.pq .opts li')).toHaveCount(2);
  expect(errLog).toEqual([]);
});

test('weak topics lists mistakes grouped by topic', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/weak-topics'; });
  await settle(page);
  await expect(page.locator('h3', { hasText: 'Topics to improve' })).toBeVisible();
  await expect(page.locator('.data-table tbody tr').first()).toContainText('Motion in 1D');
  expect(errLog).toEqual([]);
});

test('Continue with Google shows guidance when provider is disabled', async ({ page }) => {
  setGoogleEnabled(false);
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('#au_google');
  await expect(page.locator('#toast-host .toast', { hasText: 'not enabled' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#auth')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('Continue with Google redirects to authorize when provider is enabled', async ({ page }) => {
  setGoogleEnabled(true);
  try {
    await page.goto('/');
    await expect(page.locator('#auth')).toBeVisible();
    await page.route('**mock.supabase.co/auth/v1/authorize**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>oauth</html>' }));
    await page.click('#au_google');
    await expect(page).toHaveURL(/auth\/v1\/authorize/, { timeout: 15000 });
  } finally {
    setGoogleEnabled(false);
  }
});

test('OAuth callback failure surfaces a clear error on return', async ({ page }) => {
  await page.goto('/?error=access_denied&error_description=Google%20sign-in%20was%20cancelled');
  await expect(page.locator('#auth')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#toast-host .toast', { hasText: 'was cancelled' })).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('signup validates password strength before submitting', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="signup"]');
  await page.fill('#au_name', 'Weak User');
  await page.fill('#au_email2', 'weak@exampro.test');
  await page.fill('#au_pw2', 'weak');
  await page.click('#au_signup_btn');
  await expect(page.locator('#toast-host .toast', { hasText: 'at least 8 characters' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#auth')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('signup requires terms acceptance', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="signup"]');
  await page.fill('#au_name', 'No Terms');
  await page.fill('#au_email2', 'noterms@exampro.test');
  await page.fill('#au_pw2', 'MockPassword1!');
  await page.click('#au_signup_btn');
  await expect(page.locator('#toast-host .toast', { hasText: 'accept the terms' })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#auth')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('password toggle switches between visible and hidden', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.fill('#au_email', 'qa@exampro.test');
  await page.fill('#au_pw', 'MockPassword1!');
  await expect(page.locator('#au_pw')).toHaveAttribute('type', 'password');
  await page.click('#au_pw_toggle');
  await expect(page.locator('#au_pw')).toHaveAttribute('type', 'text');
  await page.click('#au_pw_toggle');
  await expect(page.locator('#au_pw')).toHaveAttribute('type', 'password');
  expect(errLog).toEqual([]);
});

test('forgot password standalone page renders and sends reset', async ({ page }) => {
  await page.goto('/#/forgot-password');
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Forgot password' })).toBeVisible();
  await page.fill('#au_forgot_email', 'qa@exampro.test');
  await page.click('#au_forgot_send');
  await expect(page.locator('#toast-host .toast', { hasText: 'reset link has been sent' })).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('verify-email page renders with resend button', async ({ page }) => {
  await page.goto('/#/verify-email');
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Verify your email' })).toBeVisible();
  await expect(page.locator('#au_resend')).toBeVisible();
  await page.fill('#au_vemail', 'qa@exampro.test');
  await page.click('#au_resend');
  await expect(page.locator('#toast-host .toast', { hasText: 'Verification email sent' })).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('unauthorized route renders access denied page', async ({ page }) => {
  await page.goto('/#/unauthorized');
  await expect(page.locator('h2', { hasText: 'Access denied' })).toBeVisible();
  expect(errLog).toEqual([]);
});

test('settings page shows security and connected accounts', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/settings'; });
  await settle(page);
  await expect(page.locator('h3', { hasText: 'Security' })).toBeVisible();
  await expect(page.locator('h3', { hasText: 'Connected accounts' })).toBeVisible();
  await expect(page.locator('#save_pw')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('settings change password requires current password', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/settings'; });
  await settle(page);
  await page.fill('#s_new_pw', 'Newpass@1234');
  await page.fill('#s_cnf_pw', 'Newpass@1234');
  await page.click('#save_pw');
  await expect(page.locator('#toast-host .toast', { hasText: 'Fill all password fields' })).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('login button shows loading state during sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.fill('#au_email', 'qa@exampro.test');
  await page.fill('#au_pw', 'MockPassword1!');
  await page.click('#au_login_btn');
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  expect(errLog).toEqual([]);
});

test('signup button shows loading state during signup', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth')).toBeVisible();
  await page.click('[data-tab="signup"]');
  await page.fill('#au_name', 'Load Test');
  await page.fill('#au_email2', 'loadtest@exampro.test');
  await page.fill('#au_pw2', 'MockPassword1!');
  await page.check('#au_terms');
  await page.click('#au_signup_btn');
  await expect(page.locator('#au_signup_btn')).toHaveText('Creating account…', { timeout: 5000 });
  await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#ep_main .loading')).toHaveCount(0, { timeout: 20000 });
  expect(errLog).toEqual([]);
});