/* ExamPro — XSS sanitizer + route-level permission guards.
 * sanitizer: allowlist-based DOM sanitization (no third-party dependency).
 * guards:    route metadata (roles / permissions) enforced before render.
 */
(function () {
  "use strict";
  const EP = window.EP;

  // ---------------------------------------------------------------------------
  // HTML sanitizer — question stems and solutions may contain trusted HTML;
  // everything else must pass through here before touching innerHTML.
  // ---------------------------------------------------------------------------
  const ALLOWED_TAGS = new Set([
    "P","BR","B","STRONG","I","EM","U","S","SUB","SUP","SMALL","MARK",
    "UL","OL","LI","H1","H2","H3","H4","H5","H6","PRE","CODE","BLOCKQUOTE",
    "TABLE","THEAD","TBODY","TFOOT","TR","TH","TD","SPAN","DIV",
    "IMG","FIGURE","FIGCAPTION","HR","DL","DT","DD","DETAILS","SUMMARY",
  ]);
  const BLOCKED_TAGS = new Set([
    "SCRIPT","STYLE","IFRAME","FRAME","OBJECT","EMBED","FORM","INPUT","SELECT",
    "TEXTAREA","BUTTON","LINK","META","BASE","VIDEO","AUDIO","SOURCE","TRACK",
    "APPLET","MATH","SVG","NOSCRIPT","TEMPLATE",
  ]);
  function safeUrl(v) {
    v = String(v || "").trim();
    if (!v) return "";
    if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(v) && !/script/i.test(v)) return v;
    return "";
  }
  EP.safeHtml = function (html) {
    if (html === null || html === undefined || html === "") return "";
    if (typeof html !== "string") html = String(html);
    let doc;
    try { doc = new DOMParser().parseFromString(html, "text/html"); } catch (_) { return EP.esc(html); }
    const out = document.createElement("div");
    function clean(node, parent) {
      const kids = Array.prototype.slice.call(node.childNodes);
      for (const k of kids) {
        if (k.nodeType === 3) { parent.appendChild(document.createTextNode(k.nodeValue)); continue; }
        if (k.nodeType !== 1) continue;
        const tag = (k.tagName || "").toUpperCase();
        if (!tag || BLOCKED_TAGS.has(tag)) continue;
        let el;
        if (tag === "A") {
          const href = safeUrl(k.getAttribute("href"));
          el = document.createElement("a");
          if (href) el.setAttribute("href", href);
          if (k.getAttribute("title")) el.setAttribute("title", k.getAttribute("title"));
          el.setAttribute("rel", "noopener noreferrer");
          el.setAttribute("target", "_blank");
        } else if (tag === "IMG") {
          const src = safeUrl(k.getAttribute("src"));
          if (!src) continue;
          el = document.createElement("img");
          el.setAttribute("src", src);
          el.setAttribute("alt", k.getAttribute("alt") || "");
          if (k.getAttribute("width")) el.setAttribute("width", k.getAttribute("width"));
          if (k.getAttribute("height")) el.setAttribute("height", k.getAttribute("height"));
          el.setAttribute("loading", "lazy");
        } else {
          el = ALLOWED_TAGS.has(tag) ? document.createElement(tag.toLowerCase()) : document.createElement("span");
        }
        clean(k, el);
        parent.appendChild(el);
      }
    }
    clean(doc.body, out);
    return out.innerHTML;
  };

  // ---------------------------------------------------------------------------
  // Route guards — register(path, fn, { roles, perms }) and enforce in shell.
  // ---------------------------------------------------------------------------
  EP.routeMeta = {};
  const _register = EP.register;
  EP.register = function (path, fn, opts) {
    if (opts) EP.routeMeta[path] = opts;
    return _register(path, fn);
  };

  // Mirror of the shell's param-pattern matching, returning route metadata.
  EP.routeMetaFor = function (path) {
    if (EP.routeMeta[path]) return EP.routeMeta[path];
    const segs = path.split("/");
    for (const rk in EP.routeMeta) {
      const rsegs = rk.split("/");
      if (rsegs.length !== segs.length) continue;
      let ok = true;
      for (let i = 0; i < rsegs.length; i++) {
        if (rsegs[i].charAt(0) === ":") continue;
        if (rsegs[i] !== segs[i]) { ok = false; break; }
      }
      if (ok) return EP.routeMeta[rk];
    }
    return null;
  };

  EP.canAccess = function (path) {
    const meta = EP.routeMetaFor(path);
    if (!meta) return true;
    if (meta.roles && !EP.hasRole(meta.roles)) return false;
    if (meta.perms) {
      for (const p in meta.perms) if (!EP.can(meta.perms[p])) return false;
    }
    return true;
  };

  EP.accessDenied = function (main) {
    main.innerHTML =
      '<div class="page"><div class="empty"><h3>Access denied</h3>' +
      "<p>Your role does not have permission to view this page. Contact your workspace administrator if you believe this is an error.</p>" +
      '<a class="btn btn-primary" href="#/dashboard">Back to dashboard</a></div></div>';
  };
})();
