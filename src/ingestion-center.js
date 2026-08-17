// ExamPro — Super Admin Question Bank Ingestion Center.
// Dashboard + multi-page/file ingestion + job tracking + verification queue
// + source registry + official PYQ hub. Built on top of the existing
// ingestion_jobs / source_documents schema and src/ingestion-engine.js.
import * as Ingest from "./ingestion-engine.js";

const EP = window.EP;
const ROLES = ["SUPER_ADMIN", "PLATFORM_ADMIN"];
const sb = () => EP.getClient();

function allowed() {
  return EP.hasRole(ROLES);
}
function deny(main) {
  main.innerHTML = '<div class="page"><div class="empty error">Not authorized. Super Admin access required.</div></div>';
}

async function countWhere(extra) {
  let q = sb().from("questions").select("*", { count: "exact", head: true }).eq("is_deleted", false);
  if (extra) q = extra(q);
  const { count } = await q;
  return count || 0;
}

// ===========================================================================
// DASHBOARD
// ===========================================================================
EP.register("/admin/ingestion", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading ingestion center…");
    const [total, verified, pending, needsEdit, pyq, ncert, withSol, jobs, sources, conflicts, shards] = await Promise.all([
    countWhere(null),
    countWhere((q) => q.eq("verification_status", "VERIFIED")),
    countWhere((q) => q.eq("verification_status", "PENDING_REVIEW")),
    countWhere((q) => q.eq("verification_status", "NEEDS_EDIT")),
    countWhere((q) => q.eq("is_pyq", true)),
    countWhere((q) => q.eq("ncert", true)),
    countWhere((q) => q.eq("solution_status", "AVAILABLE")),
    sb().from("ingestion_jobs").select("*", { count: "exact", head: true }),
    sb().from("source_documents").select("*", { count: "exact", head: true }).eq("is_deleted", false),
    sb().from("questions").select("*", { count: "exact", head: true }).eq("is_deleted", false).eq("pipeline_status", "CONFLICT"),
    sb().from("question_shards").select("*", { count: "exact", head: true }),
  ]);

  const stat = (t, v, p, extra) =>
    '<a class="stat-card" ' + (p ? 'href="#' + p + '"' : "") + '><div class="stat-v">' + EP.fmtMarks(v) + "</div><div class=\"stat-l\">" + t + "</div></a>" + (extra || "");

  // Google Drive connection card — §10 state system + §32 provider/policy
  // display. State derives ONLY from the server-reported health payload.
  const gd = EP.getGoogleDriveStatus ? EP.getGoogleDriveStatus() : null;
  const policy = await EP.getStoragePolicy();
  const gdState = gd && gd.available === false ? "NOT_DEPLOYED" : EP.driveStateFromHealth(gd || {});
  const gdStateUi = {
    CONNECTED: { icon: "●", cls: "pill ok", label: "Connected" },
    NOT_CONNECTED: { icon: "○", cls: "pill warn", label: "Not connected" },
    REAUTHORIZATION: { icon: "⚠", cls: "pill warn", label: "Authorization expired" },
    ERROR: { icon: "⚠", cls: "pill bad", label: "Connection error" },
    NOT_DEPLOYED: { icon: "○", cls: "pill warn", label: "Edge functions not deployed" },
  }[gdState] || { icon: "○", cls: "pill warn", label: "Not connected" };
  const gdStatus = '<span class="' + gdStateUi.cls + '">' + gdStateUi.icon + " " + gdStateUi.label + "</span>";
  const gdCard =
    '<section class="card"><h3>Google Drive Storage</h3>' +
    '<ul class="simple-list">' +
      '<li><span>Storage provider</span><span class="badge b-ok">Google Drive</span></li>' +
      '<li><span>Status</span><span>' + gdStatus + "</span></li>" +
      (gd && gd.connected && gd.account ? '<li><span>Account</span><span class="muted">' + EP.esc(gd.account) + "</span></li>" : "") +
      (gd && gd.connected && gd.lastVerifiedAt ? '<li><span>Last verified</span><span class="muted">' + EP.esc(String(gd.lastVerifiedAt).replace("T", " ").slice(0, 19)) + "</span></li>" : "") +
      '<li><span>Storage policy</span><span class="badge ' + (policy === "GOOGLE_DRIVE_REQUIRED" ? "b-ok" : "b-warn") + '">' + EP.esc(policy) + "</span></li>" +
    "</ul>" +
    '<div class="btn-row" style="margin-top:8px"><span></span>' +
      (gdState === "CONNECTED"
        ? '<button class="btn" id="gd_disconnect">Disconnect</button>'
        : gdState === "REAUTHORIZATION"
          ? '<button class="btn btn-primary" id="gd_connect">Reconnect Google Drive</button>'
          : gdState === "ERROR"
            ? '<button class="btn" id="gd_retry">Retry</button> <button class="btn btn-primary" id="gd_connect">Reconnect</button>'
            : '<button class="btn btn-primary" id="gd_connect">Connect Google Drive</button>') +
    "</div>" +
    '<p class="muted">Questions, answer keys &amp; solutions persist to Google Drive (OAuth). ' +
    (policy === "GOOGLE_DRIVE_REQUIRED"
      ? "Storage policy is <b>GOOGLE_DRIVE_REQUIRED</b>: while Drive is disconnected, production question-bank ingestion is blocked — no content is written to any other backend."
      : policy === "GOOGLE_DRIVE_PREFERRED"
        ? "Storage policy is <b>GOOGLE_DRIVE_PREFERRED</b>: Drive is primary; if Drive is unavailable, content is stored in Supabase Storage and clearly labelled as such."
        : "Storage policy is <b>SUPABASE_ONLY</b>: content is stored in Supabase Storage and clearly labelled as such.") +
    "</p></section>";

  // §31: persistent non-blocking banner for admins while a REQUIRED policy
  // blocks production ingestion.
  const gdBanner = (EP.roleType() === "super" && policy === "GOOGLE_DRIVE_REQUIRED" && gdState !== "CONNECTED" && gdState !== "NOT_DEPLOYED")
    ? '<section class="card" id="gd_banner" style="border-left:4px solid #d97706"><b>Google Drive is not connected.</b> Production question ingestion is paused until Drive is authorized. ' +
      '<button class="btn btn-sm btn-primary" id="gd_banner_connect">Connect Google Drive</button></section>'
    : "";

  const cards =
    stat("Total Questions", total, "/admin/ingestion/jobs") +
    stat("Verified", verified, "/admin/ingestion/review") +
    stat("Pending Review", pending, "/admin/ingestion/review") +
    stat("Needs Edit", needsEdit, "/admin/ingestion/review") +
    stat("Conflicts", conflicts.count || 0, "/admin/ingestion/review") +
    stat("PYQ", pyq) +
    stat("NCERT", ncert) +
    stat("With Solution", withSol) +
    stat("Ingestion Jobs", jobs.count || 0, "/admin/ingestion/jobs") +
    stat("Source Documents", sources.count || 0, "/admin/ingestion/sources") +
    stat("Question Shards", shards.count || 0);

  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Question Bank Ingestion Center</h2>' +
    '<span class="pill">Super Admin</span></div>' +
    '<div class="stat-grid">' + cards + "</div>" +
    '<div class="grid-2">' +
      '<section class="card"><h3>Ingest</h3><div class="btn-row">' +
        '<a class="btn btn-primary" href="#/admin/ingestion/upload">⬆ Upload Files</a>' +
        '<a class="btn" href="#/admin/ingestion/upload?kind=ANSWER_KEY">Import Answer Key</a>' +
        '<a class="btn" href="#/admin/ingestion/upload?kind=SOLUTION_BOOK">Import Solutions</a>' +
        '<a class="btn" href="#/admin/official-pyq">Official PYQ Center</a>' +
      "</div></section>" +
      '<section class="card"><h3>Review &amp; operations</h3><div class="btn-row">' +
         '<a class="btn" href="#/admin/ingestion/review">Verification Queue</a>' +
        '<a class="btn" href="#/admin/ingestion/jobs">Ingestion Jobs</a>' +
        '<a class="btn" href="#/admin/ingestion/sources">Source Registry</a>' +
        '<a class="btn" href="#/admin/ingestion/answerkey">Answer-Key Matching</a>' +
        '<a class="btn" href="#/admin/ingestion/upload?kind=QUESTION_BOOK">Failed / Retry</a>' +
      "</div></section>" +
    "</div>" +
    gdBanner +
    gdCard +
    '<section class="card"><h3>Supported inputs</h3><p class="muted">PDF (text &amp; scanned via OCR), JPEG/PNG/WEBP, DOC/DOCX text, CSV, XLSX, JSON, JSONL, ZIP. ' +
    'Large books are processed page-by-page into resumable ingestion jobs; duplicate questions are collapsed to a canonical record.</p></section>' +
    "</div>";

  const gdConnect = EP.qs("#gd_connect");
  if (gdConnect) gdConnect.addEventListener("click", async function () {
    const label = gdConnect.textContent;
    gdConnect.disabled = true; gdConnect.textContent = "Redirecting…";
    const ok = await EP.connectGoogleDrive();
    // Reset unless we actually navigated away — a failed/timed-out start must
    // never leave "Redirecting…" on screen.
    if (!ok) { gdConnect.disabled = false; gdConnect.textContent = label; }
  });
  const gdDisconnect = EP.qs("#gd_disconnect");
  if (gdDisconnect) gdDisconnect.addEventListener("click", async () => { await EP.disconnectGoogleDrive(); EP.render(); });
  const gdRetry = EP.qs("#gd_retry");
  if (gdRetry) gdRetry.addEventListener("click", async () => { await EP.refreshGoogleDriveStatus(); EP.render(); });
  const gdBannerConnect = EP.qs("#gd_banner_connect");
  if (gdBannerConnect) gdBannerConnect.addEventListener("click", async function () {
    const label = gdBannerConnect.textContent;
    gdBannerConnect.disabled = true; gdBannerConnect.textContent = "Redirecting…";
    const ok = await EP.connectGoogleDrive();
    if (!ok) { gdBannerConnect.disabled = false; gdBannerConnect.textContent = label; }
  });

  // After OAuth redirect back, RE-PROBE before claiming success (never toast
  // "connected" from the URL alone).
  if (location.hash.indexOf("drive=connected") !== -1) {
    history.replaceState(null, "", "#/admin/ingestion");
    const ok = await EP.refreshGoogleDriveStatus();
    EP.toast(ok ? "Google Drive connected" : "Google Drive is still not connected — check the OAuth flow or retry", ok ? "success" : "error");
    if (ok) EP.render();
  }
});

