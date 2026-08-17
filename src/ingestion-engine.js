// ExamPro — Universal Question Bank Ingestion Engine (browser + Node dual module).
//
// Pure-ish client-side pipeline that turns a raw source (PDF / OCR text / CSV /
// JSON / JSONL / pasted text) into normalized question rows shaped for
// `app_import_questions_v2`, plus helpers for sharding, hashing and image
// assets. It is loaded as a `<script type="module">` in the SPA and can also be
// imported by Node (Playwright unit tests) because it only touches web APIs
// that exist in both environments (crypto.subtle, Blob, CompressionStream).
//
// Design notes:
//   * Everything is deterministic and unit-testable; no I/O at module scope.
//   * PDF text extraction uses the vendored pdfjs-dist legacy build (lazy
//     dynamic import). OCR uses tesseract.js from CDN and degrades gracefully.
//   * Confidence scoring is heuristic and honest: low-confidence rows are
//     flagged for human review, never silently published.

export const VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function normalizeText(text) {
  if (text == null) return "";
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function stripHtml(html) {
  if (html == null) return "";
  const s = String(html).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return normalizeText(s);
}

export function canonicalText(text) {
  // Lowercased, punctuation-collapsed form used for hashing/duplicate checks.
  return normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f]+/g, "")
    .replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export async function contentHash(parts) {
  // Deterministic hash across question_text + options + correct keys so the
  // same question from different sources collapses to one canonical row.
  const joined = [
    canonicalText(parts.question_text || ""),
    (parts.options || []).map((o) => canonicalText((o && o.option_text) || "")).sort().join("|"),
    (parts.correct_option_keys || []).slice().sort().join(","),
    canonicalText(parts.answer_text || ""),
    parts.numeric_value != null ? String(parts.numeric_value) : "",
  ].join("::");
  return "ch_" + (await sha256Hex(joined)).slice(0, 40);
}

// ---------------------------------------------------------------------------
// Metadata inference (filename + text heuristics)
// ---------------------------------------------------------------------------

const EXAM_PATTERNS = [
  { code: "jee-main", re: /jee[\s-]*main|j\.?e\.?e\s*\(?\s*main/i },
  { code: "jee-advanced", re: /jee[\s-]*advanced|j\.?e\.?e\s*advanced/i },
  { code: "neet", re: /\bneet\b/i },
  { code: "upsc-cse", re: /upsc|civil\s*services/i },
  { code: "ssc-cgl", re: /ssc[\s-]*cgl/i },
  { code: "gate", re: /\bgate\b/i },
  { code: "cat", re: /\bcat\b/i },
  { code: "cbse", re: /\bcbse\b|class\s*x{1,2}|ncert/i },
];

const SUBJECT_PATTERNS = [
  { code: "physics", re: /physics|phys/i },
  { code: "chemistry", re: /chem/i },
  { code: "mathematics", re: /maths?|mathematics|maths_/i },
  { code: "biology", re: /biology|bio/i },
  { code: "english", re: /english|eng\b/i },
  { code: "reasoning", re: /reasoning/i },
  { code: "gs", re: /general\s*studies|gs\b|general\s*knowledge/i },
];

export function detectExam(text) {
  const t = String(text || "");
  for (const p of EXAM_PATTERNS) if (p.re.test(t)) return p.code;
  return null;
}

export function detectSubject(text) {
  const t = String(text || "");
  for (const p of SUBJECT_PATTERNS) if (p.re.test(t)) return p.code;
  return null;
}

export function inferFilenameMeta(filename) {
  const base = String(filename || "").replace(/\.[a-z0-9]+$/i, "");
  const meta = {
    exam_code: detectExam(base),
    subject_code: detectSubject(base),
    year: null,
    session: null,
    shift: null,
    is_pyq: /\b(pyq|previous\s*year|previous-years?|20\d\d.*(paper|qp))\b/i.test(base) || null,
  };
  const yearMatch = base.match(/(19|20)\d{2}/);
  if (yearMatch) meta.year = parseInt(yearMatch[0], 10);
  const ses = base.match(/\b(s[12]|session\s*[12]|shift\s*[12])\b/i);
  if (ses) {
    const v = ses[1].toLowerCase();
    meta.session = /session|s[12]/.test(v) ? (v.includes("2") ? "S2" : "S1") : null;
    meta.shift = /shift/.test(v) ? (v.includes("2") ? "2" : "1") : null;
  }
  return meta;
}

export function inferTextMeta(text) {
  const t = String(text || "").slice(0, 20000);
  const meta = {
    exam_code: detectExam(t),
    subject_code: detectSubject(t),
    year: null,
    session: null,
    shift: null,
    chapter_hint: null,
    is_pyq: /previous\s*year|pyq/i.test(t) || null,
  };
  const yearMatch = t.match(/\(?\b(19|20)\d{2}\b\)?/);
  if (yearMatch) meta.year = parseInt(yearMatch[0].replace(/[()]/g, ""), 10);
  const ch = t.match(/(?:chapter|ch(?:\.)?)\s*[-: ]+([A-Za-z0-9 &'()-]{3,60})/i);
  if (ch) meta.chapter_hint = ch[1].trim();
  return meta;
}

// ---------------------------------------------------------------------------
// Structured parsers
// ---------------------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  const src = String(text || "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") { rows.push(row); row = []; }
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => normalizeText(h).replace(/[\s]+/g, "_").toLowerCase());
  return rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i] != null ? r[i].trim() : ""; });
    return o;
  });
}

