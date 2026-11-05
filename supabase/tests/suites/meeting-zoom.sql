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

-- 0080: Zoom meeting details are for the server only.
insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda, format)
values ('80000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b', '[]', 'virtual'),
       ('80000000-0000-0000-0000-0000000000bb', 'BCS-1234', 'council', '2026-11-19', '00000000-0000-0000-0000-00000000000b', '[]', 'virtual');
insert into meeting_zoom (meeting_id, zoom_meeting_id, passcode, host_email)
values ('80000000-0000-0000-0000-0000000000aa', '81234567890', 'Ab3dE5', 'host@stratacouncil.ca');

-- Signed-in users, even the strata's admin, can't read or write it.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select passcode from meeting_zoom$q$, 'permission denied');
select pg_temp.expect_error($q$insert into meeting_zoom (meeting_id, zoom_meeting_id, host_email) values ('80000000-0000-0000-0000-0000000000bb', '1', 'x@y.z')$q$, 'permission denied');
reset role;
set role anon;
select pg_temp.expect_error($q$select passcode from meeting_zoom$q$, 'permission denied');
reset role;

-- One open Zoom meeting per host licence, and per meeting.
select pg_temp.expect_error($q$insert into meeting_zoom (meeting_id, zoom_meeting_id, host_email) values ('80000000-0000-0000-0000-0000000000bb', '2', 'HOST@stratacouncil.ca')$q$, 'meeting_zoom_one_open_per_host');
select pg_temp.expect_error($q$insert into meeting_zoom (meeting_id, zoom_meeting_id, host_email) values ('80000000-0000-0000-0000-0000000000aa', '3', 'other@stratacouncil.ca')$q$, 'meeting_zoom_one_open_per_meeting');
-- Once it has ended, the host is free again.
update meeting_zoom set ended_at = now() where meeting_id = '80000000-0000-0000-0000-0000000000aa';
insert into meeting_zoom (meeting_id, zoom_meeting_id, host_email) values ('80000000-0000-0000-0000-0000000000bb', '4', 'host@stratacouncil.ca');
select pg_temp.expect('an ended Zoom meeting frees its host', (select count(*) = 1 from meeting_zoom where ended_at is null));
-- Deleting the meeting deletes its Zoom rows.
delete from meetings where id = '80000000-0000-0000-0000-0000000000bb';
select pg_temp.expect('rows go with the meeting', (select count(*) = 0 from meeting_zoom where meeting_id = '80000000-0000-0000-0000-0000000000bb'));
