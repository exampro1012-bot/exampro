import { chromium, devices } from '@playwright/test';
import fs from 'fs';
const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY || '';
const PWD = (fs.readFileSync('.test-creds.env', 'utf8').match(/^SUPABASE_TEST_PASSWORD=(.*)$/m) || [])[1] || '';
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 12'] });
const page = await ctx.newPage();
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url().slice(0, 110)); });
page.on('pageerror', e => console.log('PAGEERR', e.message));

await page.goto('http://localhost:3000/');
await page.fill('#cfg_url', URL); await page.fill('#cfg_key', ANON); await page.click('#cfg_save');
await page.click('[data-tab="signup"]');
const email = 'dbgm' + Date.now() + '@gmail.com';
await page.fill('#au_name', 'QA'); await page.fill('#au_email2', email); await page.fill('#au_pw2', PWD); await page.click('#au_signup_btn');
await page.waitForTimeout(3000);
console.log('role =', await page.evaluate(() => window.EP.state.role));

await page.goto('http://localhost:3000/#/admin/institutions'); await page.waitForTimeout(2000);
console.log('#c_name visible?', await page.locator('#c_name').count());
await page.fill('#c_name', 'QA Inst Mobile'); await page.fill('#c_gstin', '29ABCDE1234F1Z5');
const before = await page.evaluate(() => document.querySelectorAll('table.data-table tbody tr').length);
await page.click('#c_add');
await page.waitForTimeout(2500);
const after = await page.evaluate(() => document.querySelector('#ep_main').innerText.slice(0, 200));
console.log('before rows =', before, '| after text =', after.replace(/\n/g, ' '));
// direct insert diagnostic
const ins = await page.evaluate(async () => {
  const sb = window.EP.getClient(); const uid = window.EP.state.user.id;
  const { data, error } = await sb.from('institutions').insert({ tenant_id: window.EP.state.tenantId, name: 'Direct Inst', status: 'ACTIVE' }).select();
  return error ? error.message : ('ok ' + (data && data.length));
});
console.log('direct insert =', ins);
// replicate exact crudPage payload
const ins2 = await page.evaluate(async () => {
  const sb = window.EP.getClient();
  const payload = { tenant_id: window.EP.state.tenantId, name: 'Full Inst', address: '', gstin: '', phone: '', email: '', status: 'ACTIVE' };
  const { data, error } = await sb.from('institutions').insert(payload).select();
  return error ? error.message : ('ok ' + (data && data.length));
});
console.log('full-payload insert =', ins2);
await b.close();
