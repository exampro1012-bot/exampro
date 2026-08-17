-- Check current migration 0047 state
select 'roles_QUESTION_REVIEWER' as item, count(*) as cnt from roles where code = 'QUESTION_REVIEWER';
select 'roles_CONTENT_EDITOR' as item, count(*) as cnt from roles where code = 'CONTENT_EDITOR';
select 'constraint_exam_sessions' as item, count(*) as cnt from pg_constraint where conrelid = 'exam_sessions'::regclass and conname like '%student_id%fkey';
select 'constraint_results' as item, count(*) as cnt from pg_constraint where conrelid = 'results'::regclass and conname like '%student_id%fkey';
select 'rpc_app_admin_set_user_role' as item, count(*) as cnt from pg_proc where proname = 'app_admin_set_user_role';
select 'platform_admins_exampro' as item, count(*) as cnt from platform_admins where user_id = (select id from auth.users where email = 'exampro1012@gmail.com');
select 'tenant_memberships_exampro' as item, count(*) as cnt from tenant_memberships where user_id = (select id from auth.users where email = 'exampro1012@gmail.com');
