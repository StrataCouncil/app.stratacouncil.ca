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


-- 0075: the runner marks someone present (on the phone, in the room), with
-- the time; attendance changes keep an open vote honest; closing needs quorum.
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
values ('75000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b',
  '[{"id":"i1","text":"Call to Order"},{"id":"i4","text":"Roof replacement"}]');
set app.meeting_lifecycle = 'on';
update meetings set launched_by = '00000000-0000-0000-0000-00000000000b', launched_at = now() where id = '75000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;

set role authenticated;
-- Only the runner marks someone present, and only a council lot
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select mark_joined_meeting('75000000-0000-0000-0000-0000000000aa', 'SL003')$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select mark_joined_meeting('75000000-0000-0000-0000-0000000000aa', 'SL099')$q$, 'isn''t on council');
select mark_joined_meeting('75000000-0000-0000-0000-0000000000aa', 'SL001');
select mark_joined_meeting('75000000-0000-0000-0000-0000000000aa', 'SL003');
select mark_joined_meeting('75000000-0000-0000-0000-0000000000aa', 'SL003');
select pg_temp.expect('marked present, with the time, once', (select attendance ->> 'SL003' = 'present' from meetings where id = '75000000-0000-0000-0000-0000000000aa')
  and (select count(*) = 1 from meeting_presence where meeting_id = '75000000-0000-0000-0000-0000000000aa' and lot_number = 'SL003' and event = 'marked_joined'
       and by_user = '00000000-0000-0000-0000-00000000000b' and user_id = '00000000-0000-0000-0000-00000000000f'));

-- Called to order with SL001 and SL003: 3 council members need 2
reset role;
set app.meeting_lifecycle = 'on';
update meetings set status = 'LIVE', actual_start_at = now() where id = '75000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;
set role authenticated;
select open_meeting_vote('75000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof be replaced', 'MAJORITY');
select pg_temp.expect('the vote counts those present', (select eligible_lots = array['SL001', 'SL003'] from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'));

-- Cara arrives on the phone mid-vote: she can vote
select mark_joined_meeting('75000000-0000-0000-0000-0000000000aa', 'SL002');
select pg_temp.expect('someone who arrives during a vote can vote', (select 'SL002' = any (eligible_lots) from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'));
select record_meeting_vote((select id from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'), 'SL002', 'for');
select record_meeting_vote((select id from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'), 'SL001', 'for');

-- Cara hangs up after voting: her ballot stands. Finn leaves without voting: he's out of the vote.
select mark_left_meeting('75000000-0000-0000-0000-0000000000aa', 'SL002', 'Left meeting');
select mark_left_meeting('75000000-0000-0000-0000-0000000000aa', 'SL003', 'Left meeting');
select pg_temp.expect('after Call to Order, leaving is recorded as left', (select attendance ->> 'SL003' = 'left' from meetings where id = '75000000-0000-0000-0000-0000000000aa'));
select pg_temp.expect('a ballot cast before leaving stands; a non-voter who left drops out',
  (select eligible_lots = array['SL001', 'SL002'] from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'));

-- Only Bob is left: 1 of 3, quorum is 2. The vote can't close.
select pg_temp.expect_error($q$select close_meeting_vote((select id from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'))$q$, 'No quorum: 1 of 3');
-- Finn dials back in: quorum is back, the vote closes, 2 for out of 2 counted (Finn didn't vote on it before he left, and re-joins it).
select mark_joined_meeting('75000000-0000-0000-0000-0000000000aa', 'SL003');
select pg_temp.expect('rejoining puts him back in the vote', (select eligible_lots = array['SL001', 'SL002', 'SL003'] from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'));
select record_meeting_vote((select id from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'), 'SL003', 'against');
select pg_temp.expect('closes with quorum: 2 for, 1 against, 3 counted',
  close_meeting_vote((select id from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'))
  @> '{"for": 2, "against": 1, "abstain": 0, "missing": 0, "present": 3}'::jsonb);

-- A conflicted member who arrives mid-vote isn't added to it
select declare_meeting_conflict('75000000-0000-0000-0000-0000000000aa', 'i4', 'SL002', 'Brother-in-law owns the roofing company');
select pg_temp.expect('a conflict the runner records is acknowledged at once', (select acknowledged_at is not null from meeting_conflicts where meeting_id = '75000000-0000-0000-0000-0000000000aa' and lot_number = 'SL002'));
select open_meeting_vote('75000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof quote be accepted', 'MAJORITY');
select mark_joined_meeting('75000000-0000-0000-0000-0000000000aa', 'SL002');
select pg_temp.expect('a conflicted member who arrives isn''t added to the vote', (select not ('SL002' = any (eligible_lots)) from meeting_votes where meeting_id = '75000000-0000-0000-0000-0000000000aa' and status = 'open'));
reset role;

select pg_temp.expect('the new function is for signed-in people only', not has_function_privilege('anon', 'public.mark_joined_meeting(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.mark_joined_meeting(uuid, text)', 'execute'));
