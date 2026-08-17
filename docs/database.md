# Database

Migrations live in `supabase/migrations/` and are numbered for ordered
application: `0001_schema → 0002_helpers → … → 0030_question_bank_ingestion →
… → 0046_storage_policy_and_omr_template → 9001_live_fix_current_tenant`
(the full chain through `0046` — see `supabase/README.md` for the one-line
summary of each).

Apply them in that order in the Supabase SQL editor (or `supabase db push`).

## Key tables

| Group | Tables |
|-------|--------|
| Tenancy / identity | `tenants`, `tenant_memberships`, `roles`, `permissions`, `role_permissions`, `platform_admins`, `profiles` |
| Catalog | `exams`, `subjects`, `chapters`, `topics`, `question_types`, `exam_patterns`, `exam_pattern_sections` |
| Questions | `questions`, `question_options`, `question_answers`, `solutions`, `question_images`, `question_sources`, `question_tags`, `question_usage`, `question_index`, `question_shards`, `question_translations` |
| Official sources / syllabus | `source_documents`, `official_source_domains`, `source_crawler_log`, `syllabus_versions`, `question_syllabus_map` |
| Papers / DPP | `papers`, `paper_questions`, `dpp`, `dpp_questions` |
| Exams / results | `exam_sessions`, `responses`, `results`, `student_batches`, `teacher_assignments`, `assessment_centers` |
| OMR / analytics | `omr_sheets`, `omr_responses`, `analytics_events`, `weak_topic_reports`, `student_notes` |
| Ingestion | `ingestion_jobs`, `ingestion_pages`, `question_diagrams`, `question_topic_mapping`, `question_assets` |
| Storage / Drive | `storage_folders`, `storage_objects`, `storage_alerts`, `google_drive_oauth_tokens` |
| Features | `formula_library`, `notifications` |
| Billing | `plans`, `subscriptions`, `usage_records`, `payment_transactions` |
| Platform | `system_config`, `audit_logs` |

Every business table has `tenant_id`, `created_by`, `created_at`,
`updated_at`, and soft-delete (`is_deleted`) where appropriate.

### Multilingual questions (`question_translations`, migration 0043)

Per-language question text, options (`[{option_key, option_text}]`) and
solution for 8 languages (`EN HI GU BN MR TA TE KN`), unique per
`(question_id, language)`, with `is_verified` gating (unverified translations
are marked while viewing). Managed from the **question detail page →
Translations** card (add/edit/verify/delete + a view-language switcher).

### Syllabus versioning (migration 0040)

`syllabus_versions` registers official syllabi per `exam × authority × year ×
version` (status DRAFT/ACTIVE/ARCHIVED, provenance URL). Questions link to a
version through `question_syllabus_map` (`CURRENT / HISTORICAL / REMOVED /
MODIFIED / NOT_IN_CURRENT_SYLLABUS / UNCERTAIN`) from the **question detail
page → Syllabus mapping** card; versions are managed at
**Admin → Syllabus Versions** (`/admin/syllabus`).

## The paper-generation engine (`app_generate_paper`)

`SECURITY DEFINER`, runs as the tenant. Signature:

```sql
app_generate_paper(p_spec jsonb) returns jsonb
```

`p_spec` example:

```json
{
  "exam_id": "<uuid>", "count": 10, "title": "Test Paper",
  "paper_code": "TEST-001", "marks": 4, "negative_marks": 1,
  "filters": { "subject_ids": ["<uuid>"], "difficulties": ["EASY","MEDIUM"],
               "years": [2024], "question_type_ids": ["<uuid>"] }
}
```

Behaviour:

1. Resolves defaults from the active `exam_patterns` row (count, duration,
   marks, negative marks).
2. **Quota gate** — `app_quota_available(tenant, 'PAPERS_GENERATED', limit,
   period)` (default 5/month from `system_config.free_quota`).
3. Builds the eligible pool: `tenant_id IN (my_tenant, platform_bank)`,
   `VERIFIED`, not deleted, matching filters. `order by random()`.
4. Snapshots selected questions immutably into `paper_questions` (text, answer,
   solution, options, marks) — later edits to source questions do **not**
   change a generated paper.
5. De-duplicates by `question_hash` within the paper.
6. Returns `{ paper_id, questions, total_marks, ... }` or a clear error
   (`Insufficient eligible questions` / `Free paper quota reached`).

## The scoring engine (`app_finalize_session`)

`SECURITY DEFINER`. Computes from `responses` + the immutable paper snapshot:

- `correct`, `incorrect`, `unanswered`
- `marks` (correct×marks − incorrect×negative), `total_marks`, `accuracy`,
  `percentage`, `rank` (within the session's batch/assignment if any)
- writes a single `results` row and marks the session `COMPLETED`.

It is **idempotent**: calling it twice returns `{ already: true }` and does not
double-write. This prevents score tampering by re-submitting.

## Quotas & plans

- `plans` (FREE/STARTER/PRO/INSTITUTION/ENTERPRISE) and `system_config` seed
  defaults (FREE = 5 paper generations/month).
- `app_increment_usage` / `app_quota_available` enforce counters
  transactionally inside `app_generate_paper`.

## Validation

`supabase/tests/engine_test2.sql` runs against a live/empty DB: it inserts a
verified question set, generates a 10-question paper, answers 8 correctly / 1
wrong / 1 blank, finalizes, and asserts `correct=8, incorrect=1, unanswered=1,
marks=31` plus idempotency. **This passes on PostgreSQL 18.**

> Local (non-Supabase) validation needs stubs for `auth`/`storage`/roles —
> see `TESTING.md`. The stubs file is `supabase/tests/_local_stubs.sql`.