// ===========================================================================
// UPLOAD + PARSE + INGEST
// ===========================================================================
EP.register("/admin/ingestion/upload", async function (main, path) {
  if (!allowed()) return deny(main);
  const kindParam = (path.split("?")[1] || "").match(/kind=([A-Z_]+)/);
  const docKind = kindParam ? kindParam[1] : "QUESTION_BOOK";

  const [examsRes, subjRes] = await Promise.all([
    sb().from("exams").select("id,name,code").eq("is_active", true).order("name"),
    sb().from("subjects").select("id,name,code,exam_id").order("name"),
  ]);
  const exams = examsRes.data || [];
  const subjects = subjRes.data || [];
  const examOpts = '<option value="">Auto-detect from file</option>' + exams.map((e) => '<option value="' + e.id + '" data-code="' + (e.code || "") + '">' + EP.esc(e.name) + "</option>").join("");
  const subjOpts = '<option value="">Auto-detect from file</option>' + subjects.map((s) => '<option value="' + s.id + '" data-code="' + (s.code || "") + '" data-exam="' + s.exam_id + '">' + EP.esc(s.name) + "</option>").join("");

  const kindLabel = { QUESTION_BOOK: "Question Book / Paper", ANSWER_KEY: "Answer Key", SOLUTION_BOOK: "Solution Book", IMAGE_BATCH: "Image Batch", DATA_FILE: "Data File" }[docKind] || "Question Book";

  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Upload &amp; Ingest — ' + kindLabel + '</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div>' +
    '<section class="card"><h3>Step 1 — Source document</h3>' +
      '<div class="form-grid">' +
        '<div class="field"><label>Document kind</label><select id="up_kind" class="input">' +
          ['QUESTION_BOOK','ANSWER_KEY','SOLUTION_BOOK','IMAGE_BATCH','DATA_FILE'].map((k) => '<option value="' + k + '"' + (k === docKind ? " selected" : "") + ">" + (k.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())) + "</option>").join("") +
        "</select></div>" +
        '<div class="field"><label>Book / publisher (optional)</label><input id="up_book" class="input" placeholder="e.g. NTA JEE Main Official Paper"></div>' +
        '<div class="field"><label>Publisher (optional)</label><input id="up_pub" class="input"></div>' +
        '<div class="field"><label>Exam</label><select id="up_exam" class="input">' + examOpts + "</select></div>" +
        '<div class="field"><label>Subject</label><select id="up_subj" class="input">' + subjOpts + "</select></div>" +
        '<div class="field"><label>Year (optional)</label><input id="up_year" class="input" type="number" placeholder="2025"></div>' +
        '<div class="field"><label>PYQ</label><select id="up_pyq" class="input"><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select></div>' +
      "</div>" +
      '<div class="field"><label>File (PDF / image / CSV / JSON / JSONL / DOC / XLSX)</label>' +
        '<input id="up_file" type="file" accept=".pdf,.csv,.json,.jsonl,.txt,.doc,.docx,.xlsx,.png,.jpg,.jpeg,.webp,.zip"></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="up_parse">Parse &amp; preview</button><span id="up_parse_status" class="muted"></span></div>' +
      '<p class="hint" id="up_ocr_note"></p>' +
    "</section>" +
    '<section class="card" id="up_preview_card" style="display:none"><h3>Step 2 — Review (<span id="up_cnt">0</span> questions detected)</h3>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Question</th><th>Exam</th><th>Subject</th><th>Type</th><th>Answer</th><th>Conf</th><th>Issue</th></tr></thead><tbody id="up_rows"></tbody></table></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="up_import">Start ingestion job</button><span id="up_status" class="muted"></span></div>' +
      '<div id="up_progress" class="field" style="display:none"><label>Job progress</label><progress id="up_bar" max="100" value="0" style="width:100%"></progress><span id="up_prog_text" class="muted"></span></div>' +
    "</section></div>";

  const ocrNote = EP.qs("#up_ocr_note");
  if (docKind === "IMAGE_BATCH") ocrNote.textContent = "Image batches are OCR-processed (tesseract.js) when forced; text PDFs are extracted directly.";
  EP.qs("#up_kind").addEventListener("change", function () {
    const k = EP.qs("#up_kind").value;
    EP.navigate("/admin/ingestion/upload?kind=" + k);
  });

  EP.qs("#up_parse").addEventListener("click", async function () {
    const file = EP.qs("#up_file").files[0];
    if (!file) { EP.toast("Choose a file first", "error"); return; }
    EP.qs("#up_parse").disabled = true;
    EP.qs("#up_parse_status").textContent = "Extracting & segmenting…";
    let result;
    try {
      result = await Ingest.extractFromFile(file, { forceOcr: docKind === "IMAGE_BATCH", meta: { source_book: EP.qs("#up_book").value || null, source_publisher: EP.qs("#up_pub").value || null } });
    } catch (e) {
      EP.qs("#up_parse").disabled = false;
      EP.qs("#up_parse_status").textContent = "";
      EP.toast("Extraction failed: " + (e.message || e), "error");
      return;
    }
    if (result.error) {
      EP.qs("#up_parse").disabled = false;
      EP.qs("#up_parse_status").textContent = "";
      EP.toast("Could not read file: " + result.error, "error");
      return;
    }
    const items = result.items || [];
    if (!items.length) {
      EP.qs("#up_parse").disabled = false;
      EP.qs("#up_parse_status").textContent = "No questions detected in this file.";
      EP.toast("No questions detected.", "error");
      return;
    }
    window.__ingestItems = items;
    window.__ingestResult = result;
    const examCode = {}, subjCode = {};
    exams.forEach((e) => (examCode[e.code] = e.id));
    subjects.forEach((s) => (subjCode[s.code] = s));
    const rows = items.slice(0, 200).map(function (it, i) {
      const e = it.exam_code ? (examCode[it.exam_code] ? (exams.find((x) => x.code === it.exam_code) || {}).name : it.exam_code) : "—";
      const s = it.subject_code ? ((subjCode[it.subject_code] || {}).name || it.subject_code) : "—";
      const conf = it.parse_confidence != null ? it.parse_confidence : (it.answer && it.answer.confidence != null ? it.answer.confidence : 0);
      const ans = (it.answer && (it.answer.correct_option_keys || []).join(",")) || (it.answer && it.answer.numerical_answer) || "—";
      const issue = (it.issues && it.issues.length) ? it.issues.join("; ") : "ok";
      return "<tr><td>" + (i + 1) + "</td><td class='qtxt'>" + EP.esc((it.question_text || "").replace(/<[^>]+>/g, "").slice(0, 90)) + "</td><td>" + EP.esc(e) + "</td><td>" + EP.esc(s) + "</td><td>" + EP.esc(it.question_type_code || it.question_type || "MCQ") + "</td><td>" + EP.esc(ans) + "</td><td>" + (conf || 0) + "</td><td>" + (issue === "ok" ? '<span class="badge b-ok">ok</span>' : '<span class="badge b-warn">' + EP.esc(issue) + "</span>") + "</td></tr>";
    }).join("");
    EP.qs("#up_cnt").textContent = items.length;
    EP.qs("#up_rows").innerHTML = rows;
    EP.qs("#up_preview_card").style.display = "";
    EP.qs("#up_parse").disabled = false;
    EP.qs("#up_parse_status").textContent = "Detected " + items.length + " questions (" + (result.pages ? result.pages.length + " pages" : "text") + ").";
  });

  EP.qs("#up_import").addEventListener("click", async function () {
    const items = window.__ingestItems || [];
    if (!items.length) return;

    // §12 storage gate — BEFORE any processing, so storage problems surface
    // before questions are parsed/imported. Under GOOGLE_DRIVE_REQUIRED a
    // disconnected Drive blocks production ingestion entirely.
    const gate = await EP.ingestionStorageGate();
    if (!gate.allowed) {
      EP.qs("#up_status").innerHTML =
        '<div class="empty error"><b>' + EP.esc(gate.message) + '</b><br>Storage policy: ' + EP.esc(gate.policy) +
        '<div class="btn-row" style="margin-top:8px">' +
        '<button class="btn btn-primary btn-sm" id="up_gate_connect">Connect Google Drive</button> ' +
        '<button class="btn btn-sm" id="up_gate_cancel">Cancel</button></div></div>';
      EP.qs("#up_gate_connect")?.addEventListener("click", async function () { this.disabled = true; await EP.connectGoogleDrive(); });
      EP.qs("#up_gate_cancel")?.addEventListener("click", function () { EP.qs("#up_status").innerHTML = ""; });
      EP.toast("Google Drive connection required.", "error");
      return;
    }

    EP.qs("#up_import").disabled = true;
    EP.qs("#up_progress").style.display = "";

    const examSel = EP.qs("#up_exam");
    const subjSel = EP.qs("#up_subj");
    const defaults = {};
    if (examSel.value) defaults.exam_code = (examSel.selectedOptions[0] && examSel.selectedOptions[0].dataset.code) || null;
    if (subjSel.value) defaults.subject_code = (subjSel.selectedOptions[0] && subjSel.selectedOptions[0].dataset.code) || null;
    if (EP.qs("#up_year").value) defaults.year = parseInt(EP.qs("#up_year").value, 10);
    const pyqVal = EP.qs("#up_pyq").value;
    if (pyqVal) defaults.is_pyq = pyqVal === "true";

    const file = EP.qs("#up_file").files[0];
    let sourceId = null;
    try {
      const sd = {
        tenant_id: EP.state.tenantId,
        title: EP.qs("#up_book").value || (file ? file.name : "Imported document"),
        kind: docKind,
        source_type: docKind,
        book_name: EP.qs("#up_book").value || null,
        publisher: EP.qs("#up_pub").value || null,
        original_filename: file ? file.name : null,
        mime_type: file ? file.type : null,
        file_size_bytes: file ? file.size : null,
        drive_file_id: "pending-" + (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2)),
      };
      const { data: sdRow, error: sdErr } = await sb().from("source_documents").insert(sd).select("id").single();
      if (!sdErr && sdRow) sourceId = sdRow.id;
    } catch (e) { /* source doc is best-effort */ }

    // Persist the ACTUAL source file bytes to object storage (never local FS,
    // never metadata-only). Backend selection is governed by the storage
    // policy: GOOGLE_DRIVE stores on Drive when connected; under
    // GOOGLE_DRIVE_REQUIRED a disconnected Drive BLOCKS the upload (no silent
    // fallback); GOOGLE_DRIVE_PREFERRED/SUPABASE_ONLY may store in Supabase
    // Storage and the provider is reported honestly (§33).
    const storageReport = { provider: null, status: null, object_id: null, hash: null };
    let storageBlocked = false;
    if (sourceId && file) {
      try {
        const safeName = (file.name || "source").replace(/[^\w.\-]+/g, "_");
        const gd = EP.getGoogleDriveStatus ? EP.getGoogleDriveStatus() : null;
        let storeId = null;
        if (gd && gd.connected) {
          try {
            const up = await EP.uploadToDrive("question-documents",
              "01_Source_Documents/" + sourceId + "_" + safeName, file,
              { tenantId: EP.state.tenantId, sourceDocumentId: sourceId, mimeType: file.type || "application/octet-stream" });
            storeId = (up && up.drive && up.drive.id) || (up && up.object && up.object.drive_file_id) || (up && up.id) || null;
            if (storeId) { storageReport.provider = "GOOGLE_DRIVE"; storageReport.status = "stored"; storageReport.object_id = storeId; }
          } catch (driveErr) {
            // Drive failed mid-job: under REQUIRED the job pauses instead of
            // silently switching backends (§12) — flag it, mark the job after
            // it is created, and keep the parsed questions for resume.
            if (gate.policy === "GOOGLE_DRIVE_REQUIRED") storageBlocked = true;
          }
        }
        if (!storeId && !storageBlocked && gate.policy !== "GOOGLE_DRIVE_REQUIRED") {
          const up = await EP.uploadObjectStorage("question-documents",
            "01_Source_Documents/" + sourceId + "_" + safeName, file,
            { mimeType: file.type || "application/octet-stream" });
          storeId = up.id;
          if (storeId) { storageReport.provider = "SUPABASE_STORAGE"; storageReport.status = gate.fallback ? "stored-fallback" : "stored"; storageReport.object_id = storeId; }
        }
        if (storeId) await sb().from("source_documents").update({ drive_file_id: storeId, status: "INGESTED" }).eq("id", sourceId);
      } catch (e) { /* storage best-effort; manifest still recorded */ }
    }

    const meta = {
      job_type: docKind,
      exam_id: examSel.value || null,
      subject_id: subjSel.value || null,
      year: defaults.year || null,
      source_document_id: sourceId,
      file_name: file ? file.name : null,
    };
    const start = await sb().rpc("app_ingestion_job_start", { p_meta: { ...meta, format: file ? (file.name.split(".").pop() || "FILE").toUpperCase() : "DATA", total_pages: (window.__ingestResult && window.__ingestResult.pages ? window.__ingestResult.pages.length : items.length) } });
    if (start.error) {
      EP.qs("#up_status").textContent = "Job start failed: " + start.error.message;
      EP.qs("#up_import").disabled = false;
      return;
    }
    const jobId = start.data.job_id;

    // §12: storage dropped mid-job under a REQUIRED policy — pause the job
    // (WAITING_FOR_STORAGE) instead of importing into an unintended backend.
    // The parsed questions stay in the preview; reconnect Drive and click
    // Import again to resume.
    if (storageBlocked) {
      await sb().from("ingestion_jobs").update({ status: "WAITING_FOR_STORAGE" }).eq("id", jobId);
      EP.qs("#up_status").innerHTML =
        '<div class="empty error"><b>Job paused — Google Drive storage became unavailable.</b><br>' +
        'Parsed questions are preserved in the preview above. Connect Google Drive, then click “Start ingestion job” again to resume. ' +
        'Nothing was written to any other storage backend.</div>';
      EP.qs("#up_import").disabled = false;
      EP.qs("#up_progress").style.display = "none";
      return;
    }

    const CHUNK = 25;
    let imported = 0, duplicates = 0, failed = 0, review = 0, errors = [];
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      const r = await sb().rpc("app_import_questions_v2", {
        p_items: chunk,
        p_source_document_id: sourceId,
        p_job_id: jobId,
        p_import_batch: "ingest-" + jobId.slice(0, 8),
        p_defaults: defaults,
        p_verification: "PENDING_REVIEW",
      });
      if (r.error) { errors.push(r.error.message); failed += chunk.length; }
      else {
        imported += (r.data.imported || 0); duplicates += (r.data.duplicates || 0); failed += (r.data.failed || 0); review += (r.data.review || 0);
        if (r.data.errors) r.data.errors.forEach((e) => errors.push("row " + e.index + ": " + e.error));
      }
      const done = Math.min(i + CHUNK, items.length);
      EP.qs("#up_bar").value = Math.round((done / items.length) * 100);
      EP.qs("#up_prog_text").textContent = "Imported " + imported + " · duplicates " + duplicates + " · failed " + failed;
      await sb().from("ingestion_pages").upsert(
        { ingestion_job_id: jobId, tenant_id: EP.state.tenantId, page_number: done, status: "OK", questions_detected: items.length, questions_imported: imported, processed_at: new Date().toISOString() },
        { onConflict: "ingestion_job_id,page_number" }
      );
    }

    // Question shard manifest — governed by the same storage policy (§33):
    // Drive when connected; Supabase Storage ONLY when the policy permits a
    // fallback (and labelled honestly); under GOOGLE_DRIVE_REQUIRED a Drive
    // failure marks the shard PENDING and the job WAITING_FOR_STORAGE (§12).
    let shardStoredVia = null;
    try {
      const shard = await Ingest.buildShard(items);
      let driveFileId = null;
      let storedVia = null;
      const gd = EP.getGoogleDriveStatus ? EP.getGoogleDriveStatus() : null;
      // 1) Google Drive primary (only when actually connected)
      if (gd && gd.connected) {
        try {
          const path = "02_Question_Bank/" + (examSel.selectedOptions[0] ? (examSel.selectedOptions[0].dataset.code || "EXAM") : "EXAM") +
            "/" + (defaults.year || "NA") + "/shard-" + (sourceId || jobId).slice(0, 8) + ".jsonl.gz";
          const up = await EP.uploadToDrive("question-documents", path, shard.gzipBlob, {
            tenantId: EP.state.tenantId, sourceDocumentId: sourceId || "", mimeType: "application/gzip",
          });
          driveFileId = (up && up.drive && up.drive.id) || (up && up.object && up.object.drive_file_id) || (up && up.id) || null;
          if (driveFileId) storedVia = "GOOGLE_DRIVE";
        } catch (driveErr) { /* handled by policy below */ }
      }
      // 2) Supabase Storage — ONLY when the policy permits a fallback
      if (!driveFileId && gate.policy !== "GOOGLE_DRIVE_REQUIRED") {
        try {
          const path = "02_Question_Bank/" + (examSel.selectedOptions[0] ? (examSel.selectedOptions[0].dataset.code || "EXAM") : "EXAM") +
            "/" + (defaults.year || "NA") + "/shard-" + (sourceId || jobId).slice(0, 8) + ".jsonl.gz";
          const up = await EP.uploadObjectStorage("question-documents", path, shard.gzipBlob, { mimeType: "application/gzip" });
          driveFileId = up.id; storedVia = "SUPABASE_STORAGE";
        } catch (storeErr) { /* both backends failed */ }
      }
      shardStoredVia = storedVia;
      storageReport.hash = shard.sha256;
      await sb().from("question_shards").insert({
        tenant_id: EP.state.tenantId,
        exam_id: examSel.value || null,
        subject_id: subjSel.value || null,
        year_start: defaults.year || null,
        year_end: defaults.year || null,
        question_count: shard.count,
        compressed_size: shard.compressedSize,
        uncompressed_size: shard.uncompressedSize,
        sha256: shard.sha256,
        drive_file_id: driveFileId || ("pending-" + (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2))),
        format: "JSONL",
        compression: "GZIP",
        status: driveFileId ? "STORED" : "PENDING",
        created_by: EP.state.userId || null,
      });
    } catch (shardErr) { /* non-fatal */ }

    const status = failed > 0 && imported === 0 ? "FAILED"
      : (gate.policy === "GOOGLE_DRIVE_REQUIRED" && !shardStoredVia) ? "WAITING_FOR_STORAGE"
      : "COMPLETED";
    await sb().from("ingestion_jobs").update({
      status: status,
      current_page: items.length,
      questions_detected: items.length,
      questions_imported: imported,
      questions_review: review,
      duplicates: duplicates,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", jobId);

    EP.qs("#up_import").disabled = false;
    const msg = "Ingestion complete: imported " + imported + ", duplicates " + duplicates + ", review " + review + ", failed " + failed + ".";
    EP.toast(msg, failed && imported === 0 ? "error" : "success");
    // §33: honest storage summary — provider, status, object id, hash.
    const storeLine = storageReport.provider || shardStoredVia
      ? " Stored in " + (storageReport.provider === "SUPABASE_STORAGE" || shardStoredVia === "SUPABASE_STORAGE" ? "Supabase Storage" : "Google Drive") +
        " (" + (storageReport.provider || shardStoredVia) + (storageReport.status && storageReport.status.indexOf("fallback") !== -1 ? ", fallback" : "") + ")" +
        (storageReport.object_id ? " · object " + String(storageReport.object_id).slice(0, 18) + "…" : "") +
        (storageReport.hash ? " · sha256 " + String(storageReport.hash).slice(0, 12) + "…" : "")
      : (gate.policy === "GOOGLE_DRIVE_REQUIRED"
        ? " Shard storage is WAITING_FOR_STORAGE — Google Drive required by policy and not available."
        : " No storage backend was available.");
    EP.qs("#up_status").innerHTML = EP.esc(msg) + " " + EP.esc(storeLine) + (errors.length ? " Errors: " + EP.esc(errors.slice(0, 3).join(" | ")) : "");
    if (sourceId) EP.qs("#up_status").innerHTML += ' <a href="#/admin/ingestion/sources">View source</a>';
  });
});

