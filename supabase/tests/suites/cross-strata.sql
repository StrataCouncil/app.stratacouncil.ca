\set ON_ERROR_STOP 1
-- One strata's admin can't read or change another strata's data (the
-- 2026-10 audit). Xavier is the admin of his own strata, BCS-5678; every
-- check below is him reaching for BCS-1234 (Bob's strata, from the seed),
-- directly through the tables and through every function a signed-in user
-- can call.
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

-- Xavier's own strata, and something of BCS-1234's in every table.
insert into strata_corporations (strata_plan_number, legal_name, address, unit_count, jurisdiction)
  values ('BCS-5678', 'The Owners, Strata Plan BCS5678', '2 Side St', 4, 'BC');
insert into corporation_memberships (user_id, corporation_id, status) values ('00000000-0000-0000-0000-00000000000e', 'BCS-5678', 'active');
insert into corporation_role_assignments (corporation_id, user_id, role) values ('BCS-5678', '00000000-0000-0000-0000-00000000000e', 'admin');
insert into subscriptions (corporation_id, status) values ('BCS-1234', 'active'), ('BCS-5678', 'active')
  on conflict (corporation_id) do update set status = 'active';
insert into meetings (id, corporation_id, type, meeting_date, created_by)
  values ('22222222-2222-2222-2222-222222222222', 'BCS-1234', 'council', '2026-10-01', '00000000-0000-0000-0000-00000000000b');
insert into meeting_item_notes (meeting_id, item_id, body) values ('22222222-2222-2222-2222-222222222222', 'i1', 'private note');
insert into decisions (corporation_id, title) values ('BCS-1234', 'Roof repairs approved');
insert into strata_management (corporation_id, company_name) values ('BCS-1234', 'Acme Management');
insert into conversations (corporation_id, user_id, title) values ('BCS-1234', '00000000-0000-0000-0000-00000000000b', 'Bob''s question');
insert into knowledge_chunks (scope, corporation_id, chunk_text, embedding, chunk_index)
  values ('corporation', 'BCS-1234', 'BCS-1234 private text', array_fill(0.1, array[1024])::extensions.vector, 0);

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000e';  -- Xavier, admin of BCS-5678

-- Reading
select pg_temp.expect('own strata visible', (select count(*) = 1 from strata_corporations where strata_plan_number = 'BCS-5678'));
select pg_temp.expect('other strata hidden', (select count(*) = 0 from strata_corporations where strata_plan_number = 'BCS-1234'));
select pg_temp.expect('documents hidden', (select count(*) = 0 from documents where corporation_id = 'BCS-1234'));
select pg_temp.expect('meetings hidden', (select count(*) = 0 from meetings where corporation_id = 'BCS-1234'));
select pg_temp.expect('meeting notes hidden', (select count(*) = 0 from meeting_item_notes));
select pg_temp.expect('decisions hidden', (select count(*) = 0 from decisions where corporation_id = 'BCS-1234'));
select pg_temp.expect('owners roster hidden', (select count(*) = 0 from owners_and_council where corporation_id = 'BCS-1234'));
select pg_temp.expect('memberships hidden', (select count(*) = 0 from corporation_memberships where corporation_id = 'BCS-1234'));
select pg_temp.expect('roles hidden', (select count(*) = 0 from corporation_role_assignments where corporation_id = 'BCS-1234'));
select pg_temp.expect('invites hidden', (select count(*) = 0 from corporation_invites where corporation_id = 'BCS-1234'));
select pg_temp.expect('join requests hidden', (select count(*) = 0 from corporation_join_requests where corporation_id = 'BCS-1234'));
select pg_temp.expect('subscription hidden', (select count(*) = 0 from subscriptions where corporation_id = 'BCS-1234'));
select pg_temp.expect('management hidden', (select count(*) = 0 from strata_management where corporation_id = 'BCS-1234'));
select pg_temp.expect('conversations hidden', (select count(*) = 0 from conversations where corporation_id = 'BCS-1234'));
select pg_temp.expect('knowledge chunks closed to clients', (select count(*) = 0 from knowledge_chunks));
select pg_temp.expect('member directory empty', (select count(*) = 0 from corporation_member_directory('BCS-1234')));
select pg_temp.expect('join queue empty', (select count(*) = 0 from corporation_join_request_queue('BCS-1234')));
select pg_temp.expect('not a member', not is_corporation_member('BCS-1234'));
select pg_temp.expect('no admin role there', not has_corporation_role('BCS-1234', array['admin']));
select pg_temp.expect('cannot run its meetings', not can_run_meetings('BCS-1234'));
select pg_temp.expect('cannot bill it', not can_manage_billing('BCS-1234'));
select pg_temp.expect('no Stratasphere there', not has_stratasphere_access('BCS-1234'));
select pg_temp.expect('no AI allowance there', not consume_stratasphere_request('BCS-1234'));
select pg_temp.expect_error($q$select * from match_knowledge_chunks('BCS-1234', array_fill(0.1, array[1024])::extensions.vector)$q$, 'not allowed');

-- Writing into the other strata
select pg_temp.expect_error($q$insert into documents (corporation_id, category, title, uploaded_by) values ('BCS-1234', 'insurance', 'x', '00000000-0000-0000-0000-00000000000e')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into meetings (corporation_id, type, meeting_date, created_by) values ('BCS-1234', 'council', '2026-11-01', '00000000-0000-0000-0000-00000000000e')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into corporation_memberships (user_id, corporation_id, status) values ('00000000-0000-0000-0000-00000000000e', 'BCS-1234', 'active')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into corporation_role_assignments (corporation_id, user_id, role) values ('BCS-1234', '00000000-0000-0000-0000-00000000000e', 'admin')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into corporation_invites (corporation_id, invited_email, invited_by) values ('BCS-1234', 'x@x.ca', '00000000-0000-0000-0000-00000000000e')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into owners_and_council (corporation_id, lot_number) values ('BCS-1234', 'SL099')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into strata_management (corporation_id, company_name) values ('BCS-1234', 'Evil Co')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into conversations (corporation_id, user_id, title) values ('BCS-1234', '00000000-0000-0000-0000-00000000000e', 'x')$q$, 'row-level security');
select pg_temp.expect_error($q$insert into meeting_item_notes (meeting_id, item_id, body) values ('22222222-2222-2222-2222-222222222222', 'i2', 'x')$q$, 'row-level security');
-- Moving a row from his strata into the other one
select pg_temp.expect_error($q$update corporation_memberships set corporation_id = 'BCS-1234' where corporation_id = 'BCS-5678'$q$, 'row-level security');

-- Updates and deletes find nothing to change
update owners_and_council set full_name = 'Hacked' where corporation_id = 'BCS-1234';
update corporation_memberships set status = 'removed' where corporation_id = 'BCS-1234';
update meetings set location = 'Hacked' where corporation_id = 'BCS-1234';
update strata_management set company_name = 'Hacked' where corporation_id = 'BCS-1234';
update subscriptions set status = 'active' where corporation_id = 'BCS-5678';
delete from documents where corporation_id = 'BCS-1234';
delete from meetings where corporation_id = 'BCS-1234';
delete from decisions where corporation_id = 'BCS-1234';
delete from conversations where corporation_id = 'BCS-1234';

-- Functions refuse him
select pg_temp.expect_error($q$select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL001')$q$, 'Only this strata''s admin');
select pg_temp.expect_error($q$select remove_corporation_member('BCS-1234', '00000000-0000-0000-0000-00000000000c')$q$, 'Only this strata''s admin');
select pg_temp.expect_error($q$select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000e', array['admin'])$q$, 'Only this strata''s admin');
select pg_temp.expect_error($q$select move_document('11111111-1111-1111-1111-111111111111', 'insurance')$q$, 'not allowed');
select pg_temp.expect_error($q$select record_historic_decisions('BCS-1234', '11111111-1111-1111-1111-111111111111', '[]'::jsonb)$q$, 'not allowed');
select pg_temp.expect_error($q$select launch_meeting('22222222-2222-2222-2222-222222222222')$q$, '');

reset role;
select pg_temp.expect('roster untouched', (select count(*) = 0 from owners_and_council where full_name = 'Hacked'));
select pg_temp.expect('memberships untouched', (select count(*) = 0 from corporation_memberships where corporation_id = 'BCS-1234' and status = 'removed' and user_id <> '00000000-0000-0000-0000-00000000000a'));
select pg_temp.expect('meeting untouched', (select location is distinct from 'Hacked' from meetings where id = '22222222-2222-2222-2222-222222222222'));
select pg_temp.expect('management untouched', (select company_name = 'Acme Management' from strata_management where corporation_id = 'BCS-1234'));
select pg_temp.expect('documents untouched', (select count(*) >= 1 from documents where corporation_id = 'BCS-1234'));
select pg_temp.expect('decisions untouched', (select count(*) = 1 from decisions where corporation_id = 'BCS-1234'));
select pg_temp.expect('conversations untouched', (select count(*) = 1 from conversations where corporation_id = 'BCS-1234'));
select pg_temp.expect('Xavier still not in BCS-1234', not exists (select 1 from corporation_memberships where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000e'));
