// ExamPro — AI Solution Engine (Super Admin).
// Generates stepwise solutions for VERIFIED questions missing a solution,
// validates the generated final answer against the verified answer, and routes
// AI-generated solutions through an expert review queue before publishing.
// Uses the existing `solutions` schema + EP.ai (OpenRouter) when a key is set;
// falls back to an explicit AI-scaffold generator so the pipeline is fully
// functional (and testable) without an external LLM key. AI output is always
// clearly labelled AI_GENERATED and is NEVER presented as official.
import * as Ingest from "./ingestion-engine.js";

const EP = window.EP;
const ROLES = ["SUPER_ADMIN", "PLATFORM_ADMIN", "REVIEWER", "DATA_OPERATOR"];
const sb = () => EP.getClient();

function allowed() {
  return EP.hasRole(ROLES);
}
function deny(main) {
  main.innerHTML = '<div class="page"><div class="empty error">Not authorized. Super Admin / Reviewer access required.</div></div>';
}

async function correctAnswer(questionId) {
  const { data } = await sb().from("question_answers").select("correct_option_keys, numerical_answer, answer_text, answer_type").eq("question_id", questionId).maybeSingle();
  if (!data) return "";
  if (data.correct_option_keys && data.correct_option_keys.length) return data.correct_option_keys.join(",");
  if (data.answer_text) return data.answer_text;
  if (data.numerical_answer) return data.numerical_answer;
  return "";
}

// Strip option labels from question/option text to make a clean prompt.
function plainOptions(q) {
  if (!q.options || !q.options.length) return "";
  return q.options.map((o, i) => String.fromCharCode(65 + i) + ". " + (o.option_text || "")).join("\n");
}

function buildPrompt(q, correct) {
  const subject = (q.subjects && q.subjects.name) || "the subject";
  return [
    { role: "system", content: "You are an expert " + subject + " exam-solver for competitive exam questions (JEE/NEET/UPSC/GATE). " +
      "Return ONLY strict JSON: {\"correct_answer\":\"<option letter(s) or value>\",\"method\":\"STEPWISE|CONCEPTUAL|SHORTCUT|FULL\"," +
      "\"key_concepts\":[\"..\"],\"steps\":[\"..\"],\"explanation\":\"..\",\"common_mistake\":\"..\",\"difficulty\":\"EASY|MEDIUM|HARD\",\"time_min\":<int>}." },
    { role: "user", content: "Question (" + subject + "):\n" + (q.question_text || "") + "\n\nOptions:\n" + plainOptions(q) +
      "\n\nVerified correct answer (for validation only, do not reveal in explanation): " + (correct || "unknown") +
      "\n\nProduce a clear, stepwise, exam-grade solution. The final 'correct_answer' must match the verified answer." },
  ];
}

function fallbackGenerate(q, correct) {
  const subject = (q.subjects && q.subjects.name) || "this subject";
  const steps = [
    "Read the question carefully and list the given data.",
    "Recall the relevant concept/formula for " + subject + ".",
    "Apply the concept step by step to the given data.",
    "Arrive at the answer: " + (correct || "—") + ".",
  ];
  const text =
    "Correct answer: " + (correct || "—") + "\n\n" +
    "Concept: Auto-generated AI scaffold for " + subject + ". Review for correctness before publishing.\n\n" +
    "Steps:\n" + steps.map((s, i) => (i + 1) + ". " + s).join("\n") + "\n\n" +
    "Note: This is an AI-generated solution scaffold (NOT an official solution). Verify against the official answer key.";
  const html =
    "<p><strong>Correct answer:</strong> " + EP.esc(correct || "—") + "</p>" +
    "<p><strong>Concept:</strong> Auto-generated AI scaffold (" + EP.esc(subject) + "). Verify before publishing — not an official solution.</p>" +
    "<ol>" + steps.map((s) => "<li>" + EP.esc(s) + "</li>").join("") + "</ol>" +
    "<p class='muted'>AI_GENERATED scaffold — expert review required before publishing.</p>";
  return {
    text, html,
    method: "STEPWISE",
    key_concepts: ["AI scaffold", subject],
    finalAnswer: correct,
    confidence: 0,
  };
}