// ===========================================================================
// INGESTION JOBS
// ===========================================================================
EP.register("/admin/ingestion/jobs", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading ingestion jobs…");
  const { data, error } = await sb().from("ingestion_jobs").select("*").order("updated_at", { ascending: false }).limit(100);
  if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }
  if (!data || !data.length) {
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Ingestion Jobs</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div><div class="empty">No ingestion jobs yet. <a href="#/admin/ingestion/upload">Start one</a>.</div></div>';
    return;
  }
  const badge = (s) => {
    const cls = s === "COMPLETED" ? "ok" : (s === "FAILED" || s === "CANCELLED") ? "bad" : (s === "PROCESSING" || s === "WAITING_FOR_STORAGE" || s === "PAUSED") ? "warn" : "";
    return '<span class="badge b-' + cls + '">' + EP.esc(s) + "</span>";
  };
  const rows = data.map(function (j) {
    const pct = j.total_pages ? Math.round((j.current_page / j.total_pages) * 100) : (j.status === "COMPLETED" ? 100 : 0);
    return '<tr><td>' + EP.esc((j.metadata && (j.metadata.book_name || j.metadata.job_type)) || j.id.toString().slice(0, 8)) + "</td>" +
      "<td>" + badge(j.status) + "</td>" +
      "<td>" + (j.total_pages || 0) + "</td>" +
      "<td>" + (j.current_page || 0) + " (" + pct + "%)</td>" +
      "<td>" + (j.questions_detected || 0) + "</td>" +
      "<td>" + (j.questions_imported || 0) + "</td>" +
      "<td>" + (j.questions_review || 0) + "</td>" +
      "<td>" + (j.duplicates || 0) + "</td>" +
      "<td>" + (j.failed_pages || 0) + "</td>" +
      "<td>" + EP.fmtDate(j.started_at || j.updated_at) + "</td></tr>";
  }).join("");
  const STATUSES = ["ALL", "PROCESSING", "COMPLETED", "FAILED", "PAUSED", "WAITING_FOR_STORAGE", "CANCELLED"];
  const active = (window.__ingJobFilter || "ALL");
  const counts = { ALL: data.length };
  data.forEach((j) => { counts[j.status] = (counts[j.status] || 0) + 1; });
  const filterBtns = STATUSES.map((s) =>
    '<button class="btn btn-sm' + (s === active ? " btn-primary" : "") + '" data-jfilter="' + s + '">' + s + (counts[s] != null ? " (" + counts[s] + ")" : "") + "</button>").join(" ");
  const shown = active === "ALL" ? rows : data.filter((j) => j.status === active).map(function (j) {
    const pct = j.total_pages ? Math.round((j.current_page / j.total_pages) * 100) : (j.status === "COMPLETED" ? 100 : 0);
    return '<tr><td>' + EP.esc((j.metadata && (j.metadata.book_name || j.metadata.job_type)) || j.id.toString().slice(0, 8)) + "</td>" +
      "<td>" + badge(j.status) + "</td>" +
      "<td>" + (j.total_pages || 0) + "</td>" +
      "<td>" + (j.current_page || 0) + " (" + pct + "%)</td>" +
      "<td>" + (j.questions_detected || 0) + "</td>" +
      "<td>" + (j.questions_imported || 0) + "</td>" +
      "<td>" + (j.questions_review || 0) + "</td>" +
      "<td>" + (j.duplicates || 0) + "</td>" +
      "<td>" + (j.failed_pages || 0) + "</td>" +
      "<td>" + EP.fmtDate(j.started_at || j.updated_at) + "</td></tr>";
  }).join("") || '<tr><td colspan="10" class="muted">No jobs with this status.</td></tr>';
  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Ingestion Jobs</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a> <a class="btn btn-sm" href="#/admin/ingestion/upload">New</a></div>' +
    '<div class="btn-row" style="margin-bottom:10px">' + filterBtns + "</div>" +
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>Job</th><th>Status</th><th>Pages</th><th>Progress</th><th>Detected</th><th>Imported</th><th>Review</th><th>Dupes</th><th>Failed</th><th>Created</th></tr></thead><tbody>' + shown + "</tbody></table></div></div>";
  EP.qsa("[data-jfilter]").forEach(function (b) {
    b.addEventListener("click", function () {
      window.__ingJobFilter = b.getAttribute("data-jfilter");
      EP.render();
    });
  });
});

