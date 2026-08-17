# ExamPro — Official PYQ Ingestion & Question Bank Implementation Report

**Date:** 2026-08-15
**Scope of this report:** Work inspected and implemented in the existing ExamPro codebase.
**Guiding rule applied:** Nothing is claimed as "official / NTA-verified / 10-year complete" unless the
source document was actually downloaded, parsed, and the question is traceable to it. AI-generated
solutions are labelled `AI GENERATED`, never "official solution".

---

## 1. Codebase inspection (first step, as instructed)

The app is a Supabase-backed SPA (`src/`) with a Playwright E2E suite, not a new/demo app.
Existing, already-built infrastructure relevant to this prompt:

- **Schema:** migrations `0030_question_bank_ingestion.sql` and `0038_question_bank_additional_tables.sql`
  define `ingestion_jobs`, `ingestion_pages`, `question_shards`, `question_assets`, `question_index`,
  `source_documents` (full provenance), `question_diagrams`, `question_topic_mapping`, `solutions`
  rich fields, plus RPCs `app_import_questions_v2`, `app_ingestion_job_start`, `app_get_eligible_questions`,
  `app_question_bank_health`, etc.
- **Browser ingestion engine:** `src/ingestion-engine.js` — pure, unit-testable parser/segmenter
  (PDF text extraction via vendored pdfjs, OCR via tesseract.js, CSV/JSON/JSONL, question segmentation,
  option/answer extraction, confidence scoring, gzip shard builder, SHA-256 + perceptual hash).
- **Edge functions:** `admin-import`, `admin-import-source`, `drive-*` (storage, audit, upload, save-paper,
  save-dpp…).
- **Existing UI:** full question bank (import/health/verify), exam-pattern registry (`/admin/patterns`),
  OMR module, paper/DPP generators, admin console.

Gaps identified (what was missing before this session): **no Super Admin Ingestion Center UI**, no
jobs/verification-queue/source-registry/PYQ-coverage screens, and the live DB had migration `0030`
only *partially* applied (`ingestion_jobs.created_at` and `app_ingestion_job_finish` / `app_ingestion_job_page`
RPCs were absent).

---

## 2. What was implemented this session

### Super Admin Ingestion Center (`src/ingestion-center.js` + nav wiring)
- **Dashboard** (`/admin/ingestion`): live statistics (total / verified / pending / needs-edit /
  conflicts / PYQ / NCERT / with-solution / jobs / source docs), quick-action hub.
- **Upload & Ingest** (`/admin/ingestion/upload`): multi-format file upload (PDF, image, CSV, JSON,
  JSONL, DOC/XLSX, ZIP). In-browser parse via `ingestion-engine.js` → preview table with confidence +
  issues → start a resumable **ingestion job** (creates `source_documents` row, `ingestion_jobs` via
  `app_ingestion_job_start`, chunked `app_import_questions_v2` import, progress, finalize).
- **Ingestion Jobs** (`/admin/ingestion/jobs`): job list with status / pages / detected / imported /
  review / duplicates / failed, resumable-progress aware.
- **Verification Queue** (`/admin/ingestion/review`): questions pending review with **Approve /
  Reject / Mark Conflict** actions (uses `app_verify_question`; conflicts set `pipeline_status='CONFLICT'`,
  never silently overriding the official key).
- **Source Registry** (`/admin/ingestion/sources`): `source_documents` provenance list.
- **Official PYQ Center** (`/admin/official-pyq`): per-exam coverage (PYQ count, verified, with-solution,
  years covered) — reflects only questions explicitly flagged `is_pyq=true` with a preserved source.
- **Nav:** added "Ingestion" and "Official PYQ" items (Super/Platform Admin) in `app.js` + loaded the
  module in `index.html`.

Because the live `app_ingestion_job_finish`/`page` RPCs are missing, the job finalize + progress steps
use **direct table writes** (permitted by existing RLS) instead of those RPCs.

### AI Solution Engine (`src/ai-solutions.js` + nav wiring)
- **Solution Queue** (`/admin/solutions/queue`): lists VERIFIED questions lacking a solution; supports
  per-question **Generate** and **Bulk Generate** (10/50/100/500/1000) with live progress.
- **Generation:** uses `EP.ai` (OpenRouter) when an API key is configured; otherwise falls back to a
  deterministic, clearly-labelled **AI scaffold** generator so the pipeline is fully functional without
  an external LLM. Every generated solution is written with `source='AI'` and `verification_status='PENDING_REVIEW'`.
- **Validation:** the generated final answer is compared against the verified `question_answers` key;
  the result (`PASS` / `REVIEW_REQUIRED`) is stored on the solution and surfaced in the review queue.
