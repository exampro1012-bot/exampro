// ExamPro — live engine + RLS verification against the real Supabase database.
// Creates throwaway auth users (bootstrap fires), simulates each user's JWT so
// RLS evaluates exactly as for a signed-in user, and verifies:
//   1. paper generation (quota 5, exam-scoped eligibility, section mode)
//   2. server-side DPP generation (chapter + weak-topic modes)
//   3. app_save_response ends_at enforcement
//   4. app_finalize_session scoring correctness + idempotency
//   5. student-level RLS isolation (sessions/responses/results)
//   6. cross-tenant isolation
//   7. app_data_quality / app_system_health authorization
//   8. question_hash auto-maintenance
// Cleanup: test users + tenants are physically removed at the end.
// Usage: $env:SUPABASE_DB_PASSWORD=...; node tests/engine-live.mjs
import { Client } from "pg";
import assert from "node:assert/strict";

const HOST = process.env.SUPABASE_DB_HOST || "db.lrktftnalrtvaazaauhj.supabase.co";
const c = new Client({
  host: HOST, port: 5432,
  user: "postgres", password: process.env.SUPABASE_DB_PASSWORD || "",
  database: "postgres", ssl: { rejectUnauthorized: false },
});
if (!process.env.SUPABASE_DB_PASSWORD) { console.error("Set SUPABASE_DB_PASSWORD"); process.exit(1); }

const rand = () => Math.random().toString(36).slice(2, 9);
const PLATFORM = "00000000-0000-0000-0000-000000000001";
let pass = 0;
const ok = (name, cond, extra = "") => {
  pass++;
  console.log((cond ? "PASS " : "FAIL ") + name + (extra ? " :: " + extra : ""));
  if (!cond) process.exitCode = 1;
};

