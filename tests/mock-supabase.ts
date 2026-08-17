// Mock Supabase HTTP layer for structural UI tests.
// Intercepts every request the app makes (auth, PostgREST, storage) and returns
// canned-but-realistic data, so the full SPA shell and routes render and can be
// asserted on WITHOUT any live backend. The mock is intentionally shallow:
// it proves the UI works, not that the backend works (DB tests do that).
// Note: the page runs on localhost:3000 and the mock origin is cross-origin,
// so every response must carry Access-Control-Allow-Origin + Expose-Headers
// (matching what real Supabase returns) or the browser hides the headers
// (Content-Range/Prefer) that the supabase client needs for counts.

import type { Page, Route } from '@playwright/test';

const UID = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";
const PLATFORM = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "33333333-3333-3333-3333-333333333333";
const OTHER_UID = "44444444-4444-4444-4444-444444444444";

// Whether the deployment advertises Google as an enabled external provider
// (mirrors Supabase Auth → Providers config). The UI probes this before
// redirecting to the OAuth authorize endpoint.
let googleEnabled = false;
export function setGoogleEnabled(v: boolean): void {
  googleEnabled = v;
}

// ---------------------------------------------------------------------------
// Configurable identity / RLS simulation for the negative (destructive) suite.
// Default state mirrors the structural suite: SUPER_ADMIN platform user in
// TENANT. `setRole`/`setRlsMode`/`setQuotaOk`/`setAnonDenied` let tests act as
// a STUDENT, a TEACHER of another tenant, a quota-exhausted tenant, or an
// anonymous caller — and the mock answers the way the real RLS would.
// ---------------------------------------------------------------------------
export type MockRlsMode = "open" | "tenant";

const ROLE_IDS: Record<string, string> = {
  SUPER_ADMIN: "30000000-0000-0000-0000-000000000001",
  TEACHER: "30000000-0000-0000-0000-000000000002",
  STUDENT: "30000000-0000-0000-0000-000000000003",
};

const TEACHER_PERMS = [
  "questions.view", "questions.create", "questions.edit", "questions.import", "questions.review",
  "papers.generate", "papers.view", "papers.edit", "papers.lock",
  "dpp.generate", "dpp.view", "dpp.assign",
  "exams.create", "exams.assign", "exams.conduct", "exams.view",
  "students.view", "batches.manage",
  "analytics.view", "reports.view", "notifications.manage",
];

const STUDENT_PERMS = [
  "exams.view", "papers.view", "dpp.view", "analytics.view", "reports.view",
];

export interface MockState {
  role: string;
  isSuper: boolean;
  tenant: string;
  quotaOk: boolean;
  anonDenied: boolean;
  rlsMode: MockRlsMode;
  parentLinked: boolean;
}

const mockState: MockState = {
  role: "SUPER_ADMIN",
  isSuper: true,
  tenant: TENANT,
  quotaOk: true,
  anonDenied: false,
  rlsMode: "open",
  parentLinked: true,
};

// The module-level mockState is shared by every page that installMocks() in
// the same worker process. Specs mutate it via setRole()/setParentLinked()/
// setRlsMode()/setQuotaOk()/setAnonDenied()/setMockTenant() at test time.
// If a spec mutates the singleton and the worker later starts ANOTHER spec
// file, the stale role/tenant leaks into that file's pages and identity
// queries resolve to the wrong role (e.g. the sidebar renders a
// SUBJECT_TEACHER nav in the boot test). resetMockState() restores the
// defaults; every spec that uses installMocks() calls it at the START of its
// beforeEach (before its own setters), so each page starts from a clean state
// and per-spec mutations are applied afterwards.
export function resetMockState(): void {
  mockState.role = "SUPER_ADMIN";
  mockState.isSuper = true;
  mockState.tenant = TENANT;
  mockState.quotaOk = true;
  mockState.anonDenied = false;
  mockState.rlsMode = "open";
  mockState.parentLinked = true;
  googleEnabled = false;
}

export function setRole(role: string): void {
  mockState.role = role;
  mockState.isSuper = role === "SUPER_ADMIN";
}
export function setParentLinked(v: boolean): void {
  mockState.parentLinked = v;
}
export function setRlsMode(mode: MockRlsMode): void {
  mockState.rlsMode = mode;
}
export function setQuotaOk(v: boolean): void {
  mockState.quotaOk = v;
}
export function setAnonDenied(v: boolean): void {
  mockState.anonDenied = v;
}
export function setMockTenant(t: string): void {
  mockState.tenant = t;
}

function roleRow(code: string) {
  return { id: ROLE_IDS[code] || code, code, name: code.replace(/_/g, " ") };
}
function rolePermsFor(code: string): { role_id: string; permission_code: string }[] {
  const perms = code === "TEACHER" ? TEACHER_PERMS : code === "STUDENT" ? STUDENT_PERMS : [];
  return perms.map((p) => ({ role_id: ROLE_IDS[code], permission_code: p }));
}

// tenant-scoped tables whose rows the mock must filter when rlsMode = "tenant"
// (mirrors app_can_read_content: own tenant + shared platform bank).
const TENANT_SCOPED = new Set([
  "questions", "question_options", "question_answers", "solutions", "question_reviews",
  "papers", "paper_questions", "exam_sessions", "responses", "results",
  "dpps", "dpp_questions", "omr_templates", "omr_sheets", "omr_responses",
  "institutions", "branches", "batches", "teachers", "students", "student_batches",
  "exam_assignments", "dpp_assignments", "exam_patterns", "exam_pattern_sections",
  "bookmarks", "practice_logs", "notifications", "question_usage", "student_notes",
  "formula_library", "parents", "teacher_assignments",
]);