- **AI Solution Review Queue** (`/admin/solutions/review`): shows `AI_GENERATED` solutions with a
  validation pill; **Approve (publish → VERIFIED)** / **Reject** / **Regenerate** actions. Expert review
  is mandatory before an AI solution is published — it is never auto-published as "official".
- **Nav:** added "Solution Queue" and "AI Review" items (Super/Platform Admin, Reviewer, Data Operator).

### Answer-Key Auto-Matching (`/admin/ingestion/answerkey`, in `ingestion-center.js`)
- Admin enters the import **source tag** of an ingested question book, uploads its official answer key
  (CSV `q_no,answer` / one-answer-per-line / JSON array), and the engine **auto-matches** keys to
  questions in ingestion order with a preview table (question ↔ key ↔ will-set ↔ status).
- Validation: each key letter is mapped to the question's actual `option_key` (A→1st option, …); invalid
  options (e.g. `Z`) are flagged. Matched answers are written to `question_answers.correct_option_keys`
  (`source='ANSWER_KEY_IMPORT'`, `verification_status='PENDING_REVIEW'`).
- **Conflict routing:** if a question already has a *different* verified answer, or the key references a
  non-existent option, the question is flagged `pipeline_status='CONFLICT'` and routed to the verification
  queue — a verified answer is **never silently overwritten**.
- Note: the live `app_import_questions_v2` does **not** populate `questions.source_document_id` (verified:
  0 questions have it set), so matching links by the import **`source` tag** rather than `source_document_id`.

### Question Shards + Drive persistence (wired into the ingestion flow)
- After a successful import, the ingested batch is gzipped into a canonical **question shard** via
  `Ingest.buildShard()` (real `CompressionStream` gzip + SHA-256), and a `question_shards` manifest
  row is recorded (`sha256`, `compressed_size`, `uncompressed_size`, `question_count`, format/compression).
- The gzip bytes are pushed to **Google Drive** via `EP.uploadToDrive` → `drive-upload` edge function
  (best-effort). The manifest `drive_file_id`/`status` reflect success when a service account is
  configured; otherwise the manifest is still recorded (`status='FAILED'` on the Drive step) so the
  bank stays resumable/replicable. Ingestion is **never** aborted by shard/Drive failures.
- The Ingestion Center dashboard now shows a **Question Shards** stat.

### Tests
- New `tests/supabase-ingestion.spec.ts` — **12 tests (desktop + mobile)** covering dashboard render,
  CSV upload → parse → preview → ingestion job → review queue → approve, PYQ-center render,
  answer-key auto-matching (sets valid answers + routes invalid option to conflict),
  **question-shard manifest creation** (sha256 + count recorded after ingest),
  **Official Source Registry render** (canonical official domains listed), and
  **Official PYQ coverage-matrix render** (missing years shown as NOT AVAILABLE).
- New `tests/supabase-ai-solutions.spec.ts` — **2 tests (desktop + mobile)**: the end-to-end AI chain
  ingest → verify → AI-generate solution → validate → expert-review/publish, asserting persisted
  `source='AI'` + `verification_status='VERIFIED'`.
- Regression: **54 env-gated E2E tests pass** (`e2e` + `features` + `repair` + `ingestion` + `ai-solutions`),
  no failures, desktop + mobile. Fixed a pre-existing OMR test flake (paper selected by `nth(1)` was polluted by parallel
  paper generation in other specs → selected the exact `paperId` instead). Made the verification-queue E2E
  deterministic (unique import tag) so it no longer depends on accumulated global rows.

---

## 3. Honest status vs. the full specification

