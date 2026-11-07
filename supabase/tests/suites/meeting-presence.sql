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

-- 0074: joining and leaving, one agenda editor at a time, votes need quorum.
-- BCS-1234's council: Bob (admin and president, SL001, runs the meeting),
-- Cara (treasurer, SL002, can run meetings), Finn (member at large, SL003);
-- Manny the manager; Xavier an outsider.
insert into auth.users (id, email, raw_user_meta_data) values
  ('74000000-0000-0000-0000-000000000001', 'manny74@x.ca', '{"full_name":"Manny Manager"}');
insert into corporation_memberships (user_id, corporation_id, status, joined_at)
  values ('74000000-0000-0000-0000-000000000001', 'BCS-1234', 'active', now());
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'manager', '74000000-0000-0000-0000-000000000001');
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
update corporation_memberships set can_run_meetings = true where user_id = '00000000-0000-0000-0000-00000000000c' and corporation_id = 'BCS-1234';

insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda)
values ('74000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b',
  '[{"id":"i1","text":"Call to Order"},{"id":"i4","text":"Roof replacement"}]');

set role authenticated;

-- One agenda editor at a time
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('the first editor gets the agenda', (claim_agenda('74000000-0000-0000-0000-0000000000aa') ->> 'mine')::boolean);
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('a second sees who has it', claim_agenda('74000000-0000-0000-0000-0000000000aa') @> '{"mine": false, "editor": "Bob Joiner"}'::jsonb);
select release_agenda('74000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('only the editor can release it', (select agenda_editor = '00000000-0000-0000-0000-00000000000b' from meetings where id = '74000000-0000-0000-0000-0000000000aa'));
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect_error($q$select claim_agenda('74000000-0000-0000-0000-0000000000aa')$q$, 'Only someone who can run meetings');
reset role;
update meetings set agenda_editor_at = now() - interval '16 minutes' where id = '74000000-0000-0000-0000-0000000000aa';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('a checkout untouched for 15 minutes can be taken', (claim_agenda('74000000-0000-0000-0000-0000000000aa') ->> 'mine')::boolean);
select release_agenda('74000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('released', (select agenda_editor is null from meetings where id = '74000000-0000-0000-0000-0000000000aa'));
select pg_temp.expect('members read who has the agenda', (select count(*) = 1 from (select agenda_editor, agenda_editor_at from meetings where id = '74000000-0000-0000-0000-0000000000aa') t));

-- Joining before launch isn't possible
select pg_temp.expect_error($q$select join_meeting('74000000-0000-0000-0000-0000000000aa')$q$, 'isn''t running');

-- Launched (not yet called to order): members join
reset role;
set app.meeting_lifecycle = 'on';
update meetings set launched_by = '00000000-0000-0000-0000-00000000000b', launched_at = now() where id = '74000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select claim_agenda('74000000-0000-0000-0000-0000000000aa')$q$, 'has been launched');
select join_meeting('74000000-0000-0000-0000-0000000000aa');
select join_meeting('74000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('joining marks the lot present, once', (select attendance ->> 'SL002' = 'present' from meetings where id = '74000000-0000-0000-0000-0000000000aa')
  and (select count(*) = 1 from meeting_presence where user_id = '00000000-0000-0000-0000-00000000000c'));
select pg_temp.expect('the live state works from launch', (live_meeting_state('74000000-0000-0000-0000-0000000000aa') ->> 'launched')::boolean
  and jsonb_array_length(live_meeting_state('74000000-0000-0000-0000-0000000000aa') -> 'presence') = 1);
set test.uid = '00000000-0000-0000-0000-00000000000f';
select join_meeting('74000000-0000-0000-0000-0000000000aa');
select leave_meeting('74000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('leaving before Call to Order clears the lot (0075)', (select not (attendance ? 'SL003') from meetings where id = '74000000-0000-0000-0000-0000000000aa'));
select join_meeting('74000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('and rejoining, present again', (select attendance ->> 'SL003' = 'present' from meetings where id = '74000000-0000-0000-0000-0000000000aa')
  and (select count(*) = 3 from meeting_presence where user_id = '00000000-0000-0000-0000-00000000000f'));
select pg_temp.expect('the present list follows', (select attendees @> '["SL002","SL003"]'::jsonb from meetings where id = '74000000-0000-0000-0000-0000000000aa'));
set test.uid = '74000000-0000-0000-0000-000000000001';
select join_meeting('74000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('the manager joins with no lot and no attendance', (select lot_number is null from meeting_presence where user_id = '74000000-0000-0000-0000-000000000001')
  and (select (select count(*) from jsonb_object_keys(attendance)) = 2 from meetings where id = '74000000-0000-0000-0000-0000000000aa'));
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect_error($q$select join_meeting('74000000-0000-0000-0000-0000000000aa')$q$, 'isn''t available');
select pg_temp.expect('an outsider reads no presence', (select count(*) = 0 from meeting_presence));

-- The runner marks someone as left, with the confirmation typed
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select mark_left_meeting('74000000-0000-0000-0000-0000000000aa', 'SL003', 'Left meeting')$q$, 'Only the person running');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select mark_left_meeting('74000000-0000-0000-0000-0000000000aa', 'SL003', 'yes')$q$, 'Type "Left meeting"');
select mark_left_meeting('74000000-0000-0000-0000-0000000000aa', 'SL003', '  left MEETING ');
select pg_temp.expect('marked left by the runner', (select not (attendance ? 'SL003') from meetings where id = '74000000-0000-0000-0000-0000000000aa')
  and exists (select 1 from meeting_presence where event = 'marked_left' and lot_number = 'SL003' and by_user = '00000000-0000-0000-0000-00000000000b'));
select pg_temp.expect_error($q$select mark_left_meeting('74000000-0000-0000-0000-0000000000aa', 'SL003', 'Left meeting')$q$, 'isn''t marked present');
reset role;
select pg_temp.expect('nobody writes presence directly', not has_table_privilege('authenticated', 'public.meeting_presence', 'insert'));

-- Conflicts need their nature, and work from launch
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select declare_meeting_conflict('74000000-0000-0000-0000-0000000000aa', 'i4', 'SL002', ' ')$q$, 'Describe the conflict');
select declare_meeting_conflict('74000000-0000-0000-0000-0000000000aa', 'i4', 'SL002', 'Brother-in-law owns the roofing company');
select pg_temp.expect('declared before Call to Order', (select count(*) = 1 from meeting_conflicts where meeting_id = '74000000-0000-0000-0000-0000000000aa'));

