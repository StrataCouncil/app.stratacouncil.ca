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
update corporation_memberships set can_run_meetings = false where user_id = '00000000-0000-0000-0000-00000000000c';
delete from subscriptions;

set role authenticated;
-- Cara: plain member, no permission
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('plain member cannot run meetings', not can_run_meetings('BCS-1234'));
select pg_temp.expect_error($q$insert into meetings (corporation_id, type, meeting_date, created_by) values ('BCS-1234','council','2026-11-01','00000000-0000-0000-0000-00000000000c')$q$, 'row-level security');

-- Bob (admin) creates two drafts
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('admin can run meetings', can_run_meetings('BCS-1234'));
insert into meetings (id, corporation_id, type, meeting_date, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001','BCS-1234','council','2026-11-01','00000000-0000-0000-0000-00000000000b'),
  ('aaaaaaaa-0000-0000-0000-000000000002','BCS-1234','council','2026-12-01','00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($q$insert into meetings (corporation_id, type, meeting_date, created_by, status) values ('BCS-1234','council','2026-11-01','00000000-0000-0000-0000-00000000000b','LIVE')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into meetings (corporation_id, type, meeting_date, created_by, is_trial) values ('BCS-1234','council','2026-11-01','00000000-0000-0000-0000-00000000000b',true)$q$, 'row-level security');
select pg_temp.expect_error($q$update meetings set status = 'LIVE' where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$, 'lifecycle');
select pg_temp.expect_error($q$select launch_meeting('aaaaaaaa-0000-0000-0000-000000000001')$q$, 'Build the agenda');
update meetings set agenda = '[{"id":"i1","text":"Call to Order"}]' where id in ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002');
insert into meeting_item_notes (meeting_id, item_id, body) values ('aaaaaaaa-0000-0000-0000-000000000001','i1','third complaint');

-- Grant Cara the switch: she can now edit drafts and see notes
reset role; update corporation_memberships set can_run_meetings = true where user_id = '00000000-0000-0000-0000-00000000000c'; set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('switch holder sees notes on unlaunched meeting', (select count(*) = 1 from meeting_item_notes));
update meetings set location = 'Lobby' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.expect('switch holder edits a draft someone else created', (select location = 'Lobby' from meetings where id = 'aaaaaaaa-0000-0000-0000-000000000001'));

-- Bob launches: trial consumed
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('first launch uses the trial', launch_meeting('aaaaaaaa-0000-0000-0000-000000000001') = 'launched_trial');
reset role;
select pg_temp.expect('trial flagged on corp and meeting', (select free_meeting_used from strata_corporations where strata_plan_number='BCS-1234') and (select is_trial from meetings where id='aaaaaaaa-0000-0000-0000-000000000001'));
set role authenticated;
select pg_temp.expect('relaunch by the launcher resumes', launch_meeting('aaaaaaaa-0000-0000-0000-000000000001') = 'resumed');
select pg_temp.expect('trial gives stratasphere access', has_stratasphere_access('BCS-1234'));
select pg_temp.expect_error($q$select launch_meeting('aaaaaaaa-0000-0000-0000-000000000002')$q$, 'free meeting has been used');

-- Cara: one launch — she can't take over, edit, or see its notes
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select launch_meeting('aaaaaaaa-0000-0000-0000-000000000001')$q$, 'someone else');
update meetings set location = 'Hijack' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.expect('non-launcher update is a no-op', (select location = 'Lobby' from meetings where id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select pg_temp.expect('non-launcher cannot see notes of a launched meeting', (select count(*) = 0 from meeting_item_notes));
select pg_temp.expect_error($q$select call_meeting_to_order('aaaaaaaa-0000-0000-0000-000000000001', '{}', '[]')$q$, 'not allowed');
delete from meetings where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.expect('launched meeting cannot be deleted', (select count(*) = 1 from meetings where id = 'aaaaaaaa-0000-0000-0000-000000000001'));

-- Bob calls to order
set test.uid = '00000000-0000-0000-0000-00000000000b';
select call_meeting_to_order('aaaaaaaa-0000-0000-0000-000000000001', '{"SL001":"present"}', '["SL001"]');
select pg_temp.expect('LIVE with start time and attendance', (select status = 'LIVE' and actual_start_at is not null and attendees = '["SL001"]' from meetings where id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select pg_temp.expect_error($q$select call_meeting_to_order('aaaaaaaa-0000-0000-0000-000000000001', '{}', '[]')$q$, 'already been called');
update meetings set attendance = '{"SL001":"present","SL002":"present"}' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.expect('late arrival recorded after CTO', (select attendance ? 'SL002' from meetings where id = 'aaaaaaaa-0000-0000-0000-000000000001'));

-- Subscribed corp: launch doesn't consume anything
reset role; insert into subscriptions (corporation_id, status) values ('BCS-1234','active'); set role authenticated;
select pg_temp.expect('subscribed launch', launch_meeting('aaaaaaaa-0000-0000-0000-000000000002') = 'launched');

-- Removed member Al: nothing
set test.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect('removed member sees no meetings', (select count(*) = 0 from meetings));
select pg_temp.expect('removed member has no access', not has_stratasphere_access('BCS-1234'));
select pg_temp.expect_error($q$select launch_meeting('aaaaaaaa-0000-0000-0000-000000000002')$q$, 'not allowed');

-- decisions: no direct writes
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$insert into decisions (corporation_id, title) values ('BCS-1234','x')$q$, 'row-level security');
-- directory exposes the new column
select pg_temp.expect('directory shows can_run_meetings', (select bool_or(can_run_meetings) from corporation_member_directory('BCS-1234')));