export function parseJson(text) {
  const v = JSON.parse(text);
  return Array.isArray(v) ? v : v && Array.isArray(v.items) ? v.items : [];
}

export function parseJsonl(text) {
  return String(text).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

export function parseStructuredText(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t[0] === "[" || /^\s*\{/.test(t)) {
    try {
      if (t.includes("\n") && t.includes('",\n')) return parseJsonl(t);
      return parseJson(t);
    } catch (e) { /* fall through to raw */ }
  }
  if (t.includes(",") && /question_text|option_a/i.test(t.slice(0, 400))) return parseCsv(t);
  return null;
}

// ---------------------------------------------------------------------------
// Raw text segmentation (PDF/OCR pages)
// ---------------------------------------------------------------------------

// Question-number anchors that split a running document into questions.
const Q_ANCHOR = /(?:\n|^)\s*(?:q(?:uestion)?\.?\s*)?([0-9]{1,3})\s*[.):]\s*/gi;

function splitByNumbers(text) {
  const segs = [];
  const src = String(text || "").replace(/\r\n?/g, "\n");
  const re = /(?:^|\n)\s*(?:q(?:uestion)?\.?\s*)?([0-9]{1,3})\s*[.):]\s*/gi;
  let m, last = 0, lastNum = null;
  while ((m = re.exec(src)) !== null) {
    if (last !== 0 || re.lastIndex > m.index + 1) {
      if (m.index > last) segs.push({ num: lastNum, text: src.slice(last, m.index).trim() });
    }
    last = m.index + m[0].length;
    lastNum = parseInt(m[1], 10);
  }
  if (last < src.length && lastNum != null) segs.push({ num: lastNum, text: src.slice(last).trim() });
  return segs;
}

const OPTION_ANCHOR = /(?:^|\n)\s*([(]?[A-Ja-j][)]?)\s*[.:-]?\s*/;

export function extractOptions(text) {
  const lines = normalizeText(text).split("\n");
  const opts = [];
  const rest = [];
  let seen = false;
  for (const line of lines) {
    const m = line.match(/^\s*\(?([A-J])(?:\)|\.|:|-)\s*(.*)$/i);
    if (m && /^[A-J]$/i.test(m[1])) {
      seen = true;
      opts.push({ option_key: m[1].toUpperCase(), option_text: m[2].trim() });
    } else if (seen && /^\s*\(?([A-J])\)/.test(line)) {
      // malformed continuation
      opts[opts.length - 1].option_text += " " + line.trim();
    } else {
      rest.push(line);
    }
  }
  return { options: opts, remainder: rest.join("\n").trim() };
}

export function extractAnswer(text) {
  const t = String(text || "");
  const m = t.match(/(?:ans(?:wer)?\.?\s*[:=]?\s*[(-]?)([A-J])(?:[)-]?)/i) ||
            t.match(/(?:correct\s*answer|key)\s*[:=]?\s*\(?\s*([A-J])\s*\)?/i) ||
            t.match(/\bkey\s*[:=]\s*([A-J])\s*(?:,\s*([A-J]))?/i);
  if (!m) return { correct_option_keys: null, answer_text: null, confidence: 0 };
  const keys = [m[1], m[2]].filter(Boolean).map((k) => k.toUpperCase());
  return { correct_option_keys: keys, answer_text: keys.join(","), confidence: 90 };
}

