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

-- 0070: council discussions. A council of four on BCS-1234 (Pat president,
-- Tess treasurer, Max and Mia members at large), a manager and an owner.
insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0000-0000-0000-000000000001', 'pat@x.ca', '{"full_name":"Pat President"}'),
  ('70000000-0000-0000-0000-000000000002', 'tess@x.ca', '{"full_name":"Tess Treasurer"}'),
  ('70000000-0000-0000-0000-000000000003', 'max@x.ca', '{"full_name":"Max Member"}'),
  ('70000000-0000-0000-0000-000000000004', 'mia@x.ca', '{"full_name":"Mia Member"}'),
  ('70000000-0000-0000-0000-000000000005', 'manny@x.ca', '{"full_name":"Manny Manager"}'),
  ('70000000-0000-0000-0000-000000000006', 'owen@x.ca', '{"full_name":"Owen Owner"}');
insert into corporation_memberships (user_id, corporation_id, status, joined_at)
  select id, 'BCS-1234', 'active', now() from auth.users where id::text like '70000000-%';
delete from corporation_role_assignments where corporation_id = 'BCS-1234' and role = 'president';
insert into corporation_role_assignments (corporation_id, role, user_id) values
  ('BCS-1234', 'president', '70000000-0000-0000-0000-000000000001'),
  ('BCS-1234', 'treasurer', '70000000-0000-0000-0000-000000000002'),
  ('BCS-1234', 'member_at_large', '70000000-0000-0000-0000-000000000003'),
  ('BCS-1234', 'member_at_large', '70000000-0000-0000-0000-000000000004'),
  ('BCS-1234', 'manager', '70000000-0000-0000-0000-000000000005');
delete from subscriptions where corporation_id = 'BCS-1234';
-- 0081: discussions without a vote. Subscribed, so the free limit doesn't get in the way.
insert into subscriptions (corporation_id, status) values ('BCS-1234', 'active');

set role authenticated;
set test.uid = '70000000-0000-0000-0000-000000000002';
-- With a vote, the motion is still required.
select pg_temp.expect_error($q$select create_discussion('BCS-1234', 'Roof', '', '', '', '   ')$q$, 'Write the motion');
select pg_temp.expect_error($q$select create_discussion('BCS-1234', 'Roof', '', '', '', '', true)$q$, 'Write the motion');
-- The old six-argument call still works (vote on, as before).
create temp table dv as select create_discussion('BCS-1234', 'Roof quotes', '', '', '', 'THAT council get three quotes.') id;
-- Without a vote, no motion is needed.
create temp table dn as select create_discussion('BCS-1234', 'Parkade lights', 'Owners say the parkade is dark.', '', '', '', false) id;
grant select on dv, dn to authenticated;
select pg_temp.expect('a discussion with a vote by default', (select vote_required from discussions where id = (select id from dv)));
select pg_temp.expect('no vote, no motion', (select not vote_required and motion = '' from discussions where id = (select id from dn)));
select pg_temp.expect('everyone on council takes part', (select count(*) = 4 from discussion_voters where discussion_id = (select id from dn)));

-- Nobody votes on it, but a conflict can be declared.
set test.uid = '70000000-0000-0000-0000-000000000003';
select pg_temp.expect_error($q$select cast_discussion_vote((select id from dn), 'for')$q$, 'has no vote');
select cast_discussion_vote((select id from dn), 'recused', 'I sit on the lighting contractor''s board.');
select pg_temp.expect('the recusal is recorded', (select vote = 'recused' from discussion_voters where discussion_id = (select id from dn) and user_id = '70000000-0000-0000-0000-000000000003'));
select add_discussion_comment((select id from dv), 'Agree, get the quotes.');

-- Its author can change it, motion blank and all; not the one with a vote.
set test.uid = '70000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($q$select update_discussion((select id from dv), 'Roof quotes', '', '', '', '')$q$, 'Write the motion');

-- Closing: no result, nothing to ratify.
create temp table cn as select * from close_discussion((select id from dn));
grant select on cn to authenticated;
select pg_temp.expect('closed without a result', (select status = 'closed' and result is null and closed_at is not null and votes_for is null from cn));
select pg_temp.expect_error($q$select close_discussion((select id from dn))$q$, 'already closed');

-- The one with a vote still counts: 1 of 4 for, no majority.
select cast_discussion_vote((select id from dv), 'for');
create temp table cv as select * from close_discussion((select id from dv));
grant select on cv to authenticated;
select pg_temp.expect('a vote still gets a result', (select status = 'closed' and result = 'no_majority' and votes_for = 1 from cv));
reset role;

-- The table refuses a closed vote without a result, or a no-vote one with one.
select pg_temp.expect_error($q$update discussions set result = null where id = (select id from dv)$q$, 'discussions_closed');
select pg_temp.expect_error($q$update discussions set result = 'supported' where id = (select id from dn)$q$, 'discussions_closed');
select pg_temp.expect_error($q$insert into discussions (corporation_id, title, motion) values ('BCS-1234', 'x', '')$q$, 'discussions_motion_when_voting');
