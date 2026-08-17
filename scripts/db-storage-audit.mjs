// Live DB + Storage audit via the public API (RLS-scoped to the admin session).
// No service key used: every check runs with the same privileges the app has.
// Table/column truth comes from supabase/migrations/*.sql (repo truth); each
// table is verified to exist on live, FK orphans checked, duplicates flagged,
// storage buckets/objects enumerated.
// Output: db-storage-audit-results.json + concise console summary.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASSWORD = process.env.SUPABASE_TEST_PASSWORD;
if (!URL || !ANON || !EMAIL || !PASSWORD) { console.error('set SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_TEST_EMAIL/SUPABASE_TEST_PASSWORD'); process.exit(2); }

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) { console.error('login failed:', authErr.message); process.exit(2); }

const report = { generated_at: new Date().toISOString(), tables: {}, storage: {}, problems: [] };

// ---------- 1. repo table list + FK columns from migrations ----------
const migDir = 'supabase/migrations';
const sql = readdirSync(migDir).sort().map(f => readFileSync(join(migDir, f), 'utf8')).join('\n');
const tableNames = [...new Set([...sql.matchAll(/create table(?: if not exists)?\s+(\w+)/g)].map(m => m[1]))].sort();

const fkMap = {};
for (const m of sql.matchAll(/create table(?: if not exists)?\s+(\w+)\s*\(([\s\S]*?)\);/g)) {
  const t = m[1];
  fkMap[t] = {};
  for (const line of m[2].split('\n')) {
    const fm = line.match(/^\s*(\w+)\s+[\w\[\](), .]+\breferences\s+(\w+)/i);
    if (fm) fkMap[t][fm[1]] = fm[2];
  }
}

async function rows(table, cols) {
  const { data, error } = await sb.from(table).select(cols);
  return error ? { error } : { data };
}

// ---------- 2. per-table: exists + count + FK orphans ----------
for (const t of tableNames) {
  const { count, error: cntErr } = await sb.from(t).select('*', { count: 'exact', head: true });
  if (cntErr) { report.tables[t] = { error: cntErr.message.slice(0, 200) }; report.problems.push(`table ${t} unreadable: ${cntErr.message.slice(0, 150)}`); continue; }
  const stats = { rows: count };
  for (const [col, parent] of Object.entries(fkMap[t] || {})) {
    const child = await rows(t, 'id,' + col);
    if (child.error) { stats[col + '->' + parent] = 'ERR ' + child.error.message.slice(0, 100); continue; }
    const parentRows = await rows(parent, 'id');
    if (parentRows.error) { stats[col + '->' + parent] = 'ERR ' + parentRows.error.message.slice(0, 100); continue; }
    const parentIds = new Set((parentRows.data || []).map(r => r.id));
    const orphans = (child.data || []).filter(r => r[col] != null && !parentIds.has(r[col]));
    stats[col + '->' + parent] = orphans.length === 0 ? 'ok' : `ORPHANS ${orphans.length}`;
    if (orphans.length) report.problems.push(`${t}.${col}: ${orphans.length} orphan(s) -> ${parent}`);
  }
  report.tables[t] = { rows: count, ...stats };
}

// ---------- 3. duplicate-content checks (tenant/exam scoped where applicable) ----------
const dupChecks = [
  { name: 'questions duplicate text', table: 'questions', cols: 'question_text', key: r => String(r.question_text || '').toLowerCase().trim() },
  { name: 'papers duplicate title', table: 'papers', cols: 'title', key: r => String(r.title || '').toLowerCase().trim() },
  { name: 'students duplicate email', table: 'students', cols: 'email', key: r => String(r.email || '').toLowerCase().trim() },
  { name: 'teachers duplicate email', table: 'teachers', cols: 'email', key: r => String(r.email || '').toLowerCase().trim() },
  { name: 'exams duplicate (tenant,name)', table: 'exams', cols: 'tenant_id,name', key: r => JSON.stringify([r.tenant_id, String(r.name || '').toLowerCase().trim()]) },
  { name: 'subjects duplicate (tenant,exam,name)', table: 'subjects', cols: 'tenant_id,exam_id,name', key: r => JSON.stringify([r.tenant_id, r.exam_id, String(r.name || '').toLowerCase().trim()]) },
  { name: 'chapters duplicate (subject_id,code)', table: 'chapters', cols: 'subject_id,code', key: r => JSON.stringify([r.subject_id, String(r.code || '').toLowerCase().trim()]) },
  { name: 'bookmarks duplicate (user,question)', table: 'bookmarks', cols: 'user_id,question_id', key: r => JSON.stringify([r.user_id, r.question_id]) },
];
for (const dc of dupChecks) {
  const res = await rows(dc.table, dc.cols);
  if (res.error) continue;
  const seen = new Map(); const dups = [];
  for (const r of res.data) {
    const k = dc.key(r);
    if (!k || k === 'null') continue;
    if (seen.has(k)) dups.push(k); else seen.set(k, 1);
  }
  if (report.tables[dc.table]) {
    report.tables[dc.table][dc.name] = dups.length ? `DUPLICATES ${dups.length} (e.g. ${dups.slice(0, 2).join(', ')})` : 'none';
    if (dups.length) report.problems.push(`${dc.name}: ${dups.length} duplicate(s)`);
  }
}

// ---------- 4. storage buckets: probe each bucket defined in migrations ----------
// NOTE: GET /storage/v1/bucket is RLS-restricted on this project (empty list),
// so we probe each known bucket via object listing instead — same privilege
// path the app uses.
const bucketNames = [...new Set([...sql.matchAll(/'([a-z0-9-]+)','([a-z0-9-]+)',\s*(true|false)/g)].map(m => m[1]))].sort();
report.storage.buckets = [];
for (const b of bucketNames) {
  const { data, error } = await sb.storage.from(b).list('', { limit: 5 });
  report.storage.buckets.push({ name: b, accessible: !error, objects_sample: error ? error.message.slice(0, 80) : data.length });
  if (error) report.problems.push(`storage bucket ${b} inaccessible: ${error.message.slice(0, 120)}`);
}

async function countObjects(bucket) {
  let total = 0, offset = 0;
  for (;;) {
    const { data, error } = await sb.storage.from(bucket).list('', { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    total += data.length;
    if (data.length < 1000) break;
    offset += data.length;
  }
  return total;
}

// ---------- 5. orphaned storage objects (no matching drive_files row) ----------
const { data: driveFiles, error: dfErr } = await sb.from('drive_files').select('file_path, bucket');
if (!dfErr && driveFiles) {
  const byBucket = new Map();
  for (const f of driveFiles) {
    if (!byBucket.has(f.bucket)) byBucket.set(f.bucket, new Set());
    byBucket.get(f.bucket).add(f.file_path);
  }
  const orphaned = [];
  for (const [bucket, paths] of byBucket) {
    const { data: objs } = await sb.storage.from(bucket).list('', { limit: 1000 });
    for (const o of objs || []) if (!paths.has(o.name)) orphaned.push(`${bucket}/${o.name}`);
  }
  report.storage.orphan_objects = orphaned;
  if (orphaned.length) report.problems.push(`storage: ${orphaned.length} object(s) with no drive_files row`);
}

writeFileSync('db-storage-audit-results.json', JSON.stringify(report, null, 2));
console.log('tables checked:', tableNames.length, '| problems:', report.problems.length);
for (const p of report.problems) console.log('  !', p);
console.log('storage:', JSON.stringify(report.storage.buckets || report.storage.error || []));
console.log('results -> db-storage-audit-results.json');