export function detectQuestionType(seg) {
  const txt = (seg.question_text || "") + " " + (seg.options || []).map((o) => o.option_text).join(" ");
  const ans = seg.answer || {};
  if (seg.options && seg.options.length > 0) {
    if (ans && ans.correct_option_keys && ans.correct_option_keys.length > 1) return "MCQ_MULTI";
    return "MCQ_SINGLE";
  }
  if (ans && (ans.numeric_value != null || ans.numerical_answer)) return "NUMERICAL";
  if (/assertion|reason/i.test(txt)) return "ASSERTION_REASON";
  if (/^\s*passage|read the passage|comprehension/i.test(txt)) return "PASSAGE";
  if ((seg.question_text || "").length > 300) return "SUBJECTIVE";
  return "SHORT_ANSWER";
}

export function detectDifficulty(seg) {
  const q = (seg.question_text || "").toLowerCase();
  const o = (seg.options || []).map((x) => (x.option_text || "").toLowerCase()).join(" ");
  let score = 0;
  if (/integral|differential|matrix|determinant|optics|lens|circuit|capacitor|equilibri|thermodynamic/i.test(q)) score += 2;
  if (/^if |find the |calculate |derive|prove/i.test(q)) score += 1;
  if (/\b(multi|assertion|reason)\b/i.test(q)) score += 2;
  if (o.length > 220) score += 1;
  if (score >= 3) return "HARD";
  if (score === 2) return "MEDIUM";
  return "EASY";
}

export function scoreConfidence(seg) {
  const issues = [];
  const q = (seg.question_text || "").trim();
  if (!q) issues.push("missing question text");
  if (q.length < 12) issues.push("question text suspiciously short");
  const hasOpts = seg.options && seg.options.length >= 2;
  if (!hasOpts && !(seg.answer && (seg.answer.numeric_value != null || seg.answer.numerical_answer))) {
    issues.push("no options or numeric answer");
  }
  const hasAns = seg.answer && (seg.answer.correct_option_keys || seg.answer.numeric_value != null || seg.answer.answer_text);
  if (!hasAns) issues.push("no answer detected");
  if (!seg.solution_text && seg.sourceKind !== "STRUCTURED") issues.push("no solution");

  let score = 100;
  if (q) score -= q.length < 12 ? 15 : 0;
  if (!hasOpts) score -= 15;
  if (!hasAns) score -= 20;
  if (!seg.solution_text) score -= 10;
  if (seg.sourceKind === "OCR") score -= 10;
  if (seg.sourceKind === "RAW") score -= 5;
  score = Math.max(0, Math.min(100, score));
  return { confidence: score, issues };
}

export function segmentQuestions(text, opts) {
  opts = opts || {};
  const src = String(text || "");
  if (!src.trim()) return [];
  const structured = parseStructuredText(src);
  if (structured) {
    return structured.map((row, i) => {
      const seg = rowToSegment(row);
      seg.sourceKind = "STRUCTURED";
      seg.question_number = i + 1;
      return seg;
    });
  }
  const blocks = splitByNumbers(src);
  return blocks.map((b) => {
    const { options, remainder } = extractOptions(b.text);
    const answer = extractAnswer(remainder);
    const seg = {
      question_number: b.num,
      question_text: remainder.replace(/(?:ans(?:wer)?\.?\s*[:=]?\s*[(-]?[A-J][)-]?)/ig, "").trim(),
      options,
      answer: answer.correct_option_keys ? answer : (answer.answer_text ? answer : null),
      sourceKind: opts.sourceKind || "RAW",
    };
    const s = scoreConfidence(seg);
    seg.confidence = s.confidence;
    seg.issues = s.issues;
    seg.question_type = detectQuestionType(seg);
    seg.difficulty = detectDifficulty(seg);
    return seg;
  });
}

