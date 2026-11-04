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

select pg_temp.expect('visitors can''t settle ratifications themselves',
  not has_function_privilege('authenticated', 'public.settle_discussion_ratifications()', 'execute'));
select pg_temp.expect('the files bucket is private', (select not public from storage.buckets where id = 'discussion-files'));

set role authenticated;
-- Council and those who run meetings can start one: not a manager who can't run meetings, or an owner.
set test.uid = '70000000-0000-0000-0000-000000000005';
select pg_temp.expect_error($q$select create_discussion('BCS-1234', 'Roof', '', '', '', 'THAT council get three quotes.')$q$, 'Only council members');
set test.uid = '70000000-0000-0000-0000-000000000006';
select pg_temp.expect_error($q$select create_discussion('BCS-1234', 'Roof', '', '', '', 'THAT council get three quotes.')$q$, 'Only council members');
-- The strata's admin (Bob) runs meetings, so since 0078 they may start one too (checked, not used up here).
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('the admin, who runs meetings, may start one (0078)', can_see_discussions('BCS-1234'));

-- Tess starts one; council as it stands is the voters.
set test.uid = '70000000-0000-0000-0000-000000000002';
create temp table d1 as select create_discussion('BCS-1234', 'Roof quotes', 'The roof is 24 years old.', 'About $1,500 for an assessment.', 'Leaks if we wait.', 'THAT council get three quotes.') id;
grant select on d1 to authenticated;
select pg_temp.expect('four voters, the council when it opened',
  (select count(*) = 4 from discussion_voters where discussion_id = (select id from d1)));
select pg_temp.expect('the author''s name is kept', (select author_name = 'Tess Treasurer' from discussions where id = (select id from d1)));

-- The free one is used; a second needs a subscription.
select pg_temp.expect_error($q$select create_discussion('BCS-1234', 'Second', '', '', '', 'THAT x.')$q$, 'free_discussion_used');

-- Nobody off council sees it, Super Admins included.
set test.uid = '70000000-0000-0000-0000-000000000005';
select pg_temp.expect('the manager sees no discussions', (select count(*) = 0 from discussions));
set test.uid = '70000000-0000-0000-0000-000000000006';
select pg_temp.expect('an owner sees no discussions', (select count(*) = 0 from discussions));
set test.uid = '00000000-0000-0000-0000-00000000000d';
set test.aal = 'aal2';
select pg_temp.expect('a Super Admin reads every discussion (0078)', (select count(*) > 0 from discussions));
select pg_temp.expect('and their votes, but is never a voter', (select count(*) > 0 from discussion_voters)
  and not exists (select 1 from discussion_voters where user_id = '00000000-0000-0000-0000-00000000000d'));

-- Nobody writes the tables directly.
set test.uid = '70000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($q$update discussions set motion = 'THAT y.'$q$, 'permission denied');
select pg_temp.expect_error($q$update discussion_voters set vote = 'for'$q$, 'permission denied');
select pg_temp.expect_error($q$insert into discussion_comments (discussion_id, body) select id, 'hi' from d1$q$, 'permission denied');

-- The author can change it until the first vote; nobody else can.
select update_discussion((select id from d1), 'Roof quotes', 'The roof is 24 years old.', 'About $1,500.', 'Leaks.', 'THAT council get three roofing quotes.');
set test.uid = '70000000-0000-0000-0000-000000000003';
select pg_temp.expect_error($q$select update_discussion((select id from d1), 'x', '', '', '', 'THAT x.')$q$, 'Only the person who started');

-- Votes. A conflict of interest needs a reason.
select pg_temp.expect_error($q$select cast_discussion_vote((select id from d1), 'recused', '  ')$q$, 'conflict of interest is');
select cast_discussion_vote((select id from d1), 'recused', 'My company bid on the roof.');
set test.uid = '70000000-0000-0000-0000-000000000002';
select pg_temp.expect_error($q$select update_discussion((select id from d1), 'x', '', '', '', 'THAT x.')$q$, 'motion_locked');
select cast_discussion_vote((select id from d1), 'for');
set test.uid = '70000000-0000-0000-0000-000000000001';
select cast_discussion_vote((select id from d1), 'against');
select cast_discussion_vote((select id from d1), 'for');  -- changed their mind while it's open
select add_discussion_comment((select id from d1), 'Get one quote from a firm we haven''t used.');
select pg_temp.expect_error($q$select cast_discussion_vote((select id from d1), 'maybe')$q$, 'Choose For');

-- A recused member: sees the motion and their own vote, not the others' or the comments, and can't comment.
set test.uid = '70000000-0000-0000-0000-000000000003';
select pg_temp.expect('recused: still sees the motion', (select count(*) = 1 from discussions));
select pg_temp.expect('recused: sees only their own vote', (select count(*) = 1 from discussion_voters));
select pg_temp.expect('recused: sees no comments', (select count(*) = 0 from discussion_comments));
select pg_temp.expect_error($q$select add_discussion_comment((select id from d1), 'hi')$q$, 'taking part');
set test.uid = '70000000-0000-0000-0000-000000000004';
select pg_temp.expect('others see every vote and comment',
  (select count(*) = 4 from discussion_voters) and (select count(*) = 1 from discussion_comments));