const PLATFORM_ID = "00000000-0000-0000-0000-000000000001";

function isPlatformReadable(row: any): boolean {
  return row && row.tenant_id === PLATFORM_ID;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Prefer, Accept, Content-Type, Range, Content-Range",
  "Access-Control-Expose-Headers": "Content-Range, Prefer, X-Retry-Count",
};

function fulfill(route: Route, opts: { status: number; contentType: string; body: string; headers?: Record<string, string> }) {
  return route.fulfill({ ...opts, headers: { ...CORS, ...(opts.headers || {}) } });
}

function b64u(s: string): string {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({
    sub: UID, role: "authenticated", aud: "authenticated",
    email: "qa@exampro.test", exp: now + 3600, iat: now,
  }));
  return `${header}.${payload}.mock-signature`;
}

const ids = {
  exam: "10000000-0000-0000-0000-000000000001",
  subject: "10000000-0000-0000-0000-000000000002",
  chapter: "10000000-0000-0000-0000-000000000003",
  topic: "10000000-0000-0000-0000-000000000004",
  type: "10000000-0000-0000-0000-000000000005",
  q1: "10000000-0000-0000-0000-00000000000a",
  q2: "10000000-0000-0000-0000-00000000000b",
  paper: "10000000-0000-0000-0000-00000000000c",
  pq: "10000000-0000-0000-0000-00000000000d",
  session: "10000000-0000-0000-0000-00000000000e",
  result: "10000000-0000-0000-0000-00000000000f",
  pattern: "10000000-0000-0000-0000-000000000010",
  profile: "10000000-0000-0000-0000-000000000011",
  tpl: "10000000-0000-0000-0000-000000000012",
  sheet: "10000000-0000-0000-0000-000000000013",
  dpp: "10000000-0000-0000-0000-000000000014",
  batch: "10000000-0000-0000-0000-000000000015",
};

function qSnapshot(qid: string, marks: number, neg: number) {
  const opts = ["A", "B", "C", "D"].map((k) => ({
    option_key: k, option_text: `Mock option ${k}`, display_order: "ABCD".indexOf(k) + 1,
  }));
  return {
    question_id: qid, question_text: `<p>Mock question ${qid.slice(-2)}: what is the result?</p>`,
    year: 2024, difficulty: "MEDIUM", marks, negative_marks: neg, options: opts,
    answer: { correct_option_keys: ["A"], numerical_answer: null, explanation: "Standard result." },
    solution: { solution_text: "Substitute the standard value.", concept: "Basic", short_solution: "", detailed_solution: "", formula: "", hint: "" },
  };
}

