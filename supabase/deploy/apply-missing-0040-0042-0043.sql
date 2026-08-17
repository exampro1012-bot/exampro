-- =============================================================================
-- ExamPro — LIVE DEPLOYMENT SCRIPT (missing migration components)
-- =============================================================================
-- Author: automated deployment pack (2026-08-16)
--
-- Live DB status BEFORE this script (verified by probe-schema.mjs 2026-08-16):
--   migrations 0001..0038 are fully applied; 0040, 0042, 0043 were NOT applied.
--   Missing live objects (verified via plain GET probes):
--     tables:   official_source_domains, source_crawler_log, syllabus_versions,
--               question_syllabus_map (0040),
--               google_drive_oauth_tokens (0042),
--               formula_library, question_translations (0043)
--     columns:  omr_sheets.scan_config (0043 section 5)
--     functions: app_is_platform_admin(uuid) (0043 section 1),
--                app_parent_dashboard() (0043 section 6)
--
-- HOW TO APPLY (pick ONE — requires DB/owner access; not available in this repo):
--   Option A: supabase db push        (needs: supabase login or SUPABASE_ACCESS_TOKEN)
--   Option B: Dashboard > SQL Editor  (paste this file; run)  [preferred for single use]
--   Option C: psql "$DATABASE_URL" -f apply-missing-0040-0042-0043.sql
-- After applying, reload the schema cache so PostgREST sees the new objects:
--   notify pgrst, 'reload schema';
--
-- SAFETY: every statement is idempotent (if not exists / drop ... if exists /
-- create or replace / on conflict do nothing). Safe to re-run.
--
-- DEPENDENCY ORDER (matters):
--   §1 0043 app_is_platform_admin(uuid) MUST exist before the 0042 RLS policy
--      references it (policy bodies are parsed at create time).
--   §2 0042 google_drive_oauth_tokens (policy uses the §1 overload).
--   §3 0040 official-source/syllabus registry (uses app_is_platform_admin()
--      zero-arg from 0002 and app_current_tenant_id() from 0002 — both live).
--   §4 0043 formula_library + question_translations + RLS tightening +
--      scan_config + app_parent_dashboard (uses app_can_access_tenant,
--      app_can_read_content, app_user_has_student_only_role(tenant_id),
--      set_updated_at — all live).
--
-- POST-APPLY VERIFICATION: node probe-schema.mjs && node probe-rpcs.mjs
-- (expected: all tables/functions present; the parent-dashboard canary test in
--  tests/supabase-features.spec.ts starts passing).
-- =============================================================================

-- =============================================================================
-- §1. 0043 section 1: app_is_platform_admin(uuid) overload
--     Required by the Drive edge functions (service-role probe) and 0042 policy.
--     Without it every admin-gated Drive call fails closed.
-- =============================================================================
create or replace function app_is_platform_admin(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins pa where pa.user_id = p_user_id)
     or exists (
       select 1 from tenant_memberships tm
       join roles r on r.id = tm.role_id
       where tm.user_id = p_user_id and tm.status = 'ACTIVE' and r.code = 'SUPER_ADMIN'
     );
$$;

-- Only the service role (edge functions) and platform policies need this
-- overload; end users must not probe arbitrary ids.
revoke execute on function app_is_platform_admin(uuid) from anon, authenticated;

-- =============================================================================
-- §2. 0042: google_drive_oauth_tokens (Drive OAuth refresh-token store)
-- =============================================================================
create table if not exists google_drive_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  provider text not null default 'GOOGLE_DRIVE',
  account text,
  refresh_token text,
  access_token text,
  expires_at timestamptz,
  scope text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

comment on table google_drive_oauth_tokens is 'OAuth refresh tokens for Google Drive access per tenant (authorization-code flow).';

create index if not exists idx_gdrive_oauth_tenant on google_drive_oauth_tokens (tenant_id, provider);

alter table google_drive_oauth_tokens enable row level security;

drop policy if exists "gdrive_oauth_admin_all" on google_drive_oauth_tokens;
create policy "gdrive_oauth_admin_all" on google_drive_oauth_tokens
  for all to authenticated
  using (app_is_platform_admin(auth.uid()))
  with check (app_is_platform_admin(auth.uid()));

