/* ExamPro — OMR scan layout + bubble detection engine.
 *
 * The printable OMR sheet (rendered on /omr/sheets/:id) and this detector
 * share ONE geometry model (EP.omrLayout): bubble and registration-mark
 * positions are defined in millimetres inside a fixed grid, the sheet is
 * rendered with absolute mm positions from that model, and the detector maps
 * scanned pixels back onto the same mm coordinates via a 4-point homography
 * estimated from the printed corner registration marks.
 *
 * Detection is confidence-gated: a question is auto-answered only when one
 * bubble is clearly darker than the rest; anything ambiguous is flagged for
 * the manual review queue instead of guessed.
 */
(function () {
  const EP = window.EP;

  // ---- shared layout constants (mm) -----------------------------------------
  var L = {
    cols: 4,               // question columns per page
    rowsPerCol: 25,        // question rows per column
    gridW: 180,            // grid width
    headerH: 8,            // option-letter header band height
    rowH: 8.8,             // question row height
    markInset: 4.5,        // registration-mark centre inset from grid edge
    markSize: 8,           // registration mark side
    bubbleR: 2.8,          // bubble radius
    bubbleStart: 12,       // first bubble centre x within a column
    bubblePitch: 7.2,      // distance between bubble centres
    qnoX: 8                // question-number label centre x within a column
  };
  var PER_PAGE = L.cols * L.rowsPerCol; // 100
  var PAGE_H = L.headerH + L.rowsPerCol * L.rowH + 8;

  // Geometry for an n-question sheet with `opts` options per question.
  // Returns positions in mm relative to the grid origin (top-left corner of
  // the grid box, NOT the page). Column-major question order: Q1..Q25 in
  // column 1, Q26..Q50 in column 2, …
  EP.omrLayout = function (n, opts) {
    n = Math.max(1, parseInt(n, 10) || 1);
    opts = Math.min(5, Math.max(2, parseInt(opts, 10) || 4)); // 45mm columns fit 5 bubbles at 7.2mm pitch
    var pages = Math.max(1, Math.ceil(n / PER_PAGE));
    var marks = [
      { x: L.markInset, y: L.markInset },
      { x: L.gridW - L.markInset, y: L.markInset },
      { x: L.markInset, y: PAGE_H - L.markInset },
      { x: L.gridW - L.markInset, y: PAGE_H - L.markInset }
    ];
    var bubbles = {}; // qno -> [{cx, cy}, ...]
    var qnos = {};    // qno -> {cx, cy}
    for (var q = 1; q <= n; q++) {
      var i = (q - 1) % PER_PAGE;
      var c = Math.floor(i / L.rowsPerCol);
      var r = i % L.rowsPerCol;
      var colX = c * (L.gridW / L.cols);
      var cy = L.headerH + r * L.rowH + L.rowH / 2;
      var arr = [];
      for (var b = 0; b < opts; b++) {
        arr.push({ cx: colX + L.bubbleStart + b * L.bubblePitch, cy: cy });
      }
      bubbles[q] = arr;
      qnos[q] = { cx: colX + L.qnoX, cy: cy };
    }
    return {
      n: n, opts: opts, pages: pages, pageH: PAGE_H,
      gridW: L.gridW, headerH: L.headerH, rowH: L.rowH, cols: L.cols,
      rowsPerCol: L.rowsPerCol, markSize: L.markSize, bubbleR: L.bubbleR,
      marks: marks, bubbles: bubbles, qnos: qnos
    };
  };

  // Render the scannable bubble grid HTML for a sheet (absolute mm positions,
  // exactly matching EP.omrLayout). `fillFn(qno, letterIdx)` returns true to
  // pre-fill a bubble (used for previews/tests; real sheets render empty).
  EP.omrSheetHtml = function (layout, rollLabel, fillFn) {
    var html = "";
    for (var p = 0; p < layout.pages; p++) {
      html += '<div class="omr-page' + (p > 0 ? " omr-page-break" : "") + '">' +
        '<div class="omr-page-tag">Page ' + (p + 1) + " / " + layout.pages + "</div>";
      for (var m = 0; m < layout.marks.length; m++) {
        var mk = layout.marks[m];
        html += '<div class="omr-reg" style="left:' + (mk.x - L.markSize / 2) + "mm;top:" + (mk.y - L.markSize / 2) + "mm;width:" + L.markSize + "mm;height:" + L.markSize + 'mm"></div>';
      }
      // option letters header
      for (var c = 0; c < layout.cols; c++) {
        var colX = c * (layout.gridW / layout.cols);
        for (var b = 0; b < layout.opts; b++) {
          html += '<div class="omr-hdr-letter" style="left:' + (colX + L.bubbleStart + b * L.bubblePitch - 2) + "mm;top:" + (L.headerH - 6) + 'mm">' + String.fromCharCode(65 + b) + "</div>";
        }
      }
      var lastQ = Math.min(layout.n, (p + 1) * PER_PAGE);
      for (var q = p * PER_PAGE + 1; q <= lastQ; q++) {
        var qn = layout.qnos[q];
        html += '<div class="omr-qno-txt" style="left:' + (qn.cx - 4) + "mm;top:" + (qn.cy - 2.6) + 'mm">' + q + "</div>";
        for (var k = 0; k < layout.opts; k++) {
          var bb = layout.bubbles[q][k];
          var filled = fillFn && fillFn(q, k);
          html += '<div class="omr-b' + (filled ? " filled" : "") + '" data-q="' + q + '" data-k="' + k + '" style="left:' + (bb.cx - L.bubbleR) + "mm;top:" + (bb.cy - L.bubbleR) + 'mm"></div>';
        }
      }
      html += "</div>";
    }
    return '<div class="omr-scan"><div class="omr-scan-meta">' + EP.esc(rollLabel || "") + "</div>" + html + "</div>";
  };

  // ---- image analysis helpers ------------------------------------------------

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Could not load scan image")); };
      img.src = src;
    });
  }

  // Otsu threshold over the grayscale histogram.
  function otsu(gray) {
    var hist = new Array(256).fill(0);
    for (var i = 0; i < gray.length; i++) hist[gray[i]]++;
    var total = gray.length, sum = 0;
    for (var t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, maxVar = -1, threshold = 128;
    for (var t2 = 0; t2 < 256; t2++) {
      wB += hist[t2];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += t2 * hist[t2];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) { maxVar = between; threshold = t2; }
    }
    return threshold;
  }

  // Find the registration mark in one corner region of the binarized image.
  // Returns {cx, cy, area} of the largest dark blob, or null.
  function findMark(bin, w, h, corner) {
    var rx0 = corner === "tl" || corner === "bl" ? 0 : Math.floor(w * 0.62);
    var ry0 = corner === "tl" || corner === "tr" ? 0 : Math.floor(h * 0.62);
    var rx1 = corner === "tr" || corner === "br" ? w : Math.ceil(w * 0.38);
    var ry1 = corner === "bl" || corner === "br" ? h : Math.ceil(h * 0.38);
    var visited = new Uint8Array(w * h);
    var best = null;
    var stack = [];
    function push(x, y) {
      if (x < rx0 || x >= rx1 || y < ry0 || y >= ry1) return;
      var idx = y * w + x;
      if (visited[idx] || !bin[idx]) return;
      visited[idx] = 1;
      stack.push(x, y);
    }
    for (var y = ry0; y < ry1; y += 2) {
      for (var x = rx0; x < rx1; x += 2) {
        var idx0 = y * w + x;
        if (visited[idx0] || !bin[idx0]) continue;
        // flood-fill this blob
        stack = [];
        push(x, y);
        var area = 0, sx = 0, sy = 0, minX = x, maxX = x, minY = y, maxY = y;
        while (stack.length) {
          var yy = stack.pop(), xx = stack.pop();
          area++; sx += xx; sy += yy;
          if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
          if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
          push(xx + 1, yy); push(xx - 1, yy); push(xx, yy + 1); push(xx, yy - 1);
        }
        var bw = maxX - minX + 1, bh = maxY - minY + 1;
        var aspect = bw / bh;
        var fill = area / (bw * bh);
        if (area > (best ? best.area : 0) && aspect > 0.45 && aspect < 2.2 && fill > 0.45) {
          best = { cx: sx / area, cy: sy / area, area: area };
        }
      }
    }
    if (!best) return null;
    var imgArea = w * h;
    // sanity: a registration mark should be a small solid square, not a border
    if (best.area < imgArea * 0.0002 || best.area > imgArea * 0.05) return null;
    return best;
  }

  // Solve the 8-parameter homography h mapping (u,v) -> (x,y) using 4
  // correspondences (Gaussian elimination on the 8x8 linear system).
  // Inputs are Hartley-normalized (centroid + scale) first: the raw DLT
  // system is ill-conditioned for axis-aligned (straight scan) rectangles,
  // where a sub-1e-13 rounding in the mark coordinates collapses a pivot to
  // exactly zero and NaNs the whole solve.
  function normalize(pts) {
    var n = pts.length, cx = 0, cy = 0;
    for (var i = 0; i < n; i++) { cx += pts[i].x; cy += pts[i].y; }
    cx /= n; cy /= n;
    var dist = 0;
    for (var j = 0; j < n; j++) dist += Math.hypot(pts[j].x - cx, pts[j].y - cy);
    dist /= n;
    var s = dist > 1e-12 ? Math.SQRT2 / dist : 1;
    return {
      s: s, cx: cx, cy: cy,
      apply: function (p) { return { x: (p.x - cx) * s, y: (p.y - cy) * s }; }
    };
  }
  function mat3mul(A, B) {
    var C = new Array(9);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
      }
    }
    return C;
  }
  function solveHomography(src, dst) {
    var n1 = normalize(src), n2 = normalize(dst);
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var u = n1.apply(src[i]).x, v = n1.apply(src[i]).y;
      var x = n2.apply(dst[i]).x, y = n2.apply(dst[i]).y;
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    // Gaussian elimination with partial pivoting
    var n = 8, M = A.map(function (row, ri) { return row.concat([b[ri]]); });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r2 = col + 1; r2 < n; r2++) if (Math.abs(M[r2][col]) > Math.abs(M[piv][col])) piv = r2;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      for (var r3 = col + 1; r3 < n; r3++) {
        var f = M[r3][col] / M[col][col];
        for (var c2 = col; c2 <= n; c2++) M[r3][c2] -= f * M[col][c2];
      }
    }
    var hvec = new Array(n);
    for (var r4 = n - 1; r4 >= 0; r4--) {
      var s = M[r4][n];
      for (var c3 = r4 + 1; c3 < n; c3++) s -= M[r4][c3] * hvec[c3];
      hvec[r4] = s / M[r4][r4];
    }
    for (var f2 = 0; f2 < n; f2++) if (!isFinite(hvec[f2])) return null;
    // denormalize: H = T2^-1 * Hn * T1
    var Hn = [hvec[0], hvec[1], hvec[2], hvec[3], hvec[4], hvec[5], hvec[6], hvec[7], 1];
    var T2inv = [1 / n2.s, 0, n2.cx, 0, 1 / n2.s, n2.cy, 0, 0, 1];
    var T1 = [n1.s, 0, -n1.s * n1.cx, 0, n1.s, -n1.s * n1.cy, 0, 0, 1];
    var H = mat3mul(mat3mul(T2inv, Hn), T1);
    return function (u, v) {
      var d = H[6] * u + H[7] * v + H[8];
      if (Math.abs(d) < 1e-12) return null;
      return { x: (H[0] * u + H[1] * v + H[2]) / d, y: (H[3] * u + H[4] * v + H[5]) / d };
    };
  }

  // Mean normalized darkness (0 = white, 1 = black) of a disk on the
  // grayscale array.
  function diskDarkness(gray, w, h, cx, cy, rad) {
    var x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(w - 1, Math.ceil(cx + rad));
    var y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(h - 1, Math.ceil(cy + rad));
    var sum = 0, cnt = 0;
    var r2 = rad * rad;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        sum += gray[y * w + x]; cnt++;
      }
    }
    if (!cnt) return 0;
    return 1 - (sum / cnt) / 255;
  }

  // ---- main entry -------------------------------------------------------------
  // cfg: { questions, options, page } — page selects which printed page the
  // scan represents (1-based) when the sheet spans multiple pages.
  // Resolves { ok, answers: {qno: "A".."H"}, blank: [qno], flagged: [qno],
  //            confidence: 0..1, marks: bool, error? }
  EP.omrDetect = function (imgSrc, cfg) {
    cfg = cfg || {};
    var page = Math.max(1, parseInt(cfg.page, 10) || 1);
    var layout = EP.omrLayout(cfg.questions || 100, cfg.options || 4);
    var pageFirst = (page - 1) * PER_PAGE + 1;
    var pageLast = Math.min(layout.n, page * PER_PAGE);
    if (pageFirst > layout.n) return Promise.resolve({ ok: false, error: "Page " + page + " is out of range for this sheet (" + layout.pages + " page(s))" });

    return loadImage(imgSrc).then(function (img) {
      var maxW = 2000;
      var scale = Math.min(1, maxW / img.naturalWidth);
      var w = Math.max(64, Math.round(img.naturalWidth * scale));
      var h = Math.max(64, Math.round(img.naturalHeight * scale));
      var canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      var px;
      try { px = ctx.getImageData(0, 0, w, h).data; }
      catch (e) { return { ok: false, error: "Scan image is not readable (tainted canvas). Re-upload the scan." }; }

      var gray = new Uint8ClampedArray(w * h);
      for (var i = 0, j = 0; i < gray.length; i++, j += 4) {
        gray[i] = Math.round(0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]);
      }
      var thr = otsu(gray);
      var bin = new Uint8Array(w * h);
      for (var k = 0; k < gray.length; k++) bin[k] = gray[k] < thr ? 1 : 0;

      var corners = ["tl", "tr", "bl", "br"];
      var found = {};
      for (var c = 0; c < 4; c++) {
        var m = findMark(bin, w, h, corners[c]);
        if (!m) return { ok: false, error: "Registration mark not found (" + corners[c].toUpperCase() + "). Use a cleaner scan or enter answers manually." };
        found[corners[c]] = m;
      }
      // mark centres in mm order must match layout.marks order (tl,tr,bl,br);
      // the homography maps sheet mm -> image px (we then query bubble mm coords).
      // findMark returns {cx,cy} centroids — convert to {x,y} for the solver.
      var proj = solveHomography(
        layout.marks,
        [found.tl, found.tr, found.bl, found.br].map(function (m) { return { x: m.cx, y: m.cy }; })
      );
      if (!proj) return { ok: false, error: "Could not align the scan to the sheet grid." };

      // pixel-per-mm estimate for the sampling radius
      var ppx = Math.hypot(found.tr.cx - found.tl.cx, found.tr.cy - found.tl.cy) / (layout.marks[1].x - layout.marks[0].x);
      var sampleR = Math.max(2, layout.bubbleR * 0.55 * ppx);

      var answers = {}, blank = [], flagged = [], confSum = 0, confCnt = 0;
      for (var q = pageFirst; q <= pageLast; q++) {
        var vals = [];
        for (var b = 0; b < layout.opts; b++) {
          var mm = layout.bubbles[q][b];
          var pt = proj(mm.cx, mm.cy);
          if (!pt || pt.x < 0 || pt.y < 0 || pt.x >= w || pt.y >= h) {
            flagged.push(q); vals = null; break;
          }
          vals.push(diskDarkness(gray, w, h, pt.x, pt.y, sampleR));
        }
        if (!vals) continue;
        var sorted = vals.slice().sort(function (a, b2) { return b2 - a; }); // desc
        var d1 = sorted[0], d2 = sorted[1] || 0;
        if (d1 < 0.35) { blank.push(q); continue; }             // nothing filled
        if (d1 - d2 > 0.13) {                                    // clear winner (darkest bubble)
          var idx = vals.indexOf(d1);
          answers[q] = String.fromCharCode(65 + idx);
          var conf = Math.min(1, (d1 - d2) / 0.25);
          confSum += conf; confCnt++;
        } else {
          flagged.push(q);                                       // ambiguous → review
        }
      }
      return {
        ok: true, answers: answers, blank: blank, flagged: flagged,
        confidence: confCnt ? Math.round((confSum / confCnt) * 100) / 100 : 0,
        marks: true, page: page
      };
    });
  };
})();
