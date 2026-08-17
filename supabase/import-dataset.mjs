// ExamPro — migrate the bundled question dataset (gz shards) into Supabase.
// Run:  SUPABASE_DB_PASSWORD=... node supabase/import-dataset.mjs
// Connects directly to PostgreSQL (server-side tooling — the DB password never
// leaves this process). Idempotent via question_hash. Chunked inserts.
// The bundled set is a labeled SAMPLE QA set (source_type=SAMPLE, never claimed
// as official PYQs) — the UI displays a "Sample" badge and the verified-PYQ
// count stays honest until real licensed content is imported.
import { Client } from "pg";
import { gunzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

const PASS = process.env.SUPABASE_DB_PASSWORD;
if (!PASS) { console.error("Set SUPABASE_DB_PASSWORD (rotated database password)."); process.exit(1); }

const PLATFORM = "00000000-0000-0000-0000-000000000001";
const HOST = process.env.SUPABASE_DB_HOST || "db.lrktftnalrtvaazaauhj.supabase.co";
const c = new Client({
  host: HOST, port: 5432,
  user: "postgres", password: PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});

const TYPE_MAP = (t) => {
  const s = (t || "").toLowerCase();
  if (s.includes("multiple")) return "MCQ_MULTIPLE";
  if (s.includes("numerical")) return "NUMERICAL";
  if (s.includes("integer")) return "INTEGER";
  if (s.includes("assertion")) return "ASSERTION_REASON";
  if (s.includes("match")) return "MATCHING";
  if (s.includes("true")) return "TRUE_FALSE";
  if (s.includes("comprehension")) return "COMPREHENSION";
  if (s.includes("single")) return "MCQ_SINGLE";
  return "MCQ_SINGLE";
};
const DIFF = (d) => ({ easy: "EASY", medium: "MEDIUM", hard: "HARD", veryhard: "HARD" }[(d || "").toLowerCase().replace(/\s/g, "")] || "MEDIUM");

const q = (sql, params) => c.query(sql, params);
let seq = 0;
const named = (name, text, values) => {
  const n = name + "_" + (++seq);
  if (process.env.IMPORT_DEBUG) console.log("stmt", n, "textLen", text.length, "vals", values.length);
  return c.query({ name: n, text, values })
    .catch((e) => { console.error("statement", n, "textLen", text.length, "vals", values.length, "params:", values.length); throw e; });
};

async function resolveExam(code, name) {
  const { rows } = await named("exam",
    `insert into exams (tenant_id, code, name, display_order, is_active)
     values ($1, $2, $3, 0, true)
     on conflict (code) do update set name = excluded.name
     returning id`, [PLATFORM, code, name || code]);
  return rows[0].id;
}
async function resolveSubject(examId, code, name) {
  const { rows } = await named("subj",
    `insert into subjects (tenant_id, exam_id, code, name, display_order)
     values ($1, $2, $3, $4, 0)
     on conflict (exam_id, code) do update set name = excluded.name
     returning id`, [PLATFORM, examId, code, name || code]);
  return rows[0].id;
}
async function resolveChapter(subjId, code, name) {
  const { rows } = await named("chap",
    `insert into chapters (tenant_id, subject_id, code, name, display_order)
     values ($1, $2, $3, $4, 0)
     on conflict (subject_id, code) do update set name = excluded.name
     returning id`, [PLATFORM, subjId, code, name || code]);
  return rows[0].id;
}
async function resolveTopic(chapId, code, name) {
  if (!code || code === "unknown") return null;
  const { rows } = await named("topic",
    `insert into topics (tenant_id, chapter_id, code, name, display_order)
     values ($1, $2, $3, $4, 0)
     on conflict (chapter_id, code) do update set name = excluded.name
     returning id`, [PLATFORM, chapId, code, name || code]);
  return rows[0].id;
}

function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (e.endsWith(".json.gz")) out.push(p);
  }
  return out;
}