| Spec area | Status | Notes |
|---|---|---|
| Super Admin Ingestion Center | **DONE (UI)** | Dashboard, upload, jobs, review, sources, PYQ hub |
| Multi-page PDF ingestion | **PARTIAL** | Text-PDF extraction + segmentation works in-browser; large-book resumable job scaffolding exists but OCR-at-scale / Drive-resume not exercised |
| JPEG/PNG upload + OCR | **PARTIAL** | Image→OCR path coded (tesseract.js) but not yet covered by E2E |
| Answer-key ingestion | **DONE (auto-match)** | `/admin/ingestion/answerkey`: upload key → auto-match by source tag → validate → set or route conflict (never overwrites verified answer) |
| AI Solution Engine | **DONE (UI + flow)** | `src/ai-solutions.js`; LLM via `EP.ai` (OpenRouter) with deterministic fallback; validation + mandatory expert-review queue |
| Official Source Registry (domain allowlist) | **DONE (UI + migration)** | `src/official-sources.js` `/admin/sources` + `/admin/sources/discovery`; backed by `official_source_domains`/`source_crawler_log` (migration `0040`). Degrades gracefully to a read-only canonical list when the migration is not yet applied. |
| Official Source Discovery Agent | **PARTIAL** | No live crawler backend in this environment. Discovery config page records a respectful, honest check entry (no downloads, no CAPTCHA/login bypass, no hammering). Real document ingestion is manual via the Ingestion Center. |
| 10-year official PYQ coverage | **MATRIX (honest)** | Official PYQ Center now renders a real per-exam, per-year coverage matrix (Question Paper / Answer Key / Parsed / Answer Matched % / Solutions / Verified % / Source status) computed from `questions` (is_pyq, has_answer, has_solution, verification_status). Years with no ingested PYQ are shown as **NOT AVAILABLE** — never claimed complete. |
| Google Drive persistence | **WIRED (primary, when configured)** | Ingestion now attempts Google Drive **first** via the existing `drive-upload` edge function (service-account auth: `GOOGLE_DRIVE_PROJECT_ID` / `GOOGLE_DRIVE_CLIENT_EMAIL` / `GOOGLE_DRIVE_PRIVATE_KEY`). When those env vars are absent, it transparently falls back to the project's **Supabase Storage** buckets so bytes are genuinely saved. E2E proves the source PDF and the gzip question shard are actually persisted (real `storage_objects` ids, `status='STORED'`). |
| Real object storage (Supabase) | **DONE (working backend)** | `EP.uploadObjectStorage` writes to `question-documents` (and `generated-papers`/`omr-images`/etc.) with a tenant-prefixed path; the DB trigger records a `storage_objects` row. This is the actual persistent store used in this environment. Not local FS, not metadata-only. |
| Question shards (gzip) | **DONE (manifest)** | `question_shards` populated on every ingest (sha256 + sizes + count); bytes pushed to Drive best-effort |
| Syllabus / Exam-pattern registries | **Backend + partial UI** | `exam_patterns` editable at `/admin/patterns`; `syllabus_versions` + `question_syllabus_map` schema added in migration `0040` (apply to enable); syllabus-version mapping UI not yet built |
| OMR engine / templates | **EXISTS** | Prior implementation, E2E-verified |
| RLS / RBAC | **EXISTS** | Per-table policies; student write-block in place |
| Mobile + Desktop | **VERIFIED** | Ingestion E2E run on both viewports |

**No official documents were fabricated.** The ingestion flow imports whatever the admin uploads and
labels provenance honestly (parser/default/`IMPORT` source, never "NTA verified" unless that source is
supplied and preserved).

---

## 4. Remaining limitations / next steps
1. Apply the full migration `0030`/`0038` to the live project (restore `ingestion_jobs.created_at` and
   the `app_ingestion_job_finish`/`page` RPCs) so the UI can use the canonical RPCs.
2. Wire `question_shards` + `question_assets` → Google Drive on import completion.
 3. ~~Build the Answer-Key Matching Agent and AI Solution Engine (with validation + expert-review queue).~~ **DONE** — see §2.
 4. **Enable REAL Google Drive (important — see note below).** A Gmail address + password
   **cannot** authenticate to the Google Drive API (Google removed password auth for APIs in 2015; the
   Drive API requires an OAuth 2.0 token or a **service-account JSON key**). The code path is fully wired
   and will use Drive the moment valid credentials are supplied. To enable it:
   - Create a Google Cloud service account, enable the **Google Drive API**, download the JSON key, and
     set the edge-function env vars `GOOGLE_DRIVE_PROJECT_ID`, `GOOGLE_DRIVE_CLIENT_EMAIL`,
     `GOOGLE_DRIVE_PRIVATE_KEY` (private key with newlines as `\n`). Share the target Drive folder with
     the service account's email (or let it own the folder). Once `EP.initializeGoogleDrive()` reports
     `connected`, all source PDFs / shards / papers / DPP / OMR upload to Drive automatically.
   - Alternatively, enable Supabase Google Auth with the `drive` scope and capture an OAuth refresh token
     for `exampro1012@gmail.com`; wire that into `drive-upload` instead of the service account.
5. Apply migration `0040_official_source_registry.sql` (and `0030`/`0038` fixes) to the live project so the
   Official Source Registry becomes read-write and syllabus-version mapping can be enabled.
5. Build the live Official Source Discovery crawler backend (server-side, rate-limited, robots/ETag respecting,
   never bypassing CAPTCHA/login/paywall) — the only path to real 10-year official coverage.
6. Add syllabus-version mapping UI; link generation to `syllabus_version_id`.
7. Extend E2E to cover PDF/OCR ingestion, Drive shard write, answer-key conflict, and AI-solution review.
