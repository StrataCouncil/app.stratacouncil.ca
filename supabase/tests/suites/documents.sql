\set ON_ERROR_STOP 1
create function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'wrong error for [%]: %', sql, sqlerrm; end if;
    raise notice 'OK refused: %', sqlerrm; return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- The 0012 backfill, re-run here because flow.sql created the plan after migrating.
update public.documents d set source_type = 'strata_plan',
  file_name = coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', ''))
  where exists (select 1 from public.strata_corporations c where c.source_document_id = d.id);
select pg_temp.expect('backfill marks the strata plan', (select source_type = 'strata_plan' and file_name is not null from documents where id = '11111111-1111-1111-1111-111111111111'));
select pg_temp.expect_error($q$update documents set category = 'minutes' where id = '11111111-1111-1111-1111-111111111111'$q$, 'documents_category_check');
select pg_temp.expect_error($q$insert into documents (corporation_id, source_type) values ('BCS-1234', 'link')$q$, 'documents_link_has_url');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, plain member
insert into documents (corporation_id, category, title, file_name, storage_path, uploaded_by)
  values ('BCS-1234', 'insurance', 'policy.pdf', 'policy.pdf', 'corporation-documents/BCS-1234/u/policy.pdf', '00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('member inserted own row, status pending', (select indexing_status = 'pending' from documents where title = 'policy.pdf'));
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, uploaded_by) values ('BCS-1234', 'insurance', 'x', '00000000-0000-0000-0000-00000000000b')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, uploaded_by, document_text) values ('BCS-1234', 'insurance', 'x', '00000000-0000-0000-0000-00000000000c', 'injected')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, uploaded_by, indexing_status) values ('BCS-1234', 'insurance', 'x', '00000000-0000-0000-0000-00000000000c', 'indexed')$q$, 'row-level security');
update documents set title = 'renamed' where title = 'policy.pdf';
select pg_temp.expect('no direct update policy', (select count(*) = 1 from documents where title = 'policy.pdf'));
select move_document((select id from documents where title = 'policy.pdf'), 'financial_accounting');
select pg_temp.expect('member moved it', (select category = 'financial_accounting' from documents where title = 'policy.pdf'));
select pg_temp.expect_error($q$select move_document((select id from documents where title = 'policy.pdf'), 'agenda_attachments')$q$, 'invalid folder');

set test.uid = '00000000-0000-0000-0000-00000000000a';  -- Al, removed
select pg_temp.expect('removed member sees nothing', (select count(*) = 0 from documents));
select pg_temp.expect_error($q$select move_document('11111111-1111-1111-1111-111111111111', 'insurance')$q$, 'not allowed');
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, uploaded_by) values ('BCS-1234', 'insurance', 'x', '00000000-0000-0000-0000-00000000000a')$q$, 'row-level security');

set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, admin
select pg_temp.expect('admin sees both documents', (select count(*) = 2 from documents));

-- 0054: a link must be a web address, and a file must be in this strata's folder.
set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, plain member
insert into documents (corporation_id, category, title, source_type, url, uploaded_by)
  values ('BCS-1234', 'correspondence', 'site', 'link', 'https://example.com/page', '00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('web link saved', (select count(*) = 1 from documents where title = 'site'));
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, source_type, url, uploaded_by) values ('BCS-1234', 'correspondence', 'x', 'link', 'javascript:alert(document.cookie)', '00000000-0000-0000-0000-00000000000c')$q$, 'documents_link_is_web');
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, source_type, url, uploaded_by) values ('BCS-1234', 'correspondence', 'x', 'link', 'data:text/html,<script>1</script>', '00000000-0000-0000-0000-00000000000c')$q$, 'documents_link_is_web');
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, storage_path, uploaded_by) values ('BCS-1234', 'insurance', 'x', 'corporation-documents/BCS-9999/u/secret.pdf', '00000000-0000-0000-0000-00000000000c')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, storage_path, uploaded_by) values ('BCS-1234', 'insurance', 'x', 'strata-plans/someone/plan.pdf', '00000000-0000-0000-0000-00000000000c')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, storage_path, uploaded_by) values ('BCS-1234', 'insurance', 'x', 'corporation-documents/BCS-1234/../BCS-9999/u/secret.pdf', '00000000-0000-0000-0000-00000000000c')$q$, 'row-level security');

