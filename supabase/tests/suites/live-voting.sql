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

-- 0073: live voting. BCS-1234's council: Bob (admin and president, SL001,
-- runs the meeting), Cara (treasurer, SL002), Finn (member at large,
-- SL003). Manny is the manager: he follows but has no vote. Xavier is an
-- outsider.
insert into auth.users (id, email, raw_user_meta_data) values
  ('73000000-0000-0000-0000-000000000001', 'manny@x.ca', '{"full_name":"Manny Manager"}');
insert into corporation_memberships (user_id, corporation_id, status, joined_at)
  values ('73000000-0000-0000-0000-000000000001', 'BCS-1234', 'active', now());
insert into corporation_role_assignments (corporation_id, role, user_id)
  values ('BCS-1234', 'manager', '73000000-0000-0000-0000-000000000001');
delete from corporation_role_assignments where corporation_id = 'BCS-1234' and role = 'manager' and user_id = '00000000-0000-0000-0000-00000000000b';

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000b', array['admin', 'president']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['treasurer']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['member_at_large']);
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000b', 'SL001');
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL002');
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000f', 'SL003');
reset role;
select pg_temp.expect('three council lots', (select count(*) = 3 from owners_and_council where corporation_id = 'BCS-1234' and is_council_member));

-- A live council meeting Bob launched and called to order, everyone present.
set app.meeting_lifecycle = 'on';
insert into meetings (id, corporation_id, type, meeting_date, created_by, status, launched_by, launched_at, actual_start_at, attendance, agenda)
values ('73000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b', 'LIVE',
  '00000000-0000-0000-0000-00000000000b', now(), now(),
  '{"SL001":"present","SL002":"present","SL003":"present"}',
  '[{"id":"i4","text":"Roof replacement"},{"id":"i5","text":"Landscaping"}]');
reset app.meeting_lifecycle;
create temp table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;

set role authenticated;

-- Opening a vote
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select open_meeting_vote('73000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof be replaced', 'MAJORITY')$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select open_meeting_vote('73000000-0000-0000-0000-0000000000aa', 'i9', 'THAT', 'MAJORITY')$q$, 'saved agenda');
select pg_temp.expect_error($q$select open_meeting_vote('73000000-0000-0000-0000-0000000000aa', 'i4', ' ', 'MAJORITY')$q$, 'Write the motion');
insert into ids select 'v1', open_meeting_vote('73000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof be replaced', 'MAJORITY');
select pg_temp.expect('the vote snapshots the council lots present', (select eligible_lots = array['SL001','SL002','SL003'] from meeting_votes where id = (select id from ids where name = 'v1')));
select pg_temp.expect_error($q$select open_meeting_vote('73000000-0000-0000-0000-0000000000aa', 'i5', 'THAT', 'MAJORITY')$q$, 'Another vote is still open');

-- Members vote, and change their minds while it's open
set test.uid = '00000000-0000-0000-0000-00000000000c';
select cast_meeting_vote((select id from ids where name = 'v1'), 'for');
select cast_meeting_vote((select id from ids where name = 'v1'), 'against');
select pg_temp.expect('a member changes their own vote', (select choice = 'against' and not cast_for_other from meeting_ballots where lot_number = 'SL002'));
select pg_temp.expect_error($q$select cast_meeting_vote((select id from ids where name = 'v1'), 'maybe')$q$, 'Choose For');
set test.uid = '73000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$select cast_meeting_vote((select id from ids where name = 'v1'), 'for')$q$, 'Only council members present');
select pg_temp.expect('the manager follows along', (live_meeting_state('73000000-0000-0000-0000-0000000000aa') ->> 'myLot') is null
  and live_meeting_state('73000000-0000-0000-0000-0000000000aa') -> 'openVote' is not null);
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('an outsider sees nothing', live_meeting_state('73000000-0000-0000-0000-0000000000aa') is null);
select pg_temp.expect('an outsider reads no votes', (select count(*) = 0 from meeting_votes));
select pg_temp.expect_error($q$select cast_meeting_vote((select id from ids where name = 'v1'), 'for')$q$, 'Only council members present');

