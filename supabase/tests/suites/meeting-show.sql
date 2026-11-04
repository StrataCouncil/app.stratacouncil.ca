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


-- 0076: Show to everyone, and All in favour.
-- BCS-1234's council: Bob (SL001, runs the meeting), Cara (SL002), Finn (SL003).
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000b', array['admin', 'president']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['treasurer']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['member_at_large']);
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000b', 'SL001');
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL002');
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000f', 'SL003');
reset role;

insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda)
values ('76000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b',
  '[{"id":"i1","text":"Call to Order","atts":[]},
    {"id":"i4","text":"Roof replacement","atts":[
      {"id":"a1","kind":"link","documentId":null,"url":"https://example.com/quote.pdf","title":"Roofing quote"},
      {"id":"a2","kind":"link","documentId":null,"url":"javascript:alert(1)","title":"Bad link"}]}]');
set app.meeting_lifecycle = 'on';
update meetings set launched_by = '00000000-0000-0000-0000-00000000000b', launched_at = now(), status = 'LIVE', actual_start_at = now()
  where id = '76000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;

set role authenticated;
-- Show to everyone
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select set_meeting_presenting('76000000-0000-0000-0000-0000000000aa', 'i4', 'a1')$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select set_meeting_presenting('76000000-0000-0000-0000-0000000000aa', 'i4', 'nope')$q$, 'isn''t on the saved agenda');
select set_meeting_presenting('76000000-0000-0000-0000-0000000000aa', 'i4', 'a1');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect('members read what is being shown, taken from the saved agenda',
  (select presenting @> '{"itemId":"i4","attId":"a1","title":"Roofing quote","url":"https://example.com/quote.pdf"}'::jsonb from meetings where id = '76000000-0000-0000-0000-0000000000aa'));
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_meeting_presenting('76000000-0000-0000-0000-0000000000aa', 'i4', 'a2');
select pg_temp.expect('a link that isn''t a web address is never passed on',
  (select presenting ->> 'url' is null from meetings where id = '76000000-0000-0000-0000-0000000000aa'));
select set_meeting_presenting('76000000-0000-0000-0000-0000000000aa', null, null);
select pg_temp.expect('stop showing', (select presenting is null from meetings where id = '76000000-0000-0000-0000-0000000000aa'));

-- All in favour
set test.uid = '00000000-0000-0000-0000-00000000000c';
select join_meeting('76000000-0000-0000-0000-0000000000aa');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select join_meeting('76000000-0000-0000-0000-0000000000aa');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select join_meeting('76000000-0000-0000-0000-0000000000aa');
select open_meeting_vote('76000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof be replaced', 'MAJORITY');
-- Cara abstains on her own screen; Bob had entered Against for Finn by mistake.
set test.uid = '00000000-0000-0000-0000-00000000000c';
select cast_meeting_vote((select id from meeting_votes where meeting_id = '76000000-0000-0000-0000-0000000000aa' and status = 'open'), 'abstain');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select record_meeting_vote((select id from meeting_votes where meeting_id = '76000000-0000-0000-0000-0000000000aa' and status = 'open'), 'SL003', 'against');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select record_all_in_favour((select id from meeting_votes where meeting_id = '76000000-0000-0000-0000-0000000000aa' and status = 'open'))$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('all in favour fills in the runner''s own and the ones they entered',
  record_all_in_favour((select id from meeting_votes where meeting_id = '76000000-0000-0000-0000-0000000000aa' and status = 'open')) = 2);
select pg_temp.expect('a member''s own ballot is never changed',
  (select string_agg(lot_number || '=' || choice, ',' order by lot_number) = 'SL001=for,SL002=abstain,SL003=for'
   from meeting_ballots where vote_id = (select id from meeting_votes where meeting_id = '76000000-0000-0000-0000-0000000000aa' and status = 'open')));
select cancel_meeting_vote((select id from meeting_votes where meeting_id = '76000000-0000-0000-0000-0000000000aa' and status = 'open'));

-- Someone votes Against themselves: All in favour is refused
select open_meeting_vote('76000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof be replaced', 'MAJORITY');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select cast_meeting_vote((select id from meeting_votes where meeting_id = '76000000-0000-0000-0000-0000000000aa' and status = 'open'), 'against');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select record_all_in_favour((select id from meeting_votes where meeting_id = '76000000-0000-0000-0000-0000000000aa' and status = 'open'))$q$, 'voted Against themselves');
reset role;

select pg_temp.expect('the new functions are for signed-in people only',
  not has_function_privilege('anon', 'public.set_meeting_presenting(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.record_all_in_favour(uuid)', 'execute')
  and has_column_privilege('authenticated', 'public.meetings', 'presenting', 'select'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$update meetings set presenting = '{"url":"https://evil.example"}' where id = '76000000-0000-0000-0000-0000000000aa'$q$, 'only through Show to everyone');
reset role;
