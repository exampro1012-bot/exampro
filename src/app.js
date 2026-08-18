/* ExamPro — Supabase-powered SPA core.
   * No legacy backend. No mock data. All data goes through the Supabase client
 * (PostgreSQL + Auth + Storage + Edge Functions) with RLS enforced server-side.
 * Configuration (Supabase URL + anon/publishable key) is supplied by the user
 * via the Setup screen and stored locally; privileged keys are NEVER shipped.
 */
(function () {
  "use strict";
  const EP = (window.EP = {});

  // ---------------------------------------------------------------------------
  // Config (env-driven: local config OR window.EXAMPRO_CONFIG injected at deploy)
  // ---------------------------------------------------------------------------
  const LS_KEY = "exampro_config_v2";
  EP.loadConfig = function () {
    // User-set config (localStorage, via the Setup screen) is authoritative so
    // users can point the app at any project; baked-in env config (index.html)
    // is the fallback for fresh/managed deployments.
    let ls = null;
    try { ls = JSON.parse(localStorage.getItem(LS_KEY) || "{}") || null; } catch (_) { ls = null; }
    if (ls && ls.url && ls.anonKey) return ls;
    try {
      const envConfig = (window.EXAMPRO_CONFIG && window.EXAMPRO_CONFIG.SUPABASE_URL) ? {
        url: window.EXAMPRO_CONFIG.SUPABASE_URL,
        anonKey: window.EXAMPRO_CONFIG.SUPABASE_PUBLISHABLE_KEY || window.EXAMPRO_CONFIG.SUPABASE_ANON_KEY || ''
      } : null;
      const validEnv = envConfig && envConfig.url && envConfig.anonKey ? envConfig : null;
      return validEnv || {};
    } catch (_) {
      return {};
    }
  };
  EP.saveConfig = function (c) {
    localStorage.setItem(LS_KEY, JSON.stringify(c));
  };
  EP.getClient = function () {
    const c = EP.loadConfig();
    if (!c.url || !c.anonKey) return null;
    if (!EP._sb) {
      EP._sb = supabase.createClient(c.url, c.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    return EP._sb;
  };

  // ---------------------------------------------------------------------------
  // Identity / state
  // ---------------------------------------------------------------------------
  EP.state = {
    session: null,
    user: null,
    profile: null,
    membership: null,
    role: null,
    isSuper: false,
    tenantId: null,
    permissions: new Set(),
  };

  // ---------------------------------------------------------------------------
  // Small DOM / formatting helpers
  // ---------------------------------------------------------------------------
  EP.esc = function (s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  // Schema capability probe (cached): feature-gates UI on columns that are
  // added by migrations (e.g. questions.ncert in 0028). The app degrades
  // gracefully before the migration is applied and unlocks the feature after.
  EP._schemaCache = {};
  EP.hasColumn = function (table, column) {
    var key = table + "." + column;
    if (EP._schemaCache[key] !== undefined) return Promise.resolve(EP._schemaCache[key]);
    return EP.getClient().from(table).select(column).limit(1)
      .then(function (r) { EP._schemaCache[key] = !r.error; return !r.error; })
      .catch(function () { EP._schemaCache[key] = false; return false; });
  };
  // Table-existence probe (cached): PostgREST's OpenAPI root lists all visible
  // tables in ONE request, so pages can feature-gate whole modules (e.g. the
  // formula library from migration 0043) without firing a failing query per
  // page load (a missing-relation 404 would pollute the console otherwise).
  // Table-existence probe (cached): mirrors EP.hasColumn but for whole tables
  // (e.g. formula_library from migration 0043). A PGRST205 (relation not found)
  // means the migration hasn't been applied; any other failure is treated as
  // "table exists, proceed" so the feature never stays hidden once applied.
  EP._tablesCache = {};
  EP.hasTable = async function (table) {
    if (EP._tablesCache[table] !== undefined) return EP._tablesCache[table];
    const sb = EP.getClient();
    if (!sb) return false;
    return sb.from(table).select("id").limit(1)
      .then(function (r) {
        EP._tablesCache[table] = !(r.error && r.error.code === "PGRST205");
        return EP._tablesCache[table];
      })
      .catch(function (e) {
        EP._tablesCache[table] = !(e && /PGRST205|relation .* does not exist/i.test(e.message || ""));
        return EP._tablesCache[table];
      });
  };
  // RFC-4180 CSV download. Supports both call forms:
  //   EP.exportCsv("x.csv", rows)                    — headers derived from first row
  //   EP.exportCsv("x.csv", headers, rows)           — explicit header order
  EP.exportCsv = function (filename, a, b) {
    var headers, rows;
    if (b !== undefined) { headers = a || []; rows = b || []; }
    else { rows = a || []; headers = rows.length ? Object.keys(rows[0]) : []; }
    if (!rows.length) { EP.toast("Nothing to export", "error"); return; }
    const esc = function (v) {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [headers.map(esc).join(",")].concat(rows.map(function (r) {
      return headers.map(function (h) { return esc(r[h]); }).join(",");
    })).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement("a");
    a2.href = url;
    a2.download = filename;
    document.body.appendChild(a2);
    a2.click();
    document.body.removeChild(a2);
    URL.revokeObjectURL(url);
  };
  EP.fmtDate = function (d) {
    if (!d) return "";
    try { return new Date(d).toLocaleString(); } catch (_) { return String(d); }
  };

  // ---------------------------------------------------------------------------
  // PPTX export (minimal OOXML writer; pure JS, no dependencies).
  // Produces one slide per question: question text, options, answer, solution.
  // ---------------------------------------------------------------------------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function xmlEscape(s) {
    return String(s == null ? "" : s).replace(/[<>&"']/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c];
    });
  }
  EP.exportPptx = function (filename, slides) {
    var parts = {};
    parts["[Content_Types].xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.theme+xml"/>' +
      '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>' +
      '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>' +
      '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>' +
      slides.map(function (_, i) { return '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'; }).join("") +
      "</Types>";

    var slideRels = slides.map(function (_, i) {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
        "</Relationships>";
    });
    parts["_rels/.rels"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      "</Relationships>";
    parts["ppt/_rels/presentation.xml.rels"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
      slides.map(function (_, i) { return '<Relationship Id="rId' + (i + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + (i + 1) + '.xml"/>'; }).join("") +
      '<Relationship Id="rId' + (slides.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>' +
      '<Relationship Id="rId' + (slides.length + 3) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>' +
      '<Relationship Id="rId' + (slides.length + 4) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
      '<Relationship Id="rId' + (slides.length + 5) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>' +
      "</Relationships>";
    parts["ppt/presentation.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>" +
      "<p:sldIdLst>" + slides.map(function (_, i) { return '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>'; }).join("") + "</p:sldIdLst>" +
      '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>' +
      "</p:presentation>";
    parts["ppt/slideMasters/slideMaster1.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      "<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"FFFFFF\"/></a:solidFill></p:bgPr></p:bg></p:cSld>" +
      "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>" +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>' +
      "</p:sldMaster>";
    parts["ppt/slideLayouts/slideLayout1.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">' +
      '<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>' +
      '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>' +
      "</p:sldLayout>";
    parts["ppt/theme/theme1.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="ExamPro"><a:themeElements>' +
      "<a:clrScheme name=\"ExamPro\"><a:dk1><a:srgbClr val=\"1F3A5F\"/></a:dk1><a:lt1><a:srgbClr val=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"44546A\"/></a:dk2><a:lt2><a:srgbClr val=\"E7E6E6\"/></a:lt2><a:accent1><a:srgbClr val=\"4472C4\"/></a:accent1><a:accent2><a:srgbClr val=\"ED7D31\"/></a:accent2><a:accent3><a:srgbClr val=\"A5A5A5\"/></a:accent3><a:accent4><a:srgbClr val=\"FFC000\"/></a:accent4><a:accent5><a:srgbClr val=\"5B9BD5\"/></a:accent5><a:accent6><a:srgbClr val=\"70AD47\"/></a:accent6><a:hlink><a:srgbClr val=\"0563C1\"/></a:hlink><a:folHlink><a:srgbClr val=\"954F72\"/></a:folHlink></a:clrScheme>" +
      '<a:fontScheme name="ExamPro"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="ExamPro"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle/></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
      "</a:themeElements></a:theme>";
    parts["ppt/presProps.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>';
    parts["ppt/viewProps.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:normalViewPr><p:restoredLeft sz="15625"/><p:restoredTop sz="9466"/></p:normalViewPr></p:viewPr>';
    parts["ppt/tableStyles.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>';
    parts["docProps/core.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<dc:title>ExamPro</dc:title><dc:creator>ExamPro</dc:creator></cp:coreProperties>";
    parts["docProps/app.xml"] =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ExamPro</Application></Properties>';

    function slideXml(s, i) {
      var paras = [];
      paras.push('<a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>' + xmlEscape("Q" + (i + 1) + " — " + s.title) + "</a:t></a:r></a:p>");
      paras.push('<a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>' + xmlEscape(s.question || "") + "</a:t></a:r></a:p>");
      (s.options || []).forEach(function (o) {
        paras.push('<a:p><a:r><a:rPr lang="en-US" sz="1600"/><a:t>' + xmlEscape(o) + "</a:t></a:r></a:p>");
      });
      paras.push('<a:p><a:r><a:rPr lang="en-US" sz="1600" b="1"/><a:t>' + xmlEscape("Answer: " + (s.answer || "—")) + "</a:t></a:r></a:p>");
      if (s.solution) paras.push('<a:p><a:r><a:rPr lang="en-US" sz="1400" i="1"/><a:t>' + xmlEscape("Solution: " + s.solution) + "</a:t></a:r></a:p>");
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="11277600" cy="5943600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
        "<p:txBody><a:bodyPr wrap=\"square\"/><a:lstStyle/>" + paras.join("") + "</p:txBody></p:sp>" +
        "</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/></p:clrMapOvr>" +
        "</p:sld>";
    }
    slides.forEach(function (s, i) {
      parts["ppt/slides/slide" + (i + 1) + ".xml"] = slideXml(s, i);
      parts["ppt/slides/_rels/slide" + (i + 1) + ".xml.rels"] = slideRels[i];
    });

    // Build ZIP (stored entries, no compression)
    var encoder = new TextEncoder();
    var entries = [];
    Object.keys(parts).forEach(function (name) {
      var data = encoder.encode(parts[name]);
      entries.push({ name: name, data: data, crc: crc32(data) });
    });
    var localOffset = 0;
    var central = [];
    var chunks = [];
    entries.forEach(function (e) {
      var nameBytes = encoder.encode(e.name);
      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034B50, true);
      dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true); dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true); dv.setUint16(14, 0, true);
      dv.setUint32(16, e.crc, true);
      dv.setUint32(20, e.data.length, true); dv.setUint32(24, e.data.length, true);
      dv.setUint16(28, nameBytes.length, true); dv.setUint16(30, 0, true);
      lh.set(nameBytes, 30);
      chunks.push(lh, e.data);
      central.push({ e: e, off: localOffset, nameBytes: nameBytes });
      localOffset += lh.length + e.data.length;
    });
    var cdStart = localOffset;
    var cdChunks = [];
    central.forEach(function (c) {
      var ch = new Uint8Array(46 + c.nameBytes.length);
      var dv = new DataView(ch.buffer);
      dv.setUint32(0, 0x02014B50, true);
      dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, 0x0800, true); dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true); dv.setUint16(14, 0, true);
      dv.setUint32(16, c.e.crc, true);
      dv.setUint32(20, c.e.data.length, true); dv.setUint32(24, c.e.data.length, true);
      dv.setUint16(28, c.nameBytes.length, true);
      dv.setUint32(42, c.off, true);
      ch.set(c.nameBytes, 46);
      cdChunks.push(ch);
    });
    var cdLen = cdChunks.reduce(function (n, c) { return n + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054B50, true);
    edv.setUint16(8, entries.length, true); edv.setUint16(10, entries.length, true);
    edv.setUint32(12, cdLen, true); edv.setUint32(16, cdStart, true);
    chunks.push.apply(chunks, cdChunks);
    chunks.push(eocd);
    var blob = new Blob(chunks, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------------------------
  // PDF export (jsPDF vendored at src/vendor/jspdf.umd.min.js).
  // A4 pages with institution branding; paper / answer-key / solutions variants.
  // ---------------------------------------------------------------------------
  EP.pdf = (function () {
  
  // A4 Print CSS (for print functionality)
  const a4PrintCSS = `
    @media print {
      @page {
        size: A4;
        margin: 15mm;
      }
      body {
        margin: 0;
        padding: 0;
      }
      .page {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .no-print {
        display: none !important;
      }
      .print-only {
        display: block !important;
      }
    }
    
    @page :first {
      margin-top: 0;
    }
    
    @page :last {
      margin-bottom: 0;
    }
    
    /* Hide UI elements when printing */
    .sidebar, .topbar, .bottom-nav, .stat-grid, .toolbar, .btn-row, .no-print {
      display: none !important;
    }
    
    /* Ensure content fills the page */
    .page {
      min-height: 100%;
      page-break-after: always;
    }
    
    /* Hide empty pages */
    .empty-page {
      display: none;
    }
    
    /* Print-specific styles */
    .paper-container {
      box-shadow: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    
    .question-block {
      page-break-inside: avoid;
    }
    
    .option-block {
      page-break-inside: avoid;
    }
    
    .solution-block {
      page-break-inside: avoid;
    }
    
    /* Ensure images don't break across pages */
    .diagram img, .question-image img {
      page-break-inside: avoid;
      max-width: 100%;
      height: auto;
    }
    
    /* Page numbers */
    .page-number {
      position: fixed;
      bottom: 10mm;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 8pt;
      color: #666;
    }
    
    /* Headers and footers */
    .print-header, .print-footer {
      position: fixed;
      width: 100%;
      left: 0;
      padding: 5mm;
    }
    
    .print-header {
      top: 0;
      border-bottom: 1px solid #ccc;
      background: white;
    }
    
    .print-footer {
      bottom: 0;
      border-top: 1px solid #ccc;
      background: white;
    }
    
    /* Tables */
    table {
      border-collapse: collapse;
      width: 100%;
    }
    
    th, td {
      border: 1px solid #ddd;
      padding: 4px;
      text-align: left;
    }
    
    /* Lists */
    ul, ol {
      padding-left: 20px;
    }
    
    /* Code blocks */
    pre, code {
      font-family: monospace;
      font-size: 9pt;
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 2px;
    }
    
    /* Prevent widows and orphans */
    h1, h2, h3, h4, h5, h6 {
      orphans: 2;
      widows: 2;
    }
    
    p, div {
      orphans: 2;
      widows: 2;
    }
    
    /* Print-friendly colors */
    * {
      color: #000 !important;
      background: #fff !important;
    }
    
    /* Hide QR codes and other non-print elements */
    .qr-code, .watermark, .decorative {
      display: none !important;
    }
  `;
  
  // Inject A4 print CSS into the document head
  function injectA4PrintCSS() {
    if (typeof document !== "undefined") {
      const style = document.createElement("style");
      style.setAttribute("type", "text/css");
      style.setAttribute("media", "print");
      style.textContent = a4PrintCSS;
      document.head.appendChild(style);
    }
  }
  
  // Auto-inject when PDF is being generated
  injectA4PrintCSS();
    function stripHtml(s) {
      if (!s) return "";
      return String(s)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .trim();
    }
    function makeDoc() {
      var g = window.jspdf;
      if (!g || !g.jsPDF) return null;
      return new g.jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    }
    function sanitizeName(s) {
      return String(s || "document").replace(/[^\w\-. ]+/g, "").replace(/\s+/g, "-").slice(0, 80) || "document";
    }
    function stampFooters(doc, text) {
      var total = doc.internal.getNumberOfPages();
      for (var i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(120, 128, 140);
        doc.text(stripHtml(text || "") + " · Page " + i + " of " + total, 105, 292, { align: "center" });
      }
    }
    function header(doc, branding, title, meta) {
      var y = 18;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(31, 58, 95);
      doc.text(stripHtml((branding && branding.name) || "ExamPro"), 15, y);
      y += 7;
      doc.setFontSize(13);
      doc.setTextColor(20, 30, 45);
      doc.text(stripHtml(title || ""), 15, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110, 120, 130);
      doc.text(stripHtml(meta || ""), 15, y);
      y += 4;
      doc.setDrawColor(31, 58, 95);
      doc.setLineWidth(0.6);
      doc.line(15, y, 195, y);
      return y + 7;
    }
    function write(doc, text, x, y, o) {
      o = o || {};
      var fs = o.size || 10;
      var lineH = o.lineHeight || fs * 1.45;
      var maxW = o.width || 175;
      var maxY = o.maxY || 278;
      var lines = doc.splitTextToSize(stripHtml(text), maxW);
      doc.setFont("helvetica", o.style || "normal");
      doc.setFontSize(fs);
      var c = o.color || [30, 40, 60];
      doc.setTextColor(c[0], c[1], c[2]);
      for (var i = 0; i < lines.length; i++) {
        if (y + lineH > maxY) { doc.addPage(); y = o.marginTop || 22; }
        doc.text(lines[i], x, y);
        y += lineH;
      }
      return y;
    }
    function answerOf(item) {
      var a = item && item.answer;
      if (!a) return "";
      return stripHtml((a.correct_option_keys || []).join(", ") || a.numerical_answer || a.answer_text || "");
    }
    function solutionOf(item) {
      var s = item && item.solution;
      if (!s) return "";
      return stripHtml(s.solution_text || s.detailed_solution || s.short_solution || (s.concept ? "Concept: " + s.concept : ""));
    }
    function renderQuestionBlock(doc, item, idx, y) {
      var sn = item || {};
      y = write(doc, "Q" + (sn.order || idx + 1) + ". " + (sn.question_text || ""), 15, y, { size: 10, style: "bold" });
      y += 1.5;
      if (sn.options && sn.options.length) {
        y = write(doc, sn.options.map(function (o) { return o.option_key + ". " + o.option_text; }).join("\n"), 18, y, { size: 9.5, style: "normal" });
        y += 1.5;
      }
      return y + 2;
    }
    function save(doc, name) {
      var blob = doc.output("blob");
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    return {
      downloadPaper: function (cfg) {
        var doc = makeDoc();
        if (!doc) { EP.toast("PDF engine not loaded", "error"); return; }
        var paper = cfg.paper || {}, items = cfg.items || [], branding = cfg.branding || null, kind = cfg.kind || "paper";
        var inst = (branding && branding.name) || "ExamPro";
        var title = paper.title || "Paper";
        var meta = "Duration: " + (paper.duration_minutes || "—") + " min · Total Marks: " + (paper.total_marks || "—") + " · Questions: " + (paper.total_questions != null ? paper.total_questions : items.length);
        var y = header(doc, branding, title, meta);
        if (kind === "answer-key") {
          y = write(doc, "ANSWER KEY", 15, y, { size: 11, style: "bold" });
          y += 3;
          for (var i = 0; i < items.length; i++) {
            var ans = answerOf(items[i]);
            y = write(doc, "Q" + (items[i].order || i + 1) + ".  " + (ans || "—"), 15, y, { size: 10 });
            y += 1.5;
          }
          stampFooters(doc, inst + " · " + title + " · Answer Key");
          save(doc, sanitizeName(title) + "-answer-key.pdf");
          return;
        }
        if (kind === "solutions") {
          y = write(doc, "SOLUTIONS", 15, y, { size: 11, style: "bold" });
          y += 3;
          for (var j = 0; j < items.length; j++) {
            var sol = solutionOf(items[j]);
            var a2 = answerOf(items[j]);
            y = write(doc, "Q" + (items[j].order || j + 1) + ".  Answer: " + (a2 || "—"), 15, y, { size: 10, style: "bold" });
            y += 1;
            y = write(doc, sol || "No solution provided.", 18, y, { size: 9.5 });
            y += 3;
          }
          stampFooters(doc, inst + " · " + title + " · Solutions");
          save(doc, sanitizeName(title) + "-solutions.pdf");
          return;
        }
        // paper
        if (paper.instructions) {
          y = write(doc, "Instructions: " + paper.instructions, 15, y, { size: 9.5, style: "italic", color: [80, 90, 105] });
          y += 3;
        }
        for (var k = 0; k < items.length; k++) {
          y = renderQuestionBlock(doc, items[k], k, y);
        }
        stampFooters(doc, inst + " · " + title);
        save(doc, sanitizeName(title) + ".pdf");
      }
    };
  })();

  EP.fmtMarks = function (n) {
    if (n === null || n === undefined || isNaN(n)) return "0";
    return Number(n).toLocaleString();
  };
  EP.qs = function (sel, root) { return (root || document).querySelector(sel); };
  EP.qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  EP.toast = function (msg, type) {
    type = type || "info";
    let host = EP.qs("#toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      document.body.appendChild(host);
    }
    const t = document.createElement("div");
    t.className = "toast toast-" + type;
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 10);
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 300);
    }, 3500);
  };

  EP.spinner = function (label) {
    return (
      '<div class="loading"><div class="spinner"></div>' +
      (label ? "<p>" + EP.esc(label) + "</p>" : "") +
      "</div>"
    );
  };

  EP.modal = function (title, bodyHtml, actions) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + EP.esc(title) + '">' +
      '<div class="modal-head"><h3>' + EP.esc(title) + '</h3>' +
      '<button class="icon-btn" data-close aria-label="Close">&times;</button></div>' +
      '<div class="modal-body">' + bodyHtml + "</div>" +
      '<div class="modal-foot">' + (actions || "") + "</div></div>";
    document.body.appendChild(overlay);
    const dismiss = function (e) {
      if (!e || e.target === overlay || e.target.hasAttribute("data-close")) {
        EP.closeModal(overlay);
      }
    };
    overlay.addEventListener("click", dismiss);
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") dismiss();
    });
    const first = overlay.querySelector("input, select, textarea, button:not([data-close])");
    if (first) setTimeout(function () { first.focus(); }, 30);
    return overlay;
  };

  // Closes the open modal (or a specific overlay). No-op when none is open.
  EP.closeModal = function (overlay) {
    const el = overlay || document.querySelector(".modal-overlay");
    if (el) el.remove();
  };
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      const open = document.querySelector(".modal-overlay");
      if (open && !e.defaultPrevented) EP.closeModal(open);
    }
  });

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  EP.auth = {
    async getSession() {
      const sb = EP.getClient();
      if (!sb) return null;
      const { data, error } = await sb.auth.getSession();
      if (error && error.message) {
        if (!EP._oauthErrShown && EP.state.oauthError !== error.message) {
          EP._oauthErrShown = true;
          EP.toast("Sign-in failed: " + error.message, "error");
          EP.secLog("OAUTH_ERROR", JSON.stringify({ message: error.message }));
        }
        EP.state.oauthError = error.message;
      } else {
        EP.state.oauthError = null;
        EP._oauthErrShown = false;
      }
      return data.session;
    },
    validatePassword(pw) {
      if (!pw || pw.length < 8) return "Password must be at least 8 characters";
      if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter";
      if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter";
      if (!/[0-9]/.test(pw)) return "Password must contain a number";
      if (!/[^A-Za-z0-9]/.test(pw)) return "Password must contain a special character";
      return null;
    },
    async signUp(email, password, fullName) {
      const sb = EP.getClient();
      const pwErr = EP.auth.validatePassword(password);
      if (pwErr) throw new Error(pwErr);
      const { data, error } = await sb.auth.signUp({
        email, password, options: { data: { full_name: fullName } },
      });
      if (error) throw error;
      return data;
    },
    async signIn(email, password) {
      const sb = EP.getClient();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async signInWithGoogle() {
      const sb = EP.getClient();
      const allowed = [window.location.origin];
      const cfg = EP.loadConfig();
      if (cfg.url && cfg.url !== window.location.origin) allowed.push(cfg.url);
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: allowed[0],
          queryParams: { prompt: "select_account" }
        },
      });
      if (error) throw error;
    },
    async linkIdentity(provider) {
      const sb = EP.getClient();
      if (!sb || !EP.state.user) throw new Error("Not authenticated");
      const { error } = await sb.auth.linkIdentity({ provider: provider });
      if (error) throw error;
    },
    async unlinkIdentity(provider) {
      const sb = EP.getClient();
      if (!sb || !EP.state.user) throw new Error("Not authenticated");
      const result = await sb.auth.getUserIdentities();
      const identities = result && result.data ? result.data.identities : [];
      const target = Array.isArray(identities) ? identities.find(function (i) { return i.provider === provider; }) : undefined;
      if (!target) return;
      const { error } = await sb.auth.unlinkIdentity(target);
      if (error) throw error;
    },
    async getIdentities() {
      const sb = EP.getClient();
      if (!sb) return [];
      try {
        const result = await sb.auth.getUserIdentities();
        const arr = result && result.data ? result.data.identities : null;
        return Array.isArray(arr) ? arr : [];
      } catch (_) { return []; }
    },
    async signOut() {
      const sb = EP.getClient();
      await sb.auth.signOut();
    },
    async reset(email) {
      const sb = EP.getClient();
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/#/auth/reset",
      });
      if (error) throw error;
    },
    async updatePassword(pw) {
      const sb = EP.getClient();
      const pwErr = EP.auth.validatePassword(pw);
      if (pwErr) throw new Error(pwErr);
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
    },
    async resendVerification(email) {
      const sb = EP.getClient();
      const { error } = await sb.auth.resend({ email, type: "signup" });
      if (error) throw error;
    },
  };

  // ---------------------------------------------------------------------------
  // Identity resolution (server truth: tenant_memberships -> roles -> permissions)
  // ---------------------------------------------------------------------------
  // Serialized: auth callbacks and EP.render() can both trigger loadIdentity;
  // concurrent runs would render the shell with a partially-populated state
  // (user set, permissions not yet). Concurrent callers share one in-flight load.
  let identityPromise = null;
  async function loadIdentity(user) {
    if (identityPromise) return identityPromise;
    identityPromise = (async function () {
      const sb = EP.getClient();
      const s = EP.state;
      s.user = user;
      s.profile = null; s.membership = null; s.role = null; s.isSuper = false; s.tenantId = null; s.permissions = new Set();

      const { data: prof } = await sb
        .from("profiles").select("*").eq("auth_user_id", user.id).maybeSingle();
      s.profile = prof;

      const { data: mem } = await sb
        .from("tenant_memberships")
        .select("id, tenant_id, role_id, status, roles(id, code, name)")
        .eq("user_id", user.id).eq("status", "ACTIVE")
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (mem) {
        s.membership = mem;
        s.tenantId = mem.tenant_id;
        s.role = mem.roles ? mem.roles.code : null;
      }

      const { data: sup } = await sb
        .from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
      s.isSuper = !!sup;

      if (mem && mem.role_id) {
        const { data: perms } = await sb
          .from("role_permissions")
          .select("permission_code").eq("role_id", mem.role_id);
        (perms || []).forEach(function (p) { s.permissions.add(p.permission_code); });
      }
      if (s.isSuper) {
        const { data: all } = await sb.from("permissions").select("code");
        (all || []).forEach(function (p) { s.permissions.add(p.code); });
        // Kick off Google Drive connection status (OAuth-first, Supabase fallback).
        EP.initializeGoogleDrive();
      }
    })().finally(function () { identityPromise = null; });
    return identityPromise;
  }
  EP.can = function (perm) { return EP.state.permissions.has(perm); };
  EP.hasRole = function (roles) {
    if (EP.state.isSuper) return true;
    return roles.indexOf(EP.state.role) !== -1;
  };

  // Records a security/audit event server-side (best-effort; never blocks UI).
  EP.secLog = async function (eventType, detail) {
    const sb = EP.getClient();
    if (!sb || !EP.state.user) return;
    try { await sb.rpc("app_log_security_event", { p_event_type: eventType, p_detail: detail || null }); } catch (_) {}
  };

  // Broad role buckets used to branch dashboard / UX (authorization itself is
  // always permission-based; these are conveniences for rendering).
  EP.roleType = function () {
    const s = EP.state;
    if (s.isSuper) return "super";
    const r = s.role || "";
    if (r === "STUDENT" || r === "PARENT") return "student";
    if (r === "FINANCE" || r === "SALES" || r === "SUPPORT") return "finance";
    return "staff";
  };

  // ---------------------------------------------------------------------------
  // Centralized role -> landing-route resolver (production redirects).
  // Every post-auth redirect (login, signup, OAuth callback, password update)
  // must route through here so landings stay in sync with the role model.
  // Falls back to an accessible route instead of dropping a user onto an
  // access-denied page right after a successful login.
  // ---------------------------------------------------------------------------
  EP.roleDashboard = function () {
    const s = EP.state;
    const role = s.isSuper ? "SUPER_ADMIN" : (s.role || "");
    const preferred = {
      "SUPER_ADMIN": "/dashboard",
      "PLATFORM_ADMIN": "/dashboard",
      "INSTITUTION_ADMIN": "/institution",
      "ACADEMIC_ADMIN": "/institution",
      "TEACHER": "/dashboard",
      "SUBJECT_TEACHER": "/dashboard",
      "PAPER_SETTER": "/papers",
      "REVIEWER": "/questions",
      "QUESTION_REVIEWER": "/questions",
      "CONTENT_EDITOR": "/dashboard",
      "DATA_OPERATOR": "/dashboard",
      "STUDENT": "/dashboard",
      "PARENT": "/dashboard",
      "FINANCE": "/reports",
      "SALES": "/reports",
      "SUPPORT": "/dashboard",
    }[role] || "/dashboard";
    if (EP.canAccess(preferred)) return preferred;
    if (EP.canAccess("/dashboard")) return "/dashboard";
    return "/auth";
  };

  // Unread notification count for the topbar bell (RLS-scoped to the user).
  EP.unreadCount = async function () {
    const sb = EP.getClient();
    if (!sb || !EP.state.user) return 0;
    const { count, error } = await sb
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("recipient_user_id", EP.state.user.id)
      .eq("is_read", false);
    return error ? 0 : (count || 0);
  };

  // ---------------------------------------------------------------------------
  // i18n (lightweight, EN/HI/GU; more languages plug in via EP.i18n.strings)
  // ---------------------------------------------------------------------------
  EP.i18n = {
    current: "en",
    strings: {
      en: { dashboard: "Dashboard", practice: "Practice", questions: "Question Bank", papers: "Papers", dpp: "DPP", exams: "Exams", results: "Results", bookmarks: "Bookmarks", mistakes: "Mistakes", omr: "OMR", analytics: "Analytics", reports: "Reports", admin: "Admin", settings: "Settings", logout: "Log out", login: "Login", signup: "Sign up", email: "Email", password: "Password", fullName: "Full name", submit: "Submit", cancel: "Cancel", save: "Save", delete: "Delete", edit: "Edit", back: "Back", search: "Search", filter: "Filter", generate: "Generate", print: "Print", export: "Export", loading: "Loading…", noData: "No data found.", error: "Error", success: "Success", warning: "Warning", info: "Info", confirm: "Confirm", yes: "Yes", no: "No" },
      hi: { dashboard: "डैशबोर्ड", practice: "अभ्यास", questions: "प्रश्न बैंक", papers: "पेपर", dpp: "डीपीपी", exams: "परीक्षा", results: "परिणाम", bookmarks: "बुकमार्क", mistakes: "गलतियाँ", omr: "ओएमआर", analytics: "विश्लेषण", reports: "रिपोर्ट", admin: "प्रशासन", settings: "सेटिंग", logout: "लॉग आउट", login: "लॉग इन", signup: "साइन अप", email: "ईमेल", password: "पासवर्ड", fullName: "पूरा नाम", submit: "जमा करें", cancel: "रद्द करें", save: "सहेजें", delete: "हटाएं", edit: "संपादित करें", back: "वापस", search: "खोजें", filter: "फ़िल्टर", generate: "उत्पन्न करें", print: "प्रिंट", export: "निर्यात", loading: "लोड हो रहा है…", noData: "कोई डेटा नहीं मिला।", error: "त्रुटि", success: "सफलता", warning: "चेतावनी", info: "जानकारी", confirm: "पुष्टि करें", yes: "हां", no: "नहीं" },
      gu: { dashboard: "ડેશબોર્ડ", practice: "અભ્યાસ", questions: "પ્રશ્ન બેંક", papers: "પેપર", dpp: "ડીપીપી", exams: "પરીક્ષા", results: "પરિણામ", bookmarks: "બુકમાર્ક", mistakes: "ભૂલો", omr: "ઓએમઆર", analytics: "વિશ્લેષણ", reports: "રિપોર્ટ", admin: "પ્રશાસન", settings: "સેટિંગ", logout: "લોગ આઉટ", login: "લોગ ઇન", signup: "સાઇન અપ", email: "ઇમેઇલ", password: "પાસવર્ડ", fullName: "પૂરું નામ", submit: "સબમિટ", cancel: "રદ કરો", save: "સાચવો", delete: "કાઢી નાઓ", edit: "એડિટ", back: "પાછળ", search: "શોધો", filter: "ફિલ્ટર", generate: "જનરેટ", print: "પ્રિન્ટ", export: "નિર્યાત", loading: "લોડ થઈ રહ્યું છે…", noData: "કોઈ ડેટા મળ્યો નથી.", error: "ભૂલ", success: "સફળતા", warning: "ચેતવણી", info: "માહિતી", confirm: "પુષ્ટિ", yes: "હા", no: "નહી" }
    },
    t: function (key) {
      const lang = EP.i18n.current || "en";
      const dict = EP.i18n.strings[lang] || EP.i18n.strings.en;
      return dict[key] || EP.i18n.strings.en[key] || key;
    },
    set: function (lang) {
      if (!EP.i18n.strings[lang]) lang = "en";
      EP.i18n.current = lang;
      try { localStorage.setItem("exampro_lang", lang); } catch (_) {}
      EP.render();
    }
  };
  try {
    const savedLang = localStorage.getItem("exampro_lang");
    if (savedLang && EP.i18n.strings[savedLang]) EP.i18n.current = savedLang;
  } catch (_) {}
  // UI-label lookup for the navigation model (falls back to English).
  EP.navLabel = function (label) {
    const map = {
      "Dashboard": "dashboard", "Practice": "practice", "Question Bank": "questions",
      "Papers": "papers", "DPP": "dpp", "Exams": "exams", "Results": "results",
      "Bookmarks": "bookmarks", "Mistakes": "mistakes", "OMR": "omr",
      "Analytics": "analytics", "Reports": "reports", "Admin": "admin",
      "Settings": "settings",
    };
    return EP.i18n.t(map[label] || label);
  };
  // Per-browser notification preferences (default: all types on).
  EP.loadNotifPrefs = function () {
    try { return JSON.parse(localStorage.getItem("exampro_notif_prefs") || "{}") || {}; }
    catch (_) { return {}; }
  };
  EP.saveNotifPrefs = function (prefs) {
    try { localStorage.setItem("exampro_notif_prefs", JSON.stringify(prefs)); } catch (_) {}
  };
  EP.notifTypeEnabled = function (type) {
    return EP.loadNotifPrefs()[type] !== false;
  };
  EP.ai = {
    LS_KEY: "exampro_openrouter_key",
    getApiKey: function () {
      try { return localStorage.getItem(EP.ai.LS_KEY) || ""; }
      catch (_) { return ""; }
    },
    setApiKey: function (k) {
      localStorage.setItem(EP.ai.LS_KEY, k || "");
    },
    freeModels: [
      { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash (free)" },
      { id: "meta-llama/llama-4-maverick:free", name: "Llama 4 Maverick (free)" },
      { id: "mistralai/mistral-small-3.1-24b-instruct:free", name: "Mistral Small 3.1 24B (free)" },
      { id: "qwen/qwen3-235b-a22b:free", name: "Qwen3 235B (free)" },
      { id: "qwen/qwen3-30b-a3b:free", name: "Qwen3 30B (free)" },
      { id: "nousresearch/hermes-3-llama-3.2-3b:free", name: "Hermes 3 3B (free)" },
    ],
    chat: async function (messages, model) {
      const key = EP.ai.getApiKey();
      if (!key) throw new Error("OpenRouter API key not configured");
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + key,
          "HTTP-Referer": window.location.origin,
          "X-Title": "ExamPro AI Tutor",
        },
        body: JSON.stringify({ model: model, messages: messages }),
      });
      if (!res.ok) {
        const err = await res.json().catch(function () { return {}; });
        throw new Error(err.error && err.error.message ? err.error.message : "OpenRouter request failed (" + res.status + ")");
      }
      const data = await res.json();
      return data.choices && data.choices[0] ? data.choices[0].message.content : "";
    },
  };

  // ---------------------------------------------------------------------------
  // Navigation model (role-aware)
  // ---------------------------------------------------------------------------
  EP.nav = function () {
    const items = [
      { path: "/dashboard", label: "Dashboard", icon: "▦", roles: ["*"] },
      { path: "/practice", label: "Practice", icon: "🎯", roles: ["STUDENT","PARENT","TEACHER","SUBJECT_TEACHER","PAPER_SETTER","REVIEWER","DATA_OPERATOR","PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","SUPER_ADMIN"] },
      { path: "/questions", label: "Question Bank", icon: "❓", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","TEACHER","SUBJECT_TEACHER","PAPER_SETTER","REVIEWER","DATA_OPERATOR","SUPER_ADMIN"] },
      { path: "/papers", label: "Papers", icon: "📄", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","TEACHER","PAPER_SETTER","STUDENT","SUPER_ADMIN"] },
      { path: "/dpp", label: "DPP", icon: "🗓", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","TEACHER","STUDENT","SUPER_ADMIN"] },
      { path: "/exams", label: "Exams", icon: "✍", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","TEACHER","STUDENT","SUPER_ADMIN"] },
      { path: "/results", label: "Results", icon: "📊", roles: ["*"] },
      { path: "/bookmarks", label: "Bookmarks", icon: "⭐", roles: ["STUDENT","PARENT","TEACHER","SUBJECT_TEACHER","PAPER_SETTER","REVIEWER","DATA_OPERATOR","PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","SUPER_ADMIN"] },
      { path: "/mistakes", label: "Mistakes", icon: "📝", roles: ["STUDENT","PARENT","TEACHER","SUBJECT_TEACHER","PAPER_SETTER","REVIEWER","DATA_OPERATOR","PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","SUPER_ADMIN"] },
      { path: "/omr", label: "OMR", icon: "▣", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","TEACHER","PAPER_SETTER","SUPER_ADMIN"] },
      { path: "/analytics", label: "Analytics", icon: "📈", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","TEACHER","SUPER_ADMIN"] },
      { path: "/reports", label: "Reports", icon: "📋", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","TEACHER","FINANCE","SALES","SUPPORT","SUPER_ADMIN"] },
      { path: "/admin", label: "Admin", icon: "⚙", roles: ["SUPER_ADMIN","PLATFORM_ADMIN"] },
      { path: "/admin/ingestion", label: "Ingestion", icon: "🗂", roles: ["SUPER_ADMIN","PLATFORM_ADMIN"] },
      { path: "/admin/official-pyq", label: "Official PYQ", icon: "📚", roles: ["SUPER_ADMIN","PLATFORM_ADMIN"] },
      { path: "/admin/sources", label: "Official Sources", icon: "🌐", roles: ["SUPER_ADMIN","PLATFORM_ADMIN"] },
      { path: "/admin/syllabus", label: "Syllabus Versions", icon: "📗", roles: ["SUPER_ADMIN","PLATFORM_ADMIN"] },
      { path: "/admin/ingestion/answerkey", label: "Answer Key", icon: "🔑", roles: ["SUPER_ADMIN","PLATFORM_ADMIN"] },
      { path: "/admin/solutions/queue", label: "Solution Queue", icon: "🧠", roles: ["SUPER_ADMIN","PLATFORM_ADMIN","REVIEWER","DATA_OPERATOR"] },
      { path: "/admin/solutions/review", label: "AI Review", icon: "✅", roles: ["SUPER_ADMIN","PLATFORM_ADMIN","REVIEWER","DATA_OPERATOR"] },
      { path: "/institution", label: "Institution", icon: "🏫", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","SUPER_ADMIN"] },
      { path: "/ai-tutor", label: "AI Tutor", icon: "🤖", roles: ["*"] },
      { path: "/formulas", label: "Formulas", icon: "∑", roles: ["*"] },
      { path: "/settings", label: "Settings", icon: "👤", roles: ["*"] },
      { path: "/assignments", label: "Assignments", icon: "📌", roles: ["PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","TEACHER","SUPER_ADMIN"] },
      { path: "/weak-topics", label: "Weak Topics", icon: "📉", roles: ["STUDENT","PARENT","TEACHER","SUBJECT_TEACHER","PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","SUPER_ADMIN"] },
      { path: "/revision", label: "Revision", icon: "🔄", roles: ["STUDENT","PARENT","TEACHER","SUBJECT_TEACHER","PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","SUPER_ADMIN"] },
      { path: "/exam-tracker", label: "Exam Tracker", icon: "⏱", roles: ["STUDENT","PARENT","TEACHER","SUBJECT_TEACHER","PLATFORM_ADMIN","INSTITUTION_ADMIN","ACADEMIC_ADMIN","SUPER_ADMIN"] },
    ];
    return items.filter(function (it) {
      if (it.roles.indexOf("*") !== -1) return true;
      return EP.hasRole(it.roles);
    }).map(function (it) {
      return { path: it.path, label: EP.navLabel(it.label), icon: it.icon, roles: it.roles };
    });
  };

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------
  EP.routes = {};
  EP.register = function (path, fn) { EP.routes[path] = fn; };

  EP.currentPath = function () {
    let h = window.location.hash || "#/dashboard";
    h = h.replace(/^#/, "");
    h = h.split("?")[0];
    if (!h.startsWith("/")) h = "/" + h;
    return h;
  };

  EP.navigate = function (path) {
    if (window.location.hash === "#" + path) { EP.render(); }
    else { window.location.hash = path; }
  };

  async function requireAuth() {
    // OAuth (Google) redirect-back failures carry error params in the URL.
    // Surface them once, then clean the URL so the next render doesn't repeat.
    if (typeof URLSearchParams !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const oerr = params.get("error_description") || params.get("error");
      if (oerr && !EP._oauthErrShown) {
        EP._oauthErrShown = true;
        EP.toast("Google sign-in failed: " + oerr, "error");
        EP.secLog("OAUTH_ERROR", JSON.stringify({ error: params.get("error"), description: oerr }));
        if (window.history && window.history.replaceState) {
          const u = new URL(window.location.href);
          ["error", "error_description", "error_code", "code", "state"].forEach(function (k) { u.searchParams.delete(k); });
          window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
        }
      } else if (!oerr) {
        EP._oauthErrShown = false;
      }
    }
    let session = await EP.auth.getSession();
    if (!session) return false;
    // Identity is serialized: if a load is already in-flight (auth callback +
    // render racing), join it instead of rendering with a half-populated state.
    if (identityPromise) { await identityPromise; return true; }
    if (!EP.state.user || EP.state.user.id !== session.user.id) {
      await loadIdentity(session.user);
    }
    return true;
  }

  EP.render = async function () {
    if (EP._rendering) { EP._rerender = true; return; }
    EP._rendering = true;
    try {
      // OAuth failure callbacks land on the app origin with query params
      // (?error=...&error_description=...&sb=...). Surface a clear toast,
      // record the event, and strip the params so a retry starts clean.
      try {
        const u = new URL(window.location.href);
        const desc = u.searchParams.get("error_description") || u.searchParams.get("error");
        if (desc && !EP.state.oauthError) {
          EP.state.oauthError = desc;
          EP.toast("Sign-in failed: " + desc.slice(0, 200), "error");
          EP.secLog("OAUTH_ERROR", JSON.stringify({ message: desc.slice(0, 200) }));
        }
        if (u.searchParams.has("error") || u.searchParams.has("error_code") || u.searchParams.has("error_description")) {
          u.search = "";
          history.replaceState({}, "", u.toString());
        }
      } catch (_) {}
      do {
        EP._rerender = false;
        const path = EP.currentPath();
        const sb = EP.getClient();
        if (!sb) { EP.renderSetup(); continue; }
        if (path === "/unauthorized") { EP.renderUnauthorized(); continue; }
        let authed = await requireAuth();
        if (!authed) { EP.renderAuth(); continue; }
        if (path === "/auth" || path === "/setup") {
          EP.navigate(EP.roleDashboard()); continue;
        }
        if (path === "/auth/callback") {
          if (authed) {
            const prof = EP.state.profile;
            if (prof && !prof.email_verified_at) EP.navigate("/verify-email");
            else EP.navigate(EP.roleDashboard());
            continue;
          }
          EP.renderAuth(); continue;
        }
        if (path === "/auth/reset" || path === "/verify-email" || path === "/forgot-password") {
          EP.renderAuth(); continue;
        }
        await EP.renderShell(path);
      } while (EP._rerender);
    } finally {
      EP._rendering = false;
    }
  };

  // ... shell + pages are registered in pages section (loaded after this file)
  window.addEventListener("hashchange", function () { EP.render(); });

  // ---------------------------------------------------------------------------
  // Google Drive storage provider integration
  // All Drive operations go through Supabase Edge Functions.
  // No Google credentials are ever exposed to the browser.
  // ---------------------------------------------------------------------------
  let googleDriveStatus = { connected: false, initializing: false, error: null };

  EP.initializeGoogleDrive = async function () {
    if (!EP.state.isSuper && EP.roleType() !== 'super') return false;
    if (googleDriveStatus.initializing || googleDriveStatus.connected) return googleDriveStatus.connected;
    // Honest gating: the Drive edge functions may not be deployed yet. Probing an
    // undeployed function 404s at the gateway (CORS preflight failure + console
    // noise). The deploy script flips system_config.edge_functions_available once
    // functions are live; until then we report "not deployed" without faking a
    // connection or hammering a dead endpoint.
    if (EP.state.edgeFunctionsAvailable === undefined) {
      try {
        const sb = EP.getClient();
        const { data: cfg } = sb
          ? await sb.from("system_config").select("value").eq("key", "edge_functions_available").maybeSingle()
          : { data: null };
        const v = cfg && cfg.value;
        EP.state.edgeFunctionsAvailable = !!v && (v === true || v.enabled === true || v === "true");
      } catch (_) {
        EP.state.edgeFunctionsAvailable = false;
      }
      if (!EP.state.edgeFunctionsAvailable) {
        googleDriveStatus = { connected: false, initializing: false, available: false, error: null, reason: "functions-not-deployed" };
        return false;
      }
    } else if (!EP.state.edgeFunctionsAvailable) {
      googleDriveStatus = { connected: false, initializing: false, available: false, error: null, reason: "functions-not-deployed" };
      return false;
    }
    googleDriveStatus.initializing = true;
    try {
      const sb = EP.getClient();
      if (!sb) return false;
      const { data, error } = await sb.functions.invoke("google-drive-oauth", { body: { action: "status" } });
      if (error || !data) throw new Error(data?.error || error?.message || "Drive status check failed");
      googleDriveStatus = {
        connected: !!data.connected,
        initializing: false,
        available: true,
        error: data.connected ? null : 'Google Drive not connected',
        account: data.account,
      };
      // If connected, also fetch live health/stats (best-effort).
      if (data.connected) {
        try {
          const h = await sb.functions.invoke("drive-health");
          if (h.data) {
            googleDriveStatus.stats = h.data.stats;
            googleDriveStatus.rootFolder = h.data.rootFolder;
            googleDriveStatus.lastVerifiedAt = h.data.checkedAt || new Date().toISOString();
          }
        } catch (_) { /* non-fatal */ }
      }
      return googleDriveStatus.connected;
    } catch (error) {
      googleDriveStatus = {
        connected: false,
        initializing: false,
        available: true,
        error: error.message || 'Unknown error initializing Google Drive',
      };
      return false;
    } finally {
      googleDriveStatus.initializing = false;
    }
  };

  // Starts the Google Drive OAuth consent flow (redirects the browser to
  // Google). ONLY ever called from an explicit user click — page loads never
  // trigger OAuth. Single-flight guarded (no double redirects) and bounded by
  // a 10s timeout so a hung request can never leave "Redirecting…" forever.
  let oauthStartInFlight = false;
  EP.connectGoogleDrive = async function () {
    if (oauthStartInFlight) return false;
    const sb = EP.getClient();
    if (!sb) { EP.toast('Supabase not configured', 'error'); return false; }
    oauthStartInFlight = true;
    try {
      const invoke = sb.functions.invoke("google-drive-oauth", { body: { action: "start" } });
      const timeout = new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('Google Drive auth request timed out')); }, 10000);
      });
      const { data, error } = await Promise.race([invoke, timeout]);
      if (error || !data || !data.url) {
        EP.toast(error?.message || data?.error || 'Failed to start Google Drive auth', 'error');
        return false;
      }
      window.location.href = data.url;
      return true;
    } catch (e) {
      EP.toast(e.message || 'Failed to start Google Drive auth', 'error');
      return false;
    } finally {
      oauthStartInFlight = false;
    }
  };

  // Disconnect: clears the stored OAuth token for the current admin's tenant.
  EP.disconnectGoogleDrive = async function () {
    const sb = EP.getClient();
    if (!sb) return false;
    const { error } = await sb.functions.invoke("google-drive-oauth", { body: { action: "disconnect" } });
    if (error) { EP.toast(error.message || 'Failed to disconnect', 'error'); return false; }
    googleDriveStatus = { connected: false, initializing: false, error: null };
    EP.toast('Google Drive disconnected', 'success');
    return true;
  };

  EP.getGoogleDriveStatus = function () {
    return {...googleDriveStatus};
  };

  // Force a fresh server probe (bypasses the connected/initializing cache) —
  // used by Retry buttons and after the OAuth redirect returns.
  EP.refreshGoogleDriveStatus = async function () {
    const wasConnected = googleDriveStatus.connected;
    googleDriveStatus = { connected: false, initializing: false, error: null };
    return await EP.initializeGoogleDrive() || wasConnected;
  };

  // ---------------------------------------------------------------------------
  // Storage policy (storage-repair spec §11) — GOOGLE_DRIVE_REQUIRED (default)
  // blocks question-bank storage anywhere but Google Drive while Drive is
  // disconnected; GOOGLE_DRIVE_PREFERRED allows an honestly-labelled Supabase
  // Storage fallback; SUPABASE_ONLY never uses Drive. Served by
  // app_get_storage_policy() / app_set_storage_policy() (migration 0046).
  // ---------------------------------------------------------------------------
  EP.getStoragePolicy = async function (force) {
    if (EP.state.storagePolicy && !force) return EP.state.storagePolicy;
    try {
      const sb = EP.getClient();
      const { data } = sb ? await sb.rpc("app_get_storage_policy") : {};
      EP.state.storagePolicy = data || "GOOGLE_DRIVE_REQUIRED";
    } catch (_) { EP.state.storagePolicy = EP.state.storagePolicy || "GOOGLE_DRIVE_REQUIRED"; }
    return EP.state.storagePolicy;
  };
  EP.setStoragePolicy = async function (policy) {
    const sb = EP.getClient();
    const { data, error } = await sb.rpc("app_set_storage_policy", { p_policy: policy });
    if (error) throw new Error(error.message);
    EP.state.storagePolicy = data || policy;
    return EP.state.storagePolicy;
  };

  // Classify a Drive health payload into the UI states (CONNECTED /
  // NOT_CONNECTED / REAUTHORIZATION / ERROR). Never infers a connection —
  // only maps what the server actually reported.
  EP.driveStateFromHealth = function (h) {
    const err = (h && (h.lastError || h.error)) || "";
    if (h && h.connected) return "CONNECTED";
    if (/expired|reauthoriz/i.test(err)) return "REAUTHORIZATION";
    if (/provider|unavailable|network|fetch failed|5\d\d/i.test(err)) return "ERROR";
    return "NOT_CONNECTED";
  };

  // Ingestion storage gate (storage-repair spec §12) — MUST be checked before
  // any production ingestion processing so storage problems surface before
  // questions are parsed/imported, not after.
  EP.ingestionStorageGate = async function () {
    // Force a fresh policy read: the gate decides whether production content
    // may be stored at all, so it must never act on a cached value that an
    // admin (or another session) has since changed.
    const policy = await EP.getStoragePolicy(true);
    const gd = EP.getGoogleDriveStatus();
    if (policy === "SUPABASE_ONLY") return { allowed: true, policy, provider: "SUPABASE_STORAGE" };
    if (gd.connected) return { allowed: true, policy, provider: "GOOGLE_DRIVE" };
    if (policy === "GOOGLE_DRIVE_PREFERRED") return { allowed: true, policy, provider: "SUPABASE_STORAGE", fallback: true };
    return {
      allowed: false, policy, provider: null, reason: "drive_disconnected",
      message: "Google Drive is not connected. Connect Google Drive before ingesting production question-bank content.",
    };
  };

  EP.uploadToDrive = async function (bucketName, filePath, fileData, options = {}) {
    const sb = EP.getClient();
    if (!sb) throw new Error('Supabase not configured');
    try {
      const file = fileData instanceof File ? fileData : new File([fileData], filePath.split('/').pop() || 'file', { type: options.mimeType || 'application/octet-stream' });
      const form = new FormData();
      form.append("file", file);
      form.append("tenantId", options.tenantId || EP.state.tenantId || 'global');
      form.append("folderPath", options.folderPath || '');
      form.append("questionId", options.questionId || '');
      form.append("paperId", options.paperId || '');
      form.append("sourceDocumentId", options.sourceDocumentId || '');
      form.append("force", String(!!options.force));
      const { data, error } = await sb.functions.invoke("drive-upload", { body: form });
      if (error) throw error;
      return data;
    } catch (error) {
      throw error;
    }
  };

  EP.downloadFromDrive = async function (bucketName, filePath) {
    const sb = EP.getClient();
    if (!sb) throw new Error('Supabase not configured');
    const { data, error } = await sb.functions.invoke("drive-download", {
      body: { fileId: filePath },
    });
    if (error) throw error;
    return data;
  };

  // ---------------------------------------------------------------------------
  // Real object storage (this project's Supabase Storage buckets).
  // Bytes are actually persisted in the cloud (not local FS, not metadata-only)
  // and a storage_objects row is auto-created by the DB trigger. The returned
  // `id` is the real storage object id and is used as drive_file_id / reference.
  // Paths are tenant-prefixed: "<tenantId>/<rest>". For platform admins the
  // global tenant id is used as the prefix.
  // ---------------------------------------------------------------------------
  EP.GLOBAL_TENANT = "00000000-0000-0000-0000-000000000001";
  EP.storageTenantPrefix = function () {
    return (EP.state && EP.state.tenantId) || EP.GLOBAL_TENANT;
  };
  EP.uploadObjectStorage = async function (bucket, path, data, opts = {}) {
    const sb = EP.getClient();
    if (!sb) throw new Error('Supabase not configured');
    const fullPath = EP.storageTenantPrefix() + "/" + String(path).replace(/^\/+/, "");
    const file = data instanceof File ? data
      : new File([data], fullPath.split("/").pop() || "file", { type: opts.mimeType || "application/octet-stream" });
    const { data: up, error } = await sb.storage.from(bucket).upload(fullPath, file, {
      upsert: opts.upsert !== false,
      contentType: opts.mimeType || file.type,
    });
    if (error) throw error;
    return { id: up.id, path: up.path, fullPath: up.fullPath, bucket: bucket, provider: "SUPABASE" };
  };
  EP.storageObjectUrl = async function (bucket, path) {
    const sb = EP.getClient();
    if (!sb) return null;
    const fullPath = EP.storageTenantPrefix() + "/" + String(path).replace(/^\/+/, "");
    const { data } = sb.storage.from(bucket).getPublicUrl(fullPath);
    return data && data.publicUrl ? data.publicUrl : null;
  };

  EP.deleteFromDrive = async function (bucketName, filePath) {
    const sb = EP.getClient();
    if (!sb) throw new Error('Supabase not configured');
    const { data, error } = await sb.functions.invoke("drive-delete", {
      body: { fileId: filePath },
    });
    if (error) throw error;
    return data;
  };

  EP.existsInDrive = async function (bucketName, filePath) {
    const sb = EP.getClient();
    if (!sb) return false;
    try {
      const { data, error } = await sb.functions.invoke("drive-download", {
        body: { fileId: filePath },
      });
      return !error && !!data;
    } catch (_) { return false; }
  };

  EP.getMetadataFromDrive = async function (bucketName, filePath) {
    const sb = EP.getClient();
    if (!sb) return null;
    const { data, error } = await sb.functions.invoke("drive-metadata", {
      body: { fileId: filePath },
    });
    if (error) return null;
    return data;
  };

  EP.listFilesInDrive = async function (bucketName, folderPath) {
    const sb = EP.getClient();
    if (!sb) return [];
    const { data, error } = await sb.functions.invoke("drive-list", {
      body: { folderId: folderPath || 'root' },
    });
    if (error) return [];
    return data?.files || [];
  };

  EP.getDownloadFromDrive = async function (bucketName, filePath) {
    const sb = EP.getClient();
    if (!sb) throw new Error('Supabase not configured');
    const { data, error } = await sb.functions.invoke("drive-download", {
      body: { fileId: filePath },
    });
    if (error) throw error;
    return {
      downloadUrl: data.downloadUrl || data.webViewLink || "",
      previewUrl: data.webViewLink || "",
      fileId: filePath,
      filename: data.original_filename || 'download',
      size: data.size_bytes || 0,
    };
  };

  EP.trackUploadInDrive = async function (bucketName, filePath, options = {}) {
    const sb = EP.getClient();
    if (!sb) return;
    try {
      await sb.functions.invoke("drive-track", {
        body: { filePath, ...options, tenantId: EP.state.tenantId || 'global' },
      });
    } catch (_) {}
  };

  EP.bootstrap = async function () {
    const sb = EP.getClient();
    if (sb) {
      sb.auth.onAuthStateChange(function (event, session) {
        if (event === "SIGNED_OUT") { EP.state = { session:null,user:null,profile:null,membership:null,role:null,isSuper:false,tenantId:null,permissions:new Set() }; EP.render(); }
        else if (session && (event === "SIGNED_IN" || event === "INIT_SESSION" || event === "TOKEN_REFRESHED")) {
          loadIdentity(session.user).then(function(){ EP.render(); });
        }
      });
    }
    await EP.render();
  };

  // expose for pages
  EP.loadIdentity = loadIdentity;
})();
