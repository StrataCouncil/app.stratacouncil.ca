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

-- 0084: conflicts follow the person. BCS-1234's council: Bob (admin and
-- president, SL001), Cara (treasurer, SL002, may run meetings), Finn
-- (member at large, SL003).
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000b', array['admin', 'president']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['treasurer']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['member_at_large']);
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000b', 'SL001');
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL002');
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000f', 'SL003');
reset role;
update corporation_memberships set can_run_meetings = true where user_id = '00000000-0000-0000-0000-00000000000c' and corporation_id = 'BCS-1234';
delete from subscriptions where corporation_id = 'BCS-1234';
create temp table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;

-- Discussions remember each voter's lot.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000f';
insert into ids select 'd', create_discussion('BCS-1234', 'Landscaping contract', '', '', '', 'THAT council award the landscaping contract.');
select pg_temp.expect('each voter has their lot',
  (select array_agg(lot_number order by lot_number) = array['SL001','SL002','SL003'] from discussion_voters where discussion_id = (select id from ids where name = 'd')));

-- Finn has a conflict; Bob and Cara vote for.
select cast_discussion_vote((select id from ids where name = 'd'), 'recused', 'My brother runs the landscaping company');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select cast_discussion_vote((select id from ids where name = 'd'), 'for', null);
set test.uid = '00000000-0000-0000-0000-00000000000b';
select cast_discussion_vote((select id from ids where name = 'd'), 'for', null);

-- Closing: the person who started it, or an Admin. Cara is neither.
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select close_discussion((select id from ids where name = 'd'))$q$, 'or an Admin');
-- Bob didn't start it, but he's an Admin.
set test.uid = '00000000-0000-0000-0000-00000000000b';
select close_discussion((select id from ids where name = 'd'));
select pg_temp.expect('an Admin closed it: carried, 2 for, 1 conflict',
  (select result = 'supported' and votes_for = 2 and votes_recused = 1 from discussions where id = (select id from ids where name = 'd')));

-- A live council meeting Bob runs, with the ratification item and another.
reset role;
set app.meeting_lifecycle = 'on';
insert into meetings (id, corporation_id, type, meeting_date, created_by, status, launched_by, launched_at, actual_start_at, attendance, agenda)
select '84000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b', 'LIVE',
  '00000000-0000-0000-0000-00000000000b', now(), now(),
  '{"SL001":"present","SL002":"present","SL003":"present"}',
  jsonb_build_array(
    jsonb_build_object('id', 'r1', 'text', 'Ratify: Landscaping contract', 'discussionId', (select id from ids where name = 'd')),
    jsonb_build_object('id', 'i2', 'text', 'Roof replacement'));
reset app.meeting_lifecycle;

set role authenticated;
-- Only the Runner steps people out for a ratification item.
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select step_out_discussion_conflicts('84000000-0000-0000-0000-0000000000aa', 'r1')$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select step_out_discussion_conflicts('84000000-0000-0000-0000-0000000000aa', 'r1');
select step_out_discussion_conflicts('84000000-0000-0000-0000-0000000000aa', 'i2');
select pg_temp.expect('Finn''s discussion conflict is on the ratification item, acknowledged, with his reason',
  (select count(*) = 1 from meeting_conflicts where meeting_id = '84000000-0000-0000-0000-0000000000aa' and item_id = 'r1' and lot_number = 'SL003'
     and acknowledged_at is not null and note like '%brother runs the landscaping%'));
select pg_temp.expect('and nowhere else', (select count(*) = 1 from meeting_conflicts where meeting_id = '84000000-0000-0000-0000-0000000000aa'));
-- Opening the vote applies it too (here it's already there): Finn isn't in the vote.
insert into ids select 'v', open_meeting_vote('84000000-0000-0000-0000-0000000000aa', 'r1', 'THAT council ratify the landscaping decision', 'MAJORITY');
select pg_temp.expect('the ratification vote leaves Finn out',
  (select eligible_lots = array['SL001','SL002'] from meeting_votes where id = (select id from ids where name = 'v')));
select cancel_meeting_vote((select id from ids where name = 'v'));

-- The Runner's own conflict: Bob can't record it and carry on running.
select pg_temp.expect_error($q$select declare_meeting_conflict('84000000-0000-0000-0000-0000000000aa', 'i2', 'SL001', 'My company quoted on the roof')$q$, 'Hand the meeting to someone else');
-- He hands over to someone who can run meetings and is in the meeting.
select pg_temp.expect_error($q$select declare_runner_conflict('84000000-0000-0000-0000-0000000000aa', 'i2', 'My company quoted on the roof', '00000000-0000-0000-0000-00000000000c')$q$, 'isn''t in the meeting');
select pg_temp.expect_error($q$select declare_runner_conflict('84000000-0000-0000-0000-0000000000aa', 'i2', 'x', '00000000-0000-0000-0000-00000000000c')$q$, 'Describe the conflict');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select join_meeting('84000000-0000-0000-0000-0000000000aa');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select join_meeting('84000000-0000-0000-0000-0000000000aa');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select join_meeting('84000000-0000-0000-0000-0000000000aa');
select pg_temp.expect_error($q$select declare_runner_conflict('84000000-0000-0000-0000-0000000000aa', 'i2', 'My company quoted on the roof', '00000000-0000-0000-0000-00000000000f')$q$, 'can''t run meetings');
select declare_runner_conflict('84000000-0000-0000-0000-0000000000aa', 'i2', 'My company quoted on the roof', '00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('Cara runs it now', (select launched_by = '00000000-0000-0000-0000-00000000000c' from meetings where id = '84000000-0000-0000-0000-0000000000aa'));
select pg_temp.expect('the handover notes the item and why',
  (select item_id = 'i2' and reason = 'conflict' and from_name <> '' from meeting_handovers where meeting_id = '84000000-0000-0000-0000-0000000000aa' order by id desc limit 1));
select pg_temp.expect('Bob''s conflict is recorded and acknowledged',
  (select acknowledged_at is not null from meeting_conflicts where meeting_id = '84000000-0000-0000-0000-0000000000aa' and item_id = 'i2' and lot_number = 'SL001'));
select pg_temp.expect_error($q$select declare_runner_conflict('84000000-0000-0000-0000-0000000000aa', 'i2', 'again', '00000000-0000-0000-0000-00000000000c')$q$, 'Only the person running');
-- Cara opens the roof vote: Bob is out of it.
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into ids select 'v2', open_meeting_vote('84000000-0000-0000-0000-0000000000aa', 'i2', 'THAT the roof be replaced', 'MAJORITY');
select pg_temp.expect('the roof vote leaves Bob out',
  (select eligible_lots = array['SL002','SL003'] from meeting_votes where id = (select id from ids where name = 'v2')));
select cancel_meeting_vote((select id from ids where name = 'v2'));
-- And hands it back afterwards.
select hand_over_meeting('84000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('Bob runs it again', (select launched_by = '00000000-0000-0000-0000-00000000000b' from meetings where id = '84000000-0000-0000-0000-0000000000aa'));

reset role;
select pg_temp.expect('the internal helper isn''t callable', not has_function_privilege('authenticated', 'public.apply_discussion_conflicts(uuid, text)', 'execute'));
select pg_temp.expect('signed-in only', not has_function_privilege('anon', 'public.declare_runner_conflict(uuid, text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.step_out_discussion_conflicts(uuid, text)', 'execute'));
