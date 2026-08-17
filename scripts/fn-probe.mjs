// Live edge-function probe (diagnostic).
// Usage: node scripts/fn-probe.mjs
// Config: SUPABASE_URL + SUPABASE_ANON_KEY (env) and
// SUPABASE_TEST_EMAIL/PASSWORD (env or .test-creds.env fallback).
// Exercises: google-drive-oauth (start/status), drive-health, drive-init.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

function loadCreds() {
  if (process.env.SUPABASE_TEST_EMAIL && process.env.SUPABASE_TEST_PASSWORD) {
    return { SUPABASE_TEST_EMAIL: process.env.SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD: process.env.SUPABASE_TEST_PASSWORD };
  }
  return Object.fromEntries(
    fs.readFileSync('.test-creds.env', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
  );
}
const URL = process.env.SUPABASE_URL || 'https://lrktftnalrtvaazaauhj.supabase.co';
const anon = process.env.SUPABASE_ANON_KEY;
if (!anon) { console.error('Set SUPABASE_ANON_KEY (see .env.example)'); process.exit(1); }
const creds = loadCreds();

const sb = createClient(URL, anon, { auth: { persistSession: false } });
const { data, error } = await sb.auth.signInWithPassword({
  email: creds.SUPABASE_TEST_EMAIL,
  password: creds.SUPABASE_TEST_PASSWORD,
});
if (error) { console.error('signin ERR', error.message); process.exit(1); }
const jwt = data.session.access_token;

async function call(fn, init = {}) {
  const r = await fetch(`${URL}/functions/v1/${fn}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  console.log(`[${fn}] ${r.status} ${text.slice(0, 500)}`);
  return r;
}

await call('google-drive-oauth', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
await call('google-drive-oauth', { method: 'POST', body: JSON.stringify({ action: 'status' }) });
await call('drive-health', { method: 'GET' });
await call('drive-init', { method: 'POST', body: JSON.stringify({}) });