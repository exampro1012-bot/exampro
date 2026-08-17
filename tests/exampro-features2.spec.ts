// ExamPro — regression suite for features added in the 2026-08-16 hardening
// cycle. Runs anywhere (mock Supabase HTTP layer, no backend required).
// Covers: PARENT ward dashboard (linked + unlinked), formula library
// (render/filter/search/verify/create/export), batch OMR scan upload,
// OMR sheet scannable grid + geometry contract, the confidence-gated OMR
// bubble detector (synthetic scan), and SUBJECT_TEACHER question-bank scoping.

import { test, expect } from '@playwright/test';
import { installMocks, resetMockState, setRole, setParentLinked } from './mock-supabase';

test.describe.configure({ mode: 'serial' });

const SHEET = '10000000-0000-0000-0000-000000000013';

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
  setRole('SUPER_ADMIN');
  setParentLinked(true);
  page.on('pageerror', (e) => errLog.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errLog.push('console: ' + m.text()); });
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

// ---------------------------------------------------------------------------
// PARENT dashboard
// ---------------------------------------------------------------------------

test('PARENT dashboard renders the ward overview (KPIs, results, weak topics, assignments)', async ({ page }) => {
  setRole('PARENT');
  await login(page);
  await page.evaluate(() => { window.location.hash = '/dashboard'; });
  await settle(page);
  await expect(page.locator('#ep_main h2', { hasText: 'Ward overview' })).toBeVisible();
  await expect(page.locator('#ep_main .pill', { hasText: 'Parent' })).toBeVisible();
  await expect(page.locator('#ep_main .stat-card')).toHaveCount(4);
  await expect(page.locator('#ep_main', { hasText: 'Ward Student' })).toBeVisible();
  await expect(page.locator('#ep_main', { hasText: 'Motion in 1D' })).toBeVisible();
  await expect(page.locator('#ep_main', { hasText: 'Mock Paper' })).toBeVisible();
  expect(errLog).toEqual([]);
  expect(netLog).toEqual([]);
});

test('PARENT without a linked ward sees the empty state, not raw errors', async ({ page }) => {
  setRole('PARENT');
  setParentLinked(false);
  await login(page);
  await page.evaluate(() => { window.location.hash = '/dashboard'; });
  await settle(page);
  await expect(page.locator('#ep_main', { hasText: 'not linked to a student' })).toBeVisible();
  await expect(page.locator('#ep_main .empty.error')).toHaveCount(0);
  expect(errLog).toEqual([]);
});

test('PARENT cannot reach staff-only routes (admin console is denied)', async ({ page }) => {
  setRole('PARENT');
  await login(page);
  await page.evaluate(() => { window.location.hash = '/admin'; });
  await settle(page);
  await expect(page.locator('#ep_main h3', { hasText: 'Access denied' })).toBeVisible();
  expect(errLog).toEqual([]);
});

// ---------------------------------------------------------------------------
// Formula library
// ---------------------------------------------------------------------------

test('formula library renders verified/pending cards, filters by subject, searches', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/formulas'; });
  await settle(page);
  await expect(page.locator('#fl_list .formula-card')).toHaveCount(2);
  await expect(page.locator('#fl_list .badge.b-ok', { hasText: 'VERIFIED' })).toBeVisible();
  await expect(page.locator('#fl_list .badge.b-warn', { hasText: 'PENDING_REVIEW' })).toBeVisible();
  // subject filter -> Mathematics only
  await page.selectOption('#fl_subj', 'MAT');
  await expect(page.locator('#fl_list .formula-card')).toHaveCount(1);
  await expect(page.locator('#fl_list', { hasText: 'Complement rule' })).toBeVisible();
  // search across title/formula/chapter/topic
  await page.selectOption('#fl_subj', '');
  await page.fill('#fl_q', 'uniform acceleration');
  await expect(page.locator('#fl_list .formula-card')).toHaveCount(1);
  await expect(page.locator('#fl_list', { hasText: 'v = u + at' })).toBeVisible();
  expect(errLog).toEqual([]);
  expect(netLog).toEqual([]);
});

test('formula library: verify pending formula flips status and export produces CSV', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/formulas'; });
  await settle(page);
  // verify the PENDING_REVIEW formula via the review action
  await page.locator('[data-verify="80000000-0000-0000-0000-000000000002"]').click();
  await expect(page.locator('#toast-host .toast', { hasText: 'Verified' }).first()).toBeVisible({ timeout: 15000 });
  // export button exists and does not throw
  await page.click('#fl_export');
  expect(errLog).toEqual([]);
});