// ===========================================================================
// VERIFICATION / REVIEW QUEUE
// ===========================================================================
EP.register("/admin/ingestion/review", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading verification queue…");
  const { data, error } = await sb().from("questions")
    .select("id, question_text, difficulty, year, verification_status, pipeline_status, is_pyq, ncert, subjects(name), chapters(name)")
    .eq("is_deleted", false)
    .in("verification_status", ["PENDING_REVIEW", "NEEDS_EDIT"])
    .order("created_at", { ascending: false }).limit(150);
  if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }
  if (!data || !data.length) {
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Verification Queue</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div><div class="empty">No questions pending review. 🎉</div></div>';
    return;
  }
  const rows = data.map(function (q) {
    const st = q.verification_status === "VERIFIED" ? "ok" : (q.verification_status === "PENDING_REVIEW" ? "warn" : "bad");
    const conflict = q.pipeline_status === "CONFLICT" ? ' <span class="badge b-bad">CONFLICT</span>' : "";
    return '<tr><td class="qtxt">' + EP.esc((q.question_text || "").replace(/<[^>]+>/g, "").slice(0, 110)) + "</td>" +
      "<td>" + EP.esc((q.subjects && q.subjects.name) || "—") + "</td>" +
      "<td>" + EP.esc((q.chapters && q.chapters.name) || "—") + "</td>" +
      "<td>" + EP.esc(q.year || "—") + "</td>" +
      '<td><span class="badge b-' + st + '">' + EP.esc(q.verification_status) + "</span>" + conflict + "</td>" +
      '<td><div class="btn-row">' +
        '<button class="btn btn-sm" onclick="window.__verify(\'' + q.id + "','VERIFIED')\">Approve</button>" +
        '<button class="btn btn-sm" onclick="window.__verify(\'' + q.id + "','REJECTED')\">Reject</button>" +
        '<button class="btn btn-sm" onclick="window.__conflict(\'' + q.id + "')\">Conflict</button>" +
        '<a class="btn btn-sm btn-ghost" href="#/questions/' + q.id + '">Open</a>' +
      "</div></td></tr>";
  }).join("");
  window.__verify = async function (id, decision) {
    const { error } = await sb().rpc("app_verify_question", { p_question_id: id, p_decision: decision, p_note: null });
    if (error) EP.toast(error.message, "error");
    else { EP.toast("Question " + decision.toLowerCase().replace("_", " "), "success"); EP.render(); }
  };
  window.__conflict = async function (id) {
    const { error } = await sb().from("questions").update({ pipeline_status: "CONFLICT" }).eq("id", id);
    if (error) EP.toast(error.message, "error");
    else { EP.toast("Marked as conflict — routed to manual review", "success"); EP.render(); }
  };
  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Verification Queue</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div>' +
    '<p class="muted">Approve publishes VERIFIED questions. Reject removes them from the usable bank. Conflict flags answer/verification mismatches for human resolution.</p>' +
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>Question</th><th>Subject</th><th>Chapter</th><th>Year</th><th>Status</th><th>Actions</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
});

