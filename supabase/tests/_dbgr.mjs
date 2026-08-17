import { chromium } from '@playwright/test';
import fs from 'fs';
const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY || '';
const PWD = (fs.readFileSync('.test-creds.env', 'utf8').match(/^SUPABASE_TEST_PASSWORD=(.*)$/m) || [])[1] || '';
const b = await chromium.launch();
const page = await b.newPage();
page.on('pageerror', e => console.log('PAGEERR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

await page.goto('http://localhost:3000/');
await page.fill('#cfg_url', URL); await page.fill('#cfg_key', ANON); await page.click('#cfg_save');
await page.click('[data-tab="signup"]');
const email = 'dbgr' + Date.now() + '@gmail.com';
await page.fill('#au_name', 'QA'); await page.fill('#au_email2', email); await page.fill('#au_pw2', PWD); await page.click('#au_signup_btn');
await page.waitForTimeout(2500);
console.log('app-shell?', await page.locator('#app.app-shell').count());
// generate paper
await page.goto('http://localhost:3000/#/papers/new');
await page.waitForSelector('#p_exam option:nth-child(2)', { state: 'attached' });
await page.selectOption('#p_exam', { index: 1 }); await page.fill('#p_count', '5'); await page.click('#gen_btn');
await page.waitForSelector('#gen_result a', { timeout: 15000 });
await page.click('#gen_result a');
await page.waitForTimeout(1500);
console.log('after paper click url =', page.url(), '| app-shell?', await page.locator('#app.app-shell').count());
// now goto questions/new (full reload)
await page.goto('http://localhost:3000/#/questions/new');
await page.waitForTimeout(4000);
console.log('f_text count =', await page.locator('#f_text').count());
console.log('f_type count =', await page.locator('#f_type').count());
console.log('ep_main head =', (await page.locator('#ep_main').innerText().catch(() => 'NONE')).slice(0, 160).replace(/\n/g, ' '));
console.log('app-shell?', await page.locator('#app.app-shell').count(), '| auth present?', await page.locator('#auth').count());
await b.close();
