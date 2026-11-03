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
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated, anon;

-- 0071: how a document's text was read is the server's to record.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, an active member of BCS-1234
insert into documents (corporation_id, category, title, uploaded_by)
  values ('BCS-1234', 'meetings_records', 'Minutes 2019', '00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('a member can still upload', (select count(*) = 1 from documents where title = 'Minutes 2019'));
select pg_temp.expect_error($q$insert into documents (corporation_id, title, uploaded_by, text_source) values ('BCS-1234', 'x', '00000000-0000-0000-0000-00000000000b', 'ocr')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into documents (corporation_id, title, uploaded_by, ocr_confidence) values ('BCS-1234', 'x', '00000000-0000-0000-0000-00000000000b', 99)$q$, 'row-level security');
select pg_temp.expect_error($q$insert into documents (corporation_id, title, uploaded_by, ocr_attempted_at) values ('BCS-1234', 'x', '00000000-0000-0000-0000-00000000000b', now())$q$, 'row-level security');
reset role;

-- The server records it.
update documents set indexing_status = 'indexed', text_source = 'ocr', ocr_pages = 12, ocr_unclear_pages = 2, ocr_skipped_pages = 0, ocr_confidence = 88,
  ocr_attempted_at = now() where title = 'Minutes 2019';
select pg_temp.expect('read from scan, with its numbers', (select text_source = 'ocr' and ocr_unclear_pages = 2 from documents where title = 'Minutes 2019'));
select pg_temp.expect_error($q$update documents set ocr_confidence = 140 where title = 'Minutes 2019'$q$, 'ocr_confidence');
select pg_temp.expect_error($q$update documents set text_source = 'ai' where title = 'Minutes 2019'$q$, 'text_source');
select pg_temp.expect('the legislation library has the same columns',
  (select count(*) = 6 from information_schema.columns where table_name = 'legislation_documents'
     and column_name in ('text_source', 'ocr_pages', 'ocr_unclear_pages', 'ocr_skipped_pages', 'ocr_confidence', 'ocr_attempted_at')));