-- The runner enters votes for others, but never changes one a member cast
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select record_meeting_vote((select id from ids where name = 'v1'), 'SL002', 'for')$q$, 'voted themselves');
select record_meeting_vote((select id from ids where name = 'v1'), 'SL003', 'for');
select record_meeting_vote((select id from ids where name = 'v1'), 'SL003', 'abstain');
select pg_temp.expect('the runner corrects a vote they entered', (select choice = 'abstain' and cast_for_other from meeting_ballots where lot_number = 'SL003'));
select record_meeting_vote((select id from ids where name = 'v1'), 'SL001', 'against');
select cast_meeting_vote((select id from ids where name = 'v1'), 'for');
select pg_temp.expect('the runner''s own vote is their own, and changeable', (select choice = 'for' and not cast_for_other from meeting_ballots where lot_number = 'SL001'));
select pg_temp.expect_error($q$select record_meeting_vote((select id from ids where name = 'v1'), 'SL009', 'for')$q$, 'isn''t voting');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select cast_meeting_vote((select id from ids where name = 'v1'), 'for');
select pg_temp.expect('a member can change a vote entered for them', (select choice = 'for' and not cast_for_other from meeting_ballots where lot_number = 'SL003'));
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select record_meeting_vote((select id from ids where name = 'v1'), 'SL003', 'against')$q$, 'voted themselves');