drop policy if exists "gdrive_oauth_user_read_own" on google_drive_oauth_tokens;
create policy "gdrive_oauth_user_read_own" on google_drive_oauth_tokens
  for select to authenticated
  using (
    tenant_id in (
      select tenant_id from tenant_memberships
      where user_id = auth.uid() and status = 'ACTIVE'
    )
  );

create or replace function set_gdrive_oauth_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_gdrive_oauth_updated_at on google_drive_oauth_tokens;
create trigger trg_gdrive_oauth_updated_at
  before update on google_drive_oauth_tokens
  for each row execute function set_gdrive_oauth_updated_at();

-- =============================================================================
-- §3. 0040: Official Source Registry + Syllabus Registry
-- =============================================================================
create table if not exists official_source_domains (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references tenants(id) on delete cascade,
  domain          text not null,
  exam            text not null,                       -- JEE_MAIN | JEE_ADVANCED | NEET | CUET | ...
  authority       text not null default 'OFFICIAL',   -- OFFICIAL | SECONDARY
  allowed         boolean not null default true,
  crawl_policy    text not null default 'RESPECTFUL', -- RESPECTFUL | DISABLED | ARCHIVE_ONLY
  last_checked    timestamptz,
  last_status     int,                                -- last HTTP status seen
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, domain, exam)
);

create index if not exists official_source_domains_domain_idx on official_source_domains (domain);
create index if not exists official_source_domains_exam_idx   on official_source_domains (exam);

alter table official_source_domains enable row level security;

drop policy if exists official_source_domains_admin on official_source_domains;
create policy official_source_domains_admin on official_source_domains
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists official_source_domains_read on official_source_domains;
create policy official_source_domains_read on official_source_domains
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'nta.ac.in',            'JEE_MAIN',      'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='nta.ac.in' and exam='JEE_MAIN');
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'jeemain.nta.nic.in',   'JEE_MAIN',      'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='jeemain.nta.nic.in' and exam='JEE_MAIN');
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'neet.nta.nic.in',      'NEET',          'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='neet.nta.nic.in' and exam='NEET');
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'jeeadv.ac.in',         'JEE_ADVANCED',  'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='jeeadv.ac.in' and exam='JEE_ADVANCED');
insert into official_source_domains (tenant_id, domain, exam, authority, allowed, crawl_policy)
select null, 'nmc.org.in',           'NEET',          'OFFICIAL', true, 'RESPECTFUL' where not exists (select 1 from official_source_domains where domain='nmc.org.in' and exam='NEET');

create table if not exists source_crawler_log (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references tenants(id) on delete cascade,
  domain_id       uuid references official_source_domains(id) on delete set null,
  domain          text,
  url             text,
  checked_at      timestamptz not null default now(),
  http_status     int,
  document_found  boolean,
  document_hash   text,
  download_status text,     -- NOT_ATTEMPTED | SKIPPED | DOWNLOADED | FAILED
  parse_status    text,
  error           text,
  created_by      uuid references auth.users(id) on delete set null
);

create index if not exists source_crawler_log_domain_idx on source_crawler_log (domain);
create index if not exists source_crawler_log_checked_idx on source_crawler_log (checked_at desc);

alter table source_crawler_log enable row level security;

drop policy if exists source_crawler_log_admin on source_crawler_log;
create policy source_crawler_log_admin on source_crawler_log
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists source_crawler_log_read on source_crawler_log;
create policy source_crawler_log_read on source_crawler_log
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

create table if not exists syllabus_versions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references tenants(id) on delete cascade,
  exam_id           uuid references exams(id) on delete set null,
  authority         text not null,     -- NTA | NMC | JEE_ADVANCED | ...
  year              int not null,
  effective_date    date,
  version           text,
  source_url        text,
  source_document_id uuid references source_documents(id) on delete set null,
  can_lookup         boolean not null default false,
  status            text not null default 'DRAFT',  -- DRAFT | ACTIVE | ARCHIVED
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, exam_id, authority, year, version)
);

create index if not exists syllabus_versions_exam_idx on syllabus_versions (exam_id);
create index if not exists syllabus_versions_year_idx on syllabus_versions (year);

alter table syllabus_versions enable row level security;

drop policy if exists syllabus_versions_admin on syllabus_versions;
create policy syllabus_versions_admin on syllabus_versions
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists syllabus_versions_read on syllabus_versions;
create policy syllabus_versions_read on syllabus_versions
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

