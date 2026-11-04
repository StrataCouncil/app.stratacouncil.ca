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


-- 0078: council and whoever runs meetings start, read and comment on
-- discussions; only council votes. Bob (admin, president) and Finn (member
-- at large) are council; Manny is the manager, allowed to run meetings;
-- Xavier is an owner with no role.
insert into auth.users (id, email, raw_user_meta_data) values
  ('78000000-0000-0000-0000-000000000001', 'manny78@x.ca', '{"full_name":"Manny Manager"}');
insert into corporation_memberships (user_id, corporation_id, status, joined_at, can_run_meetings)
  values ('78000000-0000-0000-0000-000000000001', 'BCS-1234', 'active', now(), true);
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'manager', '78000000-0000-0000-0000-000000000001');
insert into subscriptions (corporation_id, status) select 'BCS-1234', 'active' where not exists (select 1 from subscriptions where corporation_id = 'BCS-1234' and status = 'active');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000b', array['admin', 'president']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['member_at_large']);

set test.uid = '78000000-0000-0000-0000-000000000001';
select create_discussion('BCS-1234', 'Approve Form P amendments', 'Developer asks', '', '', 'THAT council approves the Form P amendments');
select pg_temp.expect('the manager reads the discussion they started', (select count(*) = 1 from discussions where author_name = 'Manny Manager'));
select pg_temp.expect('but isn''t a voter', not exists (select 1 from discussion_voters where user_id = '78000000-0000-0000-0000-000000000001'));
select pg_temp.expect('council are the voters', (select count(*) >= 2 from discussion_voters v join discussions d on d.id = v.discussion_id where d.author_name = 'Manny Manager'));
select pg_temp.expect_error($q$select cast_discussion_vote((select id from discussions where author_name = 'Manny Manager'), 'for')$q$, 'Only council members can vote');
select add_discussion_comment((select id from discussions where author_name = 'Manny Manager'), 'Quote attached next week');
select pg_temp.expect('the manager can comment', (select count(*) = 1 from discussion_comments where author_name = 'Manny Manager'));

set test.uid = '00000000-0000-0000-0000-00000000000f';
select cast_discussion_vote((select id from discussions where author_name = 'Manny Manager'), 'for');
select pg_temp.expect('council votes as before', exists (select 1 from discussion_voters where user_id = '00000000-0000-0000-0000-00000000000f' and vote = 'for'));

set test.uid = '78000000-0000-0000-0000-000000000001';
select close_discussion((select id from discussions where author_name = 'Manny Manager'));
select pg_temp.expect('and closes the one they started', (select status = 'closed' from discussions where author_name = 'Manny Manager'));

set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('an owner with no role sees nothing', (select count(*) = 0 from discussions));
select pg_temp.expect_error($q$select create_discussion('BCS-1234', 'X', '', '', '', 'THAT')$q$, 'Only council members and those who run meetings');
reset role;
