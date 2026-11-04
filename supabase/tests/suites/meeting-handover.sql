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


-- 0079: handing a meeting over, and taking over from a Runner who has gone.
-- Bob (admin, SL001) runs it; Cara (treasurer, SL002) may run meetings;
-- Finn (member at large, SL003) may not.
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
values ('79000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b', '[]');
set app.meeting_lifecycle = 'on';
update meetings set launched_by = '00000000-0000-0000-0000-00000000000b', launched_at = now(), status = 'LIVE', actual_start_at = now()
  where id = '79000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select join_meeting('79000000-0000-0000-0000-0000000000aa');
select runner_check_in('79000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('the Runner checks in', (select runner_seen_at is not null from meetings where id = '79000000-0000-0000-0000-0000000000aa'));
select pg_temp.expect_error($q$select hand_over_meeting('79000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c')$q$, 'isn''t in the meeting');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select join_meeting('79000000-0000-0000-0000-0000000000aa');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select join_meeting('79000000-0000-0000-0000-0000000000aa');
select pg_temp.expect_error($q$select runner_check_in('79000000-0000-0000-0000-0000000000aa')$q$, 'Only the person running');
select pg_temp.expect_error($q$select hand_over_meeting('79000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000f')$q$, 'Only the person running');

set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select hand_over_meeting('79000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000f')$q$, 'can''t run meetings');
select hand_over_meeting('79000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c');
select pg_temp.expect('Cara runs it now', (select launched_by = '00000000-0000-0000-0000-00000000000c' from meetings where id = '79000000-0000-0000-0000-0000000000aa'));
select pg_temp.expect('the handover is recorded', (select count(*) = 1 from meeting_handovers where meeting_id = '79000000-0000-0000-0000-0000000000aa' and kind = 'handed_over'));
select pg_temp.expect_error($q$select runner_check_in('79000000-0000-0000-0000-0000000000aa')$q$, 'Only the person running');

-- Bob can't just take it back while Cara's screen is checking in
select pg_temp.expect_error($q$select take_over_meeting('79000000-0000-0000-0000-0000000000aa')$q$, 'still connected');
-- Cara's screen goes quiet for 2 minutes: Bob takes over; Finn can't
reset role;
update meetings set runner_seen_at = now() - interval '3 minutes' where id = '79000000-0000-0000-0000-0000000000aa';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect_error($q$select take_over_meeting('79000000-0000-0000-0000-0000000000aa')$q$, 'Only someone who can run meetings');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select take_over_meeting('79000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('Bob took over', (select launched_by = '00000000-0000-0000-0000-00000000000b' from meetings where id = '79000000-0000-0000-0000-0000000000aa')
  and (select count(*) = 1 from meeting_handovers where kind = 'took_over'));
select pg_temp.expect('council reads the handovers', (select count(*) = 2 from meeting_handovers));
reset role;
select pg_temp.expect('nobody writes handovers directly', not has_table_privilege('authenticated', 'public.meeting_handovers', 'insert'));