create table if not exists question_syllabus_map (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references tenants(id) on delete cascade,
  question_id       uuid references questions(id) on delete cascade,
  syllabus_version_id uuid references syllabus_versions(id) on delete set null,
  syllabus_status   text not null default 'UNCERTAIN', -- CURRENT | HISTORICAL | REMOVED | MODIFIED | NOT_IN_CURRENT_SYLLABUS | UNCERTAIN
  mapped_by         uuid references auth.users(id) on delete set null,
  mapped_at         timestamptz not null default now(),
  unique (question_id, syllabus_version_id)
);

create index if not exists question_syllabus_map_q_idx on question_syllabus_map (question_id);
create index if not exists question_syllabus_map_sv_idx on question_syllabus_map (syllabus_version_id);

alter table question_syllabus_map enable row level security;

drop policy if exists question_syllabus_map_admin on question_syllabus_map;
create policy question_syllabus_map_admin on question_syllabus_map
  for all to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id())
  with check (app_is_platform_admin() or tenant_id = app_current_tenant_id());

drop policy if exists question_syllabus_map_read on question_syllabus_map;
create policy question_syllabus_map_read on question_syllabus_map
  for select to authenticated
  using (app_is_platform_admin() or tenant_id = app_current_tenant_id());

-- =============================================================================
-- §4a. 0043 section 2: formula_library (shared formula reference)
-- =============================================================================
create table if not exists formula_library (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references tenants(id) on delete cascade,
  subject_code text not null check (subject_code in ('PHY','CHE','MAT','BOT','ZOO')),
  subject_id uuid references subjects(id) on delete set null,
  chapter text,
  topic text,
  title text not null,
  formula_latex text not null,
  formula_plain text,
  variables jsonb not null default '[]'::jsonb,   -- [{symbol, meaning, unit}]
  units text,
  conditions text,
  source text default 'ExamPro Reference',
  source_url text,
  verification_status text not null default 'PENDING_REVIEW'
    check (verification_status in ('VERIFIED','PENDING_REVIEW','REJECTED')),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  is_deleted boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists formula_library_tenant_idx on formula_library (tenant_id, subject_code);
create index if not exists formula_library_status_idx on formula_library (verification_status) where not is_deleted;

drop policy if exists formula_library_select on formula_library;
create policy formula_library_select on formula_library
  for select to authenticated
  using (not is_deleted and app_can_access_tenant(tenant_id));

drop policy if exists formula_library_write on formula_library;
create policy formula_library_write on formula_library
  for all to authenticated
  using (app_can_access_tenant(tenant_id)
         and (app_is_platform_admin() or not app_user_has_student_only_role(tenant_id)))
  with check (app_can_access_tenant(tenant_id)
         and (app_is_platform_admin() or not app_user_has_student_only_role(tenant_id)));

drop trigger if exists set_formula_updated_at on formula_library;
create trigger set_formula_updated_at before update on formula_library
  for each row execute function set_updated_at();

-- Seed: platform-shared, original reference formulas (no third-party content).
insert into formula_library
  (tenant_id, subject_code, chapter, topic, title, formula_latex, formula_plain,
   variables, units, conditions, verification_status, verified_at)
values
  ('00000000-0000-0000-0000-000000000001','PHY','Kinematics','Motion in a straight line',
   'Uniform acceleration velocity','v = u + at','v = u + at',
   '[{"symbol":"u","meaning":"initial velocity","unit":"m/s"},{"symbol":"v","meaning":"final velocity","unit":"m/s"},{"symbol":"a","meaning":"acceleration","unit":"m/s^2"},{"symbol":"t","meaning":"time","unit":"s"}]',
   'SI','Constant acceleration only','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Kinematics','Motion in a straight line',
   'Position under uniform acceleration','s = ut + \\frac{1}{2}at^2','s = ut + (1/2)at^2',
   '[{"symbol":"s","meaning":"displacement","unit":"m"},{"symbol":"u","meaning":"initial velocity","unit":"m/s"},{"symbol":"a","meaning":"acceleration","unit":"m/s^2"},{"symbol":"t","meaning":"time","unit":"s"}]',
   'SI','Constant acceleration only','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Kinematics','Motion in a straight line',
   'Torricelli equation','v^2 = u^2 + 2as','v^2 = u^2 + 2as',
   '[{"symbol":"v","meaning":"final velocity","unit":"m/s"},{"symbol":"u","meaning":"initial velocity","unit":"m/s"},{"symbol":"a","meaning":"acceleration","unit":"m/s^2"},{"symbol":"s","meaning":"displacement","unit":"m"}]',
   'SI','Constant acceleration, time-independent form','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Laws of Motion','Newton''s second law',
   'Force','F = ma','F = ma',
   '[{"symbol":"F","meaning":"net force","unit":"N"},{"symbol":"m","meaning":"mass","unit":"kg"},{"symbol":"a","meaning":"acceleration","unit":"m/s^2"}]',
   'SI','Inertial frame; relativistic speeds excluded','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Work, Energy and Power','Work-energy theorem',
   'Work done','W = F s \\cos\\theta','W = F s cos(theta)',
   '[{"symbol":"W","meaning":"work","unit":"J"},{"symbol":"F","meaning":"force magnitude","unit":"N"},{"symbol":"s","meaning":"displacement magnitude","unit":"m"},{"symbol":"theta","meaning":"angle between F and s","unit":"rad"}]',
   'SI','Constant force along straight displacement','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Gravitation','Newton''s law of gravitation',
   'Gravitational force','F = \\frac{G m_1 m_2}{r^2}','F = G m1 m2 / r^2',
   '[{"symbol":"F","meaning":"gravitational force","unit":"N"},{"symbol":"G","meaning":"gravitational constant","unit":"6.674e-11 N m^2/kg^2"},{"symbol":"m1, m2","meaning":"masses","unit":"kg"},{"symbol":"r","meaning":"separation between centres","unit":"m"}]',
   'SI','Point masses or uniform spheres','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Electrostatics','Coulomb''s law',
   'Electrostatic force','F = \\frac{1}{4\\pi\\varepsilon_0}\\frac{q_1 q_2}{r^2}','F = k q1 q2 / r^2',
   '[{"symbol":"F","meaning":"force between charges","unit":"N"},{"symbol":"q1, q2","meaning":"charges","unit":"C"},{"symbol":"r","meaning":"separation","unit":"m"},{"symbol":"eps0","meaning":"vacuum permittivity","unit":"8.854e-12 C^2/(N m^2)"}]',
   'SI','Point charges in vacuum','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Current Electricity','Ohm''s law',
   'Voltage-current relation','V = IR','V = IR',
   '[{"symbol":"V","meaning":"potential difference","unit":"V"},{"symbol":"I","meaning":"current","unit":"A"},{"symbol":"R","meaning":"resistance","unit":"ohm"}]',
   'SI','Ohmic conductors at constant temperature','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Optics','Mirror formula',
   'Spherical mirror','\\frac{1}{v} + \\frac{1}{u} = \\frac{1}{f}','1/v + 1/u = 1/f',
   '[{"symbol":"u","meaning":"object distance","unit":"m"},{"symbol":"v","meaning":"image distance","unit":"m"},{"symbol":"f","meaning":"focal length","unit":"m"}]',
   'SI','Sign convention: distances measured from pole','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','PHY','Modern Physics','Photoelectric effect',
   'Einstein equation','K_{max} = h\\nu - \\phi','Kmax = h nu - phi',
   '[{"symbol":"Kmax","meaning":"maximum kinetic energy of photoelectron","unit":"J or eV"},{"symbol":"h","meaning":"Planck constant","unit":"6.626e-34 J s"},{"symbol":"nu","meaning":"frequency of incident light","unit":"Hz"},{"symbol":"phi","meaning":"work function","unit":"J or eV"}]',
   'SI','nu must exceed threshold frequency','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','CHE','Atomic Structure','Bohr model',
   'Radius of nth orbit','r_n = \\frac{n^2 h^2 \\varepsilon_0}{\\pi m e^2} = 0.529\\,n^2\\ \\text{Å}','rn = 0.529 n^2 Angstrom',
   '[{"symbol":"n","meaning":"principal quantum number","unit":"dimensionless"},{"symbol":"rn","meaning":"orbit radius","unit":"m"}]',
   'SI','Hydrogen-like single-electron species','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','CHE','Thermodynamics','Enthalpy',
   'First law','\\Delta H = \\Delta U + \\Delta(PV)','dH = dU + d(PV)',
   '[{"symbol":"H","meaning":"enthalpy","unit":"kJ/mol"},{"symbol":"U","meaning":"internal energy","unit":"kJ/mol"},{"symbol":"P","meaning":"pressure","unit":"atm or Pa"},{"symbol":"V","meaning":"volume","unit":"L or m^3"}]',
   'SI','State function; constant-pressure heat equals dH','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','CHE','Equilibrium','Chemical equilibrium',
   'Equilibrium constant','K_c = \\frac{[C]^c[D]^d}{[A]^a[B]^b}','Kc = products/reactants (molar concentrations)',
   '[{"symbol":"Kc","meaning":"equilibrium constant (concentration)","unit":"varies with expression"},{"symbol":"[X]","meaning":"molar concentration at equilibrium","unit":"mol/L"}]',
   '—','For reaction aA + bB ⇌ cC + dD','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','CHE','Electrochemistry','Nernst equation',
   'Cell potential','E = E^{\\circ} - \\frac{RT}{nF}\\ln Q','E = E0 - (RT/nF) ln Q',
   '[{"symbol":"E","meaning":"cell potential","unit":"V"},{"symbol":"E0","meaning":"standard cell potential","unit":"V"},{"symbol":"n","meaning":"moles of electrons transferred","unit":"dimensionless"},{"symbol":"F","meaning":"Faraday constant","unit":"96485 C/mol"},{"symbol":"Q","meaning":"reaction quotient","unit":"varies"}]',
   'SI','298 K: E = E0 - (0.0592/n) log Q','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','CHE','Chemical Kinetics','Rate law',
   'First-order integrated rate law','\\ln[A] = \\ln[A]_0 - kt','ln[A] = ln[A]0 - kt',
   '[{"symbol":"[A]","meaning":"concentration at time t","unit":"mol/L"},{"symbol":"k","meaning":"rate constant","unit":"s^-1 (first order)"},{"symbol":"t","meaning":"time","unit":"s"}]',
   'SI','First-order reaction only','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','CHE','Solutions','Colligative property',
   'Raoult''s law (relative lowering)','\\frac{p^\\circ - p}{p^\\circ} = x_{solute}','(p0 - p)/p0 = mole fraction of solute',
   '[{"symbol":"p","meaning":"vapour pressure of solution","unit":"atm"},{"symbol":"p0","meaning":"vapour pressure of pure solvent","unit":"atm"},{"symbol":"x","meaning":"mole fraction","unit":"dimensionless"}]',
   '—','Ideal solution of non-volatile solute','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Quadratic Equations','Roots',
   'Quadratic formula','x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}','x = (-b ± sqrt(b^2 - 4ac)) / 2a',
   '[{"symbol":"a, b, c","meaning":"coefficients of ax^2 + bx + c","unit":"real numbers"},{"symbol":"D = b^2 - 4ac","meaning":"discriminant","unit":"real number"}]',
   '—','a ≠ 0; real roots require D ≥ 0','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Complex Numbers','Algebra of i',
   'Euler''s formula','e^{i\\theta} = \\cos\\theta + i\\sin\\theta','e^(i theta) = cos(theta) + i sin(theta)',
   '[{"symbol":"theta","meaning":"angle in radians","unit":"rad"},{"symbol":"i","meaning":"imaginary unit, i^2 = -1","unit":"dimensionless"}]',
   '—',' theta real','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Sequences and Series','AP',
   'Sum of first n terms','S_n = \\frac{n}{2}(2a + (n-1)d)','Sn = n/2 [2a + (n-1)d]',
   '[{"symbol":"a","meaning":"first term","unit":"real"},{"symbol":"d","meaning":"common difference","unit":"real"},{"symbol":"n","meaning":"number of terms","unit":"dimensionless"}]',
   '—','Arithmetic progression','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Sequences and Series','GP',
   'Sum of first n terms','S_n = \\frac{a(r^n - 1)}{r - 1}','Sn = a (r^n - 1)/(r - 1)',
   '[{"symbol":"a","meaning":"first term","unit":"real"},{"symbol":"r","meaning":"common ratio","unit":"real, r ≠ 1"},{"symbol":"n","meaning":"number of terms","unit":"dimensionless"}]',
   '—','Geometric progression, r ≠ 1','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Trigonometry','Identities',
   'Pythagorean identity','\\sin^2\\theta + \\cos^2\\theta = 1','sin^2(theta) + cos^2(theta) = 1',
   '[{"symbol":"theta","meaning":"angle","unit":"rad or degree"}]',
   '—','All real theta','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Straight Lines','Distance',
   'Point-line distance','d = \\frac{|ax_1 + by_1 + c|}{\\sqrt{a^2 + b^2}}','d = |a x1 + b y1 + c| / sqrt(a^2 + b^2)',
   '[{"symbol":"(x1, y1)","meaning":"point coordinates","unit":"coordinate units"},{"symbol":"a, b, c","meaning":"line ax + by + c = 0","unit":"real"}]',
   '—',' Euclidean plane','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Limits and Derivatives','Standard limit',
   'Derivative of sine','\\frac{d}{dx}\\sin x = \\cos x','d/dx sin x = cos x',
   '[{"symbol":"x","meaning":"variable","unit":"rad"}]',
   '—','x in radians','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Integrals','Standard integral',
   'Integral of 1/x','\\int \\frac{1}{x}\\,dx = \\ln|x| + C','∫ 1/x dx = ln|x| + C',
   '[{"symbol":"C","meaning":"constant of integration","unit":"real"}]',
   '—','x ≠ 0','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','MAT','Probability','Basics',
   'Complement rule','P(A'') = 1 - P(A)','P(not A) = 1 - P(A)',
   '[{"symbol":"P(A)","meaning":"probability of event A","unit":"dimensionless, 0-1"}]',
   '—','—','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','BOT','Cell: The Unit of Life','Cell division',
   'Mitosis chromosome number','2n \\rightarrow 2n','2n → 2n (chromosome number conserved)',
   '[{"symbol":"n","meaning":"haploid chromosome number","unit":"count"}]',
   '—','Somatic cells','VERIFIED', now()),
  ('00000000-0000-0000-0000-000000000001','ZOO','Human Physiology','Cardiac output',
   'Cardiac output formula','CO = HR \\times SV','CO = heart rate × stroke volume',
   '[{"symbol":"CO","meaning":"cardiac output","unit":"mL/min"},{"symbol":"HR","meaning":"heart rate","unit":"beats/min"},{"symbol":"SV","meaning":"stroke volume","unit":"mL/beat"}]',
   '—','Resting or steady-state conditions','VERIFIED', now())
on conflict do nothing;

-- =============================================================================
-- §4b. 0043 section 3: question_translations (multilingual architecture)
-- =============================================================================
create table if not exists question_translations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  language text not null check (language in ('EN','HI','GU','BN','MR','TA','TE','KN')),
  question_text text,
  options jsonb,                                   -- [{option_key, option_text}]
  solution_text text,
  translated_by uuid references auth.users(id) on delete set null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, language)
);