// ---- canned tables (column names match what the UI actually reads) ----
const tables: Record<string, any[]> = {
  profiles: [{ id: ids.profile, auth_user_id: UID, full_name: "QA User", email: "qa@exampro.test", phone: "", status: "ACTIVE", email_verified_at: "2026-01-01T00:00:00Z", default_tenant_id: TENANT }],
  tenant_memberships: [{ id: "20000000-0000-0000-0000-000000000001", tenant_id: TENANT, user_id: UID, role_id: "30000000-0000-0000-0000-000000000001", status: "ACTIVE", roles: { id: "30000000-0000-0000-0000-000000000001", code: "SUPER_ADMIN", name: "Super Admin" } }],
  platform_admins: [{ user_id: UID }],
  user_identities: [{ id: "50000000-0000-0000-0000-000000000001", user_id: UID, provider: "email", provider_user_id: UID, provider_email: "qa@exampro.test", provider_data: {} }],
  tenants: [{ id: TENANT, name: "QA Workspace", slug: "qa-workspace", status: "ACTIVE", address: "Bengaluru", gstin: "", logo_url: "", watermark_url: "", header_text: "", footer_text: "", created_at: "2026-01-01T00:00:00Z" }],
  roles: [
    { id: ROLE_IDS.SUPER_ADMIN, code: "SUPER_ADMIN", name: "Super Admin" },
    { id: ROLE_IDS.TEACHER, code: "TEACHER", name: "Teacher" },
    { id: ROLE_IDS.STUDENT, code: "STUDENT", name: "Student" },
  ],
  role_permissions: [
    ...rolePermsFor("TEACHER"),
    ...rolePermsFor("STUDENT"),
  ],
  permissions: [
    { code: "questions.view" }, { code: "questions.create" }, { code: "questions.edit" }, { code: "questions.delete" }, { code: "questions.review" }, { code: "questions.import" },
    { code: "papers.generate" }, { code: "papers.view" }, { code: "papers.edit" }, { code: "papers.publish" }, { code: "papers.lock" },
    { code: "dpp.generate" }, { code: "dpp.view" }, { code: "dpp.assign" },
    { code: "exams.create" }, { code: "exams.assign" }, { code: "exams.conduct" }, { code: "exams.view" },
    { code: "students.view" }, { code: "students.manage" }, { code: "teachers.view" }, { code: "teachers.manage" }, { code: "batches.manage" }, { code: "branches.manage" }, { code: "institutions.manage" },
    { code: "tenants.manage" }, { code: "users.manage" }, { code: "roles.manage" },
    { code: "analytics.view" }, { code: "reports.view" }, { code: "reports.export" },
    { code: "subscriptions.manage" }, { code: "sales.manage" }, { code: "invoices.manage" }, { code: "gst.manage" },
    { code: "omr.manage" }, { code: "audit.view" }, { code: "security.view" }, { code: "system.config" }, { code: "system.health" },
  ],
  plans: [{ id: "30000000-0000-0000-0000-000000000010", name: "Free", price_monthly: 0, price_yearly: 0, features: { papers_per_month: 5 }, is_active: true }],
  subscriptions: [{ id: "30000000-0000-0000-0000-000000000011", tenant_id: TENANT, status: "TRIAL" }],
  exams: [{ id: ids.exam, name: "JEE Main", code: "jee-main", exam_type: "ENGINEERING", is_active: true, tenant_id: PLATFORM }],
  subjects: [{ id: ids.subject, name: "Physics", code: "physics", exam_id: ids.exam, tenant_id: PLATFORM }],
  chapters: [{ id: ids.chapter, name: "Kinematics", code: "kinematics", subject_id: ids.subject, tenant_id: PLATFORM }],
  topics: [{ id: ids.topic, name: "Motion in 1D", code: "motion-1d", chapter_id: ids.chapter, tenant_id: PLATFORM }],
  question_types: [{ id: ids.type, code: "MCQ_SINGLE", name: "Single Correct MCQ", is_active: true }, { id: "10000000-0000-0000-0000-000000000006", code: "NUMERICAL", name: "Numerical Answer", is_active: true }],
  questions: [
    { id: ids.q1, tenant_id: PLATFORM, exam_id: ids.exam, subject_id: ids.subject, chapter_id: ids.chapter, topic_id: ids.topic, question_type_id: ids.type, question_text: "<p>What is 2+2?</p>", year: 2024, difficulty: "EASY", verification_status: "VERIFIED", is_deleted: false, ncert: false, marks: 4, negative_marks: 1, question_hash: "hash1", created_at: "2026-01-01T00:00:00Z", exams: { name: "JEE Main" }, subjects: { name: "Physics" }, chapters: { name: "Kinematics" }, question_types: { name: "Single Correct MCQ" } },
    { id: ids.q2, tenant_id: PLATFORM, exam_id: ids.exam, subject_id: ids.subject, chapter_id: ids.chapter, topic_id: ids.topic, question_type_id: ids.type, question_text: "<p>What is 3+3?</p>", year: 2023, difficulty: "MEDIUM", verification_status: "PENDING_REVIEW", is_deleted: false, ncert: true, marks: 4, negative_marks: 1, question_hash: "hash2", created_at: "2026-01-02T00:00:00Z", exams: { name: "JEE Main" }, subjects: { name: "Physics" }, chapters: { name: "Kinematics" }, question_types: { name: "Single Correct MCQ" } },
    { id: "10000000-0000-0000-0000-000000000099", tenant_id: OTHER_TENANT, exam_id: ids.exam, subject_id: ids.subject, chapter_id: "10000000-0000-0000-0000-0000000000ff", topic_id: "10000000-0000-0000-0000-0000000000ff", question_type_id: ids.type, question_text: "<p>Foreign tenant question</p>", year: 2025, difficulty: "HARD", verification_status: "VERIFIED", is_deleted: false, ncert: false, marks: 4, negative_marks: 1, question_hash: "hash99", created_at: "2026-01-09T00:00:00Z", exams: { name: "JEE Main" }, subjects: { name: "Physics" }, chapters: { name: "Foreign Chapter" }, question_types: { name: "Single Correct MCQ" } },
  ],
  question_options: [
    { id: "40000000-0000-0000-0000-000000000001", question_id: ids.q1, option_key: "A", option_text: "4", is_correct: true, display_order: 1 },
    { id: "40000000-0000-0000-0000-000000000002", question_id: ids.q1, option_key: "B", option_text: "5", is_correct: false, display_order: 2 },
  ],
  question_answers: [{ id: "40000000-0000-0000-0000-000000000010", question_id: ids.q1, correct_option_keys: ["A"], explanation: "Addition" }],
  solutions: [{ id: "40000000-0000-0000-0000-000000000020", question_id: ids.q1, solution_text: "2+2=4.", concept: "Arithmetic" }],
  practice_logs: [{ id: "40000000-0000-0000-0000-000000000030", user_id: UID, question_id: ids.q1, correct: false, time_spent: 30, created_at: "2026-01-03T00:00:00Z", questions: { id: ids.q1, question_text: "What is 2+2?", difficulty: "EASY", topics: { id: ids.topic, name: "Motion in 1D", chapters: { name: "Kinematics", subjects: { name: "Physics" } } }, subjects: { name: "Physics" }, chapters: { name: "Kinematics", subjects: { name: "Physics" } } } }],
  bookmarks: [{ id: "40000000-0000-0000-0000-000000000040", user_id: UID, question_id: ids.q1, created_at: "2026-01-03T00:00:00Z", questions: { id: ids.q1, question_text: "What is 2+2?", difficulty: "EASY", marks: 4 } }],
  papers: [{ id: ids.paper, tenant_id: TENANT, exam_id: ids.exam, title: "Mock Paper", status: "LOCKED", total_questions: 1, total_marks: 4, duration_minutes: 180, exam_pattern_id: ids.pattern, created_at: "2026-01-04T00:00:00Z" }],
  paper_questions: [{ id: ids.pq, tenant_id: TENANT, paper_id: ids.paper, question_id: ids.q1, question_order: 1, marks: 4, negative_marks: 1, snapshot: qSnapshot(ids.q1, 4, 1) }],
  exam_patterns: [{ id: ids.pattern, tenant_id: PLATFORM, exam_id: ids.exam, name: "JEE Main Pattern", version: 1, is_active: true, duration_minutes: 180, default_marks: 4, default_negative_marks: 1, sections: [{ name: "Physics", subject_code: "physics", question_type_codes: ["MCQ_SINGLE"], count: 30, marks: 4, negative_marks: 1 }], created_at: "2026-01-01T00:00:00Z" }],
  exam_sessions: [{ id: ids.session, tenant_id: TENANT, paper_id: ids.paper, student_id: UID, status: "SUBMITTED", started_at: "2026-01-05T00:00:00Z", ends_at: "2026-01-05T03:00:00Z", papers: { title: "Mock Paper" } }],
  results: [{ id: ids.result, tenant_id: TENANT, exam_session_id: ids.session, student_id: UID, marks: 4, total_marks: 4, percentage: 100, created_at: "2026-01-05T00:00:00Z", exam_sessions: { student_id: UID, papers: { title: "Mock Paper" } } }],
  responses: [{ id: "40000000-0000-0000-0000-000000000050", tenant_id: TENANT, exam_session_id: ids.session, question_id: ids.q1, selected_options: ["A"], marked_for_review: false, answered_at: "2026-01-05T00:00:00Z" }],
  dpps: [{ id: ids.dpp, tenant_id: TENANT, title: "Mock DPP", status: "PUBLISHED", target_date: "2026-01-10", created_at: "2026-01-06T00:00:00Z" }],
  dpp_questions: [{ id: "40000000-0000-0000-0000-000000000060", dpp_id: ids.dpp, question_id: ids.q1, question_order: 1, questions: { question_text: "What is 2+2?", difficulty: "EASY" } }],
  omr_templates: [{ id: ids.tpl, tenant_id: TENANT, name: "JEE Template", exam_id: ids.exam, total_questions: 1, options_per_question: 4, template_config: {}, created_at: "2026-01-01T00:00:00Z" }],
  omr_sheets: [{ id: ids.sheet, tenant_id: TENANT, template_id: ids.tpl, paper_id: ids.paper, roll_number: "QA001", status: "PENDING", marks: null, total_marks: null, correct_count: null, incorrect_count: null, unanswered_count: null, image_object_key: "qa/scan.png", scan_config: {}, created_at: "2026-01-02T00:00:00Z", omr_templates: { name: "JEE Template" }, papers: { title: "Mock Paper" } }],
  omr_responses: [],
  institutions: [],
  branches: [],
  batches: [{ id: ids.batch, tenant_id: TENANT, branch_id: null, name: "Batch A", exam_id: ids.exam, start_date: "2026-01-01", is_deleted: false, created_at: "2026-01-01T00:00:00Z" }],
  teachers: [{ id: "10000000-0000-0000-0000-000000000020", tenant_id: TENANT, auth_user_id: UID, full_name: "QA Teacher", email: "qa@exampro.test", subject_ids: [ids.subject], status: "ACTIVE", is_deleted: false, created_at: "2026-01-01T00:00:00Z" }],
  teacher_assignments: [{ id: "10000000-0000-0000-0000-000000000021", tenant_id: TENANT, teacher_id: "10000000-0000-0000-0000-000000000020", batch_id: ids.batch, subject_id: ids.subject, created_at: "2026-01-01T00:00:00Z" }],
  students: [{ id: "10000000-0000-0000-0000-000000000030", tenant_id: TENANT, full_name: "Ward Student", roll_number: "R001", email: "ward@exampro.test", class_level: "12", status: "ACTIVE", is_deleted: false, auth_user_id: "90000000-0000-0000-0000-000000000001", created_at: "2026-01-01T00:00:00Z" }],
  parents: [{ id: "10000000-0000-0000-0000-000000000031", tenant_id: TENANT, student_id: "10000000-0000-0000-0000-000000000030", name: "QA Parent", email: "qa@exampro.test", relation: "PARENT", auth_user_id: UID, created_at: "2026-01-01T00:00:00Z", students: { full_name: "Ward Student", roll_number: "R001" } }],
  formula_library: [
    { id: "80000000-0000-0000-0000-000000000001", tenant_id: PLATFORM, subject_code: "PHY", chapter: "Kinematics", topic: "Motion in a straight line", title: "Uniform acceleration velocity", formula_latex: "v = u + at", formula_plain: "v = u + at", variables: [{ symbol: "u", meaning: "initial velocity", unit: "m/s" }], units: "SI", conditions: "Constant acceleration only", verification_status: "VERIFIED", is_deleted: false, created_at: "2026-01-01T00:00:00Z" },
    { id: "80000000-0000-0000-0000-000000000002", tenant_id: PLATFORM, subject_code: "MAT", chapter: "Probability", topic: "Basics", title: "Complement rule", formula_latex: "P(A') = 1 - P(A)", formula_plain: "P(not A) = 1 - P(A)", variables: [], units: null, conditions: null, verification_status: "PENDING_REVIEW", is_deleted: false, created_at: "2026-01-02T00:00:00Z" },
  ],
  student_batches: [],
  student_groups: [],
  student_group_members: [],
  notifications: [{ id: "40000000-0000-0000-0000-000000000070", user_id: UID, title: "Welcome", body: "Welcome to ExamPro", is_read: false, created_at: "2026-01-01T00:00:00Z" }],
  system_config: [{ key: "free_quota", value: { PAPERS_GENERATED: 5, DPP_GENERATED: 10 } }, { key: "edge_functions_available", value: { enabled: true } }],
  security_events: [],
  audit_logs: [],
  usage: [],
  storage_objects: [],
  storage_alerts: [],
  storage_folders: [{ id: "60000000-0000-0000-0000-000000000001", tenant_id: null, provider: "GOOGLE_DRIVE", folder_type: "ROOT", drive_folder_id: "mock-root-id", name: "ExamPro", path: "ExamPro", created_at: "2026-01-01T00:00:00Z" }],
  question_usage: [{ id: "40000000-0000-0000-0000-000000000080", tenant_id: TENANT, question_id: ids.q1, used_in_type: "PAPER", used_in_id: ids.paper }],
  question_reviews: [],
  question_duplicates: [],
  question_sources: [],
  leads: [],
  sales_orders: [],
  gst_records: [],
  invoices: [],
  payments: [],
  exam_assignments: [],
  dpp_assignments: [],
  dpp_templates: [],
  blueprint_rules: [],
  paper_blueprints: [],
  students_roster: [],
};

