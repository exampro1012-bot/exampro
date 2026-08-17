import { chromium } from '@playwright/test';
import fs from 'fs';
const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY || '';
const PWD = (fs.readFileSync('.test-creds.env', 'utf8').match(/^SUPABASE_TEST_PASSWORD=(.*)$/m) || [])[1] || '';
const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERR', m.text().slice(0, 300)); });
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 120)); });

await page.goto('http://localhost:3000/');
await page.fill('#cfg_url', URL); await page.fill('#cfg_key', ANON); await page.click('#cfg_save');
await page.click('[data-tab="signup"]');
const email = 'dbg' + Date.now() + '@gmail.com';
await page.fill('#au_name', 'QA'); await page.fill('#au_email2', email); await page.fill('#au_pw2', PWD); await page.click('#au_signup_btn');
await page.waitForTimeout(3000);

const role1 = await page.evaluate(() => ({ role: window.EP.state.role, isSuper: window.EP.state.isSuper, uid: window.EP.state.user && window.EP.state.user.id }));
console.log('role after signup =', JSON.stringify(role1));

// attempt escalation to SUPER_ADMIN (documents role behavior)
const esc = await page.evaluate(async () => {
  const sb = window.EP.getClient(); const uid = window.EP.state.user.id;
  let r = {};
  const { error: e1 } = await sb.from('platform_admins').insert({ user_id: uid });
  r.pa = e1 ? e1.message : 'ok';
  const { data: rid } = await sb.from('roles').select('id').eq('code', 'SUPER_ADMIN').maybeSingle();
  if (rid) { const { error: e2 } = await sb.from('tenant_memberships').update({ role_id: rid.id }).eq('user_id', uid); r.mem = e2 ? e2.message : 'ok'; }
  return r;
});
console.log('escalation =', JSON.stringify(esc));
await page.waitForTimeout(500);
// reload identity
await page.evaluate(() => window.EP.loadIdentity(window.EP.state.user).then(() => window.EP.render()));
await page.waitForTimeout(1000);
const role2 = await page.evaluate(() => ({ role: window.EP.state.role, isSuper: window.EP.state.isSuper }));
console.log('role after escalation =', JSON.stringify(role2));

// 1) Admin -> Institutions CRUD
await page.goto('http://localhost:3000/#/admin/institutions'); await page.waitForTimeout(1500);
const hasForm = await page.locator('#c_name').count();
if (hasForm) {
  await page.fill('#c_name', 'Demo Institute Pvt Ltd'); await page.fill('#c_gstin', '29ABCDE1234F1Z5'); await page.click('#c_add');
  await page.waitForTimeout(1500);
  const instRows = await page.evaluate(() => document.querySelectorAll('table.data-table tbody tr').length);
  console.log('institutions rows =', instRows);
} else { console.log('admin form NOT rendered (role guard)'); }

// 2) OMR template
await page.goto('http://localhost:3000/#/omr/templates/new'); await page.waitForTimeout(1000);
await page.fill('#t_name', 'JEE Main OMR'); await page.fill('#t_q', '10'); await page.click('#t_save');
await page.waitForTimeout(1500);
const tplRows = await page.evaluate(() => document.querySelectorAll('table.data-table tbody tr').length);
console.log('omr templates rows =', tplRows);

// 3) Generate a paper
await page.goto('http://localhost:3000/#/papers/new'); await page.waitForTimeout(1500);
await page.waitForSelector('#p_exam option:nth-child(2)', { state: 'attached' });
await page.selectOption('#p_exam', { index: 1 }); await page.fill('#p_count', '5'); await page.click('#gen_btn');
await page.waitForSelector('#gen_result a', { timeout: 15000 });
const paperId = (await page.getAttribute('#gen_result a', 'href')).split('/').pop();
console.log('paper id =', paperId);

// 4) OMR sheet generate + evaluate
await page.goto('http://localhost:3000/#/omr/sheets/new'); await page.waitForTimeout(1500);
await page.waitForSelector('#s_paper option:nth-child(2)', { state: 'attached' });
const pLabel = (await page.locator('#s_paper option').nth(1).textContent()).trim();
console.log('paper option label =', pLabel);
await page.selectOption('#s_paper', { label: pLabel });
await page.fill('#s_roll', 'ROLL-1'); await page.click('#s_gen');
await page.waitForTimeout(4000);
console.log('URL after gen =', page.url());
const sheetText = await page.evaluate(() => document.body.innerText.slice(0,400));
console.log('sheet page text =', sheetText.replace(/\n/g,' '));
const hasEval = await page.locator('#eval_btn').count();
console.log('has #eval_btn =', hasEval);
if (hasEval) {
  await page.selectOption('#omr_q_1', { index: 1 }).catch(()=>{});
  await page.selectOption('#omr_q_2', { index: 1 }).catch(()=>{});
  await page.click('#eval_btn');
  await page.waitForSelector('#eval_result .score-card', { timeout: 10000 });
  const score = await page.evaluate(() => document.querySelector('#eval_result').innerText.replace(/\n/g,' '));
  console.log('OMR eval =', score);
}

// 5) Storage upload (branding logo)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64');
fs.writeFileSync('C:/temp/px.png', png);
await page.goto('http://localhost:3000/#/settings'); await page.waitForTimeout(1500);
await page.setInputFiles('#b_logo_file', 'C:/temp/px.png');
await page.click('#b_upload');
await page.waitForTimeout(2500);
const preview = await page.evaluate(() => { const i=document.querySelector('#b_logo_preview img'); return i? i.src.slice(0,60):'(none)'; });
console.log('logo preview =', preview);

await b.close();