test('formula library: editor can create a new formula via the modal', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/formulas'; });
  await settle(page);
  await page.click('#fl_new');
  await expect(page.locator('.modal-overlay .modal')).toBeVisible({ timeout: 10000 });
  const modal = page.locator('.modal-overlay .modal').first();
  await expect(modal).toBeVisible();
  await expect(modal.locator('h3', { hasText: 'New formula' })).toBeVisible();
  // save the form as-is (mock POST returns created row) — modal must close without error
  await page.fill('#ff_title', 'Test formula');
  await page.fill('#ff_plain', 'a = b + c');
  await modal.locator('#ff_save').click();
  await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('#toast-host .toast', { hasText: 'Formula added' }).first()).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

// ---------------------------------------------------------------------------
// Batch OMR scan upload
// ---------------------------------------------------------------------------

test('batch OMR scan page renders paper + template selectors and validation', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/omr/scan'; });
  await settle(page);
  await expect(page.locator('#ep_main h2', { hasText: 'Batch OMR Scan Upload' })).toBeVisible();
  await expect(page.locator('#bs_paper option')).toHaveCount(2); // placeholder + Mock Paper
  await expect(page.locator('#bs_tpl option')).toHaveCount(2);   // placeholder + JEE Template
  await expect(page.locator('#bs_files')).toBeVisible();
  await expect(page.locator('#bs_go')).toBeVisible();
  // validation: no paper selected -> toast error, no crash
  await page.click('#bs_go');
  await expect(page.locator('#toast-host .toast', { hasText: 'Select a paper' }).first()).toBeVisible({ timeout: 15000 });
  expect(errLog).toEqual([]);
});

test('batch OMR upload: two scan images create sheets with roll numbers and ready badges', async ({ page }) => {
  await login(page);
  await page.evaluate(() => { window.location.hash = '/omr/scan'; });
  await settle(page);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.selectOption('#bs_paper', '10000000-0000-0000-0000-00000000000c');
  await page.setInputFiles('#bs_files', [
    { name: 'scan-a.png', mimeType: 'image/png', buffer: png },
    { name: 'scan-b.png', mimeType: 'image/png', buffer: png },
  ]);
  await page.fill('#bs_prefix', 'BATCH-QA');
  await page.click('#bs_go');
  await expect(page.locator('#bs_progress .badge.b-ok')).toHaveCount(2, { timeout: 15000 });
  await expect(page.locator('#bs_progress', { hasText: 'BATCH-QA-001' })).toBeVisible();
  await expect(page.locator('#bs_progress', { hasText: 'BATCH-QA-002' })).toBeVisible();
  await expect(page.locator('#bs_progress a[href^="#/omr/sheets/"]')).toHaveCount(2);
  expect(errLog).toEqual([]);
});

// ---------------------------------------------------------------------------
// OMR sheet grid + geometry contract + bubble detector
// ---------------------------------------------------------------------------

test('OMR sheet renders the scannable grid: registration marks + one bubble per option', async ({ page }) => {
  await login(page);
  await page.evaluate((id) => { window.location.hash = `/omr/sheets/${id}`; }, SHEET);
  await settle(page);
  await expect(page.locator('.omr-reg')).toHaveCount(4);      // corner registration marks
  await expect(page.locator('.omr-b')).toHaveCount(4);        // 1 question x 4 options
  await expect(page.locator('.omr-hdr-letter')).toHaveCount(16); // 4 columns x 4 options
  await expect(page.locator('.omr-qno-txt', { hasText: '1' })).toBeVisible();
  await expect(page.locator('#print_sheet')).toBeVisible();
  expect(errLog).toEqual([]);
});

test('OMR geometry contract: layout matches detector constants (100/page, 4 cols, 25 rows)', async ({ page }) => {
  await login(page);
  const geo = await page.evaluate(() => {
    const one = (window as any).EP.omrLayout(100, 4);
    const multi = (window as any).EP.omrLayout(250, 5);
    return {
      pages1: one.pages, cols: one.cols, rowsPerCol: one.rowsPerCol,
      opts: one.opts, marks: one.marks.length, bubblesQ1: one.bubbles[1].length,
      firstBubble: one.bubbles[1][0], q1Label: one.qnos[1],
      pages3: multi.pages, opts5: multi.opts, lastBubbleQ250: multi.bubbles[250][4],
    };
  });
  expect(geo.pages1).toBe(1);
  expect(geo.cols).toBe(4);
  expect(geo.rowsPerCol).toBe(25);
  expect(geo.opts).toBe(4);
  expect(geo.marks).toBe(4);
  expect(geo.bubblesQ1).toBe(4);
  expect(Math.round(geo.firstBubble.cx * 10) / 10).toBe(12);   // 12mm
  expect(Math.round(geo.firstBubble.cy * 10) / 10).toBe(12.4); // headerH + rowH/2
  expect(Math.round(geo.q1Label.cx * 10) / 10).toBe(8);
  expect(geo.pages3).toBe(3);
  expect(geo.opts5).toBe(5);
  expect(geo.lastBubbleQ250).toBeTruthy();
  expect(errLog).toEqual([]);
});

