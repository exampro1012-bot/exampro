-- =============================================================================
-- ExamPro — SaaS / commercial modules (Migration 0011)
-- leads, sales orders, gst_records, parents, exam_assignments, paper_blueprints.
-- All tenant-scoped with RLS. Academic modules stay fully functional without
-- these tables (billing is optional by design).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  source text default 'WEBSITE',        -- WEBSITE | REFERRAL | WALKIN | CALL | OTHER
  status text not null default 'NEW',   -- NEW | CONTACTED | QUALIFIED | PROPOSAL | WON | LOST
  notes text,
  followup_at timestamptz,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  plan_id uuid references plans(id) on delete set null,
  customer_name text,
  amount numeric(10,2) not null default 0,
  status text not null default 'PENDING',  -- PENDING | PAID | REFUNDED | CANCELLED
  payment_date timestamptz,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists gst_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete cascade,
  rate numeric(5,2) not null default 18,      -- applicable GST rate %
  taxable_amount numeric(10,2) not null default 0,
  cgst numeric(10,2) not null default 0,
  sgst numeric(10,2) not null default 0,
  igst numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (invoice_id)
);

create table if not exists parents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  relation text default 'PARENT',            -- PARENT | GUARDIAN | OTHER
  auth_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exam_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  assignee_type text not null,               -- STUDENT | BATCH
  assignee_id uuid not null,
  assigned_by uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  status text not null default 'ASSIGNED',   -- ASSIGNED | STARTED | DONE | OVERDUE
  created_at timestamptz not null default now()
);

create table if not exists paper_blueprints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  exam_id uuid references exams(id) on delete set null,
  name text not null,
  version int not null default 1,
  rules jsonb not null default '[]',         -- [{subject_code, chapter_ids[], difficulty, count, marks, negative_marks}]
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. RLS
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'leads','sales_orders','gst_records','parents','exam_assignments','paper_blueprints'
  ] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %1$I_all on %1$I;', t);
    execute format('create policy %1$I_all on %1$I for all to authenticated
      using (app_can_access_tenant(tenant_id)) with check (app_can_access_tenant(tenant_id));', t);
  end loop;
end $$;

-- learners see only their own exam assignments
drop policy if exists exam_assignments_all on exam_assignments;
create policy exam_assignments_all on exam_assignments for all to authenticated
  using (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id)
              or (assignee_type = 'STUDENT' and assignee_id = auth.uid())))
  with check (app_can_access_tenant(tenant_id)
         and (not app_user_has_student_only_role(tenant_id)
              or (assignee_type = 'STUDENT' and assignee_id = auth.uid())));

-- ----------------------------------------------------------------------------
-- 3. Tenant auto-fill triggers
-- ----------------------------------------------------------------------------
create or replace function trg_tenant_from_salesorder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.tenant_id is null then
    select tenant_id into NEW.tenant_id from leads where id = NEW.lead_id;
  end if;
  return NEW;
end; $$;

drop trigger if exists sales_orders_tenant on sales_orders;
create trigger sales_orders_tenant before insert on sales_orders for each row execute function trg_tenant_from_salesorder();

create or replace function trg_tenant_from_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
begin select tenant_id into NEW.tenant_id from invoices where id = NEW.invoice_id; return NEW; end; $$;

drop trigger if exists gst_records_tenant on gst_records;
create trigger gst_records_tenant before insert on gst_records for each row execute function trg_tenant_from_invoice();

-- ----------------------------------------------------------------------------
-- 4. updated_at maintenance
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads','sales_orders','parents','paper_blueprints'] loop
    execute format('drop trigger if exists %I_updated on %I;', t, t);
    execute format('create trigger %I_updated before update on %I
      for each row execute function set_updated_at();', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Notifications on exam assignment (real-time delivery of assignments)
-- ----------------------------------------------------------------------------
create or replace function trg_exam_assignment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text; v_uid uuid;
begin
  select coalesce(p.title, 'An exam') into v_title from papers p where p.id = NEW.paper_id;
  if NEW.assignee_type = 'STUDENT' then
    insert into notifications (tenant_id, recipient_user_id, user_id, type, title, body, link)
    values (NEW.tenant_id, NEW.assignee_id, NEW.assignee_id, 'EXAM_ASSIGNED',
            'Exam assigned: ' || v_title, 'A new exam has been assigned to you.',
            '/exams');
  elsif NEW.assignee_type = 'BATCH' then
    for v_uid in
      select s.auth_user_id from student_batches sb
      join students s on s.id = sb.student_id
      where sb.batch_id = NEW.assignee_id and s.auth_user_id is not null
    loop
      insert into notifications (tenant_id, recipient_user_id, user_id, type, title, body, link)
      values (NEW.tenant_id, v_uid, v_uid, 'EXAM_ASSIGNED',
              'Exam assigned: ' || v_title, 'A new exam has been assigned to your batch.', '/exams');
    end loop;
  end if;
  return null;
end; $$;

drop trigger if exists exam_assignments_notify on exam_assignments;
create trigger exam_assignments_notify after insert on exam_assignments
  for each row execute function trg_exam_assignment_notify();

-- ----------------------------------------------------------------------------
-- 6. Indexes
-- ----------------------------------------------------------------------------
create index if not exists leads_tenant_idx on leads (tenant_id, status);
create index if not exists leads_owner_idx on leads (owner_id);
create index if not exists sales_orders_tenant_idx on sales_orders (tenant_id, status);
create index if not exists gst_records_invoice_idx on gst_records (invoice_id);
create index if not exists parents_student_idx on parents (student_id);
create index if not exists exam_assignments_paper_idx on exam_assignments (paper_id);
create index if not exists exam_assignments_assignee_idx on exam_assignments (assignee_type, assignee_id);
create index if not exists paper_blueprints_exam_idx on paper_blueprints (exam_id);

-- ----------------------------------------------------------------------------
-- 7. Grants
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated;
