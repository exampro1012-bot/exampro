# Exam Patterns

Exam patterns are database configuration, never frontend code. The paper
generator reads the active pattern + its sections at generation time, so an
official pattern change is a data change (new version row), not a code
change.

## Schema

- `exams` — the catalog (JEE Main, NEET UG, JEE Advanced, CUET, MHT CET,
  TS EAMCET, WBJEE, AP EAMCET, GUJCET, COMEDK, …), admin-managed at
  `#/admin/exams`.
- `exam_patterns` — per exam: `academic_year`, `version`, `effective_from`,
  `effective_to`, `duration_minutes`, `total_marks`, question count,
  `sections` (JSONB section rules), negative marking, language, and
  provenance columns `official_source_url`, `official_document_title`,
  `official_document_year`, `verified_at`, `verified_by`, `notes`
  (migration 0045). Index `(exam_id, is_active, version desc)`.
- `exam_patterns.omr_template_id` — optional FK pinning an OMR template to
  the pattern (migration 0046); the OMR sheet builder auto-selects it.

## Versioning rules

- Exactly one **active** pattern per exam; historical versions stay in the
  table with `is_active = false` — generated papers remain reproducible
  against the version they were built from.
- When an official body changes the pattern: insert a NEW version row,
  verify it against the official bulletin (`verified_at/by`), then activate
  it. Never mutate a version that papers were generated from.

## Current verified state (live, 2026-08-16 cycle)

| Exam | Active pattern | Status |
|---|---|---|
| JEE Main | v2 — 75 attempted / 300 marks / 180 min; per subject Section A 20 MCQ + Section B 5 numerical, +4/−1 | verified vs NTA 2026 bulletin |
| NEET UG | v2 — 180 MCQ / 720 / 200 min; Physics/Chemistry/Botany/Zoology 45 each, +4/−1 | verified vs NTA bulletin |
| JEE Advanced | v2 — per-paper frame (2×3 h papers per brochure); counts/marking unverified per paper (`verified_at` NULL by design) | official structure stored |
| CUET / MHT CET / TS EAMCET / WBJEE | v1 from official sources | `verified_at` NULL until 2026 notifications finalize |
| AP EAMCET / GUJCET / KCET / COMEDK | v1 (matches official) | active |

Admin UI: `#/admin/patterns` (edit sections, marks, negative marking,
provenance). Adding a future exam requires only `#/admin/exams` +
`#/admin/patterns` — zero generator code changes.