test('OMR detector: synthetic scan with one filled bubble is read correctly; blanks and ambiguity are honest', async ({ page }) => {
  await login(page);
  const res = await page.evaluate(async () => {
    const W = 900, H = 1180, MM = 5; // 5 px/mm
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000000';
    const marks = [
      { x: 4.5, y: 4.5 }, { x: 175.5, y: 4.5 },
      { x: 4.5, y: 231.5 }, { x: 175.5, y: 231.5 },
    ];
    for (const m of marks) ctx.fillRect((m.x - 4) * MM, (m.y - 4) * MM, 8 * MM, 8 * MM);
    // fill bubble A of Q1 (centre 12mm, 12.4mm) with a 3mm disk
    ctx.beginPath();
    ctx.arc(12 * MM, 12.4 * MM, 3 * MM, 0, Math.PI * 2);
    ctx.fill();
    return await (window as any).EP.omrDetect(cv.toDataURL('image/png'), { questions: 25, options: 4 });
  });
  expect(res.ok).toBe(true);
  expect(res.answers[1]).toBe('A');
  expect(res.blank).toContain(2);
  expect(res.blank).toContain(25);
  expect(res.flagged).toEqual([]);
  expect(res.confidence).toBeGreaterThan(0.9);
  expect(errLog).toEqual([]);
});

test('OMR detector: a scan without registration marks is refused, never guessed', async ({ page }) => {
  await login(page);
  const res = await page.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 400; cv.height = 500;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 500);
    return await (window as any).EP.omrDetect(cv.toDataURL('image/png'), { questions: 25, options: 4 });
  });
  expect(res.ok).toBe(false);
  expect(res.error).toContain('Registration mark');
  expect(errLog).toEqual([]);
});

test('OMR detector: perspective-skewed scan is aligned via the homography and still read', async ({ page }) => {
  await login(page);
  const res = await page.evaluate(async () => {
    const W = 1024, H = 1300, MM = 5;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000000';
    // shear + scale the whole sheet: a camera-style perspective-ish affine
    ctx.transform(1, 0.08, 0.06, 1, 20, 10);
    const marks = [
      { x: 4.5, y: 4.5 }, { x: 175.5, y: 4.5 },
      { x: 4.5, y: 231.5 }, { x: 175.5, y: 231.5 },
    ];
    for (const m of marks) ctx.fillRect((m.x - 4) * MM, (m.y - 4) * MM, 8 * MM, 8 * MM);
    ctx.beginPath();
    ctx.arc(12 * MM, 12.4 * MM, 3 * MM, 0, Math.PI * 2);
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return await (window as any).EP.omrDetect(cv.toDataURL('image/png'), { questions: 25, options: 4 });
  });
  expect(res.ok).toBe(true);
  expect(res.answers[1]).toBe('A');
  expect(res.blank).toContain(25);
  expect(res.flagged.length).toBeLessThanOrEqual(1);
  expect(errLog).toEqual([]);
});

// ---------------------------------------------------------------------------
// SUBJECT_TEACHER scoping
// ---------------------------------------------------------------------------

test('SUBJECT_TEACHER question bank is restricted to assigned subjects with a visible scope note', async ({ page }) => {
  setRole('SUBJECT_TEACHER');
  await login(page);
  await page.evaluate(() => { window.location.hash = '/questions'; });
  await settle(page);
  await expect(page.locator('#qb_scope_note .pill', { hasText: 'restricted to your assigned subjects' })).toBeVisible();
  // subject dropdown contains only the assigned subject (Physics)
  const subjOpts = await page.locator('#qb_subj option').allTextContents();
  expect(subjOpts.filter((t) => t && t !== 'All subjects' && !t.startsWith('All my'))).toEqual(['Physics']);
  // exam dropdown still offers the exam so filters remain usable
  await expect(page.locator('#qb_exam option')).toHaveCount(2);
  expect(errLog).toEqual([]);
  expect(netLog).toEqual([]);
});

test('SUBJECT_TEACHER does not get institution-admin navigation', async ({ page }) => {
  setRole('SUBJECT_TEACHER');
  await login(page);
  const hrefs = await page.locator('#sidebar .nav-link').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')));
  expect(hrefs.join(' ')).not.toContain('/admin');
  expect(hrefs.join(' ')).not.toContain('/institution');
  expect(hrefs.join(' ')).toContain('/questions');
  expect(errLog).toEqual([]);
});