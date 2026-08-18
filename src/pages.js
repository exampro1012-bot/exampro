/* ExamPro — application pages (all data via Supabase; RLS enforced server-side). */
(function () {
  const EP = window.EP;
  const sb = function () { return EP.getClient(); };
  const PAGE = 12;

  // ===========================================================================
  // DASHBOARD (role-aware)
  // ===========================================================================
  EP.register("/dashboard", async function (main) {
    const s = EP.state;
    main.innerHTML = EP.spinner("Loading dashboard…");
    const type = EP.roleType();

    if (type === "super") {
      let h;
      let dbOk = false;
      try {
        const { data } = await sb().rpc("app_system_health");
        h = data || {};
        dbOk = !!data && typeof data === "object";
      } catch (e) { EP.toast("Failed to load system health: " + (e.message || "unknown"), "error"); h = {}; }
      const tiles = [
        { t: "Tenants", v: h.tenants, p: "/admin", ic: "🏛" },
        { t: "Users", v: h.auth_users, p: "/admin", ic: "👥" },
        { t: "Questions", v: h.questions, p: "/questions", ic: "❓" },
        { t: "Papers", v: h.papers, p: "/papers", ic: "📄" },
        { t: "DPPs", v: h.dpps, p: "/dpp", ic: "🗓" },
        { t: "Results", v: h.results, p: "/results", ic: "📊" },
      ];
      const cards = tiles.map(function (x) {
        return '<a class="stat-card" href="#' + x.p + '"><div class="stat-ic">' + x.ic + '</div><div class="stat-v">' + EP.fmtMarks(x.v || 0) + '</div><div class="stat-l">' + x.t + "</div></a>";
      }).join("");
      const storage = (h.storage_objects || 0) + " objects";
      main.innerHTML =
        '<div class="page"><div class="page-head"><h2>Platform overview</h2><span class="pill">Super Admin</span></div>' +
        '<div class="stat-grid">' + cards + "</div>" +
        '<div class="grid-2">' +
          '<section class="card"><h3>System status</h3><ul class="simple-list">' +
            '<li><span>Database check</span><span class="badge ' + (dbOk ? "b-ok" : "b-bad") + '">' + (dbOk ? "Reachable" : "Unreachable") + "</span></li>" +
            "<li><span>Storage</span><span class=\"muted\">" + EP.esc(storage) + "</span></li>" +
            '<li><span>Audit log entries</span><span class="muted">' + EP.fmtMarks(h.audit_logs || 0) + "</span></li>" +
          "</ul></section>" +
          '<section class="card"><h3>Super admin tools</h3><div class="btn-row">' +
            '<a class="btn btn-primary" href="#/admin">Admin console</a>' +
            '<a class="btn btn-ghost" href="#/admin/data-quality">Data quality</a>' +
            '<a class="btn btn-ghost" href="#/admin/usage">Usage &amp; plans</a>' +
            '<a class="btn btn-ghost" href="#/admin/audit">Audit log</a>' +
            '<a class="btn btn-ghost" href="#/admin/system-health">System health</a>' +
          "</div></section>" +
        "</div></div>";
      return;
    }

    if (type === "student") {
      const uid = s.user.id;

      // ---- PARENT: dedicated ward dashboard (server-authorized via RPC) ----
      if (s.role === "PARENT" && !EP.hasRole(["TEACHER", "SUBJECT_TEACHER", "INSTITUTION_ADMIN", "ACADEMIC_ADMIN", "PLATFORM_ADMIN", "SUPER_ADMIN", "PAPER_SETTER", "REVIEWER", "DATA_OPERATOR"])) {
        main.innerHTML = EP.spinner("Loading ward overview…");
        let d = null, rpcErr = null;
        try {
          const { data, error } = await sb().rpc("app_parent_dashboard");
          if (error) rpcErr = error.message;
          else d = data || {};
        } catch (e) { rpcErr = e.message || "unknown"; }
        if (rpcErr) {
          main.innerHTML = '<div class="page"><div class="page-head"><h2>Parent dashboard</h2><span class="pill">Parent</span></div>' +
            '<div class="empty error">Ward data is unavailable: ' + EP.esc(rpcErr) +
            '<br><span class="muted">If this persists, migration <code>0043</code> may not be applied to the database yet.</span></div></div>';
          return;
        }
        if (!d || d.linked === false) {
          main.innerHTML = '<div class="page"><div class="page-head"><h2>Parent dashboard</h2><span class="pill">Parent</span></div>' +
            '<div class="empty">Your account is not linked to a student yet.<br>' +
            '<span class="muted">Ask your institution administrator to link your email to your ward under <b>Institution → Parent links</b>.</span></div></div>';
          return;
        }
        const ward = d.ward || {};
        const results = Array.isArray(d.results) ? d.results : [];
        const weak = Array.isArray(d.weak_topics) ? d.weak_topics : [];
        const assignments = Array.isArray(d.assignments) ? d.assignments : [];
        const sessions = Array.isArray(d.sessions) ? d.sessions : [];
        const dpps = Array.isArray(d.dpps) ? d.dpps : [];
        const avgPct = results.length
          ? Math.round(results.reduce(function (a, r) { return a + Number(r.percentage || 0); }, 0) / results.length)
          : null;
        const tiles = [
          { t: "Ward results", v: results.length, p: "/results", ic: "📊" },
          { t: "Average score", v: avgPct == null ? "—" : avgPct + "%", p: "/results", ic: "🎯" },
          { t: "Upcoming assignments", v: assignments.length, p: "/assignments", ic: "📌" },
          { t: "Recent tests", v: sessions.length, p: "/exam-tracker", ic: "✍" },
        ].map(function (x) {
          return '<a class="stat-card" href="#' + x.p + '"><div class="stat-ic">' + x.ic + '</div><div class="stat-v">' + EP.fmtMarks(x.v) + '</div><div class="stat-l">' + x.t + "</div></a>";
        }).join("");
        const resList = results.length
          ? results.map(function (r) {
              return '<li><span>' + EP.esc(r.paper_title || "Exam") + '</span><span class="muted">' + EP.fmtMarks(r.marks) + " / " + EP.fmtMarks(r.total_marks) +
                ' <span class="badge ' + (Number(r.percentage) >= 50 ? "b-ok" : "b-warn") + '">' + EP.fmtMarks(r.percentage) + "%</span></span></li>";
            }).join("")
          : '<li class="muted">No results yet.</li>';
        const weakList = weak.length
          ? weak.map(function (t) {
              return '<li><span>' + EP.esc(t.topic_name || "—") + ' <span class="muted">(' + (t.attempts || 0) + ' attempts)</span></span>' +
                '<span class="badge ' + (Number(t.accuracy) >= 50 ? "b-ok" : "b-warn") + '">' + EP.fmtMarks(t.accuracy) + "%</span></li>";
            }).join("")
          : '<li class="muted">No weak-topic data yet — the ward needs more practice activity.</li>';
        const asgList = assignments.length
          ? assignments.map(function (a) {
              return '<li><span>' + EP.esc(a.paper_title || "Assignment") + '</span><span class="muted">Due ' + EP.fmtDate(a.due_at) + "</span></li>";
            }).join("")
          : '<li class="muted">No upcoming assignments.</li>';
        main.innerHTML =
          '<div class="page"><div class="page-head"><h2>Ward overview — ' + EP.esc(ward.name || "Student") + "</h2>" +
          '<span class="pill">Parent</span></div>' +
          '<div class="stat-grid">' + tiles + "</div>" +
          '<section class="card"><h3>Ward</h3><ul class="simple-list">' +
          "<li><span>Name</span><span>" + EP.esc(ward.name || "—") + "</span></li>" +
          "<li><span>Roll number</span><span>" + EP.esc(ward.roll_number || "—") + "</span></li>" +
          "<li><span>Class</span><span>" + EP.esc(ward.class_level || "—") + "</span></li>" +
          "<li><span>Recent practice sets (DPP)</span><span>" + dpps.length + "</span></li>" +
          "</ul></section>" +
          '<div class="grid-2">' +
          '<section class="card"><h3>Recent results</h3><ul class="simple-list">' + resList + "</ul></section>" +
          '<section class="card"><h3>Weak topics</h3><ul class="simple-list">' + weakList + "</ul></section>" +
          "</div>" +
          '<section class="card"><h3>Upcoming assignments</h3><ul class="simple-list">' + asgList + "</ul></section>" +
          "</div>";
        return;
      }

      const [sess, res, dpp, pra, logs] = await Promise.all([
        sb().from("exam_sessions").select("*", { count: "exact", head: true }).eq("student_id", uid),
        sb().from("results").select("*", { count: "exact", head: true }).eq("student_id", uid),
        sb().from("dpps").select("*", { count: "exact", head: true }),
        sb().from("practice_logs").select("*", { count: "exact", head: true }).eq("user_id", uid),
        sb().from("practice_logs").select("created_at, correct").eq("user_id", uid).order("created_at", { ascending: false }).limit(500),
      ]);
      // Study streak + accuracy from real practice history
      const practiceRows = logs.data || [];
      const daySet = {};
      practiceRows.forEach(function (l) {
        if (l && l.created_at) daySet[String(l.created_at).slice(0, 10)] = true;
      });
      let streak = 0;
      (function () {
        const d0 = new Date();
        // allow the streak to be "alive" if today has no practice yet but yesterday does
        if (!daySet[d0.toISOString().slice(0, 10)]) d0.setDate(d0.getDate() - 1);
        for (let d = new Date(d0); ; d.setDate(d.getDate() - 1)) {
          const key = d.toISOString().slice(0, 10);
          if (daySet[key]) streak++;
          else break;
        }
      })();
      const attempts = practiceRows.length;
      const accuracy = attempts ? Math.round(practiceRows.filter(function (l) { return l.correct; }).length * 100 / attempts) : null;
      let weak = "";
      try {
        const { data } = await sb().rpc("app_my_weak_topics", { p_limit: 5 });
        if (data && data.length) {
          weak = '<section class="card"><h3>Weak topics — focus here</h3><ul class="simple-list">' +
            data.map(function (t) {
              return '<li><span>' + EP.esc(t.topic_name || "—") + ' <span class="muted">(' + (t.attempts || 0) + " attempts)</span></span>" +
                '<span class="badge ' + (Number(t.accuracy) >= 50 ? "b-ok" : "b-warn") + '">' + EP.fmtMarks(t.accuracy) + "%</span></li>";
            }).join("") + "</ul></section>";
        }
      } catch (e) { EP.toast("Failed to load insights: " + (e.message || "unknown"), "error"); }
      const cards = [
        { t: "My exams", v: sess.count || 0, p: "/exams", ic: "✍" },
        { t: "Results", v: res.count || 0, p: "/results", ic: "📊" },
        { t: "DPPs", v: dpp.count || 0, p: "/dpp", ic: "🗓" },
        { t: "Practice sessions", v: pra.count || 0, p: "/practice", ic: "🎯" },
        { t: "Accuracy", v: accuracy == null ? "—" : accuracy + "%", p: "/analytics", ic: "◎" },
        { t: "Day streak", v: streak, p: "/practice", ic: "🔥" },
      ].map(function (x) {
        return '<a class="stat-card" href="#' + x.p + '"><div class="stat-ic">' + x.ic + '</div><div class="stat-v">' + EP.fmtMarks(x.v) + '</div><div class="stat-l">' + x.t + "</div></a>";
      }).join("");
      main.innerHTML =
        '<div class="page"><div class="page-head"><h2>Welcome back, ' + EP.esc((s.profile && s.profile.full_name) || s.user.email) + "</h2>" +
        '<span class="pill">Student</span></div>' +
        '<div class="stat-grid">' + cards + "</div>" +
        '<div class="grid-2">' +
          '<section class="card"><h3>Quick start</h3><div class="btn-row">' +
            '<a class="btn btn-primary" href="#/practice">Practice now</a>' +
            '<a class="btn btn-ghost" href="#/exams">Take exam</a>' +
            '<a class="btn btn-ghost" href="#/results">My results</a>' +
            '<a class="btn btn-ghost" href="#/bookmarks">Bookmarks</a>' +
            '<a class="btn btn-ghost" href="#/mistakes">Mistakes</a>' +
          "</div></section>" +
          '<section class="card"><h3>Recent activity</h3><div id="stu_recent">' + EP.spinner("Loading…") + "</div></section>" +
        "</div>" + (weak || "") + "</div>";
      const { data: recent } = await sb().from("results").select("id,marks,total_marks,correct,incorrect,unanswered,created_at,papers(title)")
        .eq("student_id", uid).order("created_at", { ascending: false }).limit(5);
      const rh = (recent && recent.length)
        ? recent.map(function (r) {
            return '<li><a href="#/results/session/' + r.id + '">' + EP.esc((r.papers && r.papers.title) || "Exam") + '</a><span class="muted">' + EP.fmtMarks(r.marks) + " / " + EP.fmtMarks(r.total_marks) + "</span></li>";
          }).join("")
        : '<li class="muted">No results yet — take your first exam!</li>';
      const rEl = EP.qs("#stu_recent"); if (rEl) rEl.innerHTML = '<ul class="simple-list">' + rh + "</ul>";
      return;
    }

    if (type === "finance") {
      const [leads, orders, inv] = await Promise.all([
        sb().from("leads").select("*", { count: "exact", head: true }),
        sb().from("sales_orders").select("*", { count: "exact", head: true }),
        sb().from("invoices").select("*", { count: "exact", head: true }),
      ]);
      const cards = [
        { t: "Leads", v: leads.count || 0, p: "/finance/leads", ic: "🧲" },
        { t: "Sales orders", v: orders.count || 0, p: "/finance/sales", ic: "💰" },
        { t: "Invoices", v: inv.count || 0, p: "/finance/invoices", ic: "🧾" },
      ].map(function (x) {
        return '<a class="stat-card" href="#' + x.p + '"><div class="stat-ic">' + x.ic + '</div><div class="stat-v">' + EP.fmtMarks(x.v) + '</div><div class="stat-l">' + x.t + "</div></a>";
      }).join("");
      main.innerHTML =
        '<div class="page"><div class="page-head"><h2>Finance overview</h2><span class="pill">' + EP.esc(s.role || "Finance") + "</span></div>" +
        '<div class="stat-grid">' + cards + "</div>" +
        '<section class="card"><h3>Quick actions</h3><div class="btn-row">' +
          '<a class="btn btn-primary" href="#/finance/leads">Manage leads</a>' +
          '<a class="btn btn-ghost" href="#/finance/sales">Record sale</a>' +
          '<a class="btn btn-ghost" href="#/reports">Reports</a>' +
        "</div></section></div>";
      return;
    }

    // staff (teacher / institution admin / academic admin / paper setter / reviewer / data operator)
    let pending = 0;
    try {
      const { count } = await sb().from("questions").select("*", { count: "exact", head: true })
        .eq("verification_status", "PENDING_REVIEW").eq("is_deleted", false);
      pending = count || 0;
    } catch (e) { EP.toast("Failed to load pending count: " + (e.message || "unknown"), "error"); }
    const counts = await Promise.all([
      sb().from("questions").select("*", { count: "exact", head: true }).eq("is_deleted", false),
      sb().from("papers").select("*", { count: "exact", head: true }),
      sb().from("results").select("*", { count: "exact", head: true }),
      sb().from("dpps").select("*", { count: "exact", head: true }),
    ]);
    const c = counts.map(function (r) { return r.count || 0; });
    const tiles = [
      { t: "Questions", v: c[0], p: "/questions", ic: "❓" },
      { t: "Papers", v: c[1], p: "/papers", ic: "📄" },
      { t: "DPPs", v: c[3], p: "/dpp", ic: "🗓" },
      { t: "Results", v: c[2], p: "/results", ic: "📊" },
    ];
    const cards = tiles.map(function (x) {
      return '<a class="stat-card" href="#' + x.p + '"><div class="stat-ic">' + x.ic + '</div><div class="stat-v">' + EP.fmtMarks(x.v) + '</div><div class="stat-l">' + x.t + "</div></a>";
    }).join("");

    const recent = await sb().from("papers").select("id,title,created_at,total_questions").order("created_at", { ascending: false }).limit(5);
    const recentHtml = (recent.data && recent.data.length)
      ? recent.data.map(function (p) {
          return '<li><a href="#/papers/' + p.id + '">' + EP.esc(p.title) + '</a><span class="muted">' + (p.total_questions || 0) + " Qs</span></li>";
        }).join("")
      : '<li class="muted">No papers yet</li>';

    const welcome = s.role || "User";
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Welcome, ' + EP.esc((s.profile && s.profile.full_name) || s.user.email) + "</h2>" +
      '<span class="pill">' + EP.esc(welcome) + "</span></div>" +
      '<div class="stat-grid">' + cards + "</div>" +
      '<div class="grid-2">' +
        '<section class="card"><h3>Recent papers</h3><ul class="simple-list">' + recentHtml + "</ul></section>" +
        '<section class="card"><h3>Quick actions</h3><div class="btn-row">' +
          (EP.can("questions.create") ? '<a class="btn btn-primary" href="#/questions/new">Add question</a>' : "") +
          (EP.can("papers.generate") ? '<a class="btn btn-primary" href="#/papers/new">Generate paper</a>' : "") +
          (EP.can("dpp.generate") ? '<a class="btn btn-primary" href="#/dpp/new">Generate DPP</a>' : "") +
          '<a class="btn btn-ghost" href="#/exams">Take / assign exam</a>' +
        "</div>" +
        (EP.can("questions.review")
          ? '<p class="hint">' + (pending ? '<a href="#/questions?status=PENDING_REVIEW">' + pending + " question(s) pending review</a>" : "No questions pending review") + "</p>"
          : "") +
        "</section>" +
      "</div></div>";
  });

  // ===========================================================================
  // NOTIFICATIONS INBOX
  // ===========================================================================
  EP.register("/notifications", async function (main) {
    main.innerHTML = EP.spinner("Loading notifications…");
    const { data, error } = await sb().from("notifications")
      .select("id,type,title,body,link,is_read,created_at")
      .eq("recipient_user_id", EP.state.user.id)
      .order("created_at", { ascending: false }).limit(100);
    if (error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(error.message) + "</div></div>"; return; }
    const visible = (data || []).filter(function (n) { return EP.notifTypeEnabled(n.type); });
    if (!visible.length) {
      main.innerHTML = '<div class="page"><div class="page-head"><h2>Notifications</h2></div><div class="empty">You have no notifications yet.</div></div>';
      return;
    }
    const rows = visible.map(function (n) {
      const link = n.link ? '<a class="btn btn-sm" href="#' + EP.esc(n.link) + '">Open</a>' : "";
      return '<div class="card' + (n.is_read ? "" : " notif-unread") + '">' +
        '<div class="row-between"><strong>' + EP.esc(n.title) + "</strong><span class=\"muted\">" + EP.esc(EP.fmtDate(n.created_at)) + "</span></div>" +
        (n.body ? "<p class=\"muted\">" + EP.esc(n.body) + "</p>" : "") +
        '<div class="btn-row">' + link +
          (n.is_read ? "" : '<button class="btn btn-sm" data-mark="' + n.id + '">Mark read</button>') +
        "</div></div>";
    }).join("");
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Notifications</h2>' +
      '<button class="btn btn-sm" id="notif_mark_all">Mark all read</button></div>' + rows + "</div>";
    EP.qs("#notif_mark_all").addEventListener("click", async function () {
      await sb().from("notifications").update({ is_read: true }).eq("recipient_user_id", EP.state.user.id).eq("is_read", false);
      EP.render();
    });
    EP.qsa("[data-mark]").forEach(function (b) {
      b.addEventListener("click", async function () {
        await sb().from("notifications").update({ is_read: true }).eq("id", b.getAttribute("data-mark"));
        EP.render();
      });
    });
  });

  // ===========================================================================
  // QUESTION BANK — list + search + filter (server-side)
  // ===========================================================================
  let qbFilters = { q: "", subject_id: "", chapter_id: "", topic_id: "", difficulty: "", year: "", question_type_id: "", page: 1, status: "", ncert: "", exam_id: "", session: "", shift: "" };

  function parseQuery() {
    const h = window.location.hash || "";
    const qs = h.split("?")[1] || "";
    const params = new URLSearchParams(qs);
    if (params.get("status")) qbFilters.status = params.get("status");
    if (params.get("q")) qbFilters.q = params.get("q");
    if (params.get("subject_id")) qbFilters.subject_id = params.get("subject_id");
    if (params.get("chapter_id")) qbFilters.chapter_id = params.get("chapter_id");
    if (params.get("topic_id")) qbFilters.topic_id = params.get("topic_id");
    if (params.get("difficulty")) qbFilters.difficulty = params.get("difficulty");
    if (params.get("year")) qbFilters.year = params.get("year");
    if (params.get("question_type_id")) qbFilters.question_type_id = params.get("question_type_id");
    if (params.get("ncert")) qbFilters.ncert = params.get("ncert");
    if (params.get("exam_id")) qbFilters.exam_id = params.get("exam_id");
    if (params.get("session")) qbFilters.session = params.get("session");
    if (params.get("shift")) qbFilters.shift = params.get("shift");
  }

  async function loadSubjects() {
    const { data } = await sb().from("subjects").select("id,name,exam_id").order("name");
    return data || [];
  }
  async function loadChapters(subjectId) {
    if (!subjectId) return [];
    const { data } = await sb().from("chapters").select("id,name").eq("subject_id", subjectId).order("display_order");
    return data || [];
  }
  async function loadTopics(chapterId) {
    if (!chapterId) return [];
    const { data } = await sb().from("topics").select("id,name").eq("chapter_id", chapterId).order("display_order");
    return data || [];
  }
  async function loadTypes() {
    const { data } = await sb().from("question_types").select("id,code,name").eq("is_active", true).order("name");
    return data || [];
  }

  EP.register("/questions", async function (main) {
    main.innerHTML = EP.spinner("Loading question bank…");
    parseQuery();
    const [subjects, types, examsRes] = await Promise.all([
      loadSubjects(), loadTypes(),
      sb().from("exams").select("id,name").eq("is_active", true).order("name")
    ]);
    const exams = examsRes.data || [];
    const hasNcert = await EP.hasColumn("questions", "ncert");
    const subjOpts = '<option value="">All subjects</option>' + subjects.map(function (s) { return '<option value="' + s.id + '" data-exam="' + s.exam_id + '">' + EP.esc(s.name) + "</option>"; }).join("");
    const examOpts = '<option value="">All exams</option>' + exams.map(function (e) { return '<option value="' + e.id + '">' + EP.esc(e.name) + "</option>"; }).join("");
    const typeOpts = '<option value="">All types</option>' + types.map(function (t) { return '<option value="' + t.id + '">' + EP.esc(t.name) + "</option>"; }).join("");
    const diffOpts = '<option value="">Any difficulty</option><option>EASY</option><option>MEDIUM</option><option>HARD</option>';
    const statusOpts = '<option value="">Any status</option><option>PENDING_REVIEW</option><option>VERIFIED</option><option>REJECTED</option>';
    const ncertOpts = hasNcert ? '<option value="">Any</option><option value="true">NCERT only</option><option value="false">Non-NCERT</option>' : "";

    const bar =
      '<div class="toolbar card">' +
      '<input id="qb_search" class="input" placeholder="Search question text…" value="' + EP.esc(qbFilters.q) + '">' +
      '<select id="qb_exam" class="input">' + examOpts + "</select>" +
      '<select id="qb_subj" class="input">' + subjOpts + "</select>" +
      '<select id="qb_chap" class="input"></select>' +
      '<select id="qb_topic" class="input"></select>' +
      '<select id="qb_diff" class="input">' + diffOpts + "</select>" +
      '<select id="qb_type" class="input">' + typeOpts + "</select>" +
      '<select id="qb_status" class="input">' + statusOpts + "</select>" +
      (hasNcert ? '<select id="qb_ncert" class="input">' + ncertOpts + "</select>" : "") +
      '<input id="qb_year" class="input" type="number" placeholder="Year" style="width:90px" value="' + EP.esc(qbFilters.year || "") + '">' +
      '<input id="qb_session" class="input" placeholder="Session (e.g. June)" style="width:140px" value="' + EP.esc(qbFilters.session || "") + '">' +
      '<input id="qb_shift" class="input" placeholder="Shift (e.g. Shift 1)" style="width:140px" value="' + EP.esc(qbFilters.shift || "") + '">' +
      (EP.can("questions.create") ? '<a class="btn btn-primary" href="#/questions/new">+ New</a>' : "") +
      (EP.can("questions.create") ? '<a class="btn" href="#/questions/import">Import</a>' : "") +
      (EP.can("questions.import") ? '<a class="btn" href="#/questions/health">Health</a>' : "") +
      '<button class="btn btn-sm btn-ghost" id="qb_export">Export CSV</button>' +
      "</div>";

    main.innerHTML = '<div class="page"><div class="page-head"><h2>Question Bank</h2><div id="qb_scope_note"></div></div>' + bar + '<div id="qb_list">' + EP.spinner() + "</div></div>";

    // wire filters (declared before the scoping block below, which re-renders the subject list)
    const subjSel = EP.qs("#qb_subj"), chapSel = EP.qs("#qb_chap");

    // Subject teachers only see their assigned subjects (teachers.subject_ids,
    // backed by teacher_assignments); other staff see everything.
    let scopedSubjectIds = null;
    if (EP.hasRole(["SUBJECT_TEACHER"]) && !EP.hasRole(["TEACHER", "INSTITUTION_ADMIN", "ACADEMIC_ADMIN", "PLATFORM_ADMIN", "SUPER_ADMIN"])) {
      try {
        const { data: trows } = await sb().from("teachers").select("id, subject_ids").eq("auth_user_id", EP.state.user.id).eq("is_deleted", false).limit(1);
        const me = trows && trows.length ? trows[0] : null;
        const ids = [];
        ((me && me.subject_ids) || []).forEach(function (x) { if (x) ids.push(x); });
        if (me) {
          try {
            const { data: assigns } = await sb().from("teacher_assignments").select("subject_id").eq("teacher_id", me.id);
            (assigns || []).forEach(function (a) { if (a.subject_id && ids.indexOf(a.subject_id) === -1) ids.push(a.subject_id); });
          } catch (_) { /* teacher_assignments optional */ }
        }
        if (ids.length) {
          scopedSubjectIds = ids;
          const scoped = subjects.filter(function (s) { return ids.indexOf(s.id) !== -1; });
          EP.qs("#qb_scope_note").innerHTML = '<span class="pill">Subject teacher — restricted to your assigned subjects (' + scoped.length + ")</span>";
          qbFilters.subject_id = ids.indexOf(qbFilters.subject_id) !== -1 ? qbFilters.subject_id : (scoped.length === 1 ? scoped[0].id : "");
          const subjFilter = function (list) { return list.filter(function (s) { return ids.indexOf(s.id) !== -1; }); };
          // Re-scope the subject options rendered above
          const eId = EP.qs("#qb_exam").value;
          const visible = subjFilter(subjects).filter(function (s) { return !eId || s.exam_id === eId; });
          subjSel.innerHTML = '<option value="">' + (eId ? "All my subjects for this exam" : "All my subjects") + "</option>" +
            visible.map(function (s) { return '<option value="' + s.id + '">' + EP.esc(s.name) + "</option>"; }).join("");
          subjSel.value = qbFilters.subject_id;
        }
      } catch (_) { /* scope lookup failed — show everything rather than nothing */ }
    }

    // wire filters
    EP.qs("#qb_exam").value = qbFilters.exam_id;
    subjSel.value = qbFilters.subject_id;
    EP.qs("#qb_diff").value = qbFilters.difficulty;
    EP.qs("#qb_type").value = qbFilters.question_type_id;
    EP.qs("#qb_status").value = qbFilters.status;
    EP.qs("#qb_year").value = qbFilters.year || "";
    function renderSubjectOpts() {
      const eId = EP.qs("#qb_exam").value;
      const visible = subjects.filter(function (s) { return !eId || s.exam_id === eId; });
      subjSel.innerHTML = '<option value="">' + (eId ? "All subjects for this exam" : "All subjects") + "</option>" +
        visible.map(function (s) { return '<option value="' + s.id + '">' + EP.esc(s.name) + "</option>"; }).join("");
      const stillValid = visible.some(function (s) { return s.id === qbFilters.subject_id; });
      if (!stillValid) qbFilters.subject_id = "";
      subjSel.value = qbFilters.subject_id;
    }
    renderSubjectOpts();
    const topicSel = EP.qs("#qb_topic");
    await refreshChapters();
    async function refreshTopics() {
      const tops = await loadTopics(chapSel.value);
      topicSel.innerHTML = '<option value="">All topics</option>' + tops.map(function (t) { return '<option value="' + t.id + '">' + EP.esc(t.name) + "</option>"; }).join("");
      const stillValid = tops.some(function (t) { return t.id === qbFilters.topic_id; });
      if (!stillValid) qbFilters.topic_id = "";
      topicSel.value = qbFilters.topic_id || "";
    }
    await refreshTopics();
    function refreshChapters() {
      return loadChapters(subjSel.value).then(function (chs) {
        chapSel.innerHTML = '<option value="">All chapters</option>' + chs.map(function (c) { return '<option value="' + c.id + '">' + EP.esc(c.name) + "</option>"; }).join("");
        const stillValid = chs.some(function (c) { return c.id === qbFilters.chapter_id; });
        if (!stillValid) qbFilters.chapter_id = "";
        chapSel.value = qbFilters.chapter_id || "";
        return refreshTopics();
      });
    }
    EP.qs("#qb_exam").addEventListener("change", function (e) {
      qbFilters.exam_id = e.target.value;
      qbFilters.chapter_id = "";
      qbFilters.topic_id = "";
      EP.qs("#qb_list").innerHTML = EP.spinner();
      renderSubjectOpts();
      refreshChapters();
      fetchQ();
    });
    subjSel.addEventListener("change", function () { qbFilters.subject_id = subjSel.value; qbFilters.chapter_id = ""; qbFilters.topic_id = ""; EP.qs("#qb_list").innerHTML = EP.spinner(); refreshChapters(); fetchQ(); });
    chapSel.addEventListener("change", function () { qbFilters.chapter_id = chapSel.value; qbFilters.topic_id = ""; refreshTopics(); fetchQ(); });
    topicSel.addEventListener("change", function () { qbFilters.topic_id = topicSel.value; fetchQ(); });
    EP.qs("#qb_diff").addEventListener("change", function (e) { qbFilters.difficulty = e.target.value; fetchQ(); });
    EP.qs("#qb_type").addEventListener("change", function (e) { qbFilters.question_type_id = e.target.value; fetchQ(); });
    EP.qs("#qb_status").addEventListener("change", function (e) { qbFilters.status = e.target.value; fetchQ(); });
    if (hasNcert) EP.qs("#qb_ncert").addEventListener("change", function (e) { qbFilters.ncert = e.target.value; fetchQ(); });
    EP.qs("#qb_year").addEventListener("input", function (e) { qbFilters.year = e.target.value; clearTimeout(to); to = setTimeout(fetchQ, 350); });
    let to;
    EP.qs("#qb_search").addEventListener("input", function (e) { qbFilters.q = e.target.value; clearTimeout(to); to = setTimeout(fetchQ, 350); });
    EP.qs("#qb_session").addEventListener("input", function (e) { qbFilters.session = e.target.value; clearTimeout(to); to = setTimeout(fetchQ, 350); });
    EP.qs("#qb_shift").addEventListener("input", function (e) { qbFilters.shift = e.target.value; clearTimeout(to); to = setTimeout(fetchQ, 350); });

    let qbSeq = 0;
    async function fetchQ() {
      const mySeq = ++qbSeq;
      EP.qs("#qb_list").innerHTML = EP.spinner();
      if (mySeq !== qbSeq) return;
      let q = sb().from("questions").select("id, question_text, difficulty, year, verification_status" + (hasNcert ? ", ncert" : "") + ", exams(name), subjects(name), chapters(name), question_types(name)", { count: "exact" });
      q = q.eq("is_deleted", false);
      if (qbFilters.exam_id) q = q.eq("exam_id", qbFilters.exam_id);
      if (qbFilters.subject_id) q = q.eq("subject_id", qbFilters.subject_id);
      else if (scopedSubjectIds) q = q.in("subject_id", scopedSubjectIds);
      if (qbFilters.chapter_id) q = q.eq("chapter_id", qbFilters.chapter_id);
      if (qbFilters.topic_id) q = q.eq("topic_id", qbFilters.topic_id);
      if (qbFilters.difficulty) q = q.eq("difficulty", qbFilters.difficulty);
      if (qbFilters.question_type_id) q = q.eq("question_type_id", qbFilters.question_type_id);
      if (qbFilters.year) q = q.eq("year", parseInt(qbFilters.year, 10));
      if (qbFilters.session) q = q.ilike("session", qbFilters.session);
      if (qbFilters.shift) q = q.ilike("shift", qbFilters.shift);
      if (qbFilters.status) q = q.eq("verification_status", qbFilters.status);
      if (hasNcert && qbFilters.ncert === "true") q = q.eq("ncert", true);
      else if (hasNcert && qbFilters.ncert === "false") q = q.eq("ncert", false);
      if (qbFilters.q) q = q.ilike("question_text", "%" + qbFilters.q + "%");
      const start = (qbFilters.page - 1) * PAGE;
      q = q.order("created_at", { ascending: false }).range(start, start + PAGE - 1);
      const { data, count, error } = await q;
      if (error) { if (mySeq === qbSeq) EP.qs("#qb_list").innerHTML = '<div class="empty error">' + EP.esc(error.message) + "</div>"; return; }
      if (!data || !data.length) { if (mySeq === qbSeq) EP.qs("#qb_list").innerHTML = '<div class="empty">No questions match your filters. <a href="#/questions/new">Add one</a>.</div>'; return; }
      const rows = data.map(function (r) {
        const st = r.verification_status === "VERIFIED" ? "ok" : (r.verification_status === "PENDING_REVIEW" ? "warn" : "bad");
        return '<tr><td class="qtxt">' + EP.esc(r.question_text.replace(/<[^>]+>/g, "").slice(0, 120)) + "</td>" +
          "<td>" + EP.esc((r.exams && r.exams.name) || "—") + "</td>" +
          "<td>" + EP.esc((r.subjects && r.subjects.name) || "—") + "</td>" +
          "<td>" + EP.esc((r.chapters && r.chapters.name) || "—") + "</td>" +
          "<td>" + EP.esc((r.question_types && r.question_types.name) || "—") + "</td>" +
          "<td>" + EP.esc(r.difficulty || "—") + "</td>" +
          "<td>" + EP.esc(r.year || "—") + "</td>" +
          (hasNcert ? "<td>" + (r.ncert ? '<span class="badge b-ok">NCERT</span>' : "—") + "</td>" : "") +
          '<td><span class="badge b-' + st + '">' + EP.esc(r.verification_status) + "</span></td>" +
          '<td><a class="btn btn-sm" href="#/questions/' + r.id + '">View</a></td></tr>';
      }).join("");
      const totalPages = Math.ceil((count || 0) / PAGE);
      if (mySeq !== qbSeq) return;
      EP.qs("#qb_list").innerHTML =
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Question</th><th>Exam</th><th>Subject</th><th>Chapter</th><th>Type</th><th>Difficulty</th><th>Year</th>' + (hasNcert ? "<th>NCERT</th>" : "") + '<th>Status</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
        '<div class="pager">' +
        '<button class="btn btn-sm" ' + (qbFilters.page <= 1 ? "disabled" : "") + ' id="pg_prev">Prev</button>' +
        '<span class="muted">Page ' + qbFilters.page + " / " + totalPages + " (" + (count || 0) + " total)</span>" +
        '<button class="btn btn-sm" ' + (qbFilters.page >= totalPages ? "disabled" : "") + ' id="pg_next">Next</button></div>';
      if (EP.qs("#pg_prev")) EP.qs("#pg_prev").addEventListener("click", function () { qbFilters.page--; fetchQ(); });
      if (EP.qs("#pg_next")) EP.qs("#pg_next").addEventListener("click", function () { qbFilters.page++; fetchQ(); });
      const expBtn = EP.qs("#qb_export");
      if (expBtn) expBtn.addEventListener("click", function () {
        const headers = ["Question", "Subject", "Chapter", "Type", "Difficulty", "Year"].concat(hasNcert ? ["NCERT"] : []).concat(["Status"]);
        const rows = (data || []).map(function (r) {
          const row = {
            Question: (r.question_text || "").replace(/<[^>]+>/g, "").slice(0, 200),
            Subject: (r.subjects && r.subjects.name) || "",
            Chapter: (r.chapters && r.chapters.name) || "",
            Type: (r.question_types && r.question_types.name) || "",
            Difficulty: r.difficulty || "",
            Year: r.year || "",
            Status: r.verification_status || ""
          };
          if (hasNcert) row.NCERT = r.ncert ? "Yes" : "No";
          return row;
        });
        EP.exportCsv("questions.csv", headers, rows);
      });
    }
    fetchQ();
  });

  // ---- Question import (CSV/JSON → preview → batch RPC) ----
  EP.register("/questions/import", async function (main) {
    if (!EP.can("questions.import")) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    const [taxRes] = await Promise.all([
      Promise.all([
        sb().from("exams").select("id,name,code").eq("is_active", true).order("name"),
        sb().from("subjects").select("id,name,code,exam_id").order("name"),
        sb().from("question_types").select("id,code,name").eq("is_active", true).order("name"),
        sb().from("chapters").select("id,name,code,subject_id").limit(1000),
        sb().from("topics").select("id,name,code,chapter_id").limit(1000),
      ])
    ]);
    const [examsRes, subjsRes, typesRes, chapsRes, topsRes] = taxRes;
    const exams = examsRes.data || [], subjects = subjsRes.data || [], types = typesRes.data || [],
      chapters = chapsRes.data || [], topics = topsRes.data || [];
    const examCode = {}, subjCode = {}, typeCode = {}, chapCode = {}, topCode = {};
    exams.forEach(function (e) { examCode[e.code] = e.id; });
    subjects.forEach(function (s) { subjCode[s.code] = s; });
    types.forEach(function (t) { typeCode[t.code] = t.id; });
    chapters.forEach(function (c) { chapCode[c.code] = c; });
    topics.forEach(function (t) { topCode[t.code] = t; });

    const examOpts = '<option value="">Select exam…</option>' + exams.map(function (e) { return '<option value="' + e.id + '">' + EP.esc(e.name) + "</option>"; }).join("");

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Import Questions</h2><a class="btn btn-sm" href="#/questions">Back</a></div>' +
      '<section class="card"><h3>Step 1 — Choose a file</h3>' +
      '<p class="muted">Supported: <b>.csv</b> (comma separated, header row) or <b>.json</b> (array of objects). ' +
      'Taxonomy columns use <b>codes</b> (e.g. <code>jee-main</code>, <code>physics</code>, <code>MCQ_SINGLE</code>); missing taxonomy is created automatically in your workspace. ' +
      'Optional <code>ncert</code> column accepts <code>true/false</code>.</p>' +
      '<div class="btn-row"><input id="qi_file" type="file" accept=".csv,.json,text/csv,application/json">' +
      '<button class="btn btn-sm" id="qi_template">Download CSV template</button></div>' +
      '<div id="qi_paste" class="field" style="margin-top:10px"><label>…or paste JSON/CSV text</label><textarea id="qi_text" class="input" rows="4" placeholder=\'[{"question_text":"…","exam_code":"jee-main","subject_code":"physics","question_type_code":"MCQ_SINGLE","options":[{"option_key":"A","option_text":"…","is_correct":true}],"answer":{"correct_option_keys":["A"]}}]\'></textarea></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="qi_parse">Parse &amp; preview</button></div></section>' +
      '<section class="card" id="qi_preview_card" style="display:none"><h3>Step 2 — Review (<span id="qi_cnt">0</span> rows)</h3>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Question</th><th>Exam</th><th>Subject</th><th>Type</th><th>Options</th><th>Answer</th><th>Issue</th></tr></thead><tbody id="qi_rows"></tbody></table></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="qi_import">Import (chunked, dedup server-side)</button><span id="qi_status" class="muted"></span></div></section></div>';

    EP.qs("#qi_template").addEventListener("click", function () {
      const headers = ["question_text", "exam_code", "subject_code", "chapter_code", "topic_code", "question_type_code", "difficulty", "year", "marks", "negative_marks", "ncert", "option_A", "option_B", "option_C", "option_D", "correct_keys", "explanation", "solution_text", "source"];
      const sample = ["<question text>", "jee-main", "physics", "<chapter_code>", "", "MCQ_SINGLE", "EASY", "2025", "4", "1", "false", "<option A>", "<option B>", "<option C>", "<option D>", "<A|B|C|D>", "<explanation>", "<solution text>", "<source tag>"];
      const esc = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
      EP.exportCsv("questions-template.csv", headers, [sample].map(function (row) {
        return headers.reduce(function (o, h, i) { o[h] = row[i]; return o; }, {});
      }));
    });

    function csvParse(text) {
      const rows = [];
      let row = [], cur = "", inQ = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
          if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
          else cur += c;
        } else if (c === '"') inQ = true;
        else if (c === ",") { row.push(cur); cur = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.length > 1 || row[0] !== "") { rows.push(row); row = []; } }
        else cur += c;
      }
      if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
      return rows;
    }

    function normalize(rows, headers) {
      const items = [];
      rows.forEach(function (r, idx) {
        const q = r.question_text;
        if (!q || !String(q).trim()) return;
        const opts = [];
        const keys = ["A", "B", "C", "D", "E", "F"];
        keys.forEach(function (k) {
          const t = r["option_" + k];
          if (t && String(t).trim()) opts.push({ option_key: k, option_text: String(t).trim() });
        });
        const correct = String(r.correct_keys || "").split(/[,;]/).map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
        const diff = String(r.difficulty || "").toUpperCase();
        const item = {
          question_text: String(q).trim(),
          exam_code: r.exam_code || null,
          subject_code: r.subject_code || null,
          chapter_code: r.chapter_code || null,
          topic_code: r.topic_code || null,
          question_type_code: r.question_type_code || null,
          difficulty: ["EASY", "MEDIUM", "HARD"].indexOf(diff) !== -1 ? diff : "MEDIUM",
          year: parseInt(r.year, 10) || null,
          marks: parseFloat(r.marks) || 4,
          negative_marks: parseFloat(r.negative_marks) || 1,
          ncert: ["true", "yes", "1", "y"].indexOf(String(r.ncert || "").trim().toLowerCase()) !== -1,
          source: r.source || "IMPORT",
          options: opts,
          answer: { correct_option_keys: correct, explanation: r.explanation || null },
          solution_text: r.solution_text || r.solution || null,
        };
        const issues = [];
        if (!item.exam_code) issues.push("no exam_code");
        if (!item.subject_code) issues.push("no subject_code");
        if (!item.question_type_code) issues.push("no question_type_code");
        if (!opts.length) issues.push("no options");
        else if (!correct.length) issues.push("no correct_keys");
        item.issue = issues.join("; ");
        items.push({ idx: idx, item: item, issue: item.issue });
      });
      return items;
    }

    EP.qs("#qi_parse").addEventListener("click", async function () {
      let text = EP.qs("#qi_text").value.trim();
      const file = EP.qs("#qi_file").files[0];
      if (file && !text) { text = await file.text(); }
      if (!text) { EP.toast("Choose a file or paste content", "error"); return; }
      let parsed = [];
      try {
        const trimmed = text.trim();
        if (trimmed[0] === "[" || trimmed[0] === "{") {
          const arr = JSON.parse(trimmed);
          if (!Array.isArray(arr)) { EP.toast("JSON must be an array of question objects", "error"); return; }
          const headers = Object.keys(arr[0] || {});
          parsed = normalize(arr.map(function (o) { const flat = {}; Object.keys(o).forEach(function (k) { flat[k] = typeof o[k] === "object" && o[k] !== null ? JSON.stringify(o[k]) : o[k]; }); return flat; }), headers);
        } else {
          const rows = csvParse(text);
          if (rows.length < 2) { EP.toast("CSV needs a header row plus data rows", "error"); return; }
          const headers = rows[0];
          const data = rows.slice(1).map(function (row) {
            const o = {};
            headers.forEach(function (h, i) { o[h] = row[i] !== undefined ? row[i] : ""; });
            return o;
          });
          parsed = normalize(data, headers);
        }
      } catch (e) { EP.toast("Parse failed: " + e.message, "error"); return; }

      if (!parsed.length) { EP.toast("No valid question rows found", "error"); return; }
      window.__qiRows = parsed;
      const body = parsed.map(function (p, i) {
        const exam = examCode[p.item.exam_code] ? (exams.find(function (e) { return e.id === examCode[p.item.exam_code]; }) || {}).name : (p.item.exam_code || "—");
        const subj = p.item.subject_code ? ((subjCode[p.item.subject_code] || {}).name || p.item.subject_code) : "—";
        const type = p.item.question_type_code ? ((types.find(function (t) { return t.code === p.item.question_type_code; }) || {}).name || p.item.question_type_code) : "—";
        return "<tr><td>" + (i + 1) + "</td><td class='qtxt'>" + EP.esc(p.item.question_text.slice(0, 90)) + "</td><td>" + EP.esc(exam) + "</td><td>" + EP.esc(subj) + "</td><td>" + EP.esc(type) + "</td><td>" + p.item.options.length + "</td><td>" + EP.esc((p.item.answer.correct_option_keys || []).join(",") || "—") + "</td><td>" + (p.issue ? '<span class="badge b-warn">' + EP.esc(p.issue) + "</span>" : '<span class="badge b-ok">ok</span>') + "</td></tr>";
      }).join("");
      EP.qs("#qi_cnt").textContent = parsed.length;
      EP.qs("#qi_rows").innerHTML = body;
      EP.qs("#qi_preview_card").style.display = "";
    });

    EP.qs("#qi_import").addEventListener("click", async function () {
      const parsed = window.__qiRows || [];
      if (!parsed.length) return;
      EP.qs("#qi_import").disabled = true;
      const CHUNK = 50;
      let imported = 0, duplicates = 0, failed = 0, errors = [];
      const verified = confirm("Import directly as VERIFIED? Click OK for VERIFIED, Cancel for PENDING_REVIEW.");
      const p_verification = verified ? "VERIFIED" : "PENDING_REVIEW";
      for (let i = 0; i < parsed.length; i += CHUNK) {
        const chunk = parsed.slice(i, i + CHUNK).map(function (p) { return p.item; });
        const { data, error } = await sb().rpc("app_import_questions_batch", { p_items: chunk, p_create_taxonomy: true, p_verification: p_verification });
        if (error) { errors.push(error.message); failed += chunk.length; }
        else {
          imported += (data.imported || 0); duplicates += (data.duplicates || 0); failed += (data.failed || 0);
          if (data.errors) (data.errors || []).forEach(function (e) { errors.push("row " + e.index + ": " + e.error); });
        }
        EP.qs("#qi_status").textContent = "Imported " + imported + " · duplicates " + duplicates + " · failed " + failed;
      }
      EP.qs("#qi_import").disabled = false;
      const msg = "Import complete: imported " + imported + ", " + duplicates + " duplicates skipped, " + failed + " failed." + (errors.length ? " Errors: " + errors.slice(0, 5).join(" | ") : "");
      EP.toast(msg, failed ? "error" : "success");
      EP.qs("#qi_status").textContent = msg;
    });
  });

  // ---- Question Bank Health (eligibility diagnostics) ----
  EP.register("/questions/health", async function (main) {
    if (EP.roleType() === "student") { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Checking question bank health…");
    let res;
    try { res = await sb().rpc("app_question_bank_health"); }
    catch (e) { main.innerHTML = '<div class="page"><div class="empty error">Health check failed: ' + EP.esc(e.message || "unknown") + "</div></div>"; return; }
    if (res.error) { main.innerHTML = '<div class="page"><div class="empty error">' + EP.esc(res.error.message) + "</div></div>"; return; }
    const data = res.data || {};
    const exams = data.exams || [];
    if (!exams.length) { main.innerHTML = '<div class="page"><div class="page-head"><h2>Question Bank Health</h2><a class="btn btn-sm" href="#/questions">Back</a></div><div class="empty">No active exams found. <a href="#/questions/import">Import questions</a> to get started.</div></div>'; return; }

    const cards = exams.map(function (e) {
      const need = 10;
      const ok = e.eligible >= need;
      const subjRows = (e.subjects || []).map(function (s) {
        const sOk = s.verified > 0;
        return '<tr><td>' + EP.esc(s.name) + "</td><td>" + s.verified + "</td><td>" + s.total + "</td><td><span class=\"badge " + (sOk ? "b-ok" : "b-warn") + "\">" + (sOk ? "eligible" : "no verified questions") + "</span></td></tr>";
      }).join("") || '<tr><td colspan="4" class="muted">No subjects linked to this exam yet.</td></tr>';
      return '<section class="card"><h3>' + EP.esc(e.exam_name) + "</h3>" +
        '<div class="stat-grid">' +
        '<div class="stat-card"><div class="stat-v">' + e.total + '</div><div class="stat-l">Total questions</div></div>' +
        '<div class="stat-card"><div class="stat-v">' + e.verified + '</div><div class="stat-l">Verified</div></div>' +
        '<div class="stat-card"><div class="stat-v ' + (ok ? "" : "muted") + '">' + e.eligible + '</div><div class="stat-l">Eligible for papers' + (ok ? ' <span class="badge b-ok">ready</span>' : ' <span class="badge b-warn">needs ' + Math.max(0, need - e.eligible) + " more</span>") + "</div></div>" +
        '<div class="stat-card"><div class="stat-v">' + e.pending_review + '</div><div class="stat-l">Pending review</div></div>' +
        '<div class="stat-card"><div class="stat-v">' + e.ncert + '</div><div class="stat-l">NCERT</div></div>' +
        '<div class="stat-card"><div class="stat-v">' + e.deleted + '</div><div class="stat-l">Deleted</div></div>' +
        "</div>" +
        '<h4>Subjects</h4><div class="table-wrap"><table class="data-table"><thead><tr><th>Subject</th><th>Verified</th><th>Total</th><th>Status</th></tr></thead><tbody>' + subjRows + "</tbody></table></div>" +
        (ok ? "" : '<p class="hint">Tip: import questions for this exam, then verify them from the question view to unlock paper/DPP generation. <a href="#/questions/import">Go to Import</a></p>') +
        "</section>";
    }).join("");

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Question Bank Health</h2><a class="btn btn-sm" href="#/questions">Back</a> <a class="btn btn-sm" href="#/questions/import">Import questions</a></div>' +
      '<p class="muted">Per-exam eligibility: a question counts as <b>eligible</b> when it is VERIFIED and not yet used in an earlier paper/DPP (no-repeat).</p>' +
      cards + "</div>";
  });

  // ---- Question view ----
  EP.register("/questions/:id", async function (main, path) {
    const id = path.split("/").pop();
    main.innerHTML = EP.spinner("Loading question…");
    const { data: q } = await sb().from("questions").select("*").eq("id", id).maybeSingle();
    if (!q) { main.innerHTML = '<div class="empty">Question not found.</div>'; return; }
    const { data: opts } = await sb().from("question_options").select("*").eq("question_id", id).order("display_order");
    const { data: ans } = await sb().from("question_answers").select("*").eq("question_id", id).maybeSingle();
    const { data: sol } = await sb().from("solutions").select("*").eq("question_id", id).maybeSingle();

    // ---- Multilingual translations (question_translations, migration 0043) ----
    const TR_LANGS = [["EN", "English"], ["HI", "Hindi"], ["GU", "Gujarati"], ["BN", "Bengali"], ["MR", "Marathi"], ["TA", "Tamil"], ["TE", "Telugu"], ["KN", "Kannada"]];
    const trLangName = function (code) { for (let i = 0; i < TR_LANGS.length; i++) if (TR_LANGS[i][0] === code) return TR_LANGS[i][1]; return code; };
    const canManageTr = EP.can("questions.edit");
    const canVerifyTr = EP.can("questions.review");
    let translations = [];
    const hasTrTable = await EP.hasTable("question_translations");
    if (hasTrTable) {
      const { data: trs, error: trErr } = await sb().from("question_translations").select("*").eq("question_id", id).order("language");
      if (trErr) EP.toast(trErr.message, "error"); else translations = trs || [];
    }
    const trByLang = function (code) { return translations.filter(function (t) { return t.language === code; })[0] || null; };
    function renderQuestionView(langCode) {
      const t = langCode ? trByLang(langCode) : null;
      const vText = t && t.question_text != null && t.question_text !== "" ? t.question_text : q.question_text;
      const vOpts = t && Array.isArray(t.options) && t.options.length ? t.options : (opts || []);
      const vSol = t && t.solution_text != null && t.solution_text !== "" ? t.solution_text : (sol ? sol.solution_text : null);
      const correctKeys = (ans && ans.correct_option_keys) || [];
      const optHtml = vOpts && vOpts.length
        ? '<ol class="opts">' + vOpts.map(function (o) {
            const correct = correctKeys.indexOf(o.option_key) !== -1;
            return '<li class="' + (correct ? "correct" : "") + '"><b>' + EP.esc(o.option_key) + ".</b> " + EP.esc(o.option_text) + (correct ? ' <span class="badge b-ok">answer</span>' : "") + "</li>";
          }).join("") + "</ol>"
        : "—";
      EP.qs("#q_view_body").innerHTML = EP.safeHtml(vText || "");
      EP.qs("#q_view_opts").innerHTML = optHtml;
      EP.qs("#q_view_sol").innerHTML = vSol != null && vSol !== "" ? EP.esc(vSol) : '<span class="muted">No solution recorded.</span>';
      const badge = EP.qs("#q_view_lang_badge");
      if (!badge) return;
      if (langCode && t) {
        badge.textContent = trLangName(langCode) + (t.is_verified ? "" : " · unverified translation");
        badge.className = t.is_verified ? "badge b-ok" : "badge b-warn";
      } else { badge.textContent = "Original"; badge.className = "badge"; }
    }
    const trRowsHtml = translations.map(function (t) {
      return "<tr><td><b>" + EP.esc(t.language) + "</b> · " + EP.esc(trLangName(t.language)) + "</td>" +
        "<td>" + (t.is_verified ? '<span class="badge b-ok">verified</span>' : '<span class="badge b-warn">unverified</span>') + "</td>" +
        "<td>" + EP.fmtDate(t.updated_at) + "</td>" +
        "<td>" +
        '<button class="btn btn-sm" data-tr-view="' + EP.esc(t.language) + '">View</button> ' +
        (canManageTr ? '<button class="btn btn-sm" data-tr-edit="' + EP.esc(t.language) + '">Edit</button> ' : "") +
        (canVerifyTr ? '<button class="btn btn-sm" data-tr-verify="' + EP.esc(t.language) + '">' + (t.is_verified ? "Unverify" : "Verify") + "</button> " : "") +
        (canManageTr ? '<button class="btn btn-sm btn-danger" data-tr-del="' + EP.esc(t.language) + '">Delete</button>' : "") +
        "</td></tr>";
    }).join("") || '<tr><td colspan="4" class="muted">No translations yet.</td></tr>';
    const trSection = hasTrTable
      ? '<section class="card"><h3>Translations</h3>' +
        '<div class="btn-row"><label class="muted" for="q_view_lang">View language:</label> ' +
        '<select id="q_view_lang" class="input" style="width:auto;display:inline-block"><option value="">Original</option>' +
        translations.map(function (t) { return '<option value="' + EP.esc(t.language) + '">' + EP.esc(trLangName(t.language)) + (t.is_verified ? "" : " (unverified)") + "</option>"; }).join("") +
        '</select> <span id="q_view_lang_badge" class="badge">Original</span></div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Language</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>' + trRowsHtml + "</tbody></table></div>" +
        (canManageTr ? '<div class="btn-row"><button class="btn btn-sm btn-primary" id="tr_add">+ Add translation</button></div>' : "") +
        '<p class="hint">Per-language question text, options and solution (spec §51). Unverified translations are marked while viewing; only verified translations should be printed in bilingual papers.</p></section>'
      : "";
    function openTrModal(existing) {
      const used = {}; translations.forEach(function (t) { used[t.language] = true; });
      const langOpts = TR_LANGS.filter(function (l) { return existing ? true : !used[l[0]]; })
        .map(function (l) { return '<option value="' + l[0] + '"' + (existing && existing.language === l[0] ? " selected" : "") + ">" + l[1] + "</option>"; }).join("");
      if (!langOpts) { EP.toast("Translations exist for every supported language already", "error"); return; }
      const startOpts = existing && Array.isArray(existing.options) && existing.options.length
        ? existing.options
        : ((opts && opts.length) ? opts.map(function (o) { return { option_key: o.option_key, option_text: o.option_text }; })
          : [{ option_key: "A", option_text: "" }, { option_key: "B", option_text: "" }, { option_key: "C", option_text: "" }, { option_key: "D", option_text: "" }]);
      const body =
        '<div class="field"><label>Language</label><select id="tr_m_lang" class="input"' + (existing ? " disabled" : "") + ">" + langOpts + "</select></div>" +
        '<div class="field"><label>Question text (translated)</label><textarea id="tr_m_text" class="input" rows="5">' + EP.esc(existing ? existing.question_text || "" : q.question_text || "") + "</textarea></div>" +
        '<div class="field"><label>Options (translated)</label><div id="tr_m_opts"></div><button type="button" class="btn btn-sm" id="tr_m_addopt">+ Option</button></div>' +
        '<div class="field"><label>Solution (translated)</label><textarea id="tr_m_sol" class="input" rows="4">' + EP.esc(existing ? existing.solution_text || "" : "") + "</textarea></div>";
      const overlay = EP.modal(existing ? "Edit translation — " + trLangName(existing.language) : "Add translation", body,
        '<button class="btn" data-close>Cancel</button> <button class="btn btn-primary" id="tr_m_save">Save translation</button>');
      const optBox = overlay.querySelector("#tr_m_opts");
      optBox.innerHTML = startOpts.map(function (o) {
        return '<div class="opt-row"><input class="input opt-key" style="width:60px" value="' + EP.esc(o.option_key || "") + '"><input class="input opt-text" placeholder="Option text" value="' + EP.esc(o.option_text || "") + '"><button type="button" class="icon-btn del-opt">&times;</button></div>';
      }).join("");
      optBox.querySelectorAll(".del-opt").forEach(function (b) {
        b.addEventListener("click", function () { b.parentElement.remove(); });
      });
      overlay.querySelector("#tr_m_addopt").addEventListener("click", function () {
        const cur = optBox.querySelectorAll(".opt-row").length;
        const d = document.createElement("div"); d.className = "opt-row";
        d.innerHTML = '<input class="input opt-key" style="width:60px" value="' + String.fromCharCode(65 + cur) + '"><input class="input opt-text" placeholder="Option text"><button type="button" class="icon-btn del-opt">&times;</button>';
        d.querySelector(".del-opt").addEventListener("click", function () { d.remove(); });
        optBox.appendChild(d);
      });
      overlay.querySelector("#tr_m_save").addEventListener("click", async function () {
        const lang = overlay.querySelector("#tr_m_lang").value;
        const text = overlay.querySelector("#tr_m_text").value;
        if (!lang) { EP.toast("Select a language", "error"); return; }
        if (!text.trim()) { EP.toast("Translated question text is required", "error"); return; }
        const rows = Array.prototype.map.call(optBox.querySelectorAll(".opt-row"), function (r) {
          return { option_key: r.querySelector(".opt-key").value.trim(), option_text: r.querySelector(".opt-text").value };
        }).filter(function (o) { return o.option_key; });
        const btn = overlay.querySelector("#tr_m_save");
        btn.disabled = true;
        const { error } = await sb().from("question_translations").upsert({
          question_id: id, language: lang, question_text: text,
          options: rows.length ? rows : null,
          solution_text: overlay.querySelector("#tr_m_sol").value || null,
          translated_by: EP.state.user.id
        }, { onConflict: "question_id,language" });
        btn.disabled = false;
        if (error) { EP.toast(error.message, "error"); return; }
        EP.closeModal(overlay);
        EP.toast("Translation saved", "success");
        EP.navigate("/questions/" + id);
      });
    }

    // ---- Syllabus mapping (syllabus_versions + question_syllabus_map, migration 0040) ----
    let syllabusVersions = [], syllabusMaps = [];
    const hasSvTable = await EP.hasTable("syllabus_versions");
    const hasQsmTable = await EP.hasTable("question_syllabus_map");
    const hasSyllabus = hasSvTable && hasQsmTable;
    if (hasSyllabus) {
      const svRes = await sb().from("syllabus_versions").select("id,exam_id,authority,year,version,status,effective_date,exams(name)").limit(200);
      if (svRes.error) EP.toast(svRes.error.message, "error"); else syllabusVersions = svRes.data || [];
      const qsmRes = await sb().from("question_syllabus_map").select("*").eq("question_id", id);
      if (qsmRes.error) EP.toast(qsmRes.error.message, "error"); else syllabusMaps = qsmRes.data || [];
    }
    const svLabel = function (sv) { return (sv.exams && sv.exams.name ? sv.exams.name : "General") + " · " + sv.authority + " " + sv.year + (sv.version ? " v" + sv.version : "") + " [" + sv.status + "]"; };
    const svById = {}; syllabusVersions.forEach(function (sv) { svById[sv.id] = sv; });
    const qsmRowsHtml = syllabusMaps.map(function (m) {
      const sv = svById[m.syllabus_version_id];
      return "<tr><td>" + (sv ? EP.esc(svLabel(sv)) : EP.esc(m.syllabus_version_id)) + "</td>" +
        "<td>" + EP.esc(m.syllabus_status) + "</td><td>" + EP.fmtDate(m.mapped_at) + "</td>" +
        "<td>" + (EP.can("questions.edit") ? '<button class="btn btn-sm btn-danger" data-qsm-del="' + EP.esc(m.id) + '">Remove</button>' : "") + "</td></tr>";
    }).join("") || '<tr><td colspan="4" class="muted">Not mapped to any syllabus version.</td></tr>';
    const svOptsHtml = syllabusVersions.map(function (sv) { return '<option value="' + sv.id + '">' + EP.esc(svLabel(sv)) + "</option>"; }).join("");
    const syllabusSection = hasSyllabus
      ? '<section class="card"><h3>Syllabus mapping</h3>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Syllabus version</th><th>Status</th><th>Mapped</th><th></th></tr></thead><tbody>' + qsmRowsHtml + "</tbody></table></div>" +
        (EP.can("questions.edit") && syllabusVersions.length
          ? '<div class="btn-row"><select id="qsm_sv" class="input" style="width:auto;max-width:340px">' + svOptsHtml + "</select>" +
            '<select id="qsm_status" class="input" style="width:auto"><option>CURRENT</option><option>HISTORICAL</option><option>REMOVED</option><option>MODIFIED</option><option>NOT_IN_CURRENT_SYLLABUS</option><option>UNCERTAIN</option></select>' +
            '<button class="btn btn-sm btn-primary" id="qsm_map">Map to syllabus</button>' +
            ' <a class="btn btn-sm" href="#/admin/syllabus">Manage syllabus versions</a></div>'
          : (EP.can("questions.edit") ? '<p class="muted">No syllabus versions configured. <a href="#/admin/syllabus">Create one</a>.</p>' : "")) +
        '<p class="hint">Marks whether this question is in the current syllabus of an official version (spec §39) — historical PYQs stay available but can be excluded from fresh papers.</p></section>'
      : "";

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Question</h2>' +
      '<a class="btn btn-sm" href="#/questions">Back</a>' +
      (EP.can("questions.edit") ? '<a class="btn btn-sm btn-primary" href="#/questions/' + id + '/edit">Edit</a>' : "") +
      (EP.can("questions.review") && q.verification_status !== "VERIFIED" ? '<button class="btn btn-sm btn-primary" id="verify_btn">Verify</button>' : "") +
      (EP.can("questions.review") && q.verification_status === "VERIFIED" ? '<button class="btn btn-sm btn-danger" id="reject_btn">Reject</button>' : "") +
      (EP.can("questions.review") && q.verification_status !== "NEEDS_EDIT" ? '<button class="btn btn-sm" id="needs_edit_btn">Mark needs edit</button>' : "") +
      (EP.can("questions.delete") ? '<button class="btn btn-sm btn-danger" id="del_q_btn">Delete</button>' : "") +
      (EP.state.user ? '<button class="btn btn-sm" id="bm_btn">⭐ Bookmark</button>' : "") +
      (EP.state.user ? '<a class="btn btn-sm" href="#/ai-tutor?q=' + encodeURIComponent(id) + '">🤖 Ask AI Tutor</a>' : "") +
      "</div>" +
      '<section class="card"><div class="q-meta muted">Difficulty: ' + EP.esc(q.difficulty || "—") + " · Year: " + EP.esc(q.year || "—") + " · Status: " + EP.esc(q.verification_status) + (q.ncert ? ' · <span class="badge b-ok">NCERT</span>' : "") + (q.verified_at ? " · Verified: " + EP.fmtDate(q.verified_at) : "") + (hasTrTable && translations.length ? ' · <span class="badge">' + translations.length + " translation(s)</span>" : "") + "</div>" +
      '<div class="q-body" id="q_view_body">' + EP.safeHtml(q.question_text || "") + "</div>" +
      '<h4>Options</h4><div id="q_view_opts"></div>' +
      '<h4>Solution</h4><div class="q-body" id="q_view_sol"></div>' +
      "</section>" +
      trSection + syllabusSection + "</div>";
    renderQuestionView("");
    const langSel = EP.qs("#q_view_lang");
    if (langSel) langSel.addEventListener("change", function () { renderQuestionView(langSel.value); });
    main.querySelectorAll("[data-tr-view]").forEach(function (b) {
      b.addEventListener("click", function () {
        const code = b.getAttribute("data-tr-view");
        if (langSel) langSel.value = code;
        renderQuestionView(code);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    const trAddBtn = EP.qs("#tr_add");
    if (trAddBtn) trAddBtn.addEventListener("click", function () { openTrModal(null); });
    main.querySelectorAll("[data-tr-edit]").forEach(function (b) {
      b.addEventListener("click", function () { const t = trByLang(b.getAttribute("data-tr-edit")); if (t) openTrModal(t); });
    });
    main.querySelectorAll("[data-tr-verify]").forEach(function (b) {
      b.addEventListener("click", async function () {
        const t = trByLang(b.getAttribute("data-tr-verify"));
        if (!t) return;
        b.disabled = true;
        const { error } = await sb().from("question_translations").update({ is_verified: !t.is_verified }).eq("question_id", id).eq("language", t.language);
        if (error) { b.disabled = false; EP.toast(error.message, "error"); return; }
        EP.toast(t.is_verified ? "Translation unverified" : "Translation verified", "success");
        EP.navigate("/questions/" + id);
      });
    });
    main.querySelectorAll("[data-tr-del]").forEach(function (b) {
      b.addEventListener("click", async function () {
        const t = trByLang(b.getAttribute("data-tr-del"));
        if (!t || !confirm("Delete the " + trLangName(t.language) + " translation?")) return;
        const { error } = await sb().from("question_translations").delete().eq("question_id", id).eq("language", t.language);
        if (error) { EP.toast(error.message, "error"); return; }
        EP.toast("Translation deleted", "success");
        EP.navigate("/questions/" + id);
      });
    });
    const qsmMapBtn = EP.qs("#qsm_map");
    if (qsmMapBtn) qsmMapBtn.addEventListener("click", async function () {
      const svId = EP.qs("#qsm_sv").value;
      if (!svId) { EP.toast("Select a syllabus version", "error"); return; }
      qsmMapBtn.disabled = true;
      const { error } = await sb().from("question_syllabus_map").upsert({
        question_id: id, syllabus_version_id: svId,
        syllabus_status: EP.qs("#qsm_status").value,
        tenant_id: q.tenant_id || EP.state.tenantId,
        mapped_by: EP.state.user.id
      }, { onConflict: "question_id,syllabus_version_id" });
      qsmMapBtn.disabled = false;
      if (error) { EP.toast(error.message, "error"); return; }
      EP.toast("Question mapped to syllabus", "success");
      EP.navigate("/questions/" + id);
    });
    main.querySelectorAll("[data-qsm-del]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Remove this syllabus mapping?")) return;
        const { error } = await sb().from("question_syllabus_map").delete().eq("id", b.getAttribute("data-qsm-del"));
        if (error) { EP.toast(error.message, "error"); return; }
        EP.toast("Mapping removed", "success");
        EP.navigate("/questions/" + id);
      });
    });
    function wireVerify(btnId, decision) {
      const btn = EP.qs(btnId);
      if (!btn) return;
      btn.addEventListener("click", async function () {
        const note = decision === "VERIFIED" ? null : (prompt("Reason (optional):") || null);
        const { error } = await sb().rpc("app_verify_question", { p_question_id: id, p_decision: decision, p_note: note });
        if (error) EP.toast(error.message, "error");
        else { EP.toast("Question " + decision.toLowerCase().replace("_", " "), "success"); EP.navigate("/questions/" + id); }
      });
    }
    wireVerify("#verify_btn", "VERIFIED");
    wireVerify("#reject_btn", "REJECTED");
    wireVerify("#needs_edit_btn", "NEEDS_EDIT");
    const bmBtn = EP.qs("#bm_btn");
    if (bmBtn) bmBtn.addEventListener("click", async function () {
      const { error } = await sb().from("bookmarks").upsert(
        { user_id: EP.state.user.id, question_id: id },
        { onConflict: "user_id,question_id", ignoreDuplicates: true }
      );
      if (error) EP.toast(error.message, "error");
      else EP.toast("Bookmarked", "success");
    });
    const delBtn = EP.qs("#del_q_btn");
    if (delBtn) delBtn.addEventListener("click", async function () {
      if (!confirm("Delete this question?")) return;
      await sb().from("questions").update({ is_deleted: true }).eq("id", id);
      EP.toast("Question deleted", "success");
      EP.navigate("/questions");
    });
  });

  // ---- Question create / edit ----
  EP.register("/questions/new", renderQuestionForm, { perms: ["questions.create"] });
  EP.register("/questions/:id/edit", renderQuestionForm, { perms: ["questions.edit"] });

  async function renderQuestionForm(main, path) {
    const id = path.indexOf("/edit") !== -1 ? path.split("/")[2] : null;
    main.innerHTML = EP.spinner("Loading…");
    const hasNcert = await EP.hasColumn("questions", "ncert");
    const [subjects, types, exams] = await Promise.all([loadSubjects(), loadTypes(), sb().from("exams").select("id,name").eq("is_active", true).order("name")]);
    let q = null, opts = [], ans = null, sol = null;
    if (id) {
      const r = await sb().from("questions").select("*").eq("id", id).maybeSingle();
      q = r.data;
      if (!q) { main.innerHTML = '<div class="empty">Question not found.</div>'; return; }
      const o = await sb().from("question_options").select("*").eq("question_id", id).order("display_order");
      opts = o.data || [];
      const a = await sb().from("question_answers").select("*").eq("question_id", id).maybeSingle();
      ans = a.data;
      const s2 = await sb().from("solutions").select("*").eq("question_id", id).maybeSingle();
      sol = s2.data;
    }
    const subjSel = '<select id="f_subj" class="input" required>' + '<option value="">Select subject</option>' + subjects.map(function (s) { return '<option value="' + s.id + '" data-exam="' + s.exam_id + '" ' + (q && q.subject_id === s.id ? "selected" : "") + ">" + EP.esc(s.name) + "</option>"; }).join("") + "</select>";
    const typeSel = '<select id="f_type" class="input" required>' + types.map(function (t) { return '<option value="' + t.id + '" ' + (q && q.question_type_id === t.id ? "selected" : "") + ">" + EP.esc(t.name) + "</option>"; }).join("") + "</select>";
    const examSel = '<select id="f_exam" class="input"><option value="">—</option>' + (exams.data || []).map(function (e) { return '<option value="' + e.id + '" ' + (q && q.exam_id === e.id ? "selected" : "") + ">" + EP.esc(e.name) + "</option>"; }).join("") + "</select>";

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>' + (id ? "Edit" : "New") + " Question</h2>" +
      '<a class="btn btn-sm" href="#/questions">Cancel</a></div>' +
      '<section class="card"><div class="form-grid">' +
        '<div class="field"><label>Exam (optional)</label>' + examSel + "</div>" +
        '<div class="field"><label>Subject</label>' + subjSel + "</div>" +
        '<div class="field"><label>Chapter (optional)</label><select id="f_chap" class="input"></select></div>' +
        '<div class="field"><label>Topic (optional)</label><select id="f_topic" class="input"></select></div>' +
        '<div class="field"><label>Question type</label>' + typeSel + "</div>" +
        '<div class="field"><label>Year</label><input id="f_year" class="input" type="number" value="' + (q ? EP.esc(q.year || "") : "") + '"></div>' +
        '<div class="field"><label>Difficulty</label><select id="f_diff" class="input"><option ' + (!q || q.difficulty === "EASY" ? "selected" : "") + ">EASY</option><option " + (q && q.difficulty === "MEDIUM" ? "selected" : "") + ">MEDIUM</option><option " + (q && q.difficulty === "HARD" ? "selected" : "") + ">HARD</option></select></div>" +
        (hasNcert ? '<div class="field"><label><input id="f_ncert" type="checkbox" style="width:auto"' + (q && q.ncert ? " checked" : "") + '> NCERT question</label></div>' : "") +
        '<div class="field"><label>Marks</label><input id="f_marks" class="input" type="number" step="0.5" value="' + (q ? EP.esc(q.marks || 4) : 4) + '"></div>' +
        '<div class="field"><label>Negative marks</label><input id="f_neg" class="input" type="number" step="0.5" value="' + (q ? EP.esc(q.negative_marks || 1) : 1) + '"></div>' +
      "</div>" +
      '<div class="field"><label>Question text (HTML allowed)</label><textarea id="f_text" class="input" rows="4">' + (q ? EP.esc(q.question_text) : "") + "</textarea>" +
        '<div style="margin-top:6px"><input type="file" id="f_img" accept="image/*"><button class="btn btn-sm btn-ghost" id="f_img_btn" type="button">Insert image</button> <span class="muted" id="f_img_msg"></span></div></div>' +
      '<div id="f_options_wrap"><label>Options</label><div id="opt_list"></div>' +
        '<button class="btn btn-sm btn-ghost" id="add_opt">+ Add option</button>' +
        '<div class="field" style="margin-top:8px"><label>Correct option(s) — comma separated keys (e.g. A or A,B)</label><input id="f_correct" class="input" value="' + (ans ? EP.esc((ans.correct_option_keys || []).join(",")) : "") + '"></div>' +
      "</div>" +
      '<div class="field"><label>Solution</label><textarea id="f_sol" class="input" rows="3">' + (sol ? EP.esc(sol.solution_text || "") : "") + "</textarea></div>" +
      '<div class="btn-row"><button class="btn btn-primary" id="save_q">Save question</button></div>' +
      "</section></div>";

    const chapSel = EP.qs("#f_chap");
    const topicFSel = EP.qs("#f_topic");
    async function loadTops() {
      const cId = chapSel.value;
      const tops = cId ? await loadTopics(cId) : [];
      topicFSel.innerHTML = '<option value="">—</option>' + tops.map(function (t) { return '<option value="' + t.id + '" ' + (q && q.topic_id === t.id ? "selected" : "") + ">" + EP.esc(t.name) + "</option>"; }).join("");
    }
    async function loadCh() {
      const sId = EP.qs("#f_subj").value;
      const chs = sId ? await loadChapters(sId) : [];
      chapSel.innerHTML = '<option value="">—</option>' + chs.map(function (c) { return '<option value="' + c.id + '" ' + (q && q.chapter_id === c.id ? "selected" : "") + ">" + EP.esc(c.name) + "</option>"; }).join("");
      await loadTops();
    }
    await loadCh();
    chapSel.addEventListener("change", loadTops);
    EP.qs("#f_subj").addEventListener("change", loadCh);
    EP.qs("#f_exam").addEventListener("change", function () {
      const eId = EP.qs("#f_exam").value;
      EP.qsa("#f_subj option").forEach(function (o) { o.style.display = (!eId || !o.dataset.exam || o.dataset.exam === eId) ? "" : "none"; });
      loadCh();
    });

    // options UI
    const optList = EP.qs("#opt_list");
    function renderOpts(list) {
      optList.innerHTML = list.map(function (o, i) {
        return '<div class="opt-row"><input class="input opt-key" style="width:60px" value="' + EP.esc(o.option_key) + '"><input class="input opt-text" placeholder="Option text" value="' + EP.esc(o.option_text) + '"><button class="icon-btn del-opt">&times;</button></div>';
      }).join("");
      EP.qsa(".del-opt", optList).forEach(function (b) { b.addEventListener("click", function () { b.parentElement.remove(); }); });
    }
    if (opts.length) renderOpts(opts); else renderOpts([{ option_key: "A", option_text: "" }, { option_key: "B", option_text: "" }, { option_key: "C", option_text: "" }, { option_key: "D", option_text: "" }]);
    EP.qs("#add_opt").addEventListener("click", function () {
      const cur = EP.qsa(".opt-row", optList).length;
      const key = String.fromCharCode(65 + cur);
      const d = document.createElement("div"); d.className = "opt-row";
      d.innerHTML = '<input class="input opt-key" style="width:60px" value="' + key + '"><input class="input opt-text" placeholder="Option text"><button class="icon-btn del-opt">&times;</button>';
      d.querySelector(".del-opt").addEventListener("click", function () { d.remove(); });
      optList.appendChild(d);
    });

    const imgBtn = EP.qs("#f_img_btn");
    if (imgBtn) imgBtn.addEventListener("click", async function () {
      const file = EP.qs("#f_img").files[0];
      if (!file) return EP.toast("Choose an image", "error");
      const path = EP.state.tenantId + "/" + Date.now() + "-" + file.name.replace(/\s+/g, "_");
      try {
        await EP.uploadToStorage("question-images", path, file);
        await EP.recordObject("question-images", path, file);
        const url = await EP.storageSignedUrl("question-images", path);
        const ta = EP.qs("#f_text");
        ta.value = ta.value + '<img src="' + url + '" alt="' + EP.esc(file.name) + '" style="max-width:320px">';
        EP.qs("#f_img_msg").textContent = "inserted";
        EP.toast("Image inserted", "success");
      } catch (e) { EP.toast(e.message || "Upload failed", "error"); }
    });

    EP.qs("#save_q").addEventListener("click", async function () {
      const payload = {
        tenant_id: EP.state.tenantId,
        exam_id: EP.qs("#f_exam").value || null,
        subject_id: EP.qs("#f_subj").value || null,
        chapter_id: EP.qs("#f_chap").value || null,
        topic_id: EP.qs("#f_topic").value || null,
        question_type_id: EP.qs("#f_type").value,
        year: parseInt(EP.qs("#f_year").value || "0", 10) || null,
        difficulty: EP.qs("#f_diff").value,
        marks: parseFloat(EP.qs("#f_marks").value || "4"),
        negative_marks: parseFloat(EP.qs("#f_neg").value || "1"),
        ncert: hasNcert ? (EP.qs("#f_ncert") ? EP.qs("#f_ncert").checked : false) : undefined,
        question_text: EP.qs("#f_text").value,
        verification_status: q ? q.verification_status : "PENDING_REVIEW",
      };
      if (!payload.subject_id) { EP.toast("Subject is required", "error"); return; }
      let qid = id;
      if (id) {
        const { error } = await sb().from("questions").update(payload).eq("id", id);
        if (error) return EP.toast(error.message, "error");
      } else {
        const { data, error } = await sb().from("questions").insert(payload).select("id").single();
        if (error) return EP.toast(error.message, "error");
        qid = data.id;
      }
      // save options (replace)
      await sb().from("question_options").delete().eq("question_id", qid);
      const optRows = EP.qsa(".opt-row", optList);
      const optPayload = optRows.map(function (r, i) {
        return { tenant_id: EP.state.tenantId, question_id: qid, option_key: r.querySelector(".opt-key").value || String.fromCharCode(65 + i), option_text: r.querySelector(".opt-text").value, display_order: i + 1, is_correct: false };
      });
      if (optPayload.length) await sb().from("question_options").insert(optPayload);
      const correct = EP.qs("#f_correct").value.split(",").map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
      await sb().from("question_answers").delete().eq("question_id", qid);
      if (correct.length) await sb().from("question_answers").insert({ tenant_id: EP.state.tenantId, question_id: qid, correct_option_keys: correct });
      const solText = EP.qs("#f_sol").value;
      await sb().from("solutions").delete().eq("question_id", qid);
      if (solText) await sb().from("solutions").insert({ tenant_id: EP.state.tenantId, question_id: qid, solution_text: solText });
      EP.toast("Question saved", "success");
      EP.navigate("/questions/" + qid);
    });
  }

  // ===========================================================================
  // PAPER GENERATION
  // ===========================================================================
  EP.register("/papers", async function (main) {
    main.innerHTML = EP.spinner("Loading papers…");
    const { data, error } = await sb().from("papers").select("id,title,created_at,total_questions,total_marks,status,exam_sessions(count)").order("created_at", { ascending: false }).limit(50);
    let rows = "";
    if (data && data.length) {
      rows = data.map(function (p) {
        return '<tr><td><a href="#/papers/' + p.id + '">' + EP.esc(p.title) + "</a></td><td>" + EP.esc(p.status) + "</td><td>" + (p.total_questions || 0) + "</td><td>" + EP.fmtMarks(p.total_marks) + "</td><td>" + EP.fmtDate(p.created_at) + "</td></tr>";
      }).join("");
    } else rows = '<tr><td colspan="5" class="muted">No papers yet.</td></tr>';
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Papers</h2>' + (EP.can("papers.generate") ? '<div class="btn-row"><a class="btn btn-primary" href="#/papers/new">Auto Generate</a><a class="btn btn-primary" href="#/papers/new/manual">Manual</a><a class="btn btn-primary" href="#/papers/new/expert">Expert</a></div>' : "") + "</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Title</th><th>Status</th><th>Questions</th><th>Marks</th><th>Created</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
  });

  // Eligible-question funnel (spec §69): never show a bare "Insufficient
  // eligible questions". Render Requested / Verified / Excluded / Eligible
  // with per-chapter and per-difficulty breakdown from app_get_eligible_questions.
  EP.renderEligibilityBreakdown = async function (el, spec) {
    el.innerHTML = EP.spinner("Analysing eligible question pool…");
    const rpcSpec = {
      exam_id: spec.exam_id,
      limit: 1,
      exclude_used: spec.filters && spec.filters.exclude_used ? true : false,
    };
    if (spec.filters) {
      const f = spec.filters;
      const first = function (v) { return Array.isArray(v) && v.length ? v[0] : (v || undefined); };
      const s = first(f.subject_ids || f.subject_id);
      if (s) rpcSpec.subject_id = s;
      const c = first(f.chapter_ids || f.chapter_id);
      if (c) rpcSpec.chapter_id = c;
      const t = first(f.topic_ids || f.topic_id);
      if (t) rpcSpec.topic_id = t;
      const y = first(f.years || f.year);
      if (y) rpcSpec.year = y;
      const d = first(f.difficulties || f.difficulty);
      if (d) rpcSpec.difficulty = d;
      const q = first(f.question_type_ids || f.question_type_id);
      if (q) rpcSpec.question_type_id = q;
      if (f.is_pyq !== undefined) rpcSpec.is_pyq = f.is_pyq;
      if (f.ncerts !== undefined) rpcSpec.ncerts = f.ncerts;
      if (f.language) rpcSpec.language = f.language;
    }
    const { data, error } = await sb().rpc("app_get_eligible_questions", { p_spec: rpcSpec });
    if (error || !data || data.error) {
      el.innerHTML = '<div class="empty error">Could not analyse the question pool: ' +
        EP.esc((error && error.message) || (data && data.error) || "unknown error") + "</div>";
      return;
    }
    const requested = spec.count || 0;
    const base = data.base_count || 0;
    const verified = Math.max(base - (data.rejection_reasons && data.rejection_reasons.by_verification || data.by_verification || 0), 0);
    const filtered = data.by_filters || 0;
    const excludedUsed = data.by_used || 0;
    const eligible = data.eligible_count || 0;
    const rr = data.rejection_reasons || {};
    const row = function (label, val, bad) {
      return '<tr><td>' + label + "</td><td><b" + (bad ? ' class="bad-text"' : "") + ">" + val + "</b></td></tr>";
    };
    const chapterRows = (data.chapter_breakdown || []).slice(0, 8).map(function (c) {
      return '<tr><td>' + EP.esc(c.name || "—") + "</td><td>" + c.count + "</td></tr>";
    }).join("");
    const diffRows = (data.difficulty_breakdown || []).map(function (d) {
      return '<tr><td>' + EP.esc(d.difficulty) + "</td><td>" + d.count + "</td></tr>";
    }).join("");
    el.innerHTML =
      '<div class="empty">' +
      "<b>Generation failed:</b> " + (data.error || "insufficient eligible questions") + "<br>" +
      "The pool breakdown below shows exactly why. " +
      '<a class="btn btn-sm" href="#/questions/health">Question Bank Health</a> ' +
      '<a class="btn btn-sm" href="#/questions/import">Import questions</a>' +
      "</div>" +
      '<table class="data-table" style="margin-top:10px;max-width:560px">' +
        "<thead><tr><th>Metric</th><th>Count</th></tr></thead><tbody>" +
        row("Requested", requested) +
        row("Base pool (tenant + platform bank)", base) +
        row("Verified questions", verified) +
        row("Rejected by verification status", rr.by_verification || data.by_verification || 0, true) +
        row("Rejected by exam scope", rr.by_exam_scope || data.by_exam || 0, true) +
        row("Match exam + filters (before usage)", filtered) +
        row("Excluded as already used (no-repeat)", excludedUsed, true) +
        row("Eligible (usable now)", eligible, eligible < requested) +
        "</tbody></table>" +
      (data.missing_solution !== undefined ? '<p class="muted" style="margin-top:6px">Questions missing solutions: ' + data.missing_solution + "</p>" : "") +
      (data.missing_answer !== undefined ? '<p class="muted">Questions missing answers: ' + data.missing_answer + "</p>" : "") +
      '<div class="hint" style="margin-top:8px"><b>Suggestions:</b> ' +
      "• Reduce the requested count to " + Math.max(eligible, 0) + " • Remove the no-repeat filter • Widen chapter/year range • " +
      'Use <a href="#/papers/new/manual">manual selection</a> or <a href="#/papers/new/expert">expert mode</a>.</div>' +
      (chapterRows || diffRows
        ? '<details style="margin-top:8px"><summary>Available by chapter and difficulty</summary>' +
          (chapterRows ? '<table class="data-table" style="margin-top:6px"><thead><tr><th>Chapter</th><th>Verified questions</th></tr></thead><tbody>' + chapterRows + "</tbody></table>" : "") +
          (diffRows ? '<table class="data-table" style="margin-top:6px"><thead><tr><th>Difficulty</th><th>Verified questions</th></tr></thead><tbody>' + diffRows + "</tbody></table>" : "") +
          "</details>"
        : "");
  };

  EP.register("/papers/new", async function (main) {
    main.innerHTML = EP.spinner("Loading…");
    const { data: exams } = await sb().from("exams").select("id,name,code").eq("is_active", true).order("name");
    const { data: types } = await sb().from("question_types").select("id,code,name").eq("is_active", true);
    const { data: subjects } = await sb().from("subjects").select("id,name,exam_id").order("name");
    const examOpts = '<option value="">Select exam</option>' + (exams || []).map(function (e) { return '<option value="' + e.id + '">' + EP.esc(e.name) + "</option>"; }).join("");
    const subjOpts = '<option value="">All subjects</option>' + (subjects || []).map(function (s) { return '<option value="' + s.id + '" data-exam="' + s.exam_id + '">' + EP.esc(s.name) + "</option>"; }).join("");

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Generate Paper</h2><a class="btn btn-sm" href="#/papers">Cancel</a></div>' +
      '<section class="card"><div class="form-grid">' +
        '<div class="field"><label>Exam</label><select id="p_exam" class="input">' + examOpts + "</select></div>" +
        '<div class="field"><label>Number of questions</label><input id="p_count" class="input" type="number" value="10"></div>' +
        '<div class="field"><label>Marks per question</label><input id="p_marks" class="input" type="number" step="0.5" value="4"></div>' +
        '<div class="field"><label>Negative marks</label><input id="p_neg" class="input" type="number" step="0.5" value="1"></div>' +
        '<div class="field"><label>Duration (min)</label><input id="p_dur" class="input" type="number" value="180"></div>' +
      "</div>" +
      '<div id="p_pattern_info" class="hint" style="margin:10px 0 0"></div>' +
      '<div class="form-grid">' +
        '<div class="field"><label>Subject filter (optional)</label><select id="p_subj" class="input">' + subjOpts + "</select></div>" +
        '<div class="field"><label>Chapter filter (optional)</label><select id="p_chap" class="input"><option value="">—</option></select></div>' +
        '<div class="field"><label>Difficulty (optional)</label><select id="p_diff" class="input"><option value="">Any</option><option>EASY</option><option>MEDIUM</option><option>HARD</option></select></div>' +
        '<div class="field"><label>Language (optional)</label><select id="p_lang" class="input"><option value="">Any</option><option value="EN">English</option><option value="HI">Hindi</option><option value="GU">Gujarati</option></select></div>' +
        '<div class="field"><label>Year (optional)</label><input id="p_year" class="input" type="number" placeholder="e.g. 2024"></div>' +
        '<div class="field"><label><input id="p_norepeat" type="checkbox" style="width:auto"> Exclude questions already used in earlier papers/DPPs (no-repeat)</label></div>' +
      "</div>" +
      '<div class="field"><label>Title</label><input id="p_title" class="input" placeholder="My Practice Paper"></div>' +
      '<div class="field"><label>Instructions (shown on the paper header, optional)</label><textarea id="p_inst" class="input" rows="3" placeholder="e.g. All questions are compulsory. Each correct answer carries +4 marks, −1 for wrong."></textarea></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="gen_btn">Generate</button></div>' +
      '<div id="gen_result"></div>' +
      "</section></div>";

    const examSel = EP.qs("#p_exam"), subjSel = EP.qs("#p_subj"), chapSel = EP.qs("#p_chap");
    // §11: show which official configuration drives generation (data-driven
    // from the active exam_patterns row — never hardcoded per exam).
    async function loadPatternInfo() {
      const box = EP.qs("#p_pattern_info");
      if (!box) return;
      const examId = examSel.value;
      if (!examId) { box.innerHTML = ""; return; }
      const { data: pat } = await sb().from("exam_patterns")
        .select("id, name, version, academic_year, duration_minutes, total_questions, total_marks, effective_from, effective_to, official_source_url, official_document_title, verified_at")
        .eq("exam_id", examId).eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
      if (!pat) { box.innerHTML = '<span class="badge b-warn">No active pattern</span> <span class="muted">Defaults will come from this form; configure an official pattern under Exam Patterns.</span>'; return; }
      const expired = pat.effective_to && new Date(pat.effective_to) < new Date();
      const src = pat.official_document_title
        ? 'Pattern source: ' + EP.esc(pat.official_document_title) + (pat.official_source_url ? ' (<a href="' + EP.esc(pat.official_source_url) + '" target="_blank" rel="noopener">official</a>)' : '')
        : 'Pattern source: <span class="muted">not configured</span>';
      const ver = pat.verified_at
        ? "Last verified: " + new Date(pat.verified_at).toLocaleDateString()
        : '<span class="badge b-warn">Unverified</span> run “Verify Official Pattern” (Exam Patterns) before official use';
      const meta = "Pattern: " + EP.esc(pat.name) + " · v" + pat.version + (pat.academic_year ? " (" + pat.academic_year + ")" : "") +
        (pat.total_questions ? " · " + pat.total_questions + "Q / " + EP.fmtMarks(pat.total_marks) + "M" : "") + " · " + (pat.duration_minutes || "—") + " min";
      box.innerHTML = '<div>' + meta + "</div><div>" + src + "</div><div>" + ver + "</div>" +
        (expired ? '<div class="empty error">Official pattern verification required before generating a current-year paper.</div>' : "");
    }
    examSel.addEventListener("change", loadPatternInfo);
    function syncSubjects() {
      const eId = examSel.value;
      EP.qsa("#p_subj option").forEach(function (o) { o.style.display = (!eId || !o.dataset.exam || o.dataset.exam === eId) ? "" : "none"; });
      subjSel.value = "";
    }
    examSel.addEventListener("change", syncSubjects);
    subjSel.addEventListener("change", async function () {
      chapSel.innerHTML = '<option value="">—</option>';
      if (subjSel.value) {
        const { data: ch } = await sb().from("chapters").select("id,name").eq("subject_id", subjSel.value).order("display_order");
        chapSel.innerHTML += (ch || []).map(function (c) { return '<option value="' + c.id + '">' + EP.esc(c.name) + "</option>"; }).join("");
      }
    });

    EP.qs("#gen_btn").addEventListener("click", async function () {
      const examId = examSel.value;
      if (!examId) { EP.toast("Select an exam", "error"); return; }
      const filters = {};
      if (subjSel.value) filters.subject_ids = [subjSel.value];
      if (chapSel.value) filters.chapter_ids = [chapSel.value];
      if (EP.qs("#p_diff").value) filters.difficulties = [EP.qs("#p_diff").value];
      if (EP.qs("#p_lang") && EP.qs("#p_lang").value) filters.language = EP.qs("#p_lang").value;
      if (EP.qs("#p_year").value) filters.years = [parseInt(EP.qs("#p_year").value, 10)];
      if (EP.qs("#p_norepeat") && EP.qs("#p_norepeat").checked) filters.exclude_used = "true";
      const spec = {
        exam_id: examId,
        count: parseInt(EP.qs("#p_count").value, 10) || 10,
        title: EP.qs("#p_title").value || "Generated Paper",
        marks: parseFloat(EP.qs("#p_marks").value || "4"),
        negative_marks: parseFloat(EP.qs("#p_neg").value || "1"),
        duration_minutes: parseInt(EP.qs("#p_dur").value, 10) || 180,
        instructions: EP.qs("#p_inst") ? EP.qs("#p_inst").value : "",
        filters: filters,
      };
      EP.qs("#gen_btn").disabled = true;
      EP.qs("#gen_result").innerHTML = EP.spinner("Generating (server-authoritative)…");
      const { data, error } = await sb().rpc("app_generate_paper", { p_spec: spec });
      EP.qs("#gen_btn").disabled = false;
      if (error) { EP.qs("#gen_result").innerHTML = '<div class="empty error">' + EP.esc(error.message) + "</div>"; return; }
      if (data && data.error) {
        if (/quota/i.test(data.error)) {
          EP.qs("#gen_result").innerHTML = '<div class="empty error"><b>Generation blocked:</b> ' + EP.esc(data.error) +
            '<br><a class="btn btn-sm" href="#/admin/plans">Plans</a> <a class="btn btn-sm" href="#/admin/usage">Usage</a></div>';
        } else {
          EP.renderEligibilityBreakdown(EP.qs("#gen_result"), spec);
        }
        return;
      }
      EP.qs("#gen_result").innerHTML = '<div class="empty ok"><b>Paper generated!</b> ' + data.questions + " questions, " + EP.fmtMarks(data.total_marks) + ' marks. <a class="btn btn-primary btn-sm" href="#/papers/' + data.paper_id + '">Open</a></div>';
    });
  });

  // ---- Manual Paper Generator (staff: direct question selection) ----
  EP.register("/papers/new/manual", async function (main) {
    if (!EP.can("papers.generate") || EP.roleType() === "student") { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading…");
    const [examsRes, subjsRes, typesRes] = await Promise.all([
      sb().from("exams").select("id,name,code").eq("is_active", true).order("name"),
      sb().from("subjects").select("id,name,exam_id").order("name"),
      sb().from("question_types").select("id,code,name").eq("is_active", true).order("name")
    ]);
    const exams = examsRes.data || [], subjects = subjsRes.data || [], types = typesRes.data || [];
    const examOpts = '<option value="">Select exam</option>' + exams.map(function (e) { return '<option value="' + e.id + '">' + EP.esc(e.name) + "</option>"; }).join("");
    const subjOpts = '<option value="">All subjects</option>' + subjects.map(function (s) { return '<option value="' + s.id + '" data-exam="' + s.exam_id + '">' + EP.esc(s.name) + "</option>"; }).join("");
    const typeOpts = '<option value="">All types</option>' + types.map(function (t) { return '<option value="' + t.id + '">' + EP.esc(t.name) + "</option>"; }).join("");

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Manual Paper Generator</h2><a class="btn btn-sm" href="#/papers">Cancel</a></div>' +
      '<section class="card"><div class="form-grid">' +
        '<div class="field"><label>Title</label><input id="mp_title" class="input" placeholder="My Paper"></div>' +
        '<div class="field"><label>Exam</label><select id="mp_exam" class="input">' + examOpts + '</select></div>' +
        '<div class="field"><label>Subject</label><select id="mp_subj" class="input">' + subjOpts + '</select></div>' +
        '<div class="field"><label>Difficulty</label><select id="mp_diff" class="input"><option value="">Any</option><option>EASY</option><option>MEDIUM</option><option>HARD</option></select></div>' +
        '<div class="field"><label>Question type</label><select id="mp_type" class="input">' + typeOpts + '</select></div>' +
        '<div class="field"><label>Marks per question</label><input id="mp_marks" class="input" type="number" step="0.5" value="4"></div>' +
        '<div class="field"><label>Negative marks</label><input id="mp_neg" class="input" type="number" step="0.5" value="1"></div>' +
        '<div class="field"><label>Duration (min)</label><input id="mp_dur" class="input" type="number" value="180"></div>' +
      '</div><button class="btn btn-sm" id="mp_search">Search Questions</button></section>' +
      '<div class="grid-2">' +
        '<section class="card"><h3>Available Questions</h3><div id="mp_qlist"></div><div id="mp_qpager"></div></section>' +
        '<section class="card"><h3>Selected (<span id="mp_sel_count">0</span>)</h3><div id="mp_selected"></div>' +
        '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="mp_gen">Generate Paper</button></div></section>' +
      '</div></div>';

    const selected = [];
    const examSel = EP.qs("#mp_exam"), subjSel = EP.qs("#mp_subj");
    function syncSubj() {
      const eId = examSel.value;
      EP.qsa("#mp_subj option").forEach(function (o) { o.style.display = (!eId || !o.dataset.exam || o.dataset.exam === eId) ? "" : "none"; });
    }
    examSel.addEventListener("change", syncSubj);

    async function searchQuestions() {
      const listEl = EP.qs("#mp_qlist");
      listEl.innerHTML = EP.spinner("Searching…");
      let q = sb().from("questions").select("id, question_text, difficulty, year, question_types(name), subjects(name)", { count: "exact" });
      q = q.eq("is_deleted", false).eq("verification_status", "VERIFIED");
      if (examSel.value) q = q.eq("exam_id", examSel.value);
      if (subjSel.value) q = q.eq("subject_id", subjSel.value);
      if (EP.qs("#mp_diff").value) q = q.eq("difficulty", EP.qs("#mp_diff").value);
      if (EP.qs("#mp_type").value) q = q.eq("question_type_id", EP.qs("#mp_type").value);
      q = q.order("created_at", { ascending: false }).range(0, 49);
      const { data, count, error } = await q;
      if (error) { listEl.innerHTML = '<div class="empty error">' + EP.esc(error.message) + "</div>"; return; }
      if (!data || !data.length) { listEl.innerHTML = '<div class="empty">No questions found.</div>'; return; }
      const rows = data.map(function (r) {
        const sel = selected.some(function (s) { return s.id === r.id; });
        return '<div class="q-item" style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--line)">' +
          '<button class="btn btn-sm ' + (sel ? 'btn-danger' : '') + '" data-mpq-add="' + r.id + '">' + (sel ? 'Remove' : 'Add') + '</button>' +
          '<div style="flex:1;min-width:0">' + EP.esc((r.question_text || "").replace(/<[^>]+>/g, "").slice(0, 120)) + '</div>' +
          '<span class="badge b-' + (r.difficulty === 'EASY' ? 'ok' : r.difficulty === 'HARD' ? 'bad' : 'warn') + '">' + EP.esc(r.difficulty || '—') + '</span>' +
          '<span class="muted">' + EP.esc((r.subjects && r.subjects.name) || '—') + '</span>' +
          '</div>';
      }).join("");
      listEl.innerHTML = rows;
      EP.qsa("[data-mpq-add]").forEach(function (b) {
        b.addEventListener("click", function () {
          const qid = b.getAttribute("data-mpq-add");
          const q = data.find(function (x) { return x.id === qid; });
          if (!q) return;
          const idx = selected.findIndex(function (s) { return s.id === qid; });
          if (idx >= 0) { selected.splice(idx, 1); b.textContent = "Add"; b.classList.remove("btn-danger"); }
          else { selected.push({ id: q.id, marks: parseFloat(EP.qs("#mp_marks").value || "4"), negative_marks: parseFloat(EP.qs("#mp_neg").value || "1") }); b.textContent = "Remove"; b.classList.add("btn-danger"); }
          renderSelected();
        });
      });
    }
    function renderSelected() {
      EP.qs("#mp_sel_count").textContent = selected.length;
      const el = EP.qs("#mp_selected");
      if (!selected.length) { el.innerHTML = '<div class="muted">No questions selected yet.</div>'; return; }
      el.innerHTML = selected.map(function (s, i) {
        return '<div class="q-item" style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px solid var(--line)">' +
          '<span style="flex:1">' + (i + 1) + '. Q-' + s.id.slice(0, 8) + '</span>' +
          '<span class="muted">' + s.marks + 'm / −' + s.negative_marks + '</span>' +
          '<button class="btn btn-sm btn-danger" data-mpq-rem="' + s.id + '">×</button></div>';
      }).join("");
      EP.qsa("[data-mpq-rem]").forEach(function (b) {
        b.addEventListener("click", function () {
          const qid = b.getAttribute("data-mpq-rem");
          const idx = selected.findIndex(function (s) { return s.id === qid; });
          if (idx >= 0) selected.splice(idx, 1);
          renderSelected();
          searchQuestions();
        });
      });
    }
    EP.qs("#mp_search").addEventListener("click", searchQuestions);
    examSel.addEventListener("change", searchQuestions);
    subjSel.addEventListener("change", searchQuestions);
    EP.qs("#mp_diff").addEventListener("change", searchQuestions);
    EP.qs("#mp_type").addEventListener("change", searchQuestions);

    EP.qs("#mp_gen").addEventListener("click", async function () {
      if (!selected.length) { EP.toast("Select at least one question", "error"); return; }
      const examId = examSel.value;
      if (!examId) { EP.toast("Select an exam", "error"); return; }
      const title = EP.qs("#mp_title").value || "Manual Paper";
      const dur = parseInt(EP.qs("#mp_dur").value, 10) || 180;
      const marks = parseFloat(EP.qs("#mp_marks").value || "4");
      const neg = parseFloat(EP.qs("#mp_neg").value || "1");
      const { data, error } = await sb().rpc("app_create_manual_paper", {
        p_tenant_id: EP.state.tenantId, p_exam_id: examId, p_title: title,
        p_duration: dur, p_marks: marks, p_neg: neg, p_questions: selected.map(function (s) { return s.id; })
      });
      if (error) { EP.toast(error.message, "error"); return; }
      if (data && data.error) { EP.toast(data.error, "error"); return; }
      EP.toast("Paper created", "success");
      EP.navigate("/papers/" + data.paper_id);
    });
  });

  // ---- Expert Paper Generator (Blueprint Editor) ----
  EP.register("/papers/new/expert", async function (main) {
    if (!EP.can("papers.generate") || EP.roleType() === "student") { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading…");
    const [examsRes, subjsRes, typesRes] = await Promise.all([
      sb().from("exams").select("id,name").eq("is_active", true).order("name"),
      sb().from("subjects").select("id,name,exam_id").order("name"),
      sb().from("question_types").select("id,code,name").eq("is_active", true).order("name"),
    ]);
    const exams = examsRes.data || [], subjects = subjsRes.data || [], types = typesRes.data || [];
    const examOpts = '<option value="">Select exam</option>' + exams.map(function (e) { return '<option value="' + e.id + '">' + EP.esc(e.name) + "</option>"; }).join("");

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Expert Paper Generator</h2><a class="btn btn-sm" href="#/papers">Cancel</a></div>' +
      '<section class="card"><div class="form-grid">' +
        '<div class="field"><label>Title</label><input id="ep_title" class="input" placeholder="Expert Paper"></div>' +
        '<div class="field"><label>Exam</label><select id="ep_exam" class="input">' + examOpts + '</select></div>' +
        '<div class="field"><label>Duration (min)</label><input id="ep_dur" class="input" type="number" value="180"></div>' +
        '<div class="field" style="grid-column:1/-1"><label><input id="ep_norepeat" type="checkbox" style="width:auto"> Exclude questions already used in earlier papers/DPPs (no-repeat)</label></div>' +
      '</div>' +
      '<h4>Blueprint Sections</h4>' +
      '<div id="ep_sections"></div>' +
      '<button class="btn btn-sm btn-ghost" id="ep_add_sec">+ Add Section</button>' +
      '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="ep_gen">Generate Paper</button></div>' +
      '<div id="ep_result"></div></section></div>';

    const sections = [];
    function renderSections() {
      const el = EP.qs("#ep_sections");
      if (!sections.length) { el.innerHTML = '<div class="muted">No sections defined. Add at least one.</div>'; return; }
      el.innerHTML = sections.map(function (sec, i) {
        return '<div class="card" style="margin-bottom:8px;padding:10px">' +
          '<div class="form-grid">' +
            '<div class="field"><label>Section name</label><input class="input ep-sec-name" data-i="' + i + '" value="' + EP.esc(sec.name) + '"></div>' +
            '<div class="field"><label>Subject</label><select class="input ep-sec-subj" data-i="' + i + '"><option value="">—</option>' + (subjects || []).map(function (s) { return '<option value="' + s.id + '" ' + (sec.subject_id === s.id ? 'selected' : '') + '>' + EP.esc(s.name) + '</option>'; }).join("") + '</select></div>' +
            '<div class="field"><label>Question type</label><select class="input ep-sec-type" data-i="' + i + '"><option value="">Any</option>' + (types || []).map(function (t) { return '<option value="' + t.id + '" ' + (sec.question_type_id === t.id ? 'selected' : '') + '>' + EP.esc(t.name) + '</option>'; }).join("") + '</select></div>' +
            '<div class="field"><label>Count</label><input class="input ep-sec-count" data-i="' + i + '" type="number" value="' + sec.count + '"></div>' +
            '<div class="field"><label>Marks</label><input class="input ep-sec-marks" data-i="' + i + '" type="number" step="0.5" value="' + sec.marks + '"></div>' +
            '<div class="field"><label>Negative marks</label><input class="input ep-sec-neg" data-i="' + i + '" type="number" step="0.5" value="' + sec.negative_marks + '"></div>' +
            '<div class="field"><label>Difficulty mix (comma: EASY,MEDIUM,HARD)</label><input class="input ep-sec-diff" data-i="' + i + '" value="' + (sec.difficulties || "") + '" placeholder="EASY,MEDIUM,HARD"></div>' +
          '</div>' +
          '<button class="btn btn-sm btn-danger" data-ep-rem="' + i + '">Remove section</button></div>';
      }).join("");
      EP.qsa("[data-ep-rem]").forEach(function (b) {
        b.addEventListener("click", function () { sections.splice(parseInt(b.getAttribute("data-ep-rem"), 10), 1); renderSections(); });
      });
    }
    EP.qs("#ep_add_sec").addEventListener("click", function () {
      sections.push({ name: "Section " + (sections.length + 1), subject_id: "", question_type_id: "", count: 10, marks: 4, negative_marks: 1, difficulties: "" });
      renderSections();
    });
    function readSections() {
      sections.forEach(function (sec, i) {
        const nameEl = EP.qs(".ep-sec-name[data-i='" + i + "']");
        if (nameEl) sec.name = nameEl.value;
        const subjEl = EP.qs(".ep-sec-subj[data-i='" + i + "']");
        if (subjEl) sec.subject_id = subjEl.value;
        const typeEl = EP.qs(".ep-sec-type[data-i='" + i + "']");
        if (typeEl) sec.question_type_id = typeEl.value;
        const countEl = EP.qs(".ep-sec-count[data-i='" + i + "']");
        if (countEl) sec.count = parseInt(countEl.value, 10) || 0;
        const marksEl = EP.qs(".ep-sec-marks[data-i='" + i + "']");
        if (marksEl) sec.marks = parseFloat(marksEl.value) || 4;
        const negEl = EP.qs(".ep-sec-neg[data-i='" + i + "']");
        if (negEl) sec.negative_marks = parseFloat(negEl.value) || 1;
        const diffEl = EP.qs(".ep-sec-diff[data-i='" + i + "']");
        if (diffEl) sec.difficulties = diffEl.value;
      });
    }
    EP.qs("#ep_gen").addEventListener("click", async function () {
      readSections();
      if (!sections.length) { EP.toast("Add at least one section", "error"); return; }
      const examId = EP.qs("#ep_exam").value;
      if (!examId) { EP.toast("Select an exam", "error"); return; }
      const title = EP.qs("#ep_title").value || "Expert Paper";
      const dur = parseInt(EP.qs("#ep_dur").value, 10) || 180;
      const totalQ = sections.reduce(function (s, sec) { return s + sec.count; }, 0);
      const totalMarks = sections.reduce(function (s, sec) { return s + sec.count * sec.marks; }, 0);
      const qOk = await sb().rpc("app_quota_available", { p_tenant_id: EP.state.tenantId, p_metric: "PAPERS_GENERATED", p_limit: 5 });
      if (!qOk.data) { EP.toast("Free paper quota reached. Upgrade plan to generate more.", "error"); return; }
      const { data: pattern } = await sb().from("exam_patterns").select("id").eq("exam_id", examId).eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
      const { data: paper, error } = await sb().from("papers").insert({
        tenant_id: EP.state.tenantId, exam_id: examId, exam_pattern_id: pattern ? pattern.id : null,
        title: title, duration_minutes: dur, total_questions: totalQ, total_marks: totalMarks,
        status: "LOCKED", created_by: EP.state.user.id
      }).select("id").single();
      if (error) { EP.toast(error.message, "error"); return; }
      let order = 0;
      const norepeat = EP.qs("#ep_norepeat").checked;
      const excludedIds = new Set();
      const shortages = [];
      if (norepeat) {
        const { data: used } = await sb().from("question_usage").select("question_id").eq("tenant_id", EP.state.tenantId);
        (used || []).forEach(function (u) { excludedIds.add(u.question_id); });
      }
      for (const sec of sections) {
        if (!sec.subject_id && !sec.question_type_id) continue;
        let q = sb().from("questions").select("id", { count: "exact" });
        q = q.eq("is_deleted", false).eq("verification_status", "VERIFIED").eq("exam_id", examId);
        if (excludedIds.size) q = q.not("id", "in", "(" + Array.from(excludedIds).join(",") + ")");
        if (sec.subject_id) q = q.eq("subject_id", sec.subject_id);
        if (sec.question_type_id) q = q.eq("question_type_id", sec.question_type_id);
        if (sec.difficulties) {
          const diffs = sec.difficulties.split(",").map(function (d) { return d.trim().toUpperCase(); }).filter(Boolean);
          if (diffs.length) q = q.in("difficulty", diffs);
        }
        const { data: qs } = await q.order("random()").limit(sec.count);
        const pool = qs || [];
        if (pool.length < sec.count) {
          shortages.push("Section " + EP.esc(sec.name) + ": requested " + sec.count + ", available " + pool.length +
            (excludedIds.size ? " (after excluding " + excludedIds.size + " already-used)" : ""));
        }
        for (const qItem of pool) {
          order++;
          excludedIds.add(qItem.id);
          const { data: snap } = await sb().rpc("app_question_snapshot", { p_qid: qItem.id, p_marks: sec.marks, p_neg: sec.negative_marks });
          await sb().from("paper_questions").insert({
            tenant_id: EP.state.tenantId, paper_id: paper.id, question_id: qItem.id,
            question_order: order, marks: sec.marks, negative_marks: sec.negative_marks, snapshot: snap
          });
          await sb().from("question_usage").insert({ tenant_id: EP.state.tenantId, question_id: qItem.id, used_in_type: "PAPER", used_in_id: paper.id });
        }
      }
      await sb().from("papers").update({ total_marks: totalMarks }).eq("id", paper.id);
      EP.qs("#ep_result").innerHTML = shortages.length
        ? '<div class="empty error"><b>Paper generated with shortages:</b> the paper was created, but some sections could not be filled completely.<ul style="margin:8px 0 0 18px">' +
          shortages.map(function (s) { return "<li>" + s + "</li>"; }).join("") +
          '</ul><span class="muted">Suggestions: remove no-repeat, widen the difficulty mix, or add more verified questions to the bank.</span></div>'
        : '<div class="empty ok">Paper generated with ' + order + ' questions, ' + totalMarks + ' marks. <a class="btn btn-primary btn-sm" href="#/papers/' + paper.id + '">Open</a></div>';
    });
  });

  // ---- Paper preview / printable ----
  EP.register("/papers/:id", async function (main, path) {
    const id = path.split("/").pop();
    main.innerHTML = EP.spinner("Loading paper…");
    const { data: p } = await sb().from("papers").select("*").eq("id", id).maybeSingle();
    if (!p) { main.innerHTML = '<div class="empty">Paper not found.</div>'; return; }
    const { data: qs } = await sb().from("paper_questions").select("question_order, marks, negative_marks, snapshot").eq("paper_id", id).order("question_order");
    let branding = "";
    if (EP.state.tenantId) { const { data: t } = await sb().from("tenants").select("name,logo_url,address,watermark_url,header_text,footer_text").eq("id", EP.state.tenantId).maybeSingle(); if (t) branding = t; }

    const header =
      '<div class="print-head">' +
      (branding && branding.logo_url ? '<img class="logo-img" src="' + EP.esc(branding.logo_url) + '">' : '<div class="logo">E</div>') +
      '<div><div class="ph-name">' + EP.esc((branding && branding.name) || "ExamPro") + "</div>" +
      (branding && branding.header_text ? '<div class="ph-sub">' + EP.esc(branding.header_text) + "</div>" : '<div class="ph-sub">' + EP.esc(p.title) + "</div>") +
      "</div>" +
      '<div class="ph-meta">Duration: ' + (p.duration_minutes || "—") + " min · Total Marks: " + EP.fmtMarks(p.total_marks) + " · Questions: " + (p.total_questions || 0) + "</div></div>" +
      (branding && branding.watermark_url ? '<div class="watermark"><img src="' + EP.esc(branding.watermark_url) + '"></div>' : "");

    const body = (qs || []).map(function (pq) {
      const sn = pq.snapshot || {};
      const opts = (sn.options || []).map(function (o) { return "<li><b>" + EP.esc(o.option_key) + ".</b> " + EP.esc(o.option_text) + "</li>"; }).join("");
      return '<div class="pq"><div class="pq-h">Q' + pq.question_order + ". (" + EP.fmtMarks(pq.marks) + " marks" + (pq.negative_marks ? ", −" + pq.negative_marks + " neg" : "") + ")</div>" +
        '<div class="pq-q">' + EP.safeHtml(sn.question_text || "") + "</div>" +
        (opts ? '<ol class="opts">' + opts + "</ol>" : "") + "</div>";
    }).join("");

    const instructions = (p.instructions || (branding && branding.header_text) || "").trim()
      ? '<div class="ph-inst"><b>Instructions:</b> ' + EP.esc(p.instructions || (branding && branding.header_text) || "") + "</div>"
      : "";

    main.innerHTML =
      '<div class="page"><div class="page-head no-print"><h2>' + EP.esc(p.title) + "</h2>" +
      '<div class="btn-row"><button class="btn btn-primary btn-sm" id="print_btn">Print / PDF</button>' +
      '<button class="btn btn-sm" id="pdf_btn">Download PDF</button>' +
      '<button class="btn btn-sm" id="pdf_ak_btn">Download Answer Key PDF</button>' +
      '<button class="btn btn-sm" id="pdf_sol_btn">Download Solutions PDF</button>' +
      '<button class="btn btn-sm" id="save_drive_btn">Save to Drive</button>' +
      '<button class="btn btn-sm" id="save_ak_btn">Save Answer Key to Drive</button>' +
      '<button class="btn btn-sm" id="save_sol_btn">Save Solutions to Drive</button>' +
      '<button class="btn btn-sm" id="pptx_btn">Export PPTX</button>' +
      '<a class="btn btn-sm" href="#/papers">Back</a>' +
      (EP.can("papers.generate") ? '<button class="btn btn-sm" id="ans_btn">Show answer key</button>' : "") +
      (EP.can("papers.generate") ? '<button class="btn btn-sm" id="sol_btn">Show solutions</button>' : "") +
      (EP.can("papers.delete") ? '<button class="btn btn-sm btn-danger" id="del_paper_btn">Delete</button>' : "") + "</div></div>" +
      '<div class="paper-sheet" id="paper_sheet">' + header + (instructions ? "<hr>" + instructions : "") + '<hr>' + body + '</div>' +
      '<div class="ph-footer no-print">' + EP.esc((branding && branding.name) || "ExamPro") + ' · ' + EP.esc((branding && branding.address) || "") + ' · Page <span class="page-number"></span></div>' +
      '<div class="answer-key" id="answer_key" style="display:none"><h3>Answer Key</h3><ol>' +
      (qs || []).map(function (pq) { const sn = pq.snapshot || {}; const ans = sn.answer || {}; return "<li>" + EP.esc((ans.correct_option_keys || []).join(", ") || ans.numerical_answer || "—") + "</li>"; }).join("") + "</ol></div>" +
      '<div class="answer-key" id="solutions_key" style="display:none"><h3>Solutions</h3><ol>' +
      (qs || []).map(function (pq) {
        const sn = pq.snapshot || {};
        const ans = sn.answer || {}, sol = sn.solution || {};
        const answer = EP.esc((ans.correct_option_keys || []).join(", ") || ans.numerical_answer || "—");
        const solText = EP.safeHtml(sol.solution_text || sol.detailed_solution || sol.short_solution || (sol.concept ? "Concept: " + sol.concept : "") || "—");
        return "<li><b>Answer:</b> " + answer + "<br><b>Solution:</b> " + solText + "</li>";
      }).join("") + "</ol></div>" +
      "</div>";
    EP.qs("#print_btn").addEventListener("click", function () { window.print(); });
    const pdfItems = (qs || []).map(function (pq) { return pq.snapshot || {}; });
    const pdfPaper = p, pdfBrand = branding;
    const pfb = EP.qs("#pdf_btn");
    if (pfb) pfb.addEventListener("click", function () { EP.pdf.downloadPaper({ paper: pdfPaper, items: pdfItems, branding: pdfBrand, kind: "paper" }); });
    const pak = EP.qs("#pdf_ak_btn");
    if (pak) pak.addEventListener("click", function () { EP.pdf.downloadPaper({ paper: pdfPaper, items: pdfItems, branding: pdfBrand, kind: "answer-key" }); });
    const psol = EP.qs("#pdf_sol_btn");
    if (psol) psol.addEventListener("click", function () { EP.pdf.downloadPaper({ paper: pdfPaper, items: pdfItems, branding: pdfBrand, kind: "solutions" }); });
    async function savePaperToDrive(kind) {
      if (!EP.state.tenantId) { EP.toast("No tenant context", "error"); return; }
      try {
        const btn = EP.qs(kind === "paper" ? "#save_drive_btn" : kind === "answer-key" ? "#save_ak_btn" : "#save_sol_btn");
        if (btn) btn.disabled = true;
        const sb2 = EP.getClient();
        const { data, error } = await sb2.functions.invoke("drive-save-paper", {
          body: { paper_id: id, kind: kind },
        });
        if (error) throw error;
        EP.toast("Saved to Drive: " + (data.webViewLink || ""), "success");
      } catch (e) { EP.toast(e.message || "Save failed", "error"); }
      const btns = EP.qsa("#save_drive_btn, #save_ak_btn, #save_sol_btn");
      btns.forEach(function (b) { b.disabled = false; });
    }
    const sdb = EP.qs("#save_drive_btn");
    if (sdb) sdb.addEventListener("click", function () { savePaperToDrive("paper"); });
    const sak = EP.qs("#save_ak_btn");
    if (sak) sak.addEventListener("click", function () { savePaperToDrive("answer-key"); });
    const ssl = EP.qs("#save_sol_btn");
    if (ssl) ssl.addEventListener("click", function () { savePaperToDrive("solutions"); });
    EP.qs("#pptx_btn").addEventListener("click", function () {
      const slides = (qs || []).map(function (pq) {
        const sn = pq.snapshot || {};
        const opts = (sn.options || []).map(function (o) { return o.option_key + ". " + o.option_text; });
        const ans = sn.answer || {}, sol = sn.solution || {};
        return { title: "Q" + pq.question_order + " (" + pq.marks + " marks)", question: (sn.question_text || "").replace(/<[^>]+>/g, ""), options: opts, answer: (ans.correct_option_keys || []).join(", ") || ans.numerical_answer || "", solution: (sol.solution_text || sol.detailed_solution || sol.short_solution || sol.concept || "").replace(/<[^>]+>/g, "") };
      });
      EP.exportPptx(p.title + ".pptx", slides);
    });
    const ab = EP.qs("#ans_btn");
    if (ab) ab.addEventListener("click", function () { const ak = EP.qs("#answer_key"); ak.style.display = ak.style.display === "none" ? "" : "none"; });
    const sb2 = EP.qs("#sol_btn");
    if (sb2) sb2.addEventListener("click", function () { const sk = EP.qs("#solutions_key"); sk.style.display = sk.style.display === "none" ? "" : "none"; });
    const dpb = EP.qs("#del_paper_btn");
    if (dpb) dpb.addEventListener("click", async function () {
      if (!confirm("Delete this paper?")) return;
      await sb().from("papers").delete().eq("id", id);
      EP.toast("Paper deleted", "success");
      EP.navigate("/papers");
    });
  });

  // ===========================================================================
  // DPP
  // ===========================================================================
  EP.register("/dpp", async function (main) {
    main.innerHTML = EP.spinner("Loading DPPs…");
    const { data } = await sb().from("dpps").select("id,title,status,target_date,created_at").order("created_at", { ascending: false }).limit(50);
    let rows = "";
    if (data && data.length) rows = data.map(function (d) {
      return '<tr><td><a href="#/dpp/' + d.id + '">' + EP.esc(d.title) + "</a></td><td>" + EP.esc(d.status) + "</td><td>" + EP.fmtDate(d.target_date) + "</td></tr>";
    }).join("");
    else rows = '<tr><td colspan="3" class="muted">No DPPs yet.</td></tr>';
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Daily Practice Problems</h2>' + (EP.can("dpp.generate") ? '<a class="btn btn-primary" href="#/dpp/new">Generate DPP</a>' : "") + "</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Title</th><th>Status</th><th>Target</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
  });

  EP.register("/dpp/new", async function (main) {
    main.innerHTML = EP.spinner("Loading…");
    const { data: exams } = await sb().from("exams").select("id,name").eq("is_active", true);
    const { data: subjects } = await sb().from("subjects").select("id,name,exam_id").order("name");
    const examOpts = '<option value="">Select exam</option>' + (exams || []).map(function (e) { return '<option value="' + e.id + '">' + EP.esc(e.name) + "</option>"; }).join("");
    const subjOpts = '<option value="">All subjects</option>' + (subjects || []).map(function (s) { return '<option value="' + s.id + '" data-exam="' + s.exam_id + '">' + EP.esc(s.name) + "</option>"; }).join("");
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Generate DPP</h2><a class="btn btn-sm" href="#/dpp">Cancel</a></div>' +
      '<section class="card"><div class="form-grid">' +
        '<div class="field"><label>Exam</label><select id="d_exam" class="input">' + examOpts + "</select></div>" +
        '<div class="field"><label>Subject (optional)</label><select id="d_subj" class="input">' + subjOpts + "</select></div>" +
        '<div class="field"><label>Chapter (optional)</label><select id="d_chap" class="input"><option value="">—</option></select></div>' +
        '<div class="field"><label>Count</label><input id="d_count" class="input" type="number" value="10"></div>' +
        '<div class="field"><label>Mode</label><select id="d_mode" class="input">' +
          '<option value="daily">Daily Practice</option>' +
          '<option value="chapter">Chapter Practice (choose a chapter)</option>' +
          '<option value="weak">Weak Topic (needs history)</option>' +
          '<option value="pyq">PYQ (recent years)</option>' +
        "</select></div>" +
        '<div class="field"><label>Difficulty (optional)</label><select id="d_diff" class="input"><option value="">Any</option><option>EASY</option><option>MEDIUM</option><option>HARD</option></select></div>' +
        '<div class="field"><label>Language (optional)</label><select id="d_lang" class="input"><option value="">Any</option><option value="EN">English</option><option value="HI">Hindi</option><option value="GU">Gujarati</option></select></div>' +
        '<div class="field"><label><input id="d_norepeat" type="checkbox" style="width:auto"> Exclude questions already used in earlier papers/DPPs (no-repeat)</label></div>' +
      "</div>" +
      '<div class="field"><label>Title</label><input id="d_title" class="input" placeholder="Daily DPP"></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="d_gen">Generate</button></div><div id="d_res"></div></section></div>';
    const dExamSel = EP.qs("#d_exam"), dSubjSel = EP.qs("#d_subj"), dChapSel = EP.qs("#d_chap");
    function syncDSubjects() {
      const eId = dExamSel.value;
      EP.qsa("#d_subj option").forEach(function (o) { o.style.display = (!eId || !o.dataset.exam || o.dataset.exam === eId) ? "" : "none"; });
      dSubjSel.value = "";
    }
    dExamSel.addEventListener("change", syncDSubjects);
    dSubjSel.addEventListener("change", async function () {
      dChapSel.innerHTML = '<option value="">—</option>';
      if (dSubjSel.value) {
        const { data: ch } = await sb().from("chapters").select("id,name").eq("subject_id", dSubjSel.value).order("display_order");
        dChapSel.innerHTML += (ch || []).map(function (c) { return '<option value="' + c.id + '">' + EP.esc(c.name) + "</option>"; }).join("");
      }
    });
    EP.qs("#d_gen").addEventListener("click", async function () {
      const examId = EP.qs("#d_exam").value;
      if (!examId) { EP.toast("Select an exam", "error"); return; }
      const filters = {};
      if (EP.qs("#d_subj").value) filters.subject_ids = [EP.qs("#d_subj").value];
      if (EP.qs("#d_chap").value) filters.chapter_id = EP.qs("#d_chap").value;
      if (EP.qs("#d_diff").value) filters.difficulties = [EP.qs("#d_diff").value];
      if (EP.qs("#d_lang").value) filters.language = EP.qs("#d_lang").value;
      const modeSel = EP.qs("#d_mode").value;
      if (modeSel === "pyq") filters.years = [2024, 2023, 2022];
      const mode = modeSel === "weak" ? "WEAK_TOPIC" : (modeSel === "pyq" ? "PYQ" : "DAILY");
      const spec = { exam_id: examId, count: parseInt(EP.qs("#d_count").value, 10) || 10, title: EP.qs("#d_title").value || "Daily DPP", mode: mode, marks: 4, negative_marks: 1, filters: filters, exclude_used: EP.qs("#d_norepeat").checked ? true : false };
      EP.qs("#d_gen").disabled = true;
      EP.qs("#d_res").innerHTML = EP.spinner("Generating…");
      const { data, error } = await sb().rpc("app_generate_dpp", { p_spec: spec });
      EP.qs("#d_gen").disabled = false;
      if (error || (data && data.error)) {
        if (data && data.error && /quota/i.test(data.error)) {
          EP.qs("#d_res").innerHTML = '<div class="empty error"><b>Generation blocked:</b> ' + EP.esc(data.error) +
            '<br><a class="btn btn-sm" href="#/admin/plans">Plans</a> <a class="btn btn-sm" href="#/admin/usage">Usage</a></div>';
        } else {
          EP.renderEligibilityBreakdown(EP.qs("#d_res"), spec);
          if (data && data.error) EP.qs("#d_res").innerHTML = '<div class="empty error">' + EP.esc(data.error) + "</div>" + EP.qs("#d_res").innerHTML;
        }
        return;
      }
      EP.qs("#d_res").innerHTML = '<div class="empty ok">DPP created with ' + (data.questions || 0) + ' questions. <a class="btn btn-sm btn-primary" href="#/dpp/' + data.dpp_id + '">Open</a></div>';
    });
  });

  EP.register("/dpp/:id", async function (main, path) {
    const id = path.split("/").pop();
    main.innerHTML = EP.spinner("Loading DPP…");
    const { data: d } = await sb().from("dpps").select("*").eq("id", id).maybeSingle();
    if (!d) { main.innerHTML = '<div class="empty">DPP not found.</div>'; return; }
    const { data: qs } = await sb().from("dpp_questions")
      .select("question_order, questions(question_text, difficulty, subjects(name), question_answers(correct_option_keys), solutions(solution_text))")
      .eq("dpp_id", id).order("question_order");
    let branding = null;
    if (EP.state.tenantId) {
      const { data: t } = await sb().from("tenants").select("name,logo_url,address,header_text,footer_text").eq("id", EP.state.tenantId).maybeSingle();
      if (t) branding = t;
    }
    const header =
      '<div class="print-head">' +
      (branding && branding.logo_url ? '<img class="logo-img" src="' + EP.esc(branding.logo_url) + '">' : '<div class="logo">E</div>') +
      '<div><div class="ph-name">' + EP.esc((branding && branding.name) || "ExamPro") + "</div>" +
      '<div class="ph-sub">' + EP.esc(d.title) + "</div></div>" +
      '<div class="ph-meta">Daily Practice Problems</div></div>';
    const body = (qs || []).map(function (x) {
      const q = x.questions || {};
      return '<div class="pq"><div class="pq-h">Q' + x.question_order + '</div><div class="pq-q">' + EP.safeHtml((q.question_text || "").slice(0, 400)) + "</div></div>";
    }).join("");
    main.innerHTML = '<div class="page"><div class="page-head no-print"><h2>' + EP.esc(d.title) + '</h2><a class="btn btn-sm" href="#/dpp">Back</a>' +
      '<button class="btn btn-primary btn-sm" id="dpp_print_btn">Print / PDF</button>' +
      '<button class="btn btn-sm" id="dpp_pdf_btn">Download PDF</button>' +
      '<button class="btn btn-sm" id="dpp_pdf_ak_btn">Download Answer Key PDF</button>' +
      '<button class="btn btn-sm" id="dpp_pdf_sol_btn">Download Solutions PDF</button>' +
      (EP.can("dpp.generate") ? '<button class="btn btn-sm" id="save_dpp_drive_btn">Save to Drive</button>' : "") +
      (EP.can("dpp.generate") ? '<button class="btn btn-sm btn-danger" id="del_dpp_btn">Delete</button>' : "") +
      '</div><div class="paper-sheet">' + header + '<hr>' + body + "</div></div>";
    const dppPdfItems = (qs || []).map(function (x, i) {
      const q = x.questions || {};
      return {
        question_text: q.question_text || "",
        options: [],
        answer: { correct_option_keys: (q.question_answers && q.question_answers.correct_option_keys) || [] },
        solution: { solution_text: (q.solutions && q.solutions.solution_text) || "" },
        order: x.question_order || (i + 1)
      };
    });
    const dppObj = { title: d.title, duration_minutes: null, total_marks: null, total_questions: (qs || []).length };
    const dppPrint = EP.qs("#dpp_print_btn");
    if (dppPrint) dppPrint.addEventListener("click", function () { window.print(); });
    const dp1 = EP.qs("#dpp_pdf_btn");
    if (dp1) dp1.addEventListener("click", function () { EP.pdf.downloadPaper({ paper: dppObj, items: dppPdfItems, branding: branding, kind: "paper" }); });
    const dp2 = EP.qs("#dpp_pdf_ak_btn");
    if (dp2) dp2.addEventListener("click", function () { EP.pdf.downloadPaper({ paper: dppObj, items: dppPdfItems, branding: branding, kind: "answer-key" }); });
    const dp3 = EP.qs("#dpp_pdf_sol_btn");
    if (dp3) dp3.addEventListener("click", function () { EP.pdf.downloadPaper({ paper: dppObj, items: dppPdfItems, branding: branding, kind: "solutions" }); });
    const ddp = EP.qs("#del_dpp_btn");
    if (ddp) ddp.addEventListener("click", async function () {
      if (!confirm("Delete this DPP?")) return;
      await sb().from("dpps").delete().eq("id", id);
      EP.toast("DPP deleted", "success");
      EP.navigate("/dpp");
    });
    const sdd = EP.qs("#save_dpp_drive_btn");
    if (sdd) sdd.addEventListener("click", async function () {
      if (!EP.state.tenantId) { EP.toast("No tenant context", "error"); return; }
      sdd.disabled = true;
      try {
        const { data, error } = await sb().functions.invoke("drive-save-dpp", {
          body: { dpp_id: id },
        });
        if (error) throw error;
        EP.toast("Saved to Drive", "success");
      } catch (e) { EP.toast(e.message || "Save failed", "error"); }
      sdd.disabled = false;
    });
  });

  // ===========================================================================
  // ASSIGNMENTS (assign papers/tests to students or batches)
  // ===========================================================================
  EP.register("/assignments", async function (main) {
    if (!EP.hasRole(["TEACHER","ACADEMIC_ADMIN","INSTITUTION_ADMIN","SUPER_ADMIN","PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading assignments…");
    const { data: papers } = await sb().from("papers").select("id,title").order("created_at", { ascending: false }).limit(50);
    const { data: batches } = await sb().from("batches").select("id,name").order("name").limit(100);
    const { data: assignments } = await sb().from("exam_assignments").select("id,paper_id,assignee_id,due_at,status,assignee_type,papers(title)").order("created_at", { ascending: false }).limit(100);
    const batchIds = Array.from(new Set((assignments || []).filter(function (a) { return a.assignee_type === "BATCH" && a.assignee_id; }).map(function (a) { return a.assignee_id; })));
    const { data: batchRows } = batchIds.length ? await sb().from("batches").select("id,name").in("id", batchIds) : { data: [] };
    const batchName = {};
    (batchRows || []).forEach(function (b) { batchName[b.id] = b.name; });
    const rows = (assignments && assignments.length) ? assignments.map(function (a) {
      return '<tr><td>' + EP.esc((a.papers && a.papers.title) || "—") + "</td><td>" + EP.esc(a.assignee_type) + "</td><td>" + (a.assignee_type === "BATCH" ? (EP.esc(batchName[a.assignee_id]) || "—") : EP.esc(a.assignee_id || "—")) + "</td><td>" + EP.fmtDate(a.due_at) + "</td><td>" + EP.esc(a.status) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="muted">No assignments yet.</td></tr>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Assignments</h2><button class="btn btn-primary" id="new_assign">New Assignment</button></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Paper</th><th>Type</th><th>Batch</th><th>Due</th><th>Status</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
    EP.qs("#new_assign").addEventListener("click", function () {
      const paperOpts = (papers || []).map(function (p) { return '<option value="' + p.id + '">' + EP.esc(p.title) + "</option>"; }).join("");
      const batchOpts = (batches || []).map(function (b) { return '<option value="' + b.id + '">' + EP.esc(b.name) + "</option>"; }).join("");
      EP.modal("New Assignment", '<div class="form-grid">' +
        '<div class="field"><label>Paper</label><select id="as_paper" class="input"><option value="">Select paper</option>' + paperOpts + "</select></div>" +
        '<div class="field"><label>Assign to</label><select id="as_type" class="input"><option>BATCH</option><option>STUDENT</option></select></div>' +
        '<div class="field"><label>Batch / Student ID</label><select id="as_batch" class="input"><option value="">Select batch</option>' + batchOpts + "</select></div>" +
        '<div class="field"><label>Due date/time</label><input id="as_due" class="input" type="datetime-local"></div>' +
      "</div>",
      '<button class="btn btn-primary" id="save_assign">Assign</button><button class="btn btn-sm" data-close>Cancel</button>');
      EP.qs("#save_assign").addEventListener("click", async function () {
        const paperId = EP.qs("#as_paper").value;
        if (!paperId) { EP.toast("Select a paper", "error"); return; }
        const batchId = EP.qs("#as_batch").value;
        if (!batchId) { EP.toast("Select a batch", "error"); return; }
        const due = EP.qs("#as_due").value ? new Date(EP.qs("#as_due").value).toISOString() : null;
        await sb().from("exam_assignments").insert({ tenant_id: EP.state.tenantId, paper_id: paperId, assignee_type: EP.qs("#as_type").value, assignee_id: batchId, assigned_by: EP.state.user.id, due_at: due });
        EP.toast("Assigned", "success");
        EP.closeModal();
        EP.navigate("/assignments");
      });
    });
  }, { roles: ["TEACHER","ACADEMIC_ADMIN","INSTITUTION_ADMIN","SUPER_ADMIN","PLATFORM_ADMIN"] });

  // ===========================================================================
  // EXAMS (online test) — list papers, start session, take, submit
  // ===========================================================================
  EP.register("/exams", async function (main) {
    main.innerHTML = EP.spinner("Loading exams…");
    const { data } = await sb().from("papers").select("id,title,total_questions,duration_minutes,total_marks").order("created_at", { ascending: false }).limit(50);
    const cards = (data && data.length)
      ? data.map(function (p) {
          return '<div class="exam-card"><h4>' + EP.esc(p.title) + "</h4><div class='muted'>" + (p.total_questions || 0) + " Qs · " + (p.duration_minutes || 0) + " min</div><button class='btn btn-primary btn-sm start-exam' data-id='" + p.id + "'>Start exam</button></div>";
        }).join("")
      : '<div class="empty">No papers available to attempt. Generate one first.</div>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Exams</h2></div><div class="exam-grid">' + cards + "</div></div>";
    EP.qsa(".start-exam").forEach(function (b) {
      b.addEventListener("click", function () { startExam(b.dataset.id); });
    });
  });

  async function startExam(paperId) {
    // Resume an in-progress session for this paper+student instead of
    // silently creating a duplicate attempt (spec §31 "resume where permitted").
    const { data: active } = await sb().from("exam_sessions")
      .select("id,status,ends_at")
      .eq("paper_id", paperId).eq("student_id", EP.state.user.id)
      .eq("status", "IN_PROGRESS").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (active && active.id) {
      if (new Date(active.ends_at).getTime() > Date.now()) {
        EP.toast("Resuming your in-progress attempt…", "info");
        EP.navigate("/exam/" + active.id);
        return;
      }
    }
    const dur = await sb().from("papers").select("duration_minutes").eq("id", paperId).maybeSingle();
    const minutes = (dur.data && dur.data.duration_minutes) || 60;
    const { data, error } = await sb().from("exam_sessions").insert({
      tenant_id: EP.state.tenantId, paper_id: paperId, student_id: EP.state.user.id, status: "IN_PROGRESS",
      started_at: new Date().toISOString(), ends_at: new Date(Date.now() + minutes * 60000).toISOString(),
    }).select("id").single();
    if (error) { EP.toast(error.message, "error"); return; }
    EP.navigate("/exam/" + data.id);
  }

  EP.register("/exam/:id", async function (main, path) {
    const sid = path.split("/").pop();
    main.innerHTML = EP.spinner("Loading exam…");
    const { data: ses } = await sb().from("exam_sessions").select("id,paper_id,started_at,ends_at,status").eq("id", sid).maybeSingle();
    if (!ses) { main.innerHTML = '<div class="empty">Session not found.</div>'; return; }
    if (ses.status === "SUBMITTED") { EP.navigate("/results/session/" + sid); return; }
    const { data: p } = await sb().from("papers").select("title,total_questions,duration_minutes,exam_pattern_id").eq("id", ses.paper_id).maybeSingle();
    const { data: pqs } = await sb().from("paper_questions").select("question_order, question_id, marks, negative_marks, snapshot").eq("paper_id", ses.paper_id).order("question_order");
    const { data: existing } = await sb().from("responses").select("question_id, selected_options, marked_for_review").eq("exam_session_id", sid);
    let sections = [];
    if (p && p.exam_pattern_id) {
      const { data: pat } = await sb().from("exam_patterns").select("sections,name").eq("id", p.exam_pattern_id).maybeSingle();
      if (pat && Array.isArray(pat.sections)) {
        sections = pat.sections.map(function (s, i) {
          return { name: (s && s.name) || "Section " + (i + 1), count: parseInt((s && s.count) || 0, 10) };
        });
      }
    }
    // Assign questions to sections by pattern counts (fallback: single section)
    const secAssign = {};
    const secList = [];
    if (sections.length && pqs) {
      let qi = 0;
      sections.forEach(function (sec) {
        const qs = [];
        for (let k = 0; k < sec.count && qi < pqs.length; k++) { qs.push(pqs[qi].question_id); qi++; }
        if (qs.length) { secList.push({ name: sec.name, ids: qs }); }
      });
      if (qi < pqs.length) { secList.push({ name: "Questions", ids: pqs.slice(qi).map(function (q) { return q.question_id; }) }); }
      secList.forEach(function (sec) { sec.ids.forEach(function (qid) { secAssign[qid] = sec; }); });
    }
    const answers = {};
    let marked = {};
    (existing || []).forEach(function (r) {
      answers[r.question_id] = r.selected_options || [];
      if (r.marked_for_review) marked[r.question_id] = true;
    });
    let idx = 0;

    const endTs = new Date(ses.ends_at).getTime();
    function tick() {
      const left = Math.max(0, endTs - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      const el = EP.qs("#timer"); if (el) el.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      if (left <= 0) submitExam(true);
    }

    function renderPalette() {
      const hasSections = secList.length > 1;
      const html = secList.length > 1
        ? secList.map(function (sec) {
            return '<div class="pal-sec">' + EP.esc(sec.name) + "</div>" + sec.ids.map(function (qid) {
              const i = pqs.findIndex(function (q) { return q.question_id === qid; });
              const st = (answers[qid] && answers[qid].length ? "ans " : "") + (marked[qid] ? "mk " : "");
              return '<button class="pal ' + st + '" data-i="' + i + '">' + (i + 1) + "</button>";
            }).join("");
          }).join("")
        : pqs.map(function (q, i) {
            const st = (answers[q.question_id] && answers[q.question_id].length ? "ans " : "") + (marked[q.question_id] ? "mk " : "");
            return '<button class="pal ' + st + '" data-i="' + i + '">' + (i + 1) + "</button>";
          }).join("");
      const pal = EP.qs("#palette"); if (!pal) return;
      pal.innerHTML = html;
      EP.qsa("#palette .pal").forEach(function (b) { b.addEventListener("click", function () { showQ(parseInt(b.dataset.i, 10)); }); });
    }
    function showQ(i) {
      idx = i; const q = pqs[i]; const sn = q.snapshot || {};
      const sec = secAssign[q.question_id];
      const secLabel = sec ? '<div class="pq-sec">' + EP.esc(sec.name) + "</div>" : "";
      const opts = (sn.options || []).map(function (o) {
        const sel = (answers[q.question_id] || []).indexOf(o.option_key) !== -1;
        return '<label class="opt-pick"><input type="checkbox" data-k="' + EP.esc(o.option_key) + '" ' + (sel ? "checked" : "") + "> <b>" + EP.esc(o.option_key) + ".</b> " + EP.esc(o.option_text) + "</label>";
      }).join("");
      EP.qs("#q_area").innerHTML =
        secLabel +
        '<div class="exam-q"><div class="pq-h">Question ' + (i + 1) + " of " + pqs.length + " · " + EP.fmtMarks(q.marks) + " marks" + (q.negative_marks ? ", −" + q.negative_marks + " neg" : "") + "</div>" +
        '<div class="pq-q">' + EP.safeHtml(sn.question_text || "") + "</div>" + (opts ? '<div class="opts-pick">' + opts + "</div>" : '<div class="muted">Numerical/integer answer type — enter below:<br><input id="num_ans" class="input" value="' + EP.esc((answers[q.question_id] || [])[0] || "") + '"></div>') + "</div>";
      EP.qsa("#q_area .opt-pick input").forEach(function (cb) {
        cb.addEventListener("change", function () { saveAnswer(q.question_id); });
      });
      const num = EP.qs("#num_ans"); if (num) num.addEventListener("input", function () { saveAnswer(q.question_id); });
      const prevBtn = EP.qs("#prev_btn"); if (prevBtn) prevBtn.disabled = i === 0;
      const nextBtn = EP.qs("#next_btn"); if (nextBtn) nextBtn.disabled = i === pqs.length - 1;
      EP.qsa("#palette .pal").forEach(function (b, bi) { b.classList.toggle("active", bi === i); });
      const mk = EP.qs("#mark_btn"); if (mk) mk.classList.toggle("active", !!marked[q.question_id]);
    }
    async function saveAnswer(qid, opts) {
      let sel = opts;
      if (sel === undefined) {
        const num = EP.qs("#num_ans");
        if (num) sel = num.value ? [num.value] : [];
        else sel = EP.qsa("#q_area .opt-pick input:checked").map(function (c) { return c.dataset.k; });
      }
      answers[qid] = sel;
      // Server-side save: validates membership + deadline (browser timer is cosmetic)
      const { data, error } = await sb().rpc("app_save_response", {
        p_session_id: sid, p_question_id: qid, p_options: sel, p_marked: !!marked[qid],
      });
      if (error) { EP.toast(error.message, "error"); return; }
      if (data && data.error) { EP.toast(data.error, "error"); return; }
      renderPalette();
    }
    main.innerHTML =
      '<div class="exam-shell">' +
      '<div class="exam-top"><div class="et-title">' + EP.esc((p && p.title) || "Exam") + '</div><div id="timer" class="timer">--:--</div>' +
      '<button class="btn btn-sm btn-primary" id="submit_btn">Submit</button></div>' +
      '<div class="exam-body"><div id="q_area" class="q-area"></div>' +
      '<aside class="exam-side"><div class="pal-head">Questions</div><div id="palette" class="palette"></div>' +
      '<button class="btn btn-sm btn-ghost" id="mark_btn">Mark for review</button>' +
      '<button class="btn btn-sm" id="clear_btn">Clear</button>' +
      '<button class="btn btn-sm" id="prev_btn">Prev</button><button class="btn btn-sm" id="next_btn">Next</button></div></aside>' +
      "</div></div>";
    renderPalette(); showQ(0);
    tick(); const timerInt = setInterval(tick, 1000);
    EP._examTimer = timerInt;
    EP.qs("#prev_btn").addEventListener("click", function () { if (idx > 0) showQ(idx - 1); });
    EP.qs("#next_btn").addEventListener("click", function () { if (idx < pqs.length - 1) showQ(idx + 1); });
    EP.qs("#mark_btn").addEventListener("click", function () {
      const qid = pqs[idx].question_id;
      marked[qid] = !marked[qid];
      saveAnswer(qid, answers[qid] || []);
      renderPalette(); showQ(idx);
    });
    EP.qs("#clear_btn").addEventListener("click", function () { answers[pqs[idx].question_id] = []; saveAnswer(pqs[idx].question_id, []); showQ(idx); });
    EP.qs("#submit_btn").addEventListener("click", function () { submitExam(false); });

    async function submitExam(auto) {
      clearInterval(EP._examTimer);
      if (!auto && !confirm("Submit exam? You cannot change answers after submission.")) { EP._examTimer = setInterval(tick, 1000); return; }
      const sb2 = EP.qs("#submit_btn"); if (sb2) sb2.disabled = true;
      const { data, error } = await sb().rpc("app_finalize_session", { p_session_id: sid });
      if (error) { EP.toast(error.message, "error"); if (sb2) sb2.disabled = false; return; }
      if (data && data.error) { EP.toast(data.error, "error"); if (sb2) sb2.disabled = false; return; }
      EP.navigate("/results/session/" + sid);
    }
  });

  // Chapter/topic drill. Options and answers live in question_options /
  // question_answers (the questions table carries no options/marks/answer
  // columns), so they are fetched separately and joined client-side.
  async function renderDrill(main, kind, id) {
    main.innerHTML = EP.spinner("Loading practice…");
    const head = kind === "chapter"
      ? await sb().from("chapters").select("id,name,subject_id,subjects(name,exam_id)").eq("id", id).maybeSingle()
      : await sb().from("topics").select("id,name,chapter_id,chapters(name,subject_id,subjects(name))").eq("id", id).maybeSingle();
    if (!head || !head.data) { main.innerHTML = '<div class="empty">' + (kind === "chapter" ? "Chapter" : "Topic") + " not found.</div>"; return; }
    const qq = kind === "chapter"
      ? sb().from("questions").select("id,question_text,difficulty,year,session,shift,subtopics(name),question_types(name)").eq("chapter_id", id).eq("is_deleted", false).eq("verification_status", "VERIFIED").order("created_at").limit(50)
      : sb().from("questions").select("id,question_text,difficulty,year,session,shift,subtopics(name),question_types(name)").eq("topic_id", id).eq("is_deleted", false).eq("verification_status", "VERIFIED").order("created_at").limit(50);
    const { data: qs } = await qq;
    const qids = (qs || []).map(function (q) { return q.id; });
    const [oRes, aRes] = qids.length
      ? await Promise.all([
          sb().from("question_options").select("question_id,option_key,option_text").in("question_id", qids).order("display_order"),
          sb().from("question_answers").select("question_id,correct_option_keys,numerical_answer").in("question_id", qids)
        ])
      : [{ data: [] }, { data: [] }];
    const optsByQ = {}; (oRes.data || []).forEach(function (o) { (optsByQ[o.question_id] = optsByQ[o.question_id] || []).push(o); });
    const ansByQ = {}; (aRes.data || []).forEach(function (a) { ansByQ[a.question_id] = a; });
    const crumb = kind === "chapter"
      ? '<span class="muted">' + EP.esc((head.data.subjects && head.data.subjects.name) || "") + "</span>"
      : '<span class="muted">' + EP.esc((head.data.chapters && head.data.chapters.name) || "") + " · " + EP.esc((head.data.chapters && head.data.chapters.subjects && head.data.chapters.subjects.name) || "") + "</span>";
    const list = (qs || []).map(function (q, i) {
      const opts = (optsByQ[q.id] || []).map(function (o) { return '<li><b>' + EP.esc(o.option_key) + '.</b> ' + EP.esc(o.option_text) + "</li>"; }).join("");
      const ans = ansByQ[q.id] || {};
      return '<div class="pq"><div class="pq-h">Q' + (i + 1) + (q.year ? " · PYQ " + q.year : "") + ' · <span class="badge b-' + (q.difficulty === 'EASY' ? 'ok' : q.difficulty === 'HARD' ? 'bad' : 'warn') + '">' + EP.esc(q.difficulty || "—") + '</span> · ' + EP.esc((q.question_types && q.question_types.name) || "") + '</div>' +
        '<div class="pq-q">' + EP.safeHtml(q.question_text || "") + "</div>" + (opts ? '<ol class="opts">' + opts + "</ol>" : "") +
        '<div class="q-actions"><button class="btn btn-sm" data-reveal="' + q.id + '">Reveal answer</button><button class="btn btn-sm" data-save="' + q.id + '">Bookmark</button></div>' +
        '<div class="answer-reveal" id="ans_' + q.id + '" style="display:none"><b>Answer:</b> ' + EP.esc((ans.correct_option_keys || []).join(", ") || ans.numerical_answer || "—") + "</div></div>";
    }).join("");
    main.innerHTML = '<div class="page"><div class="page-head"><h2>' + EP.esc(head.data.name) + "</h2>" + crumb + "</div>" +
      (list ? '<div class="q-list">' + list + "</div>" : '<div class="empty">No questions in this ' + (kind === "chapter" ? "chapter" : "topic") + " yet.</div>") + "</div>";
    EP.qsa("[data-reveal]").forEach(function (b) { b.addEventListener("click", function () { var el = EP.qs("#ans_" + b.dataset.reveal); if (el) el.style.display = el.style.display === "none" ? "" : "none"; }); });
    EP.qsa("[data-save]").forEach(function (b) { b.addEventListener("click", async function () { await sb().from("bookmarks").insert({ user_id: EP.state.user.id, question_id: b.dataset.save }).onConflict("user_id,question_id").ignore(); EP.toast("Bookmarked", "success"); }); });
  }

  EP.register("/practice/chapter/:id", async function (main, path) {
    await renderDrill(main, "chapter", path.split("/").pop());
  });

  EP.register("/practice/topic/:id", async function (main, path) {
    await renderDrill(main, "topic", path.split("/").pop());
  });

  // ===========================================================================
  // RESULTS
  // ===========================================================================
  EP.register("/results", async function (main) {
    main.innerHTML = EP.spinner("Loading results…");
    let q = sb().from("results").select("id, created_at, marks, total_marks, accuracy, percentage, correct, incorrect, exam_sessions!inner(student_id, paper_id, papers(title))");
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN", "INSTITUTION_ADMIN", "ACADEMIC_ADMIN", "TEACHER"])) {
      q = q.eq("student_id", EP.state.user.id);
    }
    const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
    let rows = "";
    if (data && data.length) rows = data.map(function (r) {
      const title = (r.exam_sessions && r.exam_sessions.papers && r.exam_sessions.papers.title) || "Exam";
      return '<tr><td><a href="#/results/session/' + r.exam_sessions.id + '">' + EP.esc(title) + "</a></td><td>" + EP.fmtMarks(r.marks) + " / " + EP.fmtMarks(r.total_marks) + "</td><td>" + (r.percentage || 0) + "%</td><td>" + (r.correct || 0) + "/" + (r.incorrect || 0) + "</td><td>" + EP.fmtDate(r.created_at) + "</td></tr>";
    }).join("");
    else rows = '<tr><td colspan="5" class="muted">No results yet.</td></tr>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Results</h2><button class="btn btn-sm" id="export_results_csv">Export CSV</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Exam</th><th>Score</th><th>Percentage</th><th>Correct/Incorrect</th><th>Date</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
    const csvBtn = EP.qs("#export_results_csv");
    if (csvBtn) csvBtn.addEventListener("click", function () {
      EP.exportCsv("results.csv", (data || []).map(function (r) {
        const title = (r.exam_sessions && r.exam_sessions.papers && r.exam_sessions.papers.title) || "Exam";
        return { exam: title, marks: r.marks, total_marks: r.total_marks, percentage: r.percentage || 0, accuracy: r.accuracy || 0, correct: r.correct || 0, incorrect: r.incorrect || 0, unanswered: r.unanswered || 0, date: r.created_at };
      }));
    });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN", "INSTITUTION_ADMIN", "ACADEMIC_ADMIN", "TEACHER", "STUDENT", "PARENT"] });

  EP.register("/results/session/:id", async function (main, path) {
    const sid = path.split("/").pop();
    main.innerHTML = EP.spinner("Loading result…");
    const { data: r } = await sb().from("results").select("*, exam_sessions!inner(paper_id, papers(title))").eq("exam_session_id", sid).maybeSingle();
    if (!r) { main.innerHTML = '<div class="empty">Result not found.</div>'; return; }
    const snap = r.snapshot || {};
    const items = (snap.items || []).map(function (it, i) {
      return '<tr class="' + (it.correct ? "ok" : "bad") + '"><td>' + (i + 1) + "</td><td>" + (it.answered ? "Answered" : "Not answered") + "</td><td>" + (it.correct ? "✓ Correct" : "✗ Incorrect") + "</td></tr>";
    }).join("");
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>' + EP.esc((r.exam_sessions && r.exam_sessions.papers && r.exam_sessions.papers.title) || "Result") + '</h2><a class="btn btn-sm" href="#/results">Back</a></div>' +
      '<section class="card score-card"><div class="big-score">' + EP.fmtMarks(r.marks) + '<small>/ ' + EP.fmtMarks(r.total_marks) + "</small></div>" +
      '<div class="score-stats"><div>Percentage: <b>' + (r.percentage || 0) + "%</b></div><div>Accuracy: <b>" + (r.accuracy || 0) + "%</b></div><div>Correct: <b>" + (r.correct || 0) + "</b></div><div>Incorrect: <b>" + (r.incorrect || 0) + "</b></div><div>Unanswered: <b>" + (r.unanswered || 0) + "</b></div></div></section>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Status</th><th>Result</th></tr></thead><tbody>' + items + "</tbody></table></div></div>";
  });

  // ===========================================================================
  // ANALYTICS (real counts from DB + Chart.js)
  // ===========================================================================
  EP.register("/analytics", async function (main) {
    main.innerHTML = EP.spinner("Loading analytics…");
    const [qN, pN, rN, dN, sN] = await Promise.all([
      sb().from("questions").select("*", { count: "exact", head: true }).eq("is_deleted", false),
      sb().from("papers").select("*", { count: "exact", head: true }),
      sb().from("results").select("*", { count: "exact", head: true }),
      sb().from("dpps").select("*", { count: "exact", head: true }),
      sb().from("exam_sessions").select("*", { count: "exact", head: true }),
    ]);
    const overview = [["Questions", qN.count || 0], ["Papers", pN.count || 0], ["Results", rN.count || 0], ["DPPs", dN.count || 0], ["Exam sessions", sN.count || 0]];
    const max = Math.max.apply(null, overview.map(function (b) { return b[1]; })) || 1;
    const bars = overview.map(function (b) {
      const pct = Math.round((b[1] / max) * 100);
      return '<div class="bar-row"><span class="bar-label">' + b[0] + '</span><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div><span class="bar-val">' + EP.fmtMarks(b[1]) + "</span></div>";
    }).join("");
    let recentScores = [];
    try {
      const { data } = await sb().from("results").select("percentage").order("created_at", { ascending: false }).limit(20);
      recentScores = (data || []).map(function (x) { return x.percentage || 0; }).reverse();
    } catch (e) { EP.toast("Failed to load recent scores: " + (e.message || "unknown"), "error"); }
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Analytics</h2></div>' +
      '<div class="grid-2">' +
        '<section class="card"><h3>Activity overview</h3>' + bars + "</section>" +
        '<section class="card"><h3>Recent scores</h3><canvas id="chart_scores" height="220"></canvas></section>' +
      "</div></div>";
    try {
      const ctx = EP.qs("#chart_scores");
      if (ctx && typeof Chart !== "undefined") {
        new Chart(ctx, {
          type: "line",
          data: { labels: recentScores.map(function (_, i) { return "#" + (i + 1); }), datasets: [{ label: "Score %", data: recentScores, borderColor: "#1f3a5f", backgroundColor: "rgba(30,58,95,0.1)", fill: true, tension: 0.3 }] },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
        });
      }
    } catch (e) { EP.toast("Chart error: " + (e.message || "unknown"), "error"); }
  });

  // ===========================================================================
  // ADMIN (Super / Platform)
  // ===========================================================================
  EP.register("/admin", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading admin…");
    const cards = [
      ["Institutions", "/admin/institutions"], ["Branches", "/admin/branches"], ["Batches", "/admin/batches"],
      ["Teachers", "/admin/teachers"], ["Students", "/admin/students"], ["Subjects", "/admin/subjects"],
      ["Chapters", "/admin/chapters"], ["Topics", "/admin/topics"],
      ["Exam patterns", "/admin/patterns"], ["Plans", "/admin/plans"], ["Tenants", "/admin/tenants"],
      ["Security events", "/admin/security"],
      ["Data quality", "/admin/data-quality"], ["Usage", "/admin/usage"],
      ["Audit log", "/admin/audit"], ["System health", "/admin/system-health"],
      ["Exam catalog", "/admin/exams"], ["Question Bank", "/questions"],
      ["Question Verification", "/admin/ingestion/review"],
      ["Ebook Ingestion Engine", "/admin/ingestion"], ["Official PYQ", "/admin/official-pyq"],
      ["Official Sources", "/admin/sources"], ["Syllabus Versions", "/admin/syllabus"], ["Answer Key Engine", "/admin/ingestion/answerkey"],
      ["Solution Engine", "/admin/solutions/queue"], ["AI Solution Review", "/admin/solutions/review"],
      ["Question Shards", "/admin/ingestion/jobs"], ["Google Drive / Storage", "/admin/storage"],
      ["Paper Generator", "/papers/new"], ["DPP Generator", "/dpp/new"],
      ["Mock Exams", "/exams"], ["OMR Engine", "/omr"],
      ["Analytics", "/analytics"], ["Reports", "/reports"], ["Exports", "/reports"],
    ];
    const [{ data: qN }, { data: pN }, { data: rN }, { data: tenN }] = await Promise.all([
      sb().from("questions").select("*", { count: "exact", head: true }),
      sb().from("papers").select("*", { count: "exact", head: true }),
      sb().from("results").select("*", { count: "exact", head: true }),
      sb().from("tenants").select("*", { count: "exact", head: true }),
    ]);
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Admin</h2></div>' +
      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="big">' + ((qN || {}).count || 0) + '</div><div class="muted">Questions</div></div>' +
        '<div class="stat-card"><div class="big">' + ((pN || {}).count || 0) + '</div><div class="muted">Papers</div></div>' +
        '<div class="stat-card"><div class="big">' + ((rN || {}).count || 0) + '</div><div class="muted">Results</div></div>' +
        '<div class="stat-card"><div class="big">' + ((tenN || {}).count || 0) + '</div><div class="muted">Tenants</div></div>' +
      '</div>' +
      '<div class="card"><h3>Management</h3><div class="quick-grid">' +
        cards.map(function (c) { return '<a class="quick" href="#' + c[1] + '">' + c[0] + '</a>'; }).join("") +
      '</div></div>' +
      '<section class="card"><h3>Users &amp; memberships</h3><div id="adm_users">' + EP.spinner() + '</div></section>' +
      '<section class="card"><h3>Tenants</h3><div id="adm_tenants">' + EP.spinner() + '</div></section>' +
      '<section class="card"><h3>System config</h3><div id="cfg_view">' + EP.spinner() + "</div></section></div>";
    const { data: users } = await sb().from("tenant_memberships").select("user_id, tenant_id, status, roles(name)").order("created_at", { ascending: false }).limit(100);
    const uids = (users || []).map(function (u) { return u.user_id; });
    const { data: profs } = uids.length ? await sb().from("profiles").select("auth_user_id, full_name, email").in("auth_user_id", uids) : { data: [] };
    const profMap = {};
    (profs || []).forEach(function (p) { profMap[p.auth_user_id] = p; });
    const { data: tenants } = await sb().from("tenants").select("id,name,slug,status,created_at").order("created_at", { ascending: false }).limit(100);
    const uRows = (users && users.length) ? users.map(function (u) {
      const p = profMap[u.user_id] || {};
      return '<tr><td>' + EP.esc(p.full_name || p.email || "—") + "</td><td>" + EP.esc((u.roles && u.roles.name) || "—") + "</td><td>" + EP.esc(u.status) + "</td></tr>";
    }).join("") : '<tr><td colspan="3" class="muted">No memberships.</td></tr>';
    const tRows = (tenants && tenants.length) ? tenants.map(function (t) {
      return '<tr><td>' + EP.esc(t.name) + "</td><td>" + EP.esc(t.slug) + "</td><td><span class='badge b-ok'>" + EP.esc(t.status) + "</span></td></tr>";
    }).join("") : '<tr><td colspan="3" class="muted">No tenants.</td></tr>';
    EP.qs("#adm_users").innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Role</th><th>Status</th></tr></thead><tbody>' + uRows + "</tbody></table></div>";
    EP.qs("#adm_tenants").innerHTML = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Slug</th><th>Status</th></tr></thead><tbody>' + tRows + "</tbody></table></div>";
    const { data: cfg } = await sb().from("system_config").select("key,value");
    EP.qs("#cfg_view").innerHTML = '<pre class="code">' + EP.esc(JSON.stringify(cfg || [], null, 2)) + "</pre>";
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  // ---- Admin: Exam Patterns (versioned, section-aware) ----
  EP.register("/admin/patterns", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading patterns…");
    const { data: exams } = await sb().from("exams").select("id,name").eq("is_active", true).order("name");
    const { data: subjects } = await sb().from("subjects").select("id,name,code,exam_id").order("name");
    const { data: types } = await sb().from("question_types").select("id,code,name").eq("is_active", true).order("name");
    const { data: pats } = await sb().from("exam_patterns").select("id,name,exam_id,version,is_active,duration_minutes,total_questions,total_marks,default_marks,default_negative_marks,sections,tenant_id,academic_year,effective_from,effective_to,official_source_url,official_document_title,official_document_year,verified_at").order("exam_id").order("version", { ascending: false });
    const examName = {}, subjOpts = {}, typeOpts = {};
    (exams || []).forEach(function (e) { examName[e.id] = e.name; });
    (subjects || []).forEach(function (s) { subjOpts[s.id] = s.name; });
    (types || []).forEach(function (t) { typeOpts[t.id] = t.name; });
    const examSelOpts = '<option value="">—</option>' + (exams || []).map(function (e) { return '<option value="' + e.id + '">' + EP.esc(e.name) + "</option>"; }).join("");
    const subjSelOpts = '<option value="">—</option>' + (subjects || []).map(function (s) { return '<option value="' + s.id + '">' + EP.esc(s.name) + "</option>"; }).join("");
    const typeSelOpts = '<option value="">Any</option>' + (types || []).map(function (t) { return '<option value="' + t.id + '">' + EP.esc(t.name) + "</option>"; }).join("");

    // §38 latest-pattern safety: an active pattern past its effective window
    // (with no newer version) must produce an administrative warning, and an
    // active exam without any active pattern is surfaced too.
    const today = new Date();
    const warnings = [];
    const activeByExam = {};
    (pats || []).forEach(function (p) { if (p.is_active) activeByExam[p.exam_id] = (activeByExam[p.exam_id] || []).concat([p]); });
    (exams || []).forEach(function (e) {
      const act = activeByExam[e.id];
      if (!act || !act.length) { warnings.push('<div class="empty error"><b>' + EP.esc(e.name) + ':</b> no active exam pattern — generation falls back to form defaults.</div>'); return; }
      act.forEach(function (p) {
        if (p.effective_to && new Date(p.effective_to) < today) {
          warnings.push('<div class="empty error"><b>' + EP.esc(e.name) + ' v' + p.version + ':</b> Official pattern verification required before generating a current-year paper. (effective to ' + EP.esc(String(p.effective_to).slice(0, 10)) + ')</div>');
        }
      });
    });
    const warnHtml = warnings.length ? '<section class="card"><h3>Pattern verification warnings</h3>' + warnings.join("") + "</section>" : "";

    const rows = (pats || []).map(function (p) {
      const secCount = (p.sections && p.sections.length) || 0;
      const srcCell = p.official_document_title
        ? '<a href="' + EP.esc(p.official_source_url || "#") + '" target="_blank" rel="noopener" title="' + EP.esc(p.official_source_url || "") + '">' + EP.esc(p.official_document_title) + "</a>" + (p.official_document_year ? " (" + p.official_document_year + ")" : "")
        : '<span class="muted">—</span>';
      const verCell = p.verified_at
        ? '<span class="badge b-ok">verified ' + new Date(p.verified_at).toLocaleDateString() + "</span>"
        : '<span class="badge b-warn">unverified</span>';
      return '<tr><td>' + EP.esc(p.name) + "</td><td>" + EP.esc(examName[p.exam_id] || "—") + "</td><td>v" + (p.version || 1) + (p.academic_year ? ' <span class="muted">(' + p.academic_year + ")</span>" : "") + "</td>" +
        "<td>" + secCount + " sections</td><td>" + (p.duration_minutes || "—") + " min</td>" +
        "<td>" + (p.total_questions ? p.total_questions + "Q / " + EP.fmtMarks(p.total_marks) + "M" : "—") + "</td>" +
        "<td>" + srcCell + "</td><td>" + verCell + "</td>" +
        "<td>" + (p.is_active ? '<span class="badge b-ok">ACTIVE</span>' : '<span class="badge b-warn">archived</span>') + "</td>" +
        '<td><button class="btn btn-sm" data-act="' + p.id + '">' + (p.is_active ? "Archive" : "Activate") + '</button>' +
        ' <button class="btn btn-sm" data-verify="' + p.id + '" title="Stamp this pattern as checked against its official source">Verify Official Pattern</button>' +
        ' <button class="btn btn-sm btn-danger" data-del="' + p.id + '">Delete</button></td></tr>';
    }).join("") || '<tr><td colspan="10" class="muted">No patterns yet. Create one below.</td></tr>';

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Exam Patterns</h2><a class="btn btn-sm" href="#/admin">Back</a></div>' + warnHtml +
      '<section class="card"><h3>New pattern</h3><div class="form-grid">' +
        '<div class="field"><label>Name</label><input id="pt_name" class="input" placeholder="JEE Main Full Test"></div>' +
        '<div class="field"><label>Exam</label><select id="pt_exam" class="input">' + examSelOpts + "</select></div>" +
        '<div class="field"><label>Academic year</label><input id="pt_year" class="input" type="number" placeholder="2026"></div>' +
        '<div class="field"><label>Duration (min)</label><input id="pt_dur" class="input" type="number" value="180"></div>' +
        '<div class="field"><label>Default marks</label><input id="pt_marks" class="input" type="number" step="0.5" value="4"></div>' +
        '<div class="field"><label>Default negative</label><input id="pt_neg" class="input" type="number" step="0.5" value="1"></div>' +
        '<div class="field"><label>Official source URL</label><input id="pt_src_url" class="input" placeholder="https://jeemain.nta.nic.in/…"></div>' +
        '<div class="field"><label>Official document title</label><input id="pt_src_title" class="input" placeholder="JEE (Main) 2026 Information Bulletin"></div>' +
        '<div class="field"><label>Effective from</label><input id="pt_eff_from" class="input" type="date"></div>' +
        '<div class="field"><label>Effective to</label><input id="pt_eff_to" class="input" type="date"></div>' +
      "</div>" +
      '<p class="hint">New patterns start <b>unverified</b>. After checking the official source, use “Verify Official Pattern” in the table to stamp it. New versions are created additive — historical versions stay for reproducibility.</p>' +
      '<h4>Sections</h4><div id="pt_sections"></div>' +
      '<button class="btn btn-sm btn-ghost" id="pt_add_sec">+ Add section</button>' +
      '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" id="pt_save">Save pattern (new version)</button></div></section>' +
      '<section class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Exam</th><th>Version</th><th>Sections</th><th>Duration</th><th>Structure</th><th>Official source</th><th>Verification</th><th>Status</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div></section></div>";

    const sections = [];
    function renderSecs() {
      const el = EP.qs("#pt_sections");
      el.innerHTML = sections.map(function (s, i) {
        return '<div class="pt-sec" data-i="' + i + '" style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap">' +
          '<input class="input pt-s-name" style="flex:2;min-width:140px" placeholder="Section name" value="' + EP.esc(s.name) + '">' +
          '<select class="input pt-s-subj" style="flex:1.4;min-width:110px">' + subjSelOpts.replace('value="' + (s.subject_id || "__none__") + '"', 'value="' + (s.subject_id || "") + '" selected') + "</select>" +
          '<select class="input pt-s-type" style="flex:1.4;min-width:110px">' + typeSelOpts + "</select>" +
          '<input class="input pt-s-count" type="number" style="width:70px" placeholder="Count" value="' + (s.count || "") + '">' +
          '<input class="input pt-s-marks" type="number" step="0.5" style="width:70px" placeholder="Marks" value="' + (s.marks || "") + '">' +
          '<input class="input pt-s-neg" type="number" step="0.5" style="width:70px" placeholder="Neg" value="' + (s.neg || "") + '">' +
          '<button class="btn btn-sm btn-danger pt-s-rem" type="button">&times;</button></div>';
      }).join("") || '<div class="muted">No sections.</div>';
      EP.qsa(".pt-s-rem").forEach(function (b) {
        b.addEventListener("click", function () { const p = b.parentElement; const idx = parseInt(p.getAttribute("data-i"), 10); sections.splice(idx, 1); renderSecs(); });
      });
      EP.qsa(".pt-s-subj").forEach(function (sel, i) { sel.value = sections[i].subject_id || ""; });
      EP.qsa(".pt-s-type").forEach(function (sel, i) { sel.value = sections[i].question_type_id || ""; });
    }
    EP.qs("#pt_add_sec").addEventListener("click", function () {
      sections.push({ name: "", subject_id: "", question_type_id: "", count: "", marks: "", neg: "" });
      renderSecs();
    });
    function readSecs() {
      EP.qsa(".pt-sec").forEach(function (el, i) {
        const s = sections[i]; if (!s) return;
        s.name = el.querySelector(".pt-s-name").value;
        s.subject_id = el.querySelector(".pt-s-subj").value;
        s.question_type_id = el.querySelector(".pt-s-type").value;
        s.count = parseInt(el.querySelector(".pt-s-count").value, 10) || 0;
        s.marks = parseFloat(el.querySelector(".pt-s-marks").value) || null;
        s.neg = parseFloat(el.querySelector(".pt-s-neg").value) || null;
      });
    }
    EP.qs("#pt_save").addEventListener("click", async function () {
      readSecs();
      const examId = EP.qs("#pt_exam").value;
      const name = EP.qs("#pt_name").value;
      if (!examId || !name) { EP.toast("Name and exam are required", "error"); return; }
      const { data: prev } = await sb().from("exam_patterns").select("version").eq("exam_id", examId).order("version", { ascending: false }).limit(1).maybeSingle();
      const version = (prev && prev.version ? prev.version : 0) + 1;
      const secs = sections.filter(function (s) { return s.name || s.subject_id || s.count; }).map(function (s) {
        const subj = (subjects || []).find(function (x) { return x.id === s.subject_id; });
        const type = (types || []).find(function (x) { return x.id === s.question_type_id; });
        return { name: s.name, subject_code: subj ? subj.code : null, count: s.count, marks: s.marks, negative_marks: s.neg, question_type_codes: type ? [type.code] : [] };
      });
      const totalQ = secs.reduce(function (a, s) { return a + (s.count || 0); }, 0);
      const totalM = secs.reduce(function (a, s) { return a + (s.count || 0) * (s.marks || parseFloat(EP.qs("#pt_marks").value) || 0); }, 0);
      // single-active invariant: archive other versions of this exam first
      await sb().from("exam_patterns").update({ is_active: false, updated_at: new Date().toISOString() }).eq("exam_id", examId);
      const { error } = await sb().from("exam_patterns").insert({
        tenant_id: EP.state.tenantId, exam_id: examId, name: name, version: version,
        is_active: true, duration_minutes: parseInt(EP.qs("#pt_dur").value, 10) || 180,
        total_questions: totalQ || null, total_marks: totalM || null,
        default_marks: parseFloat(EP.qs("#pt_marks").value) || 4,
        default_negative_marks: parseFloat(EP.qs("#pt_neg").value) || 1,
        academic_year: parseInt(EP.qs("#pt_year").value, 10) || null,
        effective_from: EP.qs("#pt_eff_from").value || null,
        effective_to: EP.qs("#pt_eff_to").value || null,
        official_source_url: EP.qs("#pt_src_url").value || null,
        official_document_title: EP.qs("#pt_src_title").value || null,
        official_document_year: parseInt(EP.qs("#pt_year").value, 10) || null,
        sections: secs
      });
      if (error) return EP.toast(error.message, "error");
      EP.toast("Pattern v" + version + " created (unverified — verify it against the official source)", "success");
      EP.navigate("/admin/patterns");
    });
    // §37: only ONE active pattern per exam — activating a version archives
    // every other version of the same exam in the same write.
    EP.qsa("[data-act]").forEach(function (b) {
      b.addEventListener("click", async function () {
        const id = b.getAttribute("data-act");
        const pat = (pats || []).find(function (p) { return p.id === id; });
        if (!pat) return;
        if (pat.is_active) {
          await sb().from("exam_patterns").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
        } else {
          await sb().from("exam_patterns").update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("exam_id", pat.exam_id).neq("id", id);
          await sb().from("exam_patterns").update({ is_active: true, updated_at: new Date().toISOString() }).eq("id", id);
        }
        EP.navigate("/admin/patterns");
      });
    });
    // §37 "Verify Official Pattern": stamps verified_at/verified_by after the
    // admin has checked the configuration against its recorded official source.
    EP.qsa("[data-verify]").forEach(function (b) {
      b.addEventListener("click", async function () {
        const id = b.getAttribute("data-verify");
        const pat = (pats || []).find(function (p) { return p.id === id; });
        if (!pat) return;
        if (!pat.official_source_url) return EP.toast("Set the official source URL before verifying (edit the pattern or re-create as a new version).", "error");
        if (!confirm("Confirm you have checked this pattern against:\n" + pat.official_source_url + "\n\nThis stamps it verified (" + new Date().toLocaleString() + ").")) return;
        const { error } = await sb().from("exam_patterns").update({
          verified_at: new Date().toISOString(), verified_by: EP.state.user ? EP.state.user.id : null, updated_at: new Date().toISOString(),
        }).eq("id", id);
        if (error) return EP.toast(error.message, "error");
        EP.toast("Pattern marked verified", "success");
        EP.navigate("/admin/patterns");
      });
    });
    EP.qsa("[data-del]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Delete this pattern version?\n\nHistorical papers reference pattern versions — prefer Archive so old papers stay reproducible.")) return;
        await sb().from("exam_patterns").delete().eq("id", b.getAttribute("data-del"));
        EP.navigate("/admin/patterns");
      });
    });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  // ---- Admin: Tenants (platform only) ----
  EP.register("/admin/tenants", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading tenants…");
    const { data: tenants } = await sb().from("tenants").select("id,name,slug,status,created_at,email").order("created_at", { ascending: false }).limit(200);
    const rows = (tenants || []).map(function (t) {
      return '<tr><td>' + EP.esc(t.name) + "</td><td>" + EP.esc(t.slug) + "</td><td>" + EP.esc(t.email || "—") + "</td>" +
        '<td><span class="badge b-' + (t.status === "SUSPENDED" ? "bad" : "ok") + '">' + EP.esc(t.status) + "</span></td>" +
        "<td>" + EP.fmtDate(t.created_at) + "</td>" +
        '<td><button class="btn btn-sm" data-tstat="' + t.id + '" data-to="' + (t.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED") + '">' + (t.status === "SUSPENDED" ? "Reactivate" : "Suspend") + '</button></td></tr>';
    }).join("") || '<tr><td colspan="6" class="muted">No tenants.</td></tr>';
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Tenant Management</h2><a class="btn btn-sm" href="#/admin">Back</a></div>' +
      '<section class="card"><h3>Create tenant</h3><div class="form-grid">' +
        '<div class="field"><label>Name</label><input id="tn_name" class="input" placeholder="Acme Coaching"></div>' +
        '<div class="field"><label>Slug</label><input id="tn_slug" class="input" placeholder="acme-coaching"></div>' +
        '<div class="field"><label>Type</label><select id="tn_type" class="input"><option>INDIVIDUAL</option><option>INSTITUTION</option><option>SCHOOL</option></select></div>' +
      '</div><button class="btn btn-primary btn-sm" id="tn_create">Create tenant (TRIAL + 14 days)</button><span id="tn_res" class="muted"></span></section>' +
      '<section class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Slug</th><th>Email</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div></section></div>";
    EP.qs("#tn_create").addEventListener("click", async function () {
      const name = EP.qs("#tn_name").value.trim();
      const slug = EP.qs("#tn_slug").value.trim();
      if (!name) { EP.toast("Name required", "error"); return; }
      const { data, error } = await sb().rpc("app_create_tenant", { p_name: name, p_slug: slug || null, p_type: EP.qs("#tn_type").value });
      if (error) { EP.qs("#tn_res").textContent = error.message; return; }
      if (data && data.error) { EP.qs("#tn_res").textContent = data.error; return; }
      EP.toast("Tenant created", "success");
      EP.navigate("/admin/tenants");
    });
    EP.qsa("[data-tstat]").forEach(function (b) {
      b.addEventListener("click", async function () {
        const { error } = await sb().rpc("app_update_tenant_status", { p_tenant_id: b.getAttribute("data-tstat"), p_status: b.getAttribute("data-to") });
        if (error) EP.toast(error.message, "error");
        else { EP.toast("Tenant status updated", "success"); EP.navigate("/admin/tenants"); }
      });
    });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  // ---- Admin: Security events ----
  EP.register("/admin/security", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading security events…");
    const { data, error } = await sb().rpc("app_security_events", { p_tenant_id: null, p_limit: 200 });
    const rows = (Array.isArray(data) ? data : []).map(function (e) {
      return '<tr><td>' + EP.esc(e.event_type) + "</td><td>" + EP.esc(e.tenant_id || "—") + "</td>" +
        "<td>" + EP.esc(JSON.stringify(e.detail || {})) + "</td><td>" + EP.esc(e.ip_address || "—") + "</td><td>" + EP.fmtDate(e.created_at) + "</td></tr>";
    }).join("") || '<tr><td colspan="5" class="muted">No security events.</td></tr>';
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Security Events</h2><a class="btn btn-sm" href="#/admin">Back</a></div>' +
      (error ? '<div class="empty error">' + EP.esc(error.message) + "</div>" : "") +
      '<section class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Type</th><th>Tenant</th><th>Detail</th><th>IP</th><th>When</th></tr></thead><tbody>' + rows + "</tbody></table></div></section></div>";
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  // ---- Admin: Plans ----
  EP.register("/admin/plans", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading plans…");
    const { data: plans } = await sb().from("plans").select("*").order("price_monthly");
    const rows = (plans || []).map(function (p) {
      return '<tr><td>' + EP.esc(p.name) + "</td><td>₹" + EP.fmtMarks(p.price_monthly) + "</td><td>₹" + EP.fmtMarks(p.price_yearly) + "</td>" +
        "<td>" + EP.esc(JSON.stringify(p.features || {})) + "</td><td>" + (p.is_active ? '<span class="badge b-ok">active</span>' : '<span class="badge b-warn">inactive</span>') + "</td>" +
        '<td><button class="btn btn-sm" data-pact="' + p.id + '">' + (p.is_active ? "Deactivate" : "Activate") + '</button></td></tr>';
    }).join("") || '<tr><td colspan="6" class="muted">No plans.</td></tr>';
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Plans</h2><a class="btn btn-sm" href="#/admin">Back</a></div>' +
      '<section class="card"><h3>New plan</h3><div class="form-grid">' +
        '<div class="field"><label>Name</label><input id="pl_name" class="input" placeholder="Pro"></div>' +
        '<div class="field"><label>Monthly (₹)</label><input id="pl_m" class="input" type="number" step="0.01" value="0"></div>' +
        '<div class="field"><label>Yearly (₹)</label><input id="pl_y" class="input" type="number" step="0.01" value="0"></div>' +
        '<div class="field"><label>Features JSON</label><input id="pl_f" class="input" placeholder=\'{"papers_per_month":50}\'></div>' +
      '</div><button class="btn btn-primary btn-sm" id="pl_save">Add plan</button></section>' +
      '<section class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Monthly</th><th>Yearly</th><th>Features</th><th>Status</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div></section></div>";
    EP.qs("#pl_save").addEventListener("click", async function () {
      let features = {};
      try { features = JSON.parse(EP.qs("#pl_f").value || "{}"); } catch (_) { return EP.toast("Features JSON invalid", "error"); }
      const { error } = await sb().from("plans").insert({
        name: EP.qs("#pl_name").value, price_monthly: parseFloat(EP.qs("#pl_m").value) || 0,
        price_yearly: parseFloat(EP.qs("#pl_y").value) || 0, features: features
      });
      if (error) return EP.toast(error.message, "error");
      EP.toast("Plan added", "success");
      EP.navigate("/admin/plans");
    });
    EP.qsa("[data-pact]").forEach(function (b) {
      b.addEventListener("click", async function () {
        const id = b.getAttribute("data-pact");
        const plan = (plans || []).find(function (p) { return p.id === id; });
        if (!plan) return;
        await sb().from("plans").update({ is_active: !plan.is_active }).eq("id", id);
        EP.navigate("/admin/plans");
      });
    });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });
  EP.register("/settings", async function (main) {
    main.innerHTML = EP.spinner("Loading settings…");
    const s = EP.state;
    const { data: t } = await sb().from("tenants").select("*").eq("id", s.tenantId).maybeSingle();
    const identities = await EP.auth.getIdentities();
    const hasGoogle = identities.some(function (i) { return i.provider === "google"; });
    const hasEmail = identities.some(function (i) { return i.provider === "email"; });

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Settings</h2></div>' +
      '<section class="card"><h3>Profile</h3><div class="form-grid">' +
        '<div class="field"><label>Full name</label><input id="s_name" class="input" value="' + EP.esc((s.profile && s.profile.full_name) || "") + '"></div>' +
        '<div class="field"><label>Email</label><input class="input" value="' + EP.esc(s.user.email || "") + '" disabled></div>' +
        '<div class="field"><label>Phone</label><input id="s_phone" class="input" value="' + EP.esc((s.profile && s.profile.phone) || "") + '"></div>' +
      '</div><button class="btn btn-primary btn-sm" id="save_prof">Save profile</button></section>' +
      '<section class="card"><h3>Security</h3>' +
        '<div class="field"><label>Current password</label><input id="s_cur_pw" type="password" class="input" placeholder="Enter current password"></div>' +
        '<div class="field"><label>New password</label><input id="s_new_pw" type="password" class="input" placeholder="Min 8 chars, uppercase, lowercase, number, special char"></div>' +
        '<div class="field"><label>Confirm new password</label><input id="s_cnf_pw" type="password" class="input" placeholder="Re-enter new password"></div>' +
        '<button class="btn btn-primary btn-sm" id="save_pw">Change password</button>' +
      "</section>" +
      '<section class="card"><h3>Connected accounts</h3>' +
        '<ul class="simple-list">' +
          '<li><span>Email / Password</span><span class="badge ' + (hasEmail ? 'b-ok' : 'b-warn') + '">' + (hasEmail ? 'Connected' : 'Not connected') + '</span></li>' +
          '<li><span>Google</span><span class="badge ' + (hasGoogle ? 'b-ok' : 'b-warn') + '">' + (hasGoogle ? 'Connected' : 'Not connected') + '</span>' +
            (hasGoogle ? ' <button class="btn btn-sm btn-danger" id="unlink_google" style="margin-left:8px">Disconnect</button>' : ' <button class="btn btn-sm btn-ghost" id="link_google" style="margin-left:8px">Connect</button>') +
          "</li>" +
        "</ul>" +
        '<p class="hint">You must have at least one authentication method connected.</p>' +
      "</section>" +
      '<section class="card"><h3>Language</h3><p class="muted">UI language for this browser (question content keeps its original language and scientific notation).</p>' +
        '<div class="btn-row">' +
          '<button class="btn btn-sm" data-lang="en">English</button>' +
          '<button class="btn btn-sm" data-lang="hi">हिन्दी</button>' +
          '<button class="btn btn-sm" data-lang="gu">ગુજરાતી</button>' +
        '</div></section>' +
      '<section class="card"><h3>Notifications</h3><p class="muted">Choose which notification types you want to see in this browser.</p>' +
        '<div class="form-grid" id="notif_prefs"></div></section>' +
      (EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"]) ? '<section class="card"><h3>Storage &amp; Google Drive</h3>' +
        '<p class="muted">Google Drive connection, folder structure, uploads and retry queue are managed from the storage dashboard.</p>' +
        '<a class="btn btn-sm" href="#/admin/storage">Open Google Drive / Storage dashboard</a></section>' : "") +
      (EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"]) ? '<section class="card"><h3>Roles &amp; permissions</h3>' +
        '<p class="muted">Your role: <b>' + EP.esc(s.role || "—") + '</b> · permissions granted: <b>' + s.permissions.size + '</b> (frontend gate). Database RLS + RPC authorization enforce the same grants server-side.</p>' +
        '<a class="btn btn-sm" href="#/admin/tenants">Tenants &amp; memberships</a> <a class="btn btn-sm" href="#/admin/security">Security events</a></section>' : "") +
      (EP.can("branding.manage") && t ? '<section class="card"><h3>Institution branding</h3><div class="form-grid">' +
        '<div class="field"><label>Institution name</label><input id="b_name" class="input" value="' + EP.esc(t.name || "") + '"></div>' +
        '<div class="field"><label>Address</label><input id="b_addr" class="input" value="' + EP.esc(t.address || "") + '"></div>' +
        '<div class="field"><label>GSTIN</label><input id="b_gstin" class="input" value="' + EP.esc(t.gstin || "") + '"></div>' +
        '<div class="field"><label>Header text</label><input id="b_header" class="input" value="' + EP.esc(t.header_text || "") + '"></div>' +
        '<div class="field"><label>Footer text</label><input id="b_footer" class="input" value="' + EP.esc(t.footer_text || "") + '"></div>' +
        '<div class="field"><label>Logo URL</label><input id="b_logo" class="input" value="' + EP.esc(t.logo_url || "") + '"></div>' +
        '<div class="field"><label>Logo image</label><input type="file" id="b_logo_file" accept="image/*"><button class="btn btn-sm" id="b_upload" type="button">Upload</button></div>' +
        '<div class="field"><label>Watermark image</label><input type="file" id="b_wm_file" accept="image/*"><button class="btn btn-sm" id="b_wm_upload" type="button">Upload</button></div>' +
        '<div id="b_logo_preview">' + (t.logo_url ? '<img src="' + EP.esc(t.logo_url) + '" style="height:48px">' : "") + '</div>' +
        (t.watermark_url ? '<div id="b_wm_preview"><img src="' + EP.esc(t.watermark_url) + '" style="height:48px;opacity:0.5"></div>' : "") +
      '</div><button class="btn btn-primary btn-sm" id="save_brand">Save branding</button></section>' : "") +
      "</div>";

    EP.qs("#save_prof").addEventListener("click", async function () {
      await sb().from("profiles").update({ full_name: EP.qs("#s_name").value, phone: EP.qs("#s_phone").value }).eq("auth_user_id", s.user.id);
      EP.toast("Profile saved", "success");
    });
    EP.qs("#save_pw").addEventListener("click", async function () {
      const cur = EP.qs("#s_cur_pw").value, nw = EP.qs("#s_new_pw").value, cnf = EP.qs("#s_cnf_pw").value;
      if (!cur || !nw || !cnf) { EP.toast("Fill all password fields", "error"); return; }
      if (nw !== cnf) { EP.toast("New passwords do not match", "error"); return; }
      const pwErr = EP.auth.validatePassword(nw);
      if (pwErr) { EP.toast(pwErr, "error"); return; }
      EP.qs("#save_pw").disabled = true; EP.qs("#save_pw").textContent = "Updating…";
      try {
        await EP.auth.signIn(s.user.email, cur);
        await EP.auth.updatePassword(nw);
        EP.secLog("PASSWORD_CHANGED", null);
        EP.toast("Password changed successfully", "success");
        EP.qs("#s_cur_pw").value = ""; EP.qs("#s_new_pw").value = ""; EP.qs("#s_cnf_pw").value = "";
      } catch (e) {
        if (e.message && e.message.toLowerCase().includes("invalid")) {
          EP.toast("Current password is incorrect", "error");
        } else {
          EP.toast(e.message || "Failed to change password", "error");
        }
      } finally { EP.qs("#save_pw").disabled = false; EP.qs("#save_pw").textContent = "Change password"; }
    });

    const linkBtn = EP.qs("#link_google");
    if (linkBtn) linkBtn.addEventListener("click", async function () {
      try {
        await EP.auth.linkIdentity("google");
        EP.toast("Google account linked. Please complete the Google consent flow.", "success");
        await EP.auth.signInWithGoogle();
      } catch (e) { EP.toast(e.message || "Failed to link Google", "error"); }
    });
    const unlinkBtn = EP.qs("#unlink_google");
    if (unlinkBtn) unlinkBtn.addEventListener("click", async function () {
      if (!hasEmail) { EP.toast("You must have email/password connected before disconnecting Google", "error"); return; }
      try { await EP.auth.unlinkIdentity("google"); EP.toast("Google disconnected", "success"); EP.navigate("/settings"); }
      catch (e) { EP.toast(e.message || "Failed to disconnect", "error"); }
    });

    const sb2 = EP.qs("#save_brand");
    if (sb2) sb2.addEventListener("click", async function () {
      await sb().from("tenants").update({
        name: EP.qs("#b_name").value,
        address: EP.qs("#b_addr").value,
        gstin: EP.qs("#b_gstin").value,
        logo_url: EP.qs("#b_logo").value,
        header_text: EP.qs("#b_header").value,
        footer_text: EP.qs("#b_footer").value
      }).eq("id", s.tenantId);
      EP.toast("Branding saved", "success");
    });
    const up = EP.qs("#b_upload");
    if (up) up.addEventListener("click", async function () {
      const file = EP.qs("#b_logo_file").files[0];
      if (!file) return EP.toast("Choose a file", "error");
      const path = EP.state.tenantId + "/" + Date.now() + "-" + file.name.replace(/\s+/g, "_");
      try {
        await EP.uploadToStorage("institution-logos", path, file);
        await EP.recordObject("institution-logos", path, file);
        const url = await EP.storagePublicUrl("institution-logos", path);
        EP.qs("#b_logo").value = url;
        EP.qs("#b_logo_preview").innerHTML = '<img src="' + url + '" style="height:48px">';
        EP.toast("Logo uploaded", "success");
      } catch (e) { EP.toast(e.message || "Upload failed", "error"); }
    });
    const wm = EP.qs("#b_wm_upload");
    if (wm) wm.addEventListener("click", async function () {
      const file = EP.qs("#b_wm_file").files[0];
      if (!file) return EP.toast("Choose a file", "error");
      const path = EP.state.tenantId + "/watermarks/" + Date.now() + "-" + file.name.replace(/\s+/g, "_");
      try {
        await EP.uploadToStorage("institution-logos", path, file);
        await EP.recordObject("institution-logos", path, file);
        const url = await EP.storagePublicUrl("institution-logos", path);
        await sb().from("tenants").update({ watermark_url: url }).eq("id", s.tenantId);
        EP.toast("Watermark uploaded", "success");
      } catch (e) { EP.toast(e.message || "Upload failed", "error"); }
    });

    // ---- Language (UI chrome; question content is never rewritten) ----
    EP.qsa("[data-lang]").forEach(function (b) {
      const lang = b.getAttribute("data-lang");
      b.addEventListener("click", function () {
        EP.i18n.set(lang);
        EP.toast("UI language set to " + lang.toUpperCase(), "success");
        EP.render();
      });
    });

    // ---- Notification preferences (per-browser) ----
    const NOTIF_TYPES = ["DPP_ASSIGNED", "EXAM_ASSIGNED", "RESULT_PUBLISHED", "WEAK_TOPIC", "REVISION_DUE", "ANNOUNCEMENT"];
    const prefs = EP.loadNotifPrefs();
    const prefsEl = EP.qs("#notif_prefs");
    if (prefsEl) {
      prefsEl.innerHTML = NOTIF_TYPES.map(function (nt) {
        const label = nt.toLowerCase().replace(/_/g, " ");
        return '<div class="field"><label><input type="checkbox" data-nt="' + nt + '"' + (prefs[nt] !== false ? " checked" : "") + ' style="width:auto"> ' + label + "</label></div>";
      }).join("");
      EP.qsa("[data-nt]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          EP.saveNotifPrefs(nt2prefs());
          EP.toast("Notification preferences saved", "success");
        });
      });
    }
    function nt2prefs() {
      const out = {};
      EP.qsa("[data-nt]").forEach(function (cb) { out[cb.getAttribute("data-nt")] = cb.checked; });
      return out;
    }
  });

  // ===========================================================================
  // PRACTICE (question practice mode)
  // ===========================================================================
  EP.register("/practice", async function (main) {
    main.innerHTML = EP.spinner("Loading practice…");
    const { data: subjects } = await sb().from("subjects").select("id,name").order("name");
    const { data: types } = await sb().from("question_types").select("id,code,name").eq("is_active", true).order("name");
    const seenSubj = {};
    const uniqSubjects = (subjects || []).filter(function (s) { return seenSubj[s.name] ? false : (seenSubj[s.name] = true); });
    const subjOpts = '<option value="">All subjects</option>' + uniqSubjects.map(function (s) { return '<option value="' + s.id + '">' + EP.esc(s.name) + "</option>"; }).join("");
    const typeOpts = '<option value="">All types</option>' + (types || []).map(function (t) { return '<option value="' + t.id + '">' + EP.esc(t.name) + "</option>"; }).join("");
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Practice</h2></div>' +
      '<div class="toolbar card">' +
      '<select id="pr_subj" class="input">' + subjOpts + "</select>" +
      '<select id="pr_type" class="input">' + typeOpts + "</select>" +
      '<select id="pr_diff" class="input"><option value="">Any difficulty</option><option>EASY</option><option>MEDIUM</option><option>HARD</option></select>' +
      '<button class="btn btn-primary" id="pr_start">Start practice</button></div>' +
      '<div class="grid-2">' +
        '<section class="card"><h3>Quick drill</h3><p class="muted">Random question from filters above.</p><div id="pr_area"></div></section>' +
        '<section class="card"><h3>Chapter / Topic practice</h3><div id="pr_drill"></div></section>' +
      "</div></div>";
    EP.qs("#pr_start").addEventListener("click", async function () {
      let q = sb().from("questions").select("id, question_text, difficulty, subjects(name), chapters(name)").eq("is_deleted", false).eq("verification_status", "VERIFIED");
      const sid = EP.qs("#pr_subj").value; if (sid) q = q.eq("subject_id", sid);
      const tid = EP.qs("#pr_type").value; if (tid) q = q.eq("question_type_id", tid);
      const diff = EP.qs("#pr_diff").value; if (diff) q = q.eq("difficulty", diff);
      const { data } = await q.order("random()").limit(1).maybeSingle();
      if (!data) { EP.qs("#pr_area").innerHTML = '<div class="empty">No questions match your filters.</div>'; return; }
      const { data: opts } = await sb().from("question_options").select("*").eq("question_id", data.id).order("display_order");
      const { data: ans } = await sb().from("question_answers").select("*").eq("question_id", data.id).maybeSingle();
      const optHtml = opts && opts.length ? '<ol class="opts-pick">' + opts.map(function (o) {
        return '<label class="opt-pick"><input type="radio" name="pr_opt" value="' + EP.esc(o.option_key) + '"> <b>' + EP.esc(o.option_key) + ".</b> " + EP.esc(o.option_text) + "</label>";
      }).join("") + "</ol>" : '<div class="muted">Numerical/integer answer type — enter below:<br><input id="pr_num" class="input"></div>';
      const correct = ans && ans.correct_option_keys ? ans.correct_option_keys : [];
      EP.qs("#pr_area").innerHTML =
        '<div class="card"><div class="q-meta muted">' + EP.esc((data.subjects && data.subjects.name) || "—") + ' · ' + EP.esc(data.difficulty || "—") + '</div>' +
        '<div class="q-body">' + EP.safeHtml(data.question_text || "") + "</div>" + optHtml +
        '<div class="btn-row"><button class="btn btn-primary" id="pr_check">Check answer</button>' +
        '<button class="btn btn-ghost" id="pr_next">Next</button></div>' +
        '<div id="pr_feedback"></div></div>';
      const check = function () {
        let sel; const num = EP.qs("#pr_num");
        if (num) sel = num.value ? [num.value] : [];
        else sel = EP.qsa('input[name="pr_opt"]:checked').map(function (c) { return c.dataset ? c.value : c.getAttribute("value"); });
        const isCorrect = correct.length ? (sel.slice().sort().join(",") === correct.slice().sort().join(",")) : false;
        const fb = EP.qs("#pr_feedback");
        fb.innerHTML = isCorrect ? '<div class="empty ok"><b>Correct!</b></div>' : '<div class="empty error"><b>Incorrect.</b> Answer: ' + EP.esc(correct.join(", ") || "—") + "</div>";
        if (EP.state.user) {
          sb().from("practice_logs").insert({ user_id: EP.state.user.id, question_id: data.id, correct: isCorrect, time_spent: 0 }).then(function () {}, function () {});
        }
      };
      EP.qs("#pr_check").addEventListener("click", check);
      EP.qs("#pr_next").addEventListener("click", function () { EP.qs("#pr_start").click(); });
    });
    (async function loadDrill() {
      const { data: subjs } = await sb().from("subjects").select("id,name,exam_id").order("name");
      const { data: chaps } = await sb().from("chapters").select("id,name,subject_id,subjects(name)").order("display_order");
      const { data: tops } = await sb().from("topics").select("id,name,chapter_id,chapters(name,subjects(name))").order("name");
      const subjMap = {}; (subjs || []).forEach(function (s) { subjMap[s.id] = s; });
      const chapMap = {}; (chaps || []).forEach(function (c) { chapMap[c.id] = c; });
      const topMap = {}; (tops || []).forEach(function (t) { topMap[t.id] = t; });
      const html = (subjs || []).map(function (s) {
        const sChaps = (chaps || []).filter(function (c) { return c.subject_id === s.id; });
        if (!sChaps.length) return "";
        const chapHtml = sChaps.map(function (c) {
          const cTops = (tops || []).filter(function (t) { return t.chapter_id === c.id; });
          const topHtml = cTops.length ? '<ul class="simple-list" style="margin-left:12px">' + cTops.map(function (t) { return '<li><a href="#/practice/topic/' + t.id + '">' + EP.esc(t.name) + '</a> <a class="btn btn-sm" href="#/practice/chapter/' + c.id + '">Chapter practice</a></li>'; }).join("") + "</ul>" : "";
          return '<li><b>' + EP.esc(c.name) + '</b> <a class="btn btn-sm" href="#/practice/chapter/' + c.id + '">Practice</a>' + topHtml + "</li>";
        }).join("");
        return '<div style="margin-bottom:12px"><b>' + EP.esc(s.name) + '</b><ul class="simple-list" style="margin-left:12px">' + chapHtml + "</ul></div>";
      }).join("");
      const drill = EP.qs("#pr_drill");
      if (drill) drill.innerHTML = html || '<div class="muted">No chapters/topics configured.</div>';
    })();
  });

  // ===========================================================================
  // BOOKMARKS
  // ===========================================================================
  EP.register("/bookmarks", async function (main) {
    main.innerHTML = EP.spinner("Loading bookmarks…");
    const { data } = await sb().from("bookmarks").select("id, created_at, questions(question_text, difficulty, subjects(name))").eq("user_id", EP.state.user.id).order("created_at", { ascending: false }).limit(100);
    const rows = (data && data.length) ? data.map(function (b) {
      const q = b.questions || {};
      return '<tr><td class="qtxt">' + EP.esc((q.question_text || "").replace(/<[^>]+>/g, "").slice(0, 120)) + '</td><td>' + EP.esc((q.subjects && q.subjects.name) || "—") + '</td><td>' + EP.esc(q.difficulty || "—") + '</td><td><a class="btn btn-sm" href="#/questions/' + b.question_id + '">View</a> <button class="btn btn-sm btn-danger" data-bm-del="' + b.id + '">Remove</button></td></tr>';
    }).join("") : '<tr><td colspan="4" class="muted">No bookmarks yet.</td></tr>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Bookmarks</h2></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Question</th><th>Subject</th><th>Difficulty</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
    EP.qsa("[data-bm-del]").forEach(function (b) {
      b.addEventListener("click", async function () {
        await sb().from("bookmarks").delete().eq("id", b.getAttribute("data-bm-del"));
        EP.toast("Removed", "success");
        EP.render();
      });
    });
  });

  // ===========================================================================
  // MISTAKES (incorrect practice logs)
  // ===========================================================================
  EP.register("/mistakes", async function (main) {
    main.innerHTML = EP.spinner("Loading mistakes…");
    const { data } = await sb().from("practice_logs").select("id, created_at, time_spent, questions(question_text, difficulty, subjects(name))").eq("user_id", EP.state.user.id).eq("correct", false).order("created_at", { ascending: false }).limit(100);
    const rows = (data && data.length) ? data.map(function (m) {
      const q = m.questions || {};
      return '<tr><td class="qtxt">' + EP.esc((q.question_text || "").replace(/<[^>]+>/g, "").slice(0, 120)) + '</td><td>' + EP.esc((q.subjects && q.subjects.name) || "—") + '</td><td>' + EP.esc(q.difficulty || "—") + '</td><td><a class="btn btn-sm" href="#/questions/' + q.id + '">Review</a></td></tr>';
    }).join("") : '<tr><td colspan="4" class="muted">No mistakes recorded yet. Keep practicing!</td></tr>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>My Mistakes</h2></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Question</th><th>Subject</th><th>Difficulty</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
  });

  // ===========================================================================
  // REPORTS (hub)
  // ===========================================================================
  EP.register("/reports", async function (main) {
    main.innerHTML = EP.spinner("Loading reports…");
    const [qN, pN, rN] = await Promise.all([
      sb().from("questions").select("*", { count: "exact", head: true }).eq("is_deleted", false),
      sb().from("papers").select("*", { count: "exact", head: true }),
      sb().from("results").select("*", { count: "exact", head: true }),
    ]);
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Reports</h2></div>' +
      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="big">' + ((qN || {}).count || 0) + '</div><div class="muted">Questions</div></div>' +
        '<div class="stat-card"><div class="big">' + ((pN || {}).count || 0) + '</div><div class="muted">Papers</div></div>' +
        '<div class="stat-card"><div class="big">' + ((rN || {}).count || 0) + '</div><div class="muted">Results</div></div>' +
      '</div>' +
      '<section class="card"><h3>Available reports</h3><div class="btn-row">' +
        '<a class="btn btn-primary" href="#/analytics">Analytics</a>' +
        '<a class="btn btn-ghost" href="#/results">Results</a>' +
        '<button class="btn btn-ghost" id="rep_q">Question bank report</button>' +
        '<button class="btn btn-ghost" id="rep_p">Paper usage report</button>' +
        '<button class="btn btn-ghost" id="rep_perf">Performance / proficiency report</button>' +
      "</div></section></div>";
    EP.qs("#rep_q") && EP.qs("#rep_q").addEventListener("click", async function () {
      const { data } = await sb().from("questions").select("verification_status, difficulty, subject_id, subjects(name)").eq("is_deleted", false);
      const counts = {}; (data || []).forEach(function (r) {
        const k = (r.verification_status || "UNKNOWN") + " | " + (r.difficulty || "UNKNOWN");
        counts[k] = (counts[k] || 0) + 1;
      });
      const rows = Object.entries(counts).map(function (e) { return '<tr><td>' + EP.esc(e[0]) + "</td><td>" + EP.fmtMarks(e[1]) + "</td></tr>"; }).join("");
      EP.modal("Question Bank Report", '<div class="table-wrap"><table class="data-table"><thead><tr><th>Status | Difficulty</th><th>Count</th></tr></thead><tbody>' + rows + "</tbody></table></div>",
        '<button class="btn btn-sm" id="rep_q_csv">Export CSV</button><button class="btn btn-sm" data-close>Close</button>');
      const qc = EP.qs("#rep_q_csv");
      if (qc) qc.addEventListener("click", function () {
        EP.exportCsv("question-bank-report.csv", Object.keys(counts).map(function (k) { return { bucket: k, count: counts[k] }; }));
      });
    });
    const repPerf = EP.qs("#rep_perf");
    if (repPerf) repPerf.addEventListener("click", async function () {
      repPerf.disabled = true;
      const [resR, logR] = await Promise.all([
        sb().from("results").select("correct, incorrect, unanswered, total_marks, marks, percentage"),
        sb().from("practice_logs").select("correct, questions(subjects(name), chapters(name))").eq("user_id", EP.state.user.id),
      ]);
      repPerf.disabled = false;
      const results = resR.data || [], logs = logR.data || [];
      const attempted = results.reduce(function (s, r) { return s + (r.correct || 0) + (r.incorrect || 0); }, 0);
      const correct = results.reduce(function (s, r) { return s + (r.correct || 0); }, 0);
      const resultAccuracy = attempted ? Math.round((correct / attempted) * 100) : 0;
      const subjAcc = {};
      let plAtt = 0, plCor = 0;
      (logs || []).forEach(function (l) {
        plAtt++;
        if (l.correct) plCor++;
        const q = l.questions || {};
        const sn = (q.subjects && q.subjects.name) || "Unknown";
        subjAcc[sn] = subjAcc[sn] || { attempted: 0, correct: 0 };
        subjAcc[sn].attempted++;
        if (l.correct) subjAcc[sn].correct++;
      });
      const rows = Object.keys(subjAcc).map(function (s) {
        const a = subjAcc[s];
        return '<tr><td>' + EP.esc(s) + "</td><td>" + a.attempted + "</td><td>" + a.correct + "</td><td>" + Math.round((a.correct / a.attempted) * 100) + "%</td></tr>";
      }).join("");
      EP.modal("Performance / Proficiency Report",
        '<div class="stat-grid" style="margin-bottom:10px">' +
          '<div class="stat-card"><div class="big">' + results.length + '</div><div class="muted">Tests taken</div></div>' +
          '<div class="stat-card"><div class="big">' + attempted + '</div><div class="muted">Questions attempted</div></div>' +
          '<div class="stat-card"><div class="big">' + correct + '</div><div class="muted">Correct</div></div>' +
          '<div class="stat-card"><div class="big">' + resultAccuracy + '%</div><div class="muted">Result accuracy</div></div>' +
          '<div class="stat-card"><div class="big">' + plAtt + '</div><div class="muted">Practice attempts</div></div>' +
          '<div class="stat-card"><div class="big">' + (plAtt ? Math.round((plCor / plAtt) * 100) : 0) + '%</div><div class="muted">Practice accuracy</div></div>' +
        "</div>" +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>Subject</th><th>Practice attempts</th><th>Correct</th><th>Accuracy</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="4" class="muted">No practice history yet.</td></tr>') + "</tbody></table></div>",
        '<button class="btn btn-sm" id="rep_perf_csv">Export CSV</button><button class="btn btn-sm" data-close>Close</button>');
      const pc2 = EP.qs("#rep_perf_csv");
      if (pc2) pc2.addEventListener("click", function () {
        EP.exportCsv("performance-report.csv", [{
          tests_taken: results.length, questions_attempted: attempted, correct: correct,
          result_accuracy_pct: resultAccuracy, practice_attempts: plAtt, practice_accuracy_pct: plAtt ? Math.round((plCor / plAtt) * 100) : 0
        }]);
      });
    });
    EP.qs("#rep_p") && EP.qs("#rep_p").addEventListener("click", async function () {
      const { data } = await sb().from("papers").select("title, total_questions, total_marks, created_at, exam_sessions(count)").order("created_at", { ascending: false }).limit(20);
      const rows = (data || []).map(function (p) {
        return '<tr><td>' + EP.esc(p.title) + "</td><td>" + (p.total_questions || 0) + "</td><td>" + EP.fmtMarks(p.total_marks) + "</td><td>" + (p.exam_sessions && p.exam_sessions.length ? p.exam_sessions[0].count : 0) + " attempts</td></tr>";
      }).join("");
      EP.modal("Paper Usage Report", '<div class="table-wrap"><table class="data-table"><thead><tr><th>Title</th><th>Questions</th><th>Marks</th><th>Attempts</th></tr></thead><tbody>' + rows + "</tbody></table></div>",
        '<button class="btn btn-sm" id="rep_p_csv">Export CSV</button><button class="btn btn-sm" data-close>Close</button>');
      const pc = EP.qs("#rep_p_csv");
      if (pc) pc.addEventListener("click", function () {
        EP.exportCsv("paper-usage-report.csv", (data || []).map(function (p) {
          return { title: p.title, questions: p.total_questions || 0, marks: p.total_marks || 0, attempts: (p.exam_sessions && p.exam_sessions.length ? p.exam_sessions[0].count : 0) };
        }));
      });
    });
  });

  // ===========================================================================
  // FINANCE — leads + sales
  // ===========================================================================
  EP.register("/finance/leads", async function (main) {
    if (!EP.hasRole(["FINANCE","SALES","SUPPORT","SUPER_ADMIN","PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading leads…");
    const { data } = await sb().from("leads").select("*").order("created_at", { ascending: false }).limit(200);
    const statuses = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
    const rows = (data && data.length) ? data.map(function (l) {
      const opts = statuses.map(function (s) { return '<option' + (s === l.status ? " selected" : "") + ">" + s + "</option>"; }).join("");
      return '<tr><td>' + EP.esc(l.name || "—") + "</td><td>" + EP.esc(l.email || "—") + "</td><td>" + EP.esc(l.phone || "—") + "</td><td>" + EP.esc(l.source || "—") + '</td><td><select class="input" data-lead="' + l.id + '">' + opts + "</select></td><td>" + EP.fmtDate(l.created_at) + "</td></tr>";
    }).join("") : '<tr><td colspan="6" class="muted">No leads yet.</td></tr>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Leads</h2><button class="btn btn-sm" id="new_lead_btn">New Lead</button><a class="btn btn-sm" href="#/reports">Back</a></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Status</th><th>Created</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
    EP.qsa("[data-lead]").forEach(function (sel) {
      sel.addEventListener("change", async function () {
        const { error } = await sb().from("leads").update({ status: sel.value }).eq("id", sel.dataset.lead);
        if (error) EP.toast(error.message, "error"); else EP.toast("Lead updated", "success");
      });
    });
    EP.qs("#new_lead_btn").addEventListener("click", function () {
      EP.modal("New Lead", '<div class="form-grid">' +
        '<div class="field"><label>Name</label><input id="lead_name" class="input"></div>' +
        '<div class="field"><label>Email</label><input id="lead_email" class="input" type="email"></div>' +
        '<div class="field"><label>Phone</label><input id="lead_phone" class="input"></div>' +
        '<div class="field"><label>Source</label><select id="lead_source" class="input"><option>WEBSITE</option><option>REFERRAL</option><option>WALKIN</option><option>CALL</option><option>OTHER</option></select></div>' +
        '<div class="field"><label>Notes</label><textarea id="lead_notes" class="input" rows="3"></textarea></div>' +
      '</div>',
      '<button class="btn btn-primary" id="save_lead">Save</button><button class="btn btn-sm" data-close>Cancel</button>');
      EP.qs("#save_lead").addEventListener("click", async function () {
        const name = EP.qs("#lead_name").value.trim();
        if (!name) { EP.toast("Enter lead name", "error"); return; }
        const { error } = await sb().from("leads").insert({
          tenant_id: EP.state.tenantId, name: name,
          email: EP.qs("#lead_email").value.trim() || null,
          phone: EP.qs("#lead_phone").value.trim() || null,
          source: EP.qs("#lead_source").value,
          notes: EP.qs("#lead_notes").value || null,
          status: "NEW", owner_id: EP.state.user.id,
        });
        if (error) { EP.toast(error.message, "error"); return; }
        EP.toast("Lead created", "success");
        EP.closeModal();
        EP.navigate("/finance/leads");
      });
    });
  }, { roles: ["FINANCE","SALES","SUPPORT","SUPER_ADMIN","PLATFORM_ADMIN"] });

  EP.register("/finance/sales", async function (main) {
    if (!EP.hasRole(["FINANCE","SALES","SUPER_ADMIN","PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading sales…");
    const { data } = await sb().from("sales_orders").select("*").order("created_at", { ascending: false }).limit(200);
    const statuses = ["PENDING", "PAID", "REFUNDED", "CANCELLED"];
    const rows = (data && data.length) ? data.map(function (s) {
      const opts = statuses.map(function (st) { return '<option' + (st === s.status ? " selected" : "") + ">" + st + "</option>"; }).join("");
      return '<tr><td>' + EP.esc(s.customer_name || "—") + "</td><td>" + EP.fmtMarks(s.amount) + "</td><td>" + EP.esc(s.plan_id || "—") + '</td><td><select class="input" data-order="' + s.id + '">' + opts + "</select></td><td>" + EP.fmtDate(s.created_at) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="muted">No sales yet.</td></tr>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Sales</h2><a class="btn btn-sm" href="#/reports">Back</a></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Amount</th><th>Plan</th><th>Status</th><th>Created</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
    EP.qsa("[data-order]").forEach(function (sel) {
      sel.addEventListener("change", async function () {
        const { error } = await sb().from("sales_orders").update({ status: sel.value, payment_date: sel.value === "PAID" ? new Date().toISOString().slice(0, 10) : null }).eq("id", sel.dataset.order);
        if (error) EP.toast(error.message, "error"); else EP.toast("Order updated", "success");
      });
    });
  }, { roles: ["FINANCE","SALES","SUPER_ADMIN","PLATFORM_ADMIN"] });

  EP.register("/finance/invoices", async function (main) {
    if (!EP.hasRole(["FINANCE","SALES","SUPER_ADMIN","PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading invoices…");
    const { data } = await sb().from("invoices").select("*").order("issued_at", { ascending: false }).limit(200);
    const rows = (data && data.length) ? data.map(function (inv) {
      return '<tr><td>' + EP.esc(inv.invoice_no || "—") + "</td><td>" + EP.esc(inv.customer_name || "—") + "</td><td>" + EP.fmtMarks(inv.amount) + "</td><td>" + EP.fmtMarks(inv.total) + "</td><td>" + EP.esc(inv.gstin || "—") + "</td><td>" + EP.fmtDate(inv.issued_at) + '</td><td><button class="btn btn-sm" data-print="' + inv.id + '">Print</button></td></tr>';
    }).join("") : '<tr><td colspan="7" class="muted">No invoices yet.</td></tr>';
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Invoices</h2>' +
      '<div class="btn-row"><button class="btn btn-primary" id="new_inv_btn">New Invoice</button><button class="btn btn-sm" id="export_inv_csv">Export CSV</button></div></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Invoice #</th><th>Customer</th><th>Subtotal</th><th>Total</th><th>GSTIN</th><th>Date</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
    const exportCsv = function (invs) {
      EP.exportCsv("invoices.csv", (invs || []).map(function (i) {
        return { invoice_no: i.invoice_no || "", customer: i.customer_name || "", gstin: i.gstin || "", amount: i.amount || 0, cgst: i.cgst || 0, sgst: i.sgst || 0, igst: i.igst || 0, total: i.total || 0, status: i.status || "", issued_at: i.issued_at || "" };
      }));
    };
    EP.qs("#export_inv_csv").addEventListener("click", function () { exportCsv(data); });
    EP.qsa("[data-print]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const inv = (data || []).find(function (x) { return x.id === btn.dataset.print; });
        if (!inv) return;
        EP.modal("Invoice " + (inv.invoice_no || ""),
          '<div class="invoice-sheet" id="invoice_sheet">' +
          '<div class="inv-head"><h2>TAX INVOICE</h2><div class="muted">Invoice # ' + EP.esc(inv.invoice_no || "—") + " · " + EP.fmtDate(inv.issued_at) + "</div></div>" +
          '<table class="data-table"><tbody>' +
          "<tr><th>Customer</th><td>" + EP.esc(inv.customer_name || "—") + "</td></tr>" +
          "<tr><th>GSTIN</th><td>" + EP.esc(inv.gstin || "—") + "</td></tr>" +
          "<tr><th>Status</th><td>" + EP.esc(inv.status || "—") + "</td></tr>" +
          '<tr><th>Subtotal</th><td>₹ ' + EP.fmtMarks(inv.amount) + "</td></tr>" +
          "<tr><th>CGST</th><td>₹ " + EP.fmtMarks(inv.cgst) + "</td></tr>" +
          "<tr><th>SGST</th><td>₹ " + EP.fmtMarks(inv.sgst) + "</td></tr>" +
          "<tr><th>IGST</th><td>₹ " + EP.fmtMarks(inv.igst) + "</td></tr>" +
          '<tr><th>Total</th><td><b>₹ ' + EP.fmtMarks(inv.total) + "</b></td></tr>" +
          "</tbody></table></div>",
          '<button class="btn btn-primary" id="print_inv">Print</button><button class="btn btn-sm" data-close>Close</button>');
        const pi = EP.qs("#print_inv");
        if (pi) pi.addEventListener("click", function () {
          const sheet = EP.qs("#invoice_sheet");
          if (sheet) { sheet.classList.add("print-only"); window.print(); sheet.classList.remove("print-only"); }
        });
      });
    });
    EP.qs("#new_inv_btn").addEventListener("click", function () {
      EP.modal("New Invoice", '<div class="form-grid">' +
        '<div class="field"><label>Customer name</label><input id="inv_cust" class="input"></div>' +
        '<div class="field"><label>GSTIN</label><input id="inv_gstin" class="input"></div>' +
        '<div class="field"><label>Amount (INR)</label><input id="inv_amt" class="input" type="number" step="0.01" value="0"></div>' +
        '<div class="field"><label>CGST</label><input id="inv_cgst" class="input" type="number" step="0.01" value="0"></div>' +
        '<div class="field"><label>SGST</label><input id="inv_sgst" class="input" type="number" step="0.01" value="0"></div>' +
        '<div class="field"><label>IGST</label><input id="inv_igst" class="input" type="number" step="0.01" value="0"></div>' +
        '<div class="field"><label>Status</label><select id="inv_status" class="input"><option>DRAFT</option><option>SENT</option><option>PAID</option><option>CANCELLED</option></select></div>' +
      '</div>',
      '<button class="btn btn-primary" id="save_inv">Save</button><button class="btn btn-sm" data-close>Cancel</button>');
      function recalc() {
        const a = parseFloat(EP.qs("#inv_amt").value || "0");
        const c = parseFloat(EP.qs("#inv_cgst").value || "0");
        const s = parseFloat(EP.qs("#inv_sgst").value || "0");
        const i = parseFloat(EP.qs("#inv_igst").value || "0");
        EP.qs("#inv_amt").value = a.toFixed(2);
        EP.qs("#inv_cgst").value = c.toFixed(2);
        EP.qs("#inv_sgst").value = s.toFixed(2);
        EP.qs("#inv_igst").value = i.toFixed(2);
      }
      EP.qsa("#inv_amt, #inv_cgst, #inv_sgst, #inv_igst").forEach(function (el) { el.addEventListener("input", recalc); });
      EP.qs("#save_inv").addEventListener("click", async function () {
        const amount = parseFloat(EP.qs("#inv_amt").value || "0");
        const cgst = parseFloat(EP.qs("#inv_cgst").value || "0");
        const sgst = parseFloat(EP.qs("#inv_sgst").value || "0");
        const igst = parseFloat(EP.qs("#inv_igst").value || "0");
        const total = +(amount + cgst + sgst + igst).toFixed(2);
        const customer = EP.qs("#inv_cust").value.trim();
        if (!customer) { EP.toast("Enter customer name", "error"); return; }
        // invoice number: INV-YYYYMMDD-XXXX (timestamp-based, globally unique)
        const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
        const rand = Math.floor(1000 + Math.random() * 9000);
        const { error } = await sb().from("invoices").insert({
          tenant_id: EP.state.tenantId,
          invoice_no: "INV-" + stamp + "-" + rand,
          customer_name: customer,
          gstin: EP.qs("#inv_gstin").value.trim() || null,
          amount: amount,
          cgst: cgst,
          sgst: sgst,
          igst: igst,
          total: total,
          status: EP.qs("#inv_status").value,
          issued_at: new Date().toISOString().slice(0, 10)
        });
        if (error) { EP.toast(error.message, "error"); return; }
        EP.toast("Invoice created", "success");
        EP.closeModal();
        EP.navigate("/finance/invoices");
      });
    });
  }, { roles: ["FINANCE","SALES","SUPER_ADMIN","PLATFORM_ADMIN"] });

  // ===========================================================================
  // ADMIN — data quality, usage, audit, system health
  // ===========================================================================
  EP.register("/admin/data-quality", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading data quality…");
    const [{ count: pending }, { count: verified }, { count: rejected }, { count: missingTopic }] = await Promise.all([
      sb().from("questions").select("*", { count: "exact", head: true }).eq("verification_status", "PENDING_REVIEW").eq("is_deleted", false),
      sb().from("questions").select("*", { count: "exact", head: true }).eq("verification_status", "VERIFIED").eq("is_deleted", false),
      sb().from("questions").select("*", { count: "exact", head: true }).eq("verification_status", "REJECTED").eq("is_deleted", false),
      sb().from("questions").select("*", { count: "exact", head: true }).eq("is_deleted", false).or("topic_id.is.null,chapter_id.is.null"),
    ]);
    const tiles = [
      { t: "Pending review", v: pending || 0, c: "b-warn" },
      { t: "Verified", v: verified || 0, c: "b-ok" },
      { t: "Rejected", v: rejected || 0, c: "b-bad" },
      { t: "Missing topic/chapter", v: missingTopic || 0, c: "b-warn" },
    ];
    const cards = tiles.map(function (x) {
      return '<div class="stat-card"><div class="stat-v">' + EP.fmtMarks(x.v) + '</div><div class="stat-l">' + x.t + "</div></div>";
    }).join("");
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Data Quality</h2><a class="btn btn-sm" href="#/admin">Back</a></div><div class="stat-grid">' + cards + '</div>' +
      '<section class="card"><h3>Actions</h3><div class="btn-row"><a class="btn btn-primary" href="#/questions?status=PENDING_REVIEW">Review pending questions</a></div></section></div>';
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  EP.register("/admin/usage", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading usage…");
    const { data } = await sb().from("usage").select("*").order("period", { ascending: false }).limit(100);
    const rows = (data && data.length) ? data.map(function (u) {
      return '<tr><td>' + EP.esc(u.tenant_id) + "</td><td>" + EP.esc(u.metric) + "</td><td>" + EP.esc(u.period) + "</td><td>" + EP.fmtMarks(u.count) + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="muted">No usage records.</td></tr>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Usage</h2><button class="btn btn-sm" id="export_usage_csv">Export CSV</button><a class="btn btn-sm" href="#/admin">Back</a></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Tenant</th><th>Metric</th><th>Period</th><th>Count</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
    const ucsv = EP.qs("#export_usage_csv");
    if (ucsv) ucsv.addEventListener("click", function () {
      EP.exportCsv("usage.csv", (data || []).map(function (u) {
        return { tenant_id: u.tenant_id, metric: u.metric, period: u.period, count: u.count };
      }));
    });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  EP.register("/admin/audit", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading audit log…");
    const { data } = await sb().from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
    const rows = (data && data.length) ? data.map(function (a) {
      return '<tr><td>' + EP.fmtDate(a.created_at) + "</td><td>" + EP.esc(a.user_id || "—") + "</td><td>" + EP.esc(a.action) + "</td><td>" + EP.esc(a.entity || "—") + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="muted">No audit logs.</td></tr>';
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Audit Log</h2><a class="btn btn-sm" href="#/admin">Back</a></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th></tr></thead><tbody>' + rows + "</tbody></table></div></div>";
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  EP.register("/admin/system-health", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading system health…");
    let h = {};
    let dbOk = false;
    try { const { data } = await sb().rpc("app_system_health"); h = data || {}; dbOk = !!data && typeof data === "object"; } catch (e) { EP.toast("System health check failed: " + (e.message || "unknown"), "error"); }
    const tiles = [
      { t: "Tenants", v: h.tenants },
      { t: "Users", v: h.auth_users },
      { t: "Questions", v: h.questions },
      { t: "Papers", v: h.papers },
      { t: "DPPs", v: h.dpps },
      { t: "Results", v: h.results },
      { t: "Storage objects", v: h.storage_objects },
      { t: "Audit logs", v: h.audit_logs },
    ];
    const cards = tiles.map(function (x) {
      return '<div class="stat-card"><div class="stat-v">' + EP.fmtMarks(x.v || 0) + '</div><div class="stat-l">' + EP.fmtMarks(x.t) + "</div></div>";
    }).join("");
    main.innerHTML = '<div class="page"><div class="page-head"><h2>System Health</h2><a class="btn btn-sm" href="#/admin">Back</a></div><div class="stat-grid">' + cards + '</div>' +
      '<section class="card"><h3>Status</h3><ul class="simple-list">' +
      '<li><span>Database RPC</span><span class="badge ' + (dbOk ? "b-ok" : "b-bad") + '">' + (dbOk ? "OK" : "FAILED") + "</span></li>" +
      '<li><span>Auth session</span><span class="badge ' + (EP.state.user ? "b-ok" : "b-bad") + '">' + (EP.state.user ? "Active · " + EP.esc(EP.state.user.email || "") : "None") + "</span></li>" +
      "</ul></section></div>";
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  EP.register("/admin/storage", async function (main) {
    if (!EP.hasRole(["SUPER_ADMIN", "PLATFORM_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading storage settings…");
    let driveStatus = { connected: false, error: null };
    // Only probe the Drive edge functions when the deployment flag says they are
    // live (set by scripts/deploy-edge-functions.ps1); otherwise report honestly
    // that they are not deployed instead of failing CORS preflights on every load.
    if (EP.state.edgeFunctionsAvailable === false) {
      driveStatus = { connected: false, available: false, error: "Edge functions not deployed — run scripts/deploy-edge-functions.ps1, then set system_config.edge_functions_available=true." };
    } else if (EP.state.edgeFunctionsAvailable === undefined) {
      try {
        const sb = EP.getClient();
        const { data: cfg } = sb
          ? await sb.from("system_config").select("value").eq("key", "edge_functions_available").maybeSingle()
          : { data: null };
        const v = cfg && cfg.value;
        EP.state.edgeFunctionsAvailable = !!v && (v === true || v.enabled === true || v === "true");
        if (!EP.state.edgeFunctionsAvailable) {
          driveStatus = { connected: false, available: false, error: "Edge functions not deployed — run scripts/deploy-edge-functions.ps1, then set system_config.edge_functions_available=true." };
        } else {
          const { data } = await sb.functions.invoke("drive-health");
          driveStatus = data || driveStatus;
        }
      } catch (e) {
        driveStatus.error = e.message || "Failed to load Drive status";
      }
    } else {
      try {
        const { data } = await sb().functions.invoke("drive-health");
        driveStatus = data || driveStatus;
      } catch (e) {
        driveStatus.error = e.message || "Failed to load Drive status";
      }
    }

    let health = {};
    try {
      const { data } = await sb().rpc("app_storage_health");
      health = data || {};
    } catch (e) { EP.toast("Storage health check failed: " + (e.message || "unknown"), "error"); }

    let alerts = [];
    try {
      const { data } = await sb().from("storage_alerts").select("*").order("created_at", { ascending: false }).limit(20);
      alerts = data || [];
    } catch (e) { EP.toast("Failed to load storage alerts: " + (e.message || "unknown"), "error"); }

    let recentObjects = [];
    try {
      const { data } = await sb().from("storage_objects").select("id, original_filename, mime_type, size_bytes, created_at, is_deleted").order("created_at", { ascending: false }).limit(20);
      recentObjects = data || [];
    } catch (e) { EP.toast("Failed to load storage objects: " + (e.message || "unknown"), "error"); }

    const objRows = recentObjects.map(function (o) {
      return '<tr><td>' + EP.esc((o.original_filename || "—").slice(0, 40)) + "</td><td>" + EP.esc(o.mime_type || "—") + "</td><td>" + EP.fmtMarks(o.size_bytes || 0) + "</td><td>" + (o.is_deleted ? '<span class="badge b-bad">deleted</span>' : '<span class="badge b-ok">active</span>') + "</td><td>" + EP.fmtDate(o.created_at) + "</td></tr>";
    }).join("") || '<tr><td colspan="5" class="muted">No files tracked yet.</td></tr>';

    const totalSize = recentObjects.reduce((s, o) => s + (o.size_bytes || 0), 0);

    const healthTiles = [
      { t: "Total files", v: health.total_files || 0 },
      { t: "Source PDFs", v: health.source_documents || 0 },
      { t: "Question images", v: health.question_images || 0 },
      { t: "Generated papers", v: health.generated_papers || 0 },
      { t: "Answer keys", v: health.answer_keys || 0 },
      { t: "Solutions", v: health.solutions || 0 },
      { t: "OMR", v: health.omr || 0 },
      { t: "Reports", v: health.reports || 0 },
      { t: "Duplicates", v: health.duplicates || 0, warn: (health.duplicates || 0) > 0 },
      { t: "Orphans", v: health.orphan_records || 0, warn: (health.orphan_records || 0) > 0 },
      { t: "Missing files", v: health.missing_files || 0, warn: (health.missing_files || 0) > 0 },
      { t: "Open alerts", v: health.open_alerts || 0, warn: (health.open_alerts || 0) > 0 },
    ];
    const healthCards = healthTiles.map(function (x) {
      return '<div class="stat-card"><div class="stat-v">' + EP.fmtMarks(x.v) + '</div><div class="stat-l">' + x.t + (x.warn ? ' <span class="badge b-warn">!</span>' : "") + "</div></div>";
    }).join("");

    const alertRows = alerts.map(function (a) {
      const sev = a.severity === "CRITICAL" ? "b-bad" : a.severity === "WARNING" ? "b-warn" : "b-ok";
      return '<tr><td>' + EP.fmtDate(a.created_at) + "</td><td><span class=\"badge " + sev + "\">" + EP.esc(a.severity) + "</span></td><td>" + EP.esc(a.alert_type) + "</td><td>" + EP.esc(a.message) + "</td><td>" + (a.resolved_at ? '<span class="badge b-ok">resolved</span>' : '<span class="badge b-warn">open</span>') + "</td></tr>";
    }).join("") || '<tr><td colspan="5" class="muted">No storage alerts.</td></tr>';

    // §10 connection-state system — derived only from the server payload.
    const policy = await EP.getStoragePolicy();
    const dState = driveStatus.available === false ? "NOT_DEPLOYED" : EP.driveStateFromHealth(driveStatus);
    const stateUi = {
      CONNECTED: { icon: "●", cls: "b-ok", label: "Connected" },
      NOT_CONNECTED: { icon: "○", cls: "b-warn", label: "Not connected" },
      REAUTHORIZATION: { icon: "⚠", cls: "b-warn", label: "Authorization expired" },
      ERROR: { icon: "⚠", cls: "b-bad", label: "Connection error" },
      NOT_DEPLOYED: { icon: "○", cls: "b-warn", label: "Edge functions not deployed" },
    }[dState] || { icon: "○", cls: "b-warn", label: "Not connected" };
    const driveBtns =
      dState === "CONNECTED"
        ? '<button class="btn btn-primary btn-sm" id="test_drive_btn">Test Connection</button> <button class="btn btn-sm" id="drive_disconnect_btn">Disconnect</button>'
        : dState === "REAUTHORIZATION"
          ? '<button class="btn btn-primary btn-sm" id="drive_connect_btn">Reconnect Google Drive</button> <button class="btn btn-sm" id="test_drive_btn">Test Connection</button>'
          : dState === "ERROR"
            ? '<button class="btn btn-sm" id="drive_retry_btn">Retry</button> <button class="btn btn-primary btn-sm" id="drive_connect_btn">Reconnect</button> <button class="btn btn-sm" id="test_drive_btn">Test Connection</button>'
            : '<button class="btn btn-primary btn-sm" id="drive_connect_btn">Connect Google Drive</button> <button class="btn btn-sm" id="test_drive_btn">Test Connection</button>';

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Storage Settings</h2><a class="btn btn-sm" href="#/admin">Back</a></div>' +
      '<section class="card"><h3>Google Drive</h3>' +
      '<ul class="simple-list">' +
        '<li><span>Storage provider</span><span class="badge b-ok">Google Drive</span></li>' +
        '<li><span>Connection</span><span class="badge ' + stateUi.cls + '">' + stateUi.icon + " " + stateUi.label + "</span></li>" +
        '<li><span>Account</span><span class="muted">' + EP.esc((driveStatus.connected && driveStatus.account) || "—") + "</span></li>" +
        '<li><span>Last verified</span><span class="muted">' + (driveStatus.connected && driveStatus.checkedAt ? EP.esc(String(driveStatus.checkedAt).replace("T", " ").slice(0, 19)) : "—") + "</span></li>" +
        '<li><span>Root folder</span><span class="muted">' + EP.esc(driveStatus.rootFolder?.name || "ExamPro") + "</span></li>" +
        '<li><span>Tracked files</span><span class="muted">' + EP.fmtMarks(driveStatus.stats?.activeFiles || 0) + " / " + EP.fmtMarks(driveStatus.stats?.totalFiles || 0) + "</span></li>" +
        '<li><span>Storage used</span><span class="muted">' + EP.fmtMarks(totalSize) + " bytes</span></li>" +
        '<li><span>Storage policy</span><span class="badge ' + (policy === "GOOGLE_DRIVE_REQUIRED" ? "b-ok" : "b-warn") + '">' + EP.esc(policy) + "</span></li>" +
        (driveStatus.lastError || driveStatus.error ? '<li><span>Error</span><span class="badge b-bad">' + EP.esc(driveStatus.lastError || driveStatus.error) + "</span></li>" : "") +
      "</ul>" +
      '<p class="hint">Storage policy: <b>GOOGLE_DRIVE_REQUIRED</b> blocks question-bank ingestion while Drive is disconnected (no fallback); <b>GOOGLE_DRIVE_PREFERRED</b> allows an honestly-labelled Supabase Storage fallback; <b>SUPABASE_ONLY</b> stores in Supabase Storage only.</p>' +
      '<div class="btn-row" style="margin-top:10px">' + driveBtns +
        '<button class="btn btn-sm" id="init_drive_btn">Initialize Folders</button>' +
        '<button class="btn btn-sm" id="audit_drive_btn">Run Audit</button>' +
      "</div>" +
      '<div class="field" style="margin-top:10px;max-width:340px"><label>Storage policy (platform admin)</label><select id="storage_policy_sel" class="input">' +
        ["GOOGLE_DRIVE_REQUIRED", "GOOGLE_DRIVE_PREFERRED", "SUPABASE_ONLY"].map((p) => '<option value="' + p + '"' + (p === policy ? " selected" : "") + ">" + p + "</option>").join("") +
      "</select></div>" +
      '<div id="drive_action_result" style="margin-top:10px"></div>' +
      "</section>" +
      '<section class="card"><h3>Storage Health</h3><div class="stat-grid">' + healthCards + "</div></section>" +
      '<section class="card"><h3>Storage Alerts</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Severity</th><th>Type</th><th>Message</th><th>Status</th></tr></thead><tbody>' + alertRows + "</tbody></table></div></section>" +
      '<section class="card"><h3>Recent files</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Status</th><th>Created</th></tr></thead><tbody>' + objRows + "</tbody></table></div></section>" +
      "</div>";

    const ar = EP.qs("#drive_action_result");
    function showResult(html) { if (ar) ar.innerHTML = html; }

    EP.qs("#drive_connect_btn")?.addEventListener("click", async function () {
      const label = this.textContent;
      this.disabled = true; this.textContent = "Redirecting…";
      const ok = await EP.connectGoogleDrive();
      // Reset unless we actually navigated away — never leave "Redirecting…".
      if (!ok) { this.disabled = false; this.textContent = label; }
    });
    EP.qs("#drive_disconnect_btn")?.addEventListener("click", async function () {
      this.disabled = true;
      const ok = await EP.disconnectGoogleDrive();
      if (ok) EP.render();
    });
    EP.qs("#drive_retry_btn")?.addEventListener("click", async function () {
      this.disabled = true;
      await EP.refreshGoogleDriveStatus();
      EP.render();
    });
    EP.qs("#storage_policy_sel")?.addEventListener("change", async function () {
      try {
        const set = await EP.setStoragePolicy(this.value);
        showResult('<span class="badge b-ok">Storage policy set to ' + EP.esc(set) + "</span>");
        EP.toast("Storage policy: " + set, "success");
      } catch (e) {
        showResult('<span class="badge b-bad">Failed</span> ' + EP.esc(e.message));
        EP.render();
      }
    });

    // §28 Test Connection — reports what the server actually verified; never
    // claims success without the real check.
    EP.qs("#test_drive_btn")?.addEventListener("click", async function () {
      showResult(EP.spinner("Testing…"));
      try {
        const { data } = await sb().functions.invoke("drive-health");
        const st = EP.driveStateFromHealth(data || {});
        showResult('<span class="badge ' + (st === "CONNECTED" ? "b-ok" : "b-bad") + '">' + st + "</span> " +
          (data?.connected ? "Drive API verified · account " + EP.esc(data.account || "—") : EP.esc(data?.lastError || "not connected")));
      } catch (e) {
        showResult('<span class="badge b-bad">Failed</span> ' + EP.esc(e.message));
      }
    });

    EP.qs("#init_drive_btn")?.addEventListener("click", async function () {
      showResult(EP.spinner("Initializing…"));
      try {
        const { data } = await sb().functions.invoke("drive-init");
        showResult('<span class="badge b-ok">Initialized</span> Created: ' + (data.created || []).length + ', Skipped: ' + (data.skipped || []).length);
      } catch (e) {
        showResult('<span class="badge b-bad">Failed</span> ' + EP.esc(e.message));
      }
    });

    EP.qs("#audit_drive_btn")?.addEventListener("click", async function () {
      showResult(EP.spinner("Auditing…"));
      try {
        const { data } = await sb().functions.invoke("drive-audit");
        showResult('<span class="badge b-ok">Audit complete</span> Orphans: ' + (data.orphanDb || 0) + ', Duplicates: ' + (data.duplicates || 0));
      } catch (e) {
        showResult('<span class="badge b-bad">Failed</span> ' + EP.esc(e.message));
      }
    });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  // ===========================================================================
  // STORAGE HELPERS (Supabase Storage default; Google Drive when connected)
  // ===========================================================================
  EP.uploadToStorage = async function (bucket, path, file) {
    const sb = EP.getClient();
    if (!sb) throw new Error('Supabase not configured');
    const drive = EP.getGoogleDriveStatus ? EP.getGoogleDriveStatus() : null;
    if (drive && drive.connected) return await EP.uploadToDrive(bucket, path, file);
    const fullPath = EP.storageTenantPrefix() + "/" + String(path).replace(/^\/+/, "");
    const { data, error } = await sb.storage.from(bucket).upload(fullPath, file, { upsert: true });
    if (error) throw new Error(error.message || 'Upload failed');
    return { object_key: data?.path || fullPath, provider: 'SUPABASE_STORAGE' };
  };
  EP.storagePublicUrl = async function (bucket, path) {
    const drive = EP.getGoogleDriveStatus ? EP.getGoogleDriveStatus() : null;
    if (drive && drive.connected) {
      const result = await EP.getMetadataFromDrive(bucket, path);
      return result ? result.webViewLink || "" : "";
    }
    const sb = EP.getClient();
    if (!sb) return "";
    const fullPath = EP.storageTenantPrefix() + "/" + String(path).replace(/^\/+/, "");
    return sb.storage.from(bucket).getPublicUrl(fullPath).data.publicUrl || "";
  };
  EP.storageSignedUrl = async function (bucket, path) {
    const drive = EP.getGoogleDriveStatus ? EP.getGoogleDriveStatus() : null;
    if (drive && drive.connected) {
      return await EP.getDownloadFromDrive(bucket, path).then(r => r.downloadUrl || "");
    }
    const sb = EP.getClient();
    if (!sb) return "";
    const fullPath = EP.storageTenantPrefix() + "/" + String(path).replace(/^\/+/, "");
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(fullPath, 3600);
    if (error || !data) return "";
    return data.signedUrl || "";
  };
  EP.recordObject = async function (bucket, path, file) {
    const sb = EP.getClient();
    if (!sb) return;
    const drive = EP.getGoogleDriveStatus ? EP.getGoogleDriveStatus() : null;
    if (drive && drive.connected) {
      await EP.trackUploadInDrive(bucket, path, { mimeType: file.type, size: file.size, tenantId: EP.state.tenantId });
      return;
    }
    try {
      await sb.from("storage_objects").insert({
        tenant_id: EP.state.tenantId || null,
        provider: "SUPABASE_STORAGE",
        bucket,
        object_key: path,
        original_filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: EP.state.user ? EP.state.user.id : null,
        is_deleted: false,
      });
    } catch (_) {}
  };

  // CSV export lives in app.js (EP.exportCsv) — supports both
  // EP.exportCsv("x.csv", rows) and EP.exportCsv("x.csv", headers, rows).

  // ===========================================================================
  // ADMIN — hub + generic CRUD engine for org/people/academic entities
  // ===========================================================================
  async function crudPage(main, cfg) {
    main.innerHTML = EP.spinner("Loading…");
    let q = sb().from(cfg.table).select("*");
    if (!cfg.all) q = q.eq(cfg.tenantCol, EP.state.tenantId);
    const { data: rows } = await q.order("created_at", { ascending: false }).limit(200);
    const fields = cfg.fields;
    let formHtml = '<div class="form-grid">' + fields.map(function (f) {
      if (f.type === "select") return '<div class="field"><label>' + f.label + '</label><select id="c_' + f.key + '" class="input"><option value="">—</option></select></div>';
      if (f.type === "textarea") return '<div class="field" style="grid-column:1/-1"><label>' + f.label + '</label><textarea id="c_' + f.key + '" class="input"></textarea></div>';
      return '<div class="field"><label>' + f.label + '</label><input id="c_' + f.key + '" class="input"></div>';
    }).join("") + '</div><button class="btn btn-primary btn-sm" id="c_save">Save</button>';
    let trows = (rows || []).map(function (r) {
      return '<tr>' + fields.map(function (f) { return '<td>' + EP.esc(r[f.key]) + '</td>'; }).join("") + '<td><button class="btn btn-sm" data-edit="' + r.id + '">Edit</button> <button class="btn btn-sm btn-danger" data-del="' + r.id + '">Delete</button></td></tr>';
    }).join("") || '<tr><td colspan="' + (fields.length + 2) + '" class="muted">No records.</td></tr>';
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>' + EP.esc(cfg.title) + '</h2><a class="btn" href="#/admin">Back</a></div>' +
      '<section class="card"><h3 id="form_title">Add ' + EP.esc(cfg.title) + '</h3>' + formHtml + '</section>' +
      '<section class="card"><div class="table-wrap"><table class="data-table"><thead><tr>' + fields.map(function (f) { return '<th>' + EP.esc(f.label) + '</th>'; }).join("") + '<th></th></tr></thead><tbody>' + trows + '</tbody></table></div></section></div>';
    // Wire ALL row/save handlers immediately after render, BEFORE the async
    // ref-select option loads — a slow ref fetch must never leave rendered
    // Edit/Delete/Save buttons dead on screen (spec §64).
    let editId = null;
    EP.qsa("[data-edit]").forEach(function (b) {
      b.addEventListener("click", async function () {
        editId = b.getAttribute("data-edit");
        const row = (rows || []).find(function (r) { return r.id === editId; });
        if (!row) return;
        fields.forEach(function (f) {
          const el = EP.qs("#c_" + f.key);
          if (!el) return;
          el.value = row[f.key] || "";
        });
        EP.qs("#form_title").textContent = "Edit " + EP.esc(cfg.title);
        EP.qs("#c_save").textContent = "Update";
        EP.qs("#c_save").classList.add("btn-primary");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
    const saveBtn = EP.qs("#c_save");
    if (saveBtn) saveBtn.addEventListener("click", async function () {
      const payload = {};
      fields.forEach(function (f) { payload[f.key] = EP.qs("#c_" + f.key).value || null; });
      if (cfg.statusDefault && !payload.status) payload.status = "ACTIVE";
      if (editId) {
        const { error } = await sb().from(cfg.table).update(payload).eq("id", editId);
        if (error) return EP.toast(error.message, "error");
        EP.toast("Updated", "success"); editId = null;
      } else {
        payload.tenant_id = EP.state.tenantId;
        const { error } = await sb().from(cfg.table).insert(payload);
        if (error) return EP.toast(error.message, "error");
        EP.toast("Added", "success");
      }
      EP.render();
    });
    EP.qsa("[data-del]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!confirm("Delete this record?")) return;
        const { error } = await sb().from(cfg.table).delete().eq("id", b.dataset.del);
        if (error) return EP.toast(error.message, "error");
        EP.toast("Deleted", "success"); EP.render();
      });
    });
    // Ref-table select options load asynchronously afterwards.
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.type === "select" && f.refTable) {
        const sel = EP.qs("#c_" + f.key);
        if (!sel || !document.contains(main)) return;
        const { data: opts } = await sb().from(f.refTable).select("*").limit(300);
        if (!document.contains(main)) return;
        (opts || []).forEach(function (o) { const op = document.createElement("option"); op.value = o.id; op.textContent = o[f.refLabel] || o.id; sel.appendChild(op); });
      }
    }
  }

  EP.register("/admin/institutions", function (main) { crudPage(main, { title: "Institutions", table: "institutions", tenantCol: "tenant_id", statusDefault: true,
      fields: [{ key: "name", label: "Name" }, { key: "address", label: "Address" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });
  EP.register("/admin/branches", function (main) { crudPage(main, { title: "Branches", table: "branches", tenantCol: "tenant_id", statusDefault: true,
      fields: [{ key: "institution_id", label: "Institution", type: "select", refTable: "institutions", refLabel: "name" }, { key: "name", label: "Name" }, { key: "city", label: "City" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });
  EP.register("/admin/batches", function (main) { crudPage(main, { title: "Batches", table: "batches", tenantCol: "tenant_id", statusDefault: true,
      fields: [{ key: "branch_id", label: "Branch", type: "select", refTable: "branches", refLabel: "name" }, { key: "exam_id", label: "Exam", type: "select", refTable: "exams", refLabel: "name" }, { key: "name", label: "Name" }, { key: "start_date", label: "Start date" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });
  EP.register("/admin/teachers", function (main) { crudPage(main, { title: "Teachers", table: "teachers", tenantCol: "tenant_id", statusDefault: true,
      fields: [{ key: "full_name", label: "Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "subject_ids", label: "Subject IDs (csv)" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });
  EP.register("/admin/students", function (main) { crudPage(main, { title: "Students", table: "students", tenantCol: "tenant_id", statusDefault: true,
      fields: [{ key: "full_name", label: "Name" }, { key: "roll_number", label: "Roll number" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "class_level", label: "Class" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });
  EP.register("/admin/subjects", function (main) {
    crudPage(main, { title: "Subjects", table: "subjects", tenantCol: "tenant_id", all: true,
      fields: [{ key: "exam_id", label: "Exam", type: "select", refTable: "exams", refLabel: "name" }, { key: "name", label: "Name" }, { key: "code", label: "Code" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });
  EP.register("/admin/chapters", function (main) {
    crudPage(main, { title: "Chapters", table: "chapters", tenantCol: "tenant_id", all: true,
      fields: [{ key: "subject_id", label: "Subject", type: "select", refTable: "subjects", refLabel: "name" }, { key: "name", label: "Name" }, { key: "code", label: "Code" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });
  EP.register("/admin/topics", function (main) {
    crudPage(main, { title: "Topics", table: "topics", tenantCol: "tenant_id", all: true,
      fields: [{ key: "chapter_id", label: "Chapter", type: "select", refTable: "chapters", refLabel: "name" }, { key: "name", label: "Name" }, { key: "code", label: "Code" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  EP.register("/admin/exams", function (main) {
    crudPage(main, { title: "Exam Catalog", table: "exams", tenantCol: "tenant_id", all: true,
      fields: [{ key: "name", label: "Name" }, { key: "code", label: "Code" }, { key: "exam_type", label: "Exam type" }, { key: "display_order", label: "Display order" }] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  // Syllabus versions (migration 0040) — official syllabus registry per exam/
  // authority/year (spec §39). Questions link to a version through the
  // "Syllabus mapping" card on the question detail page.
  EP.register("/admin/syllabus", async function (main) {
    if (!(await EP.hasTable("syllabus_versions"))) {
      main.innerHTML = '<div class="page"><div class="page-head"><h2>Syllabus Versions</h2><a class="btn btn-sm" href="#/admin">Back</a></div>' +
        '<div class="empty warn">The <code>syllabus_versions</code> table is not present in this database. Apply <code>migrations/0040_official_source_registry.sql</code> to enable syllabus versioning.</div></div>';
      return;
    }
    crudPage(main, { title: "Syllabus Versions", table: "syllabus_versions", tenantCol: "tenant_id", statusDefault: true,
      fields: [
        { key: "exam_id", label: "Exam", type: "select", refTable: "exams", refLabel: "name" },
        { key: "authority", label: "Authority (NTA / NMC / …)" },
        { key: "year", label: "Year" },
        { key: "version", label: "Version label" },
        { key: "effective_date", label: "Effective date (YYYY-MM-DD)" },
        { key: "source_url", label: "Official source URL" }
      ] });
  }, { roles: ["SUPER_ADMIN", "PLATFORM_ADMIN"] });

  // ===========================================================================
  // OMR MODULE (templates, sheet generation/print, response entry + evaluation)
  // ===========================================================================
  EP.register("/omr", async function (main) {
    main.innerHTML = EP.spinner("Loading OMR…");
    const [{ data: tpls }, { data: sheets }] = await Promise.all([
      sb().from("omr_templates").select("*").order("created_at", { ascending: false }),
      sb().from("omr_sheets").select("id, roll_number, status, created_at, omr_templates(name), papers(title)").order("created_at", { ascending: false }),
    ]);
    let trows = (tpls || []).map(function (t) {
      return '<tr><td>' + EP.esc(t.name) + '</td><td>' + (t.total_questions || 0) + '</td><td>' + (t.options_per_question || 4) + '</td></tr>';
    }).join("") || '<tr><td colspan="3" class="muted">No templates.</td></tr>';
    let srows = (sheets || []).map(function (x) {
      return '<tr><td><a href="#/omr/sheets/' + x.id + '">' + EP.esc(x.roll_number || "Sheet") + '</a></td><td>' + EP.esc((x.omr_templates && x.omr_templates.name) || "") + '</td><td>' + EP.esc((x.papers && x.papers.title) || "") + '</td><td>' + EP.esc(x.status) + '</td></tr>';
    }).join("") || '<tr><td colspan="4" class="muted">No sheets.</td></tr>';
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>OMR</h2><a class="btn btn-primary" href="#/omr/templates/new">New template</a> <a class="btn" href="#/omr/sheets/new">Generate sheet</a> <a class="btn" href="#/omr/scan">Batch scan upload</a></div>' +
      '<section class="card"><h3>Templates</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Questions</th><th>Options</th></tr></thead><tbody>' + trows + '</tbody></table></div></section>' +
      '<section class="card"><h3>Sheets</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Roll</th><th>Template</th><th>Paper</th><th>Status</th></tr></thead><tbody>' + srows + '</tbody></table></div></section></div>';
  });

  EP.register("/omr/templates/new", async function (main) {
    main.innerHTML = EP.spinner("Loading…");
    const { data: exams } = await sb().from("exams").select("id,name").eq("is_active", true).order("name");
    const examOpts = '<option value="">Select exam</option>' + (exams || []).map(function (e) { return '<option value="' + e.id + '">' + EP.esc(e.name) + '</option>'; }).join("");
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>New OMR Template</h2><a class="btn" href="#/omr">Back</a></div><section class="card"><div class="form-grid">' +
      '<div class="field"><label>Name</label><input id="t_name" class="input" placeholder="JEE Main 2024"></div>' +
      '<div class="field"><label>Exam</label><select id="t_exam" class="input">' + examOpts + '</select></div>' +
      '<div class="field"><label>Total questions</label><input id="t_q" class="input" type="number" value="90"></div>' +
      '<div class="field"><label>Options per question</label><select id="t_o" class="input"><option value="4">4 (A–D)</option><option value="5">5 (A–E)</option></select></div>' +
      '</div><button class="btn btn-primary" id="t_save">Save template</button></section></div>';
    EP.qs("#t_save").addEventListener("click", async function () {
      const payload = {
        tenant_id: EP.state.tenantId, name: EP.qs("#t_name").value,
        exam_id: EP.qs("#t_exam").value || null, total_questions: parseInt(EP.qs("#t_q").value, 10) || 0,
        options_per_question: parseInt(EP.qs("#t_o").value, 10) || 4, template_config: {}, created_by: EP.state.user.id,
      };
      if (!payload.name) return EP.toast("Name required", "error");
      const { error } = await sb().from("omr_templates").insert(payload);
      if (error) return EP.toast(error.message, "error");
      EP.toast("Template created", "success"); EP.navigate("/omr");
    });
  });

  EP.register("/omr/sheets/new", async function (main) {
    main.innerHTML = EP.spinner("Loading…");
    const [{ data: papers }, { data: tpls }] = await Promise.all([
      sb().from("papers").select("id,title").eq("tenant_id", EP.state.tenantId).order("created_at", { ascending: false }).limit(100),
      sb().from("omr_templates").select("id,name").order("name"),
    ]);
    const pOpts = '<option value="">Select paper</option>' + (papers || []).map(function (p) { return '<option value="' + p.id + '">' + EP.esc(p.title) + '</option>'; }).join("");
    const tOpts = '<option value="">Template (optional)</option>' + (tpls || []).map(function (t) { return '<option value="' + t.id + '">' + EP.esc(t.name) + '</option>'; }).join("");
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Generate OMR Sheet</h2><a class="btn" href="#/omr">Back</a></div><section class="card"><div class="form-grid">' +
      '<div class="field"><label>Paper</label><select id="s_paper" class="input">' + pOpts + '</select></div>' +
      '<div class="field"><label>Template</label><select id="s_tpl" class="input">' + tOpts + '</select></div>' +
      '<div class="field"><label>Roll number</label><input id="s_roll" class="input" placeholder="ABC001"></div>' +
      '</div><p class="hint" id="s_tpl_hint">Selecting a paper auto-selects the OMR template pinned to its exam pattern (exam_patterns.omr_template_id) when one is configured.</p>' +
      '<button class="btn btn-primary" id="s_gen">Generate &amp; view</button></section></div>';
    // §27: OMR template comes from the exam configuration — when the selected
    // paper's exam has an active pattern with omr_template_id set, auto-select
    // it (different exams never share a wrong layout).
    EP.qs("#s_paper").addEventListener("change", async function () {
      const paperId = EP.qs("#s_paper").value;
      const hint = EP.qs("#s_tpl_hint");
      if (!paperId) return;
      try {
        const { data: pp } = await sb().from("papers").select("exam_id").eq("id", paperId).maybeSingle();
        if (!pp || !pp.exam_id) { if (hint) hint.textContent = "Paper has no exam — choose a template manually."; return; }
        const { data: pat } = await sb().from("exam_patterns")
          .select("name, omr_templates(id, name)")
          .eq("exam_id", pp.exam_id).eq("is_active", true)
          .order("version", { ascending: false }).limit(1).maybeSingle();
        const tpl = pat && pat.omr_templates;
        if (tpl && tpl.id && EP.qs("#s_tpl")) {
          EP.qs("#s_tpl").value = tpl.id;
          if (hint) hint.innerHTML = "Template auto-selected from exam pattern: <b>" + EP.esc(tpl.name || pat.name) + "</b>";
        } else if (hint) {
          hint.textContent = "No OMR template pinned to this exam's active pattern — choose one manually or set exam_patterns.omr_template_id.";
        }
      } catch (_) { /* hint stays default */ }
    });
    EP.qs("#s_gen").addEventListener("click", async function () {
      const paperId = EP.qs("#s_paper").value;
      if (!paperId) return EP.toast("Select a paper", "error");
      const { data: sheet, error } = await sb().from("omr_sheets").insert({
        tenant_id: EP.state.tenantId, template_id: EP.qs("#s_tpl").value || null, paper_id: paperId,
        roll_number: EP.qs("#s_roll").value || ("ROLL-" + Date.now()), status: "PENDING", created_by: EP.state.user.id,
      }).select("id").single();
      if (error) return EP.toast(error.message, "error");
      EP.toast("Sheet generated", "success"); EP.navigate("/omr/sheets/" + sheet.id);
    });
  });

  // ---- Batch OMR scan upload: N scans → one sheet per scan, ready for
  // per-sheet auto-detect/manual evaluation (spec §85) ----
  EP.register("/omr/scan", async function (main) {
    main.innerHTML = EP.spinner("Loading…");
    const [{ data: papers }, { data: tpls }] = await Promise.all([
      sb().from("papers").select("id,title").eq("tenant_id", EP.state.tenantId).order("created_at", { ascending: false }).limit(100),
      sb().from("omr_templates").select("id,name,options_per_question").order("name"),
    ]);
    const pOpts = '<option value="">Select paper</option>' + (papers || []).map(function (p) { return '<option value="' + p.id + '">' + EP.esc(p.title) + "</option>"; }).join("");
    const tOpts = '<option value="">Template (optional)</option>' + (tpls || []).map(function (t) { return '<option value="' + t.id + '">' + EP.esc(t.name) + "</option>"; }).join("");
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Batch OMR Scan Upload</h2><a class="btn" href="#/omr">Back</a></div>' +
      '<section class="card"><p class="muted">Each scanned image becomes its own OMR sheet under the selected paper (roll numbers are generated from your prefix). After upload, open each sheet to auto-detect answers and evaluate — ambiguous marks always go to manual review.</p>' +
      '<div class="form-grid">' +
      '<div class="field"><label>Paper *</label><select id="bs_paper" class="input">' + pOpts + "</select></div>" +
      '<div class="field"><label>Template</label><select id="bs_tpl" class="input">' + tOpts + "</select></div>" +
      '<div class="field"><label>Roll prefix</label><input id="bs_prefix" class="input" value="BATCH-' + new Date().toISOString().slice(5, 10).replace("-", "") + '"></div>' +
      "</div>" +
      '<div class="field" style="margin-top:10px"><label>Scan images (JPG / PNG — one image per sheet page)</label><input id="bs_files" type="file" accept="image/*" multiple></div>' +
      '<button class="btn btn-primary" id="bs_go" style="margin-top:10px">Upload batch</button>' +
      '<div id="bs_progress" style="margin-top:12px"></div></section></div>';
    EP.qs("#bs_go").addEventListener("click", async function () {
      const paperId = EP.qs("#bs_paper").value;
      const files = EP.qs("#bs_files").files;
      if (!paperId) return EP.toast("Select a paper", "error");
      if (!files || !files.length) return EP.toast("Choose one or more scan images", "error");
      const prefix = (EP.qs("#bs_prefix").value || "BATCH").replace(/\s+/g, "-");
      const tplId = EP.qs("#bs_tpl").value || null;
      const btn = EP.qs("#bs_go"); btn.disabled = true;
      const prog = EP.qs("#bs_progress");
      const rows = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        rows.push('<div id="bs_row_' + i + '">' + EP.esc(f.name) + ' <span class="muted">— uploading…</span></div>');
        prog.innerHTML = rows.join("");
        try {
          const roll = prefix + "-" + String(i + 1).padStart(3, "0");
          const { data: sheet, error } = await sb().from("omr_sheets").insert({
            tenant_id: EP.state.tenantId, template_id: tplId, paper_id: paperId,
            roll_number: roll, status: "PENDING", created_by: EP.state.user.id,
          }).select("id").single();
          if (error) throw error;
          const path = EP.state.tenantId + "/" + Date.now() + "-batch-" + f.name.replace(/\s+/g, "_");
          await EP.uploadToStorage("omr-scans", path, f);
          await EP.recordObject("omr-scans", path, f);
          const { error: uErr } = await sb().from("omr_sheets").update({ image_object_key: path }).eq("id", sheet.id);
          if (uErr) throw uErr;
          rows[rows.length - 1] = '<div>' + EP.esc(f.name) + ' → <a href="#/omr/sheets/' + sheet.id + '">' + EP.esc(roll) + "</a> <span class=\"badge b-ok\">ready</span></div>";
        } catch (e) {
          rows[rows.length - 1] = '<div>' + EP.esc(f.name) + ' <span class="badge b-bad">failed: ' + EP.esc(e.message || "unknown") + "</span></div>";
        }
        prog.innerHTML = rows.join("");
      }
      btn.disabled = false;
      EP.toast("Batch upload finished — open each sheet to evaluate", "success");
    });
  }, { roles: ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "ACADEMIC_ADMIN", "TEACHER", "PAPER_SETTER", "SUPER_ADMIN"] });

  EP.register("/omr/sheets/:id", async function (main, path) {
    const id = path.split("/")[3];
    main.innerHTML = EP.spinner("Loading sheet…");
    const { data: sheet } = await sb().from("omr_sheets").select("*").eq("id", id).maybeSingle();
    if (!sheet) { main.innerHTML = '<div class="empty">Sheet not found.</div>'; return; }
    const { data: pq } = await sb().from("paper_questions").select("question_order, snapshot").eq("paper_id", sheet.paper_id).order("question_order");
    let branding = null;
    if (EP.state.tenantId) { const { data: t } = await sb().from("tenants").select("name,logo_url,address,header_text").eq("id", EP.state.tenantId).maybeSingle(); if (t) branding = t; }
    const brandHead =
      '<div class="print-head">' +
      (branding && branding.logo_url ? '<img class="logo-img" src="' + EP.esc(branding.logo_url) + '">' : '<div class="logo">E</div>') +
      '<div><div class="ph-name">' + EP.esc((branding && branding.name) || "ExamPro") + "</div>" +
      (branding && branding.header_text ? '<div class="ph-sub">' + EP.esc(branding.header_text) + "</div>" : '<div class="ph-sub">OMR Answer Sheet</div>') +
      "</div>" +
      '<div class="ph-meta">Roll: ' + EP.esc(sheet.roll_number) + ' · Questions: ' + (pq || []).length + "</div></div>";
    const tpl = sheet.template_id ? (await sb().from("omr_templates").select("options_per_question").eq("id", sheet.template_id).maybeSingle()).data : null;
    const opl = (tpl && tpl.options_per_question) || 4;
    const letters = "ABCDEFGH".slice(0, opl).split("");
    // Scannable grid — geometry shared with the detector (src/omr-detect.js)
    const layout = EP.omrLayout((pq || []).length, opl);
    const bubbles = EP.omrSheetHtml(layout, "Roll: " + sheet.roll_number + " · " + (pq || []).length + " questions · " + opl + " options");
    // Persist the geometry so any client can later verify/re-run detection
    const scanCfg = { v: 1, questions: (pq || []).length, options: opl, pages: layout.pages, cols: layout.cols, rowsPerCol: layout.rowsPerCol };
    if (JSON.stringify(sheet.scan_config || {}) !== JSON.stringify(scanCfg)) {
      sb().from("omr_sheets").update({ scan_config: scanCfg }).eq("id", id).then(function () {}, function () { /* column from migration 0043 */ });
    }
    const pageOpts = layout.pages > 1
      ? '<select id="omr_page" class="input input-sm">' + Array.from({ length: layout.pages }, function (_, i) { return '<option value="' + (i + 1) + '">Page ' + (i + 1) + "</option>"; }).join("") + "</select>"
      : "";
    const ev = (pq || []).map(function (row) {
      const qno = row.question_order;
      const sel = '<select id="omr_q_' + qno + '" class="input input-sm"><option value="">—</option>' + letters.map(function (L) { return '<option value="' + L + '">' + L + '</option>'; }).join("") + '</select>';
      return '<div class="ev-row" id="ev_row_' + qno + '">Q' + qno + ": " + sel + '</div>';
    }).join("");
    const scoreCard = (sheet.status === "EVALUATED" && sheet.marks != null)
      ? '<section class="card no-print"><h3>Score</h3><div class="score-card"><div class="big-score">' + Number(sheet.marks).toFixed(2) + '<small>/ ' + Number(sheet.total_marks || 0).toFixed(0) + '</small></div>' +
        '<div class="score-stats"><div>Correct: <b>' + (sheet.correct_count || 0) + "</b></div><div>Incorrect: <b>" + (sheet.incorrect_count || 0) + "</b></div><div>Unanswered: <b>" + (sheet.unanswered_count || 0) + "</b></div><div>Evaluated: <b>" + EP.fmtDate(sheet.evaluated_at) + "</b></div></div></div></section>"
      : "";
    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>OMR Sheet — ' + EP.esc(sheet.roll_number) + '</h2><button class="btn no-print" id="print_sheet">Print sheet</button> <a class="btn no-print" href="#/omr">Back</a></div>' +
      '<section class="card no-print"><h3>Scanned sheet</h3>' +
        '<div class="btn-row">' +
          '<input id="scan_file" type="file" accept="image/*">' +
          '<button class="btn btn-sm btn-primary" id="scan_upload">Upload scan</button>' +
          '<button class="btn btn-sm" id="scan_detect" ' + (sheet.image_object_key ? "" : "disabled") + '>Auto-detect answers</button>' +
          pageOpts +
        '</div>' +
        '<div id="scan_detect_status" class="muted small" style="margin-top:6px"></div>' +
        '<div id="scan_preview">' + (sheet.image_object_key ? '<img src="" id="scan_img" style="max-width:480px;border:1px solid var(--border)">' : '<span class="muted">No scan uploaded yet — print the sheet below, have it filled and scanned, then upload the image.</span>') + '</div>' +
      '</section>' +
      scoreCard +
      '<div class="card print-area"><h3>Bubble Sheet</h3>' + brandHead + bubbles + '</div>' +
      '<section class="card no-print"><h3>Evaluate</h3><p class="muted small">Auto-detect fills these dropdowns (low-confidence questions are left blank for review). Adjust anything, then evaluate — scoring always runs server-side.</p><div class="ev-grid">' + ev + '</div><button class="btn btn-primary" id="eval_btn">Evaluate</button><div id="eval_result"></div></section></div>';

    if (sheet.image_object_key) {
      EP.storageSignedUrl("omr-scans", sheet.image_object_key).then(function (url) {
        if (url) EP.qs("#scan_img").src = url;
      });
    }
    const su = EP.qs("#scan_upload");
    if (su) su.addEventListener("click", async function () {
      const file = EP.qs("#scan_file").files[0];
      if (!file) return EP.toast("Choose an image", "error");
      const path = EP.state.tenantId + "/" + Date.now() + "-scan-" + file.name.replace(/\s+/g, "_");
      try {
        await EP.uploadToStorage("omr-scans", path, file);
        await EP.recordObject("omr-scans", path, file);
        const { error } = await sb().from("omr_sheets").update({ image_object_key: path }).eq("id", id);
        if (error) throw error;
        EP.qs("#scan_preview").innerHTML = '<img src="" id="scan_img" style="max-width:480px;border:1px solid var(--border)">';
        const url = await EP.storageSignedUrl("omr-scans", path);
        if (url) EP.qs("#scan_img").src = url;
        const det = EP.qs("#scan_detect"); if (det) det.disabled = false;
        EP.toast("Scan uploaded", "success");
      } catch (e) { EP.toast(e.message || "Upload failed", "error"); }
    });

    // Auto-detect answers from the uploaded scan (confidence-gated; anything
    // ambiguous stays blank for manual review — never guessed).
    const detBtn = EP.qs("#scan_detect");
    if (detBtn) detBtn.addEventListener("click", async function () {
      const st = EP.qs("#scan_detect_status");
      if (!sheet.image_object_key && !EP.qs("#scan_img")) return EP.toast("Upload a scan first", "error");
      detBtn.disabled = true;
      st.textContent = "Detecting registration marks and bubbles…";
      try {
        const url = await EP.storageSignedUrl("omr-scans", sheet.image_object_key);
        if (!url) throw new Error("Scan image is no longer available — re-upload it.");
        const pageSel = EP.qs("#omr_page");
        const res = await EP.omrDetect(url, {
          questions: (pq || []).length,
          options: opl,
          page: pageSel ? parseInt(pageSel.value, 10) : 1,
        });
        if (!res || res.ok === false) throw new Error((res && res.error) || "Detection failed");
        let filled = 0;
        Object.keys(res.answers || {}).forEach(function (q) {
          const sel = EP.qs("#omr_q_" + q);
          if (sel) { sel.value = res.answers[q]; filled++; }
        });
        (res.flagged || []).forEach(function (q) {
          const row = EP.qs("#ev_row_" + q);
          if (row) row.style.outline = "1px dashed var(--warn, #c90)";
        });
        st.innerHTML = '<span class="badge ' + (res.flagged && res.flagged.length ? "b-warn" : "b-ok") + '">Detected</span> ' +
          filled + " answer(s) filled · " + (res.blank || []).length + " blank · " +
          '<b>' + (res.flagged || []).length + " need manual review</b> (highlighted below)" +
          ' · confidence ' + Math.round((res.confidence || 0) * 100) + "%";
        EP.toast("Auto-detect complete — review flagged questions, then Evaluate", "success");
      } catch (e) {
        st.textContent = "Auto-detect failed: " + (e.message || "unknown") + " — enter the answers manually below.";
        EP.toast("Auto-detect failed — manual entry still works", "error");
      }
      detBtn.disabled = false;
    });
    EP.qs("#print_sheet").addEventListener("click", function () { window.print(); });
    EP.qs("#eval_btn").addEventListener("click", async function () {
      const entries = {};
      (pq || []).forEach(function (row) { const v = EP.qs("#omr_q_" + row.question_order).value; entries[row.question_order] = v ? [v] : []; });
      const res = await evaluateOmr(id, sheet.paper_id, entries);
      if (!res) return;
      EP.qs("#eval_result").innerHTML = '<div class="score-card"><div class="big-score">' + Number(res.marks || 0).toFixed(2) + '</div><p>Correct: ' + res.correct + ' | Incorrect: ' + res.incorrect + ' | Unanswered: ' + res.unanswered + ' | Total: ' + (res.total_marks != null ? res.total_marks : res.total) + '</p></div>';
      EP.toast("Evaluated", "success");
      EP.navigate("/omr/sheets/" + id);
    });
  });

  // Records responses and evaluates the sheet SERVER-SIDE (app_evaluate_omr_sheet)
  // using the paper's immutable snapshots — the same engine logic as online exams.
  async function evaluateOmr(sheetId, paperId, entries) {
    const inserts = Object.keys(entries || {}).map(function (qno) {
      return { tenant_id: EP.state.tenantId, omr_sheet_id: sheetId, question_no: parseInt(qno, 10), selected_options: entries[qno] || [], evaluated: false };
    });
    if (inserts.length) {
      await sb().from("omr_responses").delete().eq("omr_sheet_id", sheetId);
      const { error } = await sb().from("omr_responses").insert(inserts);
      if (error) { EP.toast(error.message, "error"); return null; }
    }
    const { data, error } = await sb().rpc("app_evaluate_omr_sheet", { p_sheet_id: sheetId });
    if (error) { EP.toast(error.message, "error"); return null; }
    if (data && data.error) { EP.toast(data.error, "error"); return null; }
    return data || {};
  }

  // ===========================================================================
  // INSTITUTION DASHBOARD (roster + performance overview)
  // ===========================================================================
  EP.register("/institution", async function (main) {
    if (!EP.hasRole(["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "ACADEMIC_ADMIN", "SUPER_ADMIN"])) { main.innerHTML = '<div class="empty">Not authorized.</div>'; return; }
    main.innerHTML = EP.spinner("Loading institution data…");
    const [insts, brs, bats, teachs, studs, sbats, sessRes] = await Promise.all([
      sb().from("institutions").select("*", { count: "exact", head: true }).eq("tenant_id", EP.state.tenantId),
      sb().from("branches").select("*", { count: "exact", head: true }).eq("tenant_id", EP.state.tenantId),
      sb().from("batches").select("id,name,academic_year", { count: "exact", head: true }).eq("tenant_id", EP.state.tenantId),
      sb().from("teachers").select("*", { count: "exact", head: true }).eq("tenant_id", EP.state.tenantId).eq("is_deleted", false),
      sb().from("students").select("*", { count: "exact", head: true }).eq("tenant_id", EP.state.tenantId).eq("is_deleted", false),
      sb().from("student_batches").select("*", { count: "exact", head: true }),
      sb().from("results").select("id, percentage, marks_obtained, total_marks, exam_sessions(student_id, papers(title))").order("created_at", { ascending: false }).limit(10),
    ]);
    const stat = function (label, n) { return '<div class="stat-card"><div class="stat-v">' + (n || 0) + '</div><div class="stat-l">' + label + "</div></div>"; };
    const sess = sessRes.data || [];
    const recent = sess.length ? sess.map(function (r) {
      const s = r.exam_sessions || {};
      return "<tr><td>" + EP.esc((s.papers && s.papers.title) || "—") + "</td><td>" + EP.esc(s.student_id ? s.student_id.slice(0, 8) : "—") + "</td><td>" + (r.marks_obtained != null ? EP.fmtMarks(r.marks_obtained) + " / " + EP.fmtMarks(r.total_marks) : "—") + "</td><td>" + (r.percentage != null ? Math.round(r.percentage) + "%" : "—") + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="muted">No results yet.</td></tr>';

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Institution Dashboard</h2><div class="btn-row"><a class="btn btn-sm" href="#/admin/institutions">Institutions</a><a class="btn btn-sm" href="#/admin/students">Students</a><a class="btn btn-sm" href="#/admin/teachers">Teachers</a></div></div>' +
      '<div class="stat-grid">' +
        stat("Institutions", (insts.count || 0)) + stat("Branches", (brs.count || 0)) + stat("Batches", (bats.count || 0)) +
        stat("Teachers", (teachs.count || 0)) + stat("Students", (studs.count || 0)) + stat("Batch memberships", (sbats.count || 0)) +
      "</div>" +
      '<section class="card"><h3>Recent results</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Paper</th><th>Student</th><th>Marks</th><th>%</th></tr></thead><tbody>' + recent + "</tbody></table></div></section>" +
      '<section class="card"><h3>Parent links</h3><p class="muted">Link a parent account (by email) to a student so the parent dashboard can show the ward\'s results, weak topics and assignments.</p>' +
      '<div class="btn-row" style="margin-bottom:10px"><button class="btn btn-sm btn-primary" id="pl_new">+ Link parent</button></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Parent</th><th>Email</th><th>Relation</th><th>Student</th><th>Account linked</th><th></th></tr></thead><tbody id="pl_rows"><tr><td colspan="6" class="muted">Loading…</td></tr></tbody></table></div></section></div>';

    // ---- Parent links (parents table) ----
    async function loadParents() {
      const rowsEl = EP.qs("#pl_rows");
      const [{ data: prs }, { data: studs2 }] = await Promise.all([
        sb().from("parents").select("id, name, email, relation, auth_user_id, students(full_name, roll_number)").eq("tenant_id", EP.state.tenantId).order("created_at", { ascending: false }).limit(100),
        sb().from("students").select("id, full_name, roll_number").eq("tenant_id", EP.state.tenantId).eq("is_deleted", false).order("full_name").limit(500),
      ]);
      rowsEl._students = studs2 || [];
      rowsEl.innerHTML = (prs || []).length
        ? prs.map(function (p) {
            return "<tr><td>" + EP.esc(p.name || "—") + "</td><td>" + EP.esc(p.email || "—") + "</td><td>" + EP.esc(p.relation || "PARENT") + "</td>" +
              "<td>" + EP.esc((p.students && p.students.full_name) || "—") + (p.students && p.students.roll_number ? " (" + EP.esc(p.students.roll_number) + ")" : "") + "</td>" +
              '<td>' + (p.auth_user_id ? '<span class="badge b-ok">Yes</span>' : '<span class="badge b-warn">No account</span>') + "</td>" +
              '<td><button class="btn btn-sm btn-ghost" data-unlink="' + p.id + '">Remove</button></td></tr>';
          }).join("")
        : '<tr><td colspan="6" class="muted">No parent links yet.</td></tr>';
      rowsEl.querySelectorAll("[data-unlink]").forEach(function (b) {
        b.addEventListener("click", async function () {
          if (!window.confirm("Remove this parent link?")) return;
          const { error } = await sb().from("parents").delete().eq("id", b.getAttribute("data-unlink"));
          if (error) return EP.toast(error.message, "error");
          EP.toast("Link removed", "success"); loadParents();
        });
      });
    }
    loadParents();
    const plNew = EP.qs("#pl_new");
    if (plNew) plNew.addEventListener("click", function () {
      const studs2 = (EP.qs("#pl_rows")._students) || [];
      const stOpts = studs2.map(function (st) { return '<option value="' + st.id + '">' + EP.esc(st.full_name + (st.roll_number ? " (" + st.roll_number + ")" : "")) + "</option>"; }).join("");
      if (!stOpts) return EP.toast("Add students first (Admin → Students)", "error");
      EP.modal("Link parent to student",
        '<div class="form-grid">' +
        '<div class="field"><label>Student *</label><select id="pl_student" class="input">' + stOpts + "</select></div>" +
        '<div class="field"><label>Parent name *</label><input id="pl_name" class="input"></div>' +
        '<div class="field"><label>Parent email (account email) *</label><input id="pl_email" class="input" type="email"></div>' +
        '<div class="field"><label>Relation</label><select id="pl_rel" class="input"><option>PARENT</option><option>GUARDIAN</option><option>OTHER</option></select></div>' +
        "</div>",
        '<button class="btn btn-primary" id="pl_save">Create link</button>');
      EP.qs("#pl_save").addEventListener("click", async function () {
        const email = EP.qs("#pl_email").value.trim();
        const name = EP.qs("#pl_name").value.trim();
        const studentId = EP.qs("#pl_student").value;
        if (!email || !name || !studentId) return EP.toast("Student, name and email are required", "error");
        EP.qs("#pl_save").disabled = true;
        const { data: prof } = await sb().from("profiles").select("auth_user_id").ilike("email", email).limit(1);
        const authId = prof && prof.length ? prof[0].auth_user_id : null;
        const { error } = await sb().from("parents").insert({
          tenant_id: EP.state.tenantId, student_id: studentId, name: name, email: email,
          relation: EP.qs("#pl_rel").value, auth_user_id: authId, created_by: EP.state.user.id,
        });
        EP.qs("#pl_save").disabled = false;
        if (error) return EP.toast(error.message, "error");
        EP.closeModal();
        EP.toast(authId ? "Parent linked — the parent dashboard is now active for " + email
          : "Link saved, but no account exists yet for " + email + ". It activates when that email signs up.", "success");
        loadParents();
      });
    });
  }, { roles: ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "ACADEMIC_ADMIN", "SUPER_ADMIN"] });

  // ===========================================================================
  // AI TUTOR (OpenRouter free models)
  // ===========================================================================
  EP.register("/ai-tutor", async function (main) {
    main.innerHTML = EP.spinner("Loading…");
    const apiKey = EP.ai.getApiKey();
    const selId = EP.ai.freeModels.length ? EP.ai.freeModels[0].id : "";
    let modelId = apiKey ? (localStorage.getItem("exampro_ai_model") || selId) : selId;
    const msgs = [];
    // Deep link ?q=<question_id> loads the verified question as context so the
    // tutor can explain the exact question without fabricating anything.
    let contextBlock = "";
    try {
      const params = new URLSearchParams(window.location.search || "");
      const qid = params.get("q");
      if (qid) {
        const { data: q } = await sb().from("questions").select("question_text, difficulty, subjects(name), chapters(name), topics(name), question_answers(correct_option_keys, numerical_answer), solutions(solution_text, detailed_solution, concept)").eq("id", qid).maybeSingle();
        if (q) {
          const { data: opts } = await sb().from("question_options").select("option_key, option_text").eq("question_id", qid).order("display_order");
          const optTxt = (opts || []).map(function (o) { return o.option_key + ". " + o.option_text; }).join("\n");
          const ans = q.question_answers || {};
          const sol = q.solutions || {};
          contextBlock =
            "\n\n[EXAMPRO CONTEXT — question " + qid + "]\n" +
            "Question: " + (q.question_text || "").replace(/<[^>]+>/g, "") + "\n" +
            (optTxt ? "Options:\n" + optTxt + "\n" : "") +
            "Subject: " + ((q.subjects && q.subjects.name) || "—") + " · Chapter: " + ((q.chapters && q.chapters.name) || "—") + " · Topic: " + ((q.topics && q.topics.name) || "—") + " · Difficulty: " + (q.difficulty || "—") + "\n" +
            "Stored correct answer: " + ((ans.correct_option_keys || []).join(", ") || ans.numerical_answer || "not stored") + "\n" +
            "Stored solution: " + ((sol.solution_text || sol.detailed_solution || sol.concept || "") || "none").replace(/<[^>]+>/g, "") + "\n" +
            "[/EXAMPRO CONTEXT]\n";
          msgs.push({ role: "user", text: "Please explain the exam question provided in the context block above, step by step." });
        }
      }
    } catch (_) { /* context is optional */ }
    const systemPrompt =
      "You are ExamPro's AI tutor for Indian competitive exams (JEE Main/Advanced, NEET, CUET, CETs). " +
      "Rules: (1) Never claim a question, answer key or solution is 'official' or 'verified' unless it is provided in the [EXAMPRO CONTEXT] block and marked there as stored. " +
      "(2) Always label your explanation as AI-generated guidance, not an official source. " +
      "(3) If a context block is present, explain that exact question using the stored answer and solution as ground truth; if absent, do not invent specific PYQ questions or official answer keys. " +
      "(4) Preserve mathematical notation and scientific units. " +
      "(5) If you do not know, say so clearly.";

    function renderMsg(m, role) {
      return '<div class="chat-msg chat-' + role + '"><b>' + (role === "user" ? "You" : "AI") + ":</b> " + EP.esc(m) + "</div>";
    }

    function render() {
      main.innerHTML =
        '<div class="page"><div class="page-head"><h2>AI Tutor</h2>' +
        (contextBlock ? '<span class="badge b-ok">Question context attached — answer grounded in stored data</span>' : "") +
        "</div>" +
        '<section class="card"><div class="form-grid">' +
          '<div class="field" style="grid-column:1/-1"><label>OpenRouter API key</label><input id="ai_key" class="input" type="password" value="' + EP.esc(apiKey) + '" placeholder="sk-or-v1-..."></div>' +
          '<div class="field" style="grid-column:1/-1"><label>Model</label><select id="ai_model" class="input">' +
            EP.ai.freeModels.map(function (m) { return '<option value="' + EP.esc(m.id) + '" ' + (modelId === m.id ? "selected" : "") + ">" + EP.esc(m.name) + "</option>"; }).join("") +
          '</select></div>' +
        '</div><button class="btn btn-sm" id="ai_save_key">Save settings</button></section>' +
        '<section class="card chat-area"><div id="chat_history">' + (msgs.length ? msgs.map(function (x) { return renderMsg(x.text, x.role); }).join("") : '<div class="muted">Ask anything about JEE / NEET / exam prep. Your API key stays in this browser only. AI answers are labelled AI-generated and never claim to be official sources.</div>') + '</div></section>' +
        '<div class="chat-input-row"><input id="ai_input" class="input" placeholder="Type your question…"><button class="btn btn-primary" id="ai_send">Send</button></div>' +
        "</div>";
      EP.qs("#chat_history").scrollTop = EP.qs("#chat_history").scrollHeight;
    }

    render();

    EP.qs("#ai_save_key").addEventListener("click", function () {
      EP.ai.setApiKey(EP.qs("#ai_key").value.trim());
      modelId = EP.qs("#ai_model").value;
      localStorage.setItem("exampro_ai_model", modelId);
      EP.toast("Saved", "success");
    });
    EP.qs("#ai_model").addEventListener("change", function () {
      modelId = EP.qs("#ai_model").value;
      localStorage.setItem("exampro_ai_model", modelId);
    });

    async function send() {
      const input = EP.qs("#ai_input");
      const text = input.value.trim();
      if (!text) return;
      msgs.push({ role: "user", text: text });
      input.value = "";
      render();
      EP.qs("#ai_send").disabled = true;
      const apiMsgs = [{ role: "system", content: systemPrompt }].concat(msgs.map(function (m) {
        return { role: m.role, content: m.text + (contextBlock && m.role === "user" && msgs.indexOf(m) === 0 ? contextBlock : "") };
      }));
      try {
        const reply = await EP.ai.chat(apiMsgs, modelId);
        msgs.push({ role: "assistant", text: reply + "\n\n— AI-generated guidance (not an official ExamPro source)." });
      } catch (e) {
        msgs.push({ role: "assistant", text: "Error: " + e.message });
      }
      EP.qs("#ai_send").disabled = false;
      render();
    }
    EP.qs("#ai_send").addEventListener("click", send);
    EP.qs("#ai_input").addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
  });

  // ===========================================================================
  // WEAK TOPICS (based on incorrect practice logs + results)
  // ===========================================================================
  EP.register("/weak-topics", async function (main) {
    main.innerHTML = EP.spinner("Loading weak topics…");
    const { data } = await sb().from("practice_logs").select("correct, questions(topics(id,name,chapters(name,subjects(name))), subjects(name), chapters(name,subjects(name)))").eq("user_id", EP.state.user.id).eq("correct", false).order("created_at", { ascending: false }).limit(200);
    const topicCounts = {};
    const chapterCounts = {};
    (data || []).forEach(function (r) {
      const q = r.questions || {};
      const t = q.topics || {};
      if (t.id) { topicCounts[t.id] = { name: t.name, count: (topicCounts[t.id] ? topicCounts[t.id].count : 0) + 1, chapter: (t.chapters && t.chapters.name) || "", subject: (t.chapters && t.chapters.subjects && t.chapters.subjects.name) || "" }; }
      else { const ch = q.chapters || {}; if (ch.id) { chapterCounts[ch.id] = { name: ch.name, count: (chapterCounts[ch.id] ? chapterCounts[ch.id].count : 0) + 1, subject: (ch.subjects && ch.subjects.name) || "" }; } }
    });
    const topicRows = Object.values(topicCounts).sort(function (a, b) { return b.count - a.count; }).slice(0, 20).map(function (t, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + EP.esc(t.name) + '</td><td>' + EP.esc(t.chapter) + '</td><td>' + EP.esc(t.subject) + '</td><td><span class="badge b-bad">' + t.count + " mistakes</span></td></tr>";
    }).join("");
    const chapterRows = Object.values(chapterCounts).sort(function (a, b) { return b.count - a.count; }).slice(0, 20).map(function (c, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + EP.esc(c.name) + '</td><td>' + EP.esc(c.subject) + '</td><td><span class="badge b-warn">' + c.count + " mistakes</span></td></tr>";
    }).join("");
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Weak Topics</h2><span class="muted">Based on your practice history</span></div>' +
      '<div class="grid-2">' +
        '<section class="card"><h3>Topics to improve</h3>' + (topicRows ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Topic</th><th>Chapter</th><th>Subject</th><th>Mistakes</th></tr></thead><tbody>' + topicRows + "</tbody></table></div>" : '<div class="muted">No topic-level data yet.</div>') + "</section>" +
        '<section class="card"><h3>Chapters to improve</h3>' + (chapterRows ? '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Chapter</th><th>Subject</th><th>Mistakes</th></tr></thead><tbody>' + chapterRows + "</tbody></table></div>" : '<div class="muted">No chapter-level data yet.</div>') + "</section>" +
      "</div></div>";
  });

  // ===========================================================================
  // REVISION (bookmarked questions for quick revision)
  // ===========================================================================
  EP.register("/revision", async function (main) {
    main.innerHTML = EP.spinner("Loading revision set…");
    const { data } = await sb().from("bookmarks").select("id, created_at, questions(id, question_text, difficulty, year, question_types(name), subjects(name), chapters(name))").eq("user_id", EP.state.user.id).order("created_at", { ascending: false }).limit(50);
    const qids = (data || []).map(function (b) { return b.questions && b.questions.id; }).filter(Boolean);
    const oRes = qids.length ? await sb().from("question_options").select("question_id,option_key,option_text").in("question_id", qids).order("display_order") : { data: [] };
    const optsByQ = {}; (oRes.data || []).forEach(function (o) { (optsByQ[o.question_id] = optsByQ[o.question_id] || []).push(o); });
    const items = (data || []).map(function (b, i) {
      const q = b.questions || {};
      const opts = (optsByQ[q.id] || []).map(function (o) { return '<li><b>' + EP.esc(o.option_key) + '.</b> ' + EP.esc(o.option_text) + '</li>'; }).join("");
      return '<div class="pq"><div class="pq-h">Q' + (i + 1) + ' · ' + EP.esc((q.subjects && q.subjects.name) || "—") + ' · ' + EP.esc(q.difficulty || "—") + (q.year ? ' · PYQ ' + q.year : '') + '</div>' +
        '<div class="pq-q">' + EP.safeHtml(q.question_text || "") + "</div>" + (opts ? '<ol class="opts">' + opts + "</ol>" : "") + "</div>";
    }).join("");
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Revision</h2><span class="muted">' + ((data || []).length) + ' bookmarked questions</span></div>' +
      (items ? '<div class="q-list">' + items + "</div>" : '<div class="empty">Bookmark questions to build your revision set.</div>') + "</div>";
  });

  // ===========================================================================
  // EXAM TRACKER (upcoming / ongoing exams)
  // ===========================================================================
  EP.register("/exam-tracker", async function (main) {
    main.innerHTML = EP.spinner("Loading exam tracker…");
    const now = new Date().toISOString();
    const { data } = await sb().from("exam_sessions").select("id, status, started_at, ends_at, papers(title, total_questions, duration_minutes)").eq("student_id", EP.state.user.id).order("started_at", { ascending: false }).limit(20);
    const rows = (data || []).map(function (s) {
      const p = s.papers || {};
      const end = new Date(s.ends_at);
      const left = end.getTime() - Date.now();
      const remaining = s.status === "IN_PROGRESS" ? (left > 0 ? Math.floor(left / 60000) + " min left" : "Expired") : "—";
      return '<tr><td>' + EP.esc(p.title || "—") + '</td><td>' + EP.esc(s.status) + '</td><td>' + (p.total_questions || 0) + '</td><td>' + remaining + '</td><td>' + (s.status === "IN_PROGRESS" ? '<a class="btn btn-primary btn-sm" href="#/exam/' + s.id + '">Resume</a>' : "") + "</td></tr>";
    }).join("");
    main.innerHTML = '<div class="page"><div class="page-head"><h2>Exam Tracker</h2></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Exam</th><th>Status</th><th>Questions</th><th>Remaining</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="muted">No exams yet.</td></tr>') + "</tbody></table></div></div>";
  });

  // ===========================================================================
  // AUTH CALLBACK (OAuth redirect handler)
  // ===========================================================================
  EP.register("/auth/callback", async function (main) {
    main.innerHTML = EP.spinner("Completing sign-in…");
    await new Promise(function (r) { setTimeout(r, 600); });
    const session = await EP.auth.getSession();
    if (session && session.user) {
      await EP.loadIdentity(session.user);
      const prof = EP.state.profile;
      if (prof && !prof.email_verified_at) {
        EP.navigate("/verify-email");
      } else {
        EP.navigate(EP.roleDashboard());
      }
    } else {
      EP.navigate("/auth");
    }
  });

  // ===========================================================================
  // FORMULA LIBRARY (reference for practice / DPP / AI tutor; spec §52)
  // ===========================================================================
  const FORMULA_SUBJECTS = [
    { code: "PHY", label: "Physics" }, { code: "CHE", label: "Chemistry" },
    { code: "MAT", label: "Mathematics" }, { code: "BOT", label: "Botany" },
    { code: "ZOO", label: "Zoology" },
  ];
  let formulaFilters = { subject: "", q: "", status: "" };

  EP.register("/formulas", async function (main) {
    main.innerHTML = EP.spinner("Loading formula library…");
    parseFormulaQuery();
    const isEditor = EP.can("questions.create");
    const canVerify = EP.can("questions.review");
    // Feature-gate on the table from migration 0043: if it hasn't been applied
    // yet, show a clear state instead of firing failing queries per load.
    const hasFormulaTable = await EP.hasTable("formula_library");
    if (!hasFormulaTable) {
      main.innerHTML = '<div class="page"><div class="page-head"><h2>Formula Library</h2></div>' +
        '<section class="card"><div class="empty">Formula library is not initialized on this database yet — apply migration <code>0043_features_and_hardening.sql</code>.</div></section></div>';
      return;
    }

    const subjOpts = '<option value="">All subjects</option>' + FORMULA_SUBJECTS.map(function (s) {
      return '<option value="' + s.code + '">' + s.label + "</option>";
    }).join("");
    const statusOpts = isEditor
      ? '<select id="fl_status" class="input"><option value="">Any status</option><option>VERIFIED</option><option>PENDING_REVIEW</option></select>'
      : "";

    main.innerHTML =
      '<div class="page"><div class="page-head"><h2>Formula Library</h2>' +
      '<div class="btn-row">' +
      (isEditor ? '<button class="btn btn-primary" id="fl_new">+ New formula</button>' : "") +
      '<button class="btn btn-ghost btn-sm" id="fl_export">Export CSV</button>' +
      "</div></div>" +
      '<div class="toolbar card">' +
      '<input id="fl_q" class="input" placeholder="Search title, formula, chapter, topic…" value="' + EP.esc(formulaFilters.q) + '">' +
      '<select id="fl_subj" class="input">' + subjOpts + "</select>" +
      statusOpts +
      "</div>" +
      '<div id="fl_list">' + EP.spinner() + "</div></div>";

    EP.qs("#fl_subj").value = formulaFilters.subject;
    if (EP.qs("#fl_status")) EP.qs("#fl_status").value = formulaFilters.status;
    EP.qs("#fl_subj").addEventListener("change", function (e) { formulaFilters.subject = e.target.value; fetchFormulas(); });
    if (EP.qs("#fl_status")) EP.qs("#fl_status").addEventListener("change", function (e) { formulaFilters.status = e.target.value; fetchFormulas(); });
    let ft;
    EP.qs("#fl_q").addEventListener("input", function (e) { formulaFilters.q = e.target.value; clearTimeout(ft); ft = setTimeout(fetchFormulas, 350); });
    const exBtn = EP.qs("#fl_export");
    if (exBtn) exBtn.addEventListener("click", function () {
      const rows = (EP.qs("#fl_list")._rows || []).map(function (f) {
        return {
          Subject: f.subject_code, Chapter: f.chapter || "", Topic: f.topic || "", Title: f.title,
          Formula: f.formula_plain || f.formula_latex || "", LaTeX: f.formula_latex || "",
          Units: f.units || "", Conditions: f.conditions || "", Status: f.verification_status || "",
        };
      });
      if (!rows.length) return EP.toast("Nothing to export", "error");
      EP.exportCsv("formula-library.csv", rows);
    });
    const newBtn = EP.qs("#fl_new");
    if (newBtn) newBtn.addEventListener("click", function () { formulaForm(null, fetchFormulas); });

    function parseFormulaQuery() {
      const params = new URLSearchParams((window.location.hash || "").split("?")[1] || "");
      if (params.get("subject")) formulaFilters.subject = params.get("subject");
      if (params.get("q")) formulaFilters.q = params.get("q");
    }

    async function fetchFormulas() {
      const list = EP.qs("#fl_list");
      list.innerHTML = EP.spinner();
      let q = sb().from("formula_library").select("*", { count: "exact" }).eq("is_deleted", false);
      if (formulaFilters.subject) q = q.eq("subject_code", formulaFilters.subject);
      if (formulaFilters.status) q = q.eq("verification_status", formulaFilters.status);
      if (formulaFilters.q) {
        const term = formulaFilters.q.replace(/[,()%]/g, " ").trim();
        if (term) q = q.or("title.ilike.%" + term + "%,formula_plain.ilike.%" + term + "%,chapter.ilike.%" + term + "%,topic.ilike.%" + term + "%");
      }
      const { data, error } = await q.order("subject_code").order("chapter").order("title").limit(300);
      if (error) {
        list.innerHTML = '<div class="empty">' + (error.code === "42P01" || /relation .* does not exist/i.test(error.message)
          ? "Formula library is not initialized on this database yet — apply migration <code>0043_features_and_hardening.sql</code>."
          : EP.esc(error.message)) + "</div>";
        return;
      }
      list._rows = data || [];
      if (!data || !data.length) {
        list.innerHTML = '<div class="empty">No formulas found.' + (isEditor ? ' <a href="#" id="fl_empty_new">Add the first formula</a>.' : "") + "</div>";
        const addLink = EP.qs("#fl_empty_new");
        if (addLink) addLink.addEventListener("click", function (ev) { ev.preventDefault(); formulaForm(null, fetchFormulas); });
        return;
      }
      const subjLabel = function (code) {
        const s = FORMULA_SUBJECTS.filter(function (x) { return x.code === code; })[0];
        return s ? s.label : code;
      };
      const cards = data.map(function (f) {
        const vars = Array.isArray(f.variables) ? f.variables : [];
        const varHtml = vars.length
          ? '<div class="formula-vars"><b>Where:</b> ' + vars.map(function (v) {
              return "<span>" + EP.esc(v.symbol || "?") + (v.unit ? ' <i class="muted">[' + EP.esc(v.unit) + "]</i>" : "") + " = " + EP.esc(v.meaning || "") + "</span>";
            }).join(" · ") + "</div>"
          : "";
        const verified = f.verification_status === "VERIFIED";
        return '<div class="card formula-card" data-id="' + f.id + '">' +
          '<div class="formula-head"><span class="pill">' + EP.esc(subjLabel(f.subject_code)) + "</span>" +
          '<span class="badge ' + (verified ? "b-ok" : "b-warn") + '">' + EP.esc(f.verification_status || "PENDING_REVIEW") + "</span></div>" +
          '<h3>' + EP.esc(f.title) + "</h3>" +
          '<div class="formula-box">' + EP.esc(f.formula_plain || f.formula_latex || "") + "</div>" +
          (f.formula_latex && f.formula_plain ? '<div class="formula-latex muted">' + EP.esc(f.formula_latex) + "</div>" : "") +
          '<div class="muted">' + EP.esc((f.chapter || "") + (f.topic ? " › " + f.topic : "")) + "</div>" +
          varHtml +
          (f.conditions ? '<div class="muted small">Condition: ' + EP.esc(f.conditions) + "</div>" : "") +
          (isEditor || canVerify
            ? '<div class="btn-row">' +
              (isEditor ? '<button class="btn btn-sm" data-edit="' + f.id + '">Edit</button>' : "") +
              (canVerify && !verified ? '<button class="btn btn-sm btn-primary" data-verify="' + f.id + '">Verify</button>' : "") +
              (isEditor ? '<button class="btn btn-sm btn-ghost" data-del="' + f.id + '">Delete</button>' : "") +
              "</div>"
            : "") +
          "</div>";
      }).join("");
      list.innerHTML = '<div class="formula-grid">' + cards + "</div>";
      list.querySelectorAll("[data-edit]").forEach(function (b) {
        b.addEventListener("click", function () {
          const f = (data || []).filter(function (x) { return x.id === b.getAttribute("data-edit"); })[0];
          if (f) formulaForm(f, fetchFormulas);
        });
      });
      list.querySelectorAll("[data-verify]").forEach(function (b) {
        b.addEventListener("click", async function () {
          b.disabled = true;
          const { error } = await sb().from("formula_library").update({
            verification_status: "VERIFIED", verified_at: new Date().toISOString(),
            verified_by: EP.state.user.id,
          }).eq("id", b.getAttribute("data-verify"));
          if (error) { b.disabled = false; return EP.toast(error.message, "error"); }
          EP.toast("Formula verified", "success"); fetchFormulas();
        });
      });
      list.querySelectorAll("[data-del]").forEach(function (b) {
        b.addEventListener("click", async function () {
          if (!window.confirm("Remove this formula from the library?")) return;
          const { error } = await sb().from("formula_library").update({ is_deleted: true }).eq("id", b.getAttribute("data-del"));
          if (error) return EP.toast(error.message, "error");
          EP.toast("Formula removed", "success"); fetchFormulas();
        });
      });
    }

    function formulaForm(f, done) {
      const isEdit = !!f;
      const varText = (Array.isArray(f && f.variables) ? f.variables : [])
        .map(function (v) { return [v.symbol || "", v.meaning || "", v.unit || ""].join(" | "); }).join("\n");
      EP.modal(isEdit ? "Edit formula" : "New formula",
        '<div class="form-grid">' +
        '<div class="field"><label>Subject *</label><select id="ff_subj" class="input">' + FORMULA_SUBJECTS.map(function (s) {
          return '<option value="' + s.code + '"' + (f && f.subject_code === s.code ? " selected" : "") + ">" + s.label + "</option>";
        }).join("") + "</select></div>" +
        '<div class="field"><label>Title *</label><input id="ff_title" class="input" value="' + EP.esc(f ? f.title : "") + '"></div>' +
        '<div class="field"><label>Chapter</label><input id="ff_chapter" class="input" value="' + EP.esc(f ? f.chapter || "" : "") + '"></div>' +
        '<div class="field"><label>Topic</label><input id="ff_topic" class="input" value="' + EP.esc(f ? f.topic || "" : "") + '"></div>' +
        '<div class="field"><label>Formula (plain text) *</label><input id="ff_plain" class="input" placeholder="v = u + at" value="' + EP.esc(f ? f.formula_plain || "" : "") + '"></div>' +
        '<div class="field"><label>Formula (LaTeX)</label><input id="ff_latex" class="input" placeholder="v = u + at" value="' + EP.esc(f ? f.formula_latex || "" : "") + '"></div>' +
        '<div class="field"><label>Units</label><input id="ff_units" class="input" value="' + EP.esc(f ? f.units || "" : "") + '"></div>' +
        '<div class="field"><label>Conditions</label><input id="ff_cond" class="input" value="' + EP.esc(f ? f.conditions || "" : "") + '"></div>' +
        '<div class="field" style="grid-column:1/-1"><label>Variables — one per line: <code>symbol | meaning | unit</code></label>' +
        '<textarea id="ff_vars" class="input" rows="4" placeholder="v | final velocity | m/s">' + EP.esc(varText) + "</textarea></div>" +
        "</div>",
        '<button class="btn btn-primary" id="ff_save">' + (isEdit ? "Save changes" : "Add formula") + "</button>");
      EP.qs("#ff_save").addEventListener("click", async function () {
        const vars = EP.qs("#ff_vars").value.split("\n").map(function (line) {
          const p = line.split("|").map(function (x) { return x.trim(); });
          return p[0] ? { symbol: p[0], meaning: p[1] || "", unit: p[2] || "" } : null;
        }).filter(Boolean);
        const payload = {
          subject_code: EP.qs("#ff_subj").value,
          title: EP.qs("#ff_title").value.trim(),
          chapter: EP.qs("#ff_chapter").value.trim() || null,
          topic: EP.qs("#ff_topic").value.trim() || null,
          formula_plain: EP.qs("#ff_plain").value.trim(),
          formula_latex: EP.qs("#ff_latex").value.trim() || EP.qs("#ff_plain").value.trim(),
          units: EP.qs("#ff_units").value.trim() || null,
          conditions: EP.qs("#ff_cond").value.trim() || null,
          variables: vars,
          verification_status: "PENDING_REVIEW",
          tenant_id: EP.state.tenantId || "00000000-0000-0000-0000-000000000001",
        };
        if (!payload.title || !payload.formula_plain) return EP.toast("Title and plain formula are required", "error");
        const res = isEdit
          ? await sb().from("formula_library").update(payload).eq("id", f.id)
          : await sb().from("formula_library").insert(payload);
        if (res.error) return EP.toast(res.error.message, "error");
        EP.closeModal();
        EP.toast(isEdit ? "Formula updated" : "Formula added — pending review", "success");
        done();
      });
    }

    fetchFormulas();
  });

  // ===========================================================================
  // UNAUTHORIZED (role-based access denied)
  // ===========================================================================
  EP.register("/unauthorized", async function (main) {
    main.innerHTML =
      '<div class="page" style="text-align:center;padding:60px 20px">' +
      '<h2>Access denied</h2>' +
      '<p class="muted">Your role does not have permission to view this page.</p>' +
      '<a class="btn btn-primary" href="#/dashboard">Back to dashboard</a>' +
      "</div>";
  });
})();
