# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: supabase-repair.spec.ts >> import pipeline persists the ncert column
- Location: tests\supabase-repair.spec.ts:143:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('.q-meta')
Expected substring: "NCERT"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('.q-meta')

```

```yaml
- complementary:
  - text: E ExamPro
  - navigation:
    - link "▦ Dashboard":
      - /url: "#/dashboard"
    - link "🎯 Practice":
      - /url: "#/practice"
    - link "❓ Question Bank":
      - /url: "#/questions"
    - link "📄 Papers":
      - /url: "#/papers"
    - link "🗓 DPP":
      - /url: "#/dpp"
    - link "✍ Exams":
      - /url: "#/exams"
    - link "📊 Results":
      - /url: "#/results"
    - link "⭐ Bookmarks":
      - /url: "#/bookmarks"
    - link "📝 Mistakes":
      - /url: "#/mistakes"
    - link "▣ OMR":
      - /url: "#/omr"
    - link "📈 Analytics":
      - /url: "#/analytics"
    - link "📋 Reports":
      - /url: "#/reports"
    - link "⚙ Admin":
      - /url: "#/admin"
    - link "🗂 Ingestion":
      - /url: "#/admin/ingestion"
    - link "📚 Official PYQ":
      - /url: "#/admin/official-pyq"
    - link "🌐 Official Sources":
      - /url: "#/admin/sources"
    - link "📗 Syllabus Versions":
      - /url: "#/admin/syllabus"
    - link "🔑 Answer Key":
      - /url: "#/admin/ingestion/answerkey"
    - link "🧠 Solution Queue":
      - /url: "#/admin/solutions/queue"
    - link "✅ AI Review":
      - /url: "#/admin/solutions/review"
    - link "🏫 Institution":
      - /url: "#/institution"
    - link "🤖 AI Tutor":
      - /url: "#/ai-tutor"
    - link "∑ Formulas":
      - /url: "#/formulas"
    - link "👤 Settings":
      - /url: "#/settings"
    - link "📌 Assignments":
      - /url: "#/assignments"
    - link "📉 Weak Topics":
      - /url: "#/weak-topics"
    - link "🔄 Revision":
      - /url: "#/revision"
    - link "⏱ Exam Tracker":
      - /url: "#/exam-tracker"
  - text: A admin@exampro.com Super Admin
  - button "Log out"
- banner:
  - text: ExamPro Super Admin
  - combobox:
    - option "EN" [selected]
    - option "HI"
    - option "GU"
  - button "Notifications": 🔔
  - button "Log out": ⏻
- main:
  - paragraph: Loading question…
