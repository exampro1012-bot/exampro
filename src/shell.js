/* ExamPro — Setup, Auth, and responsive application shell. */
(function () {
  const EP = window.EP;

  // ---------------------------------------------------------------------------
  // Setup screen (configure Supabase URL + publishable/anon key)
  // ---------------------------------------------------------------------------
  EP.renderSetup = function () {
    const root = EP.qs("#app") || document.body;
    const envUrl = (window.EXAMPRO_CONFIG && window.EXAMPRO_CONFIG.SUPABASE_URL) ? window.EXAMPRO_CONFIG.SUPABASE_URL : "";
    const envKey = (window.EXAMPRO_CONFIG && (window.EXAMPRO_CONFIG.SUPABASE_PUBLISHABLE_KEY || window.EXAMPRO_CONFIG.SUPABASE_ANON_KEY)) ? (window.EXAMPRO_CONFIG.SUPABASE_PUBLISHABLE_KEY || window.EXAMPRO_CONFIG.SUPABASE_ANON_KEY) : "";

    if (envUrl && envKey) {
      EP.saveConfig({ url: envUrl, anonKey: envKey });
      EP._sb = null;
      EP.render();
      return;
    }

    const ls = EP.loadConfig();
    if (ls.url && ls.anonKey) {
      EP.saveConfig({ url: ls.url, anonKey: ls.anonKey });
      EP._sb = null;
      EP.render();
      return;
    }

    const missingMsg = envUrl && !envKey
      ? '<p class="hint" style="color:var(--bad)">Project URL is set in <code>index.html</code>, but the anon key is missing. Add <code>SUPABASE_PUBLISHABLE_KEY</code> to <code>window.EXAMPRO_CONFIG</code> to skip this screen.</p>'
      : '';

    root.innerHTML =
      '<div class="setup-wrap" id="setup">' +
      '<div class="setup-card">' +
      '<div class="brand"><span class="logo">E</span><h1>ExamPro</h1></div>' +
      '<p class="muted">Connect your Supabase project. Paste the <b>Project URL</b> and the <b>anon / publishable</b> key (safe to expose in the browser). Never paste a service-role or database key here.</p>' +
      missingMsg +
      '<div class="field"><label>Supabase URL</label><input id="cfg_url" class="input" placeholder="https://xxxx.supabase.co" value="' + EP.esc(envUrl) + '"></div>' +
      '<div class="field"><label>Anon / Publishable Key</label><input id="cfg_key" class="input" placeholder="eyJ..." value="' + EP.esc(envKey) + '"></div>' +
      '<button id="cfg_save" class="btn btn-primary btn-block">Save &amp; Continue</button>' +
      '<p class="hint">These values are stored only in this browser and used to talk to YOUR Supabase project. Apply the migrations in <code>supabase/migrations</code> before using the app.</p>' +
      "</div></div>";
    EP.qs("#cfg_save").addEventListener("click", function () {
      const url = EP.qs("#cfg_url").value.trim();
      const key = EP.qs("#cfg_key").value.trim();
      if (!url || !key) { EP.toast("Both fields are required", "error"); return; }
      EP.saveConfig({ url: url, anonKey: key });
      EP._sb = null; // force client rebuild
      EP.toast("Configuration saved", "success");
      setTimeout(function () { EP.render(); }, 400);
    });
    // prefill if present in localStorage
    const c = EP.loadConfig();
    if (c.url) EP.qs("#cfg_url").value = c.url;
    if (c.anonKey) EP.qs("#cfg_key").value = c.anonKey;
  };

  // ---------------------------------------------------------------------------
  // Auth screen
  // ---------------------------------------------------------------------------
  EP.renderAuth = function () {
    const root = EP.qs("#app") || document.body;
    const path = EP.currentPath();
    const isReset = path === "/auth/reset";
    const isCallback = path === "/auth/callback";
    const isVerify = path === "/verify-email";
    const isForgot = path === "/forgot-password";

    if (isCallback) {
      root.innerHTML =
        '<div class="setup-wrap"><div class="setup-card" style="text-align:center">' +
        '<div class="brand" style="justify-content:center"><span class="logo">E</span><h1>ExamPro</h1></div>' +
        EP.spinner("Completing sign-in…") +
        '<p class="muted">Please wait while we verify your identity.</p>' +
        "</div></div>";
      (async function () {
        await new Promise(function (r) { setTimeout(r, 800); });
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
      })();
      return;
    }

    if (isVerify) {
      const email = EP.state.user ? EP.state.user.email : "";
      root.innerHTML =
        '<div class="setup-wrap"><div class="setup-card" id="auth">' +
        '<div class="brand"><span class="logo">E</span><h1>ExamPro</h1></div>' +
        '<h2>Verify your email</h2>' +
        '<p>We sent a verification link to <b>' + EP.esc(email) + '</b>. Click the link in the email to activate your account.</p>' +
        '<div class="field"><label>Resend verification email</label><input id="au_vemail" type="email" class="input" value="' + EP.esc(email) + '" placeholder="you@school.edu"></div>' +
        '<button id="au_resend" class="btn btn-primary btn-block">Resend email</button>' +
        '<p class="hint">Check your spam folder if you do not see it.</p>' +
        '<a class="btn btn-ghost btn-block" href="#/auth">Back to login</a>' +
        "</div></div>";
      EP.qs("#au_resend").addEventListener("click", async function () {
        const em = EP.qs("#au_vemail").value.trim();
        if (!em) { EP.toast("Enter your email", "error"); return; }
        EP.qs("#au_resend").disabled = true;
        try {
          await EP.auth.resendVerification(em);
          EP.toast("Verification email sent", "success");
        } catch (e) { EP.toast(e.message || "Failed", "error"); }
        finally { EP.qs("#au_resend").disabled = false; }
      });
      return;
    }

    if (isForgot) {
      root.innerHTML =
        '<div class="setup-wrap"><div class="setup-card" id="auth">' +
        '<div class="brand"><span class="logo">E</span><h1>ExamPro</h1></div>' +
        '<h2>Forgot password</h2>' +
        '<p class="muted">Enter your email and we will send you a reset link.</p>' +
        '<div class="field"><label>Email</label><input id="au_forgot_email" type="email" class="input" placeholder="you@school.edu"></div>' +
        '<button id="au_forgot_send" class="btn btn-primary btn-block">Send reset link</button>' +
        '<a class="btn btn-ghost btn-block" href="#/auth">Back to login</a>' +
        "</div></div>";
      EP.qs("#au_forgot_send").addEventListener("click", async function () {
        const email = EP.qs("#au_forgot_email").value.trim();
        if (!email) { EP.toast("Enter your email", "error"); return; }
        EP.qs("#au_forgot_send").disabled = true;
        try {
          await EP.auth.reset(email);
          EP.toast("If an account exists for this email, a password reset link has been sent.", "success");
          EP.navigate("/auth");
        } catch (e) { EP.toast(e.message || "Failed", "error"); }
        finally { EP.qs("#au_forgot_send").disabled = false; }
      });
      return;
    }

    if (isReset) {
      root.innerHTML =
        '<div class="setup-wrap"><div class="setup-card" id="auth">' +
        '<div class="brand"><span class="logo">E</span><h1>ExamPro</h1></div>' +
        '<h2>Set new password</h2>' +
        '<div class="field"><label>New password</label><input id="au_pw" type="password" class="input"></div>' +
        '<div class="field"><label>Confirm password</label><input id="au_pw2" type="password" class="input"></div>' +
        '<button id="au_reset" class="btn btn-primary btn-block">Update password</button>' +
        "</div></div>";
      EP.qs("#au_reset").addEventListener("click", async function () {
        const pw = EP.qs("#au_pw").value, pw2 = EP.qs("#au_pw2").value;
        if (pw !== pw2) { EP.toast("Passwords do not match", "error"); return; }
        try { await EP.auth.updatePassword(pw); EP.secLog("PASSWORD_CHANGED", null); EP.toast("Password updated", "success"); EP.navigate(EP.roleDashboard()); }
        catch (e) { EP.toast(e.message || "Failed", "error"); }
      });
      return;
    }

    let html =
      '<div class="setup-wrap"><div class="setup-card" id="auth">' +
      '<div class="brand"><span class="logo">E</span><h1>ExamPro</h1></div>' +
      '<div class="tabs">' +
      '<button class="tab active" data-tab="login">Login</button>' +
      '<button class="tab" data-tab="signup">Sign up</button></div>' +
      '<div id="au_login">' +
      '<div class="field"><label>Email</label><input id="au_email" type="email" class="input" placeholder="you@school.edu"></div>' +
      '<div class="field"><label>Password</label><div style="position:relative"><input id="au_pw" type="password" class="input" placeholder="Enter your password"><button class="icon-btn" id="au_pw_toggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:16px" aria-label="Show password">👁</button></div></div>' +
      '<div class="row-between"><label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="au_remember"> Remember session</label><a href="#" id="au_forgot">Forgot password?</a></div>' +
      '<button id="au_login_btn" class="btn btn-primary btn-block">Login</button>' +
      '<button id="au_google" class="btn btn-ghost btn-block">Continue with Google</button>' +
      "</div>" +
      '<div id="au_signup" style="display:none">' +
      '<div class="field"><label>Full name</label><input id="au_name" class="input" placeholder="Your full name"></div>' +
      '<div class="field"><label>Email</label><input id="au_email2" type="email" class="input" placeholder="you@school.edu"></div>' +
      '<div class="field"><label>Password</label><div style="position:relative"><input id="au_pw2" type="password" class="input" placeholder="Min 8 chars, uppercase, lowercase, number, special char"><button class="icon-btn" id="au_pw2_toggle" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:16px" aria-label="Show password">👁</button></div></div>' +
      '<p class="hint" id="au_pw_hint" style="color:var(--muted)"></p>' +
      '<div class="field" style="margin-top:8px"><label style="font-size:12px;display:flex;align-items:center;gap:6px"><input type="checkbox" id="au_terms"> I agree to the Terms of Service and Privacy Policy</label></div>' +
      '<button id="au_signup_btn" class="btn btn-primary btn-block">Create account</button>' +
      '<p class="hint">Your workspace tenant is auto-provisioned on first sign-up.</p>' +
      "</div>";
    html += "</div></div>";
    root.innerHTML = html;

    // Password toggles
    function bindToggle(btnId, inputId) {
      const btn = EP.qs("#" + btnId);
      const inp = EP.qs("#" + inputId);
      if (btn && inp) {
        btn.addEventListener("click", function () {
          const isPassword = inp.type === "password";
          inp.type = isPassword ? "text" : "password";
          btn.textContent = isPassword ? "🙈" : "👁";
        });
      }
    }
    bindToggle("au_pw_toggle", "au_pw");
    bindToggle("au_pw2_toggle", "au_pw2");

    // Password strength hint on signup
    const pw2Input = EP.qs("#au_pw2");
    if (pw2Input) {
      pw2Input.addEventListener("input", function () {
        const v = pw2Input.value;
        const hint = EP.qs("#au_pw_hint");
        if (!hint) return;
        if (!v) { hint.textContent = ""; return; }
        const checks = [
          v.length >= 8, /[A-Z]/.test(v), /[a-z]/.test(v), /[0-9]/.test(v), /[^A-Za-z0-9]/.test(v)
        ];
        const labels = ["8+ chars", "Uppercase", "Lowercase", "Number", "Special char"];
        hint.innerHTML = checks.map(function (ok, i) {
          return '<span style="color:' + (ok ? "var(--ok)" : "var(--bad)") + '">' + labels[i] + "</span>";
        }).join(" · ");
      });
    }

    EP.qsa(".tab").forEach(function (t) {
      t.addEventListener("click", function () {
        EP.qsa(".tab").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        const tab = t.getAttribute("data-tab");
        EP.qs("#au_login").style.display = tab === "login" ? "" : "none";
        EP.qs("#au_signup").style.display = tab === "signup" ? "" : "none";
      });
    });

    EP.qs("#au_login_btn").addEventListener("click", async function () {
      const email = EP.qs("#au_email").value.trim(), pw = EP.qs("#au_pw").value;
      if (!email || !pw) { EP.toast("Enter email and password", "error"); return; }
      const btn = EP.qs("#au_login_btn");
      btn.disabled = true; btn.textContent = "Signing in…";
      try {
        await EP.auth.signIn(email, pw);
        EP.secLog("LOGIN_SUCCESS", JSON.stringify({ email: email }));
        EP.toast("Welcome back", "success");
        EP.navigate(EP.roleDashboard());
      } catch (e) {
        EP.secLog("LOGIN_FAILED", JSON.stringify({ email: email, reason: (e.message || "").slice(0, 200) }));
        EP.toast(e.message || "Login failed", "error");
        btn.disabled = false; btn.textContent = "Login";
      }
    });

    EP.qs("#au_signup_btn").addEventListener("click", async function () {
      const name = EP.qs("#au_name").value.trim(), email = EP.qs("#au_email2").value.trim(), pw = EP.qs("#au_pw2").value;
      const terms = EP.qs("#au_terms");
      if (!email || !pw) { EP.toast("Enter email and password", "error"); return; }
      const pwErr = EP.auth.validatePassword(pw);
      if (pwErr) { EP.toast(pwErr, "error"); return; }
      if (terms && !terms.checked) { EP.toast("Please accept the terms to continue", "error"); return; }
      const btn = EP.qs("#au_signup_btn");
      btn.disabled = true; btn.textContent = "Creating account…";
      try {
        const d = await EP.auth.signUp(email, pw, name);
        if (d.session) {
          EP.secLog("SIGNUP", JSON.stringify({ email: email }));
          EP.toast("Account created", "success");
          await EP.loadIdentity(d.session.user);
          EP.navigate(EP.roleDashboard());
        }
        else {
          EP.secLog("SIGNUP_EMAIL_REQUIRED", JSON.stringify({ email: email }));
          EP.toast("Check your email to confirm your account", "success");
          btn.disabled = false; btn.textContent = "Create account";
        }
      } catch (e) { EP.toast(e.message || "Sign-up failed", "error"); btn.disabled = false; btn.textContent = "Create account"; }
    });

    EP.qs("#au_google").addEventListener("click", async function () {
      const btn = EP.qs("#au_google");
      btn.disabled = true; btn.textContent = "Redirecting…";
      try {
        const cfg = EP.loadConfig();
        if (cfg.url && cfg.anonKey) {
          try {
            const res = await fetch(cfg.url + "/auth/v1/settings", {
              headers: { apikey: cfg.anonKey },
            });
            const settings = await res.json();
            const ext = (settings && settings.external) || {};
            if (!ext.google) {
              EP.toast("Google sign-in is not enabled for this deployment yet. Ask the administrator to enable Google in Supabase Auth (Authentication → Providers → Google).", "error");
              btn.disabled = false; btn.textContent = "Continue with Google";
              return;
            }
          } catch (_) { /* probe failed; let the OAuth flow surface any error */ }
        }
        await EP.auth.signInWithGoogle(); EP.secLog("OAUTH_LOGIN", JSON.stringify({ provider: "google" }));
      } catch (e) { EP.toast(e.message || "Google sign-in failed", "error"); btn.disabled = false; btn.textContent = "Continue with Google"; }
    });
    const f = EP.qs("#au_forgot");
    if (f) f.addEventListener("click", async function (e) {
      e.preventDefault();
      const email = (EP.qs("#au_email") ? EP.qs("#au_email").value.trim() : "");
      if (!email) { EP.toast("Enter your email first", "error"); return; }
      try { await EP.auth.reset(email); EP.toast("If an account exists for this email, a password reset link has been sent.", "success"); }
      catch (e2) { EP.toast(e2.message || "Failed", "error"); }
    });
  };

  // ---------------------------------------------------------------------------
  // Unauthorized screen
  // ---------------------------------------------------------------------------
  EP.renderUnauthorized = function () {
    const main = EP.qs("#ep_main");
    if (main) {
      main.innerHTML =
        '<div class="page" style="text-align:center;padding:60px 20px">' +
        '<h2>Access denied</h2>' +
        '<p class="muted">Your role does not have permission to view this page.</p>' +
        '<a class="btn btn-primary" href="#/dashboard">Back to dashboard</a>' +
        "</div>";
    } else {
      const root = EP.qs("#app") || document.body;
      root.innerHTML =
        '<div class="setup-wrap"><div class="setup-card" style="text-align:center">' +
        '<div class="brand" style="justify-content:center"><span class="logo">E</span><h1>ExamPro</h1></div>' +
        '<h2>Access denied</h2>' +
        '<p>Your role does not have permission to view this page.</p>' +
        '<a class="btn btn-primary" href="#/dashboard">Back to dashboard</a>' +
        "</div></div>";
    }
  };

  // ---------------------------------------------------------------------------
  // Application shell (responsive: desktop grid, mobile drawer + bottom nav)
  // ---------------------------------------------------------------------------
  EP.renderShell = async function (path) {
    const s = EP.state;
    const roleLabel = s.isSuper ? "Super Admin" : (s.role || "User");
    const nav = EP.nav();
    const sb = EP.getClient();

    const sidebarLinks = nav.map(function (it) {
      const active = path === it.path ? " active" : "";
      return '<a class="nav-link' + active + '" href="#' + it.path + '" data-path="' + it.path + '">' +
        '<span class="nav-ico">' + it.icon + '</span><span class="nav-txt">' + EP.esc(it.label) + "</span></a>";
    }).join("");

    const bottomLinks = nav.slice(0, 5).map(function (it) {
      const active = path === it.path ? " active" : "";
      return '<a class="bn-link' + active + '" href="#' + it.path + '"><span>' + it.icon + "</span><small>" + EP.esc(it.label.split(" ")[0]) + "</small></a>";
    }).join("");

    const app = EP.qs("#app") || document.body;
    app.className = "app-shell";
    app.innerHTML =
      '<aside class="sidebar" id="sidebar">' +
        '<div class="side-brand"><span class="logo">E</span><span class="side-name">ExamPro</span>' +
        '<button class="icon-btn side-close" id="side_close" aria-label="Close menu">&times;</button></div>' +
        '<nav class="side-nav">' + sidebarLinks + "</nav>" +
        '<div class="side-foot"><div class="user-chip"><div class="avatar">' + EP.esc((s.profile && s.profile.full_name || s.user.email || "?").charAt(0).toUpperCase()) + "</div>" +
        '<div class="uc-meta"><div class="uc-name">' + EP.esc((s.profile && s.profile.full_name) || s.user.email || "") + '</div><div class="uc-role">' + EP.esc(roleLabel) + "</div></div></div>" +
        '<button class="btn btn-ghost btn-sm btn-block" id="logout_btn">Log out</button></div>' +
      "</aside>" +
      '<div class="side-scrim" id="side_scrim"></div>' +
      '<div class="main-col">' +
        '<header class="topbar">' +
          '<button class="icon-btn" id="menu_btn" aria-label="Menu">☰</button>' +
          '<div class="top-title" id="top_title">ExamPro</div>' +
           '<div class="top-right"><span class="role-badge">' + EP.esc(roleLabel) + "</span>" +
           '<select id="lang_sel" class="input" style="width:auto;padding:4px 8px;font-size:12px"><option value="en">EN</option><option value="hi">HI</option><option value="gu">GU</option></select>' +
           '<button class="icon-btn bell-btn" id="notif_btn" aria-label="Notifications">🔔' +
             '<span class="bell-badge" id="notif_badge" style="display:none">0</span></button>' +
           '<button class="icon-btn" id="logout_btn2" aria-label="Log out">⏻</button></div>' +
        "</header>" +
        '<main class="content" id="ep_main">' + EP.spinner("Loading…") + "</main>" +
      "</div>" +
      '<nav class="bottom-nav" id="bottom_nav">' + bottomLinks + "</nav>";

    EP.qs("#menu_btn").addEventListener("click", function () {
      EP.qs("#sidebar").classList.add("open");
      EP.qs("#side_scrim").classList.add("show");
    });
    EP.qs("#side_close").addEventListener("click", closeDrawer);
    EP.qs("#side_scrim").addEventListener("click", closeDrawer);
    function closeDrawer() {
      EP.qs("#sidebar").classList.remove("open");
      EP.qs("#side_scrim").classList.remove("show");
    }
    EP.qs("#logout_btn").addEventListener("click", doLogout);
    const lb2 = EP.qs("#logout_btn2"); if (lb2) lb2.addEventListener("click", doLogout);
    const ls = EP.qs("#lang_sel");
    if (ls) {
      ls.value = (EP.i18n && EP.i18n.current) || "en";
      ls.addEventListener("change", function () {
        if (EP.i18n && EP.i18n.set) EP.i18n.set(ls.value);
      });
    }

    // notification bell: unread badge, refresh every 60s, click -> inbox page
    const badgeEl = EP.qs("#notif_badge");
    async function refreshBell() {
      try {
        const n = await EP.unreadCount();
        badgeEl.textContent = n;
        badgeEl.style.display = n > 0 ? "" : "none";
      } catch (_) { /* silent */ }
    }
    refreshBell();
    setInterval(refreshBell, 60000);
    EP.qs("#notif_btn").addEventListener("click", function () { EP.navigate("/notifications"); });

    async function doLogout() {
      await EP.secLog("LOGOUT", null);
      await EP.auth.signOut();
      EP.toast("Signed out", "info");
      EP.navigate("/auth");
    }

    // dispatch route (supports :param routes, e.g. /questions/:id)
    function resolveRoute(p) {
      if (EP.routes[p]) return EP.routes[p];
      const segs = p.split("/");
      for (const rk in EP.routes) {
        const rsegs = rk.split("/");
        if (rsegs.length !== segs.length) continue;
        let ok = true;
        for (let i = 0; i < rsegs.length; i++) {
          if (rsegs[i].charAt(0) === ":") continue;
          if (rsegs[i] !== segs[i]) { ok = false; break; }
        }
        if (ok) return EP.routes[rk];
      }
      return EP.routes["/dashboard"];
    }
    const handler = resolveRoute(path);
    // route-level permission guard (roles / perms from EP.register opts)
    if (!EP.canAccess(path)) { EP.accessDenied(EP.qs("#ep_main")); return; }
    const titleMap = {}; nav.forEach(function (n) { titleMap[n.path] = n.label; });
    EP.qs("#top_title").textContent = titleMap[path] || "ExamPro";

    if (!handler) {
      EP.qs("#ep_main").innerHTML = '<div class="empty"><h3>Page not found</h3><p>The route <code>' + EP.esc(path) + "</code> does not exist.</p></div>";
      return;
    }
    try {
      await handler(EP.qs("#ep_main"), path);
    } catch (e) {
      EP.qs("#ep_main").innerHTML = '<div class="empty error"><h3>Something went wrong</h3><pre>' + EP.esc(e.message || String(e)) + "</pre></div>";
    }
  };
})();
