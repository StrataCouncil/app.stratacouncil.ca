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