-- 0060: minutes stay in Meetings & Records.
insert into documents (corporation_id, category, title, source_type, file_name, storage_path, uploaded_by)
  values ('BCS-1234', 'meetings_records', 'old minutes.pdf', 'historic_minutes', 'old minutes.pdf', 'corporation-documents/BCS-1234/u/old minutes.pdf', '00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error($q$select move_document((select id from documents where title = 'old minutes.pdf'), 'insurance')$q$, 'minutes stay in Meetings & Records');
select pg_temp.expect('historic minutes not moved', (select category = 'meetings_records' from documents where title = 'old minutes.pdf'));

-- 0062: "Download everything" links are server-only (no policy, so nothing shows even with this suite's grants).
reset role;
insert into document_exports (corporation_id, requested_by, token_hash, expires_at)
  values ('BCS-1234', '00000000-0000-0000-0000-00000000000b', repeat('b', 64), now() + interval '1 day');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, admin
select pg_temp.expect('even the admin who asked can''t read export links', (select count(*) = 0 from document_exports));

-- 0065: agenda attachments are filed in the strata's folders; identical copies can be merged.
reset role;
select pg_temp.expect('Agenda Attachments folder is retired', not exists (select 1 from documents where category = 'agenda_attachments'));
select pg_temp.expect_error($q$update documents set category = 'agenda_attachments' where title = 'policy.pdf'$q$, 'documents_category_check');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, plain member
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, uploaded_by, content_sha256) values ('BCS-1234', 'insurance', 'x', '00000000-0000-0000-0000-00000000000c', repeat('a', 64))$q$, 'row-level security');
insert into documents (corporation_id, category, title, uploaded_by) values ('BCS-1234', null, 'unfiled note', '00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('a member can add an unfiled document', (select count(*) = 1 from documents where title = 'unfiled note' and category is null));

reset role;
insert into documents (id, corporation_id, category, title, file_name, storage_path, uploaded_by, content_sha256) values
  ('22222222-0000-0000-0000-000000000001', 'BCS-1234', 'building_construction', 'Warranty Report', 'warranty.pdf', 'corporation-documents/BCS-1234/k/warranty.pdf', '00000000-0000-0000-0000-00000000000c', repeat('a', 64)),
  ('22222222-0000-0000-0000-000000000002', 'BCS-1234', null, 'warranty.pdf', 'warranty.pdf', 'corporation-documents/BCS-1234/d/warranty.pdf', '00000000-0000-0000-0000-00000000000c', repeat('a', 64)),
  ('22222222-0000-0000-0000-000000000003', 'BCS-1234', null, 'other.pdf', 'other.pdf', 'corporation-documents/BCS-1234/o/other.pdf', '00000000-0000-0000-0000-00000000000c', repeat('b', 64)),
  ('22222222-0000-0000-0000-000000000004', 'BCS-1234', 'meetings_records', 'minutes copy', 'm.pdf', 'corporation-documents/BCS-1234/m/m.pdf', '00000000-0000-0000-0000-00000000000c', repeat('c', 64)),
  ('22222222-0000-0000-0000-000000000005', 'BCS-1234', 'meetings_records', 'minutes', 'm.pdf', 'corporation-documents/BCS-1234/n/m.pdf', '00000000-0000-0000-0000-00000000000c', repeat('c', 64));
update documents set source_type = 'minutes' where id = '22222222-0000-0000-0000-000000000004';
insert into knowledge_chunks (scope, document_id, chunk_text, embedding, chunk_index)
  values ('global_precedent', '22222222-0000-0000-0000-000000000002', 'shared passage', array_fill(0.1, array[1024])::extensions.vector, 0);
insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda) values
  ('33333333-0000-0000-0000-000000000001', 'BCS-1234', 'council', '2026-11-01', '00000000-0000-0000-0000-00000000000b',
   '[{"id": "i1", "text": "Warranty", "atts": [{"id": "a_22222222-0000-0000-0000-000000000002", "kind": "document", "documentId": "22222222-0000-0000-0000-000000000002", "title": "warranty.pdf"}, {"id": "l1", "kind": "link", "documentId": null, "url": "https://example.com", "title": "site"}]},
     {"id": "i2", "text": "Both", "atts": [{"id": "a_22222222-0000-0000-0000-000000000001", "kind": "document", "documentId": "22222222-0000-0000-0000-000000000001", "title": "Warranty Report"}, {"id": "a_22222222-0000-0000-0000-000000000002", "kind": "document", "documentId": "22222222-0000-0000-0000-000000000002", "title": "warranty.pdf"}]},
     {"id": "i3", "text": "No attachments"}]');
