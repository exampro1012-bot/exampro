-- 0044_notification_triggers.sql
-- Event-driven notifications:
--   * DPP assigned (student / batch)        -> type DPP_ASSIGNED
--   * Result published                      -> type RESULT_PUBLISHED
--   * Exam published (paper goes live)      -> type ANNOUNCEMENT
--
-- Delivery is per-recipient rows in `notifications`; the client bell + inbox
-- filter by notification-type preferences stored client-side, so triggers
-- always insert (server-side truth) and the UI applies prefs on display.

-- ---------------------------------------------------------------------------
-- 1. DPP assignment notifications
-- ---------------------------------------------------------------------------
create or replace function trg_dpp_assignment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_title text; v_uid uuid;
begin
  select coalesce(d.title, 'A DPP set') into v_title from dpps d where d.id = NEW.dpp_id;
  if NEW.assignee_type = 'STUDENT' then
    insert into notifications (tenant_id, recipient_user_id, user_id, type, title, body, link)
    values (NEW.tenant_id, NEW.assignee_id, NEW.assignee_id, 'DPP_ASSIGNED',
            'DPP assigned: ' || v_title, 'A new practice set has been assigned to you.',
            '/dpp');
  elsif NEW.assignee_type = 'BATCH' then
    for v_uid in
      select s.auth_user_id from student_batches sb
      join students s on s.id = sb.student_id
      where sb.batch_id = NEW.assignee_id and s.auth_user_id is not null
    loop
      insert into notifications (tenant_id, recipient_user_id, user_id, type, title, body, link)
      values (NEW.tenant_id, v_uid, v_uid, 'DPP_ASSIGNED',
              'DPP assigned: ' || v_title, 'A new practice set has been assigned to your batch.', '/dpp');
    end loop;
  end if;
  return null;
end; $$;

drop trigger if exists dpp_assignments_notify on dpp_assignments;
create trigger dpp_assignments_notify after insert on dpp_assignments
  for each row execute function trg_dpp_assignment_notify();

-- ---------------------------------------------------------------------------
-- 2. Result published notifications (student sees their score)
-- ---------------------------------------------------------------------------
create or replace function trg_result_published_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_paper text; v_pct numeric;
begin
  select s.auth_user_id into v_uid from students s where s.id = NEW.student_id and s.auth_user_id is not null;
  if v_uid is null then
    return null;
  end if;
  select coalesce(p.title, 'your exam') into v_paper from papers p where p.id = NEW.paper_id;
  v_pct := coalesce(NEW.percentage, 0);
  insert into notifications (tenant_id, recipient_user_id, user_id, type, title, body, link)
  values (NEW.tenant_id, v_uid, v_uid, 'RESULT_PUBLISHED',
          'Result published: ' || v_paper,
          'Your score is ' || round(v_pct::numeric, 1) || '%. Tap to view the full report.',
          '/results');
  return null;
end; $$;

drop trigger if exists results_published_notify on results;
create trigger results_published_notify after insert on results
  for each row execute function trg_result_published_notify();

-- ---------------------------------------------------------------------------
-- 3. Paper published notification (announcement to all tenant users)
-- ---------------------------------------------------------------------------
create or replace function trg_paper_published_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if coalesce(NEW.status, '') <> 'PUBLISHED' then
    return null;
  end if;
  for v_uid in
    select auth_user_id from profiles where tenant_id = NEW.tenant_id and auth_user_id is not null
  loop
    insert into notifications (tenant_id, recipient_user_id, user_id, type, title, body, link)
    values (NEW.tenant_id, v_uid, v_uid, 'ANNOUNCEMENT',
            'New paper published: ' || coalesce(NEW.title, 'Untitled'),
            'A new mock paper is now available for practice.', '/papers');
  end loop;
  return null;
end; $$;

drop trigger if exists papers_published_notify on papers;
create trigger papers_published_notify after insert on papers
  for each row when (coalesce(NEW.status, '') = 'PUBLISHED')
  execute function trg_paper_published_notify();

-- ---------------------------------------------------------------------------
-- 4. Indexes to keep the bell fast
-- ---------------------------------------------------------------------------
create index if not exists notifications_recipient_unread_idx
  on notifications (recipient_user_id, is_read, created_at desc);