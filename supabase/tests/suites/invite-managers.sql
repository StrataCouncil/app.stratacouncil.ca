\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, strata admin
-- Invited as manager from the Council page (a manager listed on the Management tab).
insert into corporation_invites (corporation_id, invited_email, invited_by, invited_role) values ('BCS-1234', 'x@x.ca', '00000000-0000-0000-0000-00000000000b', 'manager');
reset role;
select pg_temp.expect('an invite can only carry the Manager role',
  (select count(*) = 0 from pg_constraint where conname = 'corporation_invites_invited_role_check' and pg_get_constraintdef(oid) not like '%manager%'));
select id as invite_id from corporation_invites where invited_email = 'x@x.ca' and corporation_id = 'BCS-1234' \gset
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000e';  -- Xavier accepts
select accept_corporation_invite(:'invite_id');
reset role;
select pg_temp.expect('accepting makes them the Manager',
  exists (select 1 from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000e' and role = 'manager'));
select pg_temp.expect('with no strata lot and no council lot',
  (select lot_number is null from corporation_memberships where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000e')
  and not exists (select 1 from owners_and_council where corporation_id = 'BCS-1234' and council_member_name = 'Xavier Outsider'));