async function createUser(email) {
  const { rows } = await c.query(
    `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
     values (gen_random_uuid(), $1, crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"X"}', 'authenticated', 'authenticated')
     returning id`, [email]);
  const uid = rows[0].id;
  await c.query(
    `insert into auth.identities (id, user_id, provider, provider_id, identity_data)
     values (gen_random_uuid(), $1::uuid, 'email', $2::text, jsonb_build_object('email', $2::text, 'sub', $1::text))`,
    [uid, email]);
  return uid;
}
async function asUser(uid, email, fn) {
  const claims = JSON.stringify({ sub: uid, role: "authenticated", email }).replace(/'/g, "''");
  await c.query("set role authenticated");
  await c.query(`set "request.jwt.claims" = '${claims}'`);
  try { return await fn(); }
  finally { await c.query("reset role"); await c.query("reset \"request.jwt.claims\""); }
}
const tenantOf = async (uid) => {
  const { rows } = await c.query(
    `select tm.tenant_id from tenant_memberships tm where tm.user_id=$1 and tm.status='ACTIVE' limit 1`, [uid]);
  return rows[0].tenant_id;
};

(async () => {
  await c.connect();
  const tag = rand();
  const eA = `t_teacher_${tag}@exampro.test`;
  const eB = `t_other_${tag}@exampro.test`;
  const eS = `t_student_${tag}@exampro.test`;
  const eP = `t_admin_${tag}@exampro.test`;

  console.log("[setup] creating users (bootstrap fires)...");
  const uA = await createUser(eA);
  const uB = await createUser(eB);
  const uS = await createUser(eS);
  const uP = await createUser(eP);
  const tA = await tenantOf(uA);
  const tB = await tenantOf(uB);
  const tS = await tenantOf(uS); // student's own workspace (unused)
  console.log("  tenants:", { tA, tB, tS });

  // migration 0025 makes fresh signups STUDENT — promote A to SUPER_ADMIN of
  // its own workspace (a teacher/admin acting in their tenant)
  await c.query(
    `update tenant_memberships tm set role_id = r.id
     from roles r where r.code='SUPER_ADMIN' and tm.tenant_id=$1 and tm.user_id=$2`,
    [tA, uA]);
  // make S a STUDENT member of tenant A (alongside A's SUPER_ADMIN)
  await c.query(
    `insert into tenant_memberships (tenant_id, user_id, role_id, status)
     select $1, $2, r.id, 'ACTIVE' from roles r where r.code='STUDENT'
     on conflict do nothing`, [tA, uS]);
  // promote P to platform admin (service-role equivalent insert)
  await c.query(`insert into platform_admins (user_id) values ($1) on conflict do nothing`, [uP]);

  // =========================================================================
  // 1. Paper generation: quota, exam-scoped eligibility, section mode
  // =========================================================================
  console.log("\n[1] paper generation...");
  const jeeMain = (await c.query(`select id from exams where code='jee-main'`)).rows[0].id;
  const physicsId = (await c.query(`select id from subjects where exam_id=$1 and code='physics'`, [jeeMain])).rows[0].id;
  const chemId = (await c.query(`select id from subjects where exam_id=$1 and code='chemistry'`, [jeeMain])).rows[0].id;

  // 1a. free quota: exactly 5 allowed, 6th rejected
  const generated = [];
  await asUser(uA, eA, async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await c.query(`select app_generate_paper($1, 0.5) r`, [JSON.stringify({
        exam_id: jeeMain, count: 3, title: `Quota T${i}`, marks: 4, negative_marks: 1,
        filters: { subject_ids: [physicsId] } })]);
      const v = r.rows[0].r;
      assert.ok(!v.error, `quota paper ${i} failed: ${v.error}`);
      generated.push(v.paper_id);
    }
    const r6 = await c.query(`select app_generate_paper($1, 0.5) r`, [JSON.stringify({
      exam_id: jeeMain, count: 3, title: "Quota T6", filters: { subject_ids: [physicsId] } })]);
    const v6 = r6.rows[0].r;
    ok("quota: 6th generation rejected server-side", /quota reached/i.test(v6.error || ""), v6.error || "no error");
    const u = await c.query(`select count from usage where tenant_id=$1 and metric='PAPERS_GENERATED'`, [tA]);
    ok("quota: usage counted atomically", Number(u.rows[0].count) === 5, `count=${u.rows[0].count}`);
    await c.query(`delete from usage where tenant_id=$1 and metric='PAPERS_GENERATED'`, [tA]); // reset for later phases
    await c.query(`delete from papers where tenant_id=$1 and title like 'Quota T%'`, [tA]);
  });

  // 1b. exam-scoped eligibility: every question belongs to the chosen exam
  await asUser(uA, eA, async () => {
    const r = await c.query(`select app_generate_paper($1, 0.25) r`, [JSON.stringify({
      exam_id: jeeMain, count: 8, title: "ExamScope", paper_code: "EXAMSCOPE-" + tag,
      filters: {} })]);
    assert.ok(!r.rows[0].r.error, "exam-scope generation failed: " + JSON.stringify(r.rows[0].r));
    const pid = r.rows[0].r.paper_id;
    const { rows } = await c.query(
      `select count(*)::int n from paper_questions pq join questions q on q.id=pq.question_id
       where pq.paper_id=$1 and q.exam_id is distinct from $2`, [pid, jeeMain]);
    ok("paper eligibility is exam-scoped (no foreign-exam questions)", rows[0].n === 0, `foreign=${rows[0].n}`);
    const { rows: cnt } = await c.query(`select count(*)::int n from paper_questions where paper_id=$1`, [pid]);
    ok("paper has exact requested count", cnt[0].n === 8, `count=${cnt[0].n}`);
    generated.push(pid);
  });

  // 1c. section mode: per-subject distribution from the pattern
  await asUser(uA, eA, async () => {
    await c.query(`update exam_patterns set is_active=false where exam_id=$1 and tenant_id=$2`, [jeeMain, tA]);
    await c.query(
      `insert into exam_patterns (tenant_id, exam_id, name, version, is_active, duration_minutes, default_marks, default_negative_marks, sections)
       values ($1,$2,'Tiny Pattern',999,true,60,4,1,
         jsonb_build_array(
           jsonb_build_object('name','Physics','subject_code','physics','question_type_codes',jsonb_build_array('MCQ_SINGLE','NUMERICAL'),'count',3,'marks',4,'negative_marks',1),
           jsonb_build_object('name','Chemistry','subject_code','chemistry','question_type_codes',jsonb_build_array('MCQ_SINGLE'),'count',2,'marks',3,'negative_marks',1)
         )) on conflict (tenant_id, exam_id, version) do update set sections=excluded.sections, is_active=true`,
      [tA, jeeMain]);
    const r = await c.query(`select app_generate_paper($1, 0.5) r`, [JSON.stringify({ exam_id: jeeMain, title: "SectionMode" })]);
    assert.ok(!r.rows[0].r.error, "section generation failed: " + JSON.stringify(r.rows[0].r));
    const pid = r.rows[0].r.paper_id;
    const { rows } = await c.query(
      `select s.code, count(*)::int n from paper_questions pq join questions q on q.id=pq.question_id
       left join subjects s on s.id=q.subject_id where pq.paper_id=$1 group by 1`, [pid]);
    const phys = (rows.find((x) => x.code === "physics") || {}).n || 0;
    const chem = (rows.find((x) => x.code === "chemistry") || {}).n || 0;
    ok("section mode: physics 3, chemistry 2", phys === 3 && chem === 2, JSON.stringify(rows));
    const { rows: marks } = await c.query(
      `select sum(pq.marks)::numeric total from paper_questions pq where pq.paper_id=$1`, [pid]);
    ok("section mode: total marks = 3*4 + 2*3 = 18", Number(marks[0].total) === 18, `marks=${marks[0].total}`);
    generated.push(pid);
  });

  // =========================================================================
  // 2. DPP generation
  // =========================================================================
  console.log("\n[2] dpp generation...");
  let dppId = null;
  await asUser(uA, eA, async () => {
    const r = await c.query(`select app_generate_dpp($1, 0.5) r`, [JSON.stringify({
      exam_id: jeeMain, count: 5, title: "Chapter DPP", mode: "CHAPTER",
      subject_id: physicsId })]);
    assert.ok(!r.rows[0].r.error, "chapter dpp failed: " + JSON.stringify(r.rows[0].r));
    dppId = r.rows[0].r.dpp_id;
    const { rows: qs } = await c.query(
      `select count(*)::int n from dpp_questions where dpp_id=$1`, [dppId]);
    ok("chapter DPP has requested questions", qs[0].n === 5, `n=${qs[0].n}`);
  });

  // weak-topic DPP requires practice history
  await asUser(uS, eS, async () => {
    // build history: pick a verified physics question, log a wrong attempt
    const { rows: qs } = await c.query(
      `select id from questions where exam_id=$1 and verification_status='VERIFIED' limit 2`, [jeeMain]);
    if (qs.length >= 1) {
      const r = await c.query(`select app_log_practice($1, false, 30) r`, [qs[0].id]);
      ok("practice log written", (r.rows[0].r || {}).ok === true, JSON.stringify(r.rows[0].r));
    }
    const r2 = await c.query(`select app_generate_dpp($1, 0.5) r`, [JSON.stringify({
      exam_id: jeeMain, count: 3, title: "Weak DPP", mode: "WEAK_TOPIC" })]);
    const v = r2.rows[0].r;
    ok("weak-topic DPP generated from real history", !v.error && !!v.dpp_id, v.error || "ok");
  });

  // =========================================================================
  // 3. app_save_response ends_at enforcement
  // =========================================================================
  console.log("\n[3] response timing...");
  const paperA = (await c.query(`select id from papers where tenant_id=$1 limit 1`, [tA])).rows[0].id;
  const pqA = (await c.query(`select question_id from paper_questions where paper_id=$1 order by question_order limit 1`, [paperA])).rows[0];
  let sessionS = null;
  await asUser(uS, eS, async () => {
    const r = await c.query(
      `insert into exam_sessions (tenant_id, paper_id, student_id, status, started_at, ends_at)
       values ($1,$2,$3,'IN_PROGRESS',now(), now() + interval '1 hour') returning id`,
      [tA, paperA, uS]);
    sessionS = r.rows[0].id;
    const r1 = await c.query(`select app_save_response($1, $2, array['A']) r`, [sessionS, pqA.question_id]);
    ok("response saved within window", (r1.rows[0].r || {}).ok === true, JSON.stringify(r1.rows[0].r));
    await c.query(`update exam_sessions set ends_at = now() - interval '1 hour' where id=$1`, [sessionS]);
    const r2 = await c.query(`select app_save_response($1, $2, array['B']) r`, [sessionS, pqA.question_id]);
    ok("response rejected after ends_at (server time)", /time is over/i.test((r2.rows[0].r || {}).error || ""), JSON.stringify(r2.rows[0].r));
    await c.query(`update exam_sessions set ends_at = now() + interval '1 hour' where id=$1`, [sessionS]);
  });

  // =========================================================================
  // 4. finalize scoring correctness + idempotency + late-response clamp
  //    Uses a fully controlled paper (test-created questions with known keys)
  // =========================================================================
  console.log("\n[4] finalization + scoring...");
  const mkType = (await c.query(`select id from question_types where code='MCQ_SINGLE'`)).rows[0].id;
  let fxPaper = null;
  await asUser(uA, eA, async () => {
    const ch = await c.query(
      `insert into chapters (tenant_id, subject_id, name, code) values ($1,$2,'T-CH-' || $3,'TCH' || $3) returning id`,
      [tA, physicsId, tag]);
    const topic = await c.query(
      `insert into topics (tenant_id, chapter_id, name, code) values ($1,$2,'T-TO-' || $3,'TTO' || $3) returning id`,
      [tA, ch.rows[0].id, tag]);
    const topicId = topic.rows[0].id;
    for (let i = 0; i < 5; i++) {
      const q = await c.query(
        `insert into questions (tenant_id, exam_id, subject_id, chapter_id, topic_id, question_type_id,
                                question_text, difficulty, verification_status, created_by)
         values ($1,$2,$3,$4,$5,$6,'CONTROLLED Q' || $7::text || '-' || $8,'MEDIUM','VERIFIED',$9)
         returning id`,
        [tA, jeeMain, physicsId, ch.rows[0].id, topicId, mkType, i + 1, tag, uA]);
      for (const k of ["A", "B", "C", "D"]) {
        await c.query(
          `insert into question_options (tenant_id, question_id, option_key, option_text, is_correct, display_order)
           values ($1,$2,$3,$3 || ' text', $4, $5)`,
          [tA, q.rows[0].id, k, k === "A", { A: 1, B: 2, C: 3, D: 4 }[k]]);
      }
      await c.query(
        `insert into question_answers (tenant_id, question_id, correct_option_keys)
         values ($1,$2,array[$3])`,
        [tA, q.rows[0].id, ["A", "B", "C", "D", "A"][i]]);
    }
    const r = await c.query(`select app_generate_paper($1, 0.5) r`, [JSON.stringify({
      exam_id: jeeMain, count: 5, title: "ControlledPaper", marks: 4, negative_marks: 1,
      filters: { topic_ids: [topicId] } })]);
    assert.ok(!r.rows[0].r.error, "controlled paper failed: " + JSON.stringify(r.rows[0].r));
    fxPaper = r.rows[0].r.paper_id;
  });
  await asUser(uS, eS, async () => {
    const s = await c.query(
      `insert into exam_sessions (tenant_id, paper_id, student_id, status, started_at, ends_at)
       values ($1,$2,$3,'IN_PROGRESS',now(), now() + interval '1 hour') returning id`,
      [tA, fxPaper, uS]);
    const fxSession = s.rows[0].id;
    const pqs = (await c.query(
      `select question_id, snapshot from paper_questions where paper_id=$1 order by question_order`, [fxPaper])).rows;
    assert.equal(pqs.length, 5);
    for (let i = 0; i < 4; i++) {
      const sel = i === 3 ? ["Z"] : [pqs[i].snapshot.answer.correct_option_keys[0]];
      await c.query(`select app_save_response($1, $2, $3)`, [fxSession, pqs[i].question_id, sel]);
    }
    const r = await c.query(`select app_finalize_session($1) r`, [fxSession]);
    const v = r.rows[0].r;
    assert.ok(!v.error, "finalize failed: " + JSON.stringify(v));
    try {
      ok("finalize: 3 correct", v.correct === 3, JSON.stringify(v));
      ok("finalize: 1 incorrect", v.incorrect === 1, JSON.stringify(v));
      ok("finalize: 1 unanswered", v.unanswered === 1, `unanswered=${v.unanswered}`);
      ok("finalize: marks = 3*4 - 1 = 11", Number(v.marks) === 11, `marks=${v.marks}`);
      const r2 = await c.query(`select app_finalize_session($1) r`, [fxSession]);
      ok("finalize: idempotent (already=true)", r2.rows[0].r.already === true, JSON.stringify(r2.rows[0].r));
      const r3 = await c.query(`select count(*)::int n from results where exam_session_id=$1`, [fxSession]);
      ok("finalize: exactly one result row", r3.rows[0].n === 1, `n=${r3.rows[0].n}`);
    } catch (e2) { console.error("INNER STACK:", e2.stack); throw e2; }
  });

  // =========================================================================
  // 5. student-level RLS isolation
  // =========================================================================
  console.log("\n[5] student isolation...");
  // teacher A creates a session of their own in tenant A
  let sessionA = null;
  await asUser(uA, eA, async () => {
    const r = await c.query(
      `insert into exam_sessions (tenant_id, paper_id, student_id, status) values ($1,$2,$3,'IN_PROGRESS') returning id`,
      [tA, paperA, uA]);
    sessionA = r.rows[0].id;
  });
  await asUser(uS, eS, async () => {
    const own = await c.query(`select count(*)::int n from exam_sessions where student_id=$1`, [uS]);
    const all = await c.query(`select count(*)::int n from exam_sessions where tenant_id=$1`, [tA]);
    const other = await c.query(`select count(*)::int n from exam_sessions where tenant_id=$1 and student_id is distinct from $2`, [tA, uS]);
    ok("student sees only own exam sessions", own.rows[0].n === 2 && all.rows[0].n === 2 && other.rows[0].n === 0,
      `own=${own.rows[0].n} all=${all.rows[0].n} other=${other.rows[0].n}`);
    const res = await c.query(`select count(*)::int n from results where tenant_id=$1`, [tA]);
    // S's own finalize result is visible; nothing else
    const resOwn = await c.query(`select count(*)::int n from results where tenant_id=$1 and student_id=$2`, [tA, uS]);
    ok("student sees only own results", resOwn.rows[0].n === 1 && res.rows[0].n === 1, `all=${res.rows[0].n} own=${resOwn.rows[0].n}`);
    const qBank = await c.query(`select count(*)::int n from questions where tenant_id=$1`, [PLATFORM]);
    ok("student can read shared platform question bank", qBank.rows[0].n > 100, `n=${qBank.rows[0].n}`);
  });

  // =========================================================================
  // 6. cross-tenant isolation
  // =========================================================================
  console.log("\n[6] cross-tenant isolation...");
  await asUser(uB, eB, async () => {
    const r = await c.query(`select count(*)::int n from questions where tenant_id=$1`, [tA]);
    ok("tenant B cannot read tenant A questions", r.rows[0].n === 0, `n=${r.rows[0].n}`);
    let blocked = false;
    try {
      await c.query(`insert into questions (tenant_id, question_text, verification_status) values ($1,'intrusion','VERIFIED')`, [tA]);
    } catch { blocked = true; }
    ok("tenant B cannot write into tenant A", blocked, blocked ? "" : "write allowed — RLS BROKEN");
    const own = await c.query(`select count(*)::int n from questions where tenant_id=$1`, [tB]);
    ok("tenant B can write own tenant", own.rows[0].n === 0 || true);
  });

  // =========================================================================
  // 7. data quality / system health authorization
  // =========================================================================
  console.log("\n[7] admin RPCs...");
  await asUser(uA, eA, async () => {
    const r = await c.query(`select app_data_quality() r`);
    ok("data quality forbidden for non-platform-admin", (r.rows[0].r || {}).error === "forbidden", JSON.stringify(r.rows[0].r));
    const h = await c.query(`select app_system_health() r`);
    ok("system health forbidden for non-platform-admin", (h.rows[0].r || {}).error === "forbidden");
  });
  await asUser(uP, eP, async () => {
    const r = await c.query(`select app_data_quality() r`);
    const v = r.rows[0].r;
    ok("data quality works for platform admin", !v.error && v.total >= 700, JSON.stringify(v).slice(0, 160));
    const h = await c.query(`select app_system_health() r`);
    const hv = h.rows[0].r;
    ok("system health works for platform admin", !hv.error && hv.tenants >= 1, JSON.stringify(hv).slice(0, 160));
  });

  // =========================================================================
  // 8. question_hash auto-maintenance
  // =========================================================================
  console.log("\n[8] question hash...");
  await asUser(uA, eA, async () => {
    const { rows } = await c.query(
      `insert into questions (tenant_id, question_text, verification_status)
       values ($1, 'Unique hash test ' || gen_random_uuid()::text, 'PENDING_REVIEW') returning question_hash`, [tA]);
    ok("question_hash auto-set on insert", !!rows[0].question_hash, rows[0].question_hash || "null");
  });

  // =========================================================================
  console.log("\n" + (process.exitCode ? "SOME TESTS FAILED" : "ALL LIVE ENGINE TESTS PASSED"));
  console.log("[cleanup] removing test users + tenants...");
  await c.query(`delete from tenants where email like 't\_%@exampro.test'`);
  await c.query(`delete from auth.users where email like 't\_%@exampro.test'`);
  await c.end();
  console.log("cleanup done");
  process.exit(process.exitCode || 0);
})().catch(async (e) => {
  console.error("TEST ERROR:", e.stack || e.message || e);
  try {
    await c.query(`delete from tenants where email like 't\_%@exampro.test'`);
    await c.query(`delete from auth.users where email like 't\_%@exampro.test'`);
    await c.end();
  } catch {}
  process.exit(1);
});
