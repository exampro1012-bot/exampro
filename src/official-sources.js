// =============================================================================
// ExamPro — Official Source Registry + Discovery Agent (Super Admin)
//
// Backed by `official_source_domains` + `source_crawler_log` (migration 0040).
// The UI degrades gracefully: if the migration has not yet been applied it
// shows the canonical official domains from the spec as a read-only reference
// plus an explicit "apply migration" notice, and disables writes. It NEVER
// fabricates crawl results — without backend crawler infra, "Run Discovery"
// only records a respectful, honest check entry (no downloads, no hammering).
// =============================================================================
import * as Ingest from "./ingestion-engine.js";

const EP = window.EP;
const sb = () => EP.getClient();

function allowed() { return EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"]); }
function deny(main) {
  main.innerHTML = '<div class="page"><div class="empty error">Super Admin access required.</div></div>';
}

// Route metadata so the shell guard (EP.canAccess) rejects non-admins up front;
// defense-in-depth alongside the handler-level allowed()/deny() checks below.
["/admin/sources", "/admin/sources/discovery"].forEach(function (p) {
  EP.routeMeta[p] = { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] };
});
function isMissingTable(e) {
  if (!e) return false;
  const m = (e.message || "").toLowerCase();
  const c = (e.code || "").toUpperCase();
  return c === "42P01" || c === "PGRST205" || c === "PGRST200" ||
    /relation .* does not exist/.test(m) ||
    /does not exist/.test(m) ||
    /could not find .* relationship/.test(m) ||
    /could not find the table/.test(m) ||
    /schema cache/.test(m) ||
    /relationship in the api schema/.test(m) ||
    /not found/.test(m);
}

// Canonical official domains per the ingestion spec (read-only reference).
const CANONICAL = [
  { domain: "nta.ac.in",          exam: "JEE_MAIN",     authority: "OFFICIAL" },
  { domain: "jeemain.nta.nic.in", exam: "JEE_MAIN",     authority: "OFFICIAL" },
  { domain: "neet.nta.nic.in",    exam: "NEET",         authority: "OFFICIAL" },
  { domain: "jeeadv.ac.in",       exam: "JEE_ADVANCED", authority: "OFFICIAL" },
  { domain: "nmc.org.in",         exam: "NEET",         authority: "OFFICIAL" },
];

function authLabel(a) {
  return a === "OFFICIAL"
    ? '<span class="pill ok">OFFICIAL</span>'
    : '<span class="pill warn">SECONDARY</span>';
}

