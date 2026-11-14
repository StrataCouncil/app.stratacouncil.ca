-- The demo's fictional council (supabase/demo/demo.sql, lib/demo-council.ts):
-- demo_council_join and demo_council_ballot act only for demo_cast accounts
-- on the meeting's own council, only while the meeting runs or the vote is
-- open, never twice, never for a lot with a conflict, and only for the
-- service role.
\set ON_ERROR_STOP 1
\i supabase/demo/demo.sql
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;

-- BCS-1234's council (seed): Bob (SL001) runs the meeting. Cara (SL002)
-- and Finn (SL003) play fictional members here; Cara is in demo_cast,
-- Finn isn't (as if a visitor had invited a real person).
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000b', array['admin', 'president']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['treasurer']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['member_at_large']);
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000b', 'SL001');
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL002');
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000f', 'SL003');
reset role;
insert into demo_cast (user_id, part) values ('00000000-0000-0000-0000-00000000000c', 'council');

select pg_temp.expect('visitors can''t make the fictional council act',
  not has_function_privilege('authenticated', 'public.demo_council_join(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.demo_council_ballot(uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.demo_council_ballot(uuid, uuid, text, text)', 'execute'));

-- A meeting not yet launched: nobody arrives.
set app.meeting_lifecycle = 'on';
insert into meetings (id, corporation_id, type, meeting_date, created_by, status, attendance, agenda)
values ('7d000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b', 'DRAFT', '{}',
  '[{"id":"i4","text":"Roof replacement"},{"id":"i5","text":"Landscaping"}]');
reset app.meeting_lifecycle;
select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c', 'SL002');
select pg_temp.expect('no one arrives before the meeting is launched', (select attendance = '{}'::jsonb from meetings where id = '7d000000-0000-0000-0000-0000000000aa'));

-- Launched, with Bob present.
set app.meeting_lifecycle = 'on';
update meetings set status = 'LIVE', launched_by = '00000000-0000-0000-0000-00000000000b', launched_at = now(), actual_start_at = now(),
  attendance = '{"SL001":"present"}' where id = '7d000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;

select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c', 'SL002');
select pg_temp.expect('a fictional member arrives, as if they joined themselves',
  (select attendance ->> 'SL002' = 'present' from meetings where id = '7d000000-0000-0000-0000-0000000000aa')
  and exists (select 1 from meeting_presence where meeting_id = '7d000000-0000-0000-0000-0000000000aa' and lot_number = 'SL002' and event = 'joined'
              and user_id = '00000000-0000-0000-0000-00000000000c' and by_user = '00000000-0000-0000-0000-00000000000c'));
select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c', 'SL002');
select pg_temp.expect('and arrives only once', (select count(*) = 1 from meeting_presence where meeting_id = '7d000000-0000-0000-0000-0000000000aa' and lot_number = 'SL002'));
select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000f', 'SL003');
select pg_temp.expect('a real person is never moved by the demo', (select attendance -> 'SL003' is null from meetings where id = '7d000000-0000-0000-0000-0000000000aa'));
select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c', 'SL009');
select pg_temp.expect('nor for a lot that isn''t theirs', (select attendance -> 'SL009' is null from meetings where id = '7d000000-0000-0000-0000-0000000000aa'));

-- The fictional manager joins (no lot, so not on the attendance); a manager
-- who isn't fictional, or someone who isn't the manager, doesn't.
insert into demo_cast (user_id, part) values ('00000000-0000-0000-0000-00000000000b', 'manager') on conflict do nothing;
select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000f', null);
select pg_temp.expect('only the strata''s manager joins without a lot',
  not exists (select 1 from meeting_presence where meeting_id = '7d000000-0000-0000-0000-0000000000aa' and user_id = '00000000-0000-0000-0000-00000000000f'));
insert into auth.users (id, email, raw_user_meta_data) values ('7d000000-0000-0000-0000-000000000001', 'dev@harbourline.example', '{"full_name":"Dev Malhotra"}');
insert into corporation_memberships (user_id, corporation_id, status, joined_at) values ('7d000000-0000-0000-0000-000000000001', 'BCS-1234', 'active', now());
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'manager', '7d000000-0000-0000-0000-000000000001');
insert into demo_cast (user_id, part) values ('7d000000-0000-0000-0000-000000000001', 'manager');
select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '7d000000-0000-0000-0000-000000000001', null);
select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '7d000000-0000-0000-0000-000000000001', null);
select pg_temp.expect('the fictional manager joins once, with no lot, and isn''t on the attendance',
  (select count(*) = 1 from meeting_presence where meeting_id = '7d000000-0000-0000-0000-0000000000aa' and user_id = '7d000000-0000-0000-0000-000000000001' and lot_number is null)
  and (select attendance = '{"SL001":"present","SL002":"present"}'::jsonb from meetings where id = '7d000000-0000-0000-0000-0000000000aa'));