// ===========================================================================
// SOURCE DOCUMENT REGISTRY
// ===========================================================================
EP.register("/admin/ingestion/sources", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading source registry…");
  const { data, error } = await sb().from("source_documents").select("*").eq("is_deleted", false).order("created_at", { ascending: false }).limit(100);
  if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }
  if (!data || !data.length) {
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Source Registry</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div><div class="empty">No source documents registered. <a href="#/admin/ingestion/upload">Upload one</a>.</div></div>';
    return;
  }
  const rows = data.map(function (d) {
    return '<tr><td>' + EP.esc(d.book_name || d.original_filename || d.id.toString().slice(0, 8)) + "</td>" +
      "<td>" + EP.esc(d.kind || "—") + "</td>" +
      "<td>" + EP.esc(d.publisher || "—") + "</td>" +
      "<td>" + EP.esc(d.original_filename || "—") + "</td>" +
      "<td>" + (d.file_size_bytes ? EP.fmtMarks(d.file_size_bytes) + " B" : "—") + "</td>" +
      "<td>" + EP.fmtDate(d.created_at) + "</td></tr>";
  }).join("");
  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Source Document Registry</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a> <a class="btn btn-sm" href="#/admin/ingestion/upload">Register</a></div>' +
    '<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Kind</th><th>Publisher</th><th>File</th><th>Size</th><th>Created</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
});