// -----------------------------------------------------------------------------
// Official Source Registry  (/admin/sources)
// -----------------------------------------------------------------------------
EP.register("/admin/sources", async function (main) {
  
  
  if (!allowed()) { return deny(main); }
  
  main.innerHTML = EP.spinner("Loading Official Source Registry…");

  const examOpts = ["JEE_MAIN", "JEE_ADVANCED", "NEET", "CUET", "MHT_CET", "WBJEE", "GUJCET", "KCET", "COMEDK", "TS_EAMCET", "AP_EAMCET"]
    .map((e) => '<option value="' + e + '">' + e + "</option>").join("");

  const { data, error } = await sb().from("official_source_domains")
    .select("*").order("exam").order("domain");

  if (isMissingTable(error)) {
    
    // Migration not applied yet: show the canonical reference list, read-only.
    const rows = CANONICAL.map((c) =>
      "<tr><td>" + EP.esc(c.domain) + "</td><td>" + EP.esc(c.exam) + "</td><td>" + authLabel(c.authority) +
      '</td><td><span class="pill ok">allowed</span></td><td>—</td><td>—</td></tr>'
    ).join("");
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Official Source Registry</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div>' +
      '<div class="empty warn">The <code>official_source_domains</code> table is not present in this database. ' +
      'Apply <code>migrations/0040_official_source_registry.sql</code> to enable adding/editing domains. ' +
      'Showing the canonical official domains from the ingestion spec (read-only):</div>' +
      '<section class="card"><div class="table-wrap"><table class="data-table"><thead><tr>' +
      "<th>Domain</th><th>Exam</th><th>Authority</th><th>Allowed</th><th>Last checked</th><th>Policy</th>" +
      '</tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div class="btn-row"><a class="btn btn-sm" href="#/admin/sources/discovery">Discovery config</a></div></section></div>';
    return;
  }
  if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }

  const rows = (data || []).map((r) =>
    "<tr><td>" + EP.esc(r.domain) + "</td><td>" + EP.esc(r.exam) + "</td><td>" + authLabel(r.authority) +
    '</td><td>' + (r.allowed ? '<span class="pill ok">allowed</span>' : '<span class="pill warn">blocked</span>') +
    "</td><td>" + (r.last_checked ? EP.esc(String(r.last_checked)) : "—") + "</td><td>" + EP.esc(r.crawl_policy || "—") +
    '</td><td><button class="btn btn-sm" data-del="' + r.id + '">Remove</button></td></tr>'
  ).join("") || '<tr><td colspan="7" class="muted">No domains configured yet.</td></tr>';

  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Official Source Registry</h2><a class="btn btn-sm" href="#/admin/ingestion">Back</a></div>' +
    '<p class="muted">Only domains listed here may be visited by the Official Source Discovery Agent. ' +
    'Coaching sites must never be marked <b>OFFICIAL</b>. Removing a domain blocks future crawling of it.</p>' +
    '<section class="card"><h3>Allowed domains</h3><div class="table-wrap"><table class="data-table"><thead><tr>' +
    "<th>Domain</th><th>Exam</th><th>Authority</th><th>Allowed</th><th>Last checked</th><th>Policy</th><th></th>" +
    '</tr></thead><tbody>' + rows + "</tbody></table></div></section>" +
    '<section class="card"><h3>Add domain</h3><div class="form-grid">' +
      '<div class="field"><label>Domain</label><input id="os_domain" class="input" placeholder="e.g. jeemain.nta.nic.in"></div>' +
      '<div class="field"><label>Exam</label><select id="os_exam" class="input">' + examOpts + "</select></div>" +
      '<div class="field"><label>Authority</label><select id="os_auth" class="input"><option value="OFFICIAL">OFFICIAL</option><option value="SECONDARY">SECONDARY</option></select></div>' +
      '<div class="field"><label>Crawl policy</label><select id="os_policy" class="input"><option value="RESPECTFUL">RESPECTFUL</option><option value="ARCHIVE_ONLY">ARCHIVE_ONLY</option><option value="DISABLED">DISABLED</option></select></div>' +
    "</div>" +
    '<div class="btn-row"><button class="btn btn-primary" id="os_add">Add domain</button><span id="os_status" class="muted"></span></div></section>' +
    '<div class="btn-row"><a class="btn btn-sm" href="#/admin/sources/discovery">Discovery config &amp; logs</a> <a class="btn btn-sm" href="#/admin/syllabus">Syllabus versions</a></div></div>';

  (main.querySelectorAll("[data-del]") || []).forEach(function (b) {
    b.addEventListener("click", async function () {
      const { error: de } = await sb().from("official_source_domains").delete().eq("id", b.getAttribute("data-del"));
      if (de) EP.toast(de.message, "error"); else { EP.toast("Domain removed", "ok"); EP.navigate("/admin/sources"); }
    });
  });

  EP.qs("#os_add").addEventListener("click", async function () {
    const domain = (EP.qs("#os_domain").value || "").trim().toLowerCase();
    const exam = EP.qs("#os_exam").value;
    const authority = EP.qs("#os_auth").value;
    const crawl_policy = EP.qs("#os_policy").value;
    if (!domain) { EP.toast("Enter a domain", "error"); return; }
    EP.qs("#os_status").textContent = "Saving…";
    const { error: ie } = await sb().from("official_source_domains").insert({
      domain, exam, authority, crawl_policy, allowed: true
    });
    if (ie) { EP.qs("#os_status").textContent = ie.message; EP.toast(ie.message, "error"); return; }
    EP.toast("Domain added", "ok"); EP.navigate("/admin/sources");
  });
});

