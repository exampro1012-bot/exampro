// =============================================================================
// ExamPro — secure test/development role-account seeder (spec §29-§33).
//
// Creates 10 deterministic test identities (superadmin/institution.admin/
// teacher/subject.teacher/reviewer/editor/student/parent/finance/support
// @exampro.local) with strong generated passwords, assigns each the correct
// DATABASE role, and writes the credentials ONCE to .env.local (gitignored).
//
// Usage:        node scripts/seed-test-users.mjs [--rotate]
// Environment:
//   SUPABASE_URL                (required)
//   SUPABASE_ANON_KEY           (required)
//   SUPABASE_SERVICE_ROLE_KEY   (optional — preferred; server-side only)
//   ADMIN_EMAIL / ADMIN_PASSWORD (required when no service key — a platform
//                                admin account; used to call
//                                app_admin_set_user_role from migration 0047)
//
// --rotate: reset the password of EXISTING test accounts (service-role key
// required) and rewrite .env.local with the fresh passwords. Use when the
// original .env.local was lost but the accounts already exist in the DB.
//   - Without --rotate, existing accounts keep their current password and are
//     reported as EXISTED (the old passwords are not recoverable).
//   - Rotation is a destructive admin action: run it only on the test domain
//     (@exampro.local) accounts; production accounts are never touched.
//
// Security:
//   - No plaintext passwords are ever committed: they exist only in the
//     generated .env.local and the one-time terminal output.
//   - The service-role key is used ONLY from this Node script (never shipped
//     to the frontend) and is read from the environment.
//   - Production SUPER_ADMIN remains exampro1012@gmail.com (untouched).
//   - Idempotent: existing accounts keep their password (reported honestly);
//     roles are re-asserted; teacher/student rows are created once.
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const DOMAIN = 'exampro.local';
const ROTATE = process.argv.includes('--rotate');

if (ROTATE && !SERVICE) {
  console.error('--rotate requires SUPABASE_SERVICE_ROLE_KEY (password reset is an admin-only operation).');
  process.exit(1);
}

// role code -> { email local part, display name }
const ACCOUNTS = [
  ['SUPER_ADMIN',       'superadmin',        'QA Super Admin'],
  ['INSTITUTION_ADMIN', 'institution.admin', 'QA Institution Admin'],
  ['TEACHER',           'teacher',           'QA Teacher'],
  ['SUBJECT_TEACHER',   'subject.teacher',   'QA Subject Teacher'],
  ['QUESTION_REVIEWER', 'reviewer',          'QA Question Reviewer'],
  ['CONTENT_EDITOR',    'editor',            'QA Content Editor'],
  ['STUDENT',           'student',           'QA Student'],
  ['PARENT',            'parent',             'QA Parent'],
  ['FINANCE',           'finance',           'QA Finance'],
  ['SUPPORT',           'support',           'QA Support'],
];

if (!URL || !ANON) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (see .env.example).');
  process.exit(1);
}
if (!SERVICE && !(ADMIN_EMAIL && ADMIN_PASSWORD)) {
  console.error('Provide SUPABASE_SERVICE_ROLE_KEY, or ADMIN_EMAIL + ADMIN_PASSWORD ' +
    'of a platform-admin account (requires migration 0047 for app_admin_set_user_role).');
  process.exit(1);
}

// strong password: upper, lower, digits, special — never logged except once
function genPassword(roleCode) {
  const a = randomBytes(3).toString('hex');           // 6 hex chars
  const b = randomBytes(3).toString('hex');
  return `ExamPro-${a}-${roleCode.replace(/_/g, '-')}-${b}#`;
}

const admin = SERVICE
  ? createClient(URL, SERVICE, { auth: { persistSession: false } })
  : null;

// anon client used for signUp when no service key
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

// A second client signed in as the platform admin (non-service path).
let roleAdmin = null;
if (!SERVICE) {
  const { data, error } = await anon.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (error || !data.session) { console.error('Admin sign-in failed:', error?.message); process.exit(1); }
  roleAdmin = createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}
const mgr = SERVICE ? admin : roleAdmin;

const created = {};   // role -> password (only for newly created accounts)
const results = [];

async function findProfileUserId(email) {
  const { data, error } = await mgr.from('profiles').select('auth_user_id').eq('email', email).limit(1);
  if (error || !data?.length) return null;
  return data[0].auth_user_id;
}