function rowToSegment(row) {
  // Accepts rows from CSV/JSON/JSONL with many possible column spellings.
  const get = (...keys) => {
    for (const k of keys) if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
    return null;
  };
  const options = [];
  ["option_a", "option_b", "option_c", "option_d", "option_e", "option_f"].forEach((c, i) => {
    const v = row[c] != null && String(row[c]).trim() !== "" ? String(row[c]).trim() : null;
    if (v) options.push({ option_key: "ABCDEF"[i], option_text: v });
  });
  if (row.options && Array.isArray(row.options)) {
    row.options.forEach((o, i) => {
      const key = (o && o.option_key) || "ABCDEF"[i];
      options.push({ option_key: key, option_text: (o && o.option_text) || String(o || "") });
    });
  }
  const rawKeys = get("correct_keys", "correct_option_keys", "answer_key", "answer_keys");
  const correct_option_keys = rawKeys ? String(rawKeys).split(",").map((k) => k.trim().toUpperCase()).filter(Boolean) : null;
  const numerical = get("numerical_answer", "numeric_value", "answer_value");
  const seg = {
    question_text: get("question_text", "question", "q") || "",
    question_html: get("question_html"),
    options,
    answer: {
      correct_option_keys,
      numerical_answer: numerical,
      numeric_value: numerical ? parseFloat(numerical) : null,
      answer_text: get("answer_text") || rawKeys || numerical,
      answer_type: get("answer_type") || (options.length ? "MCQ" : "NUMERICAL"),
    },
    solution_text: get("solution_text", "solution", "explanation"),
    solution_method: get("solution_method"),
    source: get("source"),
    year: get("year") ? parseInt(get("year"), 10) : null,
    is_pyq: get("is_pyq", "pyq") === "true" || get("is_pyq", "pyq") === "1",
    ncert: get("ncert") === "true" || get("ncert") === "1",
    exam_code: get("exam_code", "exam"),
    subject_code: get("subject_code", "subject"),
    chapter_code: get("chapter_code", "chapter"),
    topic_code: get("topic_code", "topic"),
    question_type_code: get("question_type_code", "question_type"),
    difficulty: get("difficulty"),
    marks: get("marks") ? parseFloat(get("marks")) : null,
    negative_marks: get("negative_marks") ? parseFloat(get("negative_marks")) : null,
  };
  const s = scoreConfidence(seg);
  seg.confidence = s.confidence;
  seg.issues = s.issues;
  if (!seg.question_type_code) seg.question_type = detectQuestionType(seg);
  if (!seg.difficulty) seg.difficulty = detectDifficulty(seg);
  return seg;
}

// ---------------------------------------------------------------------------
// RPC row builder (shape matched to app_import_questions_v2)
// ---------------------------------------------------------------------------

export function toImportItem(seg, meta) {
  meta = meta || {};
  const item = {
    question_text: (seg.question_html || seg.question_text || "").trim(),
    question_html: (seg.question_html || seg.question_text || "").trim(),
    question_text_latex: seg.question_text_latex || null,
    options: (seg.options || []).map((o, i) => ({
      option_key: o.option_key || "ABCDEF"[i],
      option_text: o.option_text || "",
      is_correct: seg.answer && seg.answer.correct_option_keys && seg.answer.correct_option_keys.includes(o.option_key || "ABCDEF"[i]),
      display_order: i + 1,
    })),
    answer: {
      correct_option_keys: (seg.answer && seg.answer.correct_option_keys) || [],
      numerical_answer: seg.answer && (seg.answer.numerical_answer != null ? String(seg.answer.numerical_answer) : null),
      answer_type: seg.answer && seg.answer.answer_type,
      answer_text: seg.answer && seg.answer.answer_text,
      confidence: seg.answer && seg.answer.confidence != null ? seg.answer.confidence : seg.confidence,
      source: seg.answer && seg.answer.source,
    },
    solution_text: seg.solution_text || null,
    solution_method: seg.solution_method || null,
    difficulty: seg.difficulty || "MEDIUM",
    year: seg.year || meta.year || null,
    session: seg.session || meta.session || null,
    shift: seg.shift || meta.shift || null,
    question_number: seg.question_number || null,
    is_pyq: seg.is_pyq != null ? seg.is_pyq : (meta.is_pyq || false),
    ncert: seg.ncert != null ? seg.ncert : (meta.ncert || false),
    marks: seg.marks != null ? seg.marks : (meta.marks || null),
    negative_marks: seg.negative_marks != null ? seg.negative_marks : (meta.negative_marks || null),
    language: meta.language || "EN",
    source: seg.source || meta.source || "PARSER",
    source_page_start: seg.source_page_start || meta.page || null,
    source_page_end: seg.source_page_end || meta.page || null,
    source_question_number: seg.source_question_number != null ? String(seg.source_question_number) : (seg.question_number != null ? String(seg.question_number) : null),
    source_book: seg.source_book || meta.source_book || null,
    source_publisher: seg.source_publisher || meta.source_publisher || null,
    source_edition: seg.source_edition || meta.source_edition || null,
    parse_confidence: seg.confidence != null ? seg.confidence : 0,
    review_required: seg.confidence != null && seg.confidence < 80,
    solution_status: seg.solution_text ? "AVAILABLE" : "NOT_AVAILABLE",
  };
  if (seg.exam_code) item.exam_code = seg.exam_code;
  else if (meta.exam_code) item.exam_code = meta.exam_code;
  if (seg.subject_code) item.subject_code = seg.subject_code;
  else if (meta.subject_code) item.subject_code = meta.subject_code;
  if (seg.chapter_code) item.chapter_code = seg.chapter_code;
  if (seg.topic_code) item.topic_code = seg.topic_code;
  if (seg.question_type_code) item.question_type_code = seg.question_type_code;
  return item;
}

