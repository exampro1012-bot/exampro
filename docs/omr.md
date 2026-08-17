# OMR

Optical Mark Recognition for offline exam administration — blank sheet
generation, print, scan upload, bubble detection, evaluation and manual
correction.

## Components

- **Templates** (`#/omr/templates/new`) — question count, option layout,
  candidate fields (roll number, paper code, booklet code), stored in
  `omr_templates`. A template can be pinned to an exam pattern
  (`exam_patterns.omr_template_id`, migration 0046) — the sheet builder
  then auto-selects it and states which pattern chose it.
- **Sheets** (`#/omr/sheets/new`) — generated per paper from the pattern's
  section structure; layout never assumes a fixed question count.
- **Batch scan upload** (`#/omr/scan`) — N scans at once → one sheet per
  scan, ready for detection.
- **Detection** (`src/omr-detect.js`) — canvas-based bubble detection in
  the browser (no external service): threshold analysis per bubble region,
  confidence values, manual correction UI for ambiguous marks.
- **Evaluation** — `app_evaluate_omr_sheet(p_sheet_id)` (migration 0016):
  server-side scoring against the canonical answer key in the database
  (`question_answers`), writes marks to `omr_sheets` score columns. The
  frontend never computes final scores.

## Printing

A4 portrait OMR sheets with candidate detail boxes, question bubbles and
optional barcode/QR placeholders per template config; institution branding
is applied from the `institutions` FK.

## Data

`omr_templates`, `omr_sheets` (with `scan_config`), `omr_responses` —
all tenant-scoped with RLS. Evaluation results feed results/analytics like
online sessions.
