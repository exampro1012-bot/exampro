# Paper Generator

Server-authoritative, pattern-driven, transactional. Frontend forms only
collect filters; selection and scoring happen in the database.

## RPC

`app_generate_paper(p_spec jsonb) returns jsonb` — `SECURITY DEFINER`,
tenant-scoped, single transaction (migration 0011, hardened in 0015/0016/
0019). The Edge Function `generate-paper` wraps it for HTTP callers with
the same JWT.

`p_spec` shape:

```json
{
  "exam_id": "<uuid>", "title": "…", "paper_code": "…",
  "instructions": "…",
  "filters": {
    "subject_ids": ["<uuid>"], "chapter_ids": […], "topic_ids": […],
    "difficulties": ["EASY","MEDIUM"], "question_type_ids": […],
    "years": [2024, 2025], "language": "EN",
    "exclude_used": true, "exclude_used_for_student_id": "<uuid|null>"
  }
}
```

## Behaviour (in order)

1. **Authorization** — caller is a staff member of the tenant
   (`app_can_access_tenant`); students are rejected.
2. **Pattern resolution** — active `exam_patterns` row for the exam:
   section structure, per-section counts, marks, negative marks, duration.
   Nothing about section layout is hardcoded in JS.
3. **Quota gate** — `app_quota_available` (default 5 papers/month on FREE;
   HTTP 402 "Free paper quota reached." when exhausted).
4. **Eligible pool** — `tenant_id IN (my tenant, platform bank)`,
   `verification_status = VERIFIED`/`PUBLISHED`, not deleted, matching all
   filters (exam/subject/chapter/topic/type/difficulty/year/language),
   no-repeat exclusions from `question_usage` (papers, DPPs, institution- or
   student-level usage — server-side).
5. **Selection** — per pattern section, `order by random()`, deduplicated by
   `question_hash` within the paper.
6. **Immutable snapshot** — selected text/options/answer/solution/marks are
   copied into `paper_questions`; later edits to source questions never
   change an existing paper (reproducibility). `papers` records
   exam/pattern/creator/timestamp/marking.
7. **Usage recording** — `question_usage` rows for the no-repeat engine.

Failure at any step rolls back the whole transaction — partial papers are
impossible. Insufficient pool → honest per-section shortfall error
("Insufficient eligible questions…"), never fabricated questions.

## UI

- `#/papers/new` — auto generation from filters.
- `#/papers/new/manual` — hand-pick questions (`app_create_manual_paper`).
- `#/papers/new/expert` — expert mode with per-section difficulty mixes.
- `#/papers/:id` — preview, A4 PDF download, print, answer key, solutions,
  OMR sheet generation, Drive save (`drive-save-paper`), institution
  branding from `institutions` via FK (never copied into the form).
