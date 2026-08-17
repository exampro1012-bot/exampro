// =============================================================================
// ExamPro — zero-skip E2E bootstrap (spec §20–§22).
//
// Verifies every external prerequisite the live E2E suites depend on and
// auto-seeds the deterministic QA fixtures those suites require, so a run
// can never "skip" for environmental reasons. Any missing prerequisite
// FAILS HARD (exit 1) with an actionable message — the suite contains no
// skip paths anymore (see scripts/enforce-zero-skip.mjs).
//
// Verified:
//   1. environment (SUPABASE_URL / ANON / TEST_EMAIL / TEST_PASSWORD)
//   2. backend reachability + test-account login (SUPER_ADMIN staff account)
//   3. required RPC deployments: app_verify_question, app_generate_paper,
//      app_question_bank_health, app_parent_dashboard, app_get_storage_policy
//   4. Google Drive connection (drive-health connected:true), provisioned
//      server-side for the QA tenant when E2E_GOOGLE_REFRESH_TOKEN is provided
//   5. reference data: exams, subjects, question_types.MCQ_SINGLE
//   6. QA fixtures (deterministic, idempotent, auto-seeded when absent):
//        chapters/topics   -> "QA Bootstrap Chapter"/"QA Bootstrap Topic"
//        verified questions-> "QA Bootstrap verified question" (source
//                             QA_BOOTSTRAP, verified via app_verify_question,
//                             with 4 options + answer row)
//   7. storage policy reset to the production default (GOOGLE_DRIVE_REQUIRED)
//
// Usage:        node scripts/e2e-bootstrap.mjs
// Environment:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TEST_EMAIL,
//               SUPABASE_TEST_PASSWORD            (required)
//               E2E_GOOGLE_REFRESH_TOKEN          (optional — provisions the
//                                                 Drive connection for the QA
//                                                 tenant if not connected)
//               E2E_GOOGLE_DRIVE_ACCOUNT          (optional; default
//                                                 exampro1012@gmail.com)
// =============================================================================

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASS = process.env.SUPABASE_TEST_PASSWORD;
const REFRESH = process.env.E2E_GOOGLE_REFRESH_TOKEN || '';
const DRIVE_ACCOUNT = process.env.E2E_GOOGLE_DRIVE_ACCOUNT || 'exampro1012@gmail.com';

const pass = (msg) => console.log('  PASS  ' + msg);
const info = (msg) => console.log('  INFO  ' + msg);
const fail = (msg) => { console.error('  FAIL  ' + msg); process.exitCode = 1; };

let sb;      // anon client signed in as the test account
let user;    // test account auth.user
let tenantId; // default tenant of the test account

// ---------------------------------------------------------------------------
// 1. environment
// ---------------------------------------------------------------------------
console.log('\n[1/7] environment');
if (!URL || !ANON || !EMAIL || !PASS) {
  console.error('Missing required environment variables:');
  console.error('  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD');
  console.error('(see .env.example — load them into the shell before running)');
  process.exit(1);
}
pass('SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_TEST_EMAIL / SUPABASE_TEST_PASSWORD set');

// ---------------------------------------------------------------------------
// 2. backend + test account
// ---------------------------------------------------------------------------
console.log('\n[2/7] backend + test account');
sb = createClient(URL, ANON, { auth: { persistSession: false } });
{
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (error) {
    fail('sign-in failed: ' + error.message +
      ' — SUPABASE_TEST_EMAIL/PASSWORD must be an existing staff/admin account' +
      ' (fresh signups are STUDENT and have no Question Bank access).' +
      ' Re-run scripts/seed-test-users.mjs or reset the password, then retry.');
    process.exit(1);
  }
  user = data.user;
  pass('sign-in OK (' + user.email + ', id ' + user.id + ')');
}
{
  const { data: prof, error } = await sb.from('profiles')
    .select('full_name, default_tenant_id').eq('auth_user_id', user.id).maybeSingle();
  if (error || !prof) {
    fail('profile row missing for the test account (' + (error?.message || 'no row') +
      ') — the handle_new_user trigger should have created it; delete the auth user and re-create it.');
    process.exit(1);
  }
  tenantId = prof.default_tenant_id;
  pass('profile OK (tenant ' + tenantId + ')');
}
{
  const { data: mem, error } = await sb.from('tenant_memberships')
    .select('status, roles(code)').eq('user_id', user.id).maybeSingle();
  if (error || !mem) {
    fail('tenant_memberships row missing for the test account — staff tests need an ACTIVE membership.');
    process.exit(1);
  }
  info('membership ' + mem.status + ' role=' + (mem.roles?.code || 'unknown'));
}