// ---------------------------------------------------------------------------
// Shard builder (JSONL + gzip via CompressionStream, hashed)
// ---------------------------------------------------------------------------

export async function buildShard(records) {
  const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : "");
  const uncompressedSize = new TextEncoder().encode(jsonl).byteLength;
  const stream = new Blob([jsonl]).stream().pipeThrough(new CompressionStream("gzip"));
  const gz = await new Response(stream).arrayBuffer();
  const sha256 = await sha256Hex(new Uint8Array(gz));
  return {
    jsonl,
    gzipBlob: new Blob([gz], { type: "application/gzip" }),
    sha256,
    compressedSize: gz.byteLength,
    uncompressedSize,
    count: records.length,
  };
}

// ---------------------------------------------------------------------------
// Image assets (browser only; Node returns null gracefully)
// ---------------------------------------------------------------------------

function canvas2d() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  return c && c.getContext ? c.getContext("2d") : null;
}

export async function loadImage(fileOrDataUrl) {
  if (typeof document === "undefined") return null;
  const url = typeof fileOrDataUrl === "string" ? fileOrDataUrl : URL.createObjectURL(fileOrDataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { if (typeof fileOrDataUrl !== "string") URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { if (typeof fileOrDataUrl !== "string") URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function cropAndCompress(fileOrDataUrl, opts) {
  opts = opts || {};
  const ctx = canvas2d();
  const img = await loadImage(fileOrDataUrl);
  if (!ctx || !img) return null;
  const maxDim = opts.maxDim || 1280;
  const quality = opts.quality || 0.82;
  const crop = opts.crop || null; // {x,y,w,h} in source pixels
  const sx = crop ? crop.x : 0, sy = crop ? crop.y : 0;
  const sw = crop ? crop.w : img.naturalWidth, sh = crop ? crop.h : img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = ctx.canvas;
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result, blob, width: w, height: h });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    }, "image/webp", quality);
  });
}

export async function perceptualHash(dataUrl) {
  // Very small perceptual-ish hash: 8x8 grayscale average grid → 64-bit hex.
  const ctx = canvas2d();
  const img = await loadImage(dataUrl);
  if (!ctx || !img) return null;
  const canvas = ctx.canvas;
  canvas.width = 8;
  canvas.height = 8;
  ctx.drawImage(img, 0, 0, 8, 8);
  const data = ctx.getImageData(0, 0, 8, 8).data;
  const avg = data.reduce((s, v, i) => (i % 4 === 3 ? s : s + v), 0) / (8 * 8 * 3);
  let bits = "";
  for (let i = 0; i < 64; i++) bits += data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] > avg * 3 ? "1" : "0";
  return parseInt(bits, 2).toString(16).padStart(16, "0");
}

// ---------------------------------------------------------------------------
// PDF text extraction (vendored pdfjs legacy build, lazy)
// ---------------------------------------------------------------------------

let _pdfjsPromise = null;
async function loadPdfJs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = import(/* @vite-ignore */ "./vendor/pdf.min.mjs").catch((e) => {
      _pdfjsPromise = null;
      throw new Error("pdfjs not available: " + (e && e.message));
    });
  }
  return _pdfjsPromise;
}

export async function extractPdfText(file, opts) {
  opts = opts || {};
  if (typeof file === "string") throw new Error("extractPdfText expects a File/Blob");
  let pdfjs;
  try {
    pdfjs = await loadPdfJs();
  } catch (e) {
    return { text: "", pages: [], error: e.message };
  }
  try {
    const workerUrl = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    const pages = [];
    const pageCount = Math.min(doc.numPages, opts.maxPages || 500);
    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let text = (tc.items || [])
        .map((it) => (it.str != null ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ page: p, text });
    }
    await doc.destroy();
    return { text: pages.map((p) => p.text).join("\n\n"), pages, error: null };
  } catch (e) {
    return { text: "", pages: [], error: (e && e.message) || String(e) };
  }
}