async function upsertAuthUser(email, password, fullName) {
  // service path: admin API with pre-confirmed email
  if (SERVICE) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = (data?.users || []).find((u) => (u.email || '').toLowerCase() === email);
    if (existing) {
      if (ROTATE) {
        const { error: ue } = await admin.auth.admin.updateUserById(existing.id, { password });
        if (ue) throw new Error('rotate password: ' + ue.message);
        return { existed: true, rotated: true, userId: existing.id };
      }
      return { existed: true, userId: existing.id };
    }
    const { data: nu, error: ce } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (ce) throw new Error('createUser: ' + ce.message);
    return { existed: false, userId: nu.user.id };
  }
  // anon path: signUp fires handle_new_user (profile + workspace tenant +
  // STUDENT membership); role is upgraded right after.
  const { data, error } = await anon.auth.signUp({
    email, password, options: { data: { full_name: fullName } },
  });
  if (error) {
    if (/already registered|already been registered/i.test(error.message)) {
      const userId = await findProfileUserId(email);
      if (!userId) throw new Error('exists but profile not found for ' + email);
      return { existed: true, userId };
    }
    throw new Error('signUp: ' + error.message);
  }
  if (!data.user) throw new Error('signUp returned no user');
  return { existed: false, userId: data.user.id };
}

async function setRole(email, userId, roleCode) {
  if (SERVICE) {
    const { data: m, error: me } = await admin.from('tenant_memberships')
      .select('id, tenant_id')
      .eq('user_id', userId)
      .order('created_at').limit(1);
    if (me || !m?.length) throw new Error('membership lookup failed: ' + (me?.message || 'none'));
    const { data: r } = await admin.from('roles').select('id').eq('code', roleCode).limit(1);
    if (!r?.length) throw new Error('role not found: ' + roleCode);
    await admin.from('tenant_memberships')
      .update({ role_id: r[0].id, status: 'ACTIVE', joined_at: new Date().toISOString() })
      .eq('id', m[0].id);
    if (roleCode === 'SUPER_ADMIN') {
      await admin.from('platform_admins')
        .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
    }
    return { tenant_id: m[0].tenant_id };
  }
  const { data, error } = await roleAdmin.rpc('app_admin_set_user_role', { p_user_email: email, p_role_code: roleCode });
  if (error) throw new Error('app_admin_set_user_role: ' + error.message +
    ' (is migration 0047 applied?)');
  return data;
}

for (const [roleCode, local, fullName] of ACCOUNTS) {
  const email = `${local}@${DOMAIN}`;
  const password = genPassword(roleCode);
  try {
    const u = await upsertAuthUser(email, password, fullName);
    const role = await setRole(email, u.userId, roleCode);

    // relational rows for scoping (idempotent)
    if (roleCode === 'TEACHER' || roleCode === 'SUBJECT_TEACHER') {
      const { data: existing } = await mgr.from('teachers').select('id').eq('auth_user_id', u.userId).limit(1);
      if (!existing?.length) {
        let subjectIds = [];
        if (roleCode === 'SUBJECT_TEACHER') {
          const { data: subj } = await mgr.from('subjects').select('id').limit(1);
          if (subj?.length) subjectIds = [subj[0].id];
        }
        await mgr.from('teachers').insert({
          tenant_id: role.tenant_id, auth_user_id: u.userId,
          full_name: fullName, email, subject_ids: subjectIds,
        });
      }
    }
    if (roleCode === 'STUDENT') {
      const { data: existing } = await mgr.from('students').select('id').eq('email', email).limit(1);
      if (!existing?.length) {
        await mgr.from('students').insert({
          tenant_id: role.tenant_id, full_name: fullName, email,
          roll_number: 'QA-' + roleCode.slice(0, 3),
        });
      }
    }

    if (!u.existed || u.rotated) created[roleCode] = password;
    results.push([roleCode, email,
      u.existed ? (u.rotated ? 'ROTATED (password reset)' : 'EXISTED (password unchanged)') : 'CREATED',
      'role=' + roleCode]);
  } catch (e) {
    results.push([roleCode, email, 'FAILED', e.message]);
  }
}

// ---- write .env.local (gitignored) + one-time terminal print ----
const envLines = ['# ExamPro test role accounts — generated by scripts/seed-test-users.mjs',
                  '# LOCAL ONLY. Never commit. Rotate by deleting and re-running.'];
for (const [roleCode, local] of ACCOUNTS) {
  const email = `${local}@${DOMAIN}`;
  const key = 'TEST_' + roleCode;
  envLines.push(`${key}_EMAIL=${email}`);
  if (created[roleCode]) envLines.push(`${key}_PASSWORD=${created[roleCode]}`);
}
fs.writeFileSync('.env.local', envLines.join('\n') + '\n');

console.log('\n=== ExamPro test role accounts ===');
for (const [role, email, status, info] of results) {
  console.log(`${status.padEnd(34)} ${role.padEnd(18)} ${email}  (${info})`);
}
const fresh = Object.keys(created);
if (fresh.length) {
  console.log('\nPasswords for accounts with NEW/ROTATED passwords (shown ONCE — also written to .env.local):');
  for (const r of fresh) console.log(`  ${r}: ${created[r]}`);
} else {
  console.log('\nNo new accounts were created (all existed). Passwords were NOT changed.');
}
console.log('\n.env.local updated. Production SUPER_ADMIN exampro1012@gmail.com is untouched.');