```

# Test source

```ts
  63  |   }
  64  |   return { examId, subjectId: subj?.id || null, ids, tag };
  65  | }
  66  | 
  67  | async function login(page: any) {
  68  |   await page.goto('/');
  69  |   await page.waitForSelector('#auth, #setup', { timeout: 15000 });
  70  |   if (await page.locator('#cfg_save').count()) {
  71  |     await page.fill('#cfg_url', URL!);
  72  |     await page.fill('#cfg_key', ANON!);
  73  |     await page.click('#cfg_save');
  74  |   }
  75  |   await expect(page.locator('#auth')).toBeVisible();
  76  |   await page.click('[data-tab="login"]');
  77  |   await page.fill('#au_email', EMAIL);
  78  |   await page.fill('#au_pw', PASS);
  79  |   await page.click('#au_login_btn');
  80  |   await expect(page.locator('#app.app-shell')).toBeVisible({ timeout: 20000 });
  81  | }
  82  | 
  83  | test.beforeAll(async () => {
  84  |   if (!URL || !ANON || !EMAIL || !PASS) throw new Error('Missing E2E environment: set SUPABASE_URL/ANON/TEST_EMAIL/PASSWORD (see scripts/e2e-bootstrap.mjs).');
  85  |   const sb = createClient(URL!, ANON!, { auth: { persistSession: false } });
  86  |   const { error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  87  |   if (error) throw new Error('supplied account failed to sign in: ' + error.message + ' — see scripts/e2e-bootstrap.mjs.');
  88  | });
  89  | 
  90  | test('ncert checkbox persists on create, shows badge, survives edit', async ({ page }) => {
  91  |   const sb = await client();
  92  |   if (!(await hasNcertColumn(sb))) throw new Error('questions.ncert column missing — migration 0028 not applied. Run `supabase db push` (see scripts/e2e-bootstrap.mjs).');
  93  |   await login(page);
  94  |   await page.goto('/#/questions/new');
  95  |   await expect(page.locator('#save_q')).toBeVisible();
  96  |   await page.waitForSelector('#f_type option:nth-child(2)', { state: 'attached', timeout: 10000 });
  97  |   await page.selectOption('#f_subj', { index: 1 });
  98  |   await page.selectOption('#f_type', { index: 1 });
  99  |   await page.fill('#f_text', 'NCERT repair test question ' + Date.now() + '?');
  100 |   await page.check('#f_ncert');
  101 |   await page.fill('#f_correct', 'A');
  102 |   await page.click('#save_q');
  103 |   await expect(page).toHaveURL(/#\/questions\/[0-9a-f-]{36}/, { timeout: 15000 });
  104 |   const qId = page.url().split('/').pop()!;
  105 |   await expect(page.locator('.q-meta')).toContainText('NCERT');
  106 |   await page.goto('/#/questions/' + qId + '/edit');
  107 |   await expect(page.locator('#f_ncert')).toBeChecked();
  108 |   await sb.from('questions').delete().eq('id', qId);
  109 | });
  110 | 
  111 | test('question bank exam filter scopes the subject dropdown to one entry', async ({ page }) => {
  112 |   await login(page);
  113 |   await page.goto('/#/questions');
  114 |   await expect(page.locator('#qb_exam')).toBeVisible();
  115 |   const examIds = await page.locator('#qb_exam option').evaluateAll((os) =>
  116 |     os.map((o: any) => ({ v: o.value, t: o.textContent })).filter((x) => x.v)
  117 |   );
  118 |   expect(examIds.length).toBeGreaterThan(0);
  119 |   await page.selectOption('#qb_exam', examIds[0].v);
  120 |   await expect(page.locator('#qb_subj option:not([value=""])')).toHaveCount(0, { timeout: 5000 }).catch(() => {});
  121 |   const subjects = await page.locator('#qb_subj option').evaluateAll((os) =>
  122 |     os.map((o: any) => o.textContent).filter((t) => t && t !== 'All subjects for this exam' && t !== 'All subjects')
  123 |   );
  124 |   const dupes = subjects.filter((s, i) => subjects.indexOf(s) !== i);
  125 |   expect(dupes).toEqual([]);
  126 | });
  127 | 
  128 | test('question bank subject filter actually filters the list (bug fix)', async ({ page }) => {
  129 |   await login(page);
  130 |   await page.goto('/#/questions');
  131 |   await expect(page.locator('#qb_subj')).toBeVisible();
  132 |   await page.waitForSelector('#qb_subj option:nth-child(2)', { state: 'attached', timeout: 10000 });
  133 |   const names = await page.locator('#qb_subj option').evaluateAll((os) =>
  134 |     os.map((o: any) => o.textContent).filter((t) => t && t !== 'All subjects' && t !== 'All subjects for this exam')
  135 |   );
  136 |   expect(names.length).toBeGreaterThan(0);
  137 |   await page.selectOption('#qb_subj', { index: 1 });
  138 |   await expect(page.locator('#qb_list table')).toBeVisible({ timeout: 10000 }).catch(() => {});
  139 |   const cells = await page.locator('#qb_list td:nth-child(3)').allTextContents().catch(() => []);
  140 |   for (const c of cells) expect(c.trim()).toBe(names[0]);
  141 | });
  142 | 
  143 | test('import pipeline persists the ncert column', async ({ page }) => {
  144 |   const sb = await client();
  145 |   if (!(await hasNcertColumn(sb))) throw new Error('questions.ncert column missing — migration 0028 not applied. Run `supabase db push` (see scripts/e2e-bootstrap.mjs).');
  146 |   await login(page);
  147 |   await page.goto('/#/questions/import');
  148 |   await expect(page.locator('#qi_parse')).toBeVisible();
  149 |   const body =
  150 |     'question_text,exam_code,subject_code,question_type_code,difficulty,ncert,option_A,option_B,correct_keys,source\n' +
  151 |     '"NCERT import repair test ' + Date.now() + '?",jee-main,physics,MCQ_SINGLE,EASY,true,Yes,No,A,QA_REPAIR\n';
  152 |   await page.fill('#qi_text', body);
  153 |   await page.click('#qi_parse');
  154 |   await expect(page.locator('#qi_cnt')).toHaveText('1');
  155 |   const qid = await page.locator('#qi_rows td:nth-child(1)').textContent();
  156 |   void qid;
  157 |   await page.click('#qi_import');
  158 |   await expect(page.locator('#qi_status')).toContainText('imported 1', { timeout: 20000 });
  159 |   const { data: rows } = await sb.from('questions').select('id,ncert,verification_status').eq('source', 'QA_REPAIR').order('created_at', { ascending: false }).limit(1);
  160 |   expect(rows && rows.length).toBe(1);
  161 |   expect(rows![0].ncert).toBe(true);
  162 |   await page.goto('/#/questions/' + rows![0].id);
> 163 |   await expect(page.locator('.q-meta')).toContainText('NCERT');
      |                                         ^ Error: expect(locator).toContainText(expected) failed
  164 |   await sb.from('questions').delete().eq('id', rows![0].id);
  165 | });
  166 | 
  167 | test('paper generation persists instructions and renders A4 PDF download', async ({ page }) => {
  168 |   const sb = await client();
  169 |   const probes = await seedVerifiedProbes(sb, 2);
  170 |   await login(page);
  171 |   await page.goto('/#/papers/new');
  172 |   await expect(page.locator('#gen_btn')).toBeVisible();
  173 |   const examId = probes.examId;
  174 |   await page.waitForSelector(`#p_exam option[value="${examId}"]`, { state: 'attached', timeout: 10000 });
  175 |   await page.selectOption('#p_exam', { value: examId });
  176 |   if (probes.subjectId) {
  177 |     await page.waitForSelector(`#p_subj option[value="${probes.subjectId}"]`, { state: 'attached', timeout: 10000 });
  178 |     await page.selectOption('#p_subj', { value: probes.subjectId });
  179 |   }
  180 |   await page.fill('#p_count', '2');
  181 |   await page.fill('#p_title', 'Repair instructions paper ' + Date.now());
  182 |   await page.fill('#p_inst', 'All questions are compulsory. Each correct answer carries +4 marks, -1 for a wrong answer.');
  183 |   try {
  184 |     await page.click('#gen_btn');
  185 |     await expect(page.locator('#gen_result')).toContainText(/Paper generated/, { timeout: 20000 });
  186 |     const href = await page.getAttribute('#gen_result a', 'href', { timeout: 5000 }).catch(() => null);
  187 |     expect(href).toMatch(/\/papers\/[0-9a-f-]{36}/);
  188 |     const paperId = href!.split('/').pop()!;
  189 |     await page.goto('/#/papers/' + paperId);
  190 |     await expect(page.locator('.ph-inst')).toContainText('compulsory');
  191 |     await expect(page.locator('#pdf_btn')).toBeVisible();
  192 |     await expect(page.locator('#pdf_ak_btn')).toBeVisible();
  193 |     await expect(page.locator('#pdf_sol_btn')).toBeVisible();
  194 |     const [download] = await Promise.all([
  195 |       page.waitForEvent('download', { timeout: 15000 }),
  196 |       page.click('#pdf_btn'),
  197 |     ]);
  198 |     expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  199 |     await sb.from('question_usage').delete().eq('used_in_id', paperId);
  200 |     await sb.from('papers').delete().eq('id', paperId);
  201 |   } finally {
  202 |     await sb.from('question_usage').delete().in('question_id', probes.ids);
  203 |     await sb.from('questions').delete().in('id', probes.ids);
  204 |   }
  205 | });
  206 | 
  207 | test('DPP preview renders branding header, print and PDF buttons', async ({ page }) => {
  208 |   const sb = await client();
  209 |   const probes = await seedVerifiedProbes(sb, 2);
  210 |   try {
  211 |     await login(page);
  212 |     await page.goto('/#/dpp/new');
  213 |     await expect(page.locator('#d_gen')).toBeVisible();
  214 |     const examId = probes.examId;
  215 |     await page.waitForSelector(`#d_exam option[value="${examId}"]`, { state: 'attached', timeout: 10000 });
  216 |     await page.selectOption('#d_exam', { value: examId });
  217 |     if (probes.subjectId) {
  218 |       await page.waitForSelector(`#d_subj option[value="${probes.subjectId}"]`, { state: 'attached', timeout: 10000 });
  219 |       await page.selectOption('#d_subj', { value: probes.subjectId });
  220 |     }
  221 |     await page.fill('#d_count', '2');
  222 |     await page.fill('#d_title', 'Repair DPP ' + Date.now());
  223 |     await page.click('#d_gen');
  224 |     await expect(page.locator('#d_res')).toContainText(/DPP created/, { timeout: 20000 });
  225 |     const href = await page.getAttribute('#d_res a', 'href', { timeout: 5000 }).catch(() => null);
  226 |     expect(href).toMatch(/\/dpp\/[0-9a-f-]{36}/);
  227 |     const dppId = href!.split('/').pop()!;
  228 |     await page.goto('/#/dpp/' + dppId);
  229 |     await expect(page.locator('.paper-sheet .print-head')).toBeVisible();
  230 |     await expect(page.locator('#dpp_pdf_btn')).toBeVisible();
  231 |     await expect(page.locator('#dpp_print_btn')).toBeVisible();
  232 |     await sb.from('question_usage').delete().eq('used_in_id', dppId);
  233 |     await sb.from('dpps').delete().eq('id', dppId);
  234 |   } finally {
  235 |     await sb.from('question_usage').delete().in('question_id', probes.ids);
  236 |     await sb.from('questions').delete().in('id', probes.ids);
  237 |   }
  238 | });
  239 | 
  240 | test('question bank health panel renders per-exam eligibility', async ({ page }) => {
  241 |   const sb = await client();
  242 |   if (!(await hasHealthRpc(sb))) throw new Error('app_question_bank_health RPC missing — migration 0029 not applied. Run `supabase db push` (see scripts/e2e-bootstrap.mjs).');
  243 |   await login(page);
  244 |   await page.goto('/#/questions/health');
  245 |   await expect(page.locator('.page-head h2')).toContainText('Question Bank Health', { timeout: 15000 });
  246 |   const examCards = await page.locator('.card h3').allTextContents();
  247 |   expect(examCards.length).toBeGreaterThan(0);
  248 |   await expect(page.locator('.stat-l', { hasText: 'Eligible for papers' }).first()).toBeVisible();
  249 |   const subjRows = await page.locator('.card table tbody tr').count();
  250 |   expect(subjRows).toBeGreaterThan(0);
  251 | });
```