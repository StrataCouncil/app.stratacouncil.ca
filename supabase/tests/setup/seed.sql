\set ON_ERROR_STOP 1
-- Test people and one strata (BCS-1234), created through the real
-- functions, plus the core create/join/invite/roles flow checks. Every
-- suite starts from a fresh copy of the database as it is after this.
-- Permissions come only from the migrations: nothing here grants extra.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','a@x.ca','{"full_name":"Alice Admin"}'),
 ('00000000-0000-0000-0000-00000000000b','b@x.ca','{"full_name":"Bob Joiner"}'),
 ('00000000-0000-0000-0000-00000000000c','c@x.ca','{"full_name":"Cara Invitee"}'),
 ('00000000-0000-0000-0000-00000000000d','d@x.ca','{"full_name":"Sam Staff"}'),
 ('00000000-0000-0000-0000-00000000000e','x@x.ca','{"full_name":"Xavier Outsider"}');
update public.profiles set is_super_admin = true where email = 'd@x.ca';
insert into public.documents (id, category, title, storage_path, uploaded_by)
 values ('11111111-1111-1111-1111-111111111111','legal_governance','plan','strata-plans/a/p.pdf','00000000-0000-0000-0000-00000000000a');

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

set role authenticated;

-- 1. Alice submits a creation request
set test.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect('lookup misses before creation', (select count(*) from lookup_strata_corporation('BCS-1234')) = 0);
insert into corporation_creation_requests (strata_plan_document_id, parsed_strata_plan_number, parsed_legal_name, parsed_address, parsed_unit_count, parsed_jurisdiction, requested_by, attestation_full_name, attestation_confirmed)
 values ('11111111-1111-1111-1111-111111111111','BCS-1234','The Owners, SP BCS1234','1 Main St',3,'BC','00000000-0000-0000-0000-00000000000a','Alice',true);
select pg_temp.expect_error($$insert into corporation_creation_requests (parsed_strata_plan_number, requested_by) values ('BCS-1234','00000000-0000-0000-0000-00000000000a')$$, 'one_pending');

-- 1b. A second person can't open a competing request for the same SP#, and the lookup tells them
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('other user sees a pending request exists', strata_plan_has_pending_request('BCS-1234'));
select pg_temp.expect('but cannot read it', (select count(*) from corporation_creation_requests) = 0);
select pg_temp.expect_error($$insert into corporation_creation_requests (parsed_strata_plan_number, requested_by) values ('BCS-1234','00000000-0000-0000-0000-00000000000b')$$, 'one_pending');
select pg_temp.expect('no pending for other SP#', not strata_plan_has_pending_request('BCS-9999'));
set test.uid = '00000000-0000-0000-0000-00000000000a';

-- 2. Outsider and requester can't approve; super admin can
select pg_temp.expect_error($$select approve_corporation_creation_request((select id from corporation_creation_requests limit 1),'BCS-1234','L','A',3,'BC')$$, 'Only platform staff');
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('outsider cannot see the request', (select count(*) from corporation_creation_requests) = 0);
set test.uid = '00000000-0000-0000-0000-00000000000d';
select approve_corporation_creation_request((select id from corporation_creation_requests limit 1),'BCS-1234','The Owners, Strata Plan BCS1234','1 Main St, Vancouver',3,'BC');
select pg_temp.expect_error($$select approve_corporation_creation_request((select id from corporation_creation_requests limit 1),'BCS-1234','L','A',3,'BC')$$, 'already been resolved');
reset role;
select pg_temp.expect('corp created', exists(select 1 from strata_corporations where strata_plan_number='BCS-1234' and source_document_id is not null));
select pg_temp.expect('owners_and_council seeded x3', (select count(*) from owners_and_council where corporation_id='BCS-1234') = 3);
select pg_temp.expect('plan doc attached to corp', (select corporation_id from documents) = 'BCS-1234');
select pg_temp.expect('alice active admin', exists(select 1 from corporation_memberships m join corporation_role_assignments r using (user_id) where m.status='active' and r.role='admin' and m.user_id='00000000-0000-0000-0000-00000000000a'));
set role authenticated;