const rpcs: Record<string, (body: any) => any> = {
  app_question_snapshot: (b) => qSnapshot(b.p_qid, b.p_marks, b.p_neg),
  app_generate_paper: () => (mockState.quotaOk
    ? { paper_id: ids.paper, questions: 1, total_marks: 4, already: false }
    : { error: "Free paper quota reached (5/month). Upgrade plan to generate more." }),
  app_generate_dpp: () => (mockState.quotaOk
    ? { dpp_id: ids.dpp, questions: 1 }
    : { error: "Free DPP quota reached (10/month). Upgrade plan to generate more." }),
  app_finalize_session: (b) => {
    const sess = (tables.exam_sessions || []).find((s) => s.id === (b && b.p_session_id));
    if (sess) sess.status = "SUBMITTED";
    tables.results = tables.results || [];
    tables.results.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
      tenant_id: TENANT,
      exam_session_id: b && b.p_session_id,
      student_id: UID,
      marks: 4,
      total_marks: 4,
      percentage: 100,
      accuracy: 100,
      correct: 1,
      incorrect: 0,
      unanswered: 0,
      snapshot: { items: [{ answered: true, correct: true }] },
      created_at: new Date().toISOString(),
      exam_sessions: { student_id: UID, papers: { title: "Mock Paper" } },
    });
    return { correct: 1, incorrect: 0, unanswered: 0, marks: 4, already: false };
  },
  app_save_response: (b) => {
    const row = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
      tenant_id: TENANT,
      exam_session_id: b && b.p_session_id,
      question_id: b && b.p_question_id,
      selected_options: (b && b.p_options) || [],
      marked_for_review: Boolean(b && b.p_marked),
      answered_at: new Date().toISOString(),
    };
    tables.responses = tables.responses || [];
    tables.responses = tables.responses.filter((r) => !(r.exam_session_id === row.exam_session_id && r.question_id === row.question_id));
    tables.responses.push(row);
    return { ok: true };
  },
  app_log_practice: () => ({ ok: true }),
  app_verify_question: (b) => {
    const q = (tables.questions || []).find((x) => x.id === (b && b.p_question_id));
    if (q && b && b.p_decision) q.verification_status = b.p_decision;
    return { ok: true };
  },
  app_log_security_event: () => ({ ok: true }),
  app_evaluate_omr_sheet: (b) => {
    const sheet = (tables.omr_sheets || []).find((s) => s.id === (b && b.p_sheet_id));
    if (sheet) {
      sheet.status = "EVALUATED";
      sheet.marks = 4;
      sheet.total_marks = 4;
      sheet.correct_count = 1;
      sheet.incorrect_count = 0;
      sheet.unanswered_count = 0;
      sheet.evaluated_at = new Date().toISOString();
    }
    return { ok: true, correct: 1, incorrect: 0, unanswered: 0, marks: 4, total_marks: 4 };
  },
  app_data_quality: () => ({ total: 2, verified: 1, pending: 1, rejected: 0, needs_edit: 0, deleted: 0, no_exam: 0, no_chapter: 0, no_topic: 0, no_type: 0, missing_answer: 0, missing_solution: 0, duplicate_pairs_open: 0, recent_reviews: 0 }),
  app_system_health: () => ({ auth_users: 1, tenants: 1, questions: 2, papers: 1, dpps: 1, results: 1, exam_sessions: 1, responses: 1, omr_sheets: 1, students_roster: 0, teachers: 0, import_jobs: 0, notifications: 1, storage_objects: 0, audit_logs: 0, security_events: 0, usage_rows: 0, active_sessions_24h: 1, subscriptions_trial: 1, subscriptions_active: 0, checked_at: new Date().toISOString() }),
  app_import_questions_batch: (b) => ({ imported: Array.isArray(b.p_items) ? b.p_items.length : 0, duplicates: 0, failed: 0, total: Array.isArray(b.p_items) ? b.p_items.length : 0, errors: [] }),
  app_create_tenant: () => ({ tenant_id: "50000000-0000-0000-0000-000000000001" }),
  app_update_tenant_status: () => ({ ok: true }),
  app_security_events: () => [],
  app_my_weak_topics: () => ([]),
  app_parent_dashboard: () => (mockState.parentLinked
    ? {
        linked: true,
        ward: { id: "10000000-0000-0000-0000-000000000030", name: "Ward Student", roll_number: "R001", email: "ward@exampro.test", class_level: "12" },
        results: [{ id: ids.result, marks: 4, total_marks: 4, correct: 1, incorrect: 0, unanswered: 0, percentage: 100, created_at: "2026-01-05T00:00:00Z", paper_title: "Mock Paper" }],
        weak_topics: [{ topic_id: ids.topic, topic_name: "Motion in 1D", accuracy: 40, attempts: 5 }],
        sessions: [{ id: ids.session, status: "SUBMITTED", started_at: "2026-01-05T00:00:00Z", ends_at: "2026-01-05T03:00:00Z", paper_title: "Mock Paper" }],
        assignments: [{ id: "40000000-0000-0000-0000-000000000090", due_at: "2026-02-01T00:00:00Z", assignee_type: "STUDENT", paper_title: "Mock Paper" }],
        dpps: [{ id: ids.dpp, title: "Mock DPP", created_at: "2026-01-06T00:00:00Z" }],
      }
    : { linked: false }),
  app_storage_health: () => ({
    total_files: 0, total_size_bytes: 0, source_documents: 0, question_images: 0,
    generated_papers: 0, answer_keys: 0, solutions: 0, omr: 0, reports: 0,
    duplicates: 0, orphan_records: 0, missing_files: 0, open_alerts: 0,
    critical_alerts: 0, checked_at: new Date().toISOString(),
  }),
};

