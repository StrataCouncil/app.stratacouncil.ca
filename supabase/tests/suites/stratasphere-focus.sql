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
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated;

-- 0094: a question keeps what the person was looking at: a small reference
-- and its label, private like the rest of the conversation. In the seed,
-- Bob is BCS-1234's admin and Cara a member; Xavier is an outsider.
insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda)
  values ('cccccccc-0000-0000-0000-0000000000f1', 'BCS-1234', 'council', '2026-12-02', '00000000-0000-0000-0000-00000000000b', '[{"id":"i4","text":"Roof replacement"}]');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
insert into conversations (id, corporation_id, user_id, title) values ('dddddddd-0000-0000-0000-0000000000f1', 'BCS-1234', '00000000-0000-0000-0000-00000000000b', 'Roof');
reset role;
create temp table c as select 'dddddddd-0000-0000-0000-0000000000f1'::uuid id;
grant select on c to authenticated;
set role authenticated;
insert into conversation_messages (conversation_id, role, content, focus)
  values ((select id from c), 'user', 'What have we decided about roof replacement before?',
          '{"kind":"agenda_item","meetingId":"cccccccc-0000-0000-0000-0000000000f1","itemId":"i4","label":"Strata Council Meeting, Dec 2, 2026: Roof replacement"}');
select pg_temp.expect('the question keeps where it was asked', (select focus->>'itemId' = 'i4' from conversation_messages where conversation_id = (select id from c)));
select pg_temp.expect_error($q$insert into conversation_messages (conversation_id, role, content, focus) values ((select id from c), 'user', 'x', '"just text"')$q$, 'conversation_messages_focus_check');
select pg_temp.expect_error(format($q$insert into conversation_messages (conversation_id, role, content, focus) values ((select id from c), 'user', 'x', %L)$q$, json_build_object('kind', 'document', 'label', repeat('x', 3000))::text), 'conversation_messages_focus_check');

-- Private to the person who asked, as before (0019).
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('another member sees none of it', (select count(*) = 0 from conversation_messages));
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('an outsider sees none of it', (select count(*) = 0 from conversation_messages));
-- And the record behind a reference is only read with the person's own access: an outsider can't open the meeting.
select pg_temp.expect('an outsider can''t read the meeting a reference points to', (select count(*) = 0 from meetings where id = 'cccccccc-0000-0000-0000-0000000000f1'));
