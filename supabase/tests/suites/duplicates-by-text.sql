\set ON_ERROR_STOP 1
-- 0103: copies with the same text (a re-export or re-scan) are found and can be merged.
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

select pg_temp.expect('the same words make the same fingerprint, whatever the spacing or case',
  public.document_text_fingerprint(repeat('Operating fund   balance ', 20)) = public.document_text_fingerprint(upper(repeat('operating fund balance' || chr(10), 20))));
select pg_temp.expect('different words differ',
  public.document_text_fingerprint(repeat('Operating fund balance ', 20)) <> public.document_text_fingerprint(repeat('Contingency fund balance ', 20)));
select pg_temp.expect('short texts get none', public.document_text_fingerprint('Page 1 of 1') is null);
select pg_temp.expect('no text, no fingerprint', public.document_text_fingerprint(null) is null);

insert into documents (id, corporation_id, category, title, file_name, storage_path, content_sha256, document_text) values
  ('44444444-0000-0000-0000-000000000001', 'BCS-1234', 'financial_accounting', 'October statement', 'Oct.pdf', 'corporation-documents/BCS-1234/a/Oct.pdf', repeat('1', 64), repeat('Statement of operations October 2026. ', 10)),
  ('44444444-0000-0000-0000-000000000002', 'BCS-1234', null, 'Oct (1).pdf', 'Oct (1).pdf', 'corporation-documents/BCS-1234/b/Oct (1).pdf', repeat('2', 64), repeat('STATEMENT OF OPERATIONS   OCTOBER 2026.' || chr(10), 10)),
  ('44444444-0000-0000-0000-000000000003', 'BCS-1234', null, 'September statement', 'Sep.pdf', 'corporation-documents/BCS-1234/c/Sep.pdf', repeat('3', 64), repeat('Statement of operations September 2026. ', 10));
select pg_temp.expect('the trigger fills the fingerprint',
  (select text_fingerprint is not null from documents where id = '44444444-0000-0000-0000-000000000001'));
select pg_temp.expect('a re-export with different bytes has the same text fingerprint',
  (select count(distinct text_fingerprint) = 1 from documents where id in ('44444444-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002')));
update documents set text_fingerprint = 'forged' where id = '44444444-0000-0000-0000-000000000003';
select pg_temp.expect('the fingerprint can''t be set by hand',
  (select text_fingerprint = public.document_text_fingerprint(document_text) from documents where id = '44444444-0000-0000-0000-000000000003'));
update documents set document_text = repeat('Statement of operations October 2026. ', 10) where id = '44444444-0000-0000-0000-000000000003';
select pg_temp.expect('it follows the text when the text changes',
  (select count(distinct text_fingerprint) = 1 from documents where id::text like '44444444-%'));
update documents set document_text = repeat('Statement of operations September 2026. ', 10) where id = '44444444-0000-0000-0000-000000000003';

insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda) values
  ('55555555-0000-0000-0000-000000000001', 'BCS-1234', 'council', '2026-11-12', '00000000-0000-0000-0000-00000000000b',
   '[{"id": "i1", "text": "Financials", "atts": [{"id": "a_44444444-0000-0000-0000-000000000002", "kind": "document", "documentId": "44444444-0000-0000-0000-000000000002", "title": "Oct (1).pdf"}]}]');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, admin
select pg_temp.expect_error($q$select merge_duplicate_document('44444444-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001')$q$, 'not the same file');
select pg_temp.expect('a copy with the same text merges into the one kept',
  (select merge_duplicate_document('44444444-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001') = 'corporation-documents/BCS-1234/b/Oct (1).pdf'));
reset role;
select pg_temp.expect('the copy is gone', not exists (select 1 from documents where id = '44444444-0000-0000-0000-000000000002'));
select pg_temp.expect('the agenda attaches the kept one',
  (select agenda -> 0 -> 'atts' -> 0 ->> 'documentId' = '44444444-0000-0000-0000-000000000001' from meetings where id = '55555555-0000-0000-0000-000000000001'));