-- Only the author closes. 2 for of 3 eligible (Max recused, Mia didn't vote): supported.
select pg_temp.expect_error($q$select close_discussion((select id from d1))$q$, 'Only the person who started');
set test.uid = '70000000-0000-0000-0000-000000000002';
select close_discussion((select id from d1));
select pg_temp.expect('closed, supported, with the count',
  (select status = 'closed' and result = 'supported' and votes_for = 2 and votes_against = 0 and votes_recused = 1 and votes_missing = 1
   from discussions where id = (select id from d1)));
select pg_temp.expect_error($q$select close_discussion((select id from d1))$q$, 'already closed');
set test.uid = '70000000-0000-0000-0000-000000000004';
select pg_temp.expect_error($q$select cast_discussion_vote((select id from d1), 'for')$q$, 'closed');
select pg_temp.expect_error($q$select add_discussion_comment((select id from d1), 'late')$q$, 'closed');
reset role;

-- With a subscription, more discussions; a member who joins council later can't vote on the old one.
insert into subscriptions (corporation_id, status) values ('BCS-1234', 'active');
set role authenticated;
set test.uid = '70000000-0000-0000-0000-000000000001';
create temp table d2 as select create_discussion('BCS-1234', 'Fence', '', '', '', 'THAT council repair the fence.') id;
create temp table d3 as select create_discussion('BCS-1234', 'Hedge', '', '', '', 'THAT council trim the hedge.') id;
create temp table d5 as select create_discussion('BCS-1234', 'Paint', '', '', '', 'THAT council repaint the lobby.') id;
select cast_discussion_vote((select id from d2), 'for');
select cast_discussion_vote((select id from d3), 'for');
set test.uid = '70000000-0000-0000-0000-000000000002';
select cast_discussion_vote((select id from d2), 'for');
select cast_discussion_vote((select id from d3), 'for');
select cast_discussion_vote((select id from d5), 'against');
set test.uid = '70000000-0000-0000-0000-000000000004';
select cast_discussion_vote((select id from d2), 'for');
select cast_discussion_vote((select id from d3), 'for');
set test.uid = '70000000-0000-0000-0000-000000000001';
select close_discussion((select id from d2));
select close_discussion((select id from d3));
select close_discussion((select id from d5));
select pg_temp.expect('3 of 4 for passes; one against of 4 doesn''t',
  (select result = 'supported' from discussions where id = (select id from d2))
  and (select result = 'no_majority' from discussions where id = (select id from d5)));
reset role;
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'member_at_large', '70000000-0000-0000-0000-000000000006');
insert into auth.users (id, email, raw_user_meta_data) values ('70000000-0000-0000-0000-000000000007', 'nia@x.ca', '{"full_name":"Nia New"}');
insert into corporation_memberships (user_id, corporation_id, status, joined_at) values ('70000000-0000-0000-0000-000000000007', 'BCS-1234', 'active', now());
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'secretary', '70000000-0000-0000-0000-000000000007');
set role authenticated;
set test.uid = '70000000-0000-0000-0000-000000000001';
create temp table d4 as select create_discussion('BCS-1234', 'Lights', '', '', '', 'THAT council replace the lights.') id;
grant select on d4 to authenticated;
set test.uid = '70000000-0000-0000-0000-000000000007';
select cast_discussion_vote((select id from d4), 'for');
select pg_temp.expect_error($q$select cast_discussion_vote((select id from d1), 'for')$q$, 'closed');
reset role;

-- Ratification: a council meeting that adjourns with each discussion on its agenda.
-- (The lifecycle guard is opened the way launch and adjourn open it.)
set app.meeting_lifecycle = 'on';
insert into meetings (id, corporation_id, type, meeting_date, created_by)
  values ('70000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', current_date, '70000000-0000-0000-0000-000000000001');
update meetings set status = 'LIVE', agenda = jsonb_build_array(
    jsonb_build_object('id', 'i1', 'text', 'Ratify: roof', 'discussionId', (select id from d1), 'done', true, 'motion', jsonb_build_object('outcome', 'CARRIED')),
    jsonb_build_object('id', 'i2', 'text', 'Ratify: fence', 'discussionId', (select id from d2), 'done', true, 'motion', jsonb_build_object('outcome', 'DEFEATED')),
    jsonb_build_object('id', 'i3', 'text', 'Ratify: hedge', 'discussionId', (select id from d3), 'done', false, 'deferred', true, 'motion', jsonb_build_object('outcome', null)),
    jsonb_build_object('id', 'i4', 'text', 'Ratify: paint', 'discussionId', (select id from d5), 'done', true, 'motion', jsonb_build_object('outcome', 'CARRIED')))
  where id = '70000000-0000-0000-0000-0000000000aa';
select pg_temp.expect('nothing settles before adjournment',
  (select count(*) = 4 from discussions where status = 'closed'));
update meetings set status = 'ADJOURNED', adjourned_at = now() where id = '70000000-0000-0000-0000-0000000000aa';
select pg_temp.expect('carried: ratified, with the meeting', (select status = 'ratified' and ratified_meeting_id = '70000000-0000-0000-0000-0000000000aa' from discussions where id = (select id from d1)));
select pg_temp.expect('defeated: not ratified', (select status = 'not_ratified' from discussions where id = (select id from d2)));
select pg_temp.expect('deferred: still closed, for another meeting', (select status = 'closed' and ratified_meeting_id is null from discussions where id = (select id from d3)));
select pg_temp.expect('a motion that didn''t pass can''t be ratified', (select status = 'closed' from discussions where id = (select id from d5)));
select pg_temp.expect('an open discussion isn''t touched', (select status = 'open' from discussions where id = (select id from d4)));

-- Deleting the strata takes its discussions with it.
delete from subscriptions where corporation_id = 'BCS-1234';
select * from platform_delete_strata('BCS-1234', false);
select pg_temp.expect('discussions, votes and comments went with the strata',
  (select count(*) = 0 from discussions) and (select count(*) = 0 from discussion_voters) and (select count(*) = 0 from discussion_comments));