// -----------------------------------------------------------------------------
// Official Source Discovery config + crawler log  (/admin/sources/discovery)
// -----------------------------------------------------------------------------
EP.register("/admin/sources/discovery", async function (main) {
  if (!allowed()) return deny(main);
  main.innerHTML = EP.spinner("Loading discovery config…");

  const { data: domains, error } = await sb().from("official_source_domains")
    .select("*").eq("allowed", true).order("exam").order("domain");

  if (isMissingTable(error)) {
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Official Source Discovery</h2><a class="btn btn-sm" href="#/admin/sources">Back</a></div>' +
      '<div class="empty warn">Apply <code>migrations/0040_official_source_registry.sql</code> to enable the discovery agent and crawler log.</div>' +
      '<section class="card"><h3>Canonical official sources (read-only)</h3>' +
      '<div class="pill-row">' + CANONICAL.map((c) => '<span class="pill">' + EP.esc(c.domain) + " · " + EP.esc(c.exam) + "</span>").join(" ") + "</div>" +
      '<p class="hint">The live Official Source Discovery Agent requires backend crawler infrastructure (server-side, rate-limited, ' +
      'respecting robots/ETag/Last-Modified, never bypassing CAPTCHA/login/paywall). This environment does not host that backend, ' +
      'so no documents are auto-downloaded. Upload official documents manually via the Ingestion Center.</p></section></div>';
    return;
  }
  if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }

  const list = domains || [];
  const domainRows = list.length
    ? list.map((d) => '<tr><td>' + EP.esc(d.domain) + "</td><td>" + EP.esc(d.exam) + "</td><td>" + authLabel(d.authority) +
        '</td><td>' + EP.esc(d.crawl_policy) + "</td><td>" + (d.last_checked ? EP.esc(String(d.last_checked)) : "never") + "</td></tr>").join("")
    : '<tr><td colspan="5" class="muted">No allowed domains. Add them in the registry.</td></tr>';

  const { data: logs } = await sb().from("source_crawler_log")
    .select("*").order("checked_at", { ascending: false }).limit(25);
  const logRows = (logs || []).map((l) =>
    "<tr><td>" + (l.checked_at ? EP.esc(String(l.checked_at)) : "—") + "</td><td>" + EP.esc(l.domain || "—") +
    "</td><td>" + EP.esc(l.url || "—") + "</td><td>" + (l.http_status || "—") +
    '</td><td>' + EP.esc(l.download_status || "—") + "</td><td>" + (l.error ? EP.esc(l.error) : "—") + "</td></tr>"
  ).join("") || '<tr><td colspan="6" class="muted">No discovery runs recorded yet.</td></tr>';

  main.innerHTML =
    '<div class="page"><div class="page-head"><h2>Official Source Discovery</h2><a class="btn btn-sm" href="#/admin/sources">Back</a></div>' +
    '<div class="empty warn">This environment has <b>no backend crawler</b>. "Run respectful check" records an honest, ' +
    'rate-limited discovery entry (no downloads, no CAPTCHA/login bypass, no hammering). Real document ingestion is done ' +
    'manually through the Ingestion Center with preserved source documents.</div>' +
    '<section class="card"><h3>Allowed discovery domains</h3><div class="table-wrap"><table class="data-table"><thead><tr>' +
    "<th>Domain</th><th>Exam</th><th>Authority</th><th>Policy</th><th>Last checked</th></tr></thead><tbody>" + domainRows + "</tbody></table></div>" +
    '<div class="btn-row"><button class="btn btn-primary" id="os_run">Run respectful check</button><span id="os_run_status" class="muted"></span></div></section>' +
    '<section class="card"><h3>Crawler log</h3><div class="table-wrap"><table class="data-table"><thead><tr>' +
    "<th>Checked</th><th>Domain</th><th>URL</th><th>HTTP</th><th>Download</th><th>Error</th></tr></thead><tbody>" + logRows + "</tbody></table></div></section></div>";

  EP.qs("#os_run").addEventListener("click", async function () {
    EP.qs("#os_run").disabled = true;
    EP.qs("#os_run_status").textContent = "Recording respectful checks…";
    let ok = 0, fail = 0;
    for (const d of list) {
      try {
        await sb().from("official_source_domains").update({ last_checked: new Date().toISOString() }).eq("id", d.id);
        await sb().from("source_crawler_log").insert({
          domain_id: d.id, domain: d.domain, url: "https://" + d.domain + "/",
          http_status: null, document_found: false, download_status: "NOT_ATTEMPTED",
          parse_status: "PENDING_BACKEND", error: "No backend crawler in this environment"
        });
        ok++;
      } catch (_) { fail++; }
    }
    EP.qs("#os_run_status").textContent = "Recorded " + ok + " check(s)" + (fail ? ", " + fail + " failed" : "") + ".";
    EP.toast("Discovery check recorded", "ok");
    EP.navigate("/admin/sources/discovery");
  });
});
