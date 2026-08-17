-- =============================================================================
-- ExamPro — Storage buckets & policies (Migration 0004)
-- Buckets: logos, question images, documents, OMR, generated papers, reports, uploads.
-- Private buckets require the first path segment to be one of the caller's tenants.
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('institution-logos','institution-logos', true),   -- public by design
  ('question-images','question-images', false),
  ('question-documents','question-documents', false),
  ('omr-images','omr-images', false),
  ('generated-papers','generated-papers', false),
  ('reports','reports', false),
  ('user-uploads','user-uploads', false)
on conflict (id) do nothing;

-- Helper: first path segment as uuid
create or replace function storage_obj_tenant(name text) returns uuid
language sql immutable as $$
  select nullif(split_part(name, '/', 1), '')::uuid;
$$;

-- institution-logos: public read, authenticated write
drop policy if exists logos_read on storage.objects;
create policy logos_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'institution-logos');

drop policy if exists logos_write on storage.objects;
create policy logos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'institution-logos');

-- private buckets: read if tenant member; write only into your own tenant folder
do $$
declare
  b text;
  pn text;
begin
  foreach b in array array['question-images','question-documents','omr-images','generated-papers','reports','user-uploads'] loop
    pn := replace(b, '-', '_');
    execute format('drop policy if exists %I_read on storage.objects;', pn);
    execute format(
      'create policy %I_read on storage.objects for select to authenticated
       using (bucket_id = %L and app_user_belongs_to_tenant(storage_obj_tenant(name)));', pn, b);
    execute format('drop policy if exists %I_write on storage.objects;', pn);
    execute format(
      'create policy %I_write on storage.objects for all to authenticated
       using (bucket_id = %L and app_user_belongs_to_tenant(storage_obj_tenant(name)))
       with check (bucket_id = %L and app_user_belongs_to_tenant(storage_obj_tenant(name)));', pn, b, b);
  end loop;
end$$;
