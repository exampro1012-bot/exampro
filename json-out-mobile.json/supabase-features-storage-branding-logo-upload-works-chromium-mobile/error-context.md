# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: supabase-features.spec.ts >> storage: branding logo upload works
- Location: tests\supabase-features.spec.ts:172:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('#b_logo_preview img')
Expected: visible
Received: hidden
Timeout:  10000ms

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('#b_logo_preview img')
    13 × locator resolved to <img src=""/>
       - unexpected value "hidden"

```

```yaml
- complementary:
  - text: E ExamPro
  - button "Close menu": ×
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
  - button "Menu": ☰
  - text: Settings
  - combobox:
    - option "EN" [selected]
    - option "HI"
    - option "GU"
  - button "Notifications": 🔔
  - button "Log out": ⏻
- main:
  - heading "Settings" [level=2]
  - heading "Profile" [level=3]
  - text: Full name
  - textbox: admin@exampro.com
  - text: Email
  - textbox [disabled]: admin@exampro.com
  - text: Phone
  - textbox
  - button "Save profile"
  - heading "Security" [level=3]
  - text: Current password
  - textbox "Enter current password"
  - text: New password
  - textbox "Min 8 chars, uppercase, lowercase, number, special char"
  - text: Confirm new password
  - textbox "Re-enter new password"
  - button "Change password"
  - heading "Connected accounts" [level=3]
  - list:
    - listitem: Email / Password Connected
    - listitem:
      - text: Google Not connected
      - button "Connect"
  - paragraph: You must have at least one authentication method connected.
  - heading "Language" [level=3]
  - paragraph: UI language for this browser (question content keeps its original language and scientific notation).
  - button "English"
  - button "हिन्दी"
  - button "ગુજરાતી"
  - heading "Notifications" [level=3]
  - paragraph: Choose which notification types you want to see in this browser.
  - checkbox "dpp assigned" [checked]
  - text: dpp assigned
  - checkbox "exam assigned" [checked]
  - text: exam assigned
  - checkbox "result published" [checked]
  - text: result published
  - checkbox "weak topic" [checked]
  - text: weak topic
  - checkbox "revision due" [checked]
  - text: revision due
  - checkbox "announcement" [checked]
  - text: announcement
  - heading "Storage & Google Drive" [level=3]
  - paragraph: Google Drive connection, folder structure, uploads and retry queue are managed from the storage dashboard.
  - link "Open Google Drive / Storage dashboard":
    - /url: "#/admin/storage"
  - heading "Roles & permissions" [level=3]
  - paragraph: "Your role: SUPER_ADMIN · permissions granted: 42 (frontend gate). Database RLS + RPC authorization enforce the same grants server-side."
  - link "Tenants & memberships":
    - /url: "#/admin/tenants"
  - link "Security events":
    - /url: "#/admin/security"
  - heading "Institution branding" [level=3]
  - text: Institution name
  - textbox: ExamPro Platform
  - text: Address
  - textbox
  - text: GSTIN
  - textbox
  - text: Header text
  - textbox
  - text: Footer text
  - textbox
  - text: Logo URL
  - textbox
  - text: Logo image
  - button "Choose File"
  - button "Upload"
  - text: Watermark image
  - button "Choose File"
  - button "Upload"
  - img
  - button "Save branding"
- navigation:
  - link "▦ Dashboard":
    - /url: "#/dashboard"
  - link "🎯 Practice":
    - /url: "#/practice"
  - link "❓ Question":
    - /url: "#/questions"
  - link "📄 Papers":
    - /url: "#/papers"
  - link "🗓 DPP":
    - /url: "#/dpp"