// ---- Edge function responses ----
const edgeFunctions: Record<string, (body: any) => any> = {
  "drive-health": () => ({
    connected: true, provider: "GOOGLE_DRIVE", account: "exampro1012@gmail.com",
    rootFolder: { name: "ExamPro", drive_folder_id: "mock-root-id" },
    folders: [{ folder_type: "ROOT", name: "ExamPro", drive_folder_id: "mock-root-id" }],
    stats: { totalFiles: 0, activeFiles: 0, totalSizeBytes: 0, byMimeType: {} },
    lastError: null, checkedAt: new Date().toISOString(),
  }),
  "drive-init": () => ({ created: [], skipped: [{ type: "ROOT", drive_folder_id: "mock-root-id" }], total: 13 }),
  "drive-audit": () => ({ totalRecords: 0, orphanDb: 0, orphanDrive: 0, duplicates: 0, details: { orphanDb: [], orphanDrive: [], duplicates: [] }, checkedAt: new Date().toISOString() }),
  "drive-upload": (b) => ({ created: true, object: { id: "70000000-0000-0000-0000-000000000001", drive_file_id: "mock-drive-file-id", object_key: b?.file?.name || "file", created_at: new Date().toISOString() }, drive: { id: "mock-drive-file-id", name: b?.file?.name || "file", parentId: "mock-root-id", webViewLink: "https://drive.google.com/file/d/mock-drive-file-id/view" } }),
  "drive-download": () => ({ downloadUrl: "https://drive.google.com/uc?id=mock-drive-file-id&export=download", webViewLink: "https://drive.google.com/file/d/mock-drive-file-id/view", original_filename: "file.pdf", size_bytes: 1024 }),
  "drive-delete": () => ({ deleted: true, fileId: "mock-drive-file-id" }),
  "drive-metadata": () => ({ id: "mock-drive-file-id", name: "file.pdf", mimeType: "application/pdf", size: "1024", webViewLink: "https://drive.google.com/file/d/mock-drive-file-id/view" }),
  "drive-list": () => ({ files: [], nextPageToken: null }),
  "drive-track": () => ({ tracked: true, object: { id: "70000000-0000-0000-0000-000000000002" } }),
  "drive-save-paper": () => ({ success: true, drive_file_id: "mock-drive-file-id", storage_object_id: "70000000-0000-0000-0000-000000000003", webViewLink: "https://drive.google.com/file/d/mock-drive-file-id/view", kind: "paper" }),
  "drive-save-dpp": () => ({ success: true, drive_file_id: "mock-drive-file-id", storage_object_id: "70000000-0000-0000-0000-000000000004", webViewLink: "https://drive.google.com/file/d/mock-drive-file-id/view" }),
  "google-drive-oauth": (b) => {
    const action = (b && b.action) || "";
    if (action === "start") return { url: "https://accounts.google.com/o/oauth2/auth?client_id=mock&redirect_uri=mock", connected: false };
    if (action === "status") return { connected: false, account: null };
    if (action === "disconnect") return { disconnected: true };
    return { error: "unknown action" };
  },
};