// ---------------------------------------------------------------------------
// 3. RPC deployments
// ---------------------------------------------------------------------------
console.log('\n[3/7] RPC deployments');
// An RPC is "deployed" if invoking it does NOT return the missing-function
// error (PGRST202). PostgREST matches overloads by argument count, so each
// probe passes the declared parameter shape with nulls — validation then
// short-circuits without mutating data (e.g. app_generate_paper returns
// {"error":"exam_id required"} before any insert).
async function rpcDeployed(name, args) {
  const { error } = await sb.rpc(name, args);
  if (!error) return true;
  return !/could not find the function|does not exist|PGRST202/i.test(error.message || '');
}
for (const [name, args] of [
  ['app_verify_question', { p_question_id: null, p_decision: null }],
  ['app_generate_paper', { p_spec: null }],
  ['app_question_bank_health', {}],
  ['app_parent_dashboard', {}],
  ['app_get_storage_policy', {}],
  ['app_set_storage_policy', { p_policy: 'GOOGLE_DRIVE_REQUIRED' }],
]) {
  const ok = await rpcDeployed(name, args);
  if (ok) { pass(name + ' deployed'); }
  else { fail(name + ' NOT deployed — run `supabase db push` (migrations) before E2E.'); }
}

// ---------------------------------------------------------------------------
// 4. Google Drive connection
// ---------------------------------------------------------------------------
console.log('\n[4/7] Google Drive connection');
async function driveHealth() {
  const { data, error } = await sb.functions.invoke('drive-health');
  return error ? null : data;
}
let health = await driveHealth();
if (!health) {
  fail('drive-health did not respond — is the edge function deployed? Run `supabase functions deploy drive-health` (see scripts/deploy-edge-functions.ps1).');
} else if (health.connected !== true) {
  if (REFRESH) {
    info('Drive not connected — provisioning E2E_GOOGLE_REFRESH_TOKEN for tenant ' + tenantId);
    const { error: upErr } = await sb.from('google_drive_oauth_tokens').upsert(
      { tenant_id: tenantId, provider: 'GOOGLE_DRIVE', account: DRIVE_ACCOUNT, refresh_token: REFRESH },
      { onConflict: 'tenant_id,provider' },
    );
    if (upErr) {
      fail('could not provision the Drive refresh token: ' + upErr.message);
    } else {
      health = await driveHealth();
      if (health?.connected === true) pass('Drive connected after provisioning (' + DRIVE_ACCOUNT + ')');
      else fail('Drive still not connected after provisioning — check E2E_GOOGLE_REFRESH_TOKEN validity.');
    }
  } else {
    fail('Google Drive is NOT connected (drive-health connected:false). Connect it once in ' +
      'Settings → Storage → Connect Google Drive (' + DRIVE_ACCOUNT + '), or set ' +
      'E2E_GOOGLE_REFRESH_TOKEN and re-run this bootstrap.');
  }
} else {
  pass('Drive connected: account=' + (health.account || 'unknown') +
    ', folder=' + (health.folders ? Object.keys(health.folders).length + ' folders' : ''));
}

// ---------------------------------------------------------------------------
// 5. reference data
// ---------------------------------------------------------------------------
console.log('\n[5/7] reference data (exams / subjects / question_types)');
const count = async (table, filter) => {
  const { count: n, error } = await sb.from(table).select('id', { count: 'exact', head: true }).match(filter || {});
  if (error) throw new Error(table + ': ' + error.message);
  return n;
};
try {
  const exams = await count('exams');
  if (exams > 0) pass('exams present (' + exams + ')');
  else fail('no exams in the corpus — run `npm run import:questions` (supabase/import-dataset.mjs) to seed reference data.');

  const subjects = await count('subjects');
  if (subjects > 0) pass('subjects present (' + subjects + ')');
  else fail('no subjects — the corpus import must seed at least one subject per exam.');

  const qtypes = await count('question_types', { code: 'MCQ_SINGLE' });
  if (qtypes > 0) pass('question_types.MCQ_SINGLE present');
  else fail('question_types.MCQ_SINGLE missing — seed it (import-dataset or SQL) or paper generation cannot run.');
} catch (e) {
  fail(e.message);
}

// ---------------------------------------------------------------------------
// 6. QA fixtures (idempotent auto-seed)
// ---------------------------------------------------------------------------
console.log('\n[6/7] QA fixtures (auto-seed when absent)');
const QA_CH = 'QA Bootstrap Chapter';
const QA_TOPIC = 'QA Bootstrap Topic';

