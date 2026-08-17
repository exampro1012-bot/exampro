# Ingestion

ExamPro's ingestion pipeline turns source documents (PDF books, official
papers, CSV/JSON exports, images, ZIP bundles) into reviewable, verifiable
question-bank rows. Nothing enters the verified corpus without human review.

## Entry points

- **Ingestion Center** (`#/admin/ingestion`) — dashboard with live counters
  (questions, verified, pending, jobs, sources, shards), job filters by
  status, source registry, review queue, answer-key engine.
- **Upload** (`#/admin/ingestion/upload`) — file upload → hash (SHA-256) →
  source registration → parse → question segmentation.
- **Official PYQ hub** (`#/admin/official-pyq`) — official-source ingestion
  with provenance (source, year, exam, paper, question number).
- **Answer Key Engine** (`#/admin/ingestion/answerkey`) — match extracted
  keys to questions, detect conflicts (`CONFLICT` status requires review).
- **Solution queue** (`#/admin/solutions/queue`, `#/admin/solutions/review`)
  — AI-assisted solution generation with mandatory human review
  (`AI_GENERATED → TEACHER_REVIEWED → OFFICIAL_VERIFIED`).

## Pipeline stages

UPLOAD → HASH → SOURCE REGISTRATION → OCR/PARSE → PAGE SEGMENTATION →
QUESTION SEGMENTATION → NORMALIZATION → SUBJECT/CHAPTER/TOPIC
CLASSIFICATION → QUESTION TYPE → DIFFICULTY → YEAR/EXAM → ANSWER KEY
EXTRACTION → SOLUTION EXTRACTION → DIAGRAM EXTRACTION → DEDUPLICATION
(SHA-256 source hash + normalized content hash) → QUALITY CHECK → REVIEW →
VERIFY → PUBLISH.

## Job model

`ingestion_jobs` / `ingestion_pages` (migration 0030) with RPCs
`app_ingestion_job_start / _page / _retry_page / _finish`. Jobs are
page-by-page, resumable, retryable and idempotent — a retry never creates
duplicate questions. States: QUEUED, PROCESSING, PAUSED,
WAITING_FOR_STORAGE (Drive down under `GOOGLE_DRIVE_REQUIRED`; questions
preserved for resume), WAITING_REVIEW, COMPLETED, FAILED, CANCELLED.

## Storage gate

Production policy `system_config.storage_policy` =
`GOOGLE_DRIVE_REQUIRED` (default; see docs/google-drive.md). When Drive is
disconnected the import is blocked BEFORE processing with the message
"Google Drive is not connected. Connect Google Drive before ingesting
production question-bank content." Under `GOOGLE_DRIVE_PREFERRED` /
`SUPABASE_ONLY` the Supabase Storage fallback is allowed and every
completion line names the real provider + object id + sha256.

## Verification lifecycle

IMPORTED → PARSED → NORMALIZED → CLASSIFIED → KEY_PENDING →
SOLUTION_PENDING → REVIEW_PENDING (PENDING_REVIEW) → NEEDS_EDIT / CONFLICT →
VERIFIED → PUBLISHED → ARCHIVED. Only VERIFIED/PUBLISHED questions are
eligible for paper/DPP generation (enforced server-side in
`app_generate_paper` / `app_generate_dpp`).