async function main() {
  await c.connect();
  const { rows: typeRows } = await q("select id, code from question_types");
  const typeIds = Object.fromEntries(typeRows.map((r) => [r.code, r.id]));
  const { rows: srcRows } = await q("select id, code from question_sources");
  const sourceIds = Object.fromEntries(srcRows.map((r) => [r.code, r.id]));

  const root = join("build", "dataset", "v1", "shards");
  const files = walk(root);
  console.log("shard files:", files.length);
  let total = 0, imported = 0, failed = 0;
  const started = new Date().toISOString();

  for (const f of files) {
    const arr = JSON.parse(gunzipSync(readFileSync(f)).toString());
    const qs = [], opts = [], ans = [], sols = [];
    for (const qd of arr) {
      total++;
      const hash = createHash("md5").update((qd.question_text || "").toLowerCase().replace(/\s+/g, " ")).digest("hex");
      const examId = await resolveExam(qd.exam_id, qd.exam_name);
      const subjId = await resolveSubject(examId, qd.subject_id, qd.subject_name);
      const chapId = await resolveChapter(subjId, qd.chapter_id, qd.chapter_name);
      const topicId = await resolveTopic(chapId, qd.topic_id, qd.topic_name);
      const qt = TYPE_MAP(qd.question_type);
      const id = randomUUID();
      const ca = qd.correct_answer || {};
      const caType = ca.type;
      const caRaw = ca.value;
      const caValue = Array.isArray(caRaw) ? caRaw.join(",") : (caRaw === null || caRaw === undefined ? "" : String(caRaw));
      const optsList = (qd.options || []).map((o, i) => ({ text: String(o), pos: i + 1, key: String.fromCharCode(65 + i) }));
      const correctPos = new Set();
      if (caType === "single_correct") {
        const idx = Number(caValue);
        correctPos.add(Number.isFinite(idx) ? idx + 1 : 0);
      } else if (caType === "text") {
        if (/^\d+(\s+\d+)*$/.test(caValue.trim())) {
          caValue.trim().split(/\s+/).forEach((n) => correctPos.add(Number(n)));
        } else {
          caValue.split(",").forEach((t) => {
            const hit = optsList.find((o) => o.text.trim() === t.trim());
            if (hit) correctPos.add(hit.pos);
          });
        }
      }
      const isNumerical = qt === "NUMERICAL" || qt === "INTEGER";
      const numAnswer = isNumerical ? (caRaw === null || caRaw === undefined ? null : String(caRaw)) : null;
      const qOpts = [];
      optsList.forEach((o) => {
        const isCorrect = !isNumerical && (correctPos.has(o.pos) || correctPos.has(o.key.charCodeAt(0) - 64));
        qOpts.push([id, o.key, o.text, o.pos, isCorrect]);
      });
      opts.push(...qOpts);
      if (isNumerical) ans.push([id, numAnswer, []]);
      else ans.push([id, null, qOpts.filter((o) => o[4]).map((o) => o[1])]);
      const sol = qd.solution || {};
      const shortSol = sol.short_solution || sol.solution || null;
      sols.push([id, (sol.solution_type || qd.source_type || "SAMPLE").toUpperCase(),
        shortSol, sol.detailed_solution || null, sol.formula || null,
        sol.concept || qd.concept || null, sol.hint || qd.hint || null, shortSol]);
      qs.push([id, PLATFORM, examId, subjId, chapId, topicId, typeIds[qt],
        qd.year ? parseInt(qd.year) : null, qd.session || null, qd.shift || null,
        qd.question_text, DIFF(qd.difficulty), qd.marks || 4, qd.negative_marks || 1,
        (qd.verification_status || "VERIFIED").toUpperCase() === "VERIFIED" ? "VERIFIED" : "PENDING_REVIEW",
        sourceIds["sample-qa"], (qd.source_type || "SAMPLE").toUpperCase(),
        qd.source_url || null, started, hash]);
    }
    // dedupe within the shard (same hash appears multiple times in the sample set)
    const seen = new Set();
    const uniqQ = [], uniqOpts = [], uniqAns = [], uniqSols = [];
    for (let i = 0; i < qs.length; i++) {
      if (seen.has(qs[i][19])) continue; // hash is field index 19
      seen.add(qs[i][19]);
      const id = qs[i][0];
      uniqQ.push(qs[i]);
      uniqOpts.push(...opts.filter((o) => o[0] === id));
      uniqAns.push(...ans.filter((a) => a[0] === id));
      uniqSols.push(...sols.filter((s) => s[0] === id));
    }
    const res = await named("qins", `insert into questions
      (id, tenant_id, exam_id, subject_id, chapter_id, topic_id, question_type_id,
       year, session, shift, question_text, difficulty, marks, negative_marks,
       verification_status, source_id, source_type, source_url, import_date, question_hash)
      values ${uniqQ.map((_, i) => `($${i * 20 + 1}::uuid,$${i * 20 + 2}::uuid,$${i * 20 + 3}::uuid,$${i * 20 + 4}::uuid,$${i * 20 + 5}::uuid,$${i * 20 + 6}::uuid,$${i * 20 + 7}::uuid,$${i * 20 + 8}::int,$${i * 20 + 9},$${i * 20 + 10},$${i * 20 + 11},$${i * 20 + 12}::question_difficulty,$${i * 20 + 13}::numeric,$${i * 20 + 14}::numeric,$${i * 20 + 15}::verification_status,$${i * 20 + 16}::uuid,$${i * 20 + 17},$${i * 20 + 18},$${i * 20 + 19}::timestamptz,$${i * 20 + 20})`).join(",")}
      on conflict (question_hash) do update set
        question_text = excluded.question_text, updated_at = now(), is_deleted = false
      returning id`,
      uniqQ.flat());
    const ids = res.rows.map((r) => r.id);
    const idMap = new Map(uniqQ.map((x, i) => [x[0], ids[i]]));
    const remap = (rows) => rows.map((r) => [idMap.get(r[0]) ?? r[0], ...r.slice(1)]);
    const realOpts = remap(uniqOpts), realAns = remap(uniqAns), realSols = remap(uniqSols);
    if (realOpts.length) await named("opts", `insert into question_options (question_id, option_key, option_text, display_order, is_correct)
      values ${realOpts.map((_, i) => `($${i * 5 + 1}::uuid,$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`).join(",")}
      on conflict do nothing`, realOpts.flat());
    if (realAns.length) await named("ans", `insert into question_answers (question_id, numerical_answer, correct_option_keys)
      values ${realAns.map((_, i) => `($${i * 3 + 1}::uuid,$${i * 3 + 2},$${i * 3 + 3}::text[])`).join(",")}
      on conflict do nothing`, realAns.flat());
    if (realSols.length) await named("sols", `insert into solutions (question_id, solution_type, short_solution, detailed_solution, formula, concept, hint, solution_text)
      values ${realSols.map((_, i) => `($${i * 8 + 1}::uuid,$${i * 8 + 2},$${i * 8 + 3},$${i * 8 + 4},$${i * 8 + 5},$${i * 8 + 6},$${i * 8 + 7},$${i * 8 + 8})`).join(",")}
      on conflict do nothing`, realSols.flat());
    imported += uniqQ.length;
    console.log("  shard:", f, "->", uniqQ.length, "questions");
  }
  console.log(`done. total=${total} imported=${imported} failed=${failed}`);
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