// ===========================================================================
// Module-scope state for the answer-key matcher (survives route re-renders).
// AK_QUESTIONS caches the questions fetched from the database during key
// preview so the apply step uses the same server rows (no second-fetch drift).
let AK_PARSED = [];
let AK_QUESTIONS = [];

// OFFICIAL PYQ CENTER (coverage hub)
// ===========================================================================
// Build a 10-year coverage matrix strictly from live question data. Missing
// years are shown explicitly (never faked as "10 years complete"). Distinct
// official-source status labels are surfaced, never collapsed into one VERIFIED.
const PYQ_YEARS = (function () {
  const cur = new Date().getFullYear();
  const out = [];
  for (let i = 0; i < 10; i++) out.push(cur - i);
  return out;
})();

function pyqCheck(v) {
  if (v) return '<span class="pill ok">✓</span>';
  return '<span class="pill warn">✗</span>';
}
function pyqPct(num, den) {
  if (!den) return "0%";
  return Math.round((num / den) * 100) + "%";
}
function pyqSourceLabels(rows) {
  const labels = [];
  const official = rows.some((r) => r.source_authority === "OFFICIAL" || r.source_type === "OFFICIAL");
  const ak = rows.some((r) => r.has_answer);
  const verified = rows.some((r) => r.verification_status === "VERIFIED");
  const aiSol = rows.some((r) => r.solution_source === "AI" || r.solution_status === "AVAILABLE");
  const reviewed = rows.some((r) => r.verification_status === "EXPERT_VERIFIED");
  if (official) labels.push('<span class="pill ok">OFFICIAL SOURCE</span>');
  else if (rows.length) labels.push('<span class="pill warn">SECONDARY SOURCE</span>');
  if (ak) labels.push('<span class="pill ok">ANSWER KEY MATCHED</span>');
  if (aiSol) labels.push('<span class="pill">AI GENERATED SOLUTION</span>');
  if (reviewed) labels.push('<span class="pill ok">EXPERT REVIEWED</span>');
  if (verified) labels.push('<span class="pill ok">EXPERT VERIFIED</span>');
  return labels.length ? labels.join(" ") : '<span class="muted">no data</span>';
}