```

# Test source

```ts
  79  |     // path — no dependency on a pre-populated corpus)
  80  |     await page.goto('/#/papers/new');
  81  |     await page.waitForSelector('#p_exam option', { state: 'attached' });
  82  |     await page.selectOption('#p_exam', { value: probes.examId });
  83  |     if (probes.subjectId) {
  84  |       await page.waitForSelector(`#p_subj option[value="${probes.subjectId}"]`, { state: 'attached', timeout: 10000 });
  85  |       await page.selectOption('#p_subj', { value: probes.subjectId });
  86  |     }
  87  |     await page.fill('#p_count', '5');
  88  |     await page.click('#gen_btn');
  89  |     await page.waitForSelector('#gen_result a', { timeout: 15000 });
  90  |     const href = await page.getAttribute('#gen_result a', 'href', { timeout: 5000 });
  91  |     if (!href) throw new Error('paper generation link not found in #gen_result');
  92  |     const paperId = href.split('/').pop()!;
  93  |     // sheet generation (param route /omr/sheets/:id must render, not dashboard)
  94  |     await page.goto('/#/omr/sheets/new');
  95  |     // Wait for the specific paper option (not just the placeholder) — mobile
  96  |     // rendering can be slow and the just-created paper may lag the SELECT.
  97  |     await page.waitForSelector(`#s_paper option[value="${paperId}"]`, { state: 'attached', timeout: 15000 });
  98  |     await page.selectOption('#s_paper', { value: paperId });
  99  |     await page.fill('#s_roll', 'ROLL-1');
  100 |     await page.click('#s_gen');
  101 |     await page.waitForSelector('#eval_btn', { timeout: 15000 });
  102 |     // verify the sheet page rendered (param routing fix) — scannable OMR layout
  103 |     await expect(page.locator('.omr-b')).toHaveCount(20); // 5 questions x 4 options
  104 |     // OMR bubble selects may need a tick on mobile before interaction is stable
  105 |     await page.waitForSelector('#omr_q_1', { state: 'attached', timeout: 5000 });
  106 |     await page.selectOption('#omr_q_1', { index: 1 });
  107 |     await page.selectOption('#omr_q_2', { index: 1 });
  108 |     await page.click('#eval_btn');
  109 |     // evaluation re-renders the sheet page with the server-computed Score card
  110 |     await expect(page.locator('.score-card')).toBeVisible({ timeout: 10000 });
  111 |     await expect(page.locator('.score-card')).toContainText(/Correct:/, { timeout: 5000 });
  112 | 
  113 |     // best-effort cleanup: sheets + template + generated paper + usage rows
  114 |     const c = probes.sb;
  115 |     try {
  116 |       const { data: tpl } = await c.from('omr_templates').select('id').eq('name', tplName).maybeSingle();
  117 |       if (tpl) {
  118 |         await c.from('omr_sheets').delete().eq('template_id', tpl.id);
  119 |         await c.from('omr_templates').delete().eq('id', tpl.id);
  120 |       }
  121 |     await c.from('question_usage').delete().eq('used_in_type', 'PAPER').eq('used_in_id', paperId);
  122 |     await c.from('papers').delete().eq('id', paperId);
  123 |   } catch (e) { console.log('  cleanup failed (OMR):', (e as Error).message); }
  124 |   } finally {
  125 |     await cleanupProbes(probes.sb, probes.ids);
  126 |   }
  127 | });
  128 | 
  129 | test('param routing: /papers/:id and /questions/:id render (not dashboard)', async ({ page }) => {
  130 |   const probes = await seedVerifiedProbes(5);
  131 |   try {
  132 |     await login(page);
  133 |     // generate a paper from the test's own verified probes (subject-filtered
  134 |     // path — no dependency on a pre-populated corpus)
  135 |     await navHash(page, '/papers/new');
  136 |     await page.waitForSelector('#p_exam option', { state: 'attached' });
  137 |     await page.selectOption('#p_exam', { value: probes.examId });
  138 |     if (probes.subjectId) {
  139 |       await page.waitForSelector(`#p_subj option[value="${probes.subjectId}"]`, { state: 'attached', timeout: 10000 });
  140 |       await page.selectOption('#p_subj', { value: probes.subjectId });
  141 |     }
  142 |     await page.fill('#p_count', '5');
  143 |     // reset the monthly generation quota first so this suite is repeatable
  144 |     // even when other suites (drive-e2e) consumed papers in parallel
  145 |     const c0 = probes.sb;
  146 |     await c0.from('usage').delete().eq('tenant_id', '00000000-0000-0000-0000-000000000001');
  147 |     await page.click('#gen_btn');
  148 |     await page.waitForSelector('#gen_result a[href*="/papers/"]', { timeout: 15000 });
  149 |     await page.click('#gen_result a[href*="/papers/"]');
  150 |     await expect(page).toHaveURL(/\/papers\//, { timeout: 10000 });
  151 |     await expect(page.locator('#ep_main')).not.toContainText('Dashboard', { timeout: 5000 });
  152 |   // create a question, then open its edit route
  153 |   await navHash(page, '/questions/new');
  154 |   await page.waitForSelector('#f_type option:nth-child(2)', { state: 'attached' });
  155 |   await page.selectOption('#f_subj', { index: 1 });
  156 |   await page.selectOption('#f_type', { index: 1 });
  157 |   await page.fill('#f_text', 'Routing test question ' + Date.now() + '?');
  158 |   await page.fill('#f_correct', 'A');
  159 |   await page.click('#save_q');
  160 |   await page.waitForURL(/\/questions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, { timeout: 15000 });
  161 |   const qUrl = page.url();
  162 |   await navHash(page, qUrl.split('/#')[1] || '/questions'); // re-open via /questions/:id (param route)
  163 |   await expect(page.locator('#ep_main')).not.toContainText('Dashboard', { timeout: 5000 });
  164 |   // clean up the routing question so the live bank stays fixture-free
  165 |   const routedId = qUrl.split('/').pop()!;
  166 |   await probes.sb.from('questions').delete().eq('id', routedId);
  167 |   } finally {
  168 |     await cleanupProbes(probes.sb, probes.ids);
  169 |   }
  170 | });
  171 | 
  172 | test('storage: branding logo upload works', async ({ page }) => {
  173 |   await login(page);
  174 |   await page.goto('/#/settings');
  175 |   await expect(page.locator('#b_upload')).toBeVisible();
  176 |   const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  177 |   await page.setInputFiles('#b_logo_file', { name: 'px.png', mimeType: 'image/png', buffer: png });
  178 |   await page.click('#b_upload');
> 179 |   await expect(page.locator('#b_logo_preview img')).toBeVisible({ timeout: 10000 });
      |                                                     ^ Error: expect(locator).toBeVisible() failed
  180 |   const src = await page.getAttribute('#b_logo_preview img', 'src');
  181 |   expect(src).toContain('/storage/v1/object/');
  182 | });
  183 | 
  184 | // Signed-in client for server-side data setup (RLS applies to the test user).
  185 | async function authedClient() {
  186 |   const c = createClient(URL!, ANON!, { auth: { persistSession: false } });
  187 |   const { data, error } = await c.auth.signInWithPassword({ email: EMAIL, password: PASS });
  188 |   if (error || !data.session) throw new Error('re-login failed: ' + (error ? error.message : 'no session'));
  189 |   return c;
  190 | }
  191 | 
  192 | // Self-sufficient verified probe questions: generation flows are exercised via
  193 | // the subject-filtered path so tests never depend on a pre-populated corpus.
  194 | async function seedVerifiedProbes(n: number) {
  195 |   const sb = await authedClient();
  196 |   const { data: exam } = await sb.from('exams').select('id,name').eq('name', 'AP EAMCET').maybeSingle();
  197 |   const examId = exam?.id || (await sb.from('exams').select('id').order('name').limit(1).single()).data!.id;
  198 |   const { data: subj } = await sb.from('subjects').select('id').eq('exam_id', examId).limit(1).maybeSingle();
  199 |   const { data: qtype } = await sb.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
  200 |   const { data: me } = await sb.auth.getUser();
  201 |   const { data: mem } = await sb.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  202 |   const tag = 'FeatProbe' + Date.now();
  203 |   const ids: string[] = [];
  204 |   for (let i = 0; i < n; i++) {
  205 |     const { data: q, error } = await sb.from('questions').insert({
  206 |       tenant_id: mem!.tenant_id, exam_id: examId, subject_id: subj?.id || null,
  207 |       question_type_id: qtype?.id || null,
  208 |       question_text: `Feature generation probe ${tag} Q${i + 1}?`,
  209 |       difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW', source: tag,
  210 |     }).select().single();
  211 |     if (error || !q) throw new Error('probe insert failed: ' + (error?.message || 'no row'));
  212 |     const { error: vErr } = await sb.rpc('app_verify_question', { p_question_id: q.id, p_decision: 'VERIFIED', p_note: 'qa probe' });
  213 |     if (vErr) throw new Error('probe verify failed: ' + vErr.message);
  214 |     ids.push(q.id);
  215 |   }
  216 |   return { sb, examId, subjectId: subj?.id || null, ids, tag };
  217 | }
  218 | 
  219 | async function cleanupProbes(sb: any, ids: string[]) {
  220 |   if (!ids.length) return;
  221 |   await sb.from('question_usage').delete().in('question_id', ids);
  222 |   await sb.from('questions').delete().in('id', ids);
  223 | }
  224 | 
  225 | test('question bank list page loads (requires migration 0028: questions.ncert)', async ({ page }) => {
  226 |   await login(page);
  227 |   await page.goto('/#/questions');
  228 |   // Regression for schema drift: the list SELECTs questions.ncert; if the live
  229 |   // DB lacks the column (migration 0028 not applied), the list shows
  230 |   // "column questions.ncert does not exist" and rows never render.
  231 |   await expect(page.locator('#qb_list .qtxt').first()).toBeVisible({ timeout: 15000 });
  232 |   await expect(page.locator('#qb_list')).not.toContainText('does not exist');
  233 | });
  234 | 
  235 | // Seed one VERIFIED practice question (chapter + topic + 4 options + answer)
  236 | // so student-facing drills are testable without any pre-populated corpus.
  237 | async function seedPracticeQuestion() {
  238 |   const c = await authedClient();
  239 |   const { data: ch } = await c.from('chapters').select('id, subject_id, subjects(exam_id)').limit(1).maybeSingle();
  240 |   if (!ch) return null;
  241 |   const { data: topic } = await c.from('topics').select('id, name').eq('chapter_id', ch.id).limit(1).maybeSingle();
  242 |   const { data: qtype } = await c.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
  243 |   const { data: me } = await c.auth.getUser();
  244 |   const { data: mem } = await c.from('tenant_memberships').select('tenant_id').eq('user_id', me.user!.id).maybeSingle();
  245 |   const tag = 'PracticeProbe' + Date.now();
  246 |   const { data: q, error } = await c.from('questions').insert({
  247 |     tenant_id: mem!.tenant_id, exam_id: (ch.subjects as any)?.exam_id || null, subject_id: ch.subject_id,
  248 |     chapter_id: ch.id, topic_id: topic?.id || null, question_type_id: qtype?.id || null,
  249 |     question_text: `Practice drill probe ${tag}: which option is A?`,
  250 |     difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW', source: tag,
  251 |   }).select().single();
  252 |   if (error || !q) throw new Error('practice probe insert failed: ' + (error?.message || 'no row'));
  253 |   await c.rpc('app_verify_question', { p_question_id: q.id, p_decision: 'VERIFIED', p_note: 'qa probe' });
  254 |   const optErrs: string[] = [];
  255 |   for (let i = 0; i < 4; i++) {
  256 |     const key = 'ABCD'[i];
  257 |     const { error: oErr } = await c.from('question_options').insert({
  258 |       question_id: q.id, option_key: key, option_text: `Option ${key} (${tag})`, display_order: i + 1, is_correct: key === 'A',
  259 |     });
  260 |     if (oErr) optErrs.push(oErr.message);
  261 |   }
  262 |   const { error: aErr } = await c.from('question_answers').insert({
  263 |     question_id: q.id, correct_option_keys: ['A'], answer_type: 'MCQ', source: 'QA_PROBE', verification_status: 'VERIFIED', confidence: 99,
  264 |   });
  265 |   if (optErrs.length || aErr) throw new Error('practice probe options/answer failed: ' + JSON.stringify({ optErrs, aErr: aErr?.message }));
  266 |   return { c, q, topicId: topic?.id || null, topicName: topic?.name || null, tag };
  267 | }
  268 | 
  269 | test('practice: chapter drill renders the demo question with options and answer', async ({ page }) => {
  270 |   const probe = await seedPracticeQuestion();
  271 |   if (!probe) throw new Error('No chapters configured for practice seeding — run scripts/e2e-bootstrap.mjs to seed the demo syllabus.');
  272 |   try {
  273 |     await login(page);
  274 |     await navHash(page, '/practice/chapter/' + probe.q.chapter_id);
  275 |     await page.waitForSelector('.pq', { timeout: 15000 });
  276 |     await expect(page.locator('.pq').first()).toBeVisible();
  277 |     await expect(page.locator('.pq .opts li').first()).toBeVisible();
  278 |     await page.locator('.pq [data-reveal]').first().click();
  279 |     await expect(page.locator('.answer-reveal').first()).toContainText(/Answer:/, { timeout: 5000 });
```