create index if not exists question_translations_q_idx on question_translations (question_id);

drop policy if exists question_translations_select on question_translations;
create policy question_translations_select on question_translations
  for select to authenticated
  using (exists (
    select 1 from questions q
    where q.id = question_translations.question_id
      and (q.tenant_id is null or app_can_read_content(q.tenant_id))
  ));

drop policy if exists question_translations_write on question_translations;
create policy question_translations_write on question_translations
  for all to authenticated
  using (exists (
    select 1 from questions q
    where q.id = question_translations.question_id
      and app_can_access_tenant(q.tenant_id)
      and (app_is_platform_admin() or not app_user_has_student_only_role(q.tenant_id))
  ))
  with check (exists (
    select 1 from questions q
    where q.id = question_translations.question_id
      and app_can_access_tenant(q.tenant_id)
      and (app_is_platform_admin() or not app_user_has_student_only_role(q.tenant_id))
  ));

-- =============================================================================
-- §4c. 0043 section 4: RLS for solutions + question_usage
--      (previously open to all writes; engine RPCs are SECURITY DEFINER and
--       therefore unaffected)
-- =============================================================================
alter table solutions enable row level security;
alter table question_usage enable row level security;

drop policy if exists solutions_select on solutions;
create policy solutions_select on solutions
  for select to authenticated
  using (tenant_id is null or app_can_read_content(tenant_id));