EP.register("/admin/official-pyq", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading official PYQ center…");
  const { data: exams, error } = await sb().from("exams").select("id,name,code").eq("is_active", true).order("name");
  if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }
  const list = exams || [];
  const cards = await Promise.all(list.map(async function (e) {
    const { data: qs } = await sb().from("questions")
      .select("id,year,verification_status,has_answer,has_solution,solution_status,solution_source,source_type,source_authority")
      .eq("is_deleted", false).eq("exam_id", e.id).eq("is_pyq", true);
    const rows = qs || [];
    const byYear = {};
    rows.forEach(function (r) {
      const y = r.year; if (!y) return;
      byYear[y] = byYear[y] || [];
      byYear[y].push(r);
    });
    const tot = rows.length;
    const totVerified = rows.filter((r) => r.verification_status === "VERIFIED").length;
    const totAns = rows.filter((r) => r.has_answer).length;
    const totSol = rows.filter((r) => r.has_solution).length;

    const matrixRows = PYQ_YEARS.map(function (y) {
      const yr = byYear[y] || [];
      const n = yr.length;
      const ans = yr.filter((r) => r.has_answer).length;
      const sol = yr.filter((r) => r.has_solution).length;
      const ver = yr.filter((r) => r.verification_status === "VERIFIED").length;
      return "<tr><td><b>" + y + "</b></td>" +
        "<td>" + (n ? pyqCheck(true) : pyqCheck(false)) + "</td>" +
        "<td>" + (n && ans === n ? pyqCheck(true) : (ans ? pyqCheck(false) : pyqCheck(false))) + "</td>" +
        "<td>" + n + "</td>" +
        "<td>" + ans + " (" + pyqPct(ans, n) + ")</td>" +
        "<td>" + sol + "</td>" +
        "<td>" + ver + " (" + pyqPct(ver, n) + ")</td>" +
        "<td>" + (n ? pyqSourceLabels(yr) : '<span class="muted">NOT AVAILABLE</span>') + "</td></tr>";
    }).join("");

    return '<section class="card"><h3>' + EP.esc(e.name) + '</h3>' +
      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="stat-v">' + tot + '</div><div class="stat-l">PYQ questions</div></div>' +
        '<div class="stat-card"><div class="stat-v">' + totVerified + '</div><div class="stat-l">Verified</div></div>' +
        '<div class="stat-card"><div class="stat-v">' + totAns + '</div><div class="stat-l">With answer</div></div>' +
        '<div class="stat-card"><div class="stat-v">' + totSol + '</div><div class="stat-l">With solution</div></div>' +
      "</div>" +
      "<h4>10-year coverage matrix (not claimed complete unless data exists)</h4>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr>' +
      "<th>Year</th><th>Q. Paper</th><th>Answer Key</th><th>Parsed</th><th>Answer Matched</th><th>Solutions</th><th>Verified</th><th>Source status</th>" +
      '</tr></thead><tbody>' + matrixRows + "</tbody></table></div>" +
      '<div class="btn-row"><a class="btn btn-sm" href="#/admin/ingestion/upload?kind=QUESTION_BOOK">Ingest PYQ</a></div>' +
      "</section>";
  }));
  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Official PYQ Center</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div>' +
    '<p class="muted">Coverage reflects questions explicitly flagged <b>is_pyq = true</b>. The matrix shows the latest 10 calendar years; ' +
    'years with no ingested questions are marked <b>NOT AVAILABLE</b> — we never claim "10 years complete" unless the evidence is present. ' +
    'Upload official NTA / NMC / JEE Advanced documents via the Ingestion Center; answers and solutions are ingested from their respective documents. ' +
    'Only questions whose source document is preserved and traceable are marked official — no fabricated "NTA verified" claims.</p>' +
    '<p class="hint"><b>Source status labels</b> (kept distinct, never collapsed): OFFICIAL SOURCE · OFFICIAL ANSWER KEY / ANSWER KEY MATCHED · ' +
    'EXPERT VERIFIED · AI GENERATED SOLUTION · EXPERT REVIEWED · SECONDARY SOURCE.</p>' +
    '<div class="grid-2">' + cards.join("") + "</div></div>";
});

// ===========================================================================
// ANSWER-KEY AUTO-MATCHING
// Pairs an uploaded answer key (per-question correct option) to a previously
// ingested question book (by source_document_id, in ingestion order), validates
// the option exists, and either fills the answer or routes mismatches to the
// conflict queue — never silently overwriting a verified answer.
// ===========================================================================
function akNormalizeAns(a) {
  a = (a == null ? "" : String(a)).trim().toUpperCase();
  if (/^[1-9]$/.test(a)) return String.fromCharCode(64 + parseInt(a, 10)); // 1 -> A
  return a; // A-D or raw option key
}
function akParseKey(text) {
  const trimmed = (text || "").trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map(function (x, i) {
        if (typeof x === "string") return { qno: null, ans: akNormalizeAns(x) };
        if (x && typeof x === "object") return { qno: x.q || x.qno || x.question || null, ans: akNormalizeAns(x.ans || x.answer || x.correct || "") };
        return { qno: null, ans: "" };
      });
    } catch (_) { /* fall through to line parsing */ }
  }
  const lines = trimmed.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].toLowerCase();
  const hasQ = /q\s*_?no|question|s\.?\s*no|sl\.?\s*no/i.test(header);
  const hasAns = /ans|key|correct/i.test(header);
  const start = (hasQ || hasAns) ? 1 : 0;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(/[,;\t]/).map(function (s) { return s.trim(); });
    const ans = parts[parts.length - 1];
    const qno = (hasQ && parts.length > 1) ? parts[0] : null;
    out.push({ qno: qno, ans: akNormalizeAns(ans) });
  }
  return out;
}
function akOptKeyFor(letter, options) {
  if (!options || !options.length || !/^[A-Z]$/.test(letter)) return null;
  const idx = letter.charCodeAt(0) - 65;
  if (idx < 0 || idx >= options.length) return null;
  const sorted = options.slice().sort(function (a, b) { return (a.display_order || 0) - (b.display_order || 0); });
  return sorted[idx] ? sorted[idx].option_key : null;
}
async function akMarkConflict(questionId) {
  await sb().from("questions").update({ pipeline_status: "CONFLICT" }).eq("id", questionId);
}

