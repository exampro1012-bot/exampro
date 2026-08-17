# DPP Generator

Daily Practice Problems — small, targeted worksheets generated from the
same verified corpus and the same server-side rules as papers.

## RPC

`app_generate_dpp(p_spec jsonb) returns jsonb` — `SECURITY DEFINER`,
transactional, quota-gated (`DPPS_GENERATED`). Mirrors the paper engine's
authorization, eligibility, snapshot and no-repeat logic.

## Options (all filters, no hardcoded selection)

exam · subject · chapter · topic · difficulty · question type · count ·
year · PYQ-only · practice · weak-topic · revision · custom question list.
The form (`#/dpp/new`) cascades exam → subject → chapter → topic selectors
from live tables.

## Inherited context

Every DPP records and prints: institution branding (FK to `institutions`),
teacher/creator, batch assignment where applicable, academic year, and the
exam pattern where applicable. `dpp_questions` snapshots the selected
questions immutably; `question_usage` records DPP usage so the no-repeat
engine can exclude previously-seen questions per student/institution.

## Lifecycle

- Generated → optional assignment (`dpp_assignments`, notifications via
  `trg_dpp_assignment_notify`) → student attempt (`#/dpp/:id`) →
  server-side evaluation → results feed practice analytics and weak topics.
- `#/dpp/:id` provides preview, print, PDF and Drive save
  (`drive-save-dpp`) with branding.

Insufficient eligible questions → honest refusal with counts; no fallback
fabrication.
