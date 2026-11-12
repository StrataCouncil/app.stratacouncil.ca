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

-- 0090. In the seed, Bob is BCS-1234's admin, Cara a member off council (and,
-- from here, a manager), Sam a Super Admin, Xavier an outsider.
update corporation_memberships set can_run_meetings = true where user_id = '00000000-0000-0000-0000-00000000000b';

-- Stratasphere: subscribed, and council, manager, or admin.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('admin, not subscribed: no Stratasphere', stratasphere_allowed('BCS-1234') = 'subscription');
reset role;
insert into subscriptions (corporation_id, status) values ('BCS-1234', 'active') on conflict (corporation_id) do update set status = 'active';
set role authenticated;
select pg_temp.expect('admin, subscribed: allowed', stratasphere_allowed('BCS-1234') = 'ok' and consume_stratasphere_request('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('member off council: no Stratasphere', stratasphere_allowed('BCS-1234') = 'subscription');
reset role;
insert into corporation_role_assignments (corporation_id, user_id, role) values ('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'manager') on conflict do nothing;
set role authenticated;
select pg_temp.expect('manager: allowed', stratasphere_allowed('BCS-1234') = 'ok');
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('outsider: no Stratasphere', stratasphere_allowed('BCS-1234') = 'subscription');
set test.uid = '00000000-0000-0000-0000-00000000000d';
set test.aal = 'aal2';
select pg_temp.expect('Super Admin: allowed (the recall check)', stratasphere_allowed('BCS-1234') = 'ok');

-- 30 questions in an hour, then a wait; older questions don't count.
reset role;
insert into stratasphere_usage (corporation_id, user_id, surface, created_at)
  select 'BCS-1234', '00000000-0000-0000-0000-00000000000b', 'assistant', now() - interval '2 hours' from generate_series(1, 40);
insert into stratasphere_usage (corporation_id, user_id, surface)
  select 'BCS-1234', '00000000-0000-0000-0000-00000000000b', 'meeting' from generate_series(1, 29);
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('29 in the last hour: allowed', stratasphere_allowed('BCS-1234') = 'ok');
reset role;
insert into stratasphere_usage (corporation_id, user_id, surface) values ('BCS-1234', '00000000-0000-0000-0000-00000000000b', 'assistant');
set role authenticated;
select pg_temp.expect('30 in the last hour: wait', stratasphere_allowed('BCS-1234') = 'limit' and not consume_stratasphere_request('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('the limit is per person', stratasphere_allowed('BCS-1234') = 'ok');

-- A lapsed subscription: back to no Stratasphere; the records stay (decisions are still there for the server).
reset role;
insert into decisions (corporation_id, title) values ('BCS-1234', 'Roof repairs approved');
update subscriptions set status = 'deactivated' where corporation_id = 'BCS-1234';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('lapsed: no Stratasphere', stratasphere_allowed('BCS-1234') = 'subscription');
select pg_temp.expect('lapsed: the ledger is locked to the browser', (select count(*) = 0 from decisions));
reset role;
select pg_temp.expect('but kept', (select count(*) = 1 from decisions where corporation_id = 'BCS-1234'));

-- General meetings need a subscription; council meetings never do.
insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda) values
  ('cccccccc-0000-0000-0000-000000000001', 'BCS-1234', 'agm', '2026-12-01', '00000000-0000-0000-0000-00000000000b', '[{"id":"i1","text":"Call to Order"}]'),
  ('cccccccc-0000-0000-0000-000000000002', 'BCS-1234', 'council', '2026-12-02', '00000000-0000-0000-0000-00000000000b', '[{"id":"i1","text":"Call to Order"}]'),
  ('cccccccc-0000-0000-0000-000000000003', 'BCS-1234', 'committee', '2026-12-03', '00000000-0000-0000-0000-00000000000b', '[{"id":"i1","text":"Call to Order"}]');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$select launch_meeting('cccccccc-0000-0000-0000-000000000001')$q$, 'General meetings come with a Stratasphere subscription');
select pg_temp.expect('council meeting, no subscription', launch_meeting('cccccccc-0000-0000-0000-000000000002') = 'launched');
select pg_temp.expect('committee meeting, no subscription', launch_meeting('cccccccc-0000-0000-0000-000000000003') = 'launched');
reset role;
update subscriptions set status = 'active' where corporation_id = 'BCS-1234';
set role authenticated;
select pg_temp.expect('general meeting, subscribed', launch_meeting('cccccccc-0000-0000-0000-000000000001') = 'launched');

-- The council's own video link: web links only.
reset role;
update meetings set video_link = 'https://zoom.us/j/123456789?pwd=abc' where id = 'cccccccc-0000-0000-0000-000000000002';
select pg_temp.expect('a Zoom link is kept', (select video_link like 'https://zoom.us/%' from meetings where id = 'cccccccc-0000-0000-0000-000000000002'));
select pg_temp.expect_error($q$update meetings set video_link = 'javascript:alert(1)' where id = 'cccccccc-0000-0000-0000-000000000002'$q$, 'meetings_video_link_check');
select pg_temp.expect_error($q$update meetings set video_link = 'https://example.com/a b' where id = 'cccccccc-0000-0000-0000-000000000002'$q$, 'meetings_video_link_check');
update meetings set video_link = null where id = 'cccccccc-0000-0000-0000-000000000002';

-- Documents can wait to be indexed until the strata subscribes.
update documents set indexing_status = 'waiting' where id = '11111111-1111-1111-1111-111111111111';
select pg_temp.expect('waiting is a status', (select indexing_status = 'waiting' from documents where id = '11111111-1111-1111-1111-111111111111'));
select pg_temp.expect_error($q$update documents set indexing_status = 'paused' where id = '11111111-1111-1111-1111-111111111111'$q$, 'documents_indexing_status_check');
