# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: exampro-ui.spec.ts >> boot: setup config -> login -> app shell with full nav
- Location: tests\exampro-ui.spec.ts:81:1

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 20
Received:    12

Call Log:
- Timeout 15000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - complementary [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: E
      - generic [ref=e6]: ExamPro
    - navigation [ref=e7]:
      - link "▦ Dashboard" [ref=e8] [cursor=pointer]:
        - /url: "#/dashboard"
        - generic [ref=e9]: ▦
        - generic [ref=e10]: Dashboard
      - link "🎯 Practice" [ref=e11] [cursor=pointer]:
        - /url: "#/practice"
        - generic [ref=e12]: 🎯
        - generic [ref=e13]: Practice
      - link "❓ Question Bank" [ref=e14] [cursor=pointer]:
        - /url: "#/questions"
        - generic [ref=e15]: ❓
        - generic [ref=e16]: Question Bank
      - link "📊 Results" [ref=e17] [cursor=pointer]:
        - /url: "#/results"
        - generic [ref=e18]: 📊
        - generic [ref=e19]: Results
      - link "⭐ Bookmarks" [ref=e20] [cursor=pointer]:
        - /url: "#/bookmarks"
        - generic [ref=e21]: ⭐
        - generic [ref=e22]: Bookmarks
      - link "📝 Mistakes" [ref=e23] [cursor=pointer]:
        - /url: "#/mistakes"
        - generic [ref=e24]: 📝
        - generic [ref=e25]: Mistakes
      - link "🤖 AI Tutor" [ref=e26] [cursor=pointer]:
        - /url: "#/ai-tutor"
        - generic [ref=e27]: 🤖
        - generic [ref=e28]: AI Tutor
      - link "∑ Formulas" [ref=e29] [cursor=pointer]:
        - /url: "#/formulas"
        - generic [ref=e30]: ∑
        - generic [ref=e31]: Formulas
      - link "👤 Settings" [ref=e32] [cursor=pointer]:
        - /url: "#/settings"
        - generic [ref=e33]: 👤
        - generic [ref=e34]: Settings
      - link "📉 Weak Topics" [ref=e35] [cursor=pointer]:
        - /url: "#/weak-topics"
        - generic [ref=e36]: 📉
        - generic [ref=e37]: Weak Topics
      - link "🔄 Revision" [ref=e38] [cursor=pointer]:
        - /url: "#/revision"
        - generic [ref=e39]: 🔄
        - generic [ref=e40]: Revision
      - link "⏱ Exam Tracker" [ref=e41] [cursor=pointer]:
        - /url: "#/exam-tracker"
        - generic [ref=e42]: ⏱
        - generic [ref=e43]: Exam Tracker
    - generic [ref=e44]:
      - generic [ref=e45]:
        - generic [ref=e46]: Q
        - generic [ref=e47]:
          - generic [ref=e48]: QA User
          - generic [ref=e49]: SUBJECT_TEACHER
      - button "Log out" [ref=e50] [cursor=pointer]
  - generic [ref=e51]:
    - banner [ref=e52]:
      - generic [ref=e53]: Dashboard
      - generic [ref=e54]:
        - generic [ref=e55]: SUBJECT_TEACHER
        - combobox [ref=e56]:
          - option "EN" [selected]
          - option "HI"
          - option "GU"
        - button "Notifications" [ref=e57] [cursor=pointer]: 🔔
        - button "Log out" [ref=e58] [cursor=pointer]: ⏻
    - main [ref=e59]:
      - generic [ref=e60]:
        - generic [ref=e61]:
          - heading "Welcome, QA User" [level=2] [ref=e62]
          - generic [ref=e63]: SUBJECT_TEACHER
        - generic [ref=e64]:
          - link "❓ 3 Questions" [ref=e65] [cursor=pointer]:
            - /url: "#/questions"
            - generic [ref=e66]: ❓
            - generic [ref=e67]: "3"
            - generic [ref=e68]: Questions
          - link "📄 1 Papers" [ref=e69] [cursor=pointer]:
            - /url: "#/papers"
            - generic [ref=e70]: 📄
            - generic [ref=e71]: "1"
            - generic [ref=e72]: Papers
          - link "🗓 1 DPPs" [ref=e73] [cursor=pointer]:
            - /url: "#/dpp"
            - generic [ref=e74]: 🗓
            - generic [ref=e75]: "1"
            - generic [ref=e76]: DPPs
          - link "📊 1 Results" [ref=e77] [cursor=pointer]:
            - /url: "#/results"
            - generic [ref=e78]: 📊
            - generic [ref=e79]: "1"
            - generic [ref=e80]: Results
        - generic [ref=e81]:
          - generic [ref=e82]:
            - heading "Recent papers" [level=3] [ref=e83]
            - list [ref=e84]:
              - listitem [ref=e85]:
                - link "Mock Paper" [ref=e86] [cursor=pointer]:
                  - /url: "#/papers/10000000-0000-0000-0000-00000000000c"
                - generic [ref=e87]: 1 Qs
          - generic [ref=e88]:
            - heading "Quick actions" [level=3] [ref=e89]
            - link "Take / assign exam" [ref=e91] [cursor=pointer]:
              - /url: "#/exams"
```

# Test source

```ts
  1   | // Structural UI regression suite — runs ANYWHERE (no backend required).
  2   | // A mock Supabase HTTP layer (see mock-supabase.ts) serves auth + PostgREST +
  3   | // storage, so the full SPA shell and every route render and can be asserted on.
  4   | // Covers: boot/login, route coverage with zero page errors, responsive browser
  5   | // matrix (360–1920), nav link integrity, print layout, auth flows (sign-up,
  6   | // forgot/reset password, session persistence), and key feature pages.
  7   | 
  8   | import { test, expect } from '@playwright/test';
  9   | import { installMocks, setGoogleEnabled } from './mock-supabase';
  10  | 
  11  | test.describe.configure({ mode: 'serial' });
  12  | 
  13  | const IDs = {
  14  |   paper: '10000000-0000-0000-0000-00000000000c',
  15  |   q: '10000000-0000-0000-0000-00000000000a',
  16  |   dpp: '10000000-0000-0000-0000-000000000014',
  17  |   exam: '10000000-0000-0000-0000-000000000001',
  18  |   subject: '10000000-0000-0000-0000-000000000002',
  19  |   chapter: '10000000-0000-0000-0000-000000000003',
  20  |   topic: '10000000-0000-0000-0000-000000000004',
  21  |   session: '10000000-0000-0000-0000-00000000000e',
  22  |   sheet: '10000000-0000-0000-0000-000000000013',
  23  | };
  24  | 
  25  | // concrete paths for parameterized routes
  26  | const paramRoutes: Record<string, string> = {
  27  |   '/questions/:id': `/questions/${IDs.q}`,
  28  |   '/questions/:id/edit': `/questions/${IDs.q}/edit`,
  29  |   '/papers/:id': `/papers/${IDs.paper}`,
  30  |   '/dpp/:id': `/dpp/${IDs.dpp}`,
  31  |   '/exam/:id': `/exam/${IDs.exam}`,
  32  |   '/practice/chapter/:id': `/practice/chapter/${IDs.chapter}`,
  33  |   '/practice/topic/:id': `/practice/topic/${IDs.topic}`,
  34  |   '/results/session/:id': `/results/session/${IDs.session}`,
  35  |   '/omr/sheets/:id': `/omr/sheets/${IDs.sheet}`,
  36  | };
  37  | 
  38  | let errLog: string[] = [];
  39  | let netLog: string[] = [];
  40  | 
  41  | async function login(page: import('@playwright/test').Page) {
  42  |   await page.goto('/');
  43  |   await expect(page.locator('#auth')).toBeVisible();
  44  |   await page.click('[data-tab="login"]');
  45  |   await page.fill('#au_email', 'qa@exampro.test');
  46  |   await page.fill('#au_pw', 'MockPassword1!');
  47  |   await page.click('#au_login_btn');
  48  |   await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  49  |   await expect(page.locator('#ep_main .loading')).toHaveCount(0, { timeout: 20000 });
  50  | }
  51  | 
  52  | async function settle(page: import('@playwright/test').Page) {
  53  |   await page.waitForFunction(() => {
  54  |     const m = document.querySelector('#ep_main');
  55  |     if (!m) return false;
  56  |     if (m.querySelector('.loading')) return false;
  57  |     if (m.querySelector('.page, .empty, .card, .table-wrap, form, canvas')) return true;
  58  |     return m.textContent && m.textContent.trim().length > 0;
  59  |   }, undefined, { timeout: 20000 });
  60  | }
  61  | 
  62  | test.beforeEach(async ({ page }) => {
  63  |   errLog = [];
  64  |   netLog = [];
  65  |   page.on('pageerror', (e) => errLog.push('pageerror: ' + e.message));
  66  |   page.on('console', (m) => { if (m.type() === 'error') errLog.push('console: ' + m.text()); });
  67  |   // network sweep: any 4xx/5xx is a failure unless it is the documented
  68  |   // PGRST116 "0 rows" signal the app uses for maybeSingle empties.
  69  |   page.on('response', (r) => {
  70  |     const s = r.status();
  71  |     if (s >= 400 && s !== 406) netLog.push(`${s} ${r.request().method()} ${r.url()}`);
  72  |   });
  73  |   page.route('**cdn.jsdelivr.net/**', (route) => route.fulfill({
  74  |     status: 200,
  75  |     contentType: 'text/javascript',
  76  |     body: 'window.Chart = function () { return { destroy: function () {}, update: function () {} }; };',
  77  |   }));
  78  |   installMocks(page);
  79  | });
  80  | 
  81  | test('boot: setup config -> login -> app shell with full nav', async ({ page }) => {
  82  |   await login(page);
> 83  |   await expect.poll(() => page.locator('#sidebar .nav-link').count(), { timeout: 15000 }).toBeGreaterThanOrEqual(20);
      |                                                                                           ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  84  |   expect(errLog).toEqual([]);
  85  | });
  86  | 
  87  | test('every registered route renders without page errors', async ({ page }) => {
  88  |   await login(page);
  89  |   const routes = await page.evaluate(() => Object.keys((window as any).EP.routes));
  90  |   expect(routes.length).toBeGreaterThanOrEqual(55);
  91  |   for (const r of routes) {
  92  |     const target = paramRoutes[r] || r;
  93  |     await page.evaluate((p) => { window.location.hash = p; }, target);
  94  |     await settle(page);
  95  |     const hasError = await page.evaluate(() => !!document.querySelector('#ep_main .empty.error'));
  96  |     expect(hasError, `route ${r} (${target}) rendered the error banner`).toBe(false);
  97  |     expect(errLog, `route ${r} (${target}) produced uncaught errors`).toEqual([]);
  98  |     expect(netLog, `route ${r} (${target}) produced failed requests`).toEqual([]);
  99  |   }
  100 | });
  101 | 
  102 | // full acceptance matrix: 360..1920 x 667..1080
  103 | const viewports = [
  104 |   { w: 360, h: 800, mobile: true },
  105 |   { w: 390, h: 844, mobile: true },
  106 |   { w: 412, h: 915, mobile: true },
  107 |   { w: 768, h: 1024, mobile: true },
  108 |   { w: 1024, h: 768, mobile: false },
  109 |   { w: 1280, h: 800, mobile: false },
  110 |   { w: 1366, h: 768, mobile: false },
  111 |   { w: 1440, h: 900, mobile: false },
  112 |   { w: 1920, h: 1080, mobile: false },
  113 | ];
  114 | 
  115 | test('responsive browser matrix: no horizontal overflow, correct nav chrome', async ({ page }) => {
  116 |   await login(page);
  117 |   for (const v of viewports) {
  118 |     await page.setViewportSize({ width: v.w, height: v.h });
  119 |     await page.evaluate(() => { window.location.hash = '/dashboard'; });
  120 |     await settle(page);
  121 |     const metrics = await page.evaluate(() => {
  122 |       const sb = document.querySelector('#sidebar') as HTMLElement;
  123 |       const main = document.querySelector('#ep_main') as HTMLElement;
  124 |       const sbr = sb.getBoundingClientRect();
  125 |       const mr = main.getBoundingClientRect();
  126 |       return {
  127 |         scrollW: document.documentElement.scrollWidth,
  128 |         innerW: window.innerWidth,
  129 |         bottomNav: getComputedStyle(document.querySelector('#bottom_nav') as HTMLElement).display,
  130 |         sidebar: getComputedStyle(sb).display,
  131 |         sidebarRight: sbr.right,
  132 |         mainLeft: mr.left,
  133 |       };
  134 |     });
  135 |     expect(metrics.scrollW, `viewport ${v.w}x${v.h} overflows horizontally`).toBeLessThanOrEqual(metrics.innerW + 1);
  136 |     if (v.mobile) {
  137 |       expect(metrics.bottomNav, `${v.w}px should show bottom nav`).toBe('flex');
  138 |     } else {
  139 |       expect(metrics.bottomNav, `${v.w}px should hide bottom nav`).toBe('none');
  140 |       expect(metrics.sidebar, `${v.w}px should show sidebar`).toBe('flex');
  141 |       // sidebar must not cover content: main starts at or after sidebar's right edge
  142 |       expect(metrics.mainLeft, `${v.w}px sidebar overlaps main content`).toBeGreaterThanOrEqual(metrics.sidebarRight - 1);
  143 |     }
  144 |   }
  145 |   expect(errLog).toEqual([]);
  146 |   expect(netLog).toEqual([]);
  147 | });
  148 | 
  149 | test('every sidebar/nav anchor resolves to a registered route', async ({ page }) => {
  150 |   await login(page);
  151 |   const bad = await page.evaluate(() => {
  152 |     const EP = (window as any).EP;
  153 |     const routes = EP.routes;
  154 |     function resolve(p: string): boolean {
  155 |       if (routes[p]) return true;
  156 |       const segs = p.split('/');
  157 |       for (const rk in routes) {
  158 |         const rsegs = rk.split('/');
  159 |         if (rsegs.length !== segs.length) continue;
  160 |         let ok = true;
  161 |         for (let i = 0; i < rsegs.length; i++) {
  162 |           if (rsegs[i].charAt(0) === ':') continue;
  163 |           if (rsegs[i] !== segs[i]) { ok = false; break; }
  164 |         }
  165 |         if (ok) return true;
  166 |       }
  167 |       return false;
  168 |     }
  169 |     const bad: string[] = [];
  170 |     document.querySelectorAll('#sidebar a[href^="#/"], #bottom_nav a[href^="#/"]').forEach((a) => {
  171 |       const p = (a.getAttribute('href') || '').slice(1);
  172 |       if (!resolve(p)) bad.push(p);
  173 |     });
  174 |     return bad;
  175 |   });
  176 |   expect(bad).toEqual([]);
  177 | });
  178 | 
  179 | test('new feature routes are registered', async ({ page }) => {
  180 |   await login(page);
  181 |   const present = await page.evaluate(() => {
  182 |     const r = (window as any).EP.routes;
  183 |     return ['/questions/import', '/admin/patterns', '/admin/tenants', '/admin/security', '/admin/plans', '/institution', '/ai-tutor', '/weak-topics', '/revision', '/exam-tracker'].filter((p) => !!r[p]);
```