drop policy if exists solutions_write on solutions;
create policy solutions_write on solutions
  for all to authenticated
  using (tenant_id is not null and app_can_access_tenant(tenant_id)
         and (app_is_platform_admin() or not app_user_has_student_only_role(tenant_id)))
  with check (tenant_id is not null and app_can_access_tenant(tenant_id)
         and (app_is_platform_admin() or not app_user_has_student_only_role(tenant_id)));

drop policy if exists question_usage_select on question_usage;
create policy question_usage_select on question_usage
  for select to authenticated
  using (tenant_id is null or app_can_read_content(tenant_id));

drop policy if exists question_usage_write on question_usage;
create policy question_usage_write on question_usage
  for all to authenticated
  using (tenant_id is not null and app_can_access_tenant(tenant_id)
         and (app_is_platform_admin() or not app_user_has_student_only_role(tenant_id)))
  with check (tenant_id is not null and app_can_access_tenant(tenant_id)
         and (app_is_platform_admin() or not app_user_has_student_only_role(tenant_id)));

-- =============================================================================
-- §4d. 0043 section 5: omr_sheets.scan_config (bubble geometry captured at
--      render time so the client-side OMR detector can locate bubbles)
-- =============================================================================
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'omr_sheets'
                   and column_name = 'scan_config') then
    alter table omr_sheets add column scan_config jsonb not null default '{}'::jsonb;
  end if;