{
  const { count: chCount } = await sb.from('chapters').select('id', { count: 'exact', head: true });
  if (chCount > 0) {
    pass('chapters present (' + chCount + ') — practice drill coverage OK');
    const { count: topCount } = await sb.from('topics').select('id', { count: 'exact', head: true });
    if (topCount > 0) pass('topics present (' + topCount + ') — weak-topics coverage OK');
    else fail('topics empty while chapters exist — seed at least one topic per chapter (weak-topics test needs one).');
  } else {
    info('no chapters — seeding ' + QA_CH + ' + ' + QA_TOPIC);
    const { data: exam } = await sb.from('exams').select('id').order('name').limit(1).maybeSingle();
    const { data: subj } = await sb.from('subjects').select('id').eq('exam_id', exam?.id).limit(1).maybeSingle();
    if (!exam || !subj) {
      fail('cannot seed the QA chapter: no exam/subject rows to attach it to.');
    } else {
      const { data: ch, error: chErr } = await sb.from('chapters').insert({
        tenant_id: tenantId, subject_id: subj.id, name: QA_CH, code: 'QA-BOOT', display_order: 1,
      }).select('id').single();
      if (chErr) {
        fail('seed chapter failed: ' + chErr.message);
      } else {
        const { error: tErr } = await sb.from('topics').insert({
          tenant_id: tenantId, chapter_id: ch.id, name: QA_TOPIC, code: 'QA-BOOT-01', display_order: 1,
        });
        if (tErr) fail('seed topic failed: ' + tErr.message);
        else pass(QA_CH + ' + ' + QA_TOPIC + ' seeded (chapter ' + ch.id + ')');
      }
    }
  }
}

{
  const { count: vCount } = await sb.from('questions')
    .select('id', { count: 'exact', head: true }).eq('verification_status', 'VERIFIED');
  if (vCount > 0) {
    pass('VERIFIED questions present (' + vCount + ') — Drive paper/DPP canaries OK');
  } else {
    info('no VERIFIED questions — seeding a verified QA fixture question');
    const { data: exam } = await sb.from('exams').select('id').eq('name', 'JEE Main').maybeSingle();
    const examId = exam?.id || (await sb.from('exams').select('id').order('name').limit(1).maybeSingle())?.id;
    const { data: subj } = await sb.from('subjects').select('id').eq('exam_id', examId).limit(1).maybeSingle();
    const { data: qtype } = await sb.from('question_types').select('id').eq('code', 'MCQ_SINGLE').maybeSingle();
    const { data: q, error: qErr } = await sb.from('questions').insert({
      tenant_id: tenantId, exam_id: examId || null, subject_id: subj?.id || null,
      question_type_id: qtype?.id || null,
      question_text: 'QA Bootstrap verified question — which option is correct?',
      difficulty: 'EASY', year: 2026, verification_status: 'PENDING_REVIEW', source: 'QA_BOOTSTRAP',
    }).select('id').single();
    if (qErr) {
      fail('seed verified question failed: ' + qErr.message);
    } else {
      const { error: vErr } = await sb.rpc('app_verify_question', {
        p_question_id: q.id, p_decision: 'VERIFIED', p_note: 'bootstrap fixture',
      });
      const optErrs = [];
      for (let i = 0; i < 4; i++) {
        const key = 'ABCD'[i];
        const { error: oErr } = await sb.from('question_options').insert({
          question_id: q.id, option_key: key, option_text: 'Option ' + key, display_order: i + 1, is_correct: key === 'A',
        });
        if (oErr) optErrs.push(oErr.message);
      }
      const { error: aErr } = await sb.from('question_answers').insert({
        question_id: q.id, correct_option_keys: ['A'], answer_type: 'MCQ', source: 'QA_BOOTSTRAP', verification_status: 'VERIFIED', confidence: 99,
      });
      if (vErr || optErrs.length || aErr) fail('seed verified question incomplete: ' +
        JSON.stringify({ vErr: vErr?.message, optErrs, aErr: aErr?.message }));
      else pass('verified QA fixture question seeded + verified (id ' + q.id + ')');
    }
  }
}

// ---------------------------------------------------------------------------
// 7. storage policy reset to production default
// ---------------------------------------------------------------------------
console.log('\n[7/7] storage policy');
{
  const { data, error } = await sb.rpc('app_get_storage_policy');
  if (error) {
    fail('app_get_storage_policy failed: ' + error.message);
  } else if (data !== 'GOOGLE_DRIVE_REQUIRED') {
    info('policy is ' + data + ' — resetting to the production default (GOOGLE_DRIVE_REQUIRED)');
    const { data: set, error: sErr } = await sb.rpc('app_set_storage_policy', { p_policy: 'GOOGLE_DRIVE_REQUIRED' });
    if (sErr) fail('reset policy failed: ' + sErr.message);
    else pass('policy reset to GOOGLE_DRIVE_REQUIRED');
  } else {
    pass('policy is the production default (GOOGLE_DRIVE_REQUIRED)');
  }
}

// ---------------------------------------------------------------------------
console.log('\n' + (process.exitCode ? 'BOOTSTRAP FAILED — fix the FAILs above, then re-run.' : 'BOOTSTRAP OK — the zero-skip suite can run (npx playwright test).'));
process.exit(process.exitCode || 0);
