-- =============================================================================
-- ExamPro — privacy hardening (Migration 0013)
-- app_weak_topics(user_id, n) is security-definer and would let any caller
-- pass another user's id. Revoke direct execution; expose a self-scoped
-- wrapper that forces auth.uid().
-- =============================================================================
revoke execute on function app_weak_topics(uuid, int) from authenticated, anon;

create or replace function app_my_weak_topics(p_limit int default 10)
returns table (topic_id uuid, topic_name text, accuracy numeric, attempts int)
language sql stable security definer set search_path = public as $$
  select * from app_weak_topics(auth.uid(), p_limit);
$$;

grant execute on function app_my_weak_topics(int) to authenticated;