EP.register("/admin/ingestion/answerkey", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading answer-key matcher…");
  // Recent distinct import "source" tags are the reliable link to ingested
  // question batches (the live import RPC does not always populate
  // source_document_id, so we match by the source batch tag instead).
  const { data: srcs, error: srcErr } = await sb().from("questions")
    .select("source").eq("is_deleted", false).not("source", "is", null)
    .order("created_at", { ascending: false }).limit(100);
  const tags = Array.from(new Set((srcs || []).map((r) => r.source).filter(Boolean))).slice(0, 50);
  const opts = tags.map(function (t) { return '<option value="' + EP.esc(t) + '">' + EP.esc(t) + "</option>"; }).join("");

  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Answer-Key Auto-Matching</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div>' +
    '<section class="card"><p class="muted">Enter the import <b>source tag</b> of the ingested question book, upload its official answer key, preview the auto-matched mapping, then apply. ' +
    'Answers are matched in ingestion order. Mismatches or invalid options are routed to the conflict queue — verified answers are never silently overwritten.</p>' +
    '<div class="form-grid">' +
      '<div class="field"><label>Source tag (import batch)</label><input id="ak_source" class="input" list="ak_sources" placeholder="e.g. AKQ1690000000000"><datalist id="ak_sources">' + opts + "</datalist></div>" +
      '<div class="field"><label>Answer key file (CSV / TXT / JSON)</label><input id="ak_file" type="file" accept=".csv,.txt,.json,.jsonl"></div>' +
    "</div>" +
    '<div class="btn-row"><button class="btn btn-primary" id="ak_parse">Parse &amp; preview</button><span id="ak_status" class="muted"></span></div>' +
    '<p class="hint">CSV: <code>q_no,answer</code> or just one answer per line (<code>B</code>, <code>2</code>). TXT: one answer per line. JSON: array of strings or <code>[{q,ans}]</code>.</p>' +
    '<section class="card" id="ak_preview" style="display:none"><h3>Preview mapping (<span id="ak_cnt">0</span>)</h3>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Question</th><th>Key</th><th>Will set</th><th>Status</th></tr></thead><tbody id="ak_rows"></tbody></table></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="ak_apply">Apply matching</button><span id="ak_apply_status" class="muted"></span></div>' +
    "</section></div>";

  let parsed = [];
  let questions = [];

   EP.qs("#ak_parse").addEventListener("click", async function () {
     const file = EP.qs("#ak_file").files[0];
     const tag = (EP.qs("#ak_source").value || "").trim();
     if (!file) { EP.toast("Choose an answer-key file", "error"); return; }
     if (!tag) { EP.toast("Enter the source tag of the ingested book", "error"); return; }
     EP.qs("#ak_parse").disabled = true;
     EP.qs("#ak_status").textContent = "Parsing…";
     const text = await file.text();
     parsed = akParseKey(text);
     AK_PARSED = parsed;
     if (!parsed.length) {
       EP.qs("#ak_parse").disabled = false;
       EP.qs("#ak_status").textContent = "No answers detected in file.";
       EP.toast("No answers detected.", "error");
       return;
     }
     const { data: qs, error: qErr } = await sb().from("questions")
       .select("id, question_text, source, question_options(option_key, display_order, option_text), question_answers(correct_option_keys)")
       .eq("source", tag).eq("is_deleted", false)
       .order("created_at", { ascending: true }).order("id");
     if (qErr) { EP.qs("#ak_parse").disabled = false; EP.qs("#ak_status").textContent = qErr.message; return; }
     questions = qs || [];
     // Cache the fetched DB rows so the apply step matches against the exact
     // same questions the preview showed (in-memory cache of server data).
     AK_QUESTIONS = questions;
     const rows = [];
     const n = Math.max(parsed.length, questions.length);
     for (let i = 0; i < n; i++) {
       const k = parsed[i];
       const q = questions[i];
       let will = "—", st = "ok";
       if (!k) { will = "—"; st = "warn"; }
       else if (!q) { will = "no question"; st = "warn"; }
       else {
         const ok = akOptKeyFor(k.ans, q.question_options);
         if (!ok) { will = "INVALID (" + (k.ans || "?") + ")"; st = "bad"; }
         else {
           const existing = q.question_answers && q.question_answers.correct_option_keys ? q.question_answers.correct_option_keys : [];
           if (existing && existing.length) {
             will = existing.indexOf(ok) !== -1 ? "already " + ok : "CONFLICT vs " + existing.join(",");
             st = existing.indexOf(ok) !== -1 ? "ok" : "bad";
           } else { will = ok; st = "ok"; }
         }
       }
       rows.push("<tr><td>" + (i + 1) + "</td><td class='qtxt'>" + EP.esc((q ? (q.question_text || "").replace(/<[^>]+>/g, "").slice(0, 80) : "(none)")) + "</td>" +
         "<td>" + EP.esc(k ? (k.qno ? k.qno + "=" : "") + (k.ans || "") : "—") + "</td>" +
         "<td>" + EP.esc(will) + "</td>" +
         '<td><span class="badge b-' + (st === "ok" ? "ok" : st === "warn" ? "warn" : "bad") + '">' + EP.esc(st === "ok" ? "match" : st === "warn" ? "gap" : "conflict") + "</span></td></tr>");
     }
     EP.qs("#ak_cnt").textContent = n;
     EP.qs("#ak_rows").innerHTML = rows.join("");
     EP.qs("#ak_preview").style.display = "";
     EP.qs("#ak_parse").disabled = false;
     EP.qs("#ak_status").textContent = "Parsed " + parsed.length + " keys against " + questions.length + " questions (src=" + tag.slice(0, 24) + ").";
   });

  EP.qs("#ak_apply").addEventListener("click", async function () {
    try {
    const parsed = AK_PARSED;
    const questions = AK_QUESTIONS;
    if (!parsed.length || !questions.length) { EP.qs("#ak_apply_status").textContent = "Nothing to apply (parsed=" + parsed.length + ", questions=" + questions.length + ")."; return; }
    EP.qs("#ak_apply").disabled = true;
    let setCount = 0, already = 0, conflict = 0;
    const conflicts = [];
    for (let i = 0; i < parsed.length; i++) {
      const k = parsed[i];
      const q = questions[i];
      if (!k || !q) continue;
      const ok = akOptKeyFor(k.ans, q.question_options);
      if (!ok) { conflict++; conflicts.push((i + 1) + ": invalid option " + (k.ans || "?")); await akMarkConflict(q.id); continue; }
      const existing = q.question_answers && q.question_answers.correct_option_keys ? q.question_answers.correct_option_keys : [];
      if (existing.length) {
        if (existing.length === 1 && existing[0] === ok) already++;
        else { conflict++; conflicts.push((i + 1) + ": answer mismatch (existing " + existing.join(",") + " vs key " + k.ans + ")"); await akMarkConflict(q.id); }
        continue;
      }
      const { error: uErr } = await sb().from("question_answers").update({
        correct_option_keys: [ok], answer_type: "MCQ", source: "ANSWER_KEY_IMPORT",
        verification_status: "PENDING_REVIEW", confidence: 95,
      }).eq("question_id", q.id);
      if (uErr) { conflict++; conflicts.push((i + 1) + ": " + uErr.message); }
      else setCount++;
    }
    EP.qs("#ak_apply").disabled = false;
    const msg = "Matched: set " + setCount + ", already correct " + already + ", conflicts " + conflict + ".";
    EP.qs("#ak_apply_status").textContent = msg + (conflicts.length ? " Conflicts: " + conflicts.slice(0, 5).join(" | ") : "");
    EP.toast(msg, conflict && setCount === 0 ? "error" : "success");
    } catch (e) {
      EP.qs("#ak_apply").disabled = false;
      EP.qs("#ak_apply_status").textContent = "Error: " + (e && e.message ? e.message : e);
    }
  });
});