// ---------------------------------------------------------------------------
// OCR (tesseract.js from CDN, graceful degradation)
// ---------------------------------------------------------------------------

let _tesseractPromise = null;
async function loadTesseract() {
  if (!_tesseractPromise) {
    _tesseractPromise = import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js").catch((e) => {
      _tesseractPromise = null;
      throw new Error("tesseract.js not available: " + (e && e.message));
    });
  }
  return _tesseractPromise;
}

export async function ocrImage(file, lang) {
  lang = lang || "eng";
  let Tesseract;
  try {
    Tesseract = await loadTesseract();
  } catch (e) {
    return { text: "", confidence: 0, supported: false, error: e.message };
  }
  try {
    const result = await Tesseract.recognize(file, lang, { logger: () => {} });
    const text = (result && result.data && result.data.text) || "";
    const confidence = (result && result.data && result.data.confidence) || 0;
    return { text, confidence, supported: true, error: null };
  } catch (e) {
    return { text: "", confidence: 0, supported: true, error: (e && e.message) || String(e) };
  }
}

// ---------------------------------------------------------------------------
// Assemble page pipeline: file → pages → segments → items
// ---------------------------------------------------------------------------

export async function extractFromFile(file, opts) {
  opts = opts || {};
  const name = file && file.name ? file.name : "";
  const isPdf = /\.pdf$/i.test(name) || (file && file.type === "application/pdf");
  if (isPdf) {
    const r = await extractPdfText(file, opts);
    if (r.error) return { kind: "pdf", error: r.error, pages: [], segments: [], items: [], text: "" };
    const segments = [];
    r.pages.forEach((pg, i) => {
      const segs = segmentQuestions(pg.text, { sourceKind: opts.forceOcr ? "OCR" : "PDF" });
      segs.forEach((s) => { s.source_page_start = pg.page; s.source_page_end = pg.page; });
      segments.push(...segs);
    });
    const meta = { ...inferFilenameMeta(name), ...(opts.meta || {}) };
    const items = segments.map((s) => toImportItem(s, meta));
    return { kind: "pdf", error: null, pages: r.pages, segments, items, text: r.text, meta };
  }
  // image → OCR
  if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp)$/i.test(name)) {
    if (!opts.forceOcr) {
      return { kind: "image", error: null, ocrSkipped: true, pages: [], segments: [], items: [], text: "" };
    }
    const ocr = await ocrImage(file);
    if (!ocr.supported) return { kind: "image", error: ocr.error, pages: [], segments: [], items: [], text: "" };
    const segments = segmentQuestions(ocr.text, { sourceKind: "OCR" });
    const meta = { ...inferFilenameMeta(name), ...(opts.meta || {}) };
    const items = segments.map((s) => toImportItem(s, meta));
    return { kind: "image", error: null, pages: [{ page: 1, text: ocr.text }], segments, items, text: ocr.text, meta };
  }
  // text/plain or csv/json
  const raw = await file.text();
  const segments = segmentQuestions(raw, { sourceKind: "TEXT" });
  const meta = { ...inferFilenameMeta(name), ...(opts.meta || {}) };
  const items = segments.map((s) => toImportItem(s, meta));
  return { kind: "text", error: null, pages: [], segments, items, text: raw, meta };
}

// ---------------------------------------------------------------------------
// Module plumbing: attach to window.EP when present (SPA), export for Node
// ---------------------------------------------------------------------------

const api = {
  VERSION,
  normalizeText,
  stripHtml,
  canonicalText,
  sha256Hex,
  contentHash,
  detectExam,
  detectSubject,
  inferFilenameMeta,
  inferTextMeta,
  parseCsv,
  parseJson,
  parseJsonl,
  parseStructuredText,
  segmentQuestions,
  extractOptions,
  extractAnswer,
  detectQuestionType,
  detectDifficulty,
  scoreConfidence,
  toImportItem,
  buildShard,
  loadImage,
  cropAndCompress,
  perceptualHash,
  extractPdfText,
  ocrImage,
  extractFromFile,
};

if (typeof globalThis !== "undefined" && globalThis.window) {
  globalThis.EP = globalThis.EP || {};
  globalThis.EP.ingest = api;
}

export default api;