end $$;

-- =============================================================================
-- §4e. 0043 section 6: app_parent_dashboard() — server-authorized ward access.
--      A parent sees ward data ONLY through a verified parents→students link;
--      RLS still blocks direct table access for PARENT (student-only role).
-- =============================================================================
create or replace function app_parent_dashboard()
returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  v_parent uuid := auth.uid();
  v_parent_email text;
  v_ward students%rowtype;
  v_results jsonb;
  v_weak jsonb;
  v_sessions jsonb;
  v_assignments jsonb;
  v_dpps jsonb;
begin
  if v_parent is null then
    return jsonb_build_object('error', 'not authenticated');
  end if;

  -- Activate a pre-created link (created by an admin before the parent signed
  -- up) the first time the parent authenticates with the matching email.
  select u.email into v_parent_email from auth.users u where u.id = v_parent;
  update parents p
     set auth_user_id = v_parent
   where p.auth_user_id is null
     and v_parent_email is not null
     and lower(p.email) = lower(v_parent_email);

  select s.* into v_ward
  from parents p
  join students s on s.id = p.student_id
  where p.auth_user_id = v_parent and s.is_deleted = false
  order by p.created_at
  limit 1;

  if v_ward.id is null then
    return jsonb_build_object('linked', false);
  end if;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_results
  from (
    select r.id, r.marks, r.total_marks, r.correct, r.incorrect, r.unanswered,
           r.percentage, r.created_at, p.title as paper_title
    from results r
    left join papers p on p.id = r.paper_id
    where r.student_id = v_ward.auth_user_id
    order by r.created_at desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_weak
  from app_weak_topics(v_ward.auth_user_id, 5) t;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_sessions
  from (
    select es.id, es.status, es.started_at, es.ends_at, p.title as paper_title
    from exam_sessions es
    left join papers p on p.id = es.paper_id
    where es.student_id = v_ward.auth_user_id
    order by es.created_at desc
    limit 5
  ) x;

  select coalesce(jsonb_agg(x order by x.due_at nulls last), '[]'::jsonb) into v_assignments
  from (
    select a.id, a.due_at, a.assignee_type, p.title as paper_title
    from exam_assignments a
    left join papers p on p.id = a.paper_id
    where a.assignee_type = 'STUDENT' and a.assignee_id = v_ward.auth_user_id
      and (a.due_at is null or a.due_at >= now() - interval '7 days')
    order by a.due_at nulls last
    limit 5
  ) x;

  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_dpps
  from (
    select d.id, d.title, d.created_at
    from dpps d
    where d.tenant_id = v_ward.tenant_id
    order by d.created_at desc
    limit 5
  ) x;

  return jsonb_build_object(
    'linked', true,
    'ward', jsonb_build_object(
      'id', v_ward.id, 'name', v_ward.full_name, 'roll_number', v_ward.roll_number,
      'email', v_ward.email, 'class_level', v_ward.class_level
    ),
    'results', v_results,
    'weak_topics', v_weak,
    'sessions', v_sessions,
    'assignments', v_assignments,
    'dpps', v_dpps
  );
end $$;

revoke execute on function app_parent_dashboard() from anon;
grant execute on function app_parent_dashboard() to authenticated;

-- =============================================================================
-- RELOAD THE POSTGREST SCHEMA CACHE so the new tables/columns/RPCs are visible:
--   notify pgrst, 'reload schema';
-- =============================================================================