// ---------------------------------------------------------------------------
export function installMocks(page: Page): void {
  page.addInitScript((cfg) => {
    localStorage.setItem("exampro_config_v2", JSON.stringify(cfg));
  }, { url: "https://mock.supabase.co", anonKey: "mock-anon-key" });

  page.route("**mock.supabase.co/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    try {
      if (method === "OPTIONS") {
        return route.fulfill({ status: 204, headers: CORS });
      }

      // ---- Auth ----
      const authPath = path.replace(/^\/auth\/v1/, "") || path;
      
      if ((path === "/auth/v1/settings" || authPath === "/settings") && method === "GET") {
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ external: { google: googleEnabled }, disable_signup: false, mailer_autoconfirm: true }) });
      }
      if ((path === "/auth/v1/token" || authPath === "/token") && method === "POST") {
        await new Promise(r => setTimeout(r, 120));
        const session = {
          access_token: jwt(), token_type: "bearer", expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "mock-refresh",
          user: {
            id: UID, aud: "authenticated", role: "authenticated", email: "qa@exampro.test",
            app_metadata: { provider: "email", role: "authenticated" },
            user_metadata: { full_name: "QA User" }, created_at: "2026-01-01T00:00:00Z",
          },
        };
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(session) });
      }
      if ((path === "/auth/v1/session" || authPath === "/session") && method === "GET") {
        const authHeader = req.headers()["authorization"] || "";
        if (authHeader.indexOf("Bearer ") >= 0) {
          const session = {
            access_token: jwt(), token_type: "bearer", expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "mock-refresh",
            user: {
              id: UID, aud: "authenticated", role: "authenticated", email: "qa@exampro.test",
              app_metadata: { provider: "email", role: "authenticated" },
              user_metadata: { full_name: "QA User" }, created_at: "2026-01-01T00:00:00Z",
            },
          };
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ data: { session }, error: null }) });
        }
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ data: { session: null }, error: null }) });
      }
      if ((path === "/auth/v1/user" || authPath === "/user") && method === "GET") {
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ id: UID, role: "authenticated", email: "qa@exampro.test", app_metadata: { provider: "email" }, user_metadata: { full_name: "QA User" } }) });
      }
      if ((path === "/auth/v1/user" || authPath === "/user") && method === "PATCH") {
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ id: UID, role: "authenticated", email: "qa@exampro.test", app_metadata: { provider: "email" }, user_metadata: { full_name: "QA User" } }) });
      }
      if ((path === "/auth/v1/signup" || authPath === "/signup") && method === "POST") {
        await new Promise(r => setTimeout(r, 120));
        const session = {
          access_token: jwt(), token_type: "bearer", expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "mock-refresh",
          user: {
            id: UID, aud: "authenticated", role: "authenticated", email: "qa@exampro.test",
            app_metadata: { provider: "email", role: "authenticated" },
            user_metadata: { full_name: "QA User" }, created_at: "2026-01-01T00:00:00Z",
          },
        };
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(session) });
      }
      if ((path === "/auth/v1/recover" || authPath === "/recover") && method === "POST") {
        return fulfill(route, { status: 200, contentType: "application/json", body: "{}" });
      }
      if ((path === "/auth/v1/resend" || authPath === "/resend") && method === "POST") {
        return fulfill(route, { status: 200, contentType: "application/json", body: "{}" });
      }
      if ((path === "/auth/v1/user/identities" || authPath === "/user/identities") && method === "GET") {
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ identities: tables.user_identities || [] }) });
      }
      if ((path === "/auth/v1/user/identities" || authPath === "/user/identities") && method === "POST") {
        const body = req.postDataJSON ? req.postDataJSON() : {};
        const newId = { id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()), user_id: UID, provider: body.provider || "google", provider_user_id: "mock-google-id", provider_email: "qa@gmail.com", provider_data: {} };
        (tables.user_identities = tables.user_identities || []).push(newId);
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ identities: tables.user_identities }) });
      }
      if ((path.startsWith("/auth/v1/user/identities/") || path.startsWith("/user/identities/")) && method === "DELETE") {
        const idToDelete = path.split("/").pop();
        tables.user_identities = (tables.user_identities || []).filter((i) => String(i.id) !== String(idToDelete));
        return fulfill(route, { status: 200, contentType: "application/json", body: "{}" });
      }
      if ((path === "/auth/v1/logout" || authPath === "/logout") && method === "POST") {
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ message: "Successfully logged out" }) });
      }

      // ---- Edge Functions ----
      const fnMatch = path.match(/^\/functions\/v1\/([^/]+)/);
      if (fnMatch) {
        const name = fnMatch[1];
        const fn = edgeFunctions[name];
        if (fn) {
          let body: any = null;
          try { body = req.postDataJSON(); } catch (_) {
            try { body = JSON.parse(req.postData() || "{}"); } catch (__) { body = null; }
          }
          const result = fn(body);
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(result) });
        }
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ error: "function not found" }) });
      }

      // ---- Storage ----
      if (path.startsWith("/storage/v1/object/sign/")) {
        const bucket = path.split("/object/sign/")[1].split("/")[0];
        const key = path.split("/object/sign/")[1].split("/").slice(1).join("/");
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ signedURL: `https://mock.supabase.co/storage/v1/object/sign/${bucket}/${key}?token=mock` }) });
      }
      if (path.startsWith("/storage/v1/object/") && method === "POST") {
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ Key: path.split("/object/")[1], Id: "mock-id" }) });
      }

      // ---- PostgREST RPC ----
      const rpcMatch = path.match(/^\/rest\/v1\/rpc\/([^/]+)/);
      if (rpcMatch) {
        const name = rpcMatch[1];
        if (name === "app_quota_available") {
          return fulfill(route, { status: 200, contentType: "application/json", body: String(mockState.quotaOk) });
        }
        const fn = rpcs[name];
        if (fn) {
          const result = fn(req.postDataJSON ? req.postDataJSON() : null);
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(result) });
        }
        return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }

      // ---- PostgREST tables ----
      const tblMatch = path.match(/^\/rest\/v1\/([^/?]+)/);
      if (tblMatch) {
        const table = tblMatch[1];

        // ---- Identity (membership / roles / perms) resolves from mockState ----
        if (table === "tenant_memberships") {
          const mem = {
            id: "20000000-0000-0000-0000-000000000001",
            tenant_id: mockState.tenant,
            user_id: UID,
            role_id: ROLE_IDS[mockState.role] || ROLE_IDS.STUDENT,
            status: "ACTIVE",
            roles: roleRow(mockState.role),
          };
          const accept = req.headers()["accept"] || "";
          const isObject = accept.indexOf("application/vnd.pgrst.object+json") >= 0;
          if (isObject) return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(mem) });
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify([mem]) });
        }
        if (table === "role_permissions") {
          const rows = rolePermsFor(mockState.role);
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        }
        if (table === "permissions") {
          const rows = (tables.permissions || []).map((p) => ({ code: p.code }));
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        }
        if (table === "platform_admins") {
          const rows = mockState.isSuper ? [{ user_id: UID }] : [];
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        }
        if (table === "roles") {
          const rows = mockState.role === "SUPER_ADMIN" ? tables.roles : [roleRow(mockState.role), roleRow("TEACHER"), roleRow("STUDENT")];
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        }

        const accept = req.headers()["accept"] || "";
        const prefer = req.headers()["prefer"] || "";
        const isObject = accept.indexOf("application/vnd.pgrst.object+json") >= 0;
        const isHead = prefer.indexOf("count=exact") >= 0 && (req.url().indexOf("limit=0") >= 0 || req.url().indexOf("head=true") >= 0 || method === "HEAD");

        // RLS simulation: anonymous callers get 401 on protected reads;
        // tenant-scoped reads are filtered to the session tenant + platform bank.
        const anon = !(req.headers()["authorization"] || "").startsWith("Bearer ");
        if (anon && mockState.anonDenied && method !== "OPTIONS") {
          return fulfill(route, { status: 401, contentType: "application/json", body: JSON.stringify({ code: "PGRST301", message: "permission denied for table " + table, details: null, hint: null }) });
        }
        let rows = tables[table] || [];
        if (mockState.rlsMode === "tenant" && TENANT_SCOPED.has(table)) {
          rows = rows.filter((r) => isPlatformReadable(r) || r.tenant_id === mockState.tenant);
        }
        // student-only roles see only their own rows (mirrors 0011 policies)
        if ((mockState.role === "STUDENT" || mockState.role === "PARENT") && mockState.rlsMode === "tenant") {
          if (table === "results" || table === "exam_sessions" || table === "responses") {
            rows = rows.filter((r) => !r.student_id || String(r.student_id) === UID);
          }
          if (table === "student_notes" || table === "notifications") {
            rows = rows.filter((r) => !r.user_id || String(r.user_id) === UID);
          }
        }

        if (method === "POST") {
          const body = req.postDataJSON ? req.postDataJSON() : null;
          const isArr = Array.isArray(body);
          const ins = isArr ? body : [body || {}];
          const store = tables[table] || (tables[table] = []);
          ins.forEach((r) => {
            if (!r.id) r.id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
            if (!r.created_at) r.created_at = new Date().toISOString();
            if (table === "exam_assignments") {
              const pp = (tables.papers || []).find((p) => p.id === r.paper_id);
              const bb = (tables.batches || []).find((b) => b.id === r.assignee_id);
              if (pp) r.papers = { title: pp.title };
              if (bb) r.batches = { name: bb.name };
            }
            store.push(r);
          });
          if (isObject) return fulfill(route, { status: 201, contentType: "application/json", body: JSON.stringify(ins[ins.length - 1]) });
          if (!isArr) return fulfill(route, { status: 201, contentType: "application/json", body: JSON.stringify(ins[0]) });
          return fulfill(route, { status: 201, contentType: "application/json", body: JSON.stringify(ins) });
        }
        if (method === "PATCH") {
          if (isObject) return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(rows[0] || {}) });
          return fulfill(route, { status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        }
        if (method === "DELETE") {
          return fulfill(route, { status: 200, contentType: "application/json", body: "[]" });
        }

        url.searchParams.forEach((v, k) => {
          if (v.startsWith("eq.") && k.indexOf("=") < 0) {
            const val = v.slice(3);
            rows = rows.filter((r) => String(r[k]) === val);
          }
        });
        // PostgREST `or=(col.ilike.%term%,other.ilike.%term%)` — implicit OR,
        // used by the question/formula search bars. Unknown operators pass
        // (mock leniency) so features stay testable on older mock rows.
        const orExpr = url.searchParams.get("or");
        if (orExpr) {
          const inner = String(orExpr).replace(/^\(/, "").replace(/\)$/, "");
          const conds = inner.split(",").filter(Boolean);
          const evalCond = (row: any, cond: string) => {
            const m = cond.match(/^([\w.]+)\.ilike\.(%?)(.*?)\2$/);
            if (!m) return true;
            const term = String(m[3] || "").toLowerCase();
            if (!term) return false;
            const keys = m[1].split(".").filter(Boolean);
            const val = keys.reduce((acc: any, k) => (acc && typeof acc === "object" ? acc[k] : undefined), row);
            return String(val == null ? "" : val).toLowerCase().includes(term);
          };
          rows = rows.filter((r) => conds.some((c) => evalCond(r, c)));
        }
        if (url.searchParams.has("order") && rows.length > 1) {
          const order = String(url.searchParams.get("order"));
          const [f, dir] = order.split(".");
          const mult = dir === "desc" ? -1 : 1;
          rows = rows.slice().sort((a, b) => (String(a[f] || "") > String(b[f] || "") ? mult : -mult));
        }
        const count = rows.length;
        if (isHead) {
          return fulfill(route, { status: 200, contentType: "application/json", headers: { "Prefer": "count=exact", "Content-Range": `0-0/${count}` }, body: "[]" });
        }
        const headers: Record<string, string> = {};
        if (prefer.indexOf("count=exact") >= 0 || url.searchParams.get("count") === "exact" || req.url().indexOf("count=exact") >= 0) {
          headers["Prefer"] = "count=exact";
          headers["Content-Range"] = `0-${Math.max(0, count - 1)}/${count}`;
        }
        if (isObject) {
          if (rows.length === 0) {
            return fulfill(route, { status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "The result contains 0 rows", details: null }) });
          }
          return fulfill(route, { status: 200, contentType: "application/json", headers, body: JSON.stringify(rows[0]) });
        }
        return fulfill(route, { status: 200, contentType: "application/json", headers, body: JSON.stringify(rows) });
      }

      return fulfill(route, { status: 200, contentType: "application/json", body: "{}" });
    } catch (e: any) {
      return fulfill(route, { status: 500, contentType: "application/json", body: JSON.stringify({ message: String(e && e.message || e) }) });
    }
  });
}