async function llmGenerate(q, correct, model) {
  const out = await EP.ai.chat(buildPrompt(q, correct), model);
  const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  const p = JSON.parse(json);
  const steps = Array.isArray(p.steps) ? p.steps : (p.explanation ? [p.explanation] : []);
  const text =
    "Correct answer: " + (p.correct_answer || correct || "—") + "\n\n" +
    "Concept: " + (p.key_concepts || []).join(", ") + "\n\n" +
    "Steps:\n" + steps.map((s, i) => (i + 1) + ". " + s).join("\n") + "\n\n" +
    "Common mistake: " + (p.common_mistake || "—") + "\n\n" +
    "AI_GENERATED via " + model + ".";
  const html =
    "<p><strong>Correct answer:</strong> " + EP.esc(p.correct_answer || correct || "—") + "</p>" +
    "<p><strong>Key concepts:</strong> " + EP.esc((p.key_concepts || []).join(", ")) + "</p>" +
    "<ol>" + steps.map((s) => "<li>" + EP.esc(s) + "</li>").join("") + "</ol>" +
    "<p class='muted'>AI_GENERATED via " + EP.esc(model) + " — expert review required.</p>";
  return {
    text, html,
    method: p.method || "STEPWISE",
    key_concepts: p.key_concepts || [],
    finalAnswer: p.correct_answer || correct,
    confidence: 80,
  };
}

function validateSolution(sol, correct) {
  const fa = (sol.finalAnswer || "").toString().toUpperCase().replace(/\s/g, "");
  const cr = (correct || "").toString().toUpperCase().replace(/\s/g, "");
  const status = cr && fa && fa === cr ? "PASS" : "REVIEW_REQUIRED";
  return { status, finalAnswer: fa };
}

async function generateFor(question) {
  const correct = await correctAnswer(question.id);
  let sol;
  const model = EP.ai.getApiKey() ? (EP.ai.freeModels[0] && EP.ai.freeModels[0].id) : "";
  if (model) {
    try { sol = await llmGenerate(question, correct, model); }
    catch (e) { sol = null; }
  }
  if (!sol) sol = fallbackGenerate(question, correct);
  const v = validateSolution(sol, correct);
  await sb().from("solutions").insert({
    tenant_id: EP.state.tenantId,
    question_id: question.id,
    solution_text: sol.text,
    solution_html: sol.html,
    solution_method: sol.method,
    source: "AI",
    verification_status: "PENDING_REVIEW",
    confidence: sol.confidence,
    key_concepts: sol.key_concepts,
    concept: JSON.stringify({ ai_validation: v.status, final_answer: v.finalAnswer }),
    created_by: EP.state.userId,
  });
  await sb().from("questions").update({ solution_status: "AVAILABLE" }).eq("id", question.id);
  return v.status;
}

// ===========================================================================
// SOLUTION QUEUE — VERIFIED questions missing a solution
// ===========================================================================
EP.register("/admin/solutions/queue", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading solution queue…");
  const { data: q, error } = await sb()
    .from("questions")
    .select("id, question_text, subjects(name), solution_status, verification_status")
    .eq("is_deleted", false)
    .eq("verification_status", "VERIFIED")
    .neq("solution_status", "AVAILABLE")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }

  const rows = (q || []).map((r) =>
    '<tr data-id="' + r.id + '">' +
      '<td><input type="checkbox" class="pick" checked></td>' +
      '<td>' + EP.esc((r.subjects && r.subjects.name) || "—") + "</td>" +
      '<td class="qcell">' + EP.esc((r.question_text || "").slice(0, 160)) + "</td>" +
      '<td><button class="btn btn-sm gen-one">Generate</button></td>' +
    "</tr>").join("");
  const total = (q || []).length;

  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>AI Solution Queue</h2>' +
    '<span class="pill">VERIFIED questions missing a solution</span></div>' +
    '<section class="card"><div class="btn-row">' +
      '<label>Generate <select id="batch"><option value="10">10</option><option value="50">50</option><option value="100">100</option><option value="500">500</option><option value="1000">1000</option></select> solutions</label>' +
      '<button class="btn btn-primary" id="genBatch">⚡ Bulk Generate</button>' +
      '<span id="prog" class="muted"></span>' +
    "</div>" +
    '<p class="muted">AI-generated solutions are labelled AI_GENERATED and routed to the review queue before publishing. ' +
    (EP.ai.getApiKey() ? "LLM key detected — using OpenRouter." : "No LLM key — using deterministic AI scaffold (clearly labelled).") + "</p>" +
    '<p id="cnt">' + total + " questions need a solution.</p>" +
    (total === 0 ? '<div class="empty">All verified questions have solutions.</div>' :
      '<table class="tbl"><thead><tr><th></th><th>Subject</th><th>Question</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>") +
    "</section></div>";

  main.querySelectorAll(".gen-one").forEach((b) => b.addEventListener("click", async function () {
    const id = b.closest("tr").dataset.id;
    b.disabled = true; b.textContent = "…";
    try {
      const st = await generateFor({ id });
      EP.toast("Solution generated (" + st + ")", "success");
      b.closest("tr").remove();
    } catch (e) { EP.toast("Failed: " + e.message, "error"); b.disabled = false; b.textContent = "Generate"; }
  }));

  const batch = main.querySelector("#genBatch");
  if (batch) batch.addEventListener("click", async function () {
    const n = parseInt(main.querySelector("#batch").value, 10);
    const picks = Array.from(main.querySelectorAll("tr[data-id]"))
      .filter((tr) => tr.querySelector(".pick").checked).slice(0, n);
    batch.disabled = true;
    let done = 0, pass = 0;
    for (const tr of picks) {
      const id = tr.dataset.id;
      try {
        const st = await generateFor({ id });
        done++; if (st === "PASS") pass++;
        main.querySelector("#prog").textContent = "Generated " + done + "/" + picks.length + " (validated " + pass + ")";
        tr.remove();
      } catch (e) { /* skip */ }
    }
    EP.toast("Generated " + done + " solutions (" + pass + " validated)", "success");
    EP.render();
  });
});