-- No vote without quorum: 3 council members need 2 present
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select open_meeting_vote('74000000-0000-0000-0000-0000000000aa', 'i4', 'THAT', 'MAJORITY')$q$, 'Call the meeting to order');
reset role;
set app.meeting_lifecycle = 'on';
update meetings set status = 'LIVE', actual_start_at = now() where id = '74000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;
set role authenticated;
-- Only Cara (SL002) is present now; Finn left and Bob hasn't joined.
select pg_temp.expect_error($q$select open_meeting_vote('74000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof be replaced', 'MAJORITY')$q$, 'No quorum: 1 of 3');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select join_meeting('74000000-0000-0000-0000-0000000000aa');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select acknowledge_meeting_conflict('74000000-0000-0000-0000-0000000000aa', 'i4', 'SL002');
select open_meeting_vote('74000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof be replaced', 'MAJORITY');
select pg_temp.expect('with quorum back, the vote opens (the conflicted member left out)',
  (select eligible_lots = array['SL003'] from meeting_votes where meeting_id = '74000000-0000-0000-0000-0000000000aa' and status = 'open'));
reset role;

select pg_temp.expect('council quorum matches the bylaws', council_quorum(1) = 1 and council_quorum(4) = 2 and council_quorum(5) = 3 and council_quorum(7) = 4 and council_quorum(9) = 5);
select pg_temp.expect('nothing here is callable signed out',
  not has_function_privilege('anon', 'public.join_meeting(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.claim_agenda(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_meeting_attendance(uuid, text, text)', 'execute'));