insert into meetings (id, corporation_id, type, meeting_date, created_by, status, adjourned_at, agenda) values
  ('33333333-0000-0000-0000-000000000002', 'BCS-1234', 'council', '2026-09-01', '00000000-0000-0000-0000-00000000000b', 'ADJOURNED', now(),
   '[{"id": "i1", "text": "Warranty", "atts": [{"id": "a_22222222-0000-0000-0000-000000000002", "kind": "document", "documentId": "22222222-0000-0000-0000-000000000002", "title": "warranty.pdf"}]}]');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, plain member
select pg_temp.expect_error($q$select merge_duplicate_document('22222222-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001')$q$, 'not allowed');
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, admin
select pg_temp.expect_error($q$select merge_duplicate_document('22222222-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001')$q$, 'not the same file');
select pg_temp.expect_error($q$select merge_duplicate_document('22222222-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001')$q$, 'two different');
select pg_temp.expect_error($q$select merge_duplicate_document('22222222-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000005')$q$, 'stays');
select pg_temp.expect('merge returns the duplicate''s file',
  (select merge_duplicate_document('22222222-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001') = 'corporation-documents/BCS-1234/d/warranty.pdf'));

reset role;
select pg_temp.expect('the duplicate is gone', not exists (select 1 from documents where id = '22222222-0000-0000-0000-000000000002'));
select pg_temp.expect('draft agenda points at the kept copy, link untouched',
  (select agenda -> 0 -> 'atts' = '[{"id": "a_22222222-0000-0000-0000-000000000001", "kind": "document", "documentId": "22222222-0000-0000-0000-000000000001", "title": "warranty.pdf"}, {"id": "l1", "kind": "link", "documentId": null, "url": "https://example.com", "title": "site"}]'::jsonb
   from meetings where id = '33333333-0000-0000-0000-000000000001'));
select pg_temp.expect('an item that had both keeps one',
  (select jsonb_array_length(agenda -> 1 -> 'atts') = 1 and agenda -> 1 -> 'atts' -> 0 ->> 'documentId' = '22222222-0000-0000-0000-000000000001'
   from meetings where id = '33333333-0000-0000-0000-000000000001'));
select pg_temp.expect('items without attachments unchanged',
  (select agenda -> 2 = '{"id": "i3", "text": "No attachments"}'::jsonb from meetings where id = '33333333-0000-0000-0000-000000000001'));
select pg_temp.expect('adjourned meeting repointed too',
  (select agenda -> 0 -> 'atts' -> 0 ->> 'documentId' = '22222222-0000-0000-0000-000000000001' from meetings where id = '33333333-0000-0000-0000-000000000002'));
select pg_temp.expect('the lifecycle switch is off again',
  coalesce(current_setting('app.meeting_lifecycle', true), '') <> 'on');
select pg_temp.expect_error($q$update meetings set agenda = '[]' where id = '33333333-0000-0000-0000-000000000002'$q$, 'can''t be changed');
select pg_temp.expect('precedent passage follows the kept copy',
  (select count(*) = 1 from knowledge_chunks where scope = 'global_precedent' and document_id = '22222222-0000-0000-0000-000000000001'));