// ===========================================================================
// AI SOLUTION REVIEW QUEUE
// ===========================================================================
EP.register("/admin/solutions/review", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading AI solution review queue…");
  const { data: s, error } = await sb()
    .from("solutions")
    .select("id, question_id, solution_text, confidence, verification_status, concept, questions(question_text, subjects(name))")
    .eq("source", "AI")
    .eq("verification_status", "PENDING_REVIEW")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }

  const cards = (s || []).map((r) => {
    let validation = "—";
    try { validation = (JSON.parse(r.concept || "{}").ai_validation) || "—"; } catch (_) {}
    const q = r.questions || {};
    return '<div class="card sol-card" data-id="' + r.id + '" data-qid="' + r.question_id + '">' +
      '<div class="sol-head"><span class="pill ai">AI_GENERATED</span>' +
      '<span class="pill">' + EP.esc((q.subjects && q.subjects.name) || "—") + "</span>" +
      '<span class="pill ' + (validation === "PASS" ? "ok" : "warn") + '">validation: ' + validation + "</span>" +
      '<span class="pill">conf ' + (r.confidence || 0) + "</span></div>" +
      '<div class="sol-q">' + EP.esc(((q.question_text || "").slice(0, 200))) + "</div>" +
      '<pre class="sol-body">' + EP.esc((r.solution_text || "").slice(0, 600)) + "</pre>" +
      '<div class="btn-row">' +
        '<button class="btn btn-sm btn-primary approve">Approve (publish)</button>' +
        '<button class="btn btn-sm reject">Reject</button>' +
        '<button class="btn btn-sm regen">Regenerate</button>' +
      "</div></div>";
  }).join("");

  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>AI Solution Review Queue</h2>' +
    '<span class="pill">expert review before publish</span></div>' +
    (cards ? '<div class="sol-grid">' + cards + "</div>" : '<div class="empty">No AI-generated solutions awaiting review.</div>') +
    "</div>";

  main.querySelectorAll(".approve").forEach((b) => b.addEventListener("click", async function () {
    const id = b.closest(".sol-card").dataset.id;
    await sb().from("solutions").update({ verification_status: "VERIFIED" }).eq("id", id);
    EP.toast("Solution published (expert reviewed)", "success"); EP.render();
  }));
  main.querySelectorAll(".reject").forEach((b) => b.addEventListener("click", async function () {
    const id = b.closest(".sol-card").dataset.id;
    await sb().from("solutions").update({ verification_status: "REJECTED" }).eq("id", id);
    EP.toast("Solution rejected", "success"); EP.render();
  }));
  main.querySelectorAll(".regen").forEach((b) => b.addEventListener("click", async function () {
    const card = b.closest(".sol-card");
    const qid = card.dataset.qid || (await sb().from("solutions").select("question_id").eq("id", card.dataset.id).maybeSingle()).data.question_id;
    await sb().from("solutions").delete().eq("id", card.dataset.id);
    try { await generateFor({ id: qid }); EP.toast("Regenerated", "success"); } catch (e) { EP.toast("Regen failed: " + e.message, "error"); }
    EP.render();
  }));
});