-- Who sees what while it's open
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('a member sees only their own ballot', (select count(*) = 1 from meeting_ballots) and (select bool_and(lot_number = 'SL002') from meeting_ballots));
select pg_temp.expect('a member''s state has their ballot and no one else''s',
  live_meeting_state('73000000-0000-0000-0000-0000000000aa') #>> '{openVote,myBallot}' = 'against'
  and live_meeting_state('73000000-0000-0000-0000-0000000000aa') #> '{openVote,ballots}' = 'null'::jsonb);
select pg_temp.expect('members can''t read the ballot log', (select count(*) = 0 from meeting_ballot_log));
select pg_temp.expect_error($q$insert into meeting_ballots (vote_id, lot_number, choice) values ((select id from ids where name = 'v1'), 'SL002', 'for')$q$, 'permission denied');
select pg_temp.expect_error($q$update meeting_votes set status = 'closed'$q$, 'permission denied');
select pg_temp.expect_error($q$select put_meeting_ballot((select id from ids where name = 'v1'), 'SL002', 'for', false)$q$, 'permission denied');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('the runner sees every ballot', jsonb_array_length(live_meeting_state('73000000-0000-0000-0000-0000000000aa') #> '{openVote,ballots}') = 3);
select pg_temp.expect('every change is in the log', (select count(*) >= 7 from meeting_ballot_log where vote_id = (select id from ids where name = 'v1')));

-- Closing
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select close_meeting_vote((select id from ids where name = 'v1'))$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('closing counts the ballots', close_meeting_vote((select id from ids where name = 'v1')) = '{"for":2,"against":1,"abstain":0,"missing":0,"present":3}'::jsonb);
select pg_temp.expect_error($q$select record_meeting_vote((select id from ids where name = 'v1'), 'SL003', 'against')$q$, 'closed');
select pg_temp.expect_error($q$select close_meeting_vote((select id from ids where name = 'v1'))$q$, 'already closed');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select cast_meeting_vote((select id from ids where name = 'v1'), 'for')$q$, 'closed');
select pg_temp.expect('the result reaches members once closed', live_meeting_state('73000000-0000-0000-0000-0000000000aa') #> '{closedVotes,0}' @> '{"for":2,"against":1,"present":3}'::jsonb);

-- Conflicts of interest
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select declare_meeting_conflict('73000000-0000-0000-0000-0000000000aa', 'i5', 'SL003', '')$q$, 'Declare a conflict for yourself');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select declare_meeting_conflict('73000000-0000-0000-0000-0000000000aa', 'i5', 'SL003', 'My brother runs the landscaping company');
-- A member's declaration waits for the runner (0082)
select pg_temp.expect_error($q$select acknowledge_meeting_conflict('73000000-0000-0000-0000-0000000000aa', 'i5', 'SL003')$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select acknowledge_meeting_conflict('73000000-0000-0000-0000-0000000000aa', 'i5', 'SL003');
insert into ids select 'v2', open_meeting_vote('73000000-0000-0000-0000-0000000000aa', 'i5', 'THAT the landscaping contract be renewed', 'MAJORITY');
select pg_temp.expect('a conflicted member isn''t counted as present for the vote', (select eligible_lots = array['SL001','SL002'] from meeting_votes where id = (select id from ids where name = 'v2')));
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect_error($q$select cast_meeting_vote((select id from ids where name = 'v2'), 'for')$q$, 'Only council members present');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select cast_meeting_vote((select id from ids where name = 'v2'), 'for');
select declare_meeting_conflict('73000000-0000-0000-0000-0000000000aa', 'i5', 'SL002', 'Cousin is the contractor');
reset role;
select pg_temp.expect('a member''s declaration waits: they stay in the vote until the runner acknowledges it',
  (select eligible_lots = array['SL001','SL002'] from meeting_votes where id = (select id from ids where name = 'v2'))
  and exists (select 1 from meeting_ballots where vote_id = (select id from ids where name = 'v2') and lot_number = 'SL002')
  and (select acknowledged_at is null from meeting_conflicts where item_id = 'i5' and lot_number = 'SL002'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select acknowledge_meeting_conflict('73000000-0000-0000-0000-0000000000aa', 'i5', 'SL002');
reset role;
select pg_temp.expect('declaring during an open vote takes them out of it',
  (select eligible_lots = array['SL001'] from meeting_votes where id = (select id from ids where name = 'v2'))
  and not exists (select 1 from meeting_ballots where vote_id = (select id from ids where name = 'v2') and lot_number = 'SL002'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('followers see the conflicts', jsonb_array_length(live_meeting_state('73000000-0000-0000-0000-0000000000aa') -> 'conflicts') = 2);
select pg_temp.expect('followers see each conflict acknowledged', (select bool_and((c ->> 'acknowledged')::boolean) from jsonb_array_elements(live_meeting_state('73000000-0000-0000-0000-0000000000aa') -> 'conflicts') c));
select pg_temp.expect('acknowledging is for signed-in people only', not has_function_privilege('anon', 'public.acknowledge_meeting_conflict(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.acknowledge_meeting_conflict(uuid, text, text)', 'execute'));
select pg_temp.expect_error($q$select withdraw_meeting_conflict('73000000-0000-0000-0000-0000000000aa', 'i5', 'SL002')$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select withdraw_meeting_conflict('73000000-0000-0000-0000-0000000000aa', 'i5', 'SL002');
select pg_temp.expect('the runner removes a conflict recorded by mistake', (select count(*) = 1 from meeting_conflicts));

-- The current item is readable by members
reset role;
set app.meeting_lifecycle = 'on';
update meetings set current_item_id = 'i5' where id = '73000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('members follow the current item', (select current_item_id = 'i5' from meetings where id = '73000000-0000-0000-0000-0000000000aa'));

-- Adjourning cancels a vote left open
reset role;
set app.meeting_lifecycle = 'on';
update meetings set status = 'ADJOURNED', adjourned_at = now() where id = '73000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;
select pg_temp.expect('a vote left open is cancelled at adjournment', (select status = 'cancelled' from meeting_votes where id = (select id from ids where name = 'v2')));
select pg_temp.expect('the closed vote stays closed', (select status = 'closed' and votes_for = 2 from meeting_votes where id = (select id from ids where name = 'v1')));

-- General meetings aren't live-voted yet
set app.meeting_lifecycle = 'on';
insert into meetings (id, corporation_id, type, meeting_date, created_by, status, launched_by, launched_at, actual_start_at, attendance, agenda)
values ('73000000-0000-0000-0000-0000000000bb', 'BCS-1234', 'agm', '2026-11-20', '00000000-0000-0000-0000-00000000000b', 'LIVE',
  '00000000-0000-0000-0000-00000000000b', now(), now(), '{"SL001":"present"}', '[{"id":"g1","text":"Budget"}]');
reset app.meeting_lifecycle;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select open_meeting_vote('73000000-0000-0000-0000-0000000000bb', 'g1', 'THAT the budget be approved', 'MAJORITY')$q$, 'council meetings for now');
reset role;

select pg_temp.expect('no live-voting function is callable signed out',
  not has_function_privilege('anon', 'public.cast_meeting_vote(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.live_meeting_state(uuid)', 'execute'));