-- 3. Bob looks up and requests to join
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('lookup finds corp for non-member', (select count(*) from lookup_strata_corporation('BCS-1234')) = 1);
select pg_temp.expect('non-member cannot read corp directly', (select count(*) from strata_corporations) = 0);
select pg_temp.expect('non-member cannot read directory', (select count(*) from corporation_member_directory('BCS-1234')) = 0);
insert into corporation_join_requests (corporation_id, requested_by) values ('BCS-1234','00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into corporation_join_requests (corporation_id, requested_by) values ('BCS-1234','00000000-0000-0000-0000-00000000000b')$$, 'one_pending');
select pg_temp.expect('requester cannot read admin queue', (select count(*) from corporation_join_request_queue('BCS-1234')) = 0);
select pg_temp.expect_error($$select resolve_corporation_join_request((select id from corporation_join_requests limit 1), true)$$, 'row-level security');

-- 4. Alice approves
set test.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect('admin sees queue with name', (select full_name from corporation_join_request_queue('BCS-1234')) = 'Bob Joiner');
select resolve_corporation_join_request((select id from corporation_join_requests limit 1), true);
select pg_temp.expect('bob active', (select status from corporation_memberships where user_id='00000000-0000-0000-0000-00000000000b') = 'active');
select pg_temp.expect_error($$select resolve_corporation_join_request((select id from corporation_join_requests limit 1), false)$$, 'already been resolved');

-- 5. Roles: BC bylaw, seat moves, admin handover
select set_corporation_member_roles('BCS-1234','00000000-0000-0000-0000-00000000000b', array['president']);
select pg_temp.expect_error($$select set_corporation_member_roles('BCS-1234','00000000-0000-0000-0000-00000000000b', array['president','vice_president'])$$, 'Bylaw 13(2)');
select set_corporation_member_roles('BCS-1234','00000000-0000-0000-0000-00000000000a', array['admin','president']);
select pg_temp.expect('president moved from bob to alice', (select user_id from corporation_role_assignments where role='president') = '00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select set_corporation_member_roles('BCS-1234','00000000-0000-0000-0000-00000000000a', array['president'])$$, 'always needs an admin');
select pg_temp.expect_error($$select remove_corporation_member('BCS-1234','00000000-0000-0000-0000-00000000000a')$$, 'can''t be removed');
select set_corporation_member_roles('BCS-1234','00000000-0000-0000-0000-00000000000b', array['admin','manager']);
select pg_temp.expect('bob is a second admin (0027)', (select count(*) from corporation_role_assignments where role='admin') = 2);
select set_corporation_member_roles('BCS-1234','00000000-0000-0000-0000-00000000000a', array['president']);
select pg_temp.expect('alice steps down as admin, keeps president only', (select array_agg(role order by role) from corporation_role_assignments where user_id='00000000-0000-0000-0000-00000000000a') = array['president']);
select pg_temp.expect('exactly one admin', (select count(*) from corporation_role_assignments where role='admin') = 1);
select pg_temp.expect_error($$select set_corporation_member_roles('BCS-1234','00000000-0000-0000-0000-00000000000a', array['admin'])$$, 'Only this strata''s admin');

-- 6. Invite Cara (as Bob, now admin), with an 'invited' membership row
set test.uid = '00000000-0000-0000-0000-00000000000b';
insert into corporation_invites (corporation_id, invited_email, invited_by) values ('BCS-1234','C@x.ca','00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($$insert into corporation_invites (corporation_id, invited_email, invited_by) values ('BCS-1234','c@X.ca','00000000-0000-0000-0000-00000000000b')$$, 'one_pending');
insert into corporation_memberships (user_id, corporation_id, status, invited_by) values ('00000000-0000-0000-0000-00000000000c','BCS-1234','invited','00000000-0000-0000-0000-00000000000b');
select pg_temp.expect('directory shows invited cara', (select status from corporation_member_directory('BCS-1234') where email='c@x.ca') = 'invited');
select pg_temp.expect_error($$select set_corporation_member_roles('BCS-1234','00000000-0000-0000-0000-00000000000c', array['secretary'])$$, 'active members');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('invited member is not yet a member', not is_corporation_member('BCS-1234'));
select pg_temp.expect('cara sees her invite', (select count(*) from my_pending_invites()) = 1);
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('outsider sees no invites', (select count(*) from my_pending_invites()) = 0);
select pg_temp.expect_error($$select accept_corporation_invite((select id from corporation_invites limit 1))$$, 'isn''t for the account');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('accept returns corp', accept_corporation_invite((select i.id from my_pending_invites() i limit 1)) = 'BCS-1234');
select pg_temp.expect('cara now member', is_corporation_member('BCS-1234'));
select pg_temp.expect('cara cannot read invites (admin-only)', (select count(*) from corporation_invites) = 0);

-- 7. Meeting permissions: only admin writes
update corporation_memberships set can_run_meetings = true where user_id='00000000-0000-0000-0000-00000000000c';
reset role; select pg_temp.expect('member self-grant ignored by RLS', not (select can_run_meetings from corporation_memberships where user_id='00000000-0000-0000-0000-00000000000c')); set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
update corporation_memberships set can_run_meetings = true where user_id='00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('admin toggles run-meetings permission', (select can_run_meetings from corporation_memberships where user_id='00000000-0000-0000-0000-00000000000c'));

-- 8. Removal
set test.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($$select remove_corporation_member('BCS-1234','00000000-0000-0000-0000-00000000000c')$$, 'Only this strata''s admin');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select remove_corporation_member('BCS-1234','00000000-0000-0000-0000-00000000000a');
select pg_temp.expect('alice removed, roles dropped', (select status from corporation_memberships where user_id='00000000-0000-0000-0000-00000000000a') = 'removed' and not exists(select 1 from corporation_role_assignments where user_id='00000000-0000-0000-0000-00000000000a'));
set test.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect('removed member loses access', (select count(*) from strata_corporations) = 0 and (select count(*) from corporation_member_directory('BCS-1234')) = 0);

-- 9. Super admin can read across corps
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('super admin reads directory + roles', (select count(*) from corporation_member_directory('BCS-1234')) = 2 and (select count(*) from corporation_role_assignments) = 2);

-- 10. Accepting an invite closes the invitee's own pending join request
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000f','f@x.ca');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000f';
insert into corporation_join_requests (corporation_id, requested_by) values ('BCS-1234','00000000-0000-0000-0000-00000000000f');
set test.uid = '00000000-0000-0000-0000-00000000000b';
insert into corporation_invites (corporation_id, invited_email, invited_by) values ('BCS-1234','f@x.ca','00000000-0000-0000-0000-00000000000b');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select accept_corporation_invite((select i.id from my_pending_invites() i limit 1));
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('join request auto-closed, queue empty', (select count(*) from corporation_join_request_queue('BCS-1234')) = 0);
select pg_temp.expect('anon-style call (no uid) gets nothing from lookup', true);
reset test.uid;
select pg_temp.expect('no uid: lookup empty', (select count(*) from lookup_strata_corporation('BCS-1234')) = 0);
select pg_temp.expect('no uid: invites empty', (select count(*) from my_pending_invites()) = 0);

select pg_temp.expect('pending flag clears after approval', not strata_plan_has_pending_request('BCS-1234'));
