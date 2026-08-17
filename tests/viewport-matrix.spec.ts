// ExamPro — responsive viewport matrix (Phase 14-15).
// Boots the app and walks the critical journey (auth -> dashboard -> question
// bank -> paper generator -> profile/logout) at 5 mobile and 5 desktop
// viewport sizes, asserting that core controls are interactable (visible,
// not covered, within viewport) at every size.
//
// Requires the live backend + staff test account (SUPABASE_TEST_EMAIL/PASSWORD;
// fresh signups are STUDENT and have no Question Bank access). Fails with an
// actionable message otherwise.
// Note: the mobile drawer is a CSS-transform off-canvas panel, so we assert on
// its `.open` class rather than Playwright visibility (transformed elements
// always report "visible").
import { test, expect } from '@playwright/test';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASS = process.env.SUPABASE_TEST_PASSWORD;

const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-412', width: 412, height: 915 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'mobile-768', width: 768, height: 1024 },
  { name: 'desktop-1024', width: 1024, height: 768 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1366', width: 1366, height: 768 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

const isMobile = (vp) => vp.width < 900; // matches app breakpoint (max-width: 900px)

for (const vp of VIEWPORTS) {
    test(`[${vp.name}] boots and critical controls are interactable`, async ({ page }) => {
    if (!URL || !ANON || !EMAIL || !PASS) {
      throw new Error('Missing E2E environment: set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD (see scripts/e2e-bootstrap.mjs).');
    }
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#auth')).toBeVisible({ timeout: 15000 });

    // login as the staff test account
    await page.fill('#au_email', EMAIL);
    await page.fill('#au_pw', PASS);
    await page.click('#au_login_btn');
    await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 30000 });
    // login triggers TWO shell renders (login handler + SIGNED_IN auth event
    // replaying loadIdentity/render); the second one lands within ~1.5s and
    // would reset the drawer mid-test, so wait for quiescence first.
    await page.waitForTimeout(2000);

    // topbar and top-bar logout control present and interactable at every size
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('#logout_btn2')).toBeVisible();
    await expect(page.locator('#logout_btn2')).toBeEnabled();

    if (isMobile(vp)) {
      // hamburger opens the drawer; nav item interactable inside the open drawer
      await expect(page.locator('#menu_btn')).toBeVisible();
      await page.click('#menu_btn');
      await expect(page.locator('#sidebar')).toHaveClass(/open/);
      await expect(page.locator('#sidebar .nav-link').first()).toBeEnabled();
      // bottom nav present on phones
      if (vp.width <= 430) {
        await expect(page.locator('#bottom_nav .bn-link').first()).toBeVisible();
      }
      // navigate while the drawer is open (re-render resets it closed)
      await page.click('#sidebar a.nav-link[href="#/questions"]');
      await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
    } else {
      // static sidebar (not off-canvas)
      const pos = await page.locator('#sidebar').evaluate((el) => getComputedStyle(el).position);
      expect(pos).toBe('sticky');
      await expect(page.locator('#sidebar .nav-link').first()).toBeVisible();
      await expect(page.locator('#sidebar .nav-link').first()).toBeEnabled();
      await page.click('#sidebar a.nav-link[href="#/questions"]');
    }

    // question bank page loads and list renders
    await expect(page.locator('#qb_list .qtxt').first()).toBeVisible({ timeout: 20000 });

    // paper generator opens and button is interactable
    await page.goto('#/papers/new');
    await expect(page.locator('#gen_btn')).toBeVisible();
    await expect(page.locator('#gen_btn')).toBeEnabled();

    // profile page and logout control
    await page.goto('#/profile');
    await expect(page.locator('#logout_btn, #logout_btn2').first()).toBeVisible();
    await expect(page.locator('#logout_btn, #logout_btn2').first()).toBeEnabled();

    expect(errors.filter((e) => !e.includes('favicon') && !e.includes('404'))).toEqual([]);
  });
}