delete from demo_cast where user_id = '00000000-0000-0000-0000-00000000000b';

-- A vote opens for SL001 and SL002 (Finn, SL003, is present too, for the conflict check).
set app.meeting_lifecycle = 'on';
update meetings set attendance = attendance || '{"SL003":"present"}' where id = '7d000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;
insert into meeting_votes (id, meeting_id, item_id, motion, decision_type, eligible_lots, opened_by)
values ('7d000000-0000-0000-0000-0000000000b1', '7d000000-0000-0000-0000-0000000000aa', 'i4', 'THAT the roof be replaced', 'MAJORITY',
  array['SL001','SL002','SL003'], '00000000-0000-0000-0000-00000000000b');

select demo_council_ballot('7d000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000c', 'SL002', 'maybe');
select pg_temp.expect('only For, Against, or Abstain', not exists (select 1 from meeting_ballots where vote_id = '7d000000-0000-0000-0000-0000000000b1'));
select demo_council_ballot('7d000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000c', 'SL002', 'against');
select pg_temp.expect('a fictional member votes from their own screen',
  (select choice = 'against' and not cast_for_other and cast_by = '00000000-0000-0000-0000-00000000000c' from meeting_ballots
   where vote_id = '7d000000-0000-0000-0000-0000000000b1' and lot_number = 'SL002')
  and exists (select 1 from meeting_ballot_log where vote_id = '7d000000-0000-0000-0000-0000000000b1' and lot_number = 'SL002'));
select demo_council_ballot('7d000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000c', 'SL002', 'for');
select pg_temp.expect('and never changes a ballot already cast', (select choice = 'against' from meeting_ballots where vote_id = '7d000000-0000-0000-0000-0000000000b1' and lot_number = 'SL002'));
select demo_council_ballot('7d000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000f', 'SL003', 'for');
select pg_temp.expect('never votes for a real person', not exists (select 1 from meeting_ballots where vote_id = '7d000000-0000-0000-0000-0000000000b1' and lot_number = 'SL003'));

-- A second vote, with Cara declaring a conflict on its item.
update meeting_votes set status = 'closed', closed_at = now() where id = '7d000000-0000-0000-0000-0000000000b1';
select demo_council_ballot('7d000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000c', 'SL002', 'for');
select pg_temp.expect('a closed vote is left alone', (select choice = 'against' from meeting_ballots where vote_id = '7d000000-0000-0000-0000-0000000000b1' and lot_number = 'SL002'));
insert into meeting_conflicts (meeting_id, item_id, lot_number, note, declared_by)
values ('7d000000-0000-0000-0000-0000000000aa', 'i5', 'SL002', 'My cousin is the landscaper.', '00000000-0000-0000-0000-00000000000c');
insert into meeting_votes (id, meeting_id, item_id, motion, decision_type, eligible_lots, opened_by)
values ('7d000000-0000-0000-0000-0000000000b2', '7d000000-0000-0000-0000-0000000000aa', 'i5', 'THAT the landscaping contract be renewed', 'MAJORITY',
  array['SL001','SL002','SL003'], '00000000-0000-0000-0000-00000000000b');
select demo_council_ballot('7d000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000c', 'SL002', 'for');
select pg_temp.expect('a member with a conflict doesn''t vote', not exists (select 1 from meeting_ballots where vote_id = '7d000000-0000-0000-0000-0000000000b2'));

-- Adjourned: nobody arrives.
update meeting_votes set status = 'cancelled' where id = '7d000000-0000-0000-0000-0000000000b2';
set app.meeting_lifecycle = 'on';
update meetings set status = 'ADJOURNED', adjourned_at = now(), attendance = '{"SL001":"present"}' where id = '7d000000-0000-0000-0000-0000000000aa';
reset app.meeting_lifecycle;
select demo_council_join('7d000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000000c', 'SL002');
select pg_temp.expect('no one arrives after adjournment', (select attendance -> 'SL002' is null from meetings where id = '7d000000-0000-0000-0000-0000